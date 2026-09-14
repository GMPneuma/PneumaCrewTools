import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  const calls = [],
    hooks = new Map(),
    dialogs = [];
  const game = { user: { isGM: true } };
  class PlayerHub {
    static get defaultOptions() {
      return { classes: [] };
    }
    getData() {
      return { cards: [{ id: "receipt" }], isGM: true };
    }
    activateListeners() {}
    render() {
      this.rendered = true;
      calls.push("render");
      return this;
    }
  }
  const deps = {
    "./rent": {
      issueRent: async () => {
        calls.push("rent");
        return "02-06-2078";
      },
    },
    "./payout-inbox": { PlayerHub },
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./calendar": { openCampaignCalendar: () => calls.push("calendar") },
    "./downtime": { openDowntime: () => calls.push("downtime") },
    "./downtime-service": {
      startNextDowntimeSession: async () => calls.push("expire"),
      report: (e) => {
        throw e;
      },
    },
    "./headquarters": { openHeadquarters: () => calls.push("headquarters") },
    "./ui-refresh": { coalesceRefresh: (f) => f, isCrewPage: (p) => p.crew },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/gm-dashboard.ts", import.meta.url),
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
      require: (k) => {
        if (k !== "./expire-downtime") return deps[k];
        const exports = {};
        vm.runInNewContext(
          ts.transpileModule(
            fs.readFileSync("src/expire-downtime.ts", "utf8"),
            { compilerOptions: { module: ts.ModuleKind.CommonJS } },
          ).outputText,
          {
            exports,
            require: (key) => deps[key],
            ui: { notifications: { info() {} } },
            Dialog: class {
              constructor(config) {
                dialogs.push(config);
              }
              render() {
                return this;
              }
            },
          },
        );
        return exports;
      },
      game,
      console,
      Hooks: { on: (k, fn) => hooks.set(k, fn) },
      ui: { notifications: { info: () => {}, warn: () => calls.push("warn") } },
      Dialog: class {
        constructor(config) {
          dialogs.push(config);
        }
        render() {
          return this;
        }
      },
    },
  );
  return { exports, game, calls, hooks, dialogs };
}
test("GM dashboard guards entry, preserves pending records and routes actions", async () => {
  const f = fixture(),
    dashboard = new f.exports.GMDashboard(() => f.calls.push("payout"));
  assert.equal(dashboard.getData().cards[0].id, "receipt");
  for (const action of [
    "payout",
    "calendar",
    "downtime",
    "headquarters",
    "rent",
  ]) {
    let click;
    const button = {
      dataset: { gmDashboardAction: action },
      addEventListener: (_e, fn) => (click = fn),
    };
    dashboard.activateListeners([{ querySelectorAll: () => [button] }]);
    click();
    await new Promise((r) => setImmediate(r));
    assert.ok(f.calls.includes(action));
    assert.equal(button.disabled, false);
  }
  f.game.user.isGM = false;
  assert.throws(() => dashboard.getData(), /Only a GM/);
  f.exports.openDashboard(() => {});
  assert.equal(f.calls.at(-1), "warn");
});
test("expiration requires confirmation; module records refresh an open dashboard", async () => {
  const f = fixture(),
    dashboard = new f.exports.GMDashboard(() => {});
  let click;
  const button = {
    dataset: { gmDashboardAction: "expire" },
    addEventListener: (_e, fn) => (click = fn),
  };
  dashboard.activateListeners([{ querySelectorAll: () => [button] }]);
  click();
  assert.ok(!f.calls.includes("expire"));
  f.dialogs.at(-1).buttons.cancel.callback();
  await new Promise((r) => setImmediate(r));
  assert.ok(!f.calls.includes("expire"));
  click();
  f.dialogs.at(-1).buttons.expire.callback();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.filter((c) => c === "expire").length, 1);
  f.exports.openDashboard(() => {});
  const before = f.calls.length;
  f.hooks.get("updateJournalEntryPage")({ crew: false });
  assert.equal(f.calls.length, before);
  f.hooks.get("updateJournalEntryPage")({ crew: true });
  assert.equal(f.calls.length, before + 1);
});
