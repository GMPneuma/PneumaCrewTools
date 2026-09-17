import fs from "node:fs";
import { createRequire } from "node:module";
import Handlebars from "handlebars";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
const { chromium } = createRequire(import.meta.url)("playwright");
const css = fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8");
const render = Handlebars.compile(
  fs.readFileSync("static/templates/headquarters.hbs", "utf8"),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const effects = [
    { id: "notes", name: "Notes only" },
    {
      id: "medbay",
      name: "Medbay: +2 effective BODY when healing",
      selected: true,
      benefit: true,
    },
  ];
  const data = {
    canManage: true,
    ip: 23,
    headquarters: [{ id: "hq", name: "Watson Clinic", selected: true }],
    hq: {
      name: "Watson Clinic",
      description:
        "Second floor, Watson. Shared medical supplies and crew storage.",
      improvements: [
        {
          id: "bed",
          name: "Recovery suite",
          cost: 10,
          notes: "Beds and treatment equipment.",
          effects,
          canManage: true,
        },
      ],
    },
    effects,
    hasContainer: true,
    containerName: "Clinic inventory",
    containers: [{ id: "actor", name: "Clinic inventory", selected: true }],
    rentConfigured: true,
    rentAmount: 1100,
    rentRates: [{ id: "apt", name: "Apartment", cost: 1000, selected: true }],
    rentModifiers: [{ value: 10, label: "+10%", selected: true }],
    rentBills: [
      {
        date: "02-06-2078",
        paid: 400,
        total: 1100,
        remaining: 700,
        progress: 36.36,
      },
    ],
  };
  data.catalog = [
    {
      id: "medbay",
      name: "Medbay",
      description: "Medical recovery facilities.",
      cost: 40,
      level: 2,
    },
  ];
  data.hq.image =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140"><rect width="120" height="140" fill="gray"/><path d="M20 65 L60 30 L100 65 V120 H20Z" fill="white"/></svg>',
    );
  data.hq.bedrooms = 2;
  data.hq.maxImprovements = 6;
  data.hq.improvements[0].level = 1;
  const base =
    "<style>body{font:16px Arial;background:#444}.app{width:620px;height:730px;overflow:auto;padding:10px;background:#eee}input,select,button,textarea{font:inherit;box-sizing:border-box;max-width:100%}input,select,button{height:30px}.form-group{display:flex;align-items:center;gap:8px;margin:8px 0}.form-group>label{flex:0 0 120px}.form-group>input,.form-group>select,.form-group>textarea,.form-fields{flex:1;min-width:0}.form-fields{display:flex}button{cursor:pointer}" +
    css +
    "</style>";
  await page.setContent(
    base + '<main class="app pneuma-crewtools">' + render(data) + "</main>",
  );
  assert.equal(await page.locator("form").count(), 1);
  assert.equal(await page.locator("[data-remove-improvement]").count(), 1);
  assert.equal(await page.locator('[name="rentType"]').inputValue(), "apt");
  assert.equal(
    await page.locator(".hq-image-link[data-open-container]").count(),
    1,
  );
  assert.equal(
    await page.getByText("Open Inventory", { exact: true }).count(),
    0,
  );
  assert.equal(await page.locator('[name="image"], .file-picker').count(), 0);
  assert.equal(
    await page.locator(".hq-property-actions .hq-save-properties").count(),
    1,
  );
  for (const width of [620, 480]) {
    const rentBounds = await page.locator('[name="rentType"]').boundingBox();
    const modifierBounds = await page
      .locator('[name="rentModifier"]')
      .boundingBox();
    assert.ok(Math.abs(rentBounds.y - modifierBounds.y) < 2);
    await page
      .locator(".app")
      .evaluate((el, w) => (el.style.width = w + "px"), width);
    assert.equal(
      await page
        .locator(".app")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
  }
  await page.locator(".app").evaluate((el) => (el.style.width = "620px"));
  await page.screenshot({
    path: path.join(os.tmpdir(), "crewtools-hq-preview.png"),
  });
  data.canManage = false;
  data.hq.improvements[0].canManage = false;
  await page.setContent(
    base + '<main class="app pneuma-crewtools">' + render(data) + "</main>",
  );
  assert.equal(
    await page
      .locator("[data-edit-improvement],[data-rent-save],[data-adjust-ip]")
      .count(),
    0,
  );
  assert.equal(await page.locator("[data-rent-open]").count(), 1);
  console.log(
    "PASS HQ layout, selected controls, narrow width, and GM/player visibility (mock Foundry styles).",
  );
} finally {
  await browser.close();
}
