import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/cleanup-settings.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const treeSource = ts.transpileModule(
  fs.readFileSync(new URL("../src/cleanup-tree.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const template = fs.readFileSync(
  new URL("../static/templates/cleanup.hbs", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  await page.setContent(
    '<main id="pneuma-crewtools-cleanup" class="pneuma-crewtools"></main>',
  );
  await page.addScriptTag({
    path: require.resolve("handlebars/dist/handlebars.js"),
  });
  await page.addStyleTag({
    content:
      fs.readFileSync(
        new URL("../src/styles/pneuma-crewtools.css", import.meta.url),
        "utf8",
      ) +
      "\n*{box-sizing:border-box}body{background:#333;font:14px Arial;color:#222}main{width:1020px;height:720px;padding:12px;margin:16px auto;background:#eee}button,input{font:inherit;padding:5px}table{border-collapse:collapse}th{text-align:left;padding:8px}td{border-bottom:1px solid #bbb}p{line-height:1.4}button{cursor:pointer}",
  });
  await page.evaluate(
    ({ source, treeSource, template }) => {
      const ns = "pneuma-crewtools";
      window.calls = [];
      window.notices = [];
      window.dialog = null;
      const gm = { id: "gm", active: true, isGM: true };
      window.game = {
        user: gm,
        users: [gm],
        actors: [],
        settings: {
          registerMenu(_ns, key, value) {
            window.menu = { key, ...value };
          },
        },
      };
      window.ui = {
        notifications: Object.fromEntries(
          ["info", "warn", "error"].map((k) => [
            k,
            (msg) => notices.push([k, msg]),
          ]),
        ),
      };
      Handlebars.registerHelper("disabled", (value) =>
        value ? "disabled" : "",
      );
      window.rows = Array.from({ length: 20 }, (_, i) => ({
        id: "row" + i,
        category: i === 0 ? "Pharmaceutical transfers" : "Payouts",
        name:
          i === 0
            ? "Administer Pharma"
            : i === 1
              ? "Downtime Log"
              : "Payout acknowledgments — Character " + i,
        location:
          "Journal sidebar → Crew Tools → Character Records → Character " +
          i +
          " → " +
          (i === 0 ? "Administer Pharma" : "History"),
        objectType: "Journal Entry Page",
        journalId: "journal" + i,
        pageId: "page" + i,
        count: 75,
        eligible: i === 1 ? 0 : 70,
        bytes: 18000,
        recommended: i === 1 ? null : 50,
        note:
          i === 1
            ? "Protected: history is required to calculate balances."
            : "Completed history can be removed. Pending records stay.",
        mode: i === 1 ? "protected" : i === 0 ? "pharma" : "receipts",
        snapshot: "initial",
      }));
      class Base {
        static get defaultOptions() {
          return {};
        }
        activateListeners() {}
        render() {
          document.querySelector("main").innerHTML = Handlebars.compile(
            template,
          )(this.getData());
          this.activateListeners([document.querySelector("main")]);
          return this;
        }
      }
      window.Dialog = class {
        constructor(config) {
          this.config = config;
        }
        render() {
          window.dialog = this.config;
          return this;
        }
      };
      const treeExports = {};
      new Function("exports", "require", treeSource)(treeExports, () => ({
        moduleFlags: (r) => r.flags?.[ns] ?? {},
      }));
      const backup = () => ({
        entries: rows.map((r, i) => ({
          kind: "journal",
          id: r.journalId,
          name: "Character " + i,
          data: {
            flags: { [ns]: { recordKind: "character" } },
            pages: [
              {
                _id: r.pageId,
                name: r.name,
                flags: { [ns]: { recordKey: "history" } },
              },
            ],
          },
        })),
      });
      const exports = {};
      new Function("exports", "require", source)(exports, (path) =>
        path === "./cleanup-tree"
          ? treeExports
          : path === "./foundry-form"
            ? { CrewToolsForm: Base }
            : path === "./constants"
              ? { MODULE_ID: ns }
              : path === "./journal-format"
                ? { recordEscape: (v) => Handlebars.escapeExpression(v) }
                : {
                    captureBackup: backup,
                    recordWarnings: () => [],
                    cleanupRows: () => rows,
                    formatRecordSize: (n) => (n / 1024).toFixed(1) + " KB",
                    previewRetention: (r, k) => Math.max(0, r.eligible - k),
                    purgeRecordHistory: async (id, keep, snapshot) => {
                      calls.push({ id, keep, snapshot });
                      const r = rows.find((x) => x.id === id);
                      const count = r.eligible - keep;
                      r.count -= count;
                      r.eligible = keep;
                      return count;
                    },
                  },
      );
      exports.registerCleanupSettings();
      window.app = new exports.CleanupSettings();
      app.render();
    },
    { source, treeSource, template },
  );
  assert.equal(await page.evaluate(() => menu.restricted), true);
  assert.equal(await page.locator("[data-cleanup-category][open]").count(), 0);
  await page
    .locator('[data-cleanup-category="group:JournalEntry"] > summary')
    .click();
  for (const id of [
    "JournalEntry.journal0",
    "JournalEntry.journal0.JournalEntryPage.page0",
    "JournalEntry.journal1",
    "JournalEntry.journal1.JournalEntryPage.page1",
  ])
    await page
      .locator('[data-cleanup-category="' + id + '"] > summary')
      .click();

  assert.equal(await page.locator('[data-keep="row0"]').inputValue(), "50");
  assert.equal(await page.locator('[data-purge="row1"]').count(), 0);
  const metrics = await page.locator(".cleanup-records").evaluate((e) => ({
    h: e.clientHeight,
    sh: e.scrollHeight,
    w: e.clientWidth,
    sw: e.scrollWidth,
  }));
  assert.ok(metrics.sh > metrics.h);
  assert.ok(metrics.h > 400);
  assert.ok(metrics.sw <= metrics.w + 1);
  await page.locator('[data-keep="row0"]').fill("10");
  await page.locator('[data-purge="row0"]').click();
  assert.match(await page.evaluate(() => dialog.content), /Remove 60/);
  assert.match(await page.evaluate(() => dialog.content), /chat cards/);
  await page.evaluate(() => dialog.buttons.cancel.callback());
  await page.waitForFunction(
    () => !document.querySelector('[data-purge="row0"]').disabled,
  );
  assert.equal(await page.evaluate(() => calls.length), 0);
  assert.equal(await page.locator('[data-keep="row0"]').inputValue(), "10");
  await page.locator('[data-keep="row0"]').fill("-1");
  await page.evaluate(() => (window.dialog = null));
  await page.locator('[data-purge="row0"]').click();
  assert.equal(await page.evaluate(() => dialog), null);
  await page.locator('[data-keep="row0"]').fill("0");
  await page.locator('[data-purge="row0"]').click();
  await page.evaluate(() => dialog.buttons.purge.callback());
  await page.waitForFunction(
    () =>
      calls.length === 1 &&
      !document.querySelector('[data-purge="row0"]').disabled,
  );
  assert.deepEqual(await page.evaluate(() => calls[0]), {
    id: "row0",
    keep: 0,
    snapshot: "initial",
  });
  assert.match(
    await page.locator('[data-purge="row0"]').locator("..").innerText(),
    /5 protected/,
  );
  await page.evaluate(() => {
    game.users.push({ id: "player", active: true });
    app.render();
  });
  assert.match(await page.locator(".cleanup-notice").innerText(), /disconnect/);
  assert.ok(
    await page
      .locator("[data-reset-section]")
      .evaluate((e) => e.clientHeight >= 34),
  );

  await page
    .locator('[data-cleanup-category="JournalEntry.journal1"] > summary')
    .click();
  await page.locator("[data-cleanup-refresh]").click();
  assert.equal(
    await page
      .locator('[data-cleanup-category="JournalEntry.journal1"]')
      .evaluate((e) => e.open),
    false,
  );
  assert.equal(
    await page
      .locator('[data-cleanup-category="JournalEntry.journal0"]')
      .evaluate((e) => e.open),
    true,
  );
  await page.screenshot({
    path: process.env.CLEANUP_SCREENSHOT || "cleanup-preview.png",
  });
  console.log(
    "Cleanup browser checks passed: layout, menu access, protected rows, confirmation/cancel, input validation, keep zero, online-user notice. Mock Foundry services, real Edge DOM.",
  );
} finally {
  await browser.close();
}
