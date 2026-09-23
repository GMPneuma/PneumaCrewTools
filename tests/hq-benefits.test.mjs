import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(name, globals = {}, deps = {}) {
  const out = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports: out,
      require: (k) => deps[k] ?? load(k.slice(2), globals, deps),
      structuredClone,
      ...globals,
    },
  );
  return out;
}
const benefits = load("hq-benefits");
const state = (id, level) => ({
  headquarters: [
    { improvements: [{ catalogId: id, name: "Renamed facility", level }] },
  ],
});
test("Morale upgrade boundaries preserve active reference benefits and replace weaker versions", () => {
  assert.equal(benefits.moraleBenefits(0).length, 0);
  for (let level = 1; level <= 11; level++) {
    const list = benefits.moraleBenefits(level);
    assert.equal(
      list.filter((b) => b.automated).length,
      (level >= 3 ? 1 : 0) + (level >= 7 ? 1 : 0),
    );
    assert.equal(
      list.filter((b) => b.text.includes("Humanity")).length,
      level >= 2 ? 1 : 0,
    );
  }
  assert.match(
    benefits.moraleBenefits(9).find((b) => b.text.startsWith("Hustle")).text,
    /both incomes/,
  );
  assert.equal(
    benefits.crewImprovementLevel(state("moraleBoost", 3), "moraleBoost"),
    3,
  );
  assert.equal(
    benefits.improvementLevel(
      { improvements: [{ name: "Morale Boost" }] },
      "moraleBoost",
    ),
    1,
  );
  assert.equal(
    benefits.improvementLevel(
      { improvements: [{ catalogId: "custom", name: "Morale Boost" }] },
      "moraleBoost",
    ),
    0,
  );
});
test("Rent Reduction skips free housing and does not reduce free HQ rent", () => {
  const rates = [
    { id: "street", cost: 0 },
    { id: "cubeHotel", cost: 500 },
    { id: "cargo", cost: 1000 },
    { id: "studio", cost: 1500 },
    { id: "two", cost: 2500 },
    { id: "corp", cost: 0 },
    { id: "upscale", cost: 7500 },
  ].map((r) => ({ ...r, name: r.id }));
  const hq = state("rentReduction", 1).headquarters[0];
  assert.equal(benefits.reducedHqRate(rates[1], rates, hq).cost, 100);
  assert.equal(benefits.reducedHqRate(rates[6], rates, hq).cost, 2500);
  assert.equal(benefits.reducedHqRate(rates[5], rates, hq).cost, 0);
  assert.equal(
    benefits.reducedHqRate(rates[2], rates, { improvements: [] }).cost,
    1000,
  );
});
test("Morale healing stacks with Medbay and multipliers and validates stored records", () => {
  const healing = load("downtime-healing");
  const actor = {
    system: {
      stats: { body: { value: 5 } },
      derivedStats: { hp: { value: 1, max: 100 } },
    },
    items: [],
  };
  const hqs = state("moraleBoost", 3);
  hqs.headquarters[0].id = "hq";
  hqs.headquarters[0].improvements.push({
    id: "med",
    name: "Medbay",
    effect: "medbay",
  });
  const result = healing.healingPreview(
    actor,
    { medbay: true, antibiotic: false, cryotank: true },
    hqs,
    true,
    1,
  );
  assert.equal(result.rate, 16);
  healing.validateHealingResult(result, 1);
  assert.throws(
    () => healing.validateHealingResult({ ...result, moraleBoost: false }, 1),
    /calculation/,
  );
  assert.equal(
    healing.healingPreview(
      actor,
      { medbay: false, antibiotic: false, cryotank: false },
      state("moraleBoost", 2),
      true,
    ).rate,
    5,
  );
});
function effectActor() {
  let seq = 0;
  const actor = {
    items: [
      { id: "gun", type: "skill", name: "Handgun" },
      { id: "ath", type: "skill", name: "Athletics" },
      { id: "other", type: "skill", name: "Perception" },
    ],
    effects: [],
  };
  actor.createEmbeddedDocuments = async (type, data) =>
    data.map((d) => {
      const e = {
        id: String(++seq),
        ...structuredClone(d),
        getFlag(ns, key) {
          return this.flags?.[ns]?.[key];
        },
        toObject() {
          return {
            name: this.name,
            disabled: this.disabled,
            changes: structuredClone(this.changes),
            flags: structuredClone(this.flags),
          };
        },
        async update(d) {
          Object.assign(this, structuredClone(d));
        },
      };
      actor.effects.push(e);
      return e;
    });
  actor.deleteEmbeddedDocuments = async (type, ids) => {
    actor.effects = actor.effects.filter((e) => !ids.includes(e.id));
  };
  return actor;
}
test("Training validates selections and uses native skill bonus changes", () => {
  const training = load("hq-training");
  const actor = effectActor();
  assert.throws(
    () => training.trainingData(actor, state("trainingArea", 0), ["gun"]),
    /eligible/,
  );
  assert.throws(
    () => training.trainingData(actor, state("trainingArea", 1), ["other"]),
    /belonging/,
  );
  assert.throws(
    () =>
      training.trainingData(actor, state("trainingArea", 2), ["gun", "ath"]),
    /eligible/,
  );
  actor.items.push({ type: "role", name: "Solo", system: { rank: 1 } });
  const data = training.trainingData(actor, state("trainingArea", 2), [
    "gun",
    "ath",
  ]);
  assert.equal(data.changes[0].key, "bonuses.handgun");
  assert.equal(data.changes[0].value, "1");
  assert.equal(data.flags["cyberpunk-red-core"].changes.cats[0], "skill");
  assert.throws(
    () =>
      training.trainingData(actor, state("trainingArea", 2), ["gun", "gun"]),
    /distinct/,
  );
});
test("Training replaces the prior effect and expires only on positive Group IP; rollback restores it", async () => {
  const training = load("hq-training");
  const actor = effectActor(),
    hqs = state("trainingArea", 1);
  await training.applyTraining(
    actor,
    training.trainingData(actor, hqs, ["gun"]),
  );
  const undo = await training.applyTraining(
    actor,
    training.trainingData(actor, hqs, ["ath"]),
  );
  assert.equal(actor.effects.length, 1);
  assert.match(actor.effects[0].name, /Athletics/);
  await undo();
  assert.match(actor.effects[0].name, /Handgun/);
  const payout = (entries) => ({ actors: [{ actor, entries }] });
  await training.expireTrainingForPayout(
    payout([{ reward: "ip", scope: "individual", amount: 40 }]),
  );
  assert.equal(actor.effects[0].disabled, false);
  const restore = await training.expireTrainingForPayout(
    payout([{ reward: "ip", scope: "group", amount: 40 }]),
  );
  assert.equal(actor.effects[0].disabled, true);
  await restore();
  assert.equal(actor.effects[0].disabled, false);
});
test("Server Room creates one native world NetArch, reuses it, and mirrors HQ read access", async () => {
  const MODULE_ID = "pneuma-crewtools",
    player = { id: "p", isGM: false },
    hidden = { id: "h", isGM: false };
  let seq = 0;
  const game = {
    user: { isGM: true },
    users: [player, hidden],
    items: [],
    folders: [],
    actors: { get: () => ({ testUserPermission: (u) => u.id === "p" }) },
  };
  const hq = {
    id: "hq",
    actorId: "hq",
    name: "Base",
    improvements: [{ catalogId: "serverRoom", level: 1 }],
  };
  const globals = {
    game,
    Folder: {
      create: async (d) => {
        const f = { ...d, id: "folder" };
        game.folders.push(f);
        return f;
      },
    },
    Item: {
      create: async (d) => {
        const item = {
          ...d,
          id: String(++seq),
          system: { floors: [] },
          getFlag: (n, k) => d.flags[n]?.[k],
          update: async (c) => {
            item.ownership = { ...item.ownership, ...c.ownership };
          },
          testUserPermission: (u) => item.ownership[u.id] >= 2,
        };
        game.items.push(item);
        return item;
      },
    },
  };
  const api = load("hq-server-room", globals, {
    "./headquarters": { getHeadquarters: () => ({ headquarters: [hq] }) },
    "./hq-records": {
      hqPage: () => ({ testUserPermission: (u) => u.id === "p" }),
    },
    "./action-coordinator": { isPrimaryGM: () => game.user.isGM },
    "./constants": { MODULE_ID },
  });
  await api.ensureServerRooms();
  assert.equal(game.items.length, 1);
  assert.equal(game.items[0].type, "netarch");
  assert.equal(game.folders[0].type, "Item");
  assert.equal(game.folders[0].name, "CrewTools");
  game.items[0].system.floors.push({ description: "GM custom floor" });
  await api.ensureServerRooms();
  assert.equal(game.items.length, 1);
  assert.equal(game.items[0].system.floors.length, 1);
  game.user = player;
  assert.ok(api.serverRoomLink("hq"));
  game.user = hidden;
  assert.equal(api.serverRoomLink("hq"), undefined);
  game.user = { isGM: true };
  hq.improvements = [];
  await api.ensureServerRooms();
  game.user = player;
  assert.equal(api.serverRoomLink("hq"), undefined);
  assert.equal(game.items.length, 1);
});
