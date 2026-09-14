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
      ui: { notifications: { error: (e) => errors.push(e) } },
      structuredClone,
    },
  );
  assert.equal(exports.DEFAULT_HQ_IMPROVEMENTS.length, 12);
  const form = new exports.HqCatalogSettings();
  await form._updateObject(
    {},
    { name: "Garden", description: "Food growing space.", cost: 15 },
  );
  assert.equal(exports.getHqCatalog().find((i) => i.id === "custom").cost, 15);
  await form._updateObject({}, { "cost.custom": 25 });
  assert.equal(rows[0].cost, 25);
  assert.ok(exports.DEFAULT_HQ_IMPROVEMENTS.every((i) => i.cost === 40));
  await form._updateObject({}, { "cost.custom": -1 });
  assert.equal(rows[0].cost, 25);
  assert.equal(errors.length, 1);
});
