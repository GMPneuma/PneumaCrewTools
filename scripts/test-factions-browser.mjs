import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import ts from "typescript";
import Handlebars from "handlebars";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const html = Handlebars.compile(
    fs.readFileSync("static/templates/payout-window.hbs", "utf8"),
  )({ players: [], factions: [{ id: "f1", name: "Tyger Claws" }] });
  await page.setContent(html);
  const source = ts.transpileModule(
    fs.readFileSync("src/payout-window.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await page.evaluate((source) => {
    const factions = [
      { id: "f1", name: "Tyger Claws", active: true },
      { id: "hidden", name: "Hidden", active: false },
    ];
    const exports = {};
    const imports = {
      "./foundry-form": {
        CrewToolsForm: class {
          activateListeners() {}
        },
      },
      "./factions": {
        getFactions: () => factions,
        promptNewFaction: async () => {
          const f = { id: "f2", name: "Mox", active: true };
          factions.push(f);
          return f;
        },
      },
      "./payout-absence": { syncAbsentDowntimeControl() {} },
    };
    new Function("exports", "require", source)(
      exports,
      (k) => imports[k] ?? {},
    );
    const root = document.querySelector("form");
    root.querySelector('[data-step-panel="rewards"]').hidden = false;
    const rows = root.querySelector("[data-individual-payouts]");
    rows.innerHTML =
      '<div data-individual-row data-actor-id="a1"><div data-individual-entries></div><button type="button" data-add-individual-entry>Add</button></div>';
    new exports.PayoutWindow().activateListeners([root]);
  }, source);
  await page.locator("[data-add-individual-entry]").click();
  const faction = page.locator(
    "[data-individual-entries] [data-entry-faction]",
  );
  await page
    .locator("[data-individual-entries] [data-entry-type]")
    .selectOption("specificReputation");
  assert.equal(await faction.isVisible(), true);
  assert.equal(await faction.isEnabled(), true);
  assert.equal(await faction.locator('option[value="hidden"]').count(), 0);
  await faction.selectOption("f1");
  await faction.selectOption("__add__");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-individual-entries] [data-entry-faction]")
        .value === "f2",
  );
  assert.equal(await faction.inputValue(), "f2");
  await page.locator("[data-add-individual-entry]").click();
  assert.equal(
    await page
      .locator("[data-individual-entries] [data-entry-faction]")
      .nth(1)
      .locator('option[value="f2"]')
      .count(),
    1,
  );
  await page
    .locator("[data-individual-entries] [data-entry-type]")
    .first()
    .selectOption("newReputation");
  assert.equal(await faction.first().isVisible(), false);
  console.log(
    "PASS: faction dropdown, Add new selection, later rows, hidden factions and normal Reputation",
  );
} finally {
  await browser.close();
}
