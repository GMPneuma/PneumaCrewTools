import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sources = Object.fromEntries(
  [
    "module-data-model",
    "module-data-service",
    "payout-data-manager",
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
  new URL("../static/templates/payout-data-manager.hbs", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1050, height: 920 },
  });
  await page.setContent(
    '<main id="pneuma-crewtools-data-manager" style="width:800px;margin:20px auto"></main>',
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
              t[keys.at(-1)] = structuredClone(value);
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
          sheet: { render() {} },
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
          ownership: { gm: 3 },
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
          const root = document.getElementById(ns + "-data-manager");
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
      const service = load("module-data-service");
      const saved = service.captureBackup();
      if (!saved.entries.length || updates.length)
        throw Error("Export must read records without writes");
      load("payout-data-manager").registerPayoutDataManager();
      globalThis.manager = new Manager();
      manager.render(true);
      return {
        exportReadOnly: true,
      };
    },
    { sources, template },
  );
  await page.locator('details[data-section="cleanup"] > summary').click();
  await page.locator('[name="cleanup"]').selectOption("receipts");
  assert(
    await page
      .locator('details[data-section="cleanup"]')
      .evaluate((e) => e.open),
  );
  assert.match(
    await page.locator('details[data-section="cleanup"]').innerText(),
    /1 records selected/,
  );
  await page.locator('details[data-section="exports"] > summary').click();
  assert.equal(
    await page
      .locator(
        'input[type="file"], [data-action="restore"], [data-action="pre-backup"]',
      )
      .count(),
    0,
  );
  const downloadEvent = page.waitForEvent("download");
  await page.locator('[data-action="backup"]').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /crewtools-backup/);
  const exportEvent = page.waitForEvent("download");
  await page.locator('[data-action="export"]').click();
  assert.match((await exportEvent).suggestedFilename(), /selected-records/);
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
