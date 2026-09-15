import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url),
  { chromium } = require("playwright");
const code = Object.fromEntries(
  ["netrunner-system", "netrunner-panel"].map((n) => [
    n,
    ts.transpileModule(fs.readFileSync("src/" + n + ".ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ]),
);
const hub = fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  downtime = fs.readFileSync("static/templates/downtime.hbs", "utf8");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1000 },
  });
  await page.setContent(
    '<main class="pneuma-crewtools" style="width:680px;margin:20px auto"><div id="hub"></div><div id="downtime"></div></main>',
  );
  await page.addScriptTag({
    path: require.resolve("handlebars/dist/handlebars.js"),
  });
  await page.addStyleTag({
    content:
      fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8") +
      "\nbody{font:14px Arial;background:#eee}button,select{font:inherit}button{padding:5px}",
  });
  await page.evaluate(
    ({ code, hub, downtime }) => {
      window.calls = [];
      const actor = {
        id: "a",
        testUserPermission: () => true,
        items: [
          { type: "role", name: "Netrunner", system: { rank: 4 } },
          ...[0, 1, 2, 3, 4].map((i) => ({
            id: "d" + i,
            type: "cyberdeck",
            name: "Cyberdeck " + (i + 1),
            system: { equipped: ["owned", "carried", "equipped"][i % 3] },
            sheet: {
              render: () => calls.push(["open", i]),
              _manageInstalledItems: async (type) => calls.push([type, i]),
            },
          })),
        ],
        sheet: {
          _cycleEquipState: (event) =>
            calls.push([
              "equip",
              event.currentTarget.dataset.itemId,
              event.currentTarget.dataset.itemProp,
            ]),
        },
      };
      const game = {
        actors: { get: () => actor },
        user: { isGM: false },
        i18n: { localize: (key) => key.split(".").pop() },
      };
      const cache = {},
        load = (n) =>
          cache[n] ??
          (cache[n] = (() => {
            const exports = {};
            new Function("exports", "require", "game", "ui", code[n])(
              exports,
              (p) => load(p.slice(2)),
              game,
              {
                notifications: {
                  error: (message) => {
                    throw Error(message);
                  },
                },
              },
            );
            return exports;
          })());
      const panel = load("netrunner-panel");
      document.querySelector("#hub").innerHTML = Handlebars.compile(hub)({
        netrunner: panel.netrunnerPanel(actor),
      });
      panel.bindNetrunner(document.querySelector("#hub"), "a");
      window.renderDowntime = (enabled) => {
        document.querySelector("#downtime").innerHTML = Handlebars.compile(
          downtime,
        )({
          actorId: "a",
          hasAccount: true,
          ready: true,
          hasActor: true,
          hasRoleAreas: true,
          hasCharacter: true,
          netrunnerVisible: true,
          netrunnerSlots: [
            {
              slot: 0,
              number: 1,
              enabled,
              canCraft: true,
              requiredWorkshop: "Server Room II and Electronics/Security Tech",
            },
          ],
        });
        document.querySelectorAll("details").forEach((d) => (d.open = true));
      };
      renderDowntime(false);
    },
    { code, hub, downtime },
  );
  assert.equal(await page.locator('[data-deck-action="open"]').count(), 5);
  for (const action of ["open", "equip", "programs", "upgrades"])
    await page
      .locator('[data-deck-action="' + action + '"]')
      .first()
      .click();
  assert.deepEqual(await page.evaluate(() => calls), [
    ["open", 0],
    ["equip", "d0", "system.equipped"],
    ["program", 0],
    ["itemUpgrade", 0],
  ]);
  assert.equal(
    await page
      .locator('[data-downtime-section="netrunner"] [data-tech-drop]')
      .count(),
    0,
  );
  await page.evaluate(() => renderDowntime(true));
  assert.equal(
    await page
      .locator('[data-downtime-section="netrunner"] [data-tech-slot]')
      .count(),
    1,
  );
  assert.equal(
    await page.locator('[data-downtime-section="netrunner"] option').count(),
    4,
  );
  assert.equal(
    await page
      .locator('[data-downtime-section="netrunner"] [data-tech-drop]')
      .count(),
    1,
  );
  const tiles = await page
    .locator(".netrunner-deck")
    .evaluateAll((els) =>
      els.map((el) => ({ x: el.offsetLeft, y: el.offsetTop })),
    );
  assert.equal(tiles[0].y, tiles[2].y);
  assert(tiles[0].x < tiles[1].x && tiles[1].x < tiles[2].x);
  assert(tiles[3].y > tiles[0].y);
  assert.equal(tiles[3].x, tiles[0].x);
  assert.equal(await page.locator(".netrunner-deck-actions button").count(), 0);
  assert.equal(
    (await page.locator(".netrunner-deck-actions").first().innerText()).trim(),
    "",
  );
  await page.locator('[data-deck-action="programs"]').first().focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => calls.at(-1)), ["program", 0]);
  const layout = await page
    .locator(".netrunner-deck")
    .first()
    .evaluate((el) => {
      const name = el
          .querySelector(".netrunner-deck-name")
          .getBoundingClientRect(),
        actions = el
          .querySelector(".netrunner-deck-actions")
          .getBoundingClientRect();
      return {
        beneath: actions.top >= name.bottom,
        overflow: el.scrollWidth > el.clientWidth,
      };
    });
  assert.equal(layout.beneath, true);
  assert.equal(layout.overflow, false);
  await page.screenshot({
    path: process.env.TEMP + "/crewtools-netrunner-preview.png",
    fullPage: true,
  });
  console.log(
    "Netrunner browser checks passed: native action delegation, five decks wrapping three across, icon-only controls beneath names, facility gate, one slot and four actions.",
  );
} finally {
  await browser.close();
}
