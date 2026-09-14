import { createRequire } from "node:module";
import fs from "node:fs";
import ts from "typescript";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const html = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/payout-window.hbs", import.meta.url),
      "utf8",
    ),
  )({ players: [] });
  await page.setContent(
    '<div class="pneuma-crewtools" style="width:1100px">' + html + "</div>",
  );
  await page.addStyleTag({
    content:
      fs.readFileSync(
        new URL("../src/styles/pneuma-crewtools.css", import.meta.url),
        "utf8",
      ) +
      "input{box-sizing:border-box;height:28px} body{font:14px Arial} input:disabled{opacity:.5}",
  });
  const source = ts.transpileModule(
    fs.readFileSync(
      new URL("../src/payout-absence.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await page.evaluate((source) => {
    const exports = {};
    new Function("exports", source)(exports);
    const root = document.querySelector("form"),
      main = root.querySelector('[name="groupDowntime"]');
    root.querySelector('[data-step-panel="rewards"]').hidden = false;
    root.addEventListener("input", () =>
      exports.syncAbsentDowntimeControl(root),
    );
    exports.syncAbsentDowntimeControl(root);
  }, source);
  const main = page.locator('[name="groupDowntime"]'),
    grant = page.locator('[name="grantAbsentDowntime"]'),
    absent = page.locator('[name="absentDowntime"]');
  assert.equal(await absent.isDisabled(), true);
  assert.equal(await grant.isDisabled(), true);
  await main.fill("3");
  assert.equal(await grant.isEnabled(), true);
  assert.equal(await absent.isDisabled(), true);
  await grant.check();
  assert.equal(await absent.isEnabled(), true);
  await absent.fill("5");
  const a = await absent.boundingBox(),
    m = await main.boundingBox();
  const d = await page
    .locator('[name="groupDowntimeDescription"]')
    .boundingBox();
  assert.ok(d.x >= m.x + m.width, "description follows the primary amount");
  assert.ok(Math.abs(d.y - m.y) < 5, "description shares the primary row");
  assert.ok(a.y >= m.y + m.height, "optional award is on the next row");
  await grant.uncheck();
  assert.equal(await absent.isDisabled(), true);
  await grant.check();
  await main.fill("0");
  assert.equal(await absent.isDisabled(), true);
  await main.fill("-1");
  assert.equal(await absent.isDisabled(), true);
  await main.fill("2.5");
  assert.equal(await absent.isDisabled(), true);
  await main.fill("7");
  assert.equal(await absent.isEnabled(), true);
  assert.equal(await absent.inputValue(), "5");
  assert.equal(await page.locator("[data-preview-absent-section]").count(), 1);
  console.log(
    "PASS description shares the downtime row; optional awards sit below and require opt-in plus positive whole-day awards.",
  );
} finally {
  await browser.close();
}
