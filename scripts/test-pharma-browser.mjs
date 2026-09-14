import fs from "node:fs";
import { createRequire } from "node:module";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
Handlebars.registerHelper("ifThen", (value, yes, no) => (value ? yes : no));
const html = Handlebars.compile(
  fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
)({
  status: { isMedtech: true, actorName: "Medtech", hasActor: true, actors: [] },
  pharma: {
    actorName: "Medtech",
    recipients: [{ id: "r", name: "Patient", selected: true }],
    pharma: [
      { id: "a", name: "Antibiotic", amount: 4 },
      { id: "s", name: "Speedheal", amount: 0 },
    ],
  },
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(
    '<div class="pneuma-crewtools" style="width:540px">' + html + "</div>",
  );
  await page.addStyleTag({
    content:
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8") +
      "body{font:14px Arial}select,input,button{font:inherit} table{width:100%}",
  });
  assert.equal(await page.locator('[name="recipientId"]').inputValue(), "r");
  assert.equal(
    await page.locator('[data-transfer-pharma="a"]').isEnabled(),
    true,
  );
  assert.equal(
    await page.locator('[data-transfer-pharma="s"]').isDisabled(),
    true,
  );
  assert.equal(await page.locator('[name^="quantity."]').count(), 0);
  assert.equal(await page.locator("form").count(), 1);
  assert.equal(await page.locator("[data-hub-pharma-panel]").count(), 1);
  assert.equal(await page.locator("[data-hub-pharma]").count(), 0);
  const layout = await page.evaluate(() => {
    const recipient = document
      .querySelector(".hub-pharma-recipient")
      .getBoundingClientRect();
    const select = document
      .querySelector(".hub-pharma-recipient select")
      .getBoundingClientRect();
    const list = document
      .querySelector(".hub-pharma-list")
      .getBoundingClientRect();
    const button = document
      .querySelector("[data-transfer-pharma]")
      .getBoundingClientRect();
    return {
      beside: list.left >= recipient.right,
      labelAbove: select.top > recipient.top,
      compact: button.width < 120 && button.height <= 32,
    };
  });
  assert.deepEqual(layout, { beside: true, labelAbove: true, compact: true });
  console.log(
    "PASS pharma recipient selection, single-dose controls, and empty-stock button",
  );
} finally {
  await browser.close();
}
