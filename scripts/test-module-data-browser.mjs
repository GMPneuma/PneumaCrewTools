import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sources = Object.fromEntries(
  [
    "module-data-model",
    "cleanup-tree",
    "module-data-service",
    "cleanup-settings",
    "record-cleanup",
    "action-coordinator",
  ].map((name) => [
    name,
    ts.transpileModule(
      fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
  ]),
);
const template = fs.readFileSync(
  new URL("../static/templates/cleanup.hbs", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1050, height: 920 },
  });
  await page.setContent(
    '<main id="pneuma-crewtools-cleanup" style="width:800px;margin:20px auto"></main>',
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
      "\nbody{font:14px Arial;background:#eaeaea;color:#222}button,select,input{font:inherit}button{padding:5px} main{background:#fafafa;padding:12px}summary{padding:8px;cursor:pointer}fieldset{margin:8px 0}",
  });
  const result = await page.evaluate(
    async ({ sources, template }) => {
      Handlebars.registerHelper("disabled", (value) =>
        value ? "disabled" : "",
      );
      window.Dialog = class {
        constructor(config) {
          this.config = config;
        }
        render() {
          window.dialog = this.config;
          return this;
        }
      };
      window.openedJournal = null;
      const ns = "pneuma-crewtools",
        updates = [];
      const make = (raw, list) => {
        const d = {
          id: raw._id,
          name: raw.name,
          raw: structuredClone(raw),
          pages: [],
          items: [],
          results: [],
          toObject() {
            return {
              ...structuredClone(this.raw),
              ...(raw.pages
                ? { pages: this.pages.map((p) => p.toObject()) }
                : {}),
            };
          },
          async update(change, options) {
            updates.push({ id: this.id, change, options });
            for (const [key, value] of Object.entries(change)) {
              const keys = key.split(".");
              let t = this.raw;
              for (const part of keys.slice(0, -1)) t = t[part] ??= {};
              const leaf = keys.at(-1);
              if (leaf.startsWith("-=")) delete t[leaf.slice(2)];
              else t[leaf] = structuredClone(value);
            }
          },
          async createEmbeddedDocuments(type, rows) {
            rows.forEach((r) =>
              make(r, type === "JournalEntryPage" ? this.pages : this.results),
            );
          },
          async deleteEmbeddedDocuments(type, ids) {
            this.pages = this.pages.filter((p) => !ids.includes(p.id));
          },
          sheet: {
            render(_force, options) {
              window.openedJournal = { id: raw._id, ...options };
            },
          },
        };
        (raw.pages ?? []).forEach((p) => make(p, d.pages));
        list.push(d);
        return d;
      };
      const gm = { id: "gm", name: "GM", active: true, isGM: true };
      globalThis.game = {
        user: gm,
        users: [gm],
        world: { id: "w1" },
        modules: new Map([[ns, { version: "0.6.1" }]]),
        actors: [],
        journal: [],
        folders: [],
        items: [],
        tables: [],
        settings: {
          settings: new Map(),
          registerMenu(_ns, _key, config) {
            globalThis.Manager = config.type;
          },
          get() {},
          async set() {},
          sheet: { render() {} },
        },
      };
      globalThis.ui = {
        notifications: {
          info() {},
          warn() {},
          error(message) {
            console.info("Expected UI notice: " + message);
          },
        },
      };
      globalThis.JournalEntry = {
        create: async (raw, options) => {
          if (!options.keepId || !options.keepEmbeddedIds || !options.noHook)
            throw Error("Missing native ID preservation options");
          return make(raw, game.journal);
        },
      };
      globalThis.RollTable = { create: async (raw) => make(raw, game.tables) };
      globalThis.Folder = { create: async (raw) => make(raw, game.folders) };
      const actor = make(
        {
          _id: "a1",
          name: "Solo",
          system: { money: 500 },
          flags: { [ns]: { marker: true }, other: { preserved: true } },
        },
        game.actors,
      );
      const journal = make(
        {
          _id: "j1",
          name: "Solo records",
          flags: { [ns]: { recordKind: "character", actorId: "a1" } },
          ownership: { gm: 3, deletedUser: 2, default: 0 },
          pages: [
            {
              _id: "p1",
              name: "Payout Receipts",
              type: "text",
              flags: {
                [ns]: {
                  recordKey: "acknowledgments",
                  data: [
                    {
                      id: "r1",
                      userId: "gm",
                      actorId: "a1",
                      acknowledgedAt: null,
                    },
                    {
                      id: "r2",
                      userId: "gm",
                      actorId: "a1",
                      acknowledgedAt: "2026-09-15",
                    },
                  ],
                },
              },
              text: { content: "<p>Saved receipt</p>" },
            },
          ],
        },
        game.journal,
      );
      const cache = {};
      class Form {
        static get defaultOptions() {
          return {};
        }
        activateListeners() {}
        render() {
          const root = document.getElementById(ns + "-cleanup");
          root.className = ns;
          root.innerHTML = Handlebars.compile(template)(this.getData());
          this.activateListeners({ 0: root });
          return this;
        }
      }
      const load = (name) => {
        if (cache[name]) return cache[name];
        if (name === "foundry-form") return { CrewToolsForm: Form };
        if (name === "constants") return { MODULE_ID: ns };
        if (name === "journal-format")
          return {
            recordEscape: (s) =>
              String(s).replace(
                /[<>&]/g,
                (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c],
              ),
            storedDetails: () => "",
          };
        if (name === "pharma-transfer")
          return {
            purgePharmaHistory() {
              throw Error("Unexpected pharma operation");
            },
          };
        if (name === "downtime-journal-view") return { activityHtml: () => "" };
        if (name === "payout-journal-view")
          return { recordSummary: (_key, data) => JSON.stringify(data) };
        if (["downtime", "headquarters", "rent-form"].includes(name))
          return { openDowntime() {}, openHeadquarters() {}, openRent() {} };
        const out = {};
        cache[name] = out;
        new Function("exports", "require", sources[name])(out, (key) =>
          load(key.slice(2)),
        );
        return out;
      };
      window.fixture = { journal, actor, updates };
      const service = load("module-data-service");
      const saved = service.captureBackup();
      if (!saved.entries.length || updates.length)
        throw Error("Export must read records without writes");
      load("cleanup-settings").registerCleanupSettings();
      globalThis.manager = new Manager();
      manager.render(true);
      return {
        exportReadOnly: true,
      };
    },
    { sources, template },
  );

  assert.match(await page.locator("h2").innerText(), /Data & Cleanup/);
  for (const id of [
    "group:JournalEntry",
    "JournalEntry.j1",
    "JournalEntry.j1.JournalEntryPage.p1",
  ])
    await page
      .locator('[data-cleanup-category="' + id + '"] > summary')
      .click();
  await page.locator('[data-open-journal][data-page="p1"]').click();
  assert.deepEqual(await page.evaluate(() => openedJournal), {
    id: "j1",
    pageId: "p1",
  });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("[data-export-all]").click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /crewtools-records/);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.equal(exported.format, "pneuma-crewtools-record-snapshot");
  assert.equal(
    exported.entries.find((e) => e.kind === "actor").data.system,
    undefined,
  );
  const exportEvent = page.waitForEvent("download");
  await page.locator('[data-export-row="j1:p1"]').click();
  const single = JSON.parse(
    fs.readFileSync(await (await exportEvent).path(), "utf8"),
  );
  assert.equal(single.pageId, "p1");
  assert.equal(single.record.flags["pneuma-crewtools"].data.length, 2);
  assert.equal(await page.evaluate(() => fixture.updates.length), 0);
  await page.locator("[data-reset-section] > summary").click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-reset-review]") &&
      !document.querySelector("[data-reset-review]").disabled,
  );
  assert.equal(await page.locator("[data-reset-kind] option").count(), 4);
  assert.equal(
    await page.locator('[data-reset-kind] option[value="receipts"]').count(),
    0,
  );
  await page.locator("[data-reset-actor]").selectOption("a1");
  assert.ok(await page.locator("[data-reset-section]").evaluate((e) => e.open));
  await page.locator("[data-reset-review]").click();
  assert.match(
    await page.evaluate(() => dialog.content),
    /Awarded resources remain unchanged/,
  );
  await page.evaluate(() => dialog.buttons.cancel.callback());
  await page.waitForFunction(
    () => !document.querySelector("[data-reset-review]").disabled,
  );
  assert.equal(await page.evaluate(() => fixture.updates.length), 0);
  await page.locator("[data-reset-review]").click();
  await page.evaluate(() => dialog.buttons.purge.callback());
  await page.waitForFunction(() => fixture.updates.length === 1);
  assert.equal(
    await page.evaluate(
      () => fixture.journal.pages[0].raw.flags["pneuma-crewtools"].data[0].id,
    ),
    "r2",
  );
  assert.equal(await page.evaluate(() => fixture.actor.raw.system.money), 500);
  assert.match(await page.locator(".cleanup-report").innerText(), /Completed:/);
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  await page.locator('[data-cleanup-category="group:User"] > summary').click();
  await page
    .locator('[data-cleanup-category="User.deletedUser"] > summary')
    .click();
  await page.locator('[data-clean-missing-user="deletedUser"]').click();
  assert.match(
    await page.evaluate(() => dialog.content),
    /1 obsolete permission entries/,
  );
  assert.match(
    await page.evaluate(() => dialog.content),
    /Character Records|Solo Records|Solo records/,
  );
  await page.evaluate(() => dialog.buttons.cancel.callback());
  await page.waitForFunction(() => !manager.busy);
  assert.equal(
    await page.evaluate(() => fixture.journal.raw.ownership.deletedUser),
    2,
  );
  await page.locator('[data-clean-missing-user="deletedUser"]').click();
  await page.evaluate(() => dialog.buttons.purge.callback());
  await page.waitForFunction(
    () => !("deletedUser" in fixture.journal.raw.ownership),
  );
  await page.waitForFunction(
    () => !document.querySelector('[data-cleanup-category="User.deletedUser"]'),
  );
  assert.deepEqual(await page.evaluate(() => fixture.journal.raw.ownership), {
    gm: 3,
    default: 0,
  });
  assert.equal(
    await page.evaluate(
      () => fixture.journal.pages[0].raw.flags["pneuma-crewtools"].data[0].id,
    ),
    "r2",
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false);
  if (process.env.CREWTOOLS_SCREENSHOT)
    await page.screenshot({
      path: process.env.CREWTOOLS_SCREENSHOT,
      fullPage: true,
    });
  console.log(
    JSON.stringify({
      ...result,
      selectionsKeepSectionsOpen: true,
      noHorizontalOverflow: true,
    }),
  );
} finally {
  await browser.close();
}
