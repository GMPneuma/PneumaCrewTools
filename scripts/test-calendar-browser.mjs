// Real DOM integration with mocked Foundry services. Requires Playwright and Edge.
import { createRequire } from "node:module";
import fs from "node:fs";
import ts from "typescript";
const { chromium } = createRequire(import.meta.url)("playwright");
const sources = Object.fromEntries(
  [
    "action-coordinator",
    "ui-refresh",
    "foundry-form",
    "date-format",
    "calendar-date",
    "calendar",
    "ui-appearance",
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
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await page.evaluate((sources) => {
    window.assert = (value, message) => {
      if (!value) throw Error(message);
    };
    window.rejects = async (fn, message) => {
      let failed = false;
      try {
        await fn();
      } catch {
        failed = true;
      }
      assert(failed, message);
    };
    window.install = async () => {
      hooks.clear();
      const modules = { "./constants": { MODULE_ID: "pneuma-crewtools" } };
      for (const [name, source] of Object.entries(sources)) {
        const exports = {};
        new Function("exports", "require", source)(
          exports,
          (dependency) => modules[dependency],
        );
        modules[`./${name}`] = exports;
      }
      window.api = modules["./calendar"];
      window.appearance = modules["./ui-appearance"];
      window.crewRefresh = modules["./ui-refresh"];
      api.registerCampaignCalendar();
      await api.readyCampaignCalendar();
    };
    window.nativeClock = () => {
      const epoch = Date.UTC(2000, 0, 1) / 1000;
      game.time.calendar = {
        years: { yearZero: 2000 },
        timeToComponents(time) {
          const d = new Date((time + epoch) * 1000);
          return {
            year: d.getUTCFullYear() - 2000,
            month: d.getUTCMonth(),
            dayOfMonth: d.getUTCDate() - 1,
          };
        },
        componentsToTime({ year, day }) {
          return Date.UTC(year + 2000, 0, day + 1) / 1000 - epoch;
        },
      };
      game.time.set = async (value) => {
        calls.set++;
        return game.time.advance(value - game.time.worldTime);
      };
    };
    window.reset = async (options = {}) => {
      document.body.replaceChildren();
      const sidebar = document.createElement("aside");
      sidebar.id = "ui-left";
      sidebar.style.cssText =
        "position:absolute;left:10px;top:10px;width:180px;display:flex;flex-direction:column";
      sidebar.innerHTML =
        '<img id="logo" alt="Foundry"><div id="controls">Scene controls</div>';
      document.body.append(sidebar);
      window.hooks = new Map();
      window.fail = {};
      window.messages = [];
      window.calls = { advance: 0, set: 0, journal: 0 };
      window.Hooks = {
        on: (event, fn) => hooks.set(event, [...(hooks.get(event) ?? []), fn]),
      };
      window.fire = (event, ...args) => {
        for (const fn of hooks.get(event) ?? []) fn(...args);
      };
      window.ui = {
        notifications: Object.fromEntries(
          ["error", "warn", "info"].map((key) => [
            key,
            (text) => messages.push({ key, text }),
          ]),
        ),
      };
      window.FormApplication = class {
        static get defaultOptions() {
          return {};
        }
        render() {
          this.getData();
          return this;
        }
        activateListeners() {}
      };
      const gm = { id: "a", name: "GM", active: true, isGM: true };
      window.game = {
        user: gm,
        users: [gm, { id: "b", name: "Player", active: true, isGM: false }],
        get journal() {
          throw Error("Unexpected Journal access");
        },
        settings: {
          register(_namespace, key) {
            if (["useSimpleCalendar", "hideCrewHud"].includes(key)) return;
            throw Error("Calendar must not register data settings");
          },
          registerMenu() {},
          get(_namespace, key) {
            if (["useSimpleCalendar", "hideCrewHud"].includes(key))
              return false;
            throw Error("Calendar must not read data settings");
          },
          set() {
            throw Error("Calendar must not write data settings");
          },
        },
        time: {
          worldTime: options.time ?? 0,
          async advance(delta) {
            if (fail.clock) throw Error("clock failure");
            calls.advance++;
            game.time.worldTime += delta;
            fire(
              "updateWorldTime",
              game.time.worldTime,
              delta,
              {},
              game.user.id,
            );
            return game.time.worldTime;
          },
        },
      };
      window.JournalEntry = {
        create() {
          calls.journal++;
          throw Error("Calendar must not create Journals");
        },
      };
      if (options.native) nativeClock();
      await install();
    };
  }, sources);
  const check = async (name, test) => {
    await page.evaluate(test);
    console.log(`PASS ${name}`);
  };
  await check("world clock is authoritative; no Journal needed", async () => {
    await reset();
    assert(
      api.getCampaignDate() === "1970-01-01" && calls.advance === 0,
      "display existing clock without changing it",
    );
    await api.setCampaignDate("2048-02-28");
    await game.time.advance(43200);
    const before = game.time.worldTime;
    await Promise.all([api.advanceCampaignDays(1), api.advanceCampaignDays(1)]);
    assert(
      api.getCampaignDate() === "2048-03-01" &&
        game.time.worldTime === before + 172800,
      "leap days and queued whole-day advances",
    );
    await install();
    assert(
      api.getCampaignDate() === "2048-03-01" && calls.journal === 0,
      "reload without accessing Journals",
    );
    await game.time.advance(86400);
    assert(
      document
        .getElementById("pneuma-crewtools-calendar")
        .querySelector(".pneuma-calendar-date")
        .getAttribute("aria-label")
        .includes("Mar 2, 2048"),
      "external clock changes update display",
    );
    assert(!hooks.has("updateJournalEntryPage"), "no Journal hooks");
  });
  await check("player permissions and failed clock writes", async () => {
    const before = game.time.worldTime;
    game.user = game.users[1];
    fire("updateUser");
    assert(
      document.querySelectorAll("#pneuma-crewtools-calendar button").length ===
        0,
      "read-only player display",
    );
    await rejects(() => api.setCampaignDate("2077-01-01"), "player set denied");
    await rejects(() => api.advanceCampaignDays(1), "player advance denied");
    game.user = game.users[0];
    fail.clock = true;
    await rejects(
      () => api.setCampaignDate("2077-01-01"),
      "clock failure surfaced",
    );
    assert(game.time.worldTime === before, "failed write doesn't change time");
    fail.clock = false;
  });
  await check("native calendar reads and writes Foundry time", async () => {
    await reset({ native: true });
    assert(
      api.getCampaignDate() === "2000-01-01" && calls.advance === 0,
      "native initial clock unchanged",
    );
    await api.setCampaignDate("2077-01-01");
    assert(
      api.getCampaignDate() === "2077-01-01" && calls.set === 1,
      "native set date",
    );
    await api.advanceCampaignDays(1);
    assert(api.getCampaignDate() === "2077-01-02", "native advance");
  });
  await check("date form retains controls; display is passive", async () => {
    await reset();
    const form = new api.CampaignCalendarForm();
    await form._updateObject(new Event("submit"), {
      year: "2077",
      month: "12",
      day: "31",
    });
    assert(api.getCampaignDate() === "2077-12-31", "forward era change");
    await form._updateObject(new Event("submit"), {
      year: "2045",
      month: "1",
      day: "1",
    });
    assert(api.getCampaignDate() === "2045-01-01", "backward era change");
    const before = game.time.worldTime;
    await form._updateObject(new Event("submit"), {
      year: "2045",
      month: "2",
      day: "30",
    });
    assert(game.time.worldTime === before, "invalid date rejected");
    await api.setCampaignDate("2078-01-01");
    const badge = document.getElementById("pneuma-crewtools-calendar");
    assert(
      badge.querySelector(".pneuma-calendar-month-day").textContent ===
        "Jan 1" &&
        badge.querySelector(".pneuma-calendar-year").textContent === "2078",
      "two-line date format",
    );
    assert(
      !document.getElementById("logo") && badge.parentElement.id === "ui-left",
      "clock replaces logo in its own slot",
    );
    assert(
      badge.querySelectorAll("button, a, [tabindex]").length === 0,
      "no interactive elements for GM",
    );
    const unchanged = game.time.worldTime;
    badge.click();
    assert(game.time.worldTime === unchanged, "click does not change date");
  });
  await page.addStyleTag({
    content: fs.readFileSync(
      new URL("../src/styles/pneuma-crewtools.css", import.meta.url),
      "utf8",
    ),
  });
  await page.evaluate(() => {
    assert(
      getComputedStyle(document.getElementById("pneuma-crewtools-calendar"))
        .pointerEvents === "none",
      "badge ignores pointer input",
    );
  });
  await page.evaluate(() => {
    const badge = document
      .getElementById("pneuma-crewtools-calendar")
      .getBoundingClientRect();
    const controls = document
      .getElementById("controls")
      .getBoundingClientRect();
    assert(
      badge.x === 0 &&
        badge.y === 0 &&
        badge.width === 138 &&
        badge.height === 70 &&
        controls.top === badge.bottom + 10,
      "clock docks at 138 by 70px with a 10px gap above controls",
    );
  });
  await page.evaluate(() => {
    const configs = new Map();
    const values = new Map();
    game.settings = {
      register(namespace, key, config) {
        configs.set(key, config);
        values.set(key, config.default);
      },
      get(namespace, key) {
        return values.get(key);
      },
      async set(namespace, key, value) {
        values.set(key, value);
        configs.get(key).onChange(value);
      },
    };
    appearance.registerUiAppearance();
    appearance.applyUiAppearance();
    const badge = document.getElementById("pneuma-crewtools-calendar");
    assert(
      getComputedStyle(badge, "::before").content === "none",
      "no CITY DATE label",
    );
    assert(
      configs.get("calendarFontColor").scope === "client",
      "color is a client preference",
    );
    assert(
      getComputedStyle(badge).color === "rgb(127, 255, 234)",
      "default aqua color",
    );
    const form = document.createElement("form");
    form.innerHTML =
      '<input name="pneuma-crewtools.calendarFontColor" value="#7fffea">';
    fire("renderSettingsConfig", {}, { 0: form });
    const picker = form.querySelector("input");
    assert(picker.type === "color", "settings use native color picker");
    picker.value = "#ff8844";
    game.settings.set(
      "pneuma-crewtools",
      "calendarFontColor",
      new FormData(form).get(picker.name),
    );
    assert(
      getComputedStyle(badge).color === "rgb(255, 136, 68)",
      "saved color updates without reload",
    );
    game.settings.set("pneuma-crewtools", "calendarFontColor", "invalid");
    assert(
      getComputedStyle(badge).color === "rgb(127, 255, 234)",
      "invalid stored color falls back to aqua",
    );
  });
  console.log(
    "PASS appearance picker, live updates, defaults, and removed label",
  );

  const hudSource = ts.transpileModule(
    fs.readFileSync(new URL("../src/crew-hud.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await page.evaluate((source) => {
    game.actors = ["a", "b"].map((id) => ({
      id,
      type: "character",
      testUserPermission: (user) => id === user.id,
    }));
    window.hudData = {
      payouts: 1,
      days: { a: 0, b: 3 },
      broken: false,
      hubOpened: 0,
      downtimeOpened: 0,
      balanceReads: 0,
    };
    const dependencies = {
      "./shortcut-display": {
        registerShortcutDisplay() {},
        showHudShortcuts: () => true,
      },
      "./window-controls": { openGMDashboard: () => hudData.hubOpened++ },
      "./constants": { MODULE_ID: "pneuma-crewtools" },
      "./ui-refresh": window.crewRefresh,
      "./rent": { rentNeedsAttention: () => false },
      "./actor-policy": { isActorExcluded: () => false },
      "./payout-inbox": {
        waitingPayoutCount: () => hudData.payouts,
        openPlayerHub: () => hudData.hubOpened++,
      },
      "./downtime-store": {
        getIndex: () => {
          hudData.balanceReads++;
          if (hudData.broken) throw Error("Invalid ledger");
          return { accounts: [{ actorId: "a" }, { actorId: "b" }] };
        },
      },
      "./downtime": { openDowntime: () => hudData.downtimeOpened++ },
      "./downtime-records": {
        storedDowntimeBalance: (id) => hudData.days[id] ?? 0,
      },
    };
    const exports = {};
    new Function("exports", "require", source)(
      exports,
      (id) => dependencies[id],
    );
    exports.registerCrewHud();
    exports.readyCrewHud();
    window.hud = exports;
  }, hudSource);
  await check("HUD refreshes only for Crew Tools Journal changes", async () => {
    const before = hudData.balanceReads;
    for (const changes of [
      { "system.derivedStats.hp.value": 20 },
      { "system.wealth.value": 500 },
      { ownership: { b: 3 } },
      { type: "container" },
    ])
      fire("updateActor", game.actors[0], changes);
    for (const event of [
      "updateSetting",
      "updateUser",
      "deleteActor",
      "userConnected",
    ])
      fire(event, {});
    const ordinary = { getFlag: () => undefined };
    const journalEvents = [
      "createJournalEntry",
      "updateJournalEntry",
      "deleteJournalEntry",
    ];
    const pageEvents = [
      "createJournalEntryPage",
      "updateJournalEntryPage",
      "deleteJournalEntryPage",
    ];
    for (const event of [...journalEvents, ...pageEvents])
      fire(event, ordinary);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(
      hudData.balanceReads === before,
      "unrelated changes cause no HUD balance reads",
    );
    for (const event of [...journalEvents, ...pageEvents]) {
      const count = hudData.balanceReads;
      const marker = journalEvents.includes(event) ? "recordKind" : "kind";
      fire(event, {
        getFlag: (ns, key) =>
          ns === "pneuma-crewtools" && key === marker ? "character" : undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert(
        hudData.balanceReads === count + 1,
        "module Journal event refreshes status",
      );
    }
  });
  await check(
    "HUD live status, ownership, unavailable state, and stable focus",
    async () => {
      const root = document.getElementById("pneuma-crewtools-calendar");
      const row = root.querySelector(".pneuma-crew-hud");
      const hub = row.querySelector('[data-hud-action="hub"]');

      assert(
        row.children.length === 1 &&
          row.querySelectorAll("button").length === 1,
        "one large hub button",
      );
      assert(hub.classList.contains("has-attention"), "waiting indicators");
      assert(hub.title.includes("3 unspent crew"), "GM crew total");
      hub.focus();
      const time = game.time.worldTime;
      fire("updateWorldTime");
      assert(
        document.activeElement === hub &&
          root.firstElementChild.className === "pneuma-calendar-date",
        "clock update preserves focus and date placement",
      );
      hub.click();
      assert(
        hudData.hubOpened === 1 && game.time.worldTime === time,
        "correct shortcuts without clock changes",
      );
      hudData.payouts = 0;
      hudData.days.b = 0;
      fire("updateUser");
      fire("updateJournalEntryPage", {
        getFlag: (_ns, key) => (key === "kind" ? "actorLedger" : undefined),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert(
        !hub.classList.contains("has-attention"),
        "indicators clear after acknowledgment and spending",
      );
      game.user = game.users[1];
      hudData.days.a = 9;
      fire("updateJournalEntryPage", {
        getFlag: (_ns, key) => (key === "kind" ? "actorLedger" : undefined),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert(
        hub.title.includes("0 unspent downtime"),
        "player does not see another account's balance",
      );
      hudData.broken = true;
      fire("updateJournalEntryPage", {
        getFlag: (_ns, key) => (key === "kind" ? "actorLedger" : undefined),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert(
        hub.title.includes("unavailable") &&
          !hub.classList.contains("has-attention"),
        "bad ledger is not shown as zero",
      );
      hudData.broken = false;
      hudData.payouts = 1;
      hudData.days.b = 3;
      fire("updateJournalEntryPage", {
        getFlag: (_ns, key) => (key === "kind" ? "actorLedger" : undefined),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dayLine = root
        .querySelector(".pneuma-calendar-month-day")
        .getBoundingClientRect();
      const yearLine = root
        .querySelector(".pneuma-calendar-year")
        .getBoundingClientRect();
      const icon = hub.getBoundingClientRect();
      assert(
        yearLine.top >= dayLine.bottom &&
          icon.left >= dayLine.right &&
          icon.height >= 38,
        "date stacked on left and large hub on right",
      );
      const rect = root.getBoundingClientRect();
      const controls = document
        .getElementById("controls")
        .getBoundingClientRect();
      assert(
        rect.width === 138 &&
          rect.height === 70 &&
          rect.x === 0 &&
          rect.y === 0 &&
          controls.top === rect.bottom + 10,
        "compact dock and spacing",
      );
      assert(
        getComputedStyle(hub).pointerEvents === "auto",
        "buttons accept mouse input",
      );
      assert(
        getComputedStyle(hub).color === "rgb(255, 195, 106)",
        "amber attention color",
      );
    },
  );
  await page.locator('[data-hud-action="hub"]').click();
  await page.evaluate(() => {
    assert(
      hudData.hubOpened === 2,
      "real pointer clicks reach buttons through passive frame",
    );
  });
  console.log("PASS HUD pointer interaction");

  if (process.env.CALENDAR_SCREENSHOT)
    await page
      .locator("#pneuma-crewtools-calendar")
      .screenshot({ path: process.env.CALENDAR_SCREENSHOT });
  console.log(
    "Calendar browser integration checks passed (mock Foundry services, real DOM).",
  );
} finally {
  await browser.close();
}
