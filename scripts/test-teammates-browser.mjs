import fs from "node:fs";
import { createRequire } from "node:module";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const render = Handlebars.compile(
  fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
);
const css = fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8");
const data = {
  status: {
    hasActor: true,
    actors: [{ id: "exec", name: "Executive", selected: true }],
    downtime: "12",
    money: "4,000",
    ip: "100",
    reputation: "4",
  },
  rent: { residence: "Studio Apartment", lifestyle: "Good Prepak" },
  teammates: {
    visible: true,
    slots: [
      {
        index: 0,
        number: 1,
        occupied: true,
        name: "Bodyguard",
        loyalty: 4,
        canOpen: true,
      },
      {
        index: 1,
        number: 2,
        occupied: true,
        name: "Alexandria Long Teammate Name",
        loyalty: 6,
        canOpen: true,
      },
      { index: 2, number: 3, occupied: false },
    ],
  },
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1050, height: 900 },
  });
  await page.setContent(
    "<style>body{font:14px Arial;background:#373b3e}.window-app{width:650px;margin:20px;background:#ddd;color:#222;border:1px solid #777;border-radius:4px}header{padding:8px;background:#272727;color:white}button,input,select{font:inherit}button{padding:5px;border:1px solid #999;border-radius:3px;background:#eee;color:inherit}button:disabled{opacity:.5}fieldset{min-width:0}h2{font-size:18px}" +
      css +
      '</style><div class="window-app pneuma-crewtools"><header>Crew Tools Player Hub</header><div class="window-content">' +
      render(data) +
      "</div></div>",
  );
  assert.equal(await page.locator(".hub-teammate-slot").count(), 3);
  assert.equal(
    await page.getByRole("button", { name: "Roll Loyalty Check" }).count(),
    2,
  );
  const slots = await page.locator(".hub-teammate-slot").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return {
        top: r.top,
        width: r.width,
        client: n.clientWidth,
        scroll: n.scrollWidth,
      };
    }),
  );
  assert.ok(
    slots.every(
      (s) =>
        s.top === slots[0].top &&
        Math.abs(s.width - slots[0].width) < 1 &&
        s.scroll <= s.client,
    ),
  );
  await page.screenshot({
    path: process.env.TEMP + "/crew-teammates-preview.png",
    fullPage: true,
  });
  console.log(
    "Three aligned slots, no horizontal overflow, two Loyalty roll buttons.",
  );
} finally {
  await browser.close();
}
