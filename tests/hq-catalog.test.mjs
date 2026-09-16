import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
test("custom improvement costs are saved, editable, and independent of DLC defaults", async () => {
  let rows = [],
    errors = [];
  const exports = {};
  const deps = {
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./foundry-form": {
      CrewToolsForm: class {
        render() {}
        activateListeners() {}
      },
    },
    "./id": { createUniqueId: () => "custom" },
    "./journal-records": {
      findRecordJournal: () => ({}),
      ensureRecordJournal: async () => ({}),
      readRecord: () => structuredClone(rows),
      writeRecord: async (j, k, n, data) => {
        rows = structuredClone(data);
      },
    },
    "./journal-format": { journalTable: () => "", recordEscape: String },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("../src/hq-catalog.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      require: (k) => deps[k],
      game: { user: { isGM: true } },
      ui: { notifications: { error: (e) => errors.push(e), info() {} } },
      structuredClone,
    },
  );
  assert.equal(exports.DEFAULT_HQ_IMPROVEMENTS.length, 12);
  const form = new exports.HqCatalogSettings();
  form.getData();
  let add;
  form.activateListeners({
    0: {
      querySelector: () => ({
        addEventListener: (_event, callback) => {
          add = callback;
        },
      }),
      querySelectorAll: () => [],
    },
  });
  add();
  await form._updateObject(
    {},
    {
      "name.custom": "Garden",
      "description.custom": "Food growing space.",
      "cost.custom": 15,
      "hasLevel2.custom": true,
      "level2Description.custom": "Larger garden.",
    },
  );
  assert.equal(exports.getHqCatalog().find((i) => i.id === "custom").cost, 15);
  assert.equal(rows[0].hasLevel2, true);
  assert.equal(rows[0].level2Description, "Larger garden.");
  await form._updateObject({}, { "cost.custom": 25 });
  assert.equal(rows[0].cost, 25);
  assert.ok(exports.DEFAULT_HQ_IMPROVEMENTS.every((i) => i.cost === 40));
  await form._updateObject({}, { "cost.custom": -1 });
  assert.equal(rows[0].cost, 25);
  assert.equal(errors.length, 1);
});
