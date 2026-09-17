import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(name, globals, deps) {
  const cache = (globals.__modules ??= new Map());
  const overrides = (globals.__deps ??= deps);
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  cache.set(name, exports);
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
    require: (key) =>
      key in overrides
        ? overrides[key]
        : load(key.slice(2), globals, overrides),
    Error,
    structuredClone,
    console,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return exports;
}
const model = load(
  "downtime-model",
  {},
  { "./downtime-healing": load("downtime-healing", {}, {}) },
);
const activities = load(
  "downtime-activities",
  {},
  { "./downtime-model": model },
);
function fixture() {
  let id = 0;
  const gm = { id: "gm", name: "GM", isGM: true, active: true };
  const p1 = { id: "p1", name: "Player One", isGM: false, active: true };
  const p2 = { id: "p2", name: "Player Two", isGM: false, active: false };
  const actor = {
    id: "tech1",
    name: "Tech",
    type: "character",
    system: {
      wealth: {
        value: 100,
        transactions: [["Existing income", "Before hustle"]],
      },
      stats: { body: { value: 5 } },
      derivedStats: { hp: { value: 10, max: 40 } },
    },
    update: async (data) => {
      if ("system.wealth.value" in data)
        actor.system.wealth.value = data["system.wealth.value"];
      if ("system.wealth.transactions" in data)
        actor.system.wealth.transactions = structuredClone(
          data["system.wealth.transactions"],
        );
      if ("system.derivedStats.hp.value" in data)
        actor.system.derivedStats.hp.value =
          data["system.derivedStats.hp.value"];
    },
    testUserPermission: (user) => user.id === "p1",
    items: [
      {
        id: "tech-role",
        name: "Tech",
        type: "role",
        system: { rank: 4, mainRoleAbility: "Maker" },
      },
      {
        id: "fixer-role",
        name: "Fixer",
        type: "role",
        system: { rank: 2, mainRoleAbility: "Operator" },
      },
    ],
  };
  p1.character = actor;
  const game = {
    actors: [actor],
    user: gm,
    users: [gm, p1, p2],
    journal: new Map(),
    folders: [],
    tables: [],
    settings: {
      registerMenu() {},
      register() {},
      get: (_ns, key) => (key === "requireFullDowntimeWeek" ? false : true),
    },
  };
  game.journal[Symbol.iterator] = function* () {
    yield* this.values();
  };
  game.actors.get = (id) => game.actors.find((a) => a.id === id);
  const headquarters = { headquarters: [] };
  const notices = [];
  const messages = [];
  const dialogs = [];
  const hooks = new Map();
  let failSave = false;
  function doc(data) {
    const d = {
      id: String(++id),
      _stats: { lastModifiedBy: game.user.id },
      ...structuredClone(data),
    };
    d.getFlag = (ns, key) => d.flags?.[ns]?.[key];
    d.update = async (update) => {
      if (failSave && d.getFlag("pneuma-crewtools", "kind") === "actorLedger")
        throw Error("write failed");
      for (const [key, value] of Object.entries(update)) {
        const parts = key.split(".");
        let target = d;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        if (parts.at(-1).startsWith("-=")) delete target[parts.at(-1).slice(2)];
        else if (key === "flags.pneuma-crewtools.medical")
          target[parts.at(-1)] = {
            ...target[parts.at(-1)],
            ...structuredClone(value),
          };
        else target[parts.at(-1)] = structuredClone(value);
      }
    };
    return d;
  }
  const JournalEntry = {
    create: async (data) => {
      const j = doc({ ...data, pages: undefined });
      j.pages = (data.pages ?? []).map(doc);
      j.createEmbeddedDocuments = async (_type, pages) => {
        const result = pages.map(doc);
        j.pages.push(...result);
        return result;
      };
      game.journal.set(j.id, j);
      return j;
    },
  };
  const api = load(
    "downtime",
    {
      game,
      FormApplication: class {
        static get defaultOptions() {
          return {};
        }
        position = {};
        setPosition(position) {
          Object.assign(this.position, position);
          return this.position;
        }
        closeCalls = 0;
        activeRenders = 0;
        renderCount = 0;
        maxRenders = 0;
        activateListeners() {}
        render() {
          return this;
        }
        async close() {
          this.closeCalls++;
        }
        async _onSubmit(event, options = {}) {
          await this._updateObject(event, options.updateData);
          if (!options.preventClose) await this.close();
        }
        async _render() {
          this.renderCount++;
          this.activeRenders++;
          this.maxRenders = Math.max(this.maxRenders, this.activeRenders);
          await Promise.resolve();
          this.activeRenders--;
        }
      },
      Dialog: class {
        constructor(config) {
          dialogs.push(config);
        }
        render() {
          return this;
        }
      },
      ui: {
        notifications: Object.fromEntries(
          ["info", "error", "warn"].map((k) => [
            k,
            (text) => notices.push(text),
          ]),
        ),
      },
      Hooks: { on: (name, cb) => hooks.set(name, cb) },
      Folder: {
        create: async (data) => {
          const f = {
            id: String(++id),
            ...data,
            folder: game.folders.find((f) => f.id === data.folder) ?? null,
          };
          game.folders.push(f);
          return f;
        },
      },
      JournalEntry,
      fromUuid: async (uuid) =>
        game.actors.flatMap((a) => a.items ?? []).find((i) => i.uuid === uuid),
      Actor: {
        create: async (data) => {
          const a = doc(data);
          a.items = [];
          game.actors.push(a);
          return a;
        },
      },
      foundry: { utils: { randomID: () => "item" + ++id } },
      ChatMessage: {
        create: async (data) => {
          messages.push(data);
          return data;
        },
      },
    },
    {
      "./constants": { MODULE_ID: "pneuma-crewtools" },
      "./id": { createUniqueId: () => "event-" + ++id },
      "./calendar": { getCampaignDate: () => "2078-02-06" },
      "./payout-ledger": {
        getPayoutLedger: () => ({ records: [{ inGameDate: "2078-02-01" }] }),
      },
      "./downtime-model": model,
      "./headquarters": { getHeadquarters: () => headquarters },
      "./downtime-healing": load("downtime-healing", {}, {}),
      "./downtime-activities": activities,
    },
  );
  const plan = (days, user = p1) => ({
    sessionLabel: "Gig One",
    inGameDate: "2078-02-06",
    actors: [
      {
        actor: user.character,
        participant: { userId: user.id, userName: user.name },
        entries: days
          ? [{ reward: "downtime", amount: days, scope: "group" }]
          : [],
      },
    ],
  });
  async function drain() {
    await api.withDowntimeLock(async () => {});
  }
  async function process() {
    game.user = gm;
    api.readyDowntime();
    await drain();
  }
  async function award(days = 5, payoutId = "payout-1") {
    return api.withDowntimeLock(() =>
      api.applyDowntimeAwards(plan(days), payoutId),
    );
  }
  function requests(user = p1) {
    const a = api
      .getDowntime()
      .accounts.find((a) => a.actorId === user.character.id);
    return game.journal.get(a.characterJournalId);
  }
  return {
    api,
    game,
    gm,
    p1,
    p2,
    award,
    plan,
    process,
    hooks,
    drain,
    requests,
    notices,
    messages,
    dialogs,
    headquarters,
    JournalEntry,
    balance: () => {
      const expected = model.downtimeBalance(api.getDowntime(), actor.id);
      const page = requests()?.pages.find(
        (p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger",
      );
      if (page)
        assert.equal(
          page.getFlag("pneuma-crewtools", "downtimeBalance"),
          expected,
          "stored balance agrees after awards, spending, failures and rollbacks",
        );
      return expected;
    },
    failSave: (value) => {
      failSave = value;
    },
  };
}

test("awards live in readable standard Journals with correct folder and player permissions; rollback restores balance", async () => {
  const f = fixture();
  const undo = await f.award();
  assert.equal(f.balance(), 5);
  assert.deepEqual(
    f.game.folders.filter((f) => f.type === "JournalEntry").map((f) => f.name),
    ["CrewTools", "CrewTools-GM"],
  );
  const ledger = [...f.game.journal].find(
    (j) => j.getFlag("pneuma-crewtools", "downtime") === "ledger",
  );
  assert.equal(ledger.ownership.default, 2);
  assert.equal(ledger.name, "Downtime Directory");
  const technicalFolder = f.game.folders.find(
    (folder) =>
      folder.name === "CrewTools-GM" && folder.type === "JournalEntry",
  );
  assert.equal(
    typeof ledger.folder === "string" ? ledger.folder : ledger.folder?.id,
    technicalFolder.id,
  );
  assert.equal(ledger.pages[0].name, "Directory");
  assert.match(ledger.pages[0].text.content, /Tech/);
  assert.match(ledger.pages[0].text.content, /About this page/);
  assert.equal(f.requests().ownership.p1, 3);
  assert.equal(f.requests().ownership.default, 0);
  await assert.rejects(f.award(5), /already been awarded/);
  await f.api.withDowntimeLock(undo);
  assert.equal(f.balance(), 0);
});
test("player spending works with no connected GM and repeat clicks cannot overspend", async () => {
  const f = fixture();
  await f.award();
  f.gm.active = false;
  f.game.user = f.p1;
  const results = await Promise.allSettled([
    f.api.requestDowntimeUse(4, "spend", "Treatment"),
    f.api.requestDowntimeUse(4, "spend", "Work"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.balance(), 1);
  f.api.readyDowntime();
  assert.equal(f.balance(), 1);
});
test("player cannot request another player's days; requests in unrelated Journals are ignored", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  await assert.rejects(
    f.api.requestDowntimeUse(1, "spend", "Other", "p2"),
    /owned character/,
  );
  await f.JournalEntry.create({
    name: "Forged",
    pages: [
      {
        flags: {
          "pneuma-crewtools": {
            downtimeRequest: {
              days: 5,
              kind: "spend",
              reason: "Forged",
              period: 1,
            },
          },
        },
      },
    ],
  });
  await f.process();
  assert.equal(f.balance(), 5);
});
test("session start expires remaining days; obsolete request pages cannot use new awards", async () => {
  const f = fixture();
  await f.award(6);
  f.game.user = f.p1;
  await f.api.requestDowntimeUse(2, "spend", "Practice", "tech1");
  await f.api.requestDowntimeUse(1, "hustle", "Side job", "tech1");
  f.game.user = f.gm;
  await f.api.startNextDowntimeSession();
  assert.equal(f.balance(), 0);
  assert.equal(f.api.getDowntime().period, 2);
  assert.equal(
    f.api.getDowntime().events.find((e) => e.kind === "expire").days,
    3,
  );
  assert.equal(
    f.api.getDowntime().events.find((e) => e.kind === "spend").days,
    2,
  );
  await f.award(5, "payout-2");
  await f.requests().createEmbeddedDocuments("JournalEntryPage", [
    {
      name: "Late",
      flags: {
        "pneuma-crewtools": {
          downtimeRequest: {
            days: 2,
            kind: "spend",
            actorId: "tech1",
            reason: "Late",
            period: 1,
          },
        },
      },
    },
  ]);
  await f.process();
  assert.equal(f.balance(), 5);
  assert.equal(f.api.getDowntime().events.at(-1).kind, "award");
});
test("fractional, negative, unsafe, invalid and empty-purpose spends are rejected", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  for (const days of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(f.api.requestDowntimeUse(days, "spend", "Work"));
  await assert.rejects(f.api.requestDowntimeUse(1, "other", "Work"), /Unknown/);
  await assert.rejects(f.api.requestDowntimeUse(1, "spend", "  "), /Describe/);
  assert.equal(f.balance(), 5);
});
test("only primary active GM can write; serialized payout rollback cannot erase a later spend", async () => {
  const f = fixture();
  f.game.user = f.p1;
  await assert.rejects(f.award(), /first active GM/);
  f.game.user = f.gm;
  await f.award(5);
  const rollback = f.api.withDowntimeLock(async () => {
    const undo = await f.api.applyDowntimeAwards(f.plan(2), "payout-2");
    await undo();
  });
  await rollback;
  f.game.user = f.p1;
  await f.api.requestDowntimeUse(3, "spend", "Study");
  await f.process();
  assert.equal(f.balance(), 2);
});
test("failed owner-ledger writes surface immediately and retain unspent days", async () => {
  const f = fixture();
  await f.award();
  f.gm.active = false;
  f.game.user = f.p1;
  f.failSave(true);
  await assert.rejects(
    f.api.requestDowntimeUse(3, "spend", "Study"),
    /write failed/,
  );
  assert.equal(f.balance(), 5);
  f.failSave(false);
  f.api.readyDowntime();
  assert.equal(f.balance(), 5);
  await f.api.requestDowntimeUse(3, "spend", "Study");
  assert.equal(f.balance(), 2);
});
test("each character gets its own payout days even with the same owner", async () => {
  const f = fixture();
  const second = { ...f.p1.character, id: "tech2", name: "Second Tech" };
  f.game.actors.push(second);
  const plan = f.plan(3);
  plan.actors.push({
    ...plan.actors[0],
    actor: second,
    entries: [
      { reward: "downtime", amount: 3, scope: "group" },
      { reward: "downtime", amount: 2, scope: "individual" },
    ],
  });
  await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(plan, "payout-1"),
  );
  assert.equal(f.balance(), 3);
  assert.equal(model.downtimeBalance(f.api.getDowntime(), "tech2"), 5);
  f.game.user = f.p1;
  await f.api.requestDowntimeUse(2, "spend", "Second character work", "tech2");
  await f.process();
  assert.equal(f.balance(), 3);
  assert.equal(model.downtimeBalance(f.api.getDowntime(), "tech2"), 3);
});

test("invalid stored ledger stops processing without replacing its data", async () => {
  const f = fixture();
  await f.award();
  const ledger = [...f.game.journal].find(
    (j) => j.getFlag("pneuma-crewtools", "downtime") === "ledger",
  );
  const state = f
    .requests()
    .pages.find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger")
    .flags["pneuma-crewtools"].downtime;
  state.events[0].days = -10;
  assert.throws(() => f.api.getDowntime(), /Invalid downtime history/);
  await assert.rejects(f.award(2, "payout-2"), /Invalid downtime history/);
  assert.equal(state.events[0].days, -10);
});
test("player form shows only own account and guards a double submit", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  const form = new f.api.DowntimeForm();
  const view = form.getData();
  assert.equal(view.actors.length, 1);
  assert.equal(view.actors[0].id, "tech1");
  assert.equal(view.balance, 5);
  const data = { actorId: "tech1", days: "2", kind: "spend", reason: "Study" };
  await Promise.all([
    form._updateObject({}, data),
    form._updateObject({}, data),
  ]);
  assert.equal(f.requests().pages.length, 2);
  await f.process();
  assert.equal(f.balance(), 3);
});
test("request processing waits until a payout and its rollback release the lock", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  await f.api.requestDowntimeUse(3, "spend", "Study");
  f.game.user = f.gm;
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const begun = new Promise((resolve) => {
    started = resolve;
  });
  const payout = f.api.withDowntimeLock(async () => {
    const undo = await f.api.applyDowntimeAwards(f.plan(2), "payout-2");
    started();
    await gate;
    await undo();
  });
  await begun;
  f.api.readyDowntime();
  assert.equal(f.balance(), 4);
  release();
  await payout;
  await f.drain();
  assert.equal(f.balance(), 2);
  assert.equal(
    f.api.getDowntime().events.filter((e) => e.kind === "award").length,
    1,
  );
});

test("current TECH slots use Workshop improvements or the explicit setting", async () => {
  const f = fixture();
  await f.award(5);
  f.game.settings.get = () => false;
  assert.equal(f.api.currentTechSlots(), 1);
  f.headquarters.headquarters = [{ improvements: [{ name: "Workshop" }] }];
  assert.equal(f.api.currentTechSlots(), 2);
  f.headquarters.headquarters = [];
  f.game.settings.get = () => true;
  assert.equal(f.api.currentTechSlots(), 3);
  assert.equal(f.api.requestDowntimeProject, undefined);
  assert.equal(f.api.requestCloseProject, undefined);
  assert.equal(f.api.setHqCraftingSlots, undefined);
});
test("multiclass roles are available, but zero rank or missing roles cannot unlock actions", async () => {
  const f = fixture();
  await f.award(8);
  f.game.user = f.p1;
  assert.equal(activities.characterRoles(f.game.actors[0]).length, 2);
  await f.api.requestDowntimeUse(7, "hustle", "Hustle", "tech1");
  f.game.actors[0].items[1].system.rank = 0;
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "fixer-role"),
    /ranked role/,
  );
  f.game.actors[0].items[0].system.rank = 0;
  const view = new f.api.DowntimeForm().getData();
  assert.equal(view.canCraft, false);
  assert.equal(view.canHustle, false);
  await assert.rejects(
    f.api.requestTechAction("techStart", "tech1"),
    /ranked TECH/,
  );
  assert.equal(f.balance(), 1);
});
test("rest heals HP while invalid TECH projects and unowned characters are rejected", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  f.game.actors[0].system.derivedStats.hp.value = 20;
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1");
  assert.equal(f.balance(), 4);
  assert.equal(f.game.actors[0].system.derivedStats.hp.value, 25);
  await assert.rejects(
    f.api.requestTechAction("techDay", "tech1", "missing"),
    /project/i,
  );
  await assert.rejects(
    f.api.requestTechAction("techStart", "not-owned"),
    /owned character/,
  );
});
test("failed hustle allocation changes neither balance nor allocated days", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  f.failSave(true);
  await assert.rejects(
    f.api.requestDowntimeUse(1, "hustle", "Hustle", "tech1"),
    /write failed/,
  );
  assert.equal(f.balance(), 5);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 0);
  const ledger = [...f.game.journal]
    .flatMap((j) => j.pages)
    .find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger");
  assert.equal(ledger.getFlag("pneuma-crewtools", "hustleDays"), 0);
  f.failSave(false);
  await f.api.requestDowntimeUse(1, "hustle", "Hustle", "tech1");
  assert.equal(f.balance(), 4);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 1);
  assert.equal(ledger.getFlag("pneuma-crewtools", "hustleDays"), 1);
});

test("Actor selection changes balances and projects without exposing unowned characters", async () => {
  const f = fixture();
  const second = { ...f.p1.character, id: "tech2", name: "Other character" };
  const privateActor = {
    ...second,
    id: "private",
    testUserPermission: () => false,
  };
  f.game.actors.push(second, privateActor);
  await f.award(5);
  const plan = f.plan(2);
  plan.actors[0].actor = second;
  await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(plan, "second-award"),
  );
  f.game.user = f.p1;
  const form = new f.api.DowntimeForm();
  form.selectedActorId = "tech2";
  let view = form.getData();
  assert.equal(view.balance, 2);
  assert.equal(view.actors.length, 2);
  assert.equal(
    f.api.getDowntime().accounts.some((a) => a.actorId === "private"),
    false,
  );
  assert.equal(view.actors.find((a) => a.selected).id, "tech2");
  form.selectedActorId = "tech1";
  assert.equal(form.getData().balance, 5);
  form.selectedActorId = "private";
  assert.equal(
    form.getData().actors.some((a) => a.id === "private"),
    false,
  );
  assert.equal("accounts" in view, false);
});

test("obsolete request pages cannot spend against another Actor even when the player owns both", async () => {
  const f = fixture();
  const second = { ...f.p1.character, id: "tech2", name: "Second Tech" };
  f.game.actors.push(second);
  await f.award(5);
  await f.requests().createEmbeddedDocuments("JournalEntryPage", [
    {
      name: "Forged character",
      flags: {
        "pneuma-crewtools": {
          downtimeRequest: {
            actorId: "tech2",
            kind: "spend",
            days: 2,
            reason: "Wrong account",
            period: 1,
          },
        },
      },
    },
  ]);
  await f.process();
  assert.equal(f.balance(), 5);
  const event = f.api.getDowntime().events.at(-1);
  assert.equal(event.actorId, "tech1");
  assert.equal(event.kind, "award"); // Obsolete request pages are not commands.
});

test("renames and shared ownership retain one Actor balance, with named ID links and no Actor writes", async () => {
  const f = fixture();
  const actor = f.p1.character;
  actor.update = () => {
    throw Error("Downtime must not update Actors");
  };
  actor.createEmbeddedDocuments = () => {
    throw Error("Downtime must not create Items");
  };
  actor.testUserPermission = (user) => ["p1", "p2"].includes(user.id);
  f.p2.character = actor;
  await f.award(4);
  actor.name = "Renamed Tech";
  await f.process();
  const state = f.api.getDowntime();
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].actorId, "tech1");
  assert.equal(state.accounts[0].name, "Renamed Tech");
  assert.match(f.requests().name, /Renamed Tech/);
  assert.equal(
    f.requests().pages[0].text.content.includes("<th>Field</th>"),
    false,
  );
  assert.equal(f.requests().ownership.p2, 3);
  const ledger = [...f.game.journal].find(
    (j) => j.getFlag("pneuma-crewtools", "downtime") === "ledger",
  );
  assert.match(ledger.pages[0].text.content, /data-uuid="Actor.tech1"/);
  assert.match(ledger.pages[0].text.content, /Renamed Tech/);
  f.game.user = f.p2;
  await f.api.requestDowntimeUse(1, "spend", "Work", actor.id);
  await f.process();
  assert.equal(f.balance(), 3);
  actor.testUserPermission = (user) => user.id === "p1";
  await f.process();
  assert.equal(f.requests().ownership.p2, 0);
  f.game.user = f.p2;
  await assert.rejects(
    f.api.requestDowntimeUse(1, "spend", "Not mine", actor.id),
    /owned character/,
  );
  assert.equal(f.balance(), 3);
});

test("duplicate Actor payout entries cannot multiply downtime", async () => {
  const f = fixture();
  const plan = f.plan(3);
  plan.actors.push(plan.actors[0]);
  await assert.rejects(
    f.api.withDowntimeLock(() => f.api.applyDowntimeAwards(plan, "duplicate")),
    /Duplicate character/,
  );
  assert.equal(f.balance(), 0);
});

test("healing stacks all options, supports both antibiotic settings, and caps HP", () => {
  const heal = load("downtime-healing", {}, {});
  const f = fixture(),
    actor = f.p1.character;
  actor.system.stats.body.value = 6;
  actor.system.derivedStats.hp = { value: 1, max: 100 };
  actor.items.push({
    id: "antibodies",
    type: "cyberware",
    name: "Enhanced Antibodies",
    system: { isInstalled: true },
  });
  const hqs = {
    headquarters: [
      {
        id: "hq1",
        name: "Home",
        improvements: [{ id: "med1", name: "Medbay" }],
      },
    ],
  };
  for (const medbay of [false, true])
    for (const antibiotic of [false, true])
      for (const cryotank of [false, true])
        for (const multiply of [false, true]) {
          const result = heal.healingPreview(
            actor,
            { medbay, antibiotic, cryotank },
            hqs,
            multiply,
          );
          const bonus = antibiotic ? 2 : 0,
            factor = 2 * (cryotank ? 2 : 1);
          assert.equal(
            result.rate,
            (6 + (medbay ? 2 : 0) + (multiply ? bonus : 0)) * factor +
              (multiply ? 0 : bonus),
          );
          if (medbay) assert.equal(result.medbayImprovementId, "med1");
        }
  actor.system.derivedStats.hp.value = 98;
  const capped = heal.healingPreview(
    actor,
    { medbay: true, antibiotic: true, cryotank: true },
    hqs,
    true,
  );
  assert.equal(capped.rate, 40);
  assert.equal(capped.restored, 2);
  assert.equal(capped.after, 100);
  actor.items.at(-1).system.isInstalled = false;
  assert.equal(
    heal.healingPreview(actor, heal.defaultHealingOptions(), hqs, true).rate,
    6,
  );
});

test("medbay is unavailable without an actual improvement, and malformed inputs are rejected", () => {
  const heal = load("downtime-healing", {}, {});
  const f = fixture(),
    actor = f.p1.character,
    opts = heal.defaultHealingOptions();
  assert.throws(
    () =>
      heal.healingPreview(
        actor,
        { ...opts, medbay: true },
        { headquarters: [] },
        true,
      ),
    /Medbay/,
  );
  assert.throws(
    () =>
      heal.healingPreview(
        actor,
        { ...opts, antibiotic: "yes" },
        { headquarters: [] },
        true,
      ),
    /Invalid healing/,
  );
  actor.system.stats.body.value = NaN;
  assert.throws(
    () => heal.healingPreview(actor, opts, { headquarters: [] }, true),
    /BODY or HP/,
  );
});

test("healing records actual HP, spends one day, and cannot replay", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1", {
    healing: { medbay: false, antibiotic: true, cryotank: true },
  });
  await f.process();
  assert.equal(f.p1.character.system.derivedStats.hp.value, 24);
  assert.equal(f.balance(), 4);
  const event = f.api.getDowntime().events.at(-1);
  assert.equal(event.healing.rate, 14);
  assert.equal(event.healing.multiplyAntibiotic, true);
  assert.match(
    f.requests().pages.find((p) => p.name === "Downtime Log").text.content,
    /Healed 14 HP/,
  );
  await f.process();
  assert.equal(f.p1.character.system.derivedStats.hp.value, 24);
  assert.equal(f.balance(), 4);
});

function healingArmor(actor, name, head = 3, body = 2, installed = true) {
  const item = {
    id: "armor-" + actor.items.length,
    name,
    type: "armor",
    system: {
      headLocation: { sp: 11, ablation: head },
      bodyLocation: { sp: 11, ablation: body },
    },
    async update(data) {
      for (const [path, value] of Object.entries(data)) {
        const [, location, field] = path.split(".");
        this.system[location][field] = value;
      }
    },
  };
  const cyberware = {
    id: "implant-" + actor.items.length,
    name,
    type: "cyberware",
    system: { isInstalled: installed },
    async update() {
      throw Error("Rest must not update the cyberware Item");
    },
  };
  actor.items.push(cyberware);
  if (!installed) return cyberware;
  actor.items.push(item);
  return item;
}

test("Rest detects installed cyberware and repairs both armor object locations once, ignores inventory and ordinary armor, and records SP", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  const actor = f.p1.character;
  const armors = [
    "Skin Weave",
    "Subdermal Armor",
    "Heavy Subdermal Plating",
    "Sycust Fleshweave",
  ].map((name) => healingArmor(actor, name));
  const inventory = healingArmor(actor, "Skin Weave", 4, 4, false);
  const ordinary = healingArmor(actor, "Light Armorjack", 4, 4);
  ordinary.type = "armor";
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1", {
    healing: { medbay: false, antibiotic: true, cryotank: true },
  });
  await f.process();
  await f.process();
  for (const item of armors.slice(0, 3)) {
    assert.equal(item.system.headLocation.ablation, 2);
    assert.equal(item.system.bodyLocation.ablation, 1);
    assert.equal(item.system.bodyLocation.sp, 11);
  }
  assert.equal(armors[3].system.headLocation.ablation, 0);
  assert.equal(armors[3].system.bodyLocation.ablation, 0);
  assert.equal(inventory.system.isInstalled, false);
  assert.equal(ordinary.system.bodyLocation.ablation, 4);
  assert.equal(f.balance(), 4);
  assert.match(
    f.api.getDowntime().events.at(-1).reason,
    /Skin Weave \(head\): restored 1 SP/,
  );
  assert.match(
    f.api.getDowntime().events.at(-1).reason,
    /Sycust Fleshweave \(body\): restored 2 SP/,
  );
});

test("full-HP Rest repairs armor, caps ablation at zero, and conditionally explains it below healing", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  const actor = f.p1.character;
  actor.system.derivedStats.hp.value = 40;
  const form = new f.api.DowntimeForm();
  assert.equal(form.getData().armorHealingNote, "");
  assert.equal(form.getData().canHeal, false);
  const item = healingArmor(actor, "Skin Weave", 1, 0);
  const full = healingArmor(actor, "Sycust Fleshweave", 5, 4);
  assert.equal(form.getData().canHeal, true);
  assert.match(
    form.getData().armorHealingNote,
    /1 lost SP.*both body and head per day/,
  );
  assert.match(form.getData().armorHealingNote, /Sycust Fleshweave.*full SP/);
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1");
  assert.equal(actor.system.derivedStats.hp.value, 40);
  assert.equal(item.system.headLocation.ablation, 0);
  assert.equal(item.system.bodyLocation.ablation, 0);
  assert.equal(full.system.headLocation.ablation, 0);
  assert.equal(f.balance(), 4);
  assert.equal(form.getData().canHeal, false);
  assert.match(form.getData().armorHealingNote, /Skin Weave/);
  const template = fs.readFileSync(
    new URL("../static/templates/downtime.hbs", import.meta.url),
    "utf8",
  );
  assert.match(
    template,
    /\{\{healingFormula\}\}[\s\S]*\{\{#if armorHealingNote\}\}/,
  );
});

test("Rest armor audit supports multiple days, old records and rejects corrupt repairs", () => {
  const f = fixture();
  const heal = load("downtime-healing", {}, {});
  healingArmor(f.p1.character, "Skin Weave", 5, 1);
  const result = heal.healingPreview(
    f.p1.character,
    heal.defaultHealingOptions(),
    f.headquarters,
    true,
    3,
  );
  assert.equal(result.armorRepairs[0].after, 2);
  assert.equal(result.armorRepairs[1].after, 0);
  heal.validateHealingResult(result, 3);
  const legacy = structuredClone(result);
  delete legacy.armorRepairs;
  heal.validateHealingResult(legacy, 3);
  result.armorRepairs[0].after = 0;
  assert.throws(() => heal.validateHealingResult(result, 3), /armor record/);
});

test("failed final Rest save rolls back HP and both armor locations without spending a day", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  const actor = f.p1.character;
  const item = healingArmor(actor, "Sycust Fleshweave", 5, 4);
  const page = f.requests().pages.find((p) => p.name === "Downtime Log");
  const update = page.update;
  let writes = 0;
  page.update = async (data) => {
    if (++writes === 2) throw Error("final save failed");
    return update(data);
  };
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /final save failed/,
  );
  assert.equal(actor.system.derivedStats.hp.value, 10);
  assert.equal(item.system.headLocation.ablation, 5);
  assert.equal(item.system.bodyLocation.ablation, 4);
  assert.equal(f.balance(), 5);
  assert.ok(!page.getFlag("pneuma-crewtools", "healingAttempt"));
});

test("uncertain armor write and failed rollback retain the healing marker and block replay", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  const item = healingArmor(f.p1.character, "Skin Weave");
  const update = item.update.bind(item);
  let writes = 0;
  item.update = async (data) => {
    writes++;
    if (writes === 1) await update(data);
    throw Error("lost armor response");
  };
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /rollback failed/,
  );
  await f.process();
  assert.equal(writes, 2);
  assert.equal(f.balance(), 5);
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /GM review/,
  );
});

test("world antibiotic setting is used during immediate owner processing", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  f.game.settings.get = () => false;
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1", {
    healing: { medbay: false, antibiotic: true, cryotank: true },
  });
  f.game.settings.get = () => false;
  await f.process();
  assert.equal(f.p1.character.system.derivedStats.hp.value, 22);
  assert.equal(f.api.getDowntime().events.at(-1).healing.rate, 12);
});

test("failed healing ledger write retains resources and requires a fresh explicit attempt", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  f.failSave(true);
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /write failed/,
  );
  await f.process();
  assert.equal(f.p1.character.system.derivedStats.hp.value, 10);
  assert.equal(f.balance(), 5);
  assert.equal(
    f
      .requests()
      .pages.find((p) => p.name === "Downtime Log")
      .getFlag("pneuma-crewtools", "healingAttempt"),
    undefined,
  );
  f.failSave(false);
  await f.process();
  assert.equal(f.p1.character.system.derivedStats.hp.value, 10);
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1");
  assert.equal(f.p1.character.system.derivedStats.hp.value, 15);
  assert.equal(f.balance(), 4);
});

test("an interrupted HP write blocks automatic replay until GM review", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;

  const update = f.p1.character.update;
  let writes = 0;
  f.p1.character.update = async () => {
    writes++;
    throw Error("Lost HP response");
  };
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /Lost HP response/,
  );
  await f.process();
  await f.process();
  assert.equal(writes, 1);
  assert.equal(f.balance(), 5);
  assert.ok(
    f
      .requests()
      .pages.find((p) => p.name === "Downtime Log")
      .getFlag("pneuma-crewtools", "healingAttempt"),
  );
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /GM review/,
  );
  f.p1.character.update = update;
});

test("full HP and exhausted downtime prevent healing without spending", async () => {
  const f = fixture();
  await f.award(1);
  f.game.user = f.p1;
  f.p1.character.system.derivedStats.hp.value = 40;
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /maximum HP/,
  );
  assert.equal(f.balance(), 1);
  f.p1.character.system.derivedStats.hp.value = 10;
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1");
  await f.process();
  f.game.user = f.p1;
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1"),
    /Not enough/,
  );
  assert.equal(f.p1.character.system.derivedStats.hp.value, 15);
});

test("medbay availability is rechecked before spending and corrupt healing audit data is rejected", async () => {
  const f = fixture();
  await f.award();
  f.headquarters.headquarters.push({
    id: "hq",
    name: "Home",
    improvements: [{ id: "med", name: "Med Bay" }],
  });
  f.game.user = f.p1;
  f.headquarters.headquarters = [];
  await assert.rejects(
    f.api.requestDowntimeUse(1, "rest", "Recover", "tech1", {
      healing: { medbay: true, antibiotic: false, cryotank: false },
    }),
    /Medbay/,
  );
  await f.process();
  assert.equal(f.balance(), 5);
  assert.equal(f.p1.character.system.derivedStats.hp.value, 10);

  f.game.user = f.p1;
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1");
  await f.process();
  const state = f.api.getDowntime();
  state.events.at(-1).healing.restored = 999;
  assert.throws(() => model.validateDowntime(state), /healing record/);
});

test("antibiotic multiplication is a world setting enabled by default", () => {
  const f = fixture(),
    configs = new Map();
  f.game.settings.register = (_ns, key, config) => configs.set(key, config);
  f.api.registerDowntime();
  const config = configs.get("multiplyAntibioticBonus");
  assert.equal(config.name, "Multiply antibiotic bonus");
  assert.equal(config.scope, "world");
  assert.equal(config.default, true);
});

test("excluded Actors disappear from downtime and cannot submit or process pending requests", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;

  f.game.settings.get = (_ns, key) =>
    key === "excludedActorIds" ? ["tech1"] : true;
  const view = new f.api.DowntimeForm().getData();
  assert.equal(view.actors.length, 0);
  await assert.rejects(
    f.api.requestDowntimeUse(1, "spend", "Blocked", "tech1"),
    /owned character/,
  );
  await f.process();
  assert.equal(f.balance(), 5);
  assert.equal(f.api.getDowntime().events.length, 1);
});

function mockHustle(f, role = "Tech", earnings = [100, 200, 500]) {
  let rolls = 0;
  f.game.tables.push({
    id: "table-" + role,
    formula: "1d6",
    getFlag: () => role,
    handleRollDialog: async () => true,
    roll: async () => {
      rolls++;
      return {
        roll: { total: 2 },
        results: [
          {
            id: "result2",
            text: "A client hires you to repair their cyberdeck. No payout tags needed.",
            getFlag: () => ({ roll: 2, activity: "Work <test>", earnings }),
          },
        ],
      };
    },
  });
  return () => rolls;
}
async function allocateHustle(f, days = 8) {
  await f.award(days);
  f.game.user = f.p1;
  await f.api.requestDowntimeUse(
    days,
    "hustle",
    "Hustle allocation",
    f.p1.character.id,
  );
  await f.process();
}
test("hustle spends seven allocated days and pays current role rank to the same Actor once", async () => {
  const f = fixture();
  const rolls = mockHustle(f);
  await allocateHustle(f, 8);
  assert.equal(f.balance(), 0);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 8);
  f.game.user = f.p1;
  f.gm.active = false;
  f.p1.character.items[0].system.rank = 5;
  await f.api.requestHustleRoll("tech1", "tech-role");
  f.gm.active = true;
  await f.process();
  assert.equal(f.p1.character.system.wealth.value, 300);
  assert.equal(f.p1.character.system.wealth.transactions.length, 2);
  assert.match(
    f.p1.character.system.wealth.transactions[1][0],
    /Increased by 200 to 300/,
  );
  assert.equal(
    f.p1.character.system.wealth.transactions[1][1],
    "Hustle — 2-6-2078 — Tech (rank 5)",
  );
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 1);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].content, /Work &lt;test&gt;/);
  assert.deepEqual(Array.from(f.messages[0].whisper), ["gm", "p1"]);
  const event = f.api.getDowntime().events.find((e) => e.kind === "hustleRoll");
  assert.equal(event.hustleReward.rank, 5);
  assert.equal(
    event.hustleReward.resultText,
    "A client hires you to repair their cyberdeck. No payout tags needed.",
  );
  const view = load("downtime-journal-view", {}, {});
  assert.match(
    view.resourceTransactionsHtml(f.api.getDowntime()),
    /A client hires you to repair their cyberdeck/,
  );
  assert.equal(event.roleItemId, "tech-role");
  await f.process();
  assert.equal(rolls(), 1);
  assert.equal(f.p1.character.system.wealth.value, 300);
  assert.equal(f.messages.length, 1);
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /seven hustle days/,
  );
});
test("hustle uses each rank band including zero rewards and multiclass selection", async () => {
  for (const [rank, expected] of [
    [1, 0],
    [4, 0],
    [5, 100],
    [7, 100],
    [8, 300],
    [10, 300],
  ]) {
    const f = fixture();
    const rolls = mockHustle(f, "Fixer", [0, 100, 300]);
    f.p1.character.items[1].system.rank = rank;
    await allocateHustle(f, 7);
    await f.api.requestHustleRoll("tech1", "fixer-role");
    await f.drain();
    assert.equal(f.p1.character.system.wealth.value, 100 + expected);
    assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 0);
    assert.equal(rolls(), 1);
  }
});
test("hustle requires owned Actor, seven days and a current role; rechecks at processing", async () => {
  const f = fixture();
  const rolls = mockHustle(f);
  await allocateHustle(f, 7);
  f.game.user = f.p2;
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /owned character/,
  );
  f.game.user = f.p1;
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "missing"),
    /ranked role/,
  );
  f.p1.character.items = [];
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /ranked role/,
  );
  await f.process();
  assert.equal(rolls(), 0);
  assert.equal(f.p1.character.system.wealth.value, 100);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 7);
});
test("queued hustle requests cannot overspend the allocated pool", async () => {
  const f = fixture();
  const rolls = mockHustle(f);
  await allocateHustle(f, 7);
  f.game.user = f.p1;
  const results = await Promise.allSettled([
    f.api.requestHustleRoll("tech1", "tech-role"),
    f.api.requestHustleRoll("tech1", "tech-role"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await f.process();
  assert.equal(rolls(), 1);
  assert.equal(f.p1.character.system.wealth.value, 200);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 0);
  assert.equal(
    f.api.getDowntime().events.filter((e) => e.kind === "rejected").length,
    0,
  );
});
test("malformed table result does not change money or allocated days", async () => {
  const f = fixture();
  mockHustle(f, "Tech", [100, -2, 500]);
  await allocateHustle(f, 7);
  f.game.user = f.p1;
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /Invalid structured/,
  );
  await f.process();
  assert.equal(f.p1.character.system.wealth.value, 100);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 7);
  assert.equal(f.messages.length, 0);
});
test("failed hustle ledger save rolls back money and retains allocated days", async () => {
  const f = fixture();
  mockHustle(f);
  await allocateHustle(f, 7);
  f.game.user = f.p1;

  // Permit the attempt marker; fail only the accepted ledger state write.
  const ledger = [...f.game.journal.values()]
    .flatMap((j) => j.pages)
    .find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger");
  const update = ledger.update;
  ledger.update = async (data) => {
    if (
      data["flags.pneuma-crewtools.downtime"]?.events.some(
        (e) => e.kind === "hustleRoll",
      )
    )
      throw Error("reward ledger failure");
    return update(data);
  };
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /reward ledger failure/,
  );
  await f.process();
  assert.equal(f.p1.character.system.wealth.value, 100);
  assert.deepEqual(f.p1.character.system.wealth.transactions, [
    ["Existing income", "Before hustle"],
  ]);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 7);
  assert.equal(
    ledger.getFlag("pneuma-crewtools", "hustleAttempt").rolledBack,
    true,
  );
  await f.process();
  assert.equal(f.p1.character.system.wealth.value, 100);
  assert.deepEqual(f.p1.character.system.wealth.transactions, [
    ["Existing income", "Before hustle"],
  ]);
  assert.equal(f.messages.length, 0);
});
test("ambiguous money write blocks replay and retains GM-visible payment attempt", async () => {
  const f = fixture();
  const rolls = mockHustle(f);
  await allocateHustle(f, 7);
  f.game.user = f.p1;

  f.p1.character.update = async (data) => {
    f.p1.character.system.wealth.value = data["system.wealth.value"];
    throw Error("lost money response");
  };
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /lost money response/,
  );
  await f.process();
  await f.process();
  assert.equal(rolls(), 1);
  assert.equal(f.p1.character.system.wealth.value, 200);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 7);
  const ledger = [...f.game.journal.values()]
    .flatMap((j) => j.pages)
    .find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger");
  assert.equal(
    ledger.getFlag("pneuma-crewtools", "hustleAttempt").reward.amount,
    100,
  );
  assert.match(ledger.text.content, /Payment in progress/);
});
test("downtime form exposes compact healing and dedicated Actor hustle pool", async () => {
  const f = fixture();
  await allocateHustle(f, 8);
  const form = new f.api.DowntimeForm();
  form.selectedHustleRoleId = "fixer-role";
  const data = form.getData();
  assert.equal(data.hustleDays, 8);
  assert.equal(data.canRollHustle, true);
  assert.equal(data.canAddHustle, false);
  assert.equal(data.multipleRoles, true);
  assert.equal(data.roles.find((r) => r.selected).id, "fixer-role");
  assert.match(data.healingFormula, /BODY 5/);
  assert.equal(data.projects, undefined);
  assert.equal(data.techSlots.length, 3);
});

test("allocated hustle survives next session and single-role form needs no dropdown", async () => {
  const f = fixture();
  mockHustle(f);
  await allocateHustle(f, 8);
  await f.api.startNextDowntimeSession();
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 8);
  f.p1.character.items = f.p1.character.items.slice(0, 1);
  const data = new f.api.DowntimeForm().getData();
  assert.equal(data.multipleRoles, false);
  assert.equal(data.roles.length, 1);
  assert.equal(data.canRollHustle, true);
});

test("TECH player requests use native owner rolls without a connected GM and deliver once through the Journal pipeline", async () => {
  const f = fixture();
  await f.award(2);
  f.game.settings.get = (_ns, key) =>
    key === "techCraftingMonthDays"
      ? 28
      : key === "techMultipleWithoutWorkshop"
        ? false
        : true;
  const actor = f.p1.character;
  actor.items[0].system.abilities = [{ name: "Invention Expertise", rank: 2 }];
  let rolls = 0,
    deliveries = 0;
  actor.items.push({
    id: "basic-tech",
    name: "Basic Tech",
    type: "skill",
    system: { stat: "tech", level: 6 },
    createRoll: () => ({
      addMod() {},
      handleRollDialog: async () => true,
      roll: async () => {
        assert.equal(f.game.user.isGM, false);
        rolls++;
      },
      resultTotal: 20,
    }),
  });
  actor.createEmbeddedDocuments = async (_type, items) =>
    items.map((data) => {
      deliveries++;
      return { id: data._id, name: data.name };
    });
  f.gm.active = false;
  f.game.user = f.p1;
  await f.api.requestTechAction("techStart", actor.id, undefined, {
    mode: "invention",
    slot: 0,
    name: "Widget",
    description: "A new widget",
    category: "premium",
    price: 100,
    skillId: "basic-tech",
  });
  f.api.readyDowntime();
  const project = f.api
    .getDowntime()
    .events.find((e) => e.kind === "techStart");
  assert.ok(project);
  f.game.user = f.p1;
  await f.api.requestTechAction("techRoll", actor.id, project.id);
  f.api.readyDowntime();
  f.game.user = f.p1;
  await f.api.requestTechAction("techDay", actor.id, project.id);
  f.api.readyDowntime();
  f.api.readyDowntime();
  assert.equal(rolls, 1);
  assert.equal(deliveries, 1);
  assert.equal(f.balance(), 1);
  const done = f.api
    .getDowntime()
    .activities.flatMap((r) => r.events)
    .map((e) => e.data.event)
    .find((e) => e.techDelivery);
  assert.equal(done.techDelivery.actorId, actor.id);
  const journal = f.requests();
  assert.equal(journal.getFlag("pneuma-crewtools", "recordKind"), "character");
  assert.equal(journal.pages.length, 2, "actions do not create receipt pages");
  const activities = journal.pages
    .find((p) => p.getFlag("pneuma-crewtools", "recordKey") === "activities")
    .getFlag("pneuma-crewtools", "activities");
  assert.equal(activities[0].status, "completed");
  assert.equal(activities[0].events[0].data.event.tech.name, "Widget");
  assert.ok(activities[0].events.some((e) => e.data.event.techDelivery));
  const resources = journal.pages
    .find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger")
    .getFlag("pneuma-crewtools", "downtime");
  assert.ok(
    resources.events.every((e) => !e.tech && !e.techCheck && !e.techDelivery),
    "project details have one authoritative home",
  );
});
test("TECH requests losing role eligibility are rejected and do not stall later requests", async () => {
  const f = fixture();
  await f.award(3);
  f.game.settings.get = (_ns, key) =>
    key === "techCraftingMonthDays" ? 28 : false;
  f.p1.character.items.push({
    id: "basic-tech",
    name: "Basic Tech",
    type: "skill",
    system: { stat: "tech" },
  });
  f.game.user = f.p1;
  f.p1.character.items = f.p1.character.items.filter(
    (i) => i.id !== "tech-role",
  );
  await assert.rejects(
    f.api.requestTechAction("techStart", f.p1.character.id, undefined, {
      mode: "invention",
      slot: 0,
      name: "Widget",
      description: "Widget",
      category: "premium",
      price: 100,
      skillId: "basic-tech",
    }),
    /Tech|TECH/,
  );
  await f.api.requestDowntimeUse(1, "spend", "Errands", f.p1.character.id);
  f.p1.character.items = f.p1.character.items.filter(
    (i) => i.id !== "tech-role",
  );
  await f.process();
  assert.equal(
    f.api.getDowntime().events.filter((e) => e.kind === "rejected").length,
    0,
  );
  assert.equal(f.balance(), 2);
});

test("Downtime stays open across repeated submissions and still permits manual close", async () => {
  const f = fixture();
  await f.award(3);
  f.game.user = f.p1;
  const form = new f.api.DowntimeForm();
  for (let i = 0; i < 2; i++) {
    await form._onSubmit(
      {},
      {
        preventClose: false,
        updateData: {
          actorId: f.p1.character.id,
          days: 1,
          kind: "spend",
          reason: "Errands",
        },
      },
    );
    await f.process();
    f.game.user = f.p1;
    assert.equal(form.closeCalls, 0);
  }
  assert.equal(f.balance(), 1);
  await form.close();
  assert.equal(form.closeCalls, 1);
});
test("Downtime serializes simultaneous refreshes from allocation hooks", async () => {
  const f = fixture();
  const form = new f.api.DowntimeForm();
  await Promise.all([
    form._render(false),
    form._render(false),
    form._render(false),
  ]);
  assert.equal(form.maxRenders, 1);
  assert.equal(form.renderCount, 2);
});

test("offline owner actions never write the shared directory or another character ledger", async () => {
  const f = fixture();
  const other = {
    ...f.p1.character,
    id: "other",
    name: "Other",
    testUserPermission: (u) => u.id === "p2",
  };
  f.p2.character = other;
  f.game.actors.push(other);
  await f.award(8);
  await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(f.plan(4, f.p2), "other-payout"),
  );
  const ownJournal = f.requests();
  const otherJournal = f.requests(f.p2);
  const before = JSON.stringify(otherJournal.pages);
  for (const j of f.game.journal)
    if (j.id !== ownJournal.id) {
      for (const p of j.pages)
        p.update = async () => {
          throw Error("Forbidden other Journal write");
        };
      j.update = async () => {
        throw Error("Forbidden Journal write");
      };
    }
  f.gm.active = false;
  f.game.user = f.p1;
  mockHustle(f);
  await f.api.requestDowntimeUse(7, "hustle", "Allocate", "tech1");
  await f.api.requestHustleRoll("tech1", "tech-role");
  await f.api.requestDowntimeUse(1, "rest", "Heal", "tech1");
  assert.equal(f.balance(), 0);
  assert.equal(f.p1.character.system.wealth.value, 200);
  assert.equal(f.p1.character.system.derivedStats.hp.value, 15);
  assert.equal(JSON.stringify(otherJournal.pages), before);
  const ledger = ownJournal.pages.find(
    (p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger",
  );
  assert.equal(ledger.flags["pneuma-crewtools"].downtime.accounts.length, 1);
  assert.ok(
    ledger.flags["pneuma-crewtools"].downtime.events.every(
      (e) => e.actorId === "tech1",
    ),
  );
  assert.doesNotMatch(ledger.text.content, /Actor.other/);
});
test("character ledgers cannot mix another Actor's records", async () => {
  const f = fixture();
  await f.award();
  const ledger = f
    .requests()
    .pages.find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger");
  ledger.flags["pneuma-crewtools"].downtime.accounts[0].actorId = "forged";
  assert.throws(() => f.api.getDowntime());
});
test("GM setup creates storage only for eligible TECHs without creating their Journals", async () => {
  const f = fixture();
  const actor = f.p1.character;
  const roles = actor.items;
  actor.items = [];
  await f.process();
  const containers = () =>
    f.game.actors.filter((a) =>
      a.getFlag?.("pneuma-crewtools", "upgradeProjectsFor"),
    );
  assert.equal(containers().length, 0);
  actor.items = roles;
  await f.process();
  assert.equal(containers().length, 1);
  assert.equal(
    containers()[0].getFlag("pneuma-crewtools", "upgradeProjectsFor"),
    actor.id,
  );
  assert.equal(containers()[0].ownership.p1, 3);
  assert.equal(f.api.getDowntime().accounts.length, 0);
  await f.process();
  assert.equal(containers().length, 1);
});

test("TECH Cancel requires confirmation; keeping or closing preserves progress and confirmed cancellation refunds no days", async () => {
  const f = fixture();
  await f.award(3);
  f.game.user = f.p1;
  f.game.settings.get = (_ns, k) =>
    k === "techCraftingMonthDays" ? 28 : false;
  f.p1.character.items.push({
    id: "skill",
    name: "Basic Tech",
    type: "skill",
    system: { stat: "tech" },
  });
  await f.api.requestTechAction("techStart", "tech1", undefined, {
    mode: "invention",
    slot: 0,
    name: "Widget <test>",
    description: "test",
    category: "expensive",
    price: 500,
    skillId: "skill",
  });
  const id = f.api.getDowntime().events.find((e) => e.kind === "techStart").id;
  await f.api.requestTechAction("techDay", "tech1", id);
  let click;
  const button = {
    dataset: { techAction: "techCancel", techProject: id },
    addEventListener: (_event, fn) => {
      click = fn;
    },
  };
  const root = {
    querySelectorAll: (selector) =>
      selector === "[data-tech-action]" ? [button] : [],
    querySelector: (selector) =>
      selector === '[name="actorId"]'
        ? { value: "tech1", addEventListener() {} }
        : null,
  };
  const form = new f.api.DowntimeForm();
  form.activateListeners([root]);
  for (const choice of ["keep", "close", "cancelProject"]) {
    click();
    const dialog = f.dialogs.at(-1);
    assert.equal(dialog.default, "keep");
    assert.match(dialog.content, /will lose the downtime days/);
    assert.match(dialog.content, /1 allocated day/);
    assert.match(dialog.content, /Widget &lt;test&gt;/);
    if (choice === "close") dialog.close();
    else dialog.buttons[choice].callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.balance(), 2);
    assert.equal(
      f.api.getDowntime().events.filter((e) => e.kind === "techCancel").length,
      choice === "cancelProject" ? 1 : 0,
    );
  }
});

test("offline Medtech records dose delivery and a completed workday on the Active Projects page", async () => {
  const f = fixture();
  await f.award(1);
  f.game.user = f.p1;
  f.gm.active = false;
  const actor = f.p1.character;
  actor.system.wealth.value = 500;
  actor.items.push({
    id: "med",
    name: "Medtech",
    type: "role",
    system: {
      rank: 4,
      mainRoleAbility: "Medicine",
      abilities: [{ name: "Medical Tech Skill", rank: 3 }],
    },
    createRoll: () => ({
      handleRollDialog: async () => true,
      roll: async () => {},
      resultTotal: 14,
    }),
  });
  actor.items.push({
    id: "pharma",
    uuid: "Item.pharma",
    name: "Speedheal",
    type: "drug",
    system: { amount: 1 },
    async update(data) {
      this.system.amount = data["system.amount"];
    },
    testUserPermission: () => true,
    toObject: () => ({
      name: "Speedheal",
      type: "drug",
      system: { amount: 1 },
    }),
  });
  actor.createEmbeddedDocuments = async (_type, rows) =>
    rows.map((data) => {
      const i = { ...data, id: data._id };
      actor.items.push(i);
      return i;
    });
  await f.api.requestMedicalAction(actor.id, {
    kind: "taskAdd",
    taskKind: "pharma",
    uuid: "Item.pharma",
  });
  const ledger = f
    .requests()
    .pages.find(
      (p) => p.getFlag("pneuma-crewtools", "recordKey") === "activities",
    );
  const task = ledger.getFlag("pneuma-crewtools", "activities")[0].details
    .tasks[0];
  await f.api.requestMedicalAction(actor.id, {
    kind: "taskRoll",
    taskId: task.id,
  });
  assert.equal(ledger.getFlag("pneuma-crewtools", "medicalAttempt"), null);
  assert.equal(actor.system.wealth.value, 300);
  assert.equal(actor.items.filter((i) => i.type === "drug").length, 1);
  assert.equal(actor.items.find((i) => i.id === "pharma").system.amount, 4);
  assert.equal(
    ledger.getFlag("pneuma-crewtools", "activities")[0].details.tasks[0].doses,
    3,
  );
  await assert.rejects(
    f.api.requestDowntimeUse(1, "spend", "Other", actor.id),
    /reserved/,
  );
  const form = new f.api.DowntimeForm();
  form.selectedActorId = actor.id;
  assert.equal(form.getData().canFinishMedicalDay, true);
  assert.equal(form.getData().canAddHustle, false);
  await f.api.requestMedicalAction(actor.id, { kind: "finishDay" });
  assert.equal(f.balance(), 0);
  assert.equal(
    ledger.getFlag("pneuma-crewtools", "activities")[0].status,
    "completed",
  );
  assert.equal(
    ledger.getFlag("pneuma-crewtools", "activities")[0].details.tasks[0].doses,
    3,
  );
  assert.equal(actor.items.filter((i) => i.type === "drug").length, 1);
  assert.doesNotMatch(ledger.text.content, /Medical action needs review/);
});

test("seventh patient allocation leaves recovery ready inline without opening a dialog", async () => {
  const f = fixture();
  await f.award(1);
  f.game.user = f.p1;
  f.gm.active = false;
  const ledger = f
    .requests()
    .pages.find(
      (p) => p.getFlag("pneuma-crewtools", "recordKey") === "activities",
    );
  ledger.flags["pneuma-crewtools"].activities = [
    {
      id: "course",
      actorId: "tech1",
      kind: "patient",
      name: "Standard Humanity Loss",
      status: "active",
      startedAt: "2078-02-01",
      progress: { value: 6, required: 7, unit: "days" },
      events: [],
      details: {
        id: "course",
        type: "standard",
        days: 6,
        pc: false,
        addiction: "",
      },
    },
  ];
  let click;
  const button = {
    dataset: { medicalAction: "patientDay" },
    addEventListener: (_event, fn) => {
      click = fn;
    },
  };
  const root = {
    querySelectorAll: (q) => (q === "[data-medical-action]" ? [button] : []),
    querySelector: (q) =>
      q === '[name="actorId"]'
        ? { value: "tech1", addEventListener() {} }
        : null,
  };
  const form = new f.api.DowntimeForm();
  form.activateListeners([root]);
  click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.dialogs.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.balance(), 0);
  assert.equal(ledger.flags["pneuma-crewtools"].activities[0].details.days, 7);
});

test("downtime locks column width while retaining resized height across character changes", async () => {
  const f = fixture();
  const other = { ...f.p1.character, id: "other", name: "Solo", items: [] };
  f.game.actors.push(other);
  await f.award(3);
  f.game.user = f.p1;
  const form = new f.api.DowntimeForm();
  assert.equal(f.api.DowntimeForm.defaultOptions.resizable, true);
  assert.equal(form.getData().hasRoleAreas, true);
  form.setPosition({ width: 800, height: 420, left: 30, top: 40 });
  assert.equal(form.position.width, 640);
  assert.equal(form.position.height, 420);
  form.selectedActorId = "other";
  assert.equal(form.getData().hasRoleAreas, true);
  assert.equal(form.getData().canRepair, true);
  form.setPosition({ width: 1300 });
  assert.equal(form.position.width, 640);
  assert.equal(form.position.height, 420);
  form.selectedActorId = "tech1";
  form.getData();
  form.setPosition({});
  assert.equal(form.position.width, 640);
  assert.equal(form.position.height, 420);
  assert.equal(form.position.left, 30);
});

test("startup and shared Actor creation do not provision unused character Journals", async () => {
  const f = fixture();
  f.api.readyDowntime();
  await f.api.withDowntimeLock(async () => {});
  assert.equal(f.api.getDowntime().accounts.length, 0);
  const shared = { ...f.p1.character, id: "shared-car", name: "Shared Car" };
  f.game.actors.push(shared);
  f.api.readyDowntime();
  await f.api.withDowntimeLock(async () => {});
  assert.equal(f.api.getDowntime().accounts.length, 0);
  await f.award(2);
  assert.deepEqual(
    Array.from(f.api.getDowntime().accounts, (a) => a.actorId),
    [f.p1.character.id],
  );
  assert.ok(
    !Array.from(f.game.journal).some(
      (j) => j.getFlag("pneuma-crewtools", "actorId") === "shared-car",
    ),
  );
});

test("Actor resource changes do not run setup; identity changes maintain only that Actor", async () => {
  const f = fixture();
  await f.award(4);
  const other = { ...f.p1.character, id: "tech2", name: "Other TECH" };
  f.game.actors.push(other);
  const plan = f.plan(2);
  plan.actors = [{ ...plan.actors[0], actor: other }];
  await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(plan, "other-award"),
  );
  f.api.registerDowntime();
  const writes = [];
  for (const journal of f.game.journal.values())
    for (const doc of [journal, ...journal.pages]) {
      const update = doc.update;
      doc.update = async (changes) => {
        writes.push({ id: doc.id, journal: journal.id, changes });
        return update(changes);
      };
    }
  f.hooks.get("updateActor")(f.p1.character, { "system.wealth.value": 200 });
  await f.drain();
  assert.equal(writes.length, 0);
  const otherJournal = f.game.journal.get(
    f.api.getDowntime().accounts.find((a) => a.actorId === "tech2")
      .characterJournalId,
  );
  f.p1.character.name = "Renamed";
  f.hooks.get("updateActor")(f.p1.character, { name: "Renamed" });
  f.hooks.get("updateActor")(f.p1.character, { name: "Renamed" });
  await f.drain();
  assert.equal(
    f.api.getDowntime().accounts.find((a) => a.actorId === "tech1").name,
    "Renamed",
  );
  assert.equal(writes.filter((w) => w.journal === otherJournal.id).length, 0);
  assert.equal(
    writes.filter((w) => w.changes.name === "Crew Tools — Renamed").length,
    1,
  );
});
test("ordinary spending preserves Active Projects and does not save them again", async () => {
  const f = fixture();
  await f.award(3);
  f.game.user = f.p1;
  f.gm.active = false;
  const page = f
    .requests()
    .pages.find(
      (p) => p.getFlag("pneuma-crewtools", "recordKey") === "activities",
    );
  const record = {
    id: "patient",
    actorId: "tech1",
    kind: "patient",
    name: "Therapy",
    status: "active",
    startedAt: "2078-02-01",
    progress: { value: 2, required: 7, unit: "days" },
    details: {
      id: "patient",
      type: "standard",
      days: 2,
      pc: false,
      addiction: "",
    },
    events: [],
  };
  page.flags["pneuma-crewtools"].activities = [record];
  let writes = 0;
  const update = page.update;
  page.update = async (data) => {
    writes++;
    return update(data);
  };
  await f.api.requestDowntimeUse(1, "spend", "Practice", "tech1");
  assert.equal(f.balance(), 2);
  assert.equal(writes, 0);
  assert.deepEqual(page.getFlag("pneuma-crewtools", "activities"), [record]);
  assert.equal(f.api.getDowntime().activities[0].id, "patient");
  const resources = f
    .requests()
    .pages.find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger")
    .getFlag("pneuma-crewtools", "downtime");
  assert.equal(resources.activities, undefined);
  assert.equal(
    f
      .requests()
      .pages.some((p) => p.getFlag("pneuma-crewtools", "downtimeRequest")),
    false,
  );
});

test("full-week setting is optional and named exactly as requested", () => {
  const f = fixture(),
    configs = new Map();
  f.game.settings.register = (_ns, key, config) => configs.set(key, config);
  f.api.registerDowntime();
  const c = configs.get("requireFullDowntimeWeek");
  assert.equal(
    c.name,
    "Must have 7 downtime days available for hustle and therapy",
  );
  assert.equal(c.scope, "world");
  assert.equal(c.default, false);
});
function fullWeeks(f) {
  const get = f.game.settings.get;
  f.game.settings.get = (ns, key) =>
    key === "requireFullDowntimeWeek" ? true : get(ns, key);
}
test("full-week hustle spends seven available days and pays immediately offline", async () => {
  const f = fixture(),
    rolls = mockHustle(f);
  await f.award(8);
  fullWeeks(f);
  f.game.user = f.p1;
  f.gm.active = false;
  const view = new f.api.DowntimeForm().getData();
  assert.equal(view.fullWeek, true);
  assert.equal(view.canRollHustle, true);
  await f.api.requestHustleRoll("tech1", "tech-role");
  assert.equal(f.balance(), 1);
  assert.equal(rolls(), 1);
  assert.equal(f.p1.character.system.wealth.value, 200);
  assert.equal(model.hustleDays(f.api.getDowntime(), "tech1"), 0);
  model.validateDowntime(f.api.getDowntime());
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /Seven available/,
  );
  assert.equal(rolls(), 1);
  assert.equal(f.balance(), 1);
});
test("full-week hustle rejects partial allocations and insufficient days before rolling", async () => {
  const f = fixture(),
    rolls = mockHustle(f);
  await f.award(6);
  fullWeeks(f);
  f.game.user = f.p1;
  for (const days of [1, 6, 7])
    await assert.rejects(
      f.api.requestDowntimeUse(days, "hustle", "Allocate", "tech1"),
      /spent together/,
    );
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /Seven available/,
  );
  assert.equal(f.balance(), 6);
  assert.equal(rolls(), 0);
  assert.equal(new f.api.DowntimeForm().getData().canRollHustle, false);
});
test("failed weekly hustle leaves the seven days unspent", async () => {
  const f = fixture();
  await f.award(7);
  fullWeeks(f);
  f.game.user = f.p1;
  f.game.tables.push({
    getFlag: () => "Tech",
    formula: "1d6",
    handleRollDialog: async () => true,
    roll: async () => {
      throw Error("roll unavailable");
    },
  });
  await assert.rejects(
    f.api.requestHustleRoll("tech1", "tech-role"),
    /roll unavailable/,
  );
  assert.equal(f.balance(), 7);
  assert.equal(f.api.getDowntime().events.length, 1);
});
test("full-week patient therapy records the seven-day charge and course together", async () => {
  const f = fixture();
  await f.award(7);
  fullWeeks(f);
  f.game.user = f.p1;
  f.gm.active = false;
  await f.api.requestMedicalAction("tech1", {
    kind: "patientStart",
    type: "standard",
    pc: true,
  });
  assert.equal(f.balance(), 0);
  const state = f.api.getDowntime(),
    course = state.activities.find((r) => r.kind === "patient");
  assert.equal(course.progress.value, 7);
  assert.equal(state.events.at(-1).days, 7);
  assert.equal(state.events.at(-1).activityId, course.id);
  const view = new f.api.DowntimeForm().getData();
  assert.equal(view.patient.canFinish, true);
  assert.equal(view.patient.canAdd, false);
});

test("absent payout awards are Actor-based, touch no native resources, and roll back with the payout", async () => {
  const f = fixture();
  const away = {
    ...f.p1.character,
    id: "away",
    name: "Away",
    items: [],
    testUserPermission: (u) => u.id === f.p2.id,
    update: async () => {
      throw Error("No Actor writes for downtime");
    },
  };
  f.game.actors.push(away);
  f.p2.character = away;
  const plan = f.plan(0);
  plan.absentDowntime = [
    {
      actor: away,
      participant: { userId: f.p2.id, userName: f.p2.name },
      days: 5,
    },
  ];
  const undo = await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(plan, "with-absence"),
  );
  assert.equal(f.balance(), 0);
  assert.equal(model.downtimeBalance(f.api.getDowntime(), "away"), 5);
  assert.equal(
    f.api.getDowntime().events.find((e) => e.actorId === "away").payoutId,
    "with-absence",
  );
  await f.api.withDowntimeLock(undo);
  assert.equal(f.balance(), 0);
  assert.equal(model.downtimeBalance(f.api.getDowntime(), "away"), 0);
});

test("failed therapy charge restores Active Projects and allows a correctly charged retry", async () => {
  const f = fixture();
  await f.award(7);
  fullWeeks(f);
  f.game.user = f.p1;
  f.gm.active = false;
  const page = f
    .requests()
    .pages.find(
      (p) => p.getFlag("pneuma-crewtools", "recordKey") === "activities",
    );
  const before = structuredClone(
    page.getFlag("pneuma-crewtools", "activities"),
  );
  const content = page.text.content;
  f.failSave(true);
  await assert.rejects(
    f.api.requestMedicalAction("tech1", {
      kind: "patientStart",
      type: "standard",
      pc: true,
    }),
    /write failed/,
  );
  assert.equal(f.balance(), 7);
  assert.deepEqual(page.getFlag("pneuma-crewtools", "activities"), before);
  assert.equal(page.text.content, content);
  f.failSave(false);
  await f.api.requestMedicalAction("tech1", {
    kind: "patientStart",
    type: "standard",
    pc: true,
  });
  assert.equal(f.balance(), 0);
  assert.equal(
    f.api.getDowntime().activities.filter((r) => r.kind === "patient").length,
    1,
  );
});

test("balance and transactions are written together, and a failed save preserves both", async () => {
  const f = fixture();
  await f.award(5);
  f.game.user = f.p1;
  const page = f
    .requests()
    .pages.find((p) => p.getFlag("pneuma-crewtools", "kind") === "actorLedger");
  const update = page.update,
    writes = [];
  page.update = async (data) => {
    writes.push(data);
    return update(data);
  };
  await f.api.requestDowntimeUse(2, "spend", "Practice", "tech1");
  const transaction = writes.find(
    (d) => "flags.pneuma-crewtools.downtime" in d,
  );
  assert.equal(transaction["flags.pneuma-crewtools.downtimeBalance"], 3);
  const before = structuredClone(page.getFlag("pneuma-crewtools", "downtime"));
  f.failSave(true);
  await assert.rejects(
    f.api.requestDowntimeUse(1, "spend", "Failed", "tech1"),
    /write failed/,
  );
  assert.equal(f.balance(), 3);
  assert.deepEqual(page.getFlag("pneuma-crewtools", "downtime"), before);
});

test("character actions and dashboard never read or write another character's history", async () => {
  const f = fixture();
  f.game.settings.get = (_ns, key) =>
    key === "techCraftingMonthDays" ? 28 : false;
  await f.award(10);
  const other = { ...f.p1.character, id: "other", name: "Other", items: [] };
  f.game.actors.push(other);
  const plan = f.plan(3);
  plan.actors[0].actor = other;
  await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(plan, "other-payout"),
  );
  const otherAccount = f.api
    .getDowntime()
    .accounts.find((a) => a.actorId === other.id);
  const otherJournal = f.game.journal.get(otherAccount.characterJournalId);
  for (const page of otherJournal.pages) {
    const getFlag = page.getFlag.bind(page);
    page.getFlag = (ns, key) => {
      // Roster discovery may inspect page identity, but never unrelated history.
      if (key !== "recordKey") throw Error("Unrelated history read");
      return getFlag(ns, key);
    };
    page.update = async () => {
      throw Error("Unrelated history write");
    };
  }
  f.game.user = f.p1;
  f.gm.active = false;
  await f.api.requestDowntimeUse(1, "spend", "Practice", "tech1");
  await f.api.requestDowntimeUse(1, "hustle", "Hustle", "tech1");
  await f.api.requestDowntimeUse(1, "rest", "Rest", "tech1");
  f.p1.character.items.push({
    id: "skill",
    name: "Basic Tech",
    type: "skill",
    system: { stat: "tech" },
  });
  await f.api.requestTechAction("techStart", "tech1", undefined, {
    mode: "invention",
    slot: 0,
    name: "Widget",
    description: "test",
    category: "expensive",
    price: 500,
    skillId: "skill",
  });
  let state = f.api.getDowntime("tech1");
  const id = state.events.find((e) => e.kind === "techStart").id;
  await f.api.requestTechAction("techDay", "tech1", id);
  await f.api.requestMedicalAction("tech1", {
    kind: "patientStart",
    type: "standard",
    pc: true,
  });
  await f.api.requestMedicalAction("tech1", { kind: "patientDay" });
  state = f.api.getDowntime("tech1");
  assert.equal(state.accounts.length, 1);
  assert.equal(model.downtimeBalance(state, "tech1"), 5);
  const form = new f.api.DowntimeForm();
  form.selectedActorId = "tech1";
  assert.equal(form.getData().balance, 5);
});
test("invalid actions return errors without writing rejected request records", async () => {
  const f = fixture();
  await f.award(1);
  f.game.user = f.p1;
  const journal = f.requests(),
    before = JSON.stringify(journal.pages.map((p) => p.flags));
  let writes = 0;
  for (const page of journal.pages) {
    const update = page.update;
    page.update = async (data) => {
      writes++;
      return update(data);
    };
  }
  await assert.rejects(
    f.api.requestDowntimeUse(2, "spend", "Too much", "tech1"),
    /Not enough/,
  );
  await assert.rejects(
    f.api.requestTechAction("techDay", "tech1", "missing"),
    /project/i,
  );
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(journal.pages.map((p) => p.flags)), before);
});

test("inline patient setup preserves choices and starts free PC therapy without a dialog", async () => {
  const f = fixture();
  await f.award(7);
  f.game.user = f.p1;
  const form = new f.api.DowntimeForm();
  const handlers = {};
  const fields = Object.fromEntries(
    ["patientType", "patientPC", "patientAddiction", "actorId"].map((name) => [
      name,
      {
        value: name === "actorId" ? "tech1" : "",
        addEventListener: (_event, fn) => (handlers[name] = fn),
      },
    ]),
  );
  let click;
  const button = {
    dataset: { medicalAction: "patientStart" },
    addEventListener: (_event, fn) => (click = fn),
  };
  const root = {
    querySelectorAll: (q) => (q === "[data-medical-action]" ? [button] : []),
    querySelector: (q) => fields[q.match(/name="([^"]+)"/)?.[1]] ?? null,
  };
  form.activateListeners([root]);
  handlers.patientType({ target: { value: "addiction" } });
  handlers.patientPC({ target: { checked: true } });
  handlers.patientAddiction({ target: { value: "Synthcoke" } });
  const data = form.getData();
  assert.equal(data.patientNeedsAddiction, true);
  assert.equal(data.patientPC, true);
  assert.ok(data.patientChoices.every((t) => t.label.includes("0 eb")));
  click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.dialogs.length, 0);
  const patient = form.getData().patient;
  assert.equal(patient.type, "addiction");
  assert.equal(patient.addiction, "Synthcoke");
  assert.equal(patient.pc, true);
});

test("character setup and spending do not create an Overview page", async () => {
  const f = fixture();
  await allocateHustle(f, 7);
  assert.equal(
    f
      .requests()
      .pages.some(
        (page) => page.getFlag("pneuma-crewtools", "recordKey") === "overview",
      ),
    false,
  );
});

test("Downtime ignores unrelated Actor, Item, setting and character Journal changes", async () => {
  const f = fixture();
  const renders = [];
  f.api.DowntimeForm.prototype.render = function () {
    this.rendered = true;
    renders.push(this);
    return this;
  };
  f.api.registerDowntime();
  f.api.openDowntime("tech1");
  assert.equal(renders.length, 1);
  f.hooks.get("updateActor")({ id: "other" }, { "system.wealth.value": 4 });
  f.hooks.get("updateItem")({
    type: "weapon",
    parent: { id: "other", documentName: "Actor" },
  });
  f.hooks.get("updateSetting")({ key: "other-module.enabled" });
  f.hooks.get("updateJournalEntryPage")({
    getFlag: () => "activities",
    parent: { getFlag: () => "other" },
  });
  await Promise.resolve();
  assert.equal(renders.length, 1);
  f.hooks.get("updateActor")(
    { id: "tech1" },
    { "system.derivedStats.hp.value": 4 },
  );
  f.hooks.get("updateItem")({
    type: "cyberware",
    parent: { id: "tech1", documentName: "Actor" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(renders.length, 2);
});

test("Downtime loads medical compendiums only when displaying a Medtech", async () => {
  const f = fixture();
  f.game.user = f.p1;
  let reads = 0;
  f.game.packs = [
    {
      documentName: "Item",
      collection: "system.drugs",
      getDocuments: async () => {
        reads++;
        return [];
      },
    },
  ];
  const form = new f.api.DowntimeForm();
  form.selectedActorId = "tech1";
  await form._render(false);
  assert.equal(reads, 0);
  f.p1.character.items.push({
    type: "role",
    name: "Medtech",
    system: { rank: 1, mainRoleAbility: "Medicine" },
  });
  await form._render(false);
  await form._render(false);
  assert.equal(reads, 1);
});

test("Explicit HQ effects survive renaming and notes-only improvements grant no benefit", () => {
  const f = fixture();
  f.game.settings.get = () => false;
  f.headquarters.headquarters = [
    { improvements: [{ name: "Machine Shop", effect: "workshop" }] },
  ];
  assert.equal(f.api.currentTechSlots(), 2);
  f.headquarters.headquarters = [
    { improvements: [{ name: "Workshop", effect: "notes" }] },
  ];
  assert.equal(f.api.currentTechSlots(), 1);
});

test("GM downtime corrections accept signed days and log the reason without overdraw", async () => {
  const f = fixture();
  await f.award(5);
  const actorId = f.p1.character.id;
  await f.api.adjustPlayerDowntime(actorId, 3, "Missed award");
  assert.equal(f.balance(), 8);
  await f.api.adjustPlayerDowntime(actorId, -2, "Correction");
  assert.equal(f.balance(), 6);
  assert.match(
    f.api.getDowntime(actorId).events.at(-1).reason,
    /Correction.*8 → 6/,
  );
  await assert.rejects(
    f.api.adjustPlayerDowntime(actorId, -7, "Overdraw"),
    /negative/,
  );
  await assert.rejects(f.api.adjustPlayerDowntime(actorId, 1, ""), /reason/);
  assert.equal(f.balance(), 6);
  f.game.user = f.p1;
  await assert.rejects(
    f.api.adjustPlayerDowntime(actorId, 1, "Player attempt"),
  );
});

test("Workshop progress and its one-day charge survive character Journal reloads", async () => {
  const f = fixture();
  await f.award(8);
  f.game.settings.get = (_ns, key) =>
    key === "techCraftingMonthDays" ? 28 : false;
  f.headquarters.headquarters = [
    { improvements: [{ name: "Workshop", effect: "workshop", level: 1 }] },
  ];
  const actor = f.p1.character;
  actor.items.push({
    id: "repair-skill",
    name: "Basic Tech",
    type: "skill",
    system: { stat: "tech" },
  });
  f.game.user = f.p1;
  f.gm.active = false;
  for (let slot = 0; slot < 2; slot++)
    await f.api.requestTechAction("techStart", actor.id, undefined, {
      mode: "invention",
      slot,
      name: "Project " + slot,
      description: "Test",
      category: "expensive",
      price: 500,
      skillId: "repair-skill",
    });
  await f.api.requestTechAction("techWorkshop", actor.id);
  assert.equal(f.balance(), 7);
  const records = f.api
    .getDowntime(actor.id)
    .activities.filter((r) => r.kind === "tech");
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.progress.value === 1));
  assert.equal(f.api.currentTechSlots(), 2);
  f.headquarters.headquarters[0].improvements[0].level = 2;
  assert.equal(f.api.currentTechSlots(), 3);
});

test("downtime section fold state survives redraws", () => {
  const f = fixture(),
    form = new f.api.DowntimeForm();
  function section() {
    return {
      dataset: { downtimeSection: "hustle" },
      open: true,
      addEventListener(_name, fn) {
        this.toggle = fn;
      },
    };
  }
  const first = section();
  const root = (part) => ({
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === "[data-downtime-section]" ? [part] : [],
  });
  form.activateListeners([root(first)]);
  first.open = false;
  first.toggle();
  const second = section();
  form.activateListeners([root(second)]);
  assert.equal(second.open, false);
});

test("Nomad shared respec charges seven days atomically, survives Garage removal, and starts a fresh cycle", async () => {
  const f = fixture();
  await f.award(15);
  f.game.user = f.p1;
  const actor = f.p1.character;
  actor.items.push({
    id: "nomad",
    name: "Nomad",
    type: "role",
    system: { rank: 4, mainRoleAbility: "Moto" },
  });
  const progress = () =>
    load("nomad-model", {}, {}).nomadRespecDays(
      f.api.getDowntime(actor.id).events,
      actor.id,
    );
  await assert.rejects(f.api.requestNomadRespec(actor.id, 1), /Garage/);
  f.headquarters.headquarters = [{ improvements: [{ name: "Garage" }] }];
  await f.api.requestNomadRespec(actor.id, 2);
  assert.equal(progress(), 2);
  assert.equal(f.balance(), 13);
  await assert.rejects(f.api.requestNomadRespec(actor.id, 0, true), /Complete/);
  f.headquarters.headquarters = [];
  await assert.rejects(f.api.requestNomadRespec(actor.id, 1), /Garage/);
  assert.equal(progress(), 2);
  f.headquarters.headquarters = [{ improvements: [{ name: "garage" }] }];
  f.failSave(true);
  await assert.rejects(f.api.requestNomadRespec(actor.id, 5), /write failed/);
  assert.equal(progress(), 2);
  assert.equal(f.balance(), 13);
  f.failSave(false);
  await f.api.requestNomadRespec(actor.id, 5);
  assert.equal(progress(), 7);
  assert.equal(f.balance(), 8);
  await assert.rejects(f.api.requestNomadRespec(actor.id, 1), /remaining/);
  assert.match(
    f.api.getDowntime(actor.id).events.at(-1).reason,
    /complete.*manually/,
  );
  await f.api.requestNomadRespec(actor.id, 0, true);
  assert.equal(progress(), 0);
  assert.equal(f.balance(), 8);
  const results = await Promise.allSettled([
    f.api.requestNomadRespec(actor.id, 7),
    f.api.requestNomadRespec(actor.id, 7),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(progress(), 7);
  assert.equal(f.balance(), 1);
  await f.api.requestNomadRespec(actor.id, 0, true);
  await assert.rejects(f.api.requestNomadRespec(actor.id, 7), /Not enough/);
  actor.items = actor.items.filter((i) => i.id !== "nomad");
  await assert.rejects(f.api.requestNomadRespec(actor.id, 1), /Nomad role/);
});

test("Ledger validation keeps interleaved respec pools separate without rescanning prefixes", () => {
  let id = 0;
  const event = (actorId, kind, days) => ({
    id: String(++id),
    actorId,
    kind,
    days,
    period: 1,
    date: "2045-01-01",
    reason: kind,
  });
  const state = {
    version: 1,
    period: 1,
    accounts: ["a", "b"].map((actorId) => ({
      actorId,
      name: actorId,
      characterJournalId: actorId,
    })),
    events: [
      { ...event("a", "award", 20), payoutId: "pa" },
      { ...event("b", "award", 20), payoutId: "pb" },
      event("a", "nomadRespecDay", 7),
      event("b", "nomadRespecDay", 1),
      event("a", "nomadRespecReset", 0),
      event("b", "nomadRespecDay", 6),
      event("b", "nomadRespecReset", 0),
      event("a", "nomadRespecDay", 1),
    ],
  };
  Object.defineProperties(state.events, {
    slice: {
      value: () => {
        throw Error("history copied");
      },
    },
    indexOf: {
      value: () => {
        throw Error("history rescanned");
      },
    },
  });
  model.validateDowntime(state);
  state.events.push(event("a", "nomadRespecReset", 0));
  assert.throws(() => model.validateDowntime(state), /Complete/);
  state.events.pop();
  state.events.push(event("b", "nomadRespecDay", 8));
  assert.throws(() => model.validateDowntime(state), /remaining/);
});

test("downtime log shows custom text without payout tags, escapes HTML, and accepts old events", () => {
  const view = load("downtime-journal-view", {}, {});
  const events = [
    {
      id: "old",
      actorId: "a",
      kind: "spend",
      days: 1,
      period: 1,
      date: "2078-02-06",
      reason: "Visited a friend",
    },
    {
      id: "custom",
      actorId: "a",
      kind: "resource",
      days: 0,
      period: 1,
      date: "2078-02-06",
      reason: "old combined reason",
      custom: {
        definition: { name: "Research" },
        result: {
          text: "Found a clue.\n<script>alert(1)</script>",
          tableTotal: 3,
          rewards: [],
        },
      },
    },
    {
      id: "hustle",
      actorId: "a",
      kind: "hustleRoll",
      days: 0,
      period: 1,
      date: "2078-02-06",
      reason: "Old hustle summary",
      hustleReward: { before: 0, after: 100 },
    },
  ];
  const html = view.resourceTransactionsHtml({
    accounts: [],
    events,
    period: 1,
  });
  assert.match(html, /Visited a friend/);
  assert.match(html, /Found a clue/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|old combined reason/);
  assert.match(html, /Old hustle summary/);
});

test("Rest leaves armor alone without its matching installed cyberware", () => {
  const f = fixture();
  const actor = f.p1.character;
  const heal = load("downtime-healing", {}, {});
  const armor = healingArmor(actor, "Subdermal Armor", 3, 1);
  const implant = actor.items.find(
    (i) => i.name === armor.name && i.type === "cyberware",
  );
  const preview = () =>
    heal.healingPreview(
      actor,
      heal.defaultHealingOptions(),
      f.headquarters,
      true,
    );
  assert.equal(preview().armorRepairs[0].itemId, armor.id);
  implant.system.isInstalled = false;
  assert.equal(preview().armorRepairs.length, 0);
  implant.system.isInstalled = true;
  implant.name = "Skin Weave";
  assert.equal(preview().armorRepairs.length, 0);
  implant.name = " Subdermal  Armor ";
  assert.equal(preview().armorRepairs.length, 2);
  actor.items = actor.items.filter((i) => i !== armor);
  assert.equal(preview().armorRepairs.length, 0);
});

test("FleshWeave cyberware repairs FleshWeave (Armor) to full SP", async () => {
  const f = fixture();
  await f.award();
  f.game.user = f.p1;
  const actor = f.p1.character;
  actor.system.derivedStats.hp.value = 40;
  const armor = healingArmor(actor, "FleshWeave", 6, 4);
  armor.name = "FleshWeave (Armor)";
  const form = new f.api.DowntimeForm();
  assert.match(
    form.getData().armorHealingNote,
    /FleshWeave \(Armor\).*full SP/,
  );
  assert.equal(form.getData().canHeal, true);
  await f.api.requestDowntimeUse(1, "rest", "Recover", "tech1");
  assert.equal(armor.system.headLocation.ablation, 0);
  assert.equal(armor.system.bodyLocation.ablation, 0);
  assert.equal(f.balance(), 4);
});

test("GM corrections preserve other directory accounts and their Journal records", async () => {
  const f = fixture();
  await f.award(5);
  const other = { ...f.p1.character, id: "second", name: "Second" };
  f.game.actors.push(other);
  const plan = f.plan(7);
  plan.actors = [{ ...plan.actors[0], actor: other }];
  await f.api.withDowntimeLock(() =>
    f.api.applyDowntimeAwards(plan, "second-award"),
  );
  const before = structuredClone(f.api.getDowntime());
  const account = before.accounts.find((a) => a.actorId === other.id);
  const journal = f.game.journal.get(account.characterJournalId);
  const pagesBefore = JSON.stringify(Array.from(journal.pages));
  const directory = Array.from(f.game.journal)
    .find((j) => j.getFlag("pneuma-crewtools", "downtime") === "ledger")
    .pages.find((p) => p.getFlag("pneuma-crewtools", "kind") === "ledger");

  for (const amount of [3, -2]) {
    await f.api.adjustPlayerDowntime(f.p1.character.id, amount, "Correction");
    const after = structuredClone(f.api.getDowntime());
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(
      after.events.filter((e) => e.actorId === other.id),
      before.events.filter((e) => e.actorId === other.id),
    );
    assert.equal(JSON.stringify(Array.from(journal.pages)), pagesBefore);
    assert.match(directory.text.content, /Second/);
    assert.match(
      directory.text.content,
      new RegExp(account.characterJournalId),
    );
  }
  assert.equal(f.balance(), 6);
});
