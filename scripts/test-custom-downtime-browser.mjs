import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const code = ts.transpileModule(
  fs.readFileSync("src/downtime-form.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const resultModules = Object.fromEntries(
  ["custom-result-view", "custom-downtime-model"].map((name) => [
    name,
    ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ]),
);
const template = fs.readFileSync("static/templates/downtime.hbs", "utf8");
const settingsTemplate = fs.readFileSync(
  "static/templates/custom-downtime-settings.hbs",
  "utf8",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 1000 },
  });
  await page.setContent(
    '<main class="pneuma-crewtools" style="width:640px;margin:auto"></main>',
  );
  await page.addScriptTag({
    path: require.resolve("handlebars/dist/handlebars.js"),
  });
  await page.addStyleTag({
    content:
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8") +
      "body{font:14px Arial}button{font:inherit}",
  });
  await page.evaluate(
    ({ code, template, resultModules }) => {
      window.calls = [];
      window.Dialog = class {
        constructor(config) {
          this.config = config;
        }
        render() {
          const modal = document.createElement("aside");
          modal.innerHTML = this.config.content;
          document.body.append(modal);
          this.config.render?.([modal]);
        }
      };
      class Base {
        activateListeners() {}
        render() {
          return this;
        }
      }
      const common = {
        CrewToolsForm: Base,
        defaultHealingOptions: () => ({}),
        bindNomadVehicles: () => {},
        MODULE_ID: "pneuma-crewtools",
        escape: (value) =>
          String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;"),
        getDowntime: () => ({
          events: [
            {
              custom: {
                cycle: "r",
                definition: { name: "Research" },
                result: {
                  tableTotal: 4,
                  text:
                    "A long result.\n".repeat(150) + "<script>unsafe</script>",
                  applied: true,
                  rewards: [],
                },
              },
            },
          ],
        }),
        report: (error) => {
          throw error;
        },
        CustomDowntimeSettings: class {
          render() {
            calls.push(["manage"]);
          }
        },
        startCustomActivity: async (...args) => calls.push(["start", ...args]),
        spendCustomActivity: async (...args) => calls.push(["spend", ...args]),
        rollCustomActivity: async (...args) => calls.push(["roll", ...args]),
      };
      const modules = {};
      const loadResult = (name) => {
        if (name === "./journal-format") return { recordEscape: common.escape };
        if (modules[name]) return modules[name];
        const output = (modules[name] = {});
        new Function(
          "exports",
          "require",
          resultModules[name.replace("./", "")],
        )(output, loadResult);
        return output;
      };
      common.customResultHtml = loadResult(
        "./custom-result-view",
      ).customResultHtml;
      const exports = {};
      new Function("exports", "require", code)(exports, () => common);
      document.querySelector("main").innerHTML = Handlebars.compile(template)({
        customLatestResult: "Latest result should be hidden",
        hasActor: true,
        ready: true,
        actorId: "a",
        isGM: true,
        customChoices: [
          {
            id: "simple",
            name: "Walk the neighborhood",
            tracked: false,
            canUse: true,
          },
          { id: "new", name: "New project", tracked: true, canUse: true },
        ],
        customActivities: [
          {
            id: "tracked",
            name: "Research",
            cycle: "c",
            tracked: true,
            required: 3,
            progress: 1,
            remaining: 2,
            canSpend: true,
          },
          {
            id: "done",
            name: "Completed task",
            cycle: "r",
            tracked: true,
            required: 2,
            progress: 2,
            canRoll: true,
          },
        ],
      });
      const form = new exports.DowntimeForm();
      form.activateListeners([document.querySelector("main")]);
      document.querySelector('[data-downtime-section="other"]').open = true;
    },
    { code, template, resultModules },
  );
  assert.equal(await page.locator("[data-custom-freeform]").isVisible(), false);
  await page.locator("[data-custom-choice]").selectOption("freeform");
  assert.equal(await page.locator("[data-custom-freeform]").isVisible(), true);
  assert.equal(await page.locator('input[name="reason"]').isEnabled(), true);
  await page.locator('input[name="reason"]').fill("Visit a friend");
  await page.locator("[data-custom-choice]").selectOption("simple");
  assert.equal(await page.locator("[data-custom-freeform]").isVisible(), false);
  assert.equal(await page.locator('input[name="reason"]').isEnabled(), false);
  assert.equal(
    await page.locator("[data-custom-use]").textContent(),
    "Use 1 Day",
  );
  await page.locator("[data-custom-use]").click();
  await page.locator("[data-custom-choice]").selectOption("new");
  assert.equal(
    await page.locator("[data-custom-use]").textContent(),
    "Start Activity",
  );
  await page.locator("[data-custom-use]").click();
  await page.locator('[data-custom-activity="tracked"] input').fill("2");
  await page
    .locator('[data-custom-activity="tracked"] [data-custom-spend]')
    .click();
  await page.locator("[data-custom-roll]").click();
  assert.equal(
    await page.locator(".custom-activity-result-text").isVisible(),
    true,
  );
  assert.equal(
    await page
      .locator(".custom-activity-result-text")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
  );
  assert.equal(await page.locator(".custom-activity-result script").count(), 0);
  assert.equal(
    await page
      .locator("main")
      .getByText("Latest result should be hidden")
      .count(),
    0,
  );
  assert.equal(await page.locator("[data-manage-custom]").count(), 0);
  assert.deepEqual(await page.evaluate(() => calls), [
    ["spend", "a", "simple", "", 1],
    ["start", "a", "new"],
    ["spend", "a", "tracked", "c", 2],
    ["roll", "a", "r", { deferDice: true }],
  ]);
  assert.equal(
    await page
      .locator('[data-custom-activity="done"] [data-custom-spend]')
      .count(),
    0,
  );
  assert.equal(await page.locator('input[name="reason"]').count(), 1);
  await page.evaluate((template) => {
    document.querySelector("main").innerHTML = Handlebars.compile(template)({
      activities: [
        {
          id: "d",
          name: "Research",
          days: 3,
          tables: [{ id: "t", name: "Research Results", selected: true }],
        },
      ],
      tables: [{ id: "t", name: "Research Results" }],
    });
  }, settingsTemplate);
  assert.equal(await page.locator('select[name="table.d"]').inputValue(), "t");
  assert.equal(await page.locator("[data-activity-add]").count(), 1);
  assert.equal(
    await page
      .locator("main")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  assert.equal(await page.locator(".activity-payouts tbody tr").count(), 4);
  if (process.env.CREW_SETTINGS_SCREENSHOT) {
    await page.screenshot({
      path: process.env.CREW_SETTINGS_SCREENSHOT,
      fullPage: true,
    });
  }
  console.log(
    "Custom activity UI: one-day, progress, completion roll, settings selection and free-form fallback pass.",
  );
} finally {
  await browser.close();
}
