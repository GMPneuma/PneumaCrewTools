import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
function fixture() {
  const user = { id: "player" };
  function load(name) {
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
        require: (p) => load(p.slice(2)),
        structuredClone,
        game: { user },
      },
    );
    return exports;
  }
  const api = load("ip-spending");
  const skill = {
    id: "accounting",
    name: "Accounting",
    type: "skill",
    system: { level: 0, difficulty: "typical" },
  };
  const role = {
    id: "solo",
    name: "Solo",
    type: "role",
    system: { rank: 4, mainRoleAbility: "Combat Awareness" },
  };
  const actor = {
    id: "actor",
    items: [skill, role],
    system: {
      improvementPoints: {
        value: 1000,
        transactions: [["Increased by 1000 to 1000", "Award"]],
      },
    },
    testUserPermission: () => true,
    async update(data) {
      this.saved = data;
    },
    async createEmbeddedDocuments(type, sources) {
      this.created = sources;
      return [{ id: "new-role" }];
    },
    async deleteEmbeddedDocuments(type, ids) {
      this.deleted = ids;
    },
  };
  return { ...api, actor, skill, role };
}
test("costs sum every purchased rank, including doubled skills and roles", () => {
  const f = fixture();
  assert.equal(f.upgradeCost(0, 3, 20), 120);
  assert.equal(f.upgradeCost(0, 3, 40), 240);
  assert.equal(f.upgradeCost(4, 6, 60), 660);
  for (const args of [
    [3, 2, 20],
    [0, 11, 20],
    [0, 1, 30],
    [0, 1.5, 20],
  ])
    assert.throws(() => f.upgradeCost(...args));
});
test("purchase groups bumps into one native ledger row and preserves history", async () => {
  const f = fixture();
  const drafts = f.actorUpgrades(f.actor);
  drafts.find((d) => d.id === "accounting").to = 3;
  await f.applyIpUpgrades(f.actor, drafts, 1000);
  assert.equal(f.actor.saved["system.improvementPoints.value"], 880);
  assert.deepEqual(JSON.parse(JSON.stringify(f.actor.saved.items)), [
    { _id: "accounting", "system.level": 3 },
  ]);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(f.actor.saved["system.improvementPoints.transactions"]),
    ),
    [
      ["Increased by 1000 to 1000", "Award"],
      ["Decreased by 120 to 880", "Accounting 0 -> 3"],
    ],
  );
});
test("rejects stale balance, stale ranks, missing ownership, duplicate rows and overdrafts", async () => {
  for (const mode of ["balance", "rank", "owner", "duplicate", "overdraft"]) {
    const f = fixture();
    const drafts = f.actorUpgrades(f.actor);
    drafts.find((d) => d.id === "accounting").to = 3;
    if (mode === "balance") f.actor.system.improvementPoints.value = 999;
    if (mode === "rank") f.skill.system.level = 1;
    if (mode === "owner") f.actor.testUserPermission = () => false;
    if (mode === "duplicate")
      drafts.push(drafts.find((d) => d.id === "accounting"));
    if (mode === "overdraft") drafts.find((d) => d.id === "accounting").to = 10;
    await assert.rejects(f.applyIpUpgrades(f.actor, drafts, 1000));
    assert.equal(f.actor.saved, undefined);
  }
});
test("new role starts at rank 1 for 60 IP and failed save removes created role", async () => {
  const f = fixture();
  const draft = {
    id: "comp-role",
    name: "Fixer",
    kind: "role",
    ability: "Operator",
    from: 0,
    to: 1,
    rate: 60,
    source: {
      _id: "template",
      name: "Fixer",
      type: "role",
      system: { rank: 4, mainRoleAbility: "Operator" },
    },
  };
  await f.applyIpUpgrades(f.actor, [draft], 1000);
  assert.equal(f.actor.created[0].system.rank, 1);
  assert.equal(f.actor.created[0]._id, undefined);
  assert.equal(f.actor.saved["system.improvementPoints.value"], 940);
  f.actor.update = async () => {
    throw new Error("save failed");
  };
  await assert.rejects(
    f.applyIpUpgrades(f.actor, [draft], 1000),
    /save failed/,
  );
  assert.deepEqual(Array.from(f.actor.deleted), ["new-role"]);
});
test("new role blocked until current roles reach rank 4, projected purchases count", async () => {
  const f = fixture();
  f.role.system.rank = 3;
  const draft = {
    id: "new",
    name: "Fixer",
    kind: "role",
    from: 0,
    to: 1,
    rate: 60,
    source: { type: "role", system: {} },
  };
  await assert.rejects(f.applyIpUpgrades(f.actor, [draft], 1000), /rank 4/);
  const current = f.actorUpgrades(f.actor);
  current.find((d) => d.kind === "role").to = 4;
  await f.applyIpUpgrades(f.actor, [...current, draft], 1000);
  assert.equal(f.actor.saved["system.improvementPoints.value"], 700);
});
test("template renders escaped skill names, filters, receipt and disabled purchases", () => {
  const template = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/ip-spending.hbs", import.meta.url),
      "utf8",
    ),
  );
  const html = template({
    skills: [{ name: "<script>", from: 0, to: 3, next: 80 }],
    receipt: [{ name: "Accounting", from: 0, to: 3, cost: 120 }],
    total: 120,
  });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Skills &gt; 0/);
  assert.match(html, /Skills = 0/);
  assert.match(html, /Accounting 0 → 3/);
  assert.match(html, /type="submit" disabled/);
});

test("new role clears template specialty allocation and sets Fixer Haggle to purchased rank", async () => {
  const f = fixture();
  await f.applyIpUpgrades(
    f.actor,
    [
      {
        id: "new",
        name: "Fixer",
        kind: "role",
        from: 0,
        to: 1,
        rate: 60,
        source: {
          type: "role",
          system: {
            rank: 4,
            abilities: [
              { name: "Haggle", rank: 4 },
              { name: "Custom Specialty", rank: 3 },
            ],
          },
        },
      },
    ],
    1000,
  );
  assert.equal(f.actor.created[0].system.abilities[0].rank, 1);
  assert.equal(f.actor.created[0].system.abilities[1].rank, 0);
});

test("IP change during role creation prevents stale save and removes the new role", async () => {
  const f = fixture();
  f.actor.createEmbeddedDocuments = async () => {
    f.actor.system.improvementPoints.value = 950;
    return [{ id: "new-role" }];
  };
  await assert.rejects(
    f.applyIpUpgrades(
      f.actor,
      [
        {
          id: "new",
          name: "Fixer",
          kind: "role",
          from: 0,
          to: 1,
          rate: 60,
          source: { type: "role", system: {} },
        },
      ],
      1000,
    ),
    /IP changed/,
  );
  assert.equal(f.actor.saved, undefined);
  assert.deepEqual(Array.from(f.actor.deleted), ["new-role"]);
});

test("unusual ranks remain visible and do not block valid purchases", async () => {
  const f = fixture();
  for (const rank of [12, undefined, null, -1, 1.5, "bad"])
    f.actor.items.push({
      id: "odd-" + String(rank),
      name: "Unusual " + String(rank),
      type: "skill",
      system: { level: rank },
    });
  const drafts = f.actorUpgrades(f.actor);
  assert.equal(drafts.length, 8);
  assert.equal(drafts.filter((d) => d.blockedReason).length, 6);
  assert.equal(f.upgradeCost(12, 12, 20), 0);
  drafts.find((d) => d.id === "accounting").to = 3;
  await f.applyIpUpgrades(f.actor, drafts, 1000);
  assert.equal(f.actor.saved["system.improvementPoints.value"], 880);
  assert.equal(f.actor.saved.items.length, 1);
  drafts.find((d) => d.id === "odd-undefined").to = 1;
  await assert.rejects(f.applyIpUpgrades(f.actor, drafts, 1000), /changed/);
});
