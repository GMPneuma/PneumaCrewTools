import fs from "node:fs";
import { createRequire } from "node:module";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const render = Handlebars.compile(
  fs.readFileSync("static/templates/downtime.hbs", "utf8"),
);
const css = fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8");
const base = {
  ready: true,
  hasActor: true,
  actorId: "hero",
  balance: 8,
  hasRoleAreas: true,
  canCraft: true,
  workshop: 1,
  canWorkshopDay: true,
  canHustle: true,
  hustleDays: 2,
  hustleDaysNeeded: 5,
  roles: [{ id: "tech", name: "Tech", rank: 4 }],
  healing: { restored: 10 },
  techSlots: [0, 1, 2].map((slot) => ({
    slot,
    number: slot + 1,
    enabled: slot < 2,
    canCraft: true,
    workshop: 1,
    project:
      slot < 2
        ? {
            id: "p" + slot,
            name: slot === 0 ? "Armor Repair" : "New Gadget",
            mode: slot === 0 ? "repair" : "invention",
            progress: 2,
            required: 7,
            dv: 21,
          }
        : null,
    canAdd: true,
    canRoll: false,
    progressPercent: 29,
  })),
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1000 },
  });
  const show = async (data) =>
    page.setContent(
      "<style>body{font:14px Arial;background:#333} .window-app{width:640px;margin:20px;background:#eee;color:#222;border:1px solid #888}button,input,select,textarea{font:inherit}button{padding:5px;border:1px solid #999;background:#eee}button:disabled{opacity:.5}fieldset{min-width:0}" +
        css +
        '</style><div class="window-app pneuma-crewtools"><div class="window-content">' +
        render(data) +
        "</div></div>",
    );
  await show(base);
  assert.equal(await page.locator('[data-tech-action="techDay"]').count(), 0);
  assert.equal(await page.locator("details[open]").count(), 0);
  assert.equal(await page.locator(".downtime-hustle").isVisible(), true);
  assert.equal(await page.locator(".downtime-hustle summary").count(), 0);
  // Match Foundry's flex window and verify growth beyond the shared 65vh cap.
  await page.locator(".window-app").evaluate((el) => {
    el.id = "pneuma-crewtools-downtime";
    el.style.cssText =
      "display:flex;flex-direction:column;height:500px;width:640px";
    el.querySelector(".window-content").style.cssText =
      "display:flex;flex:1;min-height:0;flex-direction:column";
  });
  const shortHeight = await page
    .locator(".downtime-stack")
    .evaluate((el) => el.clientHeight);
  await page.locator(".window-app").evaluate((el) => {
    el.style.height = "850px";
  });
  const tallHeight = await page
    .locator(".downtime-stack")
    .evaluate((el) => el.clientHeight);
  assert.ok(
    tallHeight - shortHeight >= 340,
    `Scroll area grew ${tallHeight - shortHeight}px`,
  );
  await page.locator('[data-downtime-section="tech"] > summary').click();
  assert.equal(
    await page
      .locator('[data-downtime-section="tech"]')
      .evaluate((el) => el.open),
    true,
  );
  assert.equal(await page.locator(".downtime-heal").isVisible(), true);
  assert.equal(await page.locator(".downtime-balance").isVisible(), true);
  await page.screenshot({
    path: process.env.TEMP + "/crew-repair-preview.png",
    fullPage: true,
  });
  await show({
    ...base,
    canCraft: false,
    workshop: 0,
    techSlots: [
      { slot: 0, number: 1, enabled: true, canCraft: false, workshop: 0 },
    ],
  });
  assert.equal(await page.locator("[data-tech-slot]").count(), 1);
  assert.equal(await page.locator("[data-tech-mode]").count(), 0);
  assert.equal(await page.getByText("Repair Gear", { exact: true }).count(), 1);
  await show({
    ...base,
    workshop: 0,
    techSlots: [{ ...base.techSlots[0], workshop: 0 }],
  });
  assert.equal(await page.locator('[data-tech-action="techDay"]').count(), 1);
  console.log(
    "PASS collapsed defaults, always-visible Hustle/healing/balance, vertical resize, Workshop replaces project day buttons, and one repair slot for non-TECHs.",
  );
} finally {
  await browser.close();
}
