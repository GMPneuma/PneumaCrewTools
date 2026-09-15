import { journalWorld } from "./journal-world.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  const p = { id: "u1", name: "Player", isGM: false, active: true };
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const makeActor = (id, name, type = "character") => ({
    id,
    name,
    type,
    testUserPermission: (u) => u.id === p.id,
    update: () => {
      throw Error("Actor must not be updated");
    },
  });
  const one = makeActor("a1", "One"),
    two = makeActor("a2", "Two"),
    car = makeActor("car", "One");
  const actors = new Map([one, two, car].map((a) => [a.id, a]));
  actors[Symbol.iterator] = function* () {
    yield* this.values();
  };
  p.character = car;
  const values = new Map([
    ["excludedActorIds", ["car"]],
    ["payoutJournalData", { attendance: [], factionReputations: [] }],
  ]);
  const configs = new Map(),
    menus = new Map();
  const game = {
    user: gm,
    users: [gm, p],
    actors,
    journal: new Map(),
    settings: {
      get: (_ns, key) => values.get(key),
      set: async (_ns, key, value) => values.set(key, structuredClone(value)),
      register: (_ns, key, config) => configs.set(key, config),
      registerMenu: (_ns, key, config) => menus.set(key, config),
    },
  };
  const { JournalEntry, Folder } = journalWorld(game);
  const modules = {};
  function load(name) {
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    const code = ts.transpileModule(
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
    ).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (path) => load(path.slice(2)),
      game,
      JournalEntry,
      Folder,
      FormApplication: class {},
      Hooks: { on() {} },
      structuredClone,
      Error,
      ui: { notifications: { info() {}, error() {} } },
    });
    return exports;
  }
  return { game, values, configs, menus, one, two, car, p, gm, load };
}

test("exclusions use stable IDs, filter discovery and shared-owner lists, and survive renaming", () => {
  const f = fixture(),
    policy = f.load("actor-policy");
  assert.equal(policy.isActorExcluded("car"), true);
  assert.equal(policy.isActorExcluded("a1"), false);
  f.car.name = "New vehicle name";
  assert.equal(policy.isActorExcluded("car"), true);
  const accounts = f.load("player-discovery").discoverPlayerAccounts();
  assert.deepEqual(
    Array.from(accounts[0].actors, (a) => a.actorId),
    ["a1", "a2"],
  );
  assert.equal(accounts[0].assignedActorId, null);
  f.game.users.push({ ...f.p, id: "u2" });
  f.one.testUserPermission = () => true;
  assert.equal(
    policy.accessibleCrewActors().filter((a) => a.id === "a1").length,
    1,
  );
});

test("Hide Player Actors lists only non-GM-owned Actors and remains GM-only", async () => {
  const f = fixture();
  f.load("actor-exclusions").registerActorExclusions();
  const menu = f.menus.get("actorExclusions");
  assert.equal(menu.restricted, true);
  assert.equal(menu.name, "Hide Player Actors");
  assert.equal(menu.label, "Hide Player Actors");
  f.game.actors.set("gm-only", {
    id: "gm-only",
    name: "GM only",
    type: "character",
    testUserPermission: (u) => u.isGM,
  });
  f.game.actors.set("observer", {
    id: "observer",
    name: "Observer access",
    type: "character",
    testUserPermission: (u, level) => level !== "OWNER",
  });
  const form = new menu.type();
  assert.equal(form.getData().actors.length, 3);
  assert.equal(
    form.getData().actors.find((a) => a.id === "car").excluded,
    true,
  );
  await form._updateObject({}, { "exclude.a1": true, "exclude.unknown": true });
  assert.deepEqual(f.values.get("excludedActorIds"), ["a1"]);
  f.game.user = f.p;
  await assert.rejects(form._updateObject({}, {}), /Only GMs/);
});

test("attendance is counted once per Actor, separately for two characters owned by one user", async () => {
  const f = fixture(),
    api = f.load("payout-journal");
  const plan = {
    sessionLabel: "Session",
    factionReputations: [],
    actors: [
      { actor: f.one },
      { actor: f.one },
      { actor: f.two },
      { actor: f.car },
    ],
  };
  await api.applyPayoutToJournal(plan);
  const rows = api.getPayoutJournalData().attendance;
  assert.deepEqual(
    Array.from(rows, (r) => [r.actorId, r.sessions]),
    [
      ["a1", 1],
      ["a2", 1],
    ],
  );
  f.one.name = "Renamed";
  await api.applyPayoutToJournal({ ...plan, actors: [{ actor: f.one }] });
  assert.equal(api.getPayoutJournalData().attendance[0].sessions, 2);
  const journal = f.game.journal.values().next().value;
  const html = journal.pages.find((p) => p.name === "Attendance").text.content;
  assert.match(html, /@UUID\[Actor.a1\]\{Renamed\}/);
  assert.doesNotMatch(html, /Actor.car/);
});

test("attendance uses only Journals and clears its authoritative page", async () => {
  const f = fixture(),
    api = f.load("payout-journal");
  f.values.set("payoutJournalData", {
    attendance: [{ actorId: "a1", actorName: "Old", sessions: 99 }],
    factionReputations: [],
  });
  await api.applyPayoutToJournal({
    actors: [{ actor: f.one }],
    factionReputations: [],
    sessionLabel: "Test",
  });
  assert.equal(api.getPayoutJournalData().attendance[0].sessions, 1);
  assert.equal(f.values.get("payoutJournalData").attendance[0].sessions, 99);
  await api.clearPayoutJournalData("attendance");
  assert.equal(api.getPayoutJournalData().attendance.length, 0);
});

test("Discord mappings use Actor IDs, even when both characters have the same player", () => {
  const f = fixture(),
    api = f.load("discord-summary");
  const plan = {
    sessionLabel: "Test",
    inGameDate: "",
    notes: "",
    actors: [
      { actor: f.one, entries: [], participant: { userId: "u1" } },
      { actor: f.two, entries: [], participant: { userId: "u1" } },
    ],
    changes: [
      {
        targetId: "a1",
        reward: "money",
        amount: 10,
        details: { scope: "individual" },
      },
      {
        targetId: "a2",
        reward: "money",
        amount: 20,
        details: { scope: "individual" },
      },
    ],
    communalItems: [],
    hqIpTransactions: [],
  };
  const text = api.buildDiscordMarkdown(plan, {
    a1: { kind: "user", id: "111" },
    a2: { kind: "user", id: "222" },
  });
  assert.match(text, /<@111>/);
  assert.match(text, /<@222>/);
});

test("upgrade storage is automatically excluded and absent from manual exclusions", () => {
  const f = fixture();
  const storage = {
    id: "holding",
    name: "Upgrade Projects",
    type: "container",
    testUserPermission: () => true,
    getFlag: (_ns, key) => (key === "upgradeProjectsFor" ? "a1" : undefined),
  };
  f.game.actors.set(storage.id, storage);
  f.values.set("excludedActorIds", []);
  f.p.character = storage;
  const policy = f.load("actor-policy");
  assert.equal(policy.isActorExcluded(storage.id), true);
  assert.equal(
    f.load("player-discovery").discoverPlayerAccounts()[0].assignedActorId,
    null,
  );
  f.load("actor-exclusions").registerActorExclusions();
  const Form = f.menus.get("actorExclusions").type;
  assert.ok(!new Form().getData().actors.some((a) => a.id === storage.id));
});

test("absent character selection never awards excluded cars or all alternate characters", () => {
  const f = fixture();
  const candidates = f.load("player-discovery").discoverPlayerAccounts();
  const absent = f.load("payout-absence").absentRecipients(candidates, []);
  assert.deepEqual(
    Array.from(absent, (p) => p.actorId),
    ["a1"],
  );
});

test("Crew filtering reads the Actor collection once and picks up permission and exclusion changes immediately", () => {
  const f = fixture();
  const policy = f.load("actor-policy");
  let visits = 0;
  f.game.actors[Symbol.iterator] = function* () {
    for (const actor of this.values()) {
      visits++;
      yield actor;
    }
  };
  assert.equal(policy.accessibleCrewActors().length, 2);
  assert.equal(visits, f.game.actors.size);
  f.values.set("excludedActorIds", ["car", "a1"]);
  assert.deepEqual(
    Array.from(policy.accessibleCrewActors(), (a) => a.id),
    ["a2"],
  );
  f.two.testUserPermission = () => false;
  assert.equal(policy.accessibleCrewActors().length, 0);
});
