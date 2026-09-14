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
      if (name === "./actor-policy")
        return load(
          "actor-policy",
          {
            ...globals,
            game: Object.assign(globals.game, {
              settings: globals.game.settings ?? { get: () => [] },
            }),
          },
          { "./constants": { MODULE_ID: "pneuma-crewtools" } },
        );
      if (
        [
          "./actor-resources",
          "./payout-plan",
          "./payout-system",
          "./system-resources",
        ].includes(name)
      )
        return load(name.slice(2), globals, dependencies);
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

function fixture(failLedger = false) {
  const events = [];
  const actor = {
    id: "actor",
    name: "Character",
    system: {
      wealth: { value: 100, transactions: [] },
      improvementPoints: { value: 0, transactions: [] },
      derivedStats: { humanity: { value: 50, max: 60 } },
      stats: { emp: { value: 5 } },
      reputation: { value: 0, transactions: [] },
    },
    update: async (update) => {
      events.push("actor");
      for (const [path, value] of Object.entries(update)) {
        if (!path.startsWith("system.")) continue;
        const parts = path.split(".").slice(1);
        let target = actor.system;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = structuredClone(value);
      }
    },
  };
  const time = {
    worldTime: 1234,
    advance: async (seconds) => {
      time.worldTime += seconds;
    },
  };
  const game = {
    time,
    actors: [actor],
    user: { isGM: true, id: "gm", name: "GM" },
  };
  const transaction = (name) => async () => {
    events.push(name);
    return async () => {
      events.push("undo " + name);
    };
  };
  const api = load(
    "payout-execution",
    { game },
    {
      "./calendar": {
        advanceCampaignDays: async (days) => game.time.advance(days * 86400),
      },
      "./downtime": {
        withDowntimeLock: (fn) => fn(),
        applyDowntimeAwards: transaction("downtime"),
      },
      "./headquarters": {
        applyHeadquartersPayout: transaction("headquarters"),
      },
      "./constants": { MODULE_ID: "pneuma-crewtools" },
      "./payout-ledger": {
        appendPayoutRecord: async () => {
          events.push("ledger");
          if (failLedger) throw Error("ledger failure");
        },
      },
      "./payout-record": {
        createPayoutRecord: (value) => ({ id: "record", ...value }),
      },
      "./payout-journal": { applyPayoutToJournal: transaction("journal") },
      "./humanity-prompts": { getPendingHumanityRolls: () => [] },
      "./payout-inbox": { createPayoutAcknowledgments: transaction("inbox") },
    },
  );
  const input = {
    actor,
    participant: { actorId: actor.id },
    entries: [
      { reward: "money", amount: 25, description: "Reward", scope: "group" },
    ],
    items: [],
  };
  const plan = {
    sessionLabel: "Session",
    inGameDate: "2045-01-01",
    notes: "",
    actors: [input],
    changes: api.planActorChanges(input),
    humanityPrompts: [],
    factionReputations: [],
    hqIpTransactions: [{ date: "2045-01-01", amount: 10, reason: "Reward" }],
    communalItems: [],
    payoutContainer: null,
  };
  return { api, plan, actor, game, events };
}

test("standalone payout applies actor rewards and completes journal and ledger writes", async () => {
  const f = fixture();
  await f.api.executePayoutPlan(f.plan);
  assert.equal(f.actor.system.wealth.value, 125);
  assert.equal(f.actor.system.wealth.transactions.length, 1);
  assert.deepEqual(f.events, [
    "actor",
    "downtime",
    "headquarters",
    "journal",
    "inbox",
    "ledger",
  ]);
});

test("downstream failure restores actor rewards and rolls back completed journal operations", async () => {
  const f = fixture(true);
  await assert.rejects(f.api.executePayoutPlan(f.plan), /ledger failure/);
  assert.equal(f.actor.system.wealth.value, 100);
  assert.deepEqual(f.actor.system.wealth.transactions, []);
  assert.deepEqual(f.events, [
    "actor",
    "downtime",
    "headquarters",
    "journal",
    "inbox",
    "ledger",
    "actor",
    "undo headquarters",
    "undo downtime",
    "undo journal",
    "undo inbox",
  ]);
});

test("non-GM cannot execute a payout", async () => {
  const f = fixture();
  f.game.user.isGM = false;
  await assert.rejects(f.api.executePayoutPlan(f.plan), /Only a GM/);
  assert.deepEqual(f.events, []);
});

test("a downtime-only payout never writes Actor data or flags", async () => {
  const f = fixture();
  f.plan.actors[0].entries = [
    { reward: "downtime", amount: 3, scope: "group", description: "Days off" },
  ];
  f.plan.changes = f.api.planActorChanges(f.plan.actors[0]);
  f.actor.update = async () => {
    throw Error("Actor writes are forbidden for downtime-only payouts");
  };
  await f.api.executePayoutPlan(f.plan);
  assert.ok(f.events.includes("downtime"));
  assert.equal(f.events.includes("actor"), false);
});

test("excluded Actors and duplicate recipient Actors are rejected before payout writes", async () => {
  const f = fixture();
  f.game.settings.get = () => [f.actor.id];
  await assert.rejects(f.api.executePayoutPlan(f.plan), /excluded Actor/);
  assert.deepEqual(f.events, []);
  f.game.settings.get = () => [];
  f.plan.actors.push(f.plan.actors[0]);
  await assert.rejects(f.api.executePayoutPlan(f.plan), /only once/);
  assert.deepEqual(f.events, []);
});

test("failed restoration reports incomplete rollback and still restores other records", async () => {
  const f = fixture(true);
  const update = f.actor.update;
  let calls = 0;
  f.actor.update = async (data) => {
    if (++calls === 2) throw Error("restore denied");
    return update(data);
  };
  await assert.rejects(
    f.api.executePayoutPlan(f.plan),
    /Rollback incomplete: Resources for Character.*ledger failure/,
  );
  assert.equal(f.actor.system.wealth.value, 125);
  assert.ok(f.events.includes("undo downtime"));
  assert.ok(f.events.includes("undo journal"));
  assert.ok(f.events.includes("undo inbox"));
});

test("payout advances GameTime once and restores it if the final ledger write fails", async () => {
  const f = fixture();
  f.plan.advanceDays = 4;
  await f.api.executePayoutPlan(f.plan);
  assert.equal(f.game.time.worldTime, 1234 + 4 * 86400);
  const failed = fixture(true);
  failed.plan.advanceDays = 4;
  await assert.rejects(
    failed.api.executePayoutPlan(failed.plan),
    /ledger failure/,
  );
  assert.equal(failed.game.time.worldTime, 1234);
});
test("GameTime defaults populate primary and nonparticipant downtime independently", () => {
  const api = load("payout-absence", {});
  const fields = {
    advanceDays: { value: "7" },
    groupDowntime: { value: "0" },
    absentDowntime: { value: "0" },
    grantAbsentDowntime: { checked: true },
  };
  const root = {
    querySelector: (selector) => fields[selector.match(/name="([^"]+)"/)[1]],
  };
  api.populateTimeDowntime(root);
  assert.equal(fields.groupDowntime.value, "6");
  assert.equal(fields.absentDowntime.value, "7");
  fields.advanceDays.value = "1";
  api.populateTimeDowntime(root);
  assert.equal(fields.groupDowntime.value, "0");
  assert.equal(fields.absentDowntime.value, "1");
  assert.equal(fields.absentDowntime.disabled, false);
  fields.advanceDays.value = "0";
  api.populateTimeDowntime(root);
  assert.equal(fields.groupDowntime.value, "0");
});
