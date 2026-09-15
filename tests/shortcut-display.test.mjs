import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  let mode = "both",
    early = false,
    config,
    initialized = 0,
    removed = 0;
  const hooks = new Map(),
    cache = new Map();
  const game = {
    user: { isGM: false },
    settings: {
      get() {
        if (early) throw Error("unregistered");
        return mode;
      },
      register(_ns, _key, value) {
        config = value;
      },
    },
  };
  const deps = {
    constants: { MODULE_ID: "pneuma-crewtools" },
    "gm-dashboard": { openDashboard() {} },
    "payout-window": { PayoutWindow: class {} },
    "payout-inbox": {
      hasInboxItemsForCurrentUser: () => false,
      openPlayerHub() {},
      waitingPayoutCount: () => {
        throw Error("hidden HUD read status");
      },
    },
    rent: { rentNeedsAttention: () => false },
    "ui-refresh": { coalesceRefresh: (fn) => fn, isCrewPage: () => true },
    "actor-policy": {},
    "downtime-store": {},
    "downtime-records": {},
  };
  function load(name) {
    if (deps[name]) return deps[name];
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(`src/${name}.ts`, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        require: (key) => load(key.slice(2)),
        game,
        Hooks: { on: (name, fn) => hooks.set(name, fn) },
        ui: {
          controls: {
            initialize() {
              initialized++;
            },
          },
        },
        document: {
          getElementById: () => ({
            querySelector: () => ({
              remove() {
                removed++;
              },
            }),
          }),
        },
      },
    );
    return exports;
  }
  return {
    game,
    hooks,
    load,
    setMode: (value) => {
      mode = value;
    },
    early: (value) => {
      early = value;
    },
    config: () => config,
    initialized: () => initialized,
    removed: () => removed,
  };
}
test("Shortcut preference is client-scoped, defaults safely before init, and refreshes both surfaces", () => {
  const f = fixture(),
    api = f.load("shortcut-display");
  f.early(true);
  assert.equal(api.shortcutDisplay(), "both");
  f.early(false);
  let refreshes = 0;
  api.registerShortcutDisplay(() => refreshes++);
  assert.equal(f.config().scope, "client");
  assert.equal(f.config().default, "both");
  for (const [mode, hud, token] of [
    ["both", true, true],
    ["hud", true, false],
    ["token", false, true],
  ]) {
    f.setMode(mode);
    f.config().onChange();
    assert.equal(api.showHudShortcuts(), hud);
    assert.equal(api.showTokenShortcuts(), token);
  }
  assert.equal(refreshes, 3);
  assert.equal(f.initialized(), 3);
});
test("Token shortcut switching preserves native tools and GM permissions without duplicate entries", () => {
  const f = fixture();
  f.load("window-controls").registerPayoutWindowControl();
  const native = { name: "select" },
    controls = [{ name: "token", tools: [native] }];
  const rebuild = f.hooks.get("getSceneControlButtons");
  rebuild(controls);
  assert.equal(controls[0].tools.length, 2);
  rebuild(controls);
  assert.equal(controls[0].tools.length, 2);
  f.setMode("hud");
  rebuild(controls);
  assert.deepEqual(controls[0].tools, [native]);
  f.setMode("token");
  f.game.user.isGM = true;
  rebuild(controls);
  assert.equal(controls[0].tools.length, 3);
  f.game.user.isGM = false;
  rebuild(controls);
  assert.equal(controls[0].tools.length, 2);
});
test("Token-only mode removes HUD shortcuts without reading status or removing the calendar", () => {
  const f = fixture();
  f.setMode("token");
  f.load("crew-hud").readyCrewHud();
  assert.equal(f.removed(), 1);
});
