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
  const game = { user: { isGM: true, id: "gm", name: "GM" } };
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
      "./payout-log": { appendPayoutLog: transaction("log") },
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
  assert.deepEqual(f.events, ["actor", "journal", "inbox", "log", "ledger"]);
});

test("downstream failure restores actor rewards and rolls back completed journal operations", async () => {
  const f = fixture(true);
  await assert.rejects(f.api.executePayoutPlan(f.plan), /ledger failure/);
  assert.equal(f.actor.system.wealth.value, 100);
  assert.deepEqual(f.actor.system.wealth.transactions, []);
  assert.deepEqual(f.events, [
    "actor",
    "journal",
    "inbox",
    "log",
    "ledger",
    "actor",
    "undo journal",
    "undo inbox",
    "undo log",
  ]);
});

test("non-GM cannot execute a payout", async () => {
  const f = fixture();
  f.game.user.isGM = false;
  await assert.rejects(f.api.executePayoutPlan(f.plan), /Only a GM/);
  assert.deepEqual(f.events, []);
});
