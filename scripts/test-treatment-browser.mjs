import fs from "node:fs";
import assert from "node:assert/strict";
import Handlebars from "handlebars";
import ts from "typescript";
const { chromium } = await import(
  process.env.PNEUMA_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 900 },
  });
  const hub = Handlebars.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  )({
    status: { hasActor: true, actorName: "Healer", actorId: "healer" },
  });
  await page.setContent(
    '<main class="pneuma-crewtools" style="width:650px">' + hub + "</main>",
  );
  await page.addStyleTag({
    content:
      "body{font:14px Arial;background:#bbb}button,input,select{font:inherit;padding:4px}.window-app{padding:8px;background:#ddd}button:disabled{opacity:.45}" +
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8"),
  });
  const coords = await page.evaluate(() => {
    const box = (selector) => {
      const b = document.querySelector(selector).getBoundingClientRect();
      return { x: b.x, y: b.y, bottom: b.bottom };
    };
    return {
      downtime: box("[data-hub-downtime]"),
      treatment: box("[data-hub-treatment]"),
      hq: box("[data-hub-headquarters]"),
      ip: box("[data-hub-spend-ip]"),
      color: getComputedStyle(document.querySelector("[data-hub-treatment] i"))
        .color,
    };
  });
  assert.equal(coords.downtime.x, coords.treatment.x);
  assert.ok(coords.treatment.y >= coords.downtime.bottom);
  assert.equal(coords.hq.x, coords.ip.x);
  assert.ok(coords.ip.y >= coords.hq.bottom);
  assert.equal(coords.color, "rgb(194, 25, 44)");
  await page.evaluate(() => {
    window.messages = [];
    window.rolls = [];
    const roll = {
      resultTotal: 20,
      luck: 0,
      rollCard: "native.hbs",
      wasCritical: () => false,
      handleRollDialog: async () => true,
      roll: async () => window.rolls.push("rolled"),
    };
    const item = (name, type = "skill", system = {}) => ({
      name,
      type,
      system,
      createRoll: (type, actor, options) => {
        window.rolls.push({ type, actor: actor.id, options });
        return roll;
      },
      confirmRoll: async (roll) => roll,
    });
    const actor = {
      id: "healer",
      name: "Healer",
      type: "character",
      testUserPermission: () => true,
      system: {},
      items: [
        item("First Aid"),
        item("Paramedic"),
        item("Medtech", "role", {
          rank: 4,
          abilities: [{ name: "Surgery Skill", hasRoll: true }],
        }),
      ],
    };
    const injuries = [
      {
        name: "Broken Arm",
        type: "criticalInjury",
        system: {
          quickFix: { dvParamedic: 13 },
          treatment: { dvParamedic: 15, dvSurgery: 13 },
        },
      },
      {
        name: "Foreign Object",
        type: "criticalInjury",
        system: {
          quickFix: { dvFirstAid: 13, dvParamedic: 13 },
          treatment: { type: "quickFix" },
        },
      },
    ];
    window.game = {
      user: { id: "player", isGM: false },
      actors: new Map([["healer", actor]]),
      packs: ["body", "head"].map((location) => ({
        collection: "cyberpunk-red-core.core_critical-injuries-" + location,
        getDocuments: async () => injuries,
      })),
      settings: { get: () => "publicroll" },
    };
    window.ui = {
      notifications: {
        error: (error) => {
          window.error = error;
        },
      },
    };
    window.ChatMessage = {
      applyRollMode() {},
      create: async (data) => window.messages.push(data),
    };
    window.renderTemplate = async () =>
      '<div class="rollcard"><div class="rollcard-top">Native roll</div></div>';
    window.Dialog = class {
      constructor(config, options) {
        this.config = config;
        this.options = options;
      }
      render() {
        document.querySelector("main").remove();
        const root = document.createElement("div");
        root.className = this.options.classes.join(" ") + " window-app";
        root.style.width = this.options.width + "px";
        root.innerHTML = this.config.content;
        document.body.append(root);
        this.config.render([root]);
      }
    };
    window.modules = { constants: { MODULE_ID: "pneuma-crewtools" } };
  });
  for (const name of ["journal-format", "medtech-system", "treatment"]) {
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
  await page.evaluate(() => window.modules.treatment.openTreatment("healer"));
  const note = page.locator(".pneuma-treatment-note");
  assert.equal(await note.isVisible(), true);
  assert.equal(
    await note.innerText(),
    "This roll is for record-keeping only. The patient must remove their own status effects.",
  );
  const noteBox = await note.boundingBox();
  const patientBox = await page
    .locator(".pneuma-treatment-patient-picker")
    .boundingBox();
  assert.ok(
    noteBox.y + noteBox.height <= patientBox.y,
    "instruction appears above the patient picker",
  );
  assert.equal(await page.locator(".pneuma-stabilize-table button").count(), 6);
  const body = page.locator('[data-treatment-location="body"]');
  assert.equal(
    await body.locator('[data-treatment-skill="First Aid"]').isDisabled(),
    true,
  );
  assert.equal(
    await body
      .locator(
        '[data-treatment-stage="Treatment"][data-treatment-skill="Paramedic"]',
      )
      .innerText(),
    "Paramedic DV15",
  );
  assert.equal(
    await body.locator('[data-treatment-skill="Surgery"]').innerText(),
    "Surgery DV13",
  );
  await page.locator("[data-treatment-patient]").selectOption("custom");
  await page.locator("[data-treatment-patient-name]").fill("Offline patient");
  await body.locator('[data-treatment-skill="Surgery"]').click();
  await page.waitForFunction(() => window.messages.length === 1);
  assert.equal(await page.evaluate(() => window.rolls[0].type), "roleAbility");
  assert.match(
    await page.evaluate(() => window.messages[0].content),
    /Offline patient/,
  );
  await body.locator("select").selectOption("1");
  assert.equal(
    await body
      .locator(
        '[data-treatment-stage="QuickFix"][data-treatment-skill="First Aid"]',
      )
      .isEnabled(),
    true,
  );
  assert.equal(
    await body
      .locator(
        '[data-treatment-stage="Treatment"][data-treatment-skill="Paramedic"]',
      )
      .isDisabled(),
    true,
  );
  assert.equal(
    await body.locator('[data-treatment-skill="Surgery"]').isDisabled(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector(".crewtools-treatment").scrollWidth <= 736,
    ),
    true,
  );
  assert.equal(await page.evaluate(() => window.error), undefined);
  if (process.env.TREATMENT_SCREENSHOT) {
    await body.locator("select").selectOption("0");
    await page
      .locator(".crewtools-treatment")
      .screenshot({ path: process.env.TREATMENT_SCREENSHOT });
  }
  console.log(
    "Treatment browser checks passed: button positions/red cross, native Surgery roll, custom patient, both skill DVs, QuickFix-only cure, layout.",
  );
} finally {
  await browser.close();
}
