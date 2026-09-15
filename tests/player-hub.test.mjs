import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
function load(name, globals, deps) {
  const exports = {};
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
    require: (k) => {
      if (k === "./netrunner-panel" || k === "./netrunner-system")
        return load(k.slice(2), globals, {});
      if (k === "./nomad-vehicles")
        return {
          nomadVehiclePanel: () => ({ visible: false, slots: [] }),
          nomadVehicleSlots: () => {
            globals.nomadReads?.();
            return [{ actorId: "vehicle" }];
          },
          bindNomadVehicles() {},
        };
      if (k === "./teammates")
        return {
          teammatePanel: () => ({ visible: false, slots: [] }),
          bindTeammates() {},
        };
      if (k === "./roll-visibility")
        return { activityRollRecipients: () => [] };
      if (k === "./rent")
        return { rentStatus: () => ({ due: false, pending: 0 }) };
      if (k === "./rent-form") return { openRent() {} };
      if (k === "./medtech-system") return load("medtech-system", globals, {});
      if (k === "./pharma-transfer")
        return {
          PharmaTransferPanel: class {
            getData() {
              return { pharma: [], recipients: [], pending: [] };
            }
            bind() {}
          },
        };
      if (k === "./ui-refresh")
        return load("ui-refresh", globals, {
          "./constants": { MODULE_ID: "pneuma-crewtools" },
        });
      if (k === "./foundry-form") return load("foundry-form", globals, {});
      if (k === "./date-format") return load("date-format", globals, {});
      if (k === "./nomad-model") return load("nomad-model", globals, {});
      if (k === "./tech-project-model")
        return load("tech-project-model", globals, {});
      if (k === "./actor-policy")
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
      if (!(k in deps)) throw Error(k);
      return deps[k];
    },
    structuredClone,
    console,
    ...globals,
  });
  return exports;
}
function fixture() {
  let nomadReadCount = 0;
  const nomadReads = () => {
    nomadReadCount++;
  };
  const hooks = new Map();
  const timers = new Map();
  const renders = [];
  const actor = {
    id: "a1",
    name: "V",
    type: "character",
    testUserPermission: (user) => user.id === "p1",
    system: {
      wealth: { value: 1250 },
      improvementPoints: { value: 45 },
      reputation: { value: 3 },
    },
  };
  const ack = {
    id: "ack1",
    payoutRecordId: "payout1",
    sessionLabel: "The Pickup",
    inGameDate: "2078-02-06",
    userId: "p1",
    userName: "Player One",
    actorId: "a1",
    actorName: "V",
    createdAt: "2026-09-12T00:00:00Z",
    acknowledgedAt: null,
    awards: [
      {
        text: "Money: 500 eb",
        label: "Money",
        value: "500 eb",
        icon: "fas fa-coins",
      },
    ],
  };
  const p1 = {
    id: "p1",
    name: "Player One",
    isGM: false,
    character: actor,
    getFlag: () => [ack],
  };
  const p2 = {
    id: "p2",
    name: "Player Two",
    isGM: false,
    character: {
      ...actor,
      id: "a2",
      name: "Other",
      testUserPermission: (user) => user.id === "p2",
    },
    getFlag: () => [],
  };
  const gm = {
    id: "gm",
    name: "GM",
    isGM: true,
    character: null,
    getFlag: () => [],
  };
  const game = {
    user: p1,
    users: [gm, p1, p2],
    actors: [actor, p2.character],
    journal: new Map(),
  };
  const state = {
    version: 1,
    period: 1,
    accounts: [
      { actorId: "a1", name: "Player One", characterJournalId: "j1" },
      { actorId: "a2", name: "Player Two", characterJournalId: "j2" },
    ],
    events: [
      { kind: "award", days: 5, actorId: "a1" },
      { kind: "spend", days: 2, actorId: "a1" },
      { kind: "award", days: 7, actorId: "a2" },
    ],
  };
  game.actors.get = (id) => game.actors.find((actor) => actor.id === id);
  const model = load(
    "downtime-model",
    {},
    { "./downtime-healing": load("downtime-healing", {}, {}) },
  );
  const status = load(
    "player-hub-status",
    { game },
    {
      "./constants": { MODULE_ID: "pneuma-crewtools" },
      "./headquarters": { headquartersIp: () => 12 },
      "./journal-records": { actorPayoutRecords: () => [] },
      "./downtime-model": model,
      "./downtime-store": {
        getIndex: () => state,
        getDowntime: () => ({ events: [] }),
      },
      "./downtime-records": {
        storedHustleDays: () => 0,
        storedDowntimeBalance: (id) => ({ a1: 3, a2: 7 })[id],
      },
    },
  );
  const inbox = load(
    "payout-inbox",
    {
      game,
      nomadReads,
      Hooks: { on: (name, fn) => hooks.set(name, fn) },
      setTimeout: (fn) => {
        const id = {};
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      FormApplication: class {
        activateListeners() {}
        render(force, options) {
          this.rendered = true;
          renders.push({ force, options, app: this });
          return this;
        }
        static get defaultOptions() {
          return { classes: [] };
        }
      },
    },
    {
      "./constants": { MODULE_ID: "pneuma-crewtools" },
      "./id": { createUniqueId: () => "" },
      "./journal-records": {
        allActorRecords: () => p1.getFlag(),
        actorPayoutRecords: (actorId) => (actorId === "a1" ? p1.getFlag() : []),
      },
      "./headquarters": { openHeadquarters: () => {} },
      "./downtime": { openDowntime: () => {} },
      "./player-hub-status": status,
      "./humanity-prompts": { getPendingHumanityRolls: () => [] },
    },
  );
  return {
    game,
    nomadReads,
    p1,
    p2,
    gm,
    actor,
    state,
    status,
    inbox,
    nomadReadCount: () => nomadReadCount,
    hooks,
    timers,
    renders,
  };
}
const template = Handlebars.compile(
  fs.readFileSync(
    new URL("../static/templates/payout-inbox.hbs", import.meta.url),
    "utf8",
  ),
);
test("hub displays current character values and Journal balance while retaining payout acknowledgements", () => {
  const f = fixture();
  const data = new f.inbox.PlayerHub().getData();
  assert.equal(data.status.money, "1,250");
  assert.equal(data.status.ip, "45");
  assert.equal(data.status.reputation, "3");
  assert.equal(data.status.downtime, "3");
  assert.equal(data.cards[0].acknowledgmentId, "ack1");
  const html = template(data);
  assert.match(html, /data-hub-downtime/);
  assert.match(html, /data-ack-id="ack1"/);
  assert.match(html, /The Pickup/);
  assert.match(html, /Rent &amp; Lifestyle|Rent & Lifestyle/);
  assert.match(html, /data-hub-actor/);
  f.actor.system.wealth.value = 0;
  assert.equal(new f.inbox.PlayerHub().getData().status.money, "0");
});
test("dashboard selector is Actor-based and excludes unowned characters for players", () => {
  const f = fixture();
  assert.equal(f.status.getHubStatus("a2").actorId, "a1");
  assert.equal(f.status.getHubStatus("a2").actors.length, 1);
  f.game.user = f.gm;
  assert.equal(f.status.getHubStatus("a2").actorId, "a2");
  assert.equal(f.status.getHubStatus("a2").downtime, "7");
  assert.match(template(new f.inbox.PlayerHub().getData()), /data-hub-actor/);
});
test("missing or inaccessible character and missing downtime are shown as unavailable, not zero", () => {
  const f = fixture();
  f.actor.testUserPermission = () => false;
  assert.equal(f.status.getHubStatus().money, "—");
  f.p1.character = null;
  f.state.accounts = [];
  const data = f.status.getHubStatus();
  assert.equal(data.ip, "—");
  assert.equal(data.downtime, "—");
  assert.match(data.downtimeNote, /GM setup/);
});
test("hub template escapes names and activities and keeps the dashboard when no payouts await", () => {
  const f = fixture();
  f.actor.name = "<img src=x onerror=alert(1)>";
  f.p1.getFlag = () => [];
  const html = template(new f.inbox.PlayerHub().getData());
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Current Status/);
  assert.match(html, /No\s+payouts are waiting/);
});
test("downtime template selects the character passed from the hub and compiles successfully", () => {
  const html = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/downtime.hbs", import.meta.url),
      "utf8",
    ),
  )({
    ready: true,
    hasActor: true,
    balance: 7,
    actorId: "a2",
    hasMultipleActors: true,
    actors: [
      { id: "a1", name: "One", selected: false },
      { id: "a2", name: "Two", selected: true },
    ],
  });
  assert.doesNotMatch(html, /name="userId"/);
  assert.match(html, /7<\/strong>/);
  assert.match(html, /<option\s+value="a2"\s+selected\s*>/);
  assert.doesNotMatch(html, /<option\s+value="a1"\s+selected\s*>/);
});

test("weekly UI removes hustle and therapy plus controls while retaining result rolls", () => {
  const template = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/downtime.hbs", import.meta.url),
      "utf8",
    ),
  );
  const html = template({
    ready: true,
    hasActor: true,
    fullWeek: true,
    hasRoleAreas: true,
    canMedtech: true,
    canRollHustle: true,
    patient: { name: "Standard", days: 7, canFinish: true, formula: "2d6" },
    provider: {
      name: "Standard",
      days: 7,
      canFinish: true,
      targetName: "Patient",
    },
  });
  assert.doesNotMatch(html, /data-hustle-day/);
  assert.doesNotMatch(html, /data-medical-action="(?:patientDay|providerDay)"/);
  assert.doesNotMatch(
    html,
    /aria-label="(?:Hustle|Patient therapy|Provider therapy) progress"/,
  );
  assert.match(html, /data-hustle-roll/);
  assert.match(html, /data-medical-action="patientComplete"/);
  assert.match(html, /data-medical-action="providerComplete"/);
  const empty = template({
    ready: true,
    hasActor: true,
    fullWeek: true,
    hasRoleAreas: true,
    canMedtech: true,
    canStartPatient: false,
    canStartProvider: false,
  });
  assert.match(empty, /data-medical-action="patientStart"\s+disabled/);
  assert.match(empty, /Start Therapy\s+· 7 days/);
});

test("hub balance reads do not touch transaction history", () => {
  const f = fixture();
  Object.defineProperty(f.state, "events", {
    get() {
      throw Error("History must not be read for status");
    },
  });
  assert.equal(f.status.getHubStatus().downtime, "3");
});

test("Pharma action is visible only for the selected ranked Medtech", () => {
  const f = fixture();
  assert.doesNotMatch(
    template(new f.inbox.PlayerHub().getData()),
    /data-hub-pharma-panel/,
  );
  f.actor.items = [{ type: "role", name: "Medtech", system: { rank: 1 } }];
  assert.match(
    template(new f.inbox.PlayerHub().getData()),
    /data-hub-pharma-panel/,
  );
  f.actor.items[0].system.rank = 0;
  assert.doesNotMatch(
    template(new f.inbox.PlayerHub().getData()),
    /data-hub-pharma-panel/,
  );
});

test("background Hub refreshes preserve focus and never reopen a closed Hub", () => {
  const f = fixture();
  f.game.settings.register = () => {};
  f.inbox.registerPayoutInboxSettings();
  f.inbox.openPlayerHub();
  assert.equal(f.renders[0].force, true);
  const page = { getFlag: () => "activities" };
  f.hooks.get("updateJournalEntryPage")(page);
  f.hooks.get("updateActor")(f.actor, { name: "Renamed" });
  assert.equal(f.timers.size, 1);
  for (const fn of f.timers.values()) fn();
  f.timers.clear();
  assert.equal(f.renders.length, 2);
  assert.equal(f.renders[1].force, false);
  assert.equal(f.renders[1].options.focus, false);
  f.hooks.get("updateJournalEntryPage")(page);
  f.renders[0].app.rendered = false;
  for (const fn of f.timers.values()) fn();
  assert.equal(f.renders.length, 2);
});

test("HUD receipt counting avoids reading award details and honors recipients", () => {
  const f = fixture();
  const ack = f.p1.getFlag()[0];
  // Validation checks the array but counting must never traverse or clone its contents.
  ack.awards = [
    new Proxy(
      {},
      {
        ownKeys() {
          throw Error("Award details should not be cloned");
        },
      },
    ),
  ];
  f.p1.getFlag = () => [
    ack,
    { ...ack, userId: "p2", id: "ack2" },
    { ...ack, id: "done", acknowledgedAt: "today" },
  ];
  assert.equal(f.inbox.waitingPayoutCount(), 1);
  f.game.user = f.gm;
  assert.equal(f.inbox.waitingPayoutCount(), 2);
});

test("resource tile shortcuts open the selected actor's native ledgers", async () => {
  const f = fixture();
  const calls = [];
  f.actor.sheet = {
    async showLedger(property) {
      assert.equal(this, f.actor.sheet);
      calls.push(property);
    },
  };
  const buttons = ["wealth", "improvementPoints", "reputation"].map(
    (property) => ({
      dataset: { hubLedger: property },
      addEventListener(_event, callback) {
        this.click = callback;
      },
    }),
  );
  const form = new f.inbox.PlayerHub();
  const data = form.getData();
  const html = template(data);
  for (const property of ["wealth", "improvementPoints", "reputation"])
    assert.match(html, new RegExp('data-hub-ledger="' + property + '"'));
  form.activateListeners([
    {
      querySelector: () => null,
      querySelectorAll: (selector) =>
        selector === "[data-hub-ledger]" ? buttons : [],
    },
  ]);
  for (const button of buttons) button.click();
  await Promise.resolve();
  assert.deepEqual(calls, ["wealth", "improvementPoints", "reputation"]);
});

test("Hub skips roster reads while closed or for unrelated changes and refreshes linked vehicle HP", () => {
  const f = fixture();
  f.game.settings.register = () => {};
  f.inbox.registerPayoutInboxSettings();
  f.inbox.openPlayerHub();
  f.renders[0].app.getData();
  const update = f.hooks.get("updateActor");
  update({ id: "vehicle" }, { "system.wealth.value": 1 });
  assert.equal(f.nomadReadCount(), 0);
  update({ id: "vehicle" }, { "system.derivedStats.hp.value": 10 });
  assert.equal(f.nomadReadCount(), 1);
  assert.equal(f.timers.size, 1);
  f.renders[0].app.rendered = false;
  update({ id: "vehicle" }, { img: "changed.webp" });
  assert.equal(f.nomadReadCount(), 1);
});
