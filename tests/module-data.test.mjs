import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const ns = "pneuma-crewtools";
function fixture() {
  const calls = [],
    registry = new Map();
  const gm = { id: "gm", isGM: true, active: true };
  const game = {
    user: gm,
    users: [gm],
    world: { id: "world1" },
    modules: new Map([[ns, { version: "0.6.1" }]]),
    actors: [],
    items: [],
    tables: [],
    journal: [],
    folders: [],
    settings: {
      settings: new Map([
        [ns + ".option", { namespace: ns, key: "option", scope: "world" }],
      ]),
      get: () => true,
      set: async (...args) => calls.push(["setting", ...args]),
    },
  };
  const doc = (raw, collection) => {
    const result = {
      id: raw._id,
      name: raw.name,
      raw: structuredClone(raw),
      pages: [],
      items: [],
      results: [],
      toObject() {
        return {
          ...structuredClone(this.raw),
          ...(raw.pages ? { pages: this.pages.map((p) => p.toObject()) } : {}),
          ...(raw.results
            ? { results: this.results.map((p) => p.toObject()) }
            : {}),
        };
      },
      async update(changes) {
        calls.push(["update", this.id, structuredClone(changes)]);
        if (this.fail) throw new Error("simulated write failure");
        for (const [key, value] of Object.entries(changes)) {
          const keys = key.split(".");
          let target = this.raw;
          for (const segment of keys.slice(0, -1))
            target = target[segment] ??= {};
          target[keys.at(-1)] = structuredClone(value);
        }
      },
      async deleteEmbeddedDocuments(type, ids) {
        calls.push(["delete", this.id, ids]);
        this.pages = this.pages.filter((p) => !ids.includes(p.id));
      },
      async createEmbeddedDocuments(type, rows) {
        for (const row of rows)
          doc(row, type === "JournalEntryPage" ? this.pages : this.results);
      },
    };
    for (const p of raw.pages ?? []) doc(p, result.pages);
    for (const r of raw.results ?? []) doc(r, result.results);
    collection.push(result);
    return result;
  };
  const actor = doc(
    {
      _id: "actor1",
      name: "Solo",
      flags: { [ns]: { hq: { rooms: 1 } }, other: { keep: true } },
      system: { wealth: 100 },
    },
    game.actors,
  );
  const receipts = [
    { id: "pending1", actorId: "actor1", userId: "gm", acknowledgedAt: null },
    {
      id: "done1",
      actorId: "actor1",
      userId: "gm",
      acknowledgedAt: "2026-09-15",
    },
    { id: "pending2", actorId: "actor1", userId: "gone", acknowledgedAt: null },
  ];
  const journal = doc(
    {
      _id: "journal1",
      name: "Solo records",
      flags: { [ns]: { recordKind: "character", actorId: "actor1" } },
      pages: [
        {
          _id: "page1",
          name: "Receipts",
          type: "text",
          flags: { [ns]: { recordKey: "acknowledgments", data: receipts } },
          text: { content: "Receipts" },
        },
        {
          _id: "projects",
          name: "Active Projects",
          type: "text",
          flags: {
            [ns]: {
              recordKey: "activities",
              activities: [{ status: "active", id: "project1" }],
            },
          },
          text: { content: "Work" },
        },
      ],
    },
    game.journal,
  );
  const context = vm.createContext({
    game,
    structuredClone,
    console,
    Blob,
    URL,
    setTimeout,
    JournalEntry: { create: async (data) => doc(data, game.journal) },
    RollTable: { create: async (data) => doc(data, game.tables) },
    Folder: { create: async (data) => doc(data, game.folders) },
  });
  function load(name) {
    if (registry.has(name)) return registry.get(name);
    const exports = {};
    registry.set(name, exports);
    const source = ts.transpileModule(
      fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const require = (key) =>
      key === "./action-coordinator"
        ? {
            withGMAction: async (fn) => {
              if (!game.user.isGM) throw new Error("GM only");
              return fn();
            },
          }
        : key === "./journal-format"
          ? { storedDetails: () => "details" }
          : key === "./payout-journal-view"
            ? { recordSummary: (_k, rows) => JSON.stringify(rows) }
            : load(key.slice(2));
    vm.runInContext(`(function(exports, require) { ${source}\n})`, context)(
      exports,
      require,
    );
    return exports;
  }
  return {
    game,
    actor,
    journal,
    doc,
    calls,
    model: load("module-data-model"),
    service: load("module-data-service"),
  };
}
test("backup captures only module flags from Actors; world metadata and active projects survive", () => {
  const { service } = fixture(),
    backup = service.captureBackup();
  assert.equal(backup.worldId, "world1");
  const actor = backup.entries.find((e) => e.kind === "actor");
  assert.equal(actor.data.system, undefined);
  assert.equal(actor.data.flags.other, undefined);
  assert.equal(
    backup.entries.find((e) => e.kind === "journal").data.pages[1].flags[ns]
      .activities[0].id,
    "project1",
  );
});
test("cleanup separates pending receipts and completed receipts including missing recipients", async () => {
  const { service, journal, calls } = fixture();
  const targets = service.previewCleanup("pendingReceipts", "actor1");
  assert.equal(targets.length, 1);
  assert.equal(targets[0].removed.length, 2);
  const report = await service.applyCleanup(
    "pendingReceipts",
    "actor1",
    targets,
  );
  assert.equal(report.failed.length, 0);
  assert.equal(journal.pages[0].raw.flags[ns].data.length, 1);
  assert.equal(journal.pages[0].raw.flags[ns].data[0].id, "done1");
  assert.equal(journal.pages[1].raw.flags[ns].activities.length, 1);
  assert.equal(calls.filter((c) => c[0] === "update").length, 1);
});
test("stale cleanup preview and connected users prevent writes", async () => {
  const { service, journal, calls, game } = fixture();
  const targets = service.previewCleanup("receipts");
  journal.pages[0].raw.flags[ns].data.push({
    id: "new",
    acknowledgedAt: "today",
  });
  await assert.rejects(
    service.applyCleanup("receipts", "", targets),
    /changed/,
  );
  game.users.push({ id: "player", active: true });
  await assert.rejects(
    service.applyCleanup("receipts", "", service.previewCleanup("receipts")),
    /disconnect/,
  );
  assert.equal(calls.length, 0);
});
test("partial cleanup reports failure and stops later writes", async () => {
  const { service, journal, doc, game } = fixture();
  journal.pages[0].fail = true;
  const second = doc(
    {
      _id: "j2",
      name: "Other",
      flags: { [ns]: { recordKind: "character", actorId: "actor2" } },
      pages: [
        {
          _id: "p2",
          type: "text",
          name: "Receipts",
          flags: {
            [ns]: {
              recordKey: "acknowledgments",
              data: [{ acknowledgedAt: null }],
            },
          },
        },
      ],
    },
    game.journal,
  );
  const report = await service.applyCleanup(
    "pendingReceipts",
    "",
    service.previewCleanup("pendingReceipts"),
  );
  assert.equal(report.failed.length, 1);
  assert.equal(report.skipped.length, 1);
  assert.equal(second.pages[0].raw.flags[ns].data.length, 1);
});
test("inspection includes pending rent contributions and interrupted payment attempts", () => {
  const { service, journal, doc } = fixture();
  doc(
    {
      _id: "rent",
      name: "Rent",
      type: "text",
      flags: {
        [ns]: {
          recordKey: "rent",
          data: {
            contributions: [{ status: "pending" }],
            due: [{ period: "2045-01" }],
            attempt: { before: 10, after: 0 },
          },
        },
      },
    },
    journal.pages,
  );
  const entry = service
    .inspectEntries(service.captureBackup())
    .find((e) => e.kind === "journal");
  assert.equal(entry.pending, 5);
  assert.match(entry.warnings.join(), /Interrupted/);
});

test("exports remain read-only and expose no restore API", () => {
  const { service, model, game } = fixture();
  assert.equal(service.restoreBackup, undefined);
  assert.equal(service.previewRestore, undefined);
  assert.equal(model.parseBackup, undefined);
  assert.ok(service.captureBackup().entries.length);
  game.user.isGM = false;
  assert.throws(() => service.captureBackup(), /GM/);
});
