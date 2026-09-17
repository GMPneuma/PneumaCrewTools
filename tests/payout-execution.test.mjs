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

test("independent absent award survives planning and execution with one-day time advance and zero primary downtime", async () => {
  for (const failure of [false, true]) {
    const f = fixture(failure);
    f.plan.actors[0].participant.userId = "present";
    f.plan.actors[0].entries = [
      { reward: "downtime", amount: 0, scope: "group", description: "Days" },
    ];
    const away = { id: "away", name: "Away", type: "character" };
    const { buildPayoutPlan } = load("payout-plan", {});
    const plan = buildPayoutPlan(
      {
        ...f.plan,
        advanceDays: 1,
        absentDowntime: [
          { actor: away, participant: { userId: "absent" }, days: 1 },
        ],
      },
      { attendance: [], factionReputations: [] },
    );
    assert.equal(plan.absentDowntime.length, 1);
    assert.equal(plan.changes.find((c) => c.targetId === "away").amount, 1);
    if (failure) {
      await assert.rejects(f.api.executePayoutPlan(plan), /ledger failure/);
      assert.ok(f.events.includes("undo downtime"));
      assert.equal(f.game.time.worldTime, 1234);
    } else {
      await f.api.executePayoutPlan(plan);
      assert.ok(f.events.includes("downtime"));
      assert.ok(f.events.includes("ledger"));
      assert.equal(f.game.time.worldTime, 1234 + 86400);
    }
    assert.equal(f.actor.system.wealth.value, 100);
  }
});

test("independent absent awards still reject invalid amounts and duplicate or ineligible recipients before writing", async () => {
  const f = fixture();
  f.plan.actors[0].participant.userId = "present";
  const award = {
    actor: { id: "away", name: "Away", type: "character" },
    participant: { userId: "absent" },
    days: 1,
  };
  for (const days of [0, -1, 1.5, NaN]) {
    f.plan.absentDowntime = [{ ...award, days }];
    await assert.rejects(
      f.api.executePayoutPlan(f.plan),
      /positive whole number/,
    );
  }
  for (const awards of [
    [award, award],
    [{ ...award, actor: { ...award.actor, id: f.actor.id } }],
    [{ ...award, participant: { userId: "present" } }],
    [{ ...award, actor: { ...award.actor, type: "container" } }],
  ]) {
    f.plan.absentDowntime = awards;
    await assert.rejects(
      f.api.executePayoutPlan(f.plan),
      /Invalid or duplicate/,
    );
  }
  f.game.settings.get = () => ["away"];
  f.plan.absentDowntime = [award];
  await assert.rejects(f.api.executePayoutPlan(f.plan), /Invalid or duplicate/);
  assert.deepEqual(f.events, []);
});

test("stale IP and Humanity previews reject before writes and a fresh preview succeeds", async () => {
  for (const reward of ["ip", "humanityGain"]) {
    const f = fixture();
    f.plan.actors[0].entries = [
      { reward, amount: 5, scope: "individual", description: "Reward" },
    ];
    f.plan.changes = f.api.planActorChanges(f.plan.actors[0]);
    const resource =
      reward === "ip"
        ? f.actor.system.improvementPoints
        : f.actor.system.derivedStats.humanity;
    resource.value = reward === "ip" ? 20 : 40;
    await assert.rejects(
      f.api.executePayoutPlan(f.plan),
      /resources changed.*Preview/,
    );
    assert.deepEqual(f.events, []);
    f.plan.changes = f.api.planActorChanges(f.plan.actors[0]);
    await f.api.executePayoutPlan(f.plan);
    assert.equal(resource.value, reward === "ip" ? 25 : 45);
  }
});

test("partial payout delivery removes created Items and restores money before retry", async () => {
  const f = fixture();
  const inventory = new Map();
  let partial = true;
  f.actor.createEmbeddedDocuments = async (_type, rows) => {
    const created = (partial ? rows.slice(0, 1) : rows).map((row, i) => ({
      ...row,
      id: "item" + i,
    }));
    created.forEach((item) => inventory.set(item.id, item));
    return created;
  };
  f.actor.deleteEmbeddedDocuments = async (_type, ids) =>
    ids.forEach((id) => inventory.delete(id));
  f.plan.actors[0].items = [
    { quantity: 2, source: { name: "Weapon", system: {} } },
  ];
  await assert.rejects(
    f.api.executePayoutPlan(f.plan),
    /delivery was incomplete/,
  );
  assert.equal(inventory.size, 0);
  assert.equal(f.actor.system.wealth.value, 100);
  assert.equal(f.events.includes("ledger"), false);
  partial = false;
  await f.api.executePayoutPlan(f.plan);
  assert.equal(inventory.size, 2);
  assert.equal(f.actor.system.wealth.value, 125);
});

test("partial delivery cleanup failure identifies remaining Items", async () => {
  const adapter = load("actor-resources", {});
  await assert.rejects(
    adapter.deliverItems(
      {
        name: "Character",
        createEmbeddedDocuments: async () => [{ id: "leftover" }],
        deleteEmbeddedDocuments: async () => {
          throw Error("denied");
        },
      },
      [{}, {}],
    ),
    /cleanup failed.*leftover/,
  );
});
