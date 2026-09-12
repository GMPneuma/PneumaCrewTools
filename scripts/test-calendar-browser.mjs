// Real DOM integration with mocked Foundry services. Requires Playwright and Edge.
import { createRequire } from "node:module";
import fs from "node:fs";
import ts from "typescript";
const { chromium } = createRequire(import.meta.url)("playwright");
const sources = Object.fromEntries(
  ["calendar-date", "calendar"].map((name) => [
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
          register() {
            throw Error("Calendar must not register data settings");
          },
          registerMenu() {},
          get() {
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
        .textContent.includes("2048-03-02"),
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
  await check(
    "date form and toolbar retain forward/backward controls",
    async () => {
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
      document.querySelectorAll("#pneuma-crewtools-calendar button")[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(api.getCampaignDate() === "2045-01-02", "toolbar advance");
    },
  );
  console.log(
    "Calendar browser integration checks passed (mock Foundry services, real DOM).",
  );
} finally {
  await browser.close();
}
