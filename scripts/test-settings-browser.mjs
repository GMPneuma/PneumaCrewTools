import fs from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/settings-layout.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate((source) => {
    const exports = {};
    new Function("exports", "require", source)(exports, () => ({
      MODULE_ID: "pneuma-crewtools",
    }));
    const keys = [
      "actorExclusions",
      "payoutDataManager",
      "payoutContainerMenu",
      "payoutAcknowledgmentsEnabled",
      "campaignCalendar",
      "calendarFontColor",
      "hudIconColor",
      "hudAttentionColor",
      "multiplyAntibioticBonus",
      "techCraftingMonthDays",
      "techMultipleWithoutWorkshop",
      "discordMarkdownEnabled",
      "discordLinksMenu",
    ];
    document.body.innerHTML =
      '<nav><a data-tab="pneuma-crewtools">PneumaCrewTools <span>[13]</span></a></nav><form><section data-tab="pneuma-crewtools">' +
      keys
        .map(
          (key) =>
            '<div class="form-group"><label>' +
            key +
            '</label><input name="pneuma-crewtools.' +
            key +
            '" value="unsaved"></div>',
        )
        .join("") +
      '</section><div class="form-group" id="other"><input name="other.foo"></div></form>';
    let calls = 0;
    const input = document.querySelector(
      '[name="pneuma-crewtools.calendarFontColor"]',
    );
    input.addEventListener("change", () => calls++);
    for (let i = 0; i < 2; i++) {
      exports.labelModuleSettings(document.body);
      exports.groupModuleSettings(document.body);
    }
    input.dispatchEvent(new Event("change"));
    const groups = [
      ...document.querySelectorAll(".pneuma-settings-groups > fieldset"),
    ].map((e) => e.querySelector("legend").textContent);
    return {
      groups,
      rows: document.querySelectorAll(".pneuma-settings-groups .form-group")
        .length,
      discord: document.querySelector(
        '[data-crew-settings-group="module"] > [data-crew-settings-group="discord"] > legend',
      ).textContent,
      value: input.value,
      same:
        input ===
        document.querySelector('[name="pneuma-crewtools.calendarFontColor"]'),
      calls,
      title: document.querySelector("nav a").textContent,
      other: document.querySelector("#other").parentElement.tagName,
    };
  }, source);
  assert.deepEqual(result.groups, [
    "Module",
    "Payout",
    "HUD",
    "Downtime",
    "Crafting",
  ]);
  assert.equal(result.rows, 13);
  assert.equal(result.discord, "Discord Features");
  assert.equal(result.title, "Pneuma's Crew Tools [13]");
  assert.equal(result.value, "unsaved");
  assert.equal(result.same, true);
  assert.equal(result.calls, 1);
  assert.equal(result.other, "FORM");
  console.log(
    "PASS settings groups, nested Discord, repeated rendering, native values/listeners and category name.",
  );

  await page.addStyleTag({
    content:
      "#client-settings{font:16px Arial;width:800px} #client-settings .form-group{display:flex;flex-wrap:wrap} #client-settings .form-group>label{flex:2} #client-settings .form-group>.form-fields{display:flex;flex:3} #client-settings input{flex:1;width:100%} #client-settings input[type=checkbox]{flex:0 0 20px;width:20px;height:20px} #client-settings .notes{flex:0 0 100%;font-size:14px} fieldset{box-sizing:border-box}" +
      fs.readFileSync(
        new URL("../src/styles/pneuma-crewtools.css", import.meta.url),
        "utf8",
      ),
  });
  await page.evaluate(() => {
    document.body.innerHTML =
      '<form id="client-settings"><div class="pneuma-settings-groups"><fieldset class="pneuma-settings-group"><legend>HUD</legend><div class="form-group" id="color-row"><label>Appearance: Calendar Font Color</label><div class="form-fields"><input type="color" value="#7fffea"></div><p class="notes">Date display text color on this device.</p></div></fieldset><fieldset class="pneuma-settings-group"><legend>Crafting</legend><div class="form-group" id="month-row"><label>TECH crafting days per month</label><div class="form-fields"><input type="range" min="28" max="31" value="28"><span class="range-value">28</span></div><p class="notes">Used when starting Luxury and Super Luxury projects.</p></div><div class="form-group" id="checkbox-row"><label>Allow multiple projects even without Workshop</label><input type="checkbox"><p class="notes">Enable all three TECH project slots without an HQ Workshop.</p></div></fieldset></div></form>';
  });
  for (const width of [800, 650, 480]) {
    const measurements = await page.evaluate((width) => {
      const form = document.querySelector("form");
      form.style.width = width + "px";
      return {
        overflow: form.scrollWidth > form.clientWidth,
        swatch: document
          .querySelector('input[type="color"]')
          .getBoundingClientRect().width,
        labels: [...document.querySelectorAll(".form-group>label")].map(
          (el) => el.getBoundingClientRect().height,
        ),
      };
    }, width);
    assert.equal(measurements.overflow, false);
    assert.ok(measurements.swatch <= 60, "color swatch stays compact");
    if (width >= 650)
      assert.ok(
        measurements.labels.every((h) => h < 24),
        "labels use available width without wrapping",
      );
  }
  console.log(
    "PASS compact settings controls and label widths at 800, 650 and 480 pixels.",
  );
} finally {
  await browser.close();
}
