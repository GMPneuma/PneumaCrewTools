import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture({ enabled = true, active = true, available = true } = {}) {
  const hooks = {},
    registrations = {},
    dialogs = [],
    errors = [],
    writes = [];
  let failSetting = false;
  const date = { year: 2045, month: 0, day: 0 };
  const game = {
    user: { isGM: true },
    modules: new Map([["foundryvtt-simple-calendar", { active }]]),
    time: {
      worldTime: 0,
      async advance(delta) {
        writes.push(delta);
        this.worldTime += delta;
      },
    },
    settings: {
      get: (_ns, key) => (key === "useSimpleCalendar" ? enabled : false),
      register: (_ns, key, data) => {
        registrations[key] = data;
      },
      async set(_ns, key, value) {
        if (
          hooks.preUpdateSetting(
            { key: "pneuma-crewtools." + key },
            { value: JSON.stringify(value) },
          ) === false
        )
          return;
        if (failSetting) throw Error("setting write failed");
        enabled = value;
        registrations[key].onChange();
      },
    },
  };
  function load(name, deps = {}) {
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync(
          new URL("../src/" + name + ".ts", import.meta.url),
          "utf8",
        ),
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
        console,
        Hooks: {
          on: (key, fn) => {
            hooks[key] = fn;
          },
        },
        SimpleCalendar: available
          ? { api: { currentDateTime: () => date } }
          : undefined,
        Dialog: class {
          constructor(config) {
            dialogs.push(config);
          }
          render() {}
        },
        document: { querySelectorAll: () => [] },
        ui: { notifications: { error: (message) => errors.push(message) } },
      },
    );
    return exports;
  }
  const api = load("calendar", {
    "./calendar-date": load("calendar-date"),
    "./action-coordinator": { isPrimaryGM: () => true },
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./foundry-form": { CrewToolsForm: class {} },
  });
  api.registerCampaignCalendar();
  return {
    api,
    game,
    hooks,
    registrations,
    dialogs,
    errors,
    writes,
    date,
    failSetting: () => {
      failSetting = true;
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("Simple Calendar supplies its own date, regardless of world epoch, without clock writes", async () => {
  const f = fixture();
  assert.equal(f.api.getCampaignDate(), "2045-01-01");
  f.game.time.worldTime = 123456;
  assert.equal(f.api.getCampaignDate(), "2045-01-01");
  f.date.month = 8;
  f.date.day = 15;
  f.hooks["simple-calendar-date-time-change"]();
  assert.equal(f.api.getCampaignDate(), "2045-09-16");
  assert.equal(new f.api.CampaignCalendarForm().getData().readOnly, true);
  await assert.rejects(f.api.setCampaignDate("2045-01-01"), /Simple Calendar/);
  await assert.rejects(f.api.advanceCampaignDays(1), /Simple Calendar/);
  assert.equal(f.writes.length, 0);
});
test("unavailable or disabled Simple Calendar never silently falls back", () => {
  for (const options of [{ active: false }, { available: false }]) {
    const f = fixture(options);
    assert.throws(() => f.api.getCampaignDate(), /unavailable/);
    assert.match(f.api.calendarStatus(), /unavailable/);
    assert.equal(
      new f.api.CampaignCalendarForm().getData().currentDate,
      "Unavailable",
    );
  }
  const f = fixture({ enabled: false });
  assert.equal(f.api.getCampaignDate(), "1970-01-01");
  assert.equal(f.registrations.useSimpleCalendar.default, false);
});
test("switch cancellation preserves source and time; confirmation sets the new date", async () => {
  const f = fixture();
  await f.game.settings.set("pneuma-crewtools", "useSimpleCalendar", false);
  assert.equal(f.api.usesSimpleCalendar(), true);
  assert.equal(f.writes.length, 0);
  f.dialogs[0].close();
  assert.equal(f.api.usesSimpleCalendar(), true);
  await f.game.settings.set("pneuma-crewtools", "useSimpleCalendar", false);
  const dialog = f.dialogs[1];
  dialog.buttons.switch.callback({
    0: { querySelector: () => ({ value: "2045-09-16" }) },
  });
  dialog.close();
  await settle();
  assert.equal(f.api.usesSimpleCalendar(), false);
  assert.equal(f.api.getCampaignDate(), "2045-09-16");
  assert.equal(f.writes.length, 1);
  assert.equal(f.errors.length, 0);
});
test("invalid switch dates and failed setting writes keep Simple Calendar enabled", async () => {
  for (const fail of [false, true]) {
    const f = fixture({ active: false });
    if (fail) f.failSetting();
    await f.game.settings.set("pneuma-crewtools", "useSimpleCalendar", false);
    const dialog = f.dialogs[0];
    dialog.buttons.switch.callback({
      0: {
        querySelector: () => ({ value: fail ? "2045-01-01" : "2045-02-30" }),
      },
    });
    dialog.close();
    await settle();
    assert.equal(f.api.usesSimpleCalendar(), true);
    assert.equal(f.game.time.worldTime, 0);
    assert.equal(f.errors.length, 1);
  }
});
