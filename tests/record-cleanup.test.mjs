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
    messages: [],
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
      getFlag(ns, key) {
        return this.raw.flags?.[ns]?.[key];
      },
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
    TextEncoder,
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
            : key === "./downtime-journal-view"
              ? { activityHtml: (rows) => JSON.stringify(rows) }
              : key === "./pharma-transfer"
                ? {
                    purgePharmaHistory: async (keep, actor, verify) => {
                      verify?.();
                      calls.push(["pharma", keep, actor]);
                    },
                  }
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
    service: load("record-cleanup"),
  };
}

test("inventory reports real locations, UTF-8 sizes and protected vs completed records", () => {
  const f = fixture();
  const before = f.service.cleanupRows();
  f.doc(
    {
      _id: "hustle",
      name: "Solo Hustle",
      flags: { [ns]: { hustleRole: "solo" } },
      results: [{ _id: "result", text: "Static result" }],
    },
    f.game.tables,
  );
  const rows = f.service.cleanupRows();
  assert.equal(rows.length, before.length);
  assert.equal(
    rows.reduce((n, r) => n + r.count, 0),
    before.reduce((n, r) => n + r.count, 0),
  );
  assert.equal(
    rows.reduce((n, r) => n + r.bytes, 0),
    before.reduce((n, r) => n + r.bytes, 0),
  );
  const receipt = rows.find((r) => r.key === "acknowledgments");
  assert.equal(receipt.objectType, "Journal Entry Page");
  assert.equal(receipt.category, "Payouts");
  assert.match(receipt.location, /Journal sidebar.*Solo records.*Receipts/);
  assert.equal(receipt.count, 3);
  assert.equal(receipt.eligible, 1);
  assert.equal(receipt.recommended, 50);
  assert.ok(receipt.bytes > 0);
  assert.equal(f.service.recordBytes("é"), 4);
  assert.ok(
    rows.some(
      (r) => r.objectType === "World setting" && r.mode === "protected",
    ),
  );
  assert.equal(f.calls.length, 0);
});

test("receipt retention deletes oldest completed entries and preserves pending receipts", async () => {
  const f = fixture();
  const p = f.journal.pages[0];
  p.raw.flags[ns].data.push({ id: "done2", acknowledgedAt: "later" });
  const r = f.service.cleanupRows().find((r) => r.key === "acknowledgments");
  assert.equal(await f.service.purgeRecordHistory(r.id, 1, r.snapshot), 1);
  assert.deepEqual(
    p.raw.flags[ns].data.map((r) => r.id),
    ["pending1", "pending2", "done2"],
  );
  const again = f.service
    .cleanupRows()
    .find((r) => r.key === "acknowledgments");
  assert.equal(
    await f.service.purgeRecordHistory(again.id, 0, again.snapshot),
    1,
  );
  assert.deepEqual(
    p.raw.flags[ns].data.map((r) => r.id),
    ["pending1", "pending2"],
  );
});

test("cleanup rejects stale previews, non-GMs, invalid counts and protected data", async () => {
  const f = fixture();
  const r = f.service.cleanupRows().find((r) => r.key === "acknowledgments");
  await assert.rejects(
    f.service.purgeRecordHistory(r.id, -1, r.snapshot),
    /whole number/,
  );
  f.journal.pages[0].raw.flags[ns].data.push({
    id: "new",
    acknowledgedAt: null,
  });
  await assert.rejects(
    f.service.purgeRecordHistory(r.id, 0, r.snapshot),
    /Records changed/,
  );
  const protectedRow = f.service
    .cleanupRows()
    .find((r) => r.mode === "protected");
  await assert.rejects(
    f.service.purgeRecordHistory(protectedRow.id, 0, protectedRow.snapshot),
    /protected/,
  );
  f.game.user = { id: "player", isGM: false };
  await assert.rejects(
    f.service.purgeRecordHistory(r.id, 0, r.snapshot),
    /Only a GM/,
  );
  assert.equal(f.calls.length, 0);
});

test("completed project cleanup keeps active projects and respects recovery markers", async () => {
  const f = fixture();
  const p = f.journal.pages[1];
  p.raw.flags[ns].activities.push(
    { id: "done", status: "completed" },
    { id: "cancel", status: "cancelled" },
  );
  let r = f.service.cleanupRows().find((r) => r.key === "activities");
  assert.equal(await f.service.purgeRecordHistory(r.id, 1, r.snapshot), 1);
  assert.deepEqual(
    p.raw.flags[ns].activities.map((r) => r.id),
    ["project1", "cancel"],
  );
  p.raw.flags[ns].medicalAttempt = { taskId: "uncertain" };
  r = f.service.cleanupRows().find((r) => r.key === "activities");
  assert.equal(r.mode, "protected");
  await assert.rejects(
    f.service.purgeRecordHistory(r.id, 0, r.snapshot),
    /protected/,
  );
});

test("roster cleanup preserves current slots and Loyalty", async () => {
  const f = fixture();
  const p = f.doc(
    {
      _id: "team",
      name: "Teammates",
      flags: {
        [ns]: {
          recordKey: "teammates",
          data: {
            slots: [{ actorId: "friend", loyalty: 8 }],
            history: [{ id: 1 }, { id: 2 }, { id: 3 }],
          },
        },
      },
    },
    f.journal.pages,
  );
  const r = f.service.cleanupRows().find((r) => r.key === "teammates");
  assert.equal(await f.service.purgeRecordHistory(r.id, 1, r.snapshot), 2);
  assert.deepEqual(p.raw.flags[ns].data.slots, [
    { actorId: "friend", loyalty: 8 },
  ]);
  assert.deepEqual(p.raw.flags[ns].data.history, [{ id: 3 }]);
});

test("payout history retains newest created pages regardless of manual page ordering", async () => {
  const f = fixture();
  const j = f.doc(
    {
      _id: "payout",
      name: "Payout Ledger",
      flags: { [ns]: { recordKind: "payoutLedger" } },
      pages: [3, 1, 2].map((n) => ({
        _id: "p" + n,
        name: "Payout " + n,
        _stats: { createdTime: n },
        flags: { [ns]: { recordKey: "pay" + n, data: { id: "pay" + n } } },
      })),
    },
    f.game.journal,
  );
  const r = f.service.cleanupRows().find((r) => r.mode === "payouts");
  assert.equal(await f.service.purgeRecordHistory(r.id, 1, r.snapshot), 2);
  assert.deepEqual(
    j.pages.map((p) => p.id),
    ["p3"],
  );
});

test("purge refuses concurrent users and leaves storage unchanged on failure", async () => {
  const f = fixture();
  const r = f.service.cleanupRows().find((r) => r.key === "acknowledgments");
  f.game.users.push({ id: "other", active: true });
  await assert.rejects(
    f.service.purgeRecordHistory(r.id, 0, r.snapshot),
    /disconnect/,
  );
  f.game.users.pop();
  f.journal.pages[0].fail = true;
  await assert.rejects(
    f.service.purgeRecordHistory(r.id, 0, r.snapshot),
    /simulated/,
  );
  assert.equal(f.journal.pages[0].raw.flags[ns].data.length, 3);
});

test("receipt retention uses creation dates when owner saves have reordered history", async () => {
  const f = fixture();
  const p = f.journal.pages[0];
  p.raw.flags[ns].data = [
    { id: "newest", createdAt: "2026-09-15T00:00:00Z", acknowledgedAt: "done" },
    { id: "oldest", createdAt: "2026-09-01T00:00:00Z", acknowledgedAt: "done" },
    { id: "middle", createdAt: "2026-09-08T00:00:00Z", acknowledgedAt: "done" },
  ];
  const r = f.service.cleanupRows().find((r) => r.key === "acknowledgments");
  await f.service.purgeRecordHistory(r.id, 1, r.snapshot);
  assert.deepEqual(
    p.raw.flags[ns].data.map((r) => r.id),
    ["newest"],
  );
});
