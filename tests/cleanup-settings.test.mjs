import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
  let captures = 0,
    rowReads = 0,
    revision = 1;
  const purges = [],
    errors = [],
    callbacks = {};
  const exports = {};
  const deps = {
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./foundry-form": {
      CrewToolsForm: class {
        activateListeners() {}
        render() {}
        async close() {}
      },
    },
    "./cleanup-tree": { buildCleanupTree: () => [] },
    "./journal-format": { recordEscape: (value) => String(value) },
    "./module-data-service": {
      captureBackup: () => {
        captures++;
        return { entries: [], revision };
      },
      recordWarnings: () => [],
      previewCleanup: () => [],
    },
    "./record-cleanup": {
      cleanupRows: (backup) => {
        rowReads++;
        return [
          {
            id: "row",
            name: "History",
            location: "Journal",
            mode: "receipts",
            raw: {},
            count: 1,
            eligible: 1,
            bytes: 1,
            snapshot: String(backup?.revision ?? revision),
          },
        ];
      },
      formatRecordSize: String,
      previewRetention: () => 1,
      purgeRecordHistory: async (...args) => {
        purges.push(args);
        return 1;
      },
    },
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/cleanup-settings.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (key) => deps[key],
      game: { actors: [], users: [], user: { id: "gm", isGM: true } },
      document: { getElementById: () => null },
      ui: { notifications: { info() {}, error: (e) => errors.push(e) } },
      Dialog: class {
        constructor(data) {
          this.data = data;
        }
        render() {
          this.data.buttons.purge.callback();
        }
      },
    },
  );
  const app = new exports.CleanupSettings();
  app.activateListeners([
    {
      querySelectorAll: () => [],
      querySelector: (selector) =>
        selector === "[data-cleanup-refresh]"
          ? { addEventListener: (_event, fn) => (callbacks.refresh = fn) }
          : null,
    },
  ]);
  return {
    app,
    callbacks,
    purges,
    errors,
    counts: () => ({ captures, rowReads }),
    change: () => revision++,
  };
}

test("Cleanup redraws reuse the display snapshot; refresh and reopening read new data", async () => {
  const f = fixture();
  f.app.getData();
  f.app.getData();
  assert.deepEqual(f.counts(), { captures: 1, rowReads: 1 });
  f.change();
  f.callbacks.refresh();
  f.app.getData();
  assert.deepEqual(f.counts(), { captures: 2, rowReads: 2 });
  await f.app.close();
  f.app.getData();
  assert.deepEqual(f.counts(), { captures: 3, rowReads: 3 });
});

test("Cleanup purge reads a fresh confirmation snapshot and invalidates display after action", async () => {
  const f = fixture();
  f.app.getData();
  f.change();
  await f.app.purge("row", 0);
  assert.equal(f.errors.length, 0);
  assert.equal(f.purges[0][2], "2");
  f.app.getData();
  assert.deepEqual(f.counts(), { captures: 2, rowReads: 3 });
});
