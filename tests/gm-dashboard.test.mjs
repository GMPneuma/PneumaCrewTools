import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  const calls = [],
    hooks = new Map(),
    dialogs = [],
    instances = [],
    errors = [];
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
  const saveAdjustment = async (amount, reason) => {
    if (!reason.trim()) throw Error("Enter a reason");
    await Promise.resolve();
    calls.push("adjustment-saved");
  };
  const deps = {
    "./actor-policy": { accessibleCrewActors: () => [{ id: "a", name: "A" }] },
    "./downtime-records": { storedDowntimeBalance: () => 5 },
    "./downtime-store": { escape: String },
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
      adjustPlayerDowntime: (_actor, amount, reason) =>
        saveAdjustment(amount, reason),
      report: (e) => {
        errors.push(e);
      },
    },
    "./headquarters": {
      openHeadquarters: () => calls.push("headquarters"),
      headquartersIp: () => 10,
      adjustHeadquartersIp: saveAdjustment,
    },
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
                instances.push(this);
                this.config = config;
              }
              async close() {
                this.closed = true;
                this.config.close?.();
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
          instances.push(this);
          this.config = config;
        }
        async close() {
          this.closed = true;
          this.config.close?.();
        }
        render() {
          return this;
        }
      },
    },
  );
  return { exports, game, calls, hooks, dialogs, instances, errors };
}
test("GM dashboard guards entry, preserves pending records and routes actions", async () => {
  const f = fixture(),
    dashboard = new f.exports.GMDashboard(() => f.calls.push("payout"));
  assert.equal(dashboard.getData().cards[0].id, "receipt");
  for (const action of ["payout", "calendar", "downtime", "headquarters"]) {
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

test("rent requires confirmation; cancel, close and repeated clicks are safe", async () => {
  const f = fixture();
  const dashboard = new f.exports.GMDashboard(() => {});
  let click;
  const button = {
    dataset: { gmDashboardAction: "rent" },
    addEventListener: (_e, fn) => (click = fn),
  };
  dashboard.activateListeners([{ querySelectorAll: () => [button] }]);
  for (const dismiss of ["cancel", "close"]) {
    click();
    const dialog = f.dialogs.at(-1);
    assert.equal(dialog.default, "cancel");
    assert.equal(button.disabled, true);
    assert.ok(!f.calls.includes("rent"));
    if (dismiss === "close") dialog.close();
    else dialog.buttons.cancel.callback();
    await new Promise((r) => setImmediate(r));
    assert.ok(!f.calls.includes("rent"));
    assert.equal(button.disabled, false);
  }
  click();
  const count = f.dialogs.length;
  click();
  assert.equal(f.dialogs.length, count);
  const dialog = f.dialogs.at(-1);
  dialog.buttons.confirm.callback();
  dialog.close();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.filter((c) => c === "rent").length, 1);
  assert.equal(button.disabled, false);
});

for (const action of ["adjustDowntime", "hqIp"]) {
  test(`${action} retains input on error, allows correction or cancellation, and blocks duplicate saves`, async () => {
    const f = fixture();
    const dashboard = new f.exports.GMDashboard(() => {});
    let click;
    const button = {
      dataset: { gmDashboardAction: action },
      addEventListener: (_e, fn) => (click = fn),
    };
    dashboard.activateListeners([{ querySelectorAll: () => [button] }]);
    click();
    const dialog = f.instances.at(-1);
    const config = f.dialogs.at(-1);
    const fields = {
      actorId: { value: "a" },
      adjustment: { value: "3" },
      ipAdjustment: { value: "3" },
      reason: { value: "   " },
      ipReason: { value: "   " },
    };
    dialog.element = [
      {
        querySelector: (selector) =>
          fields[selector.match(/name="([^"]+)"/)[1]],
      },
    ];
    await dialog.submit(config.buttons.apply);
    assert.equal(dialog.closed, undefined);
    assert.equal(f.errors.length, 1);
    assert.equal(fields.adjustment.value, "3");
    assert.equal(button.disabled, true);
    fields.reason.value = fields.ipReason.value = "Correction";
    await Promise.all([
      dialog.submit(config.buttons.apply),
      dialog.submit(config.buttons.apply),
    ]);
    await new Promise((r) => setImmediate(r));
    assert.equal(dialog.closed, true);
    assert.equal(f.calls.filter((x) => x === "adjustment-saved").length, 1);
    assert.equal(button.disabled, false);
    click();
    const cancelled = f.instances.at(-1);
    cancelled.element = dialog.element;
    fields.reason.value = fields.ipReason.value = "";
    await cancelled.submit(f.dialogs.at(-1).buttons.apply);
    assert.equal(cancelled.closed, undefined);
    await cancelled.submit(f.dialogs.at(-1).buttons.cancel);
    await new Promise((r) => setImmediate(r));
    assert.equal(cancelled.closed, true);
    assert.equal(button.disabled, false);
    assert.equal(f.calls.filter((x) => x === "adjustment-saved").length, 1);
  });
}
