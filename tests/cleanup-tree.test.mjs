import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const exports = {};
new Function(
  "exports",
  "require",
  ts.transpileModule(
    fs.readFileSync(new URL("../src/cleanup-tree.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
)(exports, () => ({ moduleFlags: (r) => r.flags?.["pneuma-crewtools"] ?? {} }));
const ns = "pneuma-crewtools",
  flags = (v) => ({ [ns]: v });
const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children)]);
function fixture() {
  const journal = {
    _id: "j1",
    name: "Character Records",
    folder: "f1",
    flags: flags({ recordKind: "character", actorId: "a1" }),
    ownership: { gm: 3, default: 0 },
    pages: [
      {
        _id: "p1",
        name: "Payout Receipts",
        flags: flags({
          recordKey: "acknowledgments",
          data: [
            {
              actorId: "a1",
              sourceUuid: "Actor.a1.Item.i1",
              tableId: "custom",
            },
          ],
        }),
      },
      {
        _id: "p2",
        name: "Downtime",
        flags: flags({
          recordKey: "activities",
          data: [
            {
              itemId: "i1",
              sourceUuid: "Actor.a1.Item.i1",
              tableId: "custom",
              resultId: "r1",
            },
          ],
        }),
      },
    ],
  };
  const world = {
    journal: [journal],
    actors: [
      {
        _id: "a1",
        name: "V",
        items: [{ _id: "i1", name: "Armor", flags: flags({ repair: true }) }],
        flags: flags({ reference: true }),
      },
    ],
    folders: [{ _id: "f1", name: "Crew Tools", type: "JournalEntry" }],
    tables: [
      {
        _id: "custom",
        name: "GM Table",
        results: [{ _id: "r1", name: "Outcome" }],
      },
      {
        _id: "hustle",
        name: "Hustle",
        flags: flags({ hustleRole: "solo" }),
        results: [{ _id: "hr", name: "Hustle Result" }],
      },
    ],
    users: [{ id: "gm", name: "GM" }],
    settings: { settings: new Map() },
  };
  const backup = {
    entries: [{ kind: "journal", id: "j1", name: journal.name, data: journal }],
  };
  const rows = [
    { id: "j1:p1", journalId: "j1", pageId: "p1", count: 7, bytes: 120 },
    { id: "j1:p2", journalId: "j1", pageId: "p2", count: 3, bytes: 80 },
    { id: "actor::a1", count: 1, bytes: 20 },
  ];
  return { world, backup, rows };
}
test("groups Journals by folder and page, Actors by embedded Item, with each document once", () => {
  const f = fixture(),
    tree = exports.buildCleanupTree(f.backup, f.rows, f.world),
    all = flatten(tree);
  assert.equal(new Set(all.map((n) => n.id)).size, all.length);
  const node = (id) => all.find((n) => n.id === id);
  assert.equal(node("Folder.f1").children[0].id, "JournalEntry.j1");
  assert.deepEqual(
    node("JournalEntry.j1")
      .children.map((n) => n.id)
      .sort(),
    [
      "JournalEntry.j1.JournalEntryPage.p1",
      "JournalEntry.j1.JournalEntryPage.p2",
    ],
  );
  assert.equal(node("JournalEntry.j1").count, 10);
  assert.equal(node("JournalEntry.j1").bytes, 200);
  assert.equal(node("Actor.a1").children[0].id, "Actor.a1.Item.i1");
  assert.equal(node("Actor.a1.Item.i1").references.length, 2);
  assert.equal(node("RollTable.custom").references.length, 2);
  assert.equal(node("RollTable.custom").rows.length, 0);
  assert.equal(
    node("RollTable.custom").children[0].id,
    "RollTable.custom.TableResult.r1",
  );
  assert.match(node("RollTable.hustle").note, /static/);
  assert.equal(node("RollTable.hustle").count, 0);
  assert.equal(node("User.gm").references.length, 1);
  assert.ok(!node("User.default"));
});
test("finds flagged pages without a module-owned parent, chat cards, settings and missing references", () => {
  const f = fixture();
  f.world.journal.push({
    _id: "ordinary",
    name: "GM Journal",
    pages: [
      {
        _id: "own",
        name: "Own page",
        flags: flags({
          actorId: "deleted",
          sourceUuid: "Compendium.pack.items.Item.template",
        }),
      },
    ],
  });
  f.world.messages = [
    {
      _id: "chat1",
      flags: flags({
        pharmaOffer: { sourceId: "a1", targetId: "deleted", itemId: "lost" },
      }),
    },
  ];
  f.backup.entries.push({
    kind: "setting",
    id: "defaultPayoutContainerId",
    name: "Container",
    data: { value: "stash" },
  });
  f.world.settings = {
    settings: new Map([
      [
        "pref",
        { namespace: ns, key: "pref", scope: "client", name: "My Preference" },
      ],
    ]),
    get: () => true,
  };
  const all = flatten(exports.buildCleanupTree(f.backup, f.rows, f.world)),
    node = (id) => all.find((n) => n.id === id);
  assert.ok(node("JournalEntry.ordinary").children.length);
  assert.equal(node("Actor.deleted").missing, true);
  assert.equal(node("Actor.stash").missing, true);
  assert.equal(node("Actor.a1.Item.lost").type, "Item");
  assert.ok(node("Actor.a1").children.includes(node("Actor.a1.Item.lost")));
  assert.equal(node("Compendium.pack.items.Item.template").missing, false);
  assert.ok(node("ChatMessage.chat1"));
  assert.match(node("ClientSetting.pref").note, /browser/);
});
test("does not traverse unrelated native contents, other module flags or confuse transaction IDs with objects", () => {
  const f = fixture();
  f.world.actors[0].system = { reference: "Actor.notCrew" };
  f.world.actors[0].flags.other = { sourceUuid: "Item.notCrew" };
  f.world.journal[0].pages[0].flags[ns].data.push({
    id: "tx",
    payoutId: "pay",
    activityId: "act",
    requestId: "req",
  });
  const all = flatten(exports.buildCleanupTree(f.backup, f.rows, f.world));
  assert.ok(!all.some((n) => /notCrew|\.tx$|\.pay$|\.act$|\.req$/.test(n.id)));
});
test("damaged folder cycles remain finite and do not duplicate documents", () => {
  const f = fixture();
  f.world.folders[0].folder = "f2";
  f.world.folders.push({
    _id: "f2",
    name: "Other",
    type: "JournalEntry",
    folder: "f1",
  });
  const all = flatten(exports.buildCleanupTree(f.backup, f.rows, f.world));
  assert.equal(new Set(all.map((n) => n.id)).size, all.length);
  assert.equal(all.filter((n) => n.id === "JournalEntry.j1").length, 1);
});

test("missing Users separate obsolete permissions from historical references", () => {
  const f = fixture();
  f.world.journal[0].ownership = { gm: 3, gone: 2, default: 0 };
  f.world.journal[0].pages[0].flags[ns].data.push({ userId: "historical" });
  let all = flatten(exports.buildCleanupTree(f.backup, f.rows, f.world));
  assert.equal(all.find((n) => n.id === "User.gone").stalePermissions, 1);
  assert.equal(all.find((n) => n.id === "User.gone").missingUserId, "gone");
  assert.equal(
    all.find((n) => n.id === "User.historical").stalePermissions,
    undefined,
  );
  assert.equal(all.find((n) => n.id === "User.gm").missingUserId, undefined);
  delete f.world.journal[0].ownership.gone;
  all = flatten(exports.buildCleanupTree(f.backup, f.rows, f.world));
  assert.ok(!all.find((n) => n.id === "User.gone"));
  assert.ok(all.find((n) => n.id === "User.historical"));
});
