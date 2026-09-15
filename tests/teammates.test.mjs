import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
import { journalWorld } from "./journal-world.mjs";
function fixture() {
  const gm = { id: "gm", name: "GM", isGM: true, active: true },
    player = { id: "player", name: "Player", isGM: false },
    outsider = { id: "outsider", name: "Other", isGM: false };
  let total = 1,
    privateRolls = false,
    loyaltyDie = "1d6";
  const messages = [];
  const headquarters = { headquarters: [] };
  const game = {
    user: gm,
    users: [gm, player, outsider],
    actors: [],
    settings: {
      get: (_ns, key) =>
        key === "loyaltyCheckDie"
          ? loyaltyDie
          : key === "privateActivityRolls"
            ? privateRolls
            : [],
    },
  };
  const actor = (id, type = "character", exec = false) => ({
    id,
    name: id,
    type,
    items: exec
      ? [
          {
            type: "role",
            name: "Exec",
            system: { rank: 4, mainRoleAbility: "Teamwork" },
          },
        ]
      : [],
    testUserPermission: (u, permission) =>
      u.isGM || (u.id === player.id && (exec || permission === "OBSERVER")),
    sheet: { render() {} },
    getFlag: () => undefined,
  });
  const exec = actor("Executive", "character", true),
    a = actor("Bodyguard", "mook"),
    b = actor("Driver", "character"),
    c = actor("Assistant", "mook");
  game.actors.push(exec, a, b, c);
  player.character = exec;
  const docs = journalWorld(game),
    cache = new Map();
  function load(name) {
    if (name === "headquarters") return { getHeadquarters: () => headquarters };
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        require: (key) => load(key.slice(2)),
        game,
        ...docs,
        structuredClone,
        console,
        Roll: class {
          constructor(formula) {
            assert.equal(formula, loyaltyDie === "1d10" ? "1d10" : "1d6");
          }
          async evaluate() {
            this.total = total;
            return this;
          }
        },
        ChatMessage: {
          async create(data) {
            messages.push(data);
            return data;
          },
        },
      },
    );
    return exports;
  }
  return {
    game,
    headquarters,
    gm,
    player,
    outsider,
    exec,
    a,
    b,
    c,
    load,
    messages,
    api: load("teammates"),
    store: load("journal-records"),
    setTotal: (n) => (total = n),
    setDie: (value) => (loyaltyDie = value),
    setPrivate: (b) => (privateRolls = b),
    async prepare() {
      await load("journal-records").ensureActorPayoutJournal(exec);
      game.user = player;
      gm.active = false;
    },
  };
}
test("Exec has exactly three slots; links use one Journal page and preserve Actor permissions", async () => {
  const f = fixture();
  await f.prepare();
  assert.equal(f.api.teammatePanel(f.exec.id).slots.length, 3);
  assert.equal(f.api.teammatePanel(f.a.id).visible, false);
  const permission = f.a.testUserPermission;
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  await f.api.linkTeammate(f.exec.id, 1, f.b.id, 5);
  await f.api.linkTeammate(f.exec.id, 2, f.c.id, 6);
  const j = f.store.actorPayoutJournal(f.exec.id);
  assert.equal(j.pages.length, 1);
  assert.equal(j.pages[0].name, "Teammates");
  assert.match(j.pages[0].text.content, /Loyalty Log/);
  assert.equal(f.a.testUserPermission, permission);
  assert.equal(f.a.testUserPermission(f.player, "OWNER"), false);
  assert.equal(f.load("actor-policy").isActorExcluded(f.b.id), true);
  assert.equal(
    f
      .load("player-discovery")
      .discoverPlayerAccounts()[0]
      .actors.some((a) => a.actorId === f.b.id),
    false,
  );
  await f.api.removeTeammate(f.exec.id, 1);
  assert.equal(f.load("actor-policy").isActorExcluded(f.b.id), false);
  assert.ok(f.game.actors.get(f.b.id));
  assert.equal(f.api.readTeam(f.exec.id).history.length, 4);
});
test("Loyalty changes are manual, logged, and preserve state on failed save", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  await f.api.changeLoyalty(f.exec.id, 0, -1, "GM correction");
  assert.equal(f.api.readTeam(f.exec.id).slots[0].loyalty, -1);
  assert.equal(f.api.readTeam(f.exec.id).history.at(-1).previous, 4);
  assert.equal(
    f.api.readTeam(f.exec.id).history.at(-1).reason,
    "GM correction",
  );
  await assert.rejects(f.api.changeLoyalty(f.exec.id, 0, 3, ""), /reason/);
  await assert.rejects(
    f.api.changeLoyalty(f.exec.id, 0, 3.5, "bad"),
    /whole number/,
  );
  const page = f.store.recordPage(
    f.store.actorPayoutJournal(f.exec.id),
    "teammates",
  );
  page.update = async () => {
    throw Error("write failed");
  };
  await assert.rejects(
    f.api.changeLoyalty(f.exec.id, 0, 6, "Raise"),
    /write failed/,
  );
  await assert.rejects(f.api.removeTeammate(f.exec.id, 0), /write failed/);
  assert.equal(f.api.readTeam(f.exec.id).slots[0].loyalty, -1);
});
test("Loyalty rolls use strict under, style cards, respect privacy, and never change Loyalty", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  const before = JSON.stringify(f.api.readTeam(f.exec.id));
  for (const [n, success] of [
    [3, true],
    [4, false],
    [6, false],
  ]) {
    f.setTotal(n);
    assert.equal((await f.api.rollLoyalty(f.exec.id, 0)).success, success);
    assert.match(f.messages.at(-1).content, /crewtools-roll-card/);
    assert.match(f.messages.at(-1).content, /&lt; Loyalty 4/);
    assert.equal(f.messages.at(-1).whisper.length, 0);
  }
  f.setPrivate(true);
  await f.api.rollLoyalty(f.exec.id, 0);
  assert.deepEqual(Array.from(f.messages.at(-1).whisper), ["gm", "player"]);
  assert.equal(JSON.stringify(f.api.readTeam(f.exec.id)), before);
  await f.api.changeLoyalty(f.exec.id, 0, 0, "Correction");
  f.setTotal(1);
  assert.equal((await f.api.rollLoyalty(f.exec.id, 0)).success, false);
  await f.api.changeLoyalty(f.exec.id, 0, 7, "Correction");
  f.setTotal(6);
  assert.equal((await f.api.rollLoyalty(f.exec.id, 0)).success, true);
});
test("Roster rejects invalid links, duplicate slots, non-Execs, and unauthorized writes/rolls", async () => {
  const f = fixture();
  await f.prepare();
  await assert.rejects(f.api.linkTeammate(f.exec.id, 3, f.a.id, 4), /three/);
  await assert.rejects(
    f.api.linkTeammate(f.exec.id, 0, f.exec.id, 4),
    /available/,
  );
  await assert.rejects(f.api.linkTeammate(f.a.id, 0, f.b.id, 4), /control/);
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  await assert.rejects(
    f.api.linkTeammate(f.exec.id, 1, f.a.id, 4),
    /available/,
  );
  await assert.rejects(f.api.linkTeammate(f.exec.id, 0, f.b.id, 4), /Remove/);
  f.game.user = f.outsider;
  await assert.rejects(f.api.linkTeammate(f.exec.id, 1, f.b.id, 4), /control/);
  await assert.rejects(f.api.changeLoyalty(f.exec.id, 0, 6, "bad"), /control/);
  await assert.rejects(f.api.removeTeammate(f.exec.id, 0), /control/);
  await assert.rejects(f.api.rollLoyalty(f.exec.id, 0), /control/);
  f.game.user = f.player;
  f.game.actors.splice(f.game.actors.indexOf(f.a), 1);
  assert.equal(f.api.teammatePanel(f.exec.id).slots[0].missing, true);
  await assert.rejects(f.api.rollLoyalty(f.exec.id, 0), /missing/);
  await f.api.removeTeammate(f.exec.id, 0);
});
test("Hub and payout exclusion inspect roster slots without loading Loyalty history", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  const data = f.store
    .recordPage(f.store.actorPayoutJournal(f.exec.id), "teammates")
    .getFlag("pneuma-crewtools", "data");
  Object.defineProperty(data, "history", {
    get() {
      throw Error("history read");
    },
  });
  assert.equal(f.api.teammatePanel(f.exec.id).slots[0].loyalty, 4);
  assert.equal(f.load("actor-policy").isActorExcluded(f.a.id), true);
  assert.ok(f.api.teammateCandidates(f.exec.id).length);
});
test("Player Hub template shows three slots and hides teammate controls for non-Execs", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  const render = Handlebars.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  );
  const html = render({ teammates: f.api.teammatePanel(f.exec.id) });
  assert.equal((html.match(/class="hub-teammate-slot"/g) || []).length, 3);
  assert.match(html, /Roll Loyalty Check/);
  assert.match(html, /Loyalty/);
  assert.doesNotMatch(
    render({ teammates: f.api.teammatePanel(f.b.id) }),
    /hub-teammate-slot/,
  );
  await f.store.refreshRecordTables();
  assert.match(
    f.store.recordPage(f.store.actorPayoutJournal(f.exec.id), "teammates").text
      .content,
    /Loyalty Log/,
  );
});

test("Players can assign visible Actors; inaccessible teammates are hidden while GM retains access", async () => {
  const f = fixture();
  await f.prepare();
  f.a.img = "portraits/bodyguard.webp";
  f.b.testUserPermission = (u) => u.isGM;
  assert.equal(
    f.api.teammateCandidates(f.exec.id).some((a) => a.id === f.b.id),
    false,
  );
  await assert.rejects(
    f.api.linkTeammate(f.exec.id, 0, f.b.id, 4),
    /available/,
  );
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 4);
  assert.equal(f.api.teammatePanel(f.exec.id).slots[0].img, f.a.img);
  const render = Handlebars.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  );
  assert.match(
    render({ teammates: f.api.teammatePanel(f.exec.id) }),
    /portraits\/bodyguard.webp/,
  );
  f.game.user = f.gm;
  await f.api.linkTeammate(f.exec.id, 1, f.b.id, 5);
  assert.equal(f.api.teammatePanel(f.exec.id).slots.length, 3);
  f.game.user = f.player;
  const panel = f.api.teammatePanel(f.exec.id);
  assert.equal(
    panel.slots.some((s) => s.name === f.b.name),
    false,
  );
  assert.doesNotMatch(render({ teammates: panel }), /Driver/);
  f.a.testUserPermission = (u) => u.isGM;
  assert.equal(
    f.api.teammatePanel(f.exec.id).slots.some((s) => s.name === f.a.name),
    false,
  );
});

test("Loyalty die switches to d10, preserves strict-under success, and labels the chat card", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.linkTeammate(f.exec.id, 0, f.a.id, 7);
  f.setDie("1d10");
  for (const [total, success] of [
    [6, true],
    [7, false],
    [10, false],
  ]) {
    f.setTotal(total);
    assert.equal((await f.api.rollLoyalty(f.exec.id, 0)).success, success);
    assert.match(f.messages.at(-1).content, /1d10/);
  }
  f.setDie("1d6");
  f.setTotal(6);
  assert.equal((await f.api.rollLoyalty(f.exec.id, 0)).success, true);
  assert.match(f.messages.at(-1).content, /1d6/);
});

test("Nomad roster has three initial slots, live Actor portraits/HP, permissions, and one Garage-gated bar", async () => {
  const f = fixture();
  await f.prepare();
  f.exec.items = [
    {
      type: "role",
      name: "Nomad",
      system: { rank: 4, mainRoleAbility: "Moto" },
    },
  ];
  f.a.img = "vehicles/car.webp";
  f.a.system = { derivedStats: { hp: { value: 23, max: 40 } } };
  const api = f.load("nomad-vehicles");
  const state = { events: [] };
  assert.equal(api.nomadVehiclePanel(f.exec, state, 7).slots.length, 3);
  f.b.testUserPermission = (u) => u.isGM;
  assert.equal(
    api.nomadVehicleCandidates(f.exec.id).some((a) => a.id === f.b.id),
    false,
  );
  await assert.rejects(api.setNomadVehicle(f.exec.id, 0, f.b.id), /available/);
  await api.setNomadVehicle(f.exec.id, 0, f.a.id);
  await assert.rejects(api.setNomadVehicle(f.exec.id, 1, f.a.id), /available/);
  await assert.rejects(api.setNomadVehicle(f.exec.id, 6, f.c.id), /six/);
  let panel = api.nomadVehiclePanel(f.exec, state, 7);
  assert.equal(panel.slots[0].img, "vehicles/car.webp");
  assert.equal(panel.slots[0].hp, 23);
  f.a.system.derivedStats.hp.value = 12;
  assert.equal(api.nomadVehiclePanel(f.exec, state, 7).slots[0].hp, 12);
  const h = Handlebars.create();
  h.registerHelper("disabled", (v) => (v ? "disabled" : ""));
  h.registerHelper("not", (v) => !v);
  const render = h.compile(
    fs.readFileSync("static/templates/downtime.hbs", "utf8"),
  );
  const html = () =>
    render({
      ready: true,
      hasActor: true,
      hasRoleAreas: true,
      nomad: api.nomadRespecPanel(f.exec, state, 7),
    });
  assert.equal((html().match(/class="nomad-respec"/g) ?? []).length, 1);
  assert.match(html(), /must have garage to use/);
  const locked = api.nomadRespecPanel(f.exec, state, 7);
  assert.equal(locked.cannotAdd, true);
  assert.equal(locked.cannotFill, true);
  assert.equal(locked.cannotReset, true);
  f.headquarters.headquarters = [{ improvements: [{ name: "Garage" }] }];
  assert.equal((html().match(/class="nomad-respec"/g) ?? []).length, 1);
  assert.doesNotMatch(html(), /class="nomad-vehicle-slot"/);
  const renderHub = h.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  );
  const hubHtml = renderHub({ nomad: api.nomadVehiclePanel(f.exec) });
  assert.equal((hubHtml.match(/class="nomad-vehicle-slot"/g) ?? []).length, 3);
  assert.match(hubHtml, /HP\s+12\s+\/\s+40/);
  assert.doesNotMatch(hubHtml, /class="nomad-respec"/);
  f.a.testUserPermission = (u) => u.isGM;
  assert.equal(
    api
      .nomadVehiclePanel(f.exec, state, 7)
      .slots.some((s) => s.name === f.a.name),
    false,
  );
  f.game.user = f.gm;
  assert.equal(api.nomadVehiclePanel(f.exec, state, 7).slots.length, 3);
  await api.setNomadVehicle(f.exec.id, 1, f.b.id);
  assert.equal(api.nomadVehiclePanel(f.exec).slots.length, 3);
  await api.setNomadVehicle(f.exec.id, 2, f.c.id);
  assert.equal(api.nomadVehiclePanel(f.exec).slots.length, 6);
  await api.setNomadVehicle(f.exec.id, 0);
  assert.equal(api.nomadVehiclePanel(f.exec).slots.length, 3);
  assert.ok(f.game.actors.get(f.a.id));
  assert.equal(api.readNomadVehicles(f.exec.id).history.length, 4);
  assert.equal(api.nomadVehiclePanel(f.c, state, 7).visible, false);
});

test("Nomad display reads slots without traversing history or exposing mutable records", async () => {
  const f = fixture();
  await f.prepare();
  f.exec.items = [{ type: "role", name: "Nomad", system: { rank: 4 } }];
  const api = f.load("nomad-vehicles");
  await api.setNomadVehicle(f.exec.id, 0, f.a.id);
  const data = f.store
    .recordPage(f.store.actorPayoutJournal(f.exec.id), "nomadVehicles")
    .getFlag("pneuma-crewtools", "data");
  Object.defineProperty(data, "history", {
    get() {
      throw Error("history read");
    },
  });
  assert.equal(api.nomadVehiclePanel(f.exec).slots[0].name, f.a.name);
  const slots = api.nomadVehicleSlots(f.exec.id);
  slots[0].actorId = "changed";
  assert.equal(api.nomadVehicleSlots(f.exec.id)[0].actorId, f.a.id);
});
