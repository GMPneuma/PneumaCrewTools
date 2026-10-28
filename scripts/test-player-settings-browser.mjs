import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const { chromium } = await import(
  process.env.PNEUMA_PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({
      viewport: { width: 1100, height: 750 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(
    '<body style="background:#555"><div id="pneuma-crewtools-calendar"><span>Tuesday<br>February 6<br>2078</span></div></body>',
  );
  await page.addStyleTag({
    content: fs.readFileSync("src/styles/pneuma-crewtools.css", "utf8"),
  });
  await page.evaluate(() => {
    globalThis.exports = {};
    globalThis.$ = (root) => ({ 0: root });
    globalThis.ContextMenu = class {
      constructor(element, selector, entries, options) {
        this.options = options;
        this.entries = entries;
        this.target = element[0].querySelector(selector);
        element[0].addEventListener(options.eventName, (event) => {
          if (
            !event.target.closest(selector) ||
            event.target.closest("#context-menu")
          )
            return;
          if (this.menu) {
            this.close();
            return;
          }
          void this.render($(this.target));
        });
      }
      async render() {
        this.options.onOpen(); // Native callback can precede insertion.
        await Promise.resolve();
        this.menu = document.createElement("nav");
        this.menu.id = "context-menu";
        for (const entry of this.entries) {
          const item = document.createElement("div");
          item.className = "context-item";
          item.textContent = entry.name;
          item.addEventListener("click", (event) => {
            event.stopPropagation();
            entry.callback();
            this.close();
          });
          this.menu.append(item);
        }
        this.target.style.position = "relative";
        this.target.append(this.menu);
      }
      async close() {
        this.menu?.remove();
        this.menu = null;
        this.options.onClose();
      }
    };
    globalThis.SettingsConfig = class {
      constructor(_obj, options) {
        this.options = options;
      }
      render() {
        globalThis.opened = this.options;
      }
    };
    globalThis.game = {
      modules: new Map([
        [
          "pneuma-combattools",
          {
            id: "pneuma-combattools",
            title: "Pneuma's Combat Tools",
            active: true,
          },
        ],
        [
          "pneuma-crewtools",
          {
            id: "pneuma-crewtools",
            title: "Pneuma's Crew Tools",
            active: true,
          },
        ],
      ]),
      settings: {
        settings: new Map([
          [
            "pneuma-combattools.hud",
            { namespace: "pneuma-combattools", scope: "client", config: true },
          ],
        ]),
        menus: new Map(),
      },
    };
  });
  await page.addScriptTag({
    content: ts.transpileModule(
      fs.readFileSync("src/player-settings.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
  });
  await page.evaluate(() => {
    const root = document.getElementById("pneuma-crewtools-calendar");
    exports.addPlayerSettingsGear(root);
    exports.addPlayerSettingsGear(root);
  });
  assert.equal(
    await page
      .locator("#pneuma-crewtools-calendar .pneuma-player-settings-launcher")
      .count(),
    1,
  );
  const gear = page.getByRole("button", {
    name: "User Settings",
    exact: true,
  });
  const initialPosition = await gear.boundingBox();
  await page.evaluate(() => {
    const root = document.getElementById("pneuma-crewtools-calendar");
    root.classList.add("has-external-shortcuts");
    root.style.setProperty("--pneuma-shortcut-count", "1");
  });
  assert.equal((await gear.boundingBox()).x, initialPosition.x);
  assert.equal((await gear.boundingBox()).y, initialPosition.y);
  await gear.click();
  assert.equal((await gear.boundingBox()).x, initialPosition.x);
  assert.equal((await gear.boundingBox()).y, initialPosition.y);
  assert.equal(
    await page.locator(".pneuma-user-settings-heading").textContent(),
    "User Settings",
  );
  assert.equal(
    await page
      .locator("body > #context-menu.pneuma-user-settings-popup")
      .count(),
    1,
  );
  const surface = await page.locator("#context-menu").evaluate((el) => ({
    z: getComputedStyle(el).zIndex,
    bg: getComputedStyle(el).backgroundColor,
  }));
  assert.equal(surface.z, "2147483647");
  assert.equal(surface.bg, "rgba(12, 14, 18, 0.78)");
  assert.equal(
    await page
      .locator("#context-menu .context-item")
      .filter({ hasText: "Crew Tools" })
      .getAttribute("aria-disabled"),
    "true",
  );
  await page
    .locator("#context-menu .context-item")
    .filter({ hasText: "Combat Tools" })
    .click();
  const style = await gear.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    border: getComputedStyle(el).borderTopWidth,
  }));
  assert.equal(style.background, "rgba(0, 0, 0, 0)");
  assert.equal(style.border, "0px");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.className = "pneuma-player-settings";
    fixture.innerHTML =
      '<nav class="tabs">Sidebar</nav><div class="sidebar">Sidebar</div><div class="categories">Settings</div>';
    document.body.append(fixture);
  });
  assert.equal(
    await page.locator(".pneuma-player-settings nav.tabs").isVisible(),
    false,
  );
  assert.equal(
    await page.locator(".pneuma-player-settings .sidebar").isVisible(),
    false,
  );
  assert.equal(
    await page.locator(".pneuma-player-settings .categories").isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(() => opened.id),
    "pneuma-player-settings-pneuma-combattools",
  );
  await gear.click();
  await gear.press("Escape");
  assert.equal(await gear.getAttribute("aria-expanded"), "false");
  assert.deepEqual(errors, []);
  console.log("Crew mini-HUD User Settings browser checks passed.");
} finally {
  await browser.close();
}
