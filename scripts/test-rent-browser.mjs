import fs from "node:fs";
import { createRequire } from "node:module";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const css = fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8");
const render = (name, data) =>
  Handlebars.compile(
    fs.readFileSync("static/templates/" + name + ".hbs", "utf8"),
  )(data);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 1100 },
  });
  const base = `<style>body{font:16px Arial;background:#444} .app{width:580px;padding:10px;background:#eee} input,select,button{font:inherit;min-width:0;padding:5px;box-sizing:border-box} .form-group{display:flex;align-items:center;gap:8px;margin:8px 0}.form-group label{flex:0 0 110px}.form-group select{flex:1} button{cursor:pointer} ${css}</style>`;
  await page.setContent(
    base +
      `<main class="app pneuma-crewtools">` +
      render("rent", {
        hasActor: true,
        ready: true,
        isGM: true,
        residences: [
          { id: "apt", name: "Apartment · 1,000 eb", selected: true },
        ],
        hqResidences: [{ id: "hq:HQ", name: "[HQ] Home — shared rent" }],
        modifiers: [{ value: 10, label: "+10%", selected: true }],
        lifestyles: [{ id: "food", name: "Food", cost: 100, selected: true }],
        bills: [
          {
            date: "02-06-2078",
            period: "2078-02",
            rent: {
              name: "Apartment",
              formula: "1,000 eb +10% = 1,100 eb",
              amount: 1100,
            },
            lifestyle: {
              name: "Food",
              formula: "100 eb 0% = 100 eb",
              amount: 100,
            },
          },
        ],
        pending: [{ hqName: "Home", amount: 700 }],
        headquarters: [
          {
            id: "HQ",
            name: "Home",
            isGM: true,
            rates: [{ id: "apt", name: "Apartment", selected: true }],
            modifiers: [{ value: 0, label: "0%", selected: true }],
            bills: [
              {
                hqId: "HQ",
                period: "2078-02",
                date: "02-06-2078",
                formula: "1,000 eb 0% = 1,000 eb",
                paid: 0,
                remaining: 1000,
              },
            ],
          },
        ],
      }) +
      `</main>`,
  );
  assert.equal(await page.locator("form").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "Pay 1100 eb" }).count(),
    1,
  );
  assert.equal(
    await page
      .locator('[data-rent-action="contribute"]')
      .getAttribute("data-hq"),
    "HQ",
  );
  assert.equal(await page.locator('[data-rent-action="hqSetup"]').count(), 1);
  const fits = await page
    .locator(".app")
    .evaluate((el) => el.scrollWidth <= el.clientWidth);
  assert.ok(fits, "Rent form fits without horizontal scrolling");
  const residence = await page.locator('[name="residence"]').boundingBox();
  const lifestyle = await page.locator('[name="lifestyle"]').boundingBox();
  assert.ok(
    Math.abs(residence.x - lifestyle.x) < 2 &&
      Math.abs(residence.width - lifestyle.width) < 2,
    "dropdown columns align",
  );
  assert.match(
    await page
      .locator('[name="residence"] optgroup')
      .last()
      .getAttribute("label"),
    /HEADQUARTERS/,
  );
  const save = await page
    .locator('[data-rent-action="residence"]')
    .boundingBox();
  const note = await page.locator(".rent-save-row .notes").boundingBox();
  assert.ok(
    note.x >= save.x + save.width,
    "save explanation sits beside the button",
  );
  await page.screenshot({ path: "rent-preview.png", fullPage: true });
  await page.setContent(
    base +
      `<main class="app pneuma-crewtools">` +
      render("payout-inbox", {
        status: {
          money: "4,300",
          downtime: 3,
          ip: 10,
          reputation: 2,
          hasActor: true,
          actorName: "V",
        },
        rent: { pending: 700, due: true },
      }) +
      `</main>`,
  );
  const pending = page.getByText("Rent Payment Processing: 700 eb", {
    exact: true,
  });
  assert.equal(await pending.count(), 1);
  assert.match(
    await pending
      .locator("xpath=ancestor::dd/preceding-sibling::dt")
      .innerText(),
    /^Money\b/,
  );
  console.log(
    "PASS rent layout, separate payment buttons, HQ routing and pending payment below Money (mock Foundry styles).",
  );
} finally {
  await browser.close();
}
