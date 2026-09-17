import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  modules.set(name, exports);
  const code = ts.transpileModule(
    fs.readFileSync(new URL("../src/" + name + ".ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (path) => load(path.slice(2)),
    structuredClone,
  });
  return exports;
}
const { buildPayoutPlan } = load("payout-plan");
function draft() {
  const actor = {
    id: "a",
    name: "Actor",
    system: {
      wealth: { value: 100 },
      improvementPoints: { value: 2 },
      derivedStats: { humanity: { value: 40, max: 60 } },
      reputation: { value: 1 },
    },
  };
  return {
    sessionLabel: "Gig",
    inGameDate: "2078-02-06",
    notes: "",
    actors: [
      {
        actor,
        participant: {
          userId: "u",
          userName: "Player",
          actorId: "a",
          actorName: "Actor",
        },
        entries: [],
        items: [],
      },
    ],
    communalItems: [],
    payoutContainer: null,
    hqIpTransactions: [],
  };
}
test("payout planning preserves Primary and Individual faction scopes without writing Actors", () => {
  const d = draft();
  d.actors[0].entries = [
    {
      reward: "factionReputation",
      amount: 3,
      faction: "A",
      description: "Primary",
      scope: "group",
    },
    {
      reward: "factionReputation",
      amount: 5,
      faction: "B",
      description: "Individual",
      scope: "individual",
    },
  ];
  const before = JSON.stringify(d);
  const plan = buildPayoutPlan(d, {
    attendance: [],
    factionReputations: [{ actorId: "a", faction: "A", reputation: 1 }],
  });
  const changes = plan.changes.filter((c) => c.reward === "factionReputation");
  assert.deepEqual(
    Array.from(changes, (c) => c.details.scope),
    ["group", "individual"],
  );
  assert.deepEqual(
    Array.from(changes, (c) => [c.previousValue, c.newValue, c.amount]),
    [
      [1, 3, 2],
      [0, 5, 5],
    ],
  );
  assert.equal(JSON.stringify(d), before);
});
test("payout planning combines personal rewards, communal resources, attendance and player Humanity prompts", () => {
  const d = draft();
  d.actors[0].entries = [
    { reward: "money", amount: 50, scope: "group", description: "Gig" },
    { reward: "money", amount: 20, scope: "individual", description: "Bonus" },
    {
      reward: "humanityGain",
      amount: 0,
      formula: "2d6",
      scope: "individual",
      description: "Recovery",
    },
    { reward: "downtime", amount: 3, scope: "group", description: "Days" },
  ];
  d.payoutContainer = {
    actor: { id: "hq", name: "HQ", system: { wealth: { value: 10 } } },
    moneyAmount: 25,
    moneyDescription: "Crew",
  };
  const plan = buildPayoutPlan(d, {
    attendance: [{ actorId: "a", sessions: 4 }],
    factionReputations: [],
  });
  assert.deepEqual(
    Array.from(
      plan.changes.filter((c) => c.reward === "money"),
      (c) => c.newValue,
    ),
    [150, 170],
  );
  assert.equal(
    plan.changes.find((c) => c.reward === "communalMoney").newValue,
    35,
  );
  assert.equal(plan.changes.find((c) => c.reward === "attendance").newValue, 5);
  assert.equal(plan.changes.find((c) => c.reward === "downtime").amount, 3);
  assert.equal(plan.humanityPrompts[0].userId, "u");
  assert.equal(plan.humanityPrompts[0].actorId, "a");
});

test("absent downtime is separate from attendance and all other rewards", () => {
  const d = draft();
  d.actors[0].entries = [
    { reward: "downtime", amount: 3, scope: "group", description: "Rest" },
  ];
  d.absentDowntime = [
    {
      actor: { id: "absent", name: "Absent" },
      participant: { userId: "away" },
      days: 5,
    },
  ];
  const p = buildPayoutPlan(d, { attendance: [], factionReputations: [] });
  const changes = p.changes.filter((c) => c.targetId === "absent");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reward, "downtime");
  assert.equal(changes[0].amount, 5);
  assert.equal(changes[0].details.scope, "absent");
  assert.equal(p.actors.length, 1);
  d.actors[0].entries = [];
  const independent = buildPayoutPlan(d, {
    attendance: [],
    factionReputations: [],
  });
  assert.equal(independent.absentDowntime.length, 1);
  const optOut = buildPayoutPlan(
    { ...d, absentDowntime: [] },
    { attendance: [], factionReputations: [] },
  );
  assert.equal(
    optOut.changes.some((c) => c.targetId === "absent"),
    false,
  );
  assert.equal(
    independent.changes.some((c) => c.targetId === "absent" && c.amount === 5),
    true,
  );
});
test("absent recipient selection uses one character per missing player, deduplicates shared Actors and honors choices", () => {
  const { absentRecipients } = load("payout-absence");
  const account = (userId, ids) => ({
    userId,
    userName: userId,
    actors: ids.map((actorId) => ({ actorId, actorName: actorId })),
  });
  const accounts = [
    account("present", ["a", "alt"]),
    account("away", ["b", "c"]),
    account("shared", ["b"]),
    account("also-present", ["a"]),
    account("empty", []),
  ];
  const present = [{ actor: { id: "a" }, participant: { userId: "present" } }];
  assert.deepEqual(
    Array.from(absentRecipients(accounts, present), (p) => p.actorId),
    ["b"],
  );
  const chosen = absentRecipients(
    [accounts[1]],
    present,
    new Map([["away", "c"]]),
  );
  assert.equal(chosen[0].actorId, "c");
});
