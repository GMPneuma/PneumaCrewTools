import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";

function fixture() {
  const gm = { id: "gm", isGM: true, active: true };
  const game = { user: gm, users: [gm], folders: [], tables: [] };
  let failRole;
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const code = ts.transpileModule(
      fs.readFileSync("src/" + name + ".ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (p) => load(p.replace("./", "")),
      game,
      console,
      Folder: {
        create: async (data) => {
          const folder = { ...data, id: "f" + game.folders.length };
          game.folders.push(folder);
          return folder;
        },
      },
      RollTable: {
        create: async (data) => {
          if (data.name === failRole) throw new Error("test creation failure");
          const table = {
            ...structuredClone(data),
            id: "t" + game.tables.length,
            async update(data) {
              Object.assign(this, data);
            },
            getFlag(ns, key) {
              return this.flags?.[ns]?.[key];
            },
          };
          game.tables.push(table);
          return table;
        },
      },
    });
    return exports;
  }
  return {
    game,
    load,
    fail: (role) => {
      failRole = role;
    },
  };
}

test("GM custom tables stay untouched even when named like module Hustle tables", async () => {
  const { load, game } = fixture();
  const custom = {
    id: "custom",
    name: "Hustle - Rockerboy",
    formula: "2d6",
    description: "GM custom table",
    results: [{ text: "Custom outcome" }],
    getFlag: () => undefined,
    update: async () => {
      throw new Error("Custom table must not be changed");
    },
  };
  game.tables.push(custom);
  const before = JSON.stringify(custom);
  await load("hustle-tables").ensureHustleTables();
  await load("hustle-tables").ensureHustleTables();
  assert.equal(game.tables.length, 11);
  assert.equal(JSON.stringify(custom), before);
  const main = fs.readFileSync("src/main.ts", "utf8");
  assert.match(main, /registerHustleTables\(\)/);
  assert.match(main, /readyHustleTables\(\)/);
});

test("all 60 hustle summaries match documentation and retain original mechanics", () => {
  const { load } = fixture();
  const actual = JSON.parse(
    JSON.stringify(load("hustle-table-data").HUSTLE_TABLES),
  );
  const expected = [];
  for (const line of fs
    .readFileSync("docs/hustle-tables-source.md", "utf8")
    .split(/\r?\n/)) {
    const heading = line.match(/^## (.+) Hustle$/);
    if (heading) expected.push({ role: heading[1], rows: [] });
    if (/^\|\s*[1-6]\s*\|/.test(line)) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((x) => x.trim());
      expected.at(-1).rows.push({
        roll: Number(cells[0]),
        activity: cells[1],
        earnings: cells.slice(2).map((x) => Number(x.replace("eb", ""))),
      });
    }
  }
  assert.equal(
    createHash("sha256")
      .update(
        JSON.stringify(
          actual.map((t) => [t.role, t.rows.map((r) => [r.roll, r.earnings])]),
        ),
      )
      .digest("hex"),
    "85694676f9d06238f6d59b79cf7b0963a69a821d271f7102c9d1d94ac8b78d80",
  );
  assert.equal(expected.length, 10);
  assert.deepEqual(actual, expected);
  for (const table of actual)
    assert.deepEqual(
      table.rows.map((r) => r.roll),
      [1, 2, 3, 4, 5, 6],
    );
});

test("creates native player-readable tables once in correct folder", async () => {
  const { load, game } = fixture();
  game.folders.push({
    id: "journal",
    name: "CrewTools",
    type: "JournalEntry",
    folder: null,
  });
  const { ensureHustleTables } = load("hustle-tables");
  await Promise.all([ensureHustleTables(), ensureHustleTables()]);
  assert.equal(game.folders.length, 2);
  assert.equal(game.tables.length, 10);
  for (const t of game.tables) {
    assert.equal(t.folder, "f1");
    assert.equal(t.formula, "1d6");
    assert.equal(t.description, `<p>${t.name.slice(9)} weekly hustle.</p>`);
    assert.equal(t.replacement, true);
    assert.equal(t.ownership.default, 2);
    assert.equal(t.results.length, 6);
    for (const [index, r] of t.results.entries()) {
      assert.deepEqual(r.range, [index + 1, index + 1]);
      assert.equal(r.type, 0);
      assert.equal(r.weight, 1);
      assert.match(r.text, /Rank 1 to 4/);
      assert.match(r.text, /Rank 5 to 7/);
      assert.match(r.text, /Rank 8 to 10/);
      assert.equal(Object.values(r.flags)[0].hustle.earnings.length, 3);
    }
  }
  game.tables[0].name = "Customized";
  game.tables[0].description = "Unnecessary table explanation";
  await ensureHustleTables();
  assert.equal(game.tables.length, 10);
  assert.equal(game.tables[0].name, "Customized");
  assert.equal(game.tables[0].description, "Unnecessary table explanation");
});

test("only primary GM creates tables and partial failure can retry without duplicates", async () => {
  const { load, game, fail } = fixture();
  const { ensureHustleTables } = load("hustle-tables");
  game.user = { id: "player", isGM: false };
  await ensureHustleTables();
  assert.equal(game.folders.length, 0);
  game.user = { id: "other", isGM: true, active: true };
  game.users.push(game.user);
  await ensureHustleTables();
  assert.equal(game.tables.length, 0);
  game.user = game.users[0];
  fail("Hustle - Netrunner");
  await assert.rejects(ensureHustleTables(), /test creation failure/);
  assert.equal(game.tables.length, 2);
  fail(undefined);
  await ensureHustleTables();
  assert.equal(game.tables.length, 10);
  assert.equal(game.folders.length, 1);
});

test("existing default summaries update once while GM edits and payouts survive", async () => {
  const { load } = fixture();
  const { updateHustleSummaries } = load("hustle-summary-migration");
  const defaults = load("hustle-tables").hustleTableData(
    load("hustle-table-data").HUSTLE_TABLES[0],
    "f1",
  );
  const activity = "Played a small local gig.";
  const text =
    "<p>" +
    activity +
    "</p><p><strong>Rank 1 to 4:</strong> 200eb · <strong>Rank 5 to 7:</strong> 300eb · <strong>Rank 8 to 10:</strong> 600eb</p>";
  for (const change of ["none", "text", "activity", "earnings", "range"]) {
    let version;
    let writes = 0;
    const stored = { roll: 1, activity, earnings: [200, 300, 600] };
    const result = { id: "r1", text, range: [1, 1], getFlag: () => stored };
    if (change === "text") result.text = "GM-written concert";
    if (change === "activity") stored.activity = "GM activity";
    if (change === "earnings") stored.earnings[0] = 999;
    if (change === "range") result.range = [1, 2];
    const before = JSON.stringify([result.text, stored, result.range]);
    const table = {
      results: [result],
      getFlag: () => version,
      update: async (d) => {
        version = d["flags.pneuma-crewtools.hustleSummaryVersion"];
      },
      updateEmbeddedDocuments: async (type, rows) => {
        assert.equal(type, "TableResult");
        writes++;
        for (const row of rows) {
          assert.equal(row._id, "r1");
          result.text = row.text;
          stored.activity = row["flags.pneuma-crewtools.hustle.activity"];
        }
      },
    };
    await updateHustleSummaries(table, "Rockerboy", defaults);
    if (change === "none") {
      assert.equal(stored.activity, "Neighborhood performance.");
      assert.deepEqual(stored.earnings, [200, 300, 600]);
      assert.equal(writes, 1);
    } else {
      assert.equal(JSON.stringify([result.text, stored, result.range]), before);
      assert.equal(writes, 0);
    }
    result.text = "Later GM edit";
    await updateHustleSummaries(table, "Rockerboy", defaults);
    assert.equal(result.text, "Later GM edit");
  }
});

test("summary update failure leaves the version unset for retry", async () => {
  const { load } = fixture();
  const { updateHustleSummaries } = load("hustle-summary-migration");
  const defaults = load("hustle-tables").hustleTableData(
    load("hustle-table-data").HUSTLE_TABLES[0],
    "f1",
  );
  let marked = false;
  const table = {
    getFlag: () => undefined,
    results: [
      {
        id: "r1",
        range: [1, 1],
        text: "<p>Played a small local gig.</p><p><strong>Rank 1 to 4:</strong> 200eb · <strong>Rank 5 to 7:</strong> 300eb · <strong>Rank 8 to 10:</strong> 600eb</p>",
        getFlag: () => ({
          roll: 1,
          activity: "Played a small local gig.",
          earnings: [200, 300, 600],
        }),
      },
    ],
    update: async () => {
      marked = true;
    },
    updateEmbeddedDocuments: async () => {
      throw Error("write failed");
    },
  };
  await assert.rejects(
    updateHustleSummaries(table, "Rockerboy", defaults),
    /write failed/,
  );
  assert.equal(marked, false);
});
