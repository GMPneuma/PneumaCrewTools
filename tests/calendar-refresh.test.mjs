import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
test("calendar ignores unrelated hooks and leaves unchanged dates untouched", () => {
  const exports = {},
    hooks = {};
  let writes = 0;
  const line = {
    set textContent(value) {
      writes++;
    },
  };
  const label = { querySelector: () => line, setAttribute() {} };
  const root = { dataset: {}, querySelector: () => label };
  const game = {
    time: { worldTime: 0 },
    settings: { get: () => false, register() {} },
  };
  const deps = {
    "./action-coordinator": { isPrimaryGM: () => true },
    "./foundry-form": { CrewToolsForm: class {} },
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./calendar-date": {
      DAY_SECONDS: 86400,
      shimDate: (time) => (time < 86400 ? "2078-02-06" : "2078-02-07"),
      parseDate: (value) => new Date(value + "T00:00:00Z"),
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("../src/calendar.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      require: (key) => deps[key],
      game,
      Hooks: { on: (name, fn) => (hooks[name] = fn) },
      document: { getElementById: () => root },
    },
  );
  exports.registerCampaignCalendar();
  assert.deepEqual(Object.keys(hooks), ["updateWorldTime"]);
  exports.readyCampaignCalendar();
  assert.equal(writes, 2);
  game.time.worldTime = 6;
  hooks.updateWorldTime();
  assert.equal(writes, 2);
  game.time.worldTime = 86400;
  hooks.updateWorldTime();
  assert.equal(writes, 4);
});
