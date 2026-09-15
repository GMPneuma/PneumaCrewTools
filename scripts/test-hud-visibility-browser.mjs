import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const source = ts.transpileModule(fs.readFileSync("src/calendar.ts", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const initiallyHidden of [false, true]) {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="ui-top"><a id="logo" data-original="yes">Foundry</a><span id="native-neighbor">Native controls</span></div>',
    );
    const result = await page.evaluate(
      ({ source, initiallyHidden }) => {
        let hidden = initiallyHidden,
          setting,
          clicks = 0,
          refreshes = 0;
        const original = document.getElementById("logo");
        original.addEventListener("click", () => clicks++);
        const hooks = {};
        const game = {
          time: { worldTime: 0 },
          settings: {
            get: () => hidden,
            register: (ns, key, value) => (setting = value),
          },
        };
        const deps = {
          "./constants": { MODULE_ID: "pneuma-crewtools" },
          "./action-coordinator": { isPrimaryGM: () => false },
          "./foundry-form": { CrewToolsForm: class {} },
          "./calendar-date": {
            shimDate: () => "2045-01-01",
            parseDate: (v) => new Date(v + "T00:00:00Z"),
          },
        };
        const exports = {};
        new Function("exports", "require", "game", "Hooks", source)(
          exports,
          (p) => deps[p],
          game,
          { on: (key, fn) => (hooks[key] = fn) },
        );
        exports.registerCampaignCalendar(() => refreshes++);
        exports.readyCampaignCalendar();
        if (
          !!document.getElementById("pneuma-crewtools-calendar") ===
          initiallyHidden
        )
          throw Error("Wrong initial visibility");
        for (let i = 0; i < 3; i++) {
          hidden = true;
          setting.onChange();
          hooks.updateWorldTime();
          if (
            document.getElementById("pneuma-crewtools-calendar") ||
            document.getElementById("logo") !== original
          )
            throw Error("Native logo not restored");
          original.click();
          if (original.nextElementSibling.id !== "native-neighbor")
            throw Error("Native placement changed");
          hidden = false;
          setting.onChange();
          if (
            document.querySelectorAll("#pneuma-crewtools-calendar").length !==
              1 ||
            document.getElementById("logo")
          )
            throw Error("HUD not restored cleanly");
        }
        return {
          scope: setting.scope,
          defaultValue: setting.default,
          clicks,
          refreshes,
        };
      },
      { source, initiallyHidden },
    );
    assert.deepEqual(result, {
      scope: "client",
      defaultValue: false,
      clicks: 3,
      refreshes: 6,
    });
    await page.close();
  }
  console.log(
    "HUD visibility: client setting, initial hidden state, repeated toggles, original logo identity/handlers/position and hidden clock refreshes pass.",
  );
} finally {
  await browser.close();
}
