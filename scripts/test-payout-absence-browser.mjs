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
    window.populateTimeDowntime = () => exports.populateTimeDowntime(root);
    exports.syncAbsentDowntimeControl(root);
  }, source);
  const main = page.locator('[name="groupDowntime"]'),
    grant = page.locator('[name="grantAbsentDowntime"]'),
    absent = page.locator('[name="absentDowntime"]');
  assert.equal(await absent.isDisabled(), true);
  assert.equal(await grant.isEnabled(), true);
  await main.fill("0");
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
  const time = await page.locator(".payout-time-section").boundingBox();
  assert.ok(
    a.y >= time.y && a.y + a.height <= time.y + time.height,
    "nonparticipant award belongs to GameTime & Downtime",
  );
  await grant.uncheck();
  assert.equal(await absent.isDisabled(), true);
  await grant.check();
  await main.fill("0");
  assert.equal(await absent.isEnabled(), true);
  await main.fill("-1");
  assert.equal(await absent.isEnabled(), true);
  await main.fill("2.5");
  assert.equal(await absent.isEnabled(), true);
  await main.fill("7");
  assert.equal(await absent.isEnabled(), true);
  assert.equal(await absent.inputValue(), "5");
  assert.equal(await page.locator("[data-preview-absent-section]").count(), 1);
  await page.locator('[name="advanceDays"]').fill("1");
  await page.evaluate(() => populateTimeDowntime());
  assert.equal(await main.inputValue(), "0");
  assert.equal(await absent.inputValue(), "1");
  assert.equal(await absent.isEnabled(), true);
  await grant.uncheck();
  assert.equal(await absent.isDisabled(), true);
  console.log(
    "PASS primary description shares the rewards row; nonparticipant controls are in GameTime & Downtime and require opt-in independently of primary downtime; one-day advancement defaults to 0 primary and 1 absent day.",
  );
} finally {
  await browser.close();
}
