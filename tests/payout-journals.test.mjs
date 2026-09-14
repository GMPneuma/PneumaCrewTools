import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { journalWorld } from "./journal-world.mjs";

function fixture() {
  let seq = 0;
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const owner = { id: "owner", name: "Owner", isGM: false };
  const stranger = { id: "stranger", name: "Stranger", isGM: false };
  const updates = [];
  const actor = {
    id: "actor",
    name: "Character",
    type: "character",
    testUserPermission: (u) => u.id === owner.id,
    getFlag() {
      throw Error("Actor flags must not store payout records");
    },
    system: {
      wealth: { value: 100, transactions: [] },
      improvementPoints: { value: 0, transactions: [] },
      derivedStats: { humanity: { value: 40, max: 60 } },
      stats: { emp: { value: 4 } },
      reputation: { value: 0, transactions: [] },
    },
    async update(data) {
      updates.push(data);
      for (const [key, v] of Object.entries(data)) {
        assert.ok(
          key.startsWith("system."),
          "only native Actor resources may be written",
        );
        let obj = this;
        const parts = key.split(".");
        for (const part of parts.slice(0, -1)) obj = obj[part];
        obj[parts.at(-1)] = structuredClone(v);
      }
    },
  };
  for (const u of [gm, owner, stranger]) {
    u.getFlag = () => {
      throw Error("User flags must not store receipts");
    };
    u.update = () => {
      throw Error("No User writes");
    };
  }
  const game = {
    user: gm,
    users: [gm, owner, stranger],
    actors: [actor],
    messages: [],
    settings: {
      get(_ns, key) {
        if (key === "privateActivityRolls") return false;
        if (key === "excludedActorIds") return [];
        if (key === "payoutAcknowledgmentsEnabled") return true;
        throw Error("Unexpected setting read: " + key);
      },
      set() {
        throw Error("Campaign records must not use settings");
      },
    },
  };
  const globals = {
    game,
    ...journalWorld(game),
    foundry: { utils: { randomID: () => "id" + ++seq } },
    Hooks: { on() {} },
    FormApplication: class {},
    ui: { notifications: { error() {}, info() {}, warn() {} } },
    document: {
      createElement() {
        return {
          set textContent(v) {
            this.innerHTML = String(v)
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;");
          },
        };
      },
    },
    Roll: class {
      async evaluate() {
        return { total: 7 };
      }
    },
    ChatMessage: {
      async create(data) {
        const m = {
          ...data,
          async delete() {
            game.messages = game.messages.filter((x) => x !== m);
          },
        };
        game.messages.push(m);
        return m;
      },
    },
  };
  const modules = {};
  const stub = {
    "./downtime": {
      withDowntimeLock: (f) => f(),
      applyDowntimeAwards: async () => async () => {},
      openDowntime() {},
    },
    "./headquarters": {
      applyHeadquartersPayout: async () => async () => {},
      openHeadquarters() {},
    },
    "./player-hub-status": { getHubStatus: () => ({}) },
  };
  function load(name) {
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    const code = ts.transpileModule(
      fs.readFileSync("src/" + name + ".ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (k) => stub[k] ?? load(k.slice(2)),
      structuredClone,
      console,
      ...globals,
    });
    return exports;
  }
  const plan = {
    sessionLabel: "Session <one>",
    inGameDate: "2078-02-06",
    notes: "Test payout",
    actors: [
      {
        actor,
        participant: {
          userId: owner.id,
          userName: owner.name,
          actorId: actor.id,
          actorName: actor.name,
        },
        entries: [
          { reward: "money", amount: 25, description: "Pay", scope: "group" },
        ],
        items: [],
      },
    ],
    changes: [
      {
        targetId: actor.id,
        targetName: actor.name,
        reward: "money",
        amount: 25,
        previousValue: 100,
        newValue: 125,
        description: "Pay",
      },
    ],
    factionReputations: [
      {
        actorId: actor.id,
        actorName: actor.name,
        reputation: 2,
        faction: "Crew",
        reason: "Job",
      },
    ],
    hqIpTransactions: [],
    communalItems: [],
    payoutContainer: null,
    humanityPrompts: [
      {
        actorId: actor.id,
        actorName: actor.name,
        userId: owner.id,
        reward: "humanityGain",
        formula: "2d6",
        description: "Recovery",
      },
    ],
  };
  return { game, gm, owner, stranger, actor, updates, load, plan };
}

test("payout execution stores campaign data only in correctly permissioned Journals", async () => {
  const f = fixture();
  await f.load("payout-execution").executePayoutPlan(f.plan);
  assert.equal(f.actor.system.wealth.value, 125);
  const store = f.load("journal-records");
  const reference = store.findRecordJournal("payoutReference");
  const ledger = store.findRecordJournal("payoutLedger");
  assert.equal(store.findRecordJournal("payoutLog"), undefined);
  const personal = store.actorPayoutJournal(f.actor.id);
  assert.equal(reference.name, "Attendance");
  assert.equal(reference.ownership.default, 2);
  assert.equal(reference.ownership.owner, 2);
  assert.equal(reference.ownership.stranger, 2);
  assert.equal(reference.ownership.gm, 3);
  const attendance = store.recordPage(reference, "attendance");
  assert.match(attendance.text.content, /Last Session Name/);
  assert.match(attendance.text.content, /Session &lt;one&gt;/);
  assert.equal(
    f.load("payout-journal").getPayoutJournalData().attendance[0].lastSession,
    f.plan.sessionLabel,
  );
  assert.equal(ledger.ownership.default, 0);
  assert.equal(personal.ownership.default, 0);
  assert.equal(personal.ownership.owner, 3);
  assert.equal(personal.ownership.stranger, 0);
  const crew = f.game.folders.find((x) => x.name === "CrewTools");
  const privateFolder = f.game.folders.find((x) => x.name === "CrewTools-GM");
  assert.equal(privateFolder.folder, crew.id);
  assert.equal(ledger.folder, privateFolder.id);
  assert.equal(reference.folder, crew.id);
  assert.equal(personal.folder, crew.id);
  assert.equal(f.load("payout-ledger").getPayoutLedger().records.length, 1);
  assert.equal(
    f.load("payout-journal").getPayoutJournalData().attendance[0].actorId,
    "actor",
  );
  assert.equal(f.load("payout-inbox").getAcknowledgments(f.owner).length, 1);
  assert.equal(
    f.load("humanity-prompts").getPendingHumanityRolls(f.actor).length,
    1,
  );
  for (const j of f.game.journal)
    for (const p of j.pages) assert.match(p.text.content, /About this page/);
  const html = ledger.pages[0].text.content;
  for (const section of [
    "Communal Payout",
    "Primary Payout",
    "Individual Payouts",
  ])
    assert.ok(html.includes(section));
  assert.match(html, /@UUID\[Actor.actor\]/);
  assert.match(html, /\+25/);
  assert.match(ledger.pages[0].name, /Session <one>/);
  assert.deepEqual(
    Object.keys(
      f.game.messages[0].flags["pneuma-crewtools"].humanityPrompt,
    ).sort(),
    ["actorId", "id"],
  );
});

test("offline owner acknowledgment archives receipt without changing resources", async () => {
  const f = fixture();
  await f.load("payout-execution").executePayoutPlan(f.plan);
  f.game.user = f.owner;
  f.gm.active = false;
  const inbox = f.load("payout-inbox"),
    receipt = inbox.getAcknowledgments(f.owner)[0];
  assert.equal(inbox.waitingPayoutCount(), 1);
  await inbox.acknowledgePayout(f.owner, receipt.id);
  assert.equal(inbox.waitingPayoutCount(), 0);
  const stored = inbox.getAcknowledgments(f.owner);
  assert.equal(stored.length, 1);
  assert.ok(stored[0].acknowledgedAt);
  assert.equal(f.actor.system.wealth.value, 125);
  assert.match(
    f
      .load("journal-records")
      .actorPayoutJournal("actor")
      .pages.find((p) => p.name === "Payout Receipts").text.content,
    /Acknowledged/,
  );
});

test("offline owner resolves Humanity using its Journal and retains the result", async () => {
  const f = fixture();
  await f.load("payout-execution").executePayoutPlan(f.plan);
  f.game.user = f.owner;
  f.gm.active = false;
  const api = f.load("humanity-prompts"),
    prompt = api.getPendingHumanityRolls(f.actor)[0];
  await api.resolvePendingHumanityRoll("actor", prompt.id);
  assert.equal(f.actor.system.derivedStats.humanity.value, 47);
  assert.equal(f.actor.system.stats.emp.value, 4);
  assert.equal(api.getPendingHumanityRolls(f.actor).length, 0);
  const result = f
    .load("journal-records")
    .actorPayoutRecords("actor", "humanity")[0];
  assert.equal(result.rollTotal, 7);
  assert.equal(result.previousHumanity, 40);
  assert.equal(result.newHumanity, 47);
  assert.ok(result.resolvedAt);
  await assert.rejects(
    api.resolvePendingHumanityRoll("actor", prompt.id),
    /already been resolved/,
  );
});

test("another player cannot acknowledge or resolve the character's Journal actions", async () => {
  const f = fixture();
  await f.load("payout-execution").executePayoutPlan(f.plan);
  f.game.user = f.stranger;
  const inbox = f.load("payout-inbox"),
    api = f.load("humanity-prompts");
  await assert.rejects(
    inbox.acknowledgePayout(f.owner, inbox.getAcknowledgments(f.owner)[0].id),
    /another recipient/,
  );
  await assert.rejects(
    api.resolvePendingHumanityRoll(
      "actor",
      api.getPendingHumanityRolls(f.actor)[0].id,
    ),
    /another player/,
  );
  assert.equal(f.actor.system.derivedStats.humanity.value, 40);
});

test("receipt and Humanity rollback restore Journal records without User or Actor flags", async () => {
  const f = fixture(),
    api = f.load("humanity-prompts"),
    inbox = f.load("payout-inbox");
  const prompt = api.createPendingHumanityRoll(
    f.plan.humanityPrompts[0],
    "payout",
  );
  const undoRolls = await api.appendPendingHumanityRolls(f.actor, [prompt]);
  const undoReceipts = await inbox.createPayoutAcknowledgments(
    "payout",
    f.plan,
  );
  assert.equal(api.getPendingHumanityRolls(f.actor).length, 1);
  assert.equal(inbox.getAcknowledgments(f.owner).length, 1);
  await undoReceipts();
  await undoRolls();
  assert.equal(api.getPendingHumanityRolls(f.actor).length, 0);
  assert.equal(inbox.getAcknowledgments(f.owner).length, 0);
  assert.equal(f.updates.length, 0);
});

test("Journal identity survives renaming and history clearing does not reverse rewards", async () => {
  const f = fixture();
  await f.load("payout-execution").executePayoutPlan(f.plan);
  const store = f.load("journal-records"),
    j = store.actorPayoutJournal("actor"),
    id = j.id;
  j.name = "Custom journal label";
  f.actor.name = "Renamed";
  await store.ensureActorPayoutJournal(f.actor);
  assert.equal(store.actorPayoutJournal("actor").id, id);
  assert.equal(f.load("payout-inbox").getAcknowledgments(f.owner).length, 1);
  await f.load("payout-ledger").clearPayoutLedger();
  assert.equal(f.load("payout-ledger").getPayoutLedger().records.length, 0);
  assert.equal(f.actor.system.wealth.value, 125);
});

test("absent characters receive only a downtime receipt and a separate ledger section, without attendance", async () => {
  const f = fixture();
  const away = {
    ...f.actor,
    id: "away",
    name: "Absent",
    testUserPermission: (u) => u.id === f.stranger.id,
    update: async () => {
      throw Error("Absent Actor must not change");
    },
  };
  f.game.actors.push(away);
  const draft = {
    ...f.plan,
    absentDowntime: [
      {
        actor: away,
        participant: {
          userId: f.stranger.id,
          userName: f.stranger.name,
          actorId: away.id,
          actorName: away.name,
        },
        days: 5,
      },
    ],
  };
  draft.actors[0].entries.push({
    reward: "downtime",
    amount: 3,
    description: "Rest",
    scope: "group",
  });
  const plan = f
    .load("payout-plan")
    .buildPayoutPlan(draft, { attendance: [], factionReputations: [] });
  await f.load("payout-execution").executePayoutPlan(plan);
  const attendance = f.load("payout-journal").getPayoutJournalData().attendance;
  assert.equal(attendance.length, 1);
  assert.equal(attendance[0].actorId, f.actor.id);
  const receipts = f
    .load("journal-records")
    .actorPayoutRecords("away", "acknowledgments");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].awards.length, 1);
  assert.match(receipts[0].awards[0].text, /Downtime/);
  const ledger = f.load("journal-records").findRecordJournal("payoutLedger");
  assert.match(
    Array.from(ledger.pages)[0].text.content,
    /Downtime — not in payout/,
  );
});

test("Humanity cleanup skips unused Actors and preserves completed rolls", async () => {
  const f = fixture(),
    api = f.load("humanity-prompts"),
    store = f.load("journal-records");
  f.game.actors.push({ ...f.actor, id: "shared-car", name: "Shared Car" });
  assert.equal(await api.clearAllPendingHumanityRolls(), 0);
  assert.equal(f.game.journal.size, 0);
  const pending = api.createPendingHumanityRoll(
    f.plan.humanityPrompts[0],
    "payout",
  );
  const completed = { ...pending, id: "completed", resolvedAt: "2078-02-06" };
  await store.saveActorPayoutRecords(f.actor, "humanity", [pending, completed]);
  const count = f.game.journal.size;
  assert.equal(await api.clearAllPendingHumanityRolls(), 1);
  assert.equal(f.game.journal.size, count);
  assert.equal(store.actorPayoutJournal("shared-car"), undefined);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(store.actorPayoutRecords(f.actor.id, "humanity")),
    ),
    [completed],
  );
  assert.equal(await api.clearAllPendingHumanityRolls(), 0);
});

test("generated Journals keep summaries without duplicate titles or raw field dumps", async () => {
  const f = fixture();
  await f.load("payout-execution").executePayoutPlan(f.plan);
  const journal = f.load("journal-records").actorPayoutJournal(f.actor.id);
  const before = JSON.stringify(journal.pages.map((p) => p.flags));
  for (const page of journal.pages) {
    assert.doesNotMatch(
      page.text.content,
      /<h1>|<th>Field<\/th>|<summary>Record 1<\/summary>/,
    );
    assert.match(page.text.content, /<summary>About this page<\/summary>/);
  }
  await f.load("journal-records").refreshRecordTables();
  assert.equal(JSON.stringify(journal.pages.map((p) => p.flags)), before);
  for (const page of journal.pages)
    assert.doesNotMatch(page.text.content, /<h1>|<th>Field<\/th>/);
});

test("factions use character pages and rollback without changing native reputation", async () => {
  const f = fixture(),
    api = f.load("factions"),
    journal = f.load("payout-journal"),
    store = f.load("journal-records");
  await journal.ensurePayoutJournal();
  assert.equal(store.actorPayoutJournal(f.actor.id), undefined);
  assert.equal(
    store.recordPage(store.findRecordJournal("payoutReference"), "reputation"),
    undefined,
  );
  const gang = await api.addFaction("Tyger Claws");
  f.plan.factionReputations = [
    {
      actorId: f.actor.id,
      actorName: f.actor.name,
      factionId: gang.id,
      faction: gang.name,
      reputation: 4,
      reason: "Helped the crew",
    },
  ];
  const undo = await journal.applyPayoutToJournal(f.plan);
  const page = store.recordPage(
    store.actorPayoutJournal(f.actor.id),
    "factionReputation",
  );
  assert.equal(page.name, "Faction Reputation");
  assert.match(page.text.content, /Tyger Claws/);
  assert.equal(api.getFactionReputations()[0].reputation, 4);
  assert.equal(f.actor.system.reputation.value, 0);
  assert.equal(f.updates.length, 0);
  f.plan.factionReputations[0].reputation = 6;
  const undoSecond = await journal.applyPayoutToJournal(f.plan);
  assert.equal(api.getFactionReputations().length, 1);
  assert.equal(api.getFactionReputations()[0].reputation, 6);
  await undoSecond();
  assert.equal(api.getFactionReputations()[0].reputation, 4);
  await undo();
  assert.equal(api.getFactionReputations().length, 0);
});

test("factions rename and hide without losing balances; names are unique and GM-managed", async () => {
  const f = fixture(),
    api = f.load("factions");
  const gang = await api.addFaction("Claws");
  await api.saveFactionReputations(f.actor, [
    {
      actorId: f.actor.id,
      actorName: f.actor.name,
      factionId: gang.id,
      faction: gang.name,
      reputation: 3,
      reason: "Job",
    },
  ]);
  await api.saveFactions([{ ...gang, name: "Tyger <Claws>", active: false }]);
  const rows = api.getFactionReputations();
  assert.equal(rows[0].factionId, gang.id);
  assert.equal(rows[0].faction, "Tyger <Claws>");
  assert.equal(rows[0].reputation, 3);
  assert.equal(api.getFactions()[0].active, false);
  await assert.rejects(api.addFaction(" tyger <claws> "), /unique name/);
  await assert.rejects(api.addFaction(" "), /unique name/);
  const store = f.load("journal-records");
  await store.refreshRecordTables();
  const page = store.recordPage(
    store.actorPayoutJournal(f.actor.id),
    "factionReputation",
  );
  assert.match(page.text.content, /Tyger &lt;Claws&gt;/);
  assert.doesNotMatch(page.text.content, /<th>Field/);
  f.game.user = f.owner;
  await assert.rejects(api.addFaction("New gang"), /Only a GM/);
});

test("Journal setup skips unchanged metadata and history writes omit unchanged payloads", async () => {
  const f = fixture();
  const api = f.load("journal-records");
  const j = await api.ensureActorPayoutJournal(f.actor);
  const changes = [];
  const update = j.update.bind(j);
  j.update = async (data) => {
    changes.push(data);
    await update(data);
  };
  await api.ensureActorPayoutJournal(f.actor);
  assert.equal(changes.length, 0);
  f.actor.name = "Renamed";
  await api.ensureActorPayoutJournal(f.actor);
  assert.deepEqual(Object.keys(changes[0]), ["name"]);
  await api.writeRecord(j, "testHistory", "History", [{ id: 1 }], "", "first");
  const p = api.recordPage(j, "testHistory");
  const writes = [];
  const save = p.update.bind(p);
  p.update = async (data) => {
    writes.push(data);
    await save(data);
  };
  await api.writeRecord(j, "testHistory", "History", [{ id: 1 }], "", "first");
  assert.equal(writes.length, 0);
  await api.writeRecord(j, "testHistory", "History", [{ id: 1 }], "", "second");
  assert.deepEqual(Object.keys(writes[0]), ["text.content"]);
});
