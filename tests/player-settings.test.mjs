import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  const client = {
    namespace: "pneuma-combattools",
    scope: "client",
    config: true,
  };
  const world = { ...client, scope: "world" },
    hidden = { ...client, config: false },
    menu = { restricted: false };
  const category = {
    id: "pneuma-combattools",
    settings: [client, world, hidden],
    menus: [menu, { restricted: true }],
    count: 5,
  };
  const game = {
    modules: new Map([
      [
        "pneuma-combattools",
        {
          id: "pneuma-combattools",
          title: "Pneuma's Combat Tools",
          active: true,
        },
      ],
      [
        "pneuma-crewtools",
        { id: "pneuma-crewtools", title: "Pneuma's Crew Tools", active: true },
      ],
    ]),
    settings: {
      settings: new Map([
        ["pneuma-combattools.client", client],
        ["pneuma-combattools.world", world],
        ["pneuma-combattools.hidden", hidden],
      ]),
      menus: new Map(),
    },
  };
  game.modules.set("pneuma-compendia", {
    id: "pneuma-compendia",
    title: "Pneuma Compendia",
    active: true,
  });
  game.modules.set("pneuma-scenetools", {
    id: "pneuma-scenetools",
    title: "Scene Tools",
    active: false,
  });
  let saved;
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/player-settings.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      game,
      Map,
      SettingsConfig: class {
        constructor() {}
        _prepareCategoryData() {
          return { categories: new Map([[category.id, category]]), total: 5 };
        }
        _updateObject(_e, data) {
          saved = data;
        }
      },
    },
  );
  return { api: exports, client, menu, saved: () => saved };
}
test("module-only player settings reuse native rows and exclude world, hidden and restricted controls", () => {
  const f = fixture(),
    app = f.api.createPlayerModuleSettings("pneuma-combattools");
  const data = app._prepareCategoryData();
  assert.equal(data.categories.size, 1);
  const cat = [...data.categories.values()][0];
  assert.equal(cat.settings.length, 1);
  assert.equal(cat.settings[0], f.client);
  assert.equal(cat.menus.length, 1);
  assert.equal(cat.menus[0], f.menu);
  assert.equal(data.total, 2);
  assert.equal(data.canConfigure, false);
});
test("native save receives only the selected module client values", async () => {
  const f = fixture();
  await f.api.createPlayerModuleSettings("pneuma-combattools")._updateObject(
    {},
    {
      "pneuma-combattools.client": 2,
      "pneuma-combattools.world": 3,
      "pneuma-combattools.hidden": 4,
      "other.field": 5,
    },
  );
  assert.deepEqual(Object.keys(f.saved()), ["pneuma-combattools.client"]);
  assert.equal(f.saved()["pneuma-combattools.client"], 2);
});

test("only active big four modules appear", () => {
  const f = fixture();
  assert.deepEqual(
    Array.from(f.api.playerSettingsModules(), (m) => m.id),
    ["pneuma-combattools", "pneuma-crewtools"],
  );
});
