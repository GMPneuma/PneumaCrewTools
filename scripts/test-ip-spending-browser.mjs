import fs from "node:fs";
import assert from "node:assert/strict";
import Handlebars from "handlebars";
import ts from "typescript";
const { chromium } = await import(
  process.env.PNEUMA_PLAYWRIGHT_MODULE || "playwright"
);
const template = Handlebars.compile(
  fs.readFileSync("static/templates/ip-spending.hbs", "utf8"),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 950, height: 760 } });
  await page.exposeFunction("renderTemplate", (data) => template(data));
  await page.setContent(
    '<main class="pneuma-crewtools" style="width:850px;height:660px;padding:12px"></main>',
  );
  await page.addStyleTag({
    content:
      "body{font:14px Arial;background:#ddd}*{box-sizing:border-box}button,input,select{width:100%}button:disabled{opacity:.4}" +
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8"),
  });
  for (const name of [
    "resource-lock",
    "system-resources",
    "ip-spending",
    "ip-spending-form",
  ]) {
    const code = ts.transpileModule(
      fs.readFileSync("src/" + name + ".ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    await page.evaluate(
      ({ name, code }) => {
        window.modules ??= {};
        window.modules["constants"] = { MODULE_ID: "pneuma-crewtools" };
        window.modules["foundry-form"] = {
          CrewToolsForm: class {
            static get defaultOptions() {
              return {};
            }
            activateListeners() {}
            async render() {
              document.querySelector("main").innerHTML =
                await window.renderTemplate(await this.getData());
              this.activateListeners([document.querySelector("main")]);
              return this;
            }
            async close() {
              document.querySelector("main").innerHTML = "";
            }
          },
        };
        const exports = {};
        new Function("exports", "require", code)(
          exports,
          (key) => window.modules[key.slice(2)],
        );
        window.modules[name] = exports;
      },
      { name, code },
    );
  }
  await page.evaluate(async () => {
    const actor = {
      id: "actor",
      name: "Test Character",
      system: { improvementPoints: { value: 500, transactions: [] } },
      items: [
        {
          id: "accounting",
          name: "Accounting",
          type: "skill",
          system: { level: 0, difficulty: "typical" },
        },
        {
          id: "athletics",
          name: "Athletics",
          type: "skill",
          system: { level: 2, difficulty: "typical" },
        },
        {
          id: "solo",
          name: "Solo",
          type: "role",
          system: { rank: 4, mainRoleAbility: "Combat Awareness" },
        },
      ],
      testUserPermission: () => true,
      update: async (data) => {
        window.purchase = data;
      },
    };
    window.game = { user: { id: "user" }, actors: new Map([["actor", actor]]) };
    window.ui = {
      notifications: {
        info() {},
        error(e) {
          throw Error(e);
        },
      },
    };
    window.form = new window.modules["ip-spending-form"].IpSpendingForm(actor);
    await window.form.render();
  });
  await page.locator("[data-ip-filter]").selectOption("zero");
  assert.equal(await page.locator("[data-ip-skill]:visible").count(), 1);
  await page.locator("[data-ip-search]").fill("ATH");
  assert.equal(await page.locator("[data-ip-skill]:visible").count(), 0);
  await page.locator("[data-ip-filter]").selectOption("all");
  assert.equal(await page.locator("[data-ip-skill]:visible").count(), 1);
  await page.locator("[data-ip-search]").fill("");
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-id="accounting"][data-ip-change="1"]').click();
    await page.waitForFunction(
      (n) => window.form.drafts.find((d) => d.id === "accounting").to === n,
      i + 1,
    );
  }
  await page
    .locator(".ip-spending-receipt")
    .getByText("Accounting 0 → 3")
    .waitFor();
  assert.match(await page.locator(".ip-spending-total").innerText(), /120 IP/);
  assert.equal(
    await page
      .locator('[data-id="accounting"][data-ip-change="-1"]')
      .isEnabled(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector("main").scrollWidth <= 850,
    ),
    true,
  );
  await page.screenshot({ path: "ip-spending-preview.png" });
  await page.evaluate(() => window.form._updateObject());
  assert.equal(
    await page.evaluate(
      () => window.purchase["system.improvementPoints.value"],
    ),
    380,
  );
  assert.equal(
    await page.evaluate(
      () => window.purchase["system.improvementPoints.transactions"][0][1],
    ),
    "Accounting 0 -> 3",
  );
  assert.equal(await page.locator("form").count(), 0);
  console.log(
    "IP planner browser checks passed: filters, receipt, spending, closure, layout.",
  );
} finally {
  await browser.close();
}
