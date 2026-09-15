import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
function fixture() {
  const calls = [],
    role = {
      id: "role",
      name: "Netrunner",
      type: "role",
      system: { rank: 4, mainRoleAbility: "Interface" },
    };
  const decks = ["owned", "carried", "equipped"].map((state, i) => ({
    id: "deck" + i,
    name: "Deck <" + i + ">",
    type: "cyberdeck",
    system: { equipped: state },
    sheet: {
      render: () => calls.push(["open", i]),
      _manageInstalledItems: async (type) => calls.push([type, i]),
    },
  }));
  const actor = {
    id: "actor",
    items: [role, ...decks],
    testUserPermission: () => true,
    sheet: { _cycleEquipState: (event) => calls.push(["equip", event]) },
  };
  const game = {
    user: { isGM: false },
    actors: { get: (id) => (id === "actor" ? actor : undefined) },
    i18n: { localize: (key) => key.split(".").pop() },
  };
  const cache = new Map();
  const load = (name) => {
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
      { exports, game, require: (p) => load(p.slice(2)) },
    );
    return exports;
  };
  return {
    actor,
    role,
    decks,
    calls,
    ...load("netrunner-system"),
    ...load("netrunner-panel"),
  };
}
test("Netrunner deck panel uses all inventory decks, native state glyphs, and escaped names", () => {
  const f = fixture(),
    data = f.netrunnerPanel(f.actor);
  assert.equal(data.visible, true);
  assert.equal(data.decks.length, 3);
  assert.deepEqual(
    Array.from(data.decks, (d) => d.icon),
    ["fas fa-circle-notch", "fas fa-suitcase", "fas fa-hand"],
  );
  const html = Handlebars.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  )({ netrunner: data });
  assert.match(html, /Deck &lt;0&gt;/);
  assert.match(html, /fa-solid fa-folder-plus/);
  assert.match(html, /fab fa-superpowers/);
  f.role.system.rank = 0;
  assert.equal(f.netrunnerPanel(f.actor).visible, false);
});
test("Deck actions delegate to native sheets and reject lost ownership or removed items", async () => {
  const f = fixture(),
    event = {
      currentTarget: {
        dataset: { itemId: "deck0", itemProp: "system.equipped" },
      },
    };
  for (const action of ["open", "equip", "programs", "upgrades"])
    await f.deckAction("actor", "deck0", action, event);
  assert.deepEqual(f.calls, [
    ["open", 0],
    ["equip", event],
    ["program", 0],
    ["itemUpgrade", 0],
  ]);
  f.actor.testUserPermission = () => false;
  await assert.rejects(
    f.deckAction("actor", "deck0", "equip", event),
    /control/,
  );
  f.actor.testUserPermission = () => true;
  f.actor.items = [];
  await assert.rejects(
    f.deckAction("actor", "deck0", "open", event),
    /Netrunner/,
  );
  f.actor.items = [f.role];
  await assert.rejects(
    f.deckAction("actor", "deck0", "open", event),
    /no longer/,
  );
});
test("Server Room gate uses level II, catalog identity and legacy names", () => {
  const f = fixture(),
    gate = (improvements) =>
      f.serverRoomAvailable({ headquarters: [{ improvements }] });
  assert.equal(gate([]), false);
  assert.equal(
    gate([{ catalogId: "serverRoom", name: "Server Room", level: 1 }]),
    false,
  );
  assert.equal(
    gate([{ catalogId: "serverRoom", name: "Renamed facility", level: 2 }]),
    true,
  );
  assert.equal(gate([{ name: "Server Room", level: 2 }]), true);
  assert.equal(
    gate([{ catalogId: "workshop", name: "Server Room", level: 2 }]),
    false,
  );
  assert.equal(f.netrunnerItem({ type: "program", system: {} }), true);
  assert.equal(
    f.netrunnerItem({ type: "itemUpgrade", system: { type: "cyberdeck" } }),
    true,
  );
  assert.equal(
    f.netrunnerItem({ type: "itemUpgrade", system: { type: "weapon" } }),
    false,
  );
});
