import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, globals, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(
    fs.readFileSync(new URL("../src/" + file + ".ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      if (!(name in dependencies))
        throw Error("Unexpected dependency: " + name);
      return dependencies[name];
    },
    structuredClone,
    console,
    ...globals,
  });
  return exports;
}
function fixture() {
  const state = {
    schema: 1,
    ip: 40,
    spent: 80,
    improvements: { garage: 2 },
    log: [{ label: "Existing" }],
    stashUuid: "Actor.stash",
  };
  const writes = [];
  const journal = {
    id: "hq",
    name: "Crew HQ",
    isOwner: true,
    getFlag: () => state,
    update: async (update) => {
      writes.push(update);
      for (const [key, value] of Object.entries(update))
        state[key.split(".").at(-1)] = structuredClone(value);
    },
  };
  const journals = [journal];
  journals.get = (id) => journals.find((j) => j.id === id);
  const game = {
    user: { id: "gm", name: "GM", isGM: true },
    journal: journals,
    actors: [{ id: "stash", uuid: "Actor.stash", type: "container" }],
    modules: new Map([
      ["no-place-like-home", { active: true, version: "0.4.1" }],
    ]),
    settings: {
      get: (_namespace, key) => key === "integrateNoPlaceLikeHome",
      register: () => {},
    },
  };
  const hooks = {};
  const warnings = [];
  const globals = {
    game,
    Hooks: { on: (name, callback) => (hooks[name] = callback) },
    ui: { notifications: { error: (message) => warnings.push(message) } },
  };
  const api = load("hq-integration", globals, {
    "./constants": { MODULE_ID: "pneuma-crewtools" },
  });
  return { state, writes, journal, game, globals, api, hooks, warnings };
}
test("optional integration filters real owned HQs and finds their linked container", () => {
  const f = fixture();
  assert.equal(f.api.hqOptions()[0].stashId, "stash");
  f.journal.isOwner = false;
  assert.equal(f.api.getHeadquarters().length, 0);
  f.journal.isOwner = true;
  f.state.schema = 2;
  assert.equal(f.api.getHeadquarters().length, 0);
  f.state.schema = 1;
  f.game.settings.get = () => false;
  assert.equal(f.api.getHeadquarters().length, 0);
  f.game.settings.get = () => true;
  f.game.modules.clear();
  assert.equal(f.api.getHeadquarters().length, 0);
});
test("award adds once, preserves unrelated HQ data, and rolls back only its fields", async () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const undo = await f.api.applyHqAward(
    f.api.prepareHqAward("hq", 20, "Session reward"),
  );
  assert.equal(f.state.ip, 60);
  assert.equal(f.state.spent, 80);
  assert.deepEqual(f.state.improvements, before.improvements);
  assert.equal(f.state.log.length, 2);
  assert.match(f.state.log[1].label, /Session reward/);
  assert.deepEqual(Object.keys(f.writes[0]).sort(), [
    "flags.no-place-like-home.hq.ip",
    "flags.no-place-like-home.hq.log",
  ]);
  await undo();
  assert.deepEqual(f.state, before);
});
test("invalid targets, amounts, and overflow cannot write", () => {
  const f = fixture();
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => f.api.prepareHqAward("hq", amount, ""));
  assert.throws(() => f.api.prepareHqAward("missing", 20, ""));
  assert.equal(f.writes.length, 0);
});
test("revalidates changed balance, removed HQ, disabled integration and GM permission before writing", async () => {
  for (const mutate of [
    (f) => f.state.ip++,
    (f) => f.game.journal.splice(0),
    (f) => (f.game.settings.get = () => false),
    (f) => (f.game.user.isGM = false),
  ]) {
    const f = fixture();
    const award = f.api.prepareHqAward("hq", 20, "");
    mutate(f);
    await assert.rejects(f.api.applyHqAward(award));
    assert.equal(f.writes.length, 0);
  }
});
test("rollback refuses to overwrite later HQ activity", async () => {
  const f = fixture();
  const undo = await f.api.applyHqAward(f.api.prepareHqAward("hq", 20, ""));
  f.state.ip += 5;
  await assert.rejects(undo(), /newer changes/);
  assert.equal(f.state.ip, 65);
});
test("settings are off by default with disabled placeholder link when module is unavailable", () => {
  const f = fixture();
  let config;
  f.game.settings.register = (_namespace, _key, value) => (config = value);
  f.api.registerHqIntegration();
  assert.equal(config.default, false);
  const input = {
    disabled: false,
    closest: () => null,
    addEventListener: () => {},
  };
  f.game.modules.clear();
  f.hooks.renderSettingsConfig(null, { 0: { querySelector: () => input } });
  assert.equal(input.disabled, true);
});
test("payout execution rolls HQ award back after downstream failure; native payout skips HQ", async () => {
  const f = fixture();
  let fail = true;
  const dependencies = {
    "./hq-integration": f.api,
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./payout-ledger": { appendPayoutRecord: async () => {} },
    "./payout-record": {
      createPayoutRecord: (value) => ({ id: "record", ...value }),
    },
    "./payout-journal": {
      applyPayoutToJournal: async () => {
        if (fail) throw Error("journal failure");
        return async () => {};
      },
    },
    "./humanity-prompts": {},
    "./payout-inbox": {
      createPayoutAcknowledgments: async () => async () => {},
    },
    "./payout-log": { appendPayoutLog: async () => async () => {} },
  };
  const execution = load("payout-execution", f.globals, dependencies);
  const plan = {
    sessionLabel: "Test",
    notes: "",
    actors: [],
    changes: [],
    humanityPrompts: [],
    hqIpTransactions: [],
    communalItems: [],
    payoutContainer: null,
    hqAward: f.api.prepareHqAward("hq", 20, "Test"),
  };
  await assert.rejects(execution.executePayoutPlan(plan), /journal failure/);
  assert.equal(f.state.ip, 40);
  assert.equal(f.state.log.length, 1);
  fail = false;
  await execution.executePayoutPlan(plan);
  assert.equal(f.state.ip, 60);
  delete plan.hqAward;
  await execution.executePayoutPlan(plan);
  assert.equal(f.state.ip, 60);
});

test("version check blocks newer and unrecognized versions unless explicitly overridden", async () => {
  for (const version of ["0.4.2", "1.0.0", "unknown", undefined]) {
    const f = fixture();
    const award = f.api.prepareHqAward("hq", 20, "Test");
    f.game.modules.get("no-place-like-home").version = version;
    assert.equal(f.api.hqIntegrationEnabled(), false);
    await assert.rejects(f.api.applyHqAward(award));
    assert.equal(f.writes.length, 0);
    f.game.settings.get = () => true;
    assert.equal(f.api.hqIntegrationEnabled(), true);
    await f.api.applyHqAward(award);
    assert.equal(f.state.ip, 60);
    f.state.schema = 2;
    assert.throws(() => f.api.prepareHqAward("hq", 20, "Test"));
    f.game.modules.get("no-place-like-home").active = false;
    assert.equal(f.api.hqIntegrationEnabled(), false);
  }
});
test("version check accepts 0.4.1 and earlier versions", () => {
  for (const version of ["0.4.1", "0.4.1-beta.1", "0.4.0", "0.3.9", "0.1.0"]) {
    const f = fixture();
    f.game.modules.get("no-place-like-home").version = version;
    assert.equal(f.api.hqIntegrationEnabled(), true, version);
  }
});
test("override toggles the integration checkbox immediately without saving first", () => {
  const f = fixture();
  f.game.modules.get("no-place-like-home").version = "0.4.2";
  f.api.registerHqIntegration();
  let change;
  const integration = { disabled: false, closest: () => null };
  const override = {
    checked: false,
    disabled: false,
    closest: () => null,
    addEventListener: (_event, callback) => (change = callback),
  };
  f.hooks.renderSettingsConfig(null, {
    0: {
      querySelector: (selector) =>
        selector.includes("overrideNoPlace") ? override : integration,
    },
  });
  assert.equal(integration.disabled, true);
  assert.equal(override.disabled, false);
  override.checked = true;
  change();
  assert.equal(integration.disabled, false);
  override.checked = false;
  change();
  assert.equal(integration.disabled, true);
});

test("settings render both integration controls inside one labeled panel", () => {
  const f = fixture();
  f.api.registerHqIntegration();
  let inserted;
  const integrationRow = {
    closest: () => null,
    before: (node) => (inserted = node),
    querySelector: () => null,
  };
  const overrideRow = { querySelector: () => null };
  const integration = { closest: () => integrationRow };
  const override = {
    checked: false,
    closest: () => overrideRow,
    addEventListener: () => {},
  };
  const elements = [];
  const document = {
    createElement: (tag) => {
      const element = {
        tag,
        className: "",
        dataset: {},
        children: [],
        append(...children) {
          this.children.push(...children);
        },
      };
      elements.push(element);
      return element;
    },
  };
  f.globals.document = document;
  const api = load("hq-integration", f.globals, {
    "./constants": { MODULE_ID: "pneuma-crewtools" },
  });
  api.registerHqIntegration();
  f.hooks.renderSettingsConfig(null, {
    0: {
      querySelector: (selector) =>
        selector.includes("overrideNoPlace") ? override : integration,
    },
  });
  assert.equal(inserted.className, "nplh-settings-group");
  assert.equal(
    inserted.children[0].textContent,
    "No Place Like Home Module integration",
  );
  assert.deepEqual(inserted.children.slice(1), [integrationRow, overrideRow]);
});
