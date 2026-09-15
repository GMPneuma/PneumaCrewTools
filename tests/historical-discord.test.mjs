import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/" + file + ".ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (key) => {
        if (!(key in deps)) throw Error(key);
        return deps[key];
      },
      ...globals,
    },
  );
  return exports;
}
const formatter = load("historical-discord", {
  "./date-format": { displayDate: (x) => x },
});
function record() {
  const change = (reward, scope, amount, details = {}) => ({
    reward,
    targetType: "actor",
    targetId: "deleted",
    targetName: "Original Name",
    amount,
    previousValue: 10,
    newValue: 10 + amount,
    details: { scope, ...details },
  });
  return {
    id: "saved",
    createdAt: "2026-09-14",
    sessionLabel: "Old Session",
    inGameDate: "2078-03-18",
    notes: "Saved notes",
    participants: [{ actorId: "deleted", actorName: "Original Name" }],
    changes: [
      change("money", "group", 50),
      change("item", "individual", 2, { itemName: "Pistol" }),
      change("humanityGain", "individual", 0, {
        pendingPlayerRoll: true,
        formula: "2d6",
      }),
      change("hqIp", "group", 40),
      change("communalMoney", "communal", 100),
      change("downtime", "absent", 3),
      change("attendance", "individual", 1),
    ],
  };
}
test("historical export uses saved values, keeps every scope, and is repeatable without Actor access", () => {
  const r = record(),
    before = JSON.stringify(r);
  const links = { deleted: { kind: "user", id: "123456789012345" } };
  const output = formatter.historicalDiscordMarkdown(r, links);
  for (const text of [
    "Old Session",
    "Saved notes",
    "Original Name",
    "10 → 60 (+50)",
    "×2",
    "2d6 (pending at payout)",
    "Communal Payout",
    "Primary Payout",
    "Individual Payout",
    "Downtime — not in payout",
    "+3 days",
    "<@123456789012345>",
  ])
    assert.ok(output.includes(text), text);
  assert.ok(!output.includes("attendance"));
  assert.equal(formatter.historicalDiscordMarkdown(r, links), output);
  assert.equal(JSON.stringify(r), before);
  assert.ok(
    formatter.historicalDiscordMarkdown(r, {}).includes("Original Name"),
  );
});
test("history picker guards GM access, handles empty history and only exports the selected saved record", () => {
  const game = { user: { isGM: false } },
    dialogs = [],
    summaries = [],
    notifications = [];
  let records = [];
  const api = load(
    "payout-history-export",
    {
      "./payout-ledger": { getPayoutLedger: () => ({ records }) },
      "./discord-summary": {
        getDiscordLinks: () => ({}),
        showDiscordSummary: (text) => summaries.push(text),
      },
      "./historical-discord": formatter,
      "./downtime-store": { escape: (s) => s.replaceAll("<", "&lt;") },
      "./date-format": { displayDate: (x) => x },
    },
    {
      game,
      ui: { notifications: { info: (text) => notifications.push(text) } },
      Dialog: class {
        constructor(config) {
          dialogs.push(config);
        }
        render() {
          return this;
        }
      },
    },
  );
  assert.throws(() => api.openPayoutHistoryExport(), /Only a GM/);
  game.user.isGM = true;
  api.openPayoutHistoryExport();
  assert.equal(dialogs.length, 0);
  assert.equal(notifications.length, 1);
  records = [
    record(),
    { ...record(), id: "other", sessionLabel: "Other Session" },
  ];
  api.openPayoutHistoryExport();
  const exportSelected = () =>
    dialogs
      .at(-1)
      .buttons.export.callback([{ querySelector: () => ({ value: "saved" }) }]);
  exportSelected();
  exportSelected();
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0], summaries[1]);
  assert.ok(!summaries[0].includes("Other Session"));
  game.user.isGM = false;
  exportSelected();
  assert.equal(summaries.length, 2);
});
