import fs from "node:fs";
import assert from "node:assert/strict";
import ts from "typescript";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const source = ts.transpileModule(fs.readFileSync("src/calendar.ts", "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const mapPage = await browser.newPage();
  await mapPage.setContent(
    '<div id="pneuma-crewtools-calendar"></div><div id="controls" style="width:82px"></div><nav id="navigation"><a id="nav-toggle">Toggle</a><ol id="scene-list"><li class="scene active"><a class="scene-name">Scene</a></li><li class="scene view"><a class="scene-name">Second</a></li></ol></nav>',
  );
  await mapPage.addStyleTag({ path: "dist/styles/pneuma-crewtools.css" });
  const crewSource = ts.transpileModule(
    fs.readFileSync("src/crew-hud.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await mapPage.evaluate((source) => {
    const api = {};
    const deps = {
      "./shortcut-display": {
        showHudShortcuts: () => true,
        registerShortcutDisplay() {},
      },
      "./ui-refresh": { coalesceRefresh: (fn) => fn },
      "./player-settings": { addPlayerSettingsGear() {} },
      "./rent": { rentNeedsAttention: () => false },
      "./payout-inbox": { waitingPayoutCount: () => 0 },
    };
    new Function("exports", "require", "game", "ui", "Hooks", source)(
      api,
      (name) => deps[name] ?? {},
      {
        user: {},
        settings: {
          register(_module, key, config) {
            this[key] = config.default;
            window.setMapSetting = (key, value) => {
              this[key] = value;
              api.refreshCrewHud();
            };
          },
          get(_module, key) {
            return this[key];
          },
        },
      },
      {
        navigation: {
          expand() {
            document.querySelector("#scene-list").hidden = false;
          },
        },
      },
      { on() {} },
    );
    document.querySelector("#scene-list").hidden = true;
    api.registerCrewHud();
    api.readyCrewHud();
  }, crewSource);
  const maps = mapPage.getByRole("button", { name: "Scene navigation" });
  const nav = mapPage.locator("#navigation");
  assert.equal(await nav.isVisible(), false);
  const hub = await mapPage.locator('[data-hud-action="hub"]').boundingBox();
  const map = await maps.boundingBox();
  assert.ok(map.y >= hub.y + hub.height && map.x === hub.x);
  const iconColors = await mapPage.evaluate(() => {
    const crew = document.querySelector('[data-hud-action="hub"]');
    const map = document.querySelector('[data-hud-action="maps"] i');
    return [false, true, false].map((attention) => {
      crew.classList.toggle("has-attention", attention);
      return [getComputedStyle(crew.querySelector("i")).color, getComputedStyle(map).color];
    });
  });
  for (const [crew, map] of iconColors) assert.equal(map, crew);
  assert.notEqual(iconColors[0][0], iconColors[1][0]);
  await maps.click();
  assert.ok(await mapPage.locator("#scene-list").isVisible());
  assert.equal(await mapPage.locator("#nav-toggle").isVisible(), false);
  const hud = await mapPage.locator("#pneuma-crewtools-calendar").boundingBox();
  assert.equal((await nav.boundingBox()).y, hud.y + hud.height + 4);
  const controls = await mapPage.locator("#controls").boundingBox();
  assert.equal((await nav.boundingBox()).x, controls.x + controls.width + 8);
  await mapPage.evaluate(() =>
    window.setMapSetting("mapListLayout", "vertical"),
  );
  const scenes = mapPage.locator(".scene");
  const colors = await scenes.locator(".scene-name").evaluateAll(names => names.map(name => getComputedStyle(name).color));
  assert.equal(colors[0], "rgb(255, 195, 106)");
  assert.notEqual(colors[1], colors[0]);
  assert.ok(
    (await scenes.nth(1).boundingBox()).y >
      (await scenes.first().boundingBox()).y,
  );
  await maps.press("Escape");
  assert.equal(await nav.isVisible(), false);
  await mapPage.evaluate(() => document.addEventListener("pneumaCrewMapOpened", () => window.mapOpened = true, { once: true }));
  await maps.click();
  assert.ok(await mapPage.evaluate(() => window.mapOpened));
  await mapPage.evaluate(() => document.dispatchEvent(new Event("pneumaCrewBiomonitorOpened")));
  assert.equal(await nav.isVisible(), false);
  await mapPage.evaluate(() =>
    window.setMapSetting("replaceMapControl", false),
  );
  assert.equal(await maps.count(), 0);
  assert.ok(await mapPage.locator("#nav-toggle").isVisible());
  assert.equal((await nav.boundingBox()).x, hud.x + hud.width + 8);
  await mapPage
    .locator("#pneuma-crewtools-calendar")
    .evaluate((el) => el.remove());
  assert.ok(await mapPage.locator("#nav-toggle").isVisible());
  await mapPage.close();
  for (const initiallyHidden of [false, true]) {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="ui-top"><a id="logo" data-original="yes">Foundry</a><span id="native-neighbor">Native controls</span></div>',
    );
    const result = await page.evaluate(
      ({ source, initiallyHidden }) => {
        let hidden = initiallyHidden,
          setting,
          clicks = 0,
          refreshes = 0;
        const original = document.getElementById("logo");
        original.addEventListener("click", () => clicks++);
        const hooks = {};
        const game = {
          time: { worldTime: 0 },
          settings: {
            get: () => hidden,
            register: (ns, key, value) => (setting = value),
          },
        };
        const deps = {
          "./hud-shortcuts": { refreshHudShortcuts() {} },
          "./constants": { MODULE_ID: "pneuma-crewtools" },
          "./action-coordinator": { isPrimaryGM: () => false },
          "./foundry-form": { CrewToolsForm: class {} },
          "./calendar-date": {
            shimDate: () => "2045-01-01",
            parseDate: (v) => new Date(v + "T00:00:00Z"),
          },
        };
        const exports = {};
        new Function("exports", "require", "game", "Hooks", source)(
          exports,
          (p) => deps[p],
          game,
          { on: (key, fn) => (hooks[key] = fn) },
        );
        exports.registerCampaignCalendar(() => refreshes++);
        exports.readyCampaignCalendar();
        if (
          !!document.getElementById("pneuma-crewtools-calendar") ===
          initiallyHidden
        )
          throw Error("Wrong initial visibility");
        for (let i = 0; i < 3; i++) {
          hidden = true;
          setting.onChange();
          hooks.updateWorldTime();
          if (
            document.getElementById("pneuma-crewtools-calendar") ||
            document.getElementById("logo") !== original
          )
            throw Error("Native logo not restored");
          original.click();
          if (original.nextElementSibling.id !== "native-neighbor")
            throw Error("Native placement changed");
          hidden = false;
          setting.onChange();
          if (
            document.querySelectorAll("#pneuma-crewtools-calendar").length !==
              1 ||
            document.getElementById("logo")
          )
            throw Error("HUD not restored cleanly");
        }
        return {
          scope: setting.scope,
          defaultValue: setting.default,
          clicks,
          refreshes,
        };
      },
      { source, initiallyHidden },
    );
    assert.deepEqual(result, {
      scope: "client",
      defaultValue: false,
      clicks: 3,
      refreshes: 6,
    });
    await page.close();
  }
  console.log(
    "HUD visibility: client setting, initial hidden state, repeated toggles, original logo identity/handlers/position and hidden clock refreshes pass.",
  );
} finally {
  await browser.close();
}
