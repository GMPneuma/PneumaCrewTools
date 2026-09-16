import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const Handlebars = require("handlebars");
const template = fs.readFileSync("static/templates/headquarters.hbs", "utf8");
const source = fs.readFileSync("src/headquarters.ts", "utf8");
const start =
  source.indexOf(
    'content: `<div class="pneuma-crewtools"><div class="hq-access-dialog">',
  ) + "content: ".length;
const end = source.indexOf("`,", start) + 1;
const content = new Function(
  "access",
  "esc",
  "return " + source.slice(start, end),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main class="pneuma-crewtools"></main>');
  await page.addStyleTag({
    content:
      "body{font:14px Arial}*{box-sizing:border-box}button,input,select{width:100%}fieldset{min-width:0}" +
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8"),
  });
  for (const width of [720, 360]) {
    await page.locator("main").evaluate(
      (el, { width, html }) => {
        el.style.width = width + "px";
        el.innerHTML = html;
      },
      {
        width,
        html: Handlebars.compile(template)({
          canManage: true,
          hasContainer: true,
          hq: { id: "hq", name: "HQ" },
          accessSummary: "Everyone",
        }),
      },
    );
    assert.equal(
      await page
        .locator(".hq-property-actions")
        .evaluate((el) =>
          [...el.querySelectorAll("button")].every(
            (b) =>
              b.getBoundingClientRect().left >=
                el.getBoundingClientRect().left &&
              b.getBoundingClientRect().right <=
                el.getBoundingClientRect().right + 1,
          ),
        ),
      true,
    );
    assert.equal(
      await page
        .locator(".hq-save-properties")
        .evaluate((el) => el.getBoundingClientRect().width < 200),
      true,
    );
  }
  for (const everyone of [true, false]) {
    const html = content(
      {
        everyone,
        players: Array.from({ length: 25 }, (_, i) => ({
          id: String(i),
          name: "Player with a long username " + i,
          selected: true,
        })),
      },
      (v) => String(v),
    );
    await page.locator("main").evaluate((el, html) => {
      el.style.width = "400px";
      el.innerHTML = html;
    }, html);
    assert.equal(
      await page.locator("[data-access-players]").isVisible(),
      !everyone,
    );
    assert.equal(
      await page
        .locator(".hq-access-dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    assert.equal(
      await page
        .locator('input[type="radio"]')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width),
      16,
    );
    if (!everyone)
      assert.equal(
        await page
          .locator("[data-access-players]")
          .evaluate((el) => el.scrollHeight > el.clientHeight),
        true,
      );
  }
  console.log(
    "HQ layout checks passed: contained Save/Delete, compact inputs, hidden/scrolling player list.",
  );
} finally {
  await browser.close();
}
