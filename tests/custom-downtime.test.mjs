import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
function fixture() {
  let sequence = 0,
    queue = Promise.resolve(),
    definitions = [],
    state = {
      version: 1,
      period: 1,
      accounts: [{ actorId: "a", name: "A", characterJournalId: "j" }],
      events: [
        {
          id: "award",
          actorId: "a",
          kind: "award",
          days: 12,
          period: 1,
          date: "2078-01-01",
          reason: "Award",
          payoutId: "p",
        },
      ],
      activities: [],
    };
  let draws = 0,
    rolls = 0,
    writes = 0,
    actorWrites = 0,
    failWrite = 0,
    failActor = false,
    reserved = 0;
  const game = {
    user: { id: "owner", isGM: true },
    tables: [],
    users: [{ id: "owner", name: "Owner", isGM: false }],
  };
  const actor = {
    id: "a",
    flags: {},
    system: {
      wealth: { value: 100, transactions: [] },
      derivedStats: {
        hp: { value: 20, max: 30 },
        humanity: { value: 30, max: 50 },
      },
      stats: { emp: { value: 3 } },
      reputation: { value: 2, transactions: [] },
    },
    getFlag: (ns, key) => actor.flags[ns]?.[key],
    async update(data) {
      if (failActor) throw Error("Actor failed");
      actorWrites++;
      for (const [key, value] of Object.entries(data)) {
        const parts = key.split(".");
        let target = actor;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
    },
  };
  const page = {
    async update(data) {
      if (++writes === failWrite) throw Error("Journal failed");
      if (data["flags.pneuma-crewtools.downtime"])
        state = structuredClone(data["flags.pneuma-crewtools.downtime"]);
    },
  };
  const enqueue = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  const stubs = {
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./action-coordinator": {
      queueAction: enqueue,
      withGMAction: (fn) =>
        enqueue(() => {
          if (!game.user.isGM) throw Error("GM only");
          return fn();
        }),
    },
    "./id": { createUniqueId: () => "id" + ++sequence },
    "./calendar": { getCampaignDate: () => "2078-01-01" },
    "./downtime-store": {
      getDowntime: () => structuredClone(state),
      ownedCharacter: (id) => {
        if (id !== "a" || (!game.user.isGM && game.user.id !== "owner"))
          throw Error("Owner only");
        return actor;
      },
      actorLedger: () => page,
      ledgerHtml: () => "Downtime",
    },
    "./downtime-records": { activityPage: () => page },
    "./medtech": { reservedMedicalDay: () => reserved },
    "./journal-records": {
      findRecordJournal: () => ({}),
      ensureRecordJournal: async () => ({}),
      readRecord: () => structuredClone(definitions),
      writeRecord: async (_j, _key, _name, data) => {
        definitions = structuredClone(data);
      },
    },
  };
  const cache = {};
  const load = (name) => {
    if (cache[name]) return cache[name];
    const out = (cache[name] = {});
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports: out,
        require: (key) => stubs[key] ?? load(key.slice(2)),
        structuredClone,
        game,
        console,
        document: {
          createElement: () => ({
            set innerHTML(value) {
              this.textContent = value.replace(/<[^>]*>/g, "");
            },
          }),
        },
        Roll: class {
          static validate(formula) {
            return formula === "1d6";
          }
          constructor(formula) {
            this.total = formula.startsWith("-") ? -5 : 6;
          }
          async evaluate(options = {}) {
            if (options.minimize) {
              this.total = 1;
              return this;
            }
            if (options.maximize) {
              this.total = 6;
              return this;
            }
            rolls++;
            return this;
          }
        },
      },
    );
    return out;
  };
  const api = load("custom-downtime"),
    model = load("custom-downtime-model");
  return {
    view: load("custom-result-view"),
    api,
    model,
    game,
    actor,
    page,
    state: () => structuredClone(state),
    counts: () => ({ draws, rolls, writes, actorWrites }),
    reserve: (days) => (reserved = days),
    failAt: (n) => (failWrite = n),
    failActor: (value) => (failActor = value),
    table: (text, visible = true) => {
      game.tables = [
        {
          id: "t",
          formula: "1d6",
          results: [
            {
              id: "r",
              text,
              range: [1, 6],
              weight: 6,
              getFlag: () => undefined,
            },
          ],
          name: "Results",
          testUserPermission: () => visible,
          roll: async () => {
            draws++;
            return { roll: { total: 4 }, results: [{ id: "r", text }] };
          },
        },
      ];
    },
    definition: async (days = null, tableId = "") =>
      api.saveCustomActivities([{ id: "d", name: "Research", days, tableId }]),
    cycle: () => model.customCycles(state.events)[0]?.cycle,
  };
}
test("custom payout grammar accepts only supported trailing tags and dice", () => {
  const f = fixture();
  const parsed = f.model.parseCustomRewards(
    "Found work. [Money](+20) [Humanity](2d6) [Hitpoints](-2d5) [Reputation](-1)",
  );
  assert.equal(parsed.length, 4);
  assert.equal(
    f.model.parseCustomRewards("[Money](5) appears in the middle.").length,
    0,
  );
  for (const text of [
    "[Money](1d6)",
    "[Hitpoints](1d20)",
    "[Humanity](0d6)",
    "[Money](Infinity)",
    "[Money](1+2)",
    "[Reputation](2d6)",
  ])
    assert.equal(f.model.parseCustomRewards(text).length, 0);
});
test("one-day activities repeat; tracked activities snapshot settings and share the downtime balance", async () => {
  const f = fixture();
  await f.definition();
  f.game.user.isGM = false;
  await f.api.spendCustomActivity("a", "d", "", 1);
  await f.api.spendCustomActivity("a", "d", "", 1);
  assert.equal(f.model.customCycles(f.state().events).length, 2);
  f.game.user.isGM = true;
  await f.definition(3);
  await f.api.spendCustomActivity("a", "d", "", 1);
  const cycle = f.model.customCycles(f.state().events).at(-1).cycle;
  await f.definition(8);
  await f.api.spendCustomActivity("a", "d", cycle, 2);
  assert.equal(f.model.customCycles(f.state().events).at(-1).progress, 3);
  assert.equal(
    f
      .state()
      .events.filter((e) => e.kind === "spend")
      .reduce((s, e) => s + e.days, 0),
    5,
  );
  await assert.rejects(
    f.api.spendCustomActivity("a", "d", cycle, 1),
    /remaining/,
  );
});
test("invalid progress, reserved days, permissions and failed writes spend no downtime", async () => {
  const f = fixture();
  await f.definition(20);
  await assert.rejects(f.api.spendCustomActivity("a", "d", "", 0), /whole/);
  f.reserve(1);
  await assert.rejects(
    f.api.spendCustomActivity("a", "d", "", 12),
    /available/,
  );
  f.game.user = { id: "stranger", isGM: false };
  await assert.rejects(f.api.spendCustomActivity("a", "d", "", 1), /Owner/);
  await assert.rejects(f.definition(), /GM/);
  f.game.user.id = "owner";
  f.failAt(1);
  await assert.rejects(f.api.spendCustomActivity("a", "d", "", 1), /Journal/);
  assert.equal(f.state().events.length, 1);
});
test("table payout applies all four resources and retained result retries never pay twice", async () => {
  const f = fixture();
  f.table(
    "Success [Money](25) [Humanity](2d6) [Hitpoints](-1d5) [Reputation](-1)",
  );
  await f.definition(2, "t");
  f.game.user.isGM = false;
  await f.api.spendCustomActivity("a", "d", "", 1);
  await assert.rejects(f.api.rollCustomActivity("a", f.cycle()), /Complete/);
  await f.api.spendCustomActivity("a", "d", f.cycle(), 1);
  // Result save, resource preview save, then fail the final receipt after native update.
  f.failAt(f.counts().writes + 3);
  await assert.rejects(f.api.rollCustomActivity("a", f.cycle()), /Journal/);
  assert.equal(f.actor.system.wealth.value, 125);
  await f.api.rollCustomActivity("a", f.cycle());
  await f.api.rollCustomActivity("a", f.cycle());
  assert.equal(f.counts().draws, 1);
  assert.equal(f.counts().rolls, 2);
  assert.equal(f.counts().actorWrites, 1);
  assert.equal(f.actor.system.derivedStats.humanity.value, 36);
  assert.equal(f.actor.system.stats.emp.value, 3);
  assert.equal(f.actor.system.derivedStats.hp.value, 15);
  assert.equal(f.actor.system.reputation.value, 1);
  assert.match(f.api.customActivityView("a", 10).latestResult, /Success/);
});
test("actor failure and insufficient funds preserve rolled result for retry", async () => {
  const f = fixture();
  f.table("Cost [Money](-150)");
  await f.definition(null, "t");
  await f.api.spendCustomActivity("a", "d", "", 1);
  await assert.rejects(
    f.api.rollCustomActivity("a", f.cycle()),
    /Not enough money/,
  );
  f.actor.system.wealth.value = 200;
  f.failActor(true);
  await assert.rejects(
    f.api.rollCustomActivity("a", f.cycle()),
    /Actor failed/,
  );
  f.failActor(false);
  await f.api.rollCustomActivity("a", f.cycle());
  assert.equal(f.actor.system.wealth.value, 50);
  assert.equal(f.counts().draws, 1);
});
test("removed definitions leave active projects usable; missing or hidden tables do not consume completion", async () => {
  const f = fixture();
  f.table("Nothing happens");
  await f.definition(2, "t");
  await f.api.spendCustomActivity("a", "d", "", 1);
  await f.api.saveCustomActivities([]);
  assert.equal(f.api.customActivityView("a", 11).queue[0].name, "Research");
  await f.api.spendCustomActivity("a", "d", f.cycle(), 1);
  f.game.user.isGM = false;
  f.table("Nothing happens", false);
  await assert.rejects(f.api.rollCustomActivity("a", f.cycle()), /not visible/);
  assert.equal(f.counts().draws, 0);
  f.table("Nothing happens");
  await f.api.rollCustomActivity("a", f.cycle());
  assert.equal(f.model.customCycles(f.state().events)[0].result.applied, true);
});
test("custom UI replaces no native role flow and exposes progress and roll actions in Other Activity", () => {
  const template = Handlebars.compile(
    fs.readFileSync("static/templates/downtime.hbs", "utf8"),
  );
  const html = template({
    hasActor: true,
    ready: true,
    isGM: true,
    customActivities: [
      {
        id: "d",
        name: "Research",
        tracked: true,
        progress: 1,
        required: 3,
        remaining: 2,
        canSpend: true,
      },
      { id: "e", name: "Done", cycle: "c", canRoll: true },
    ],
  });
  assert.match(html, /data-custom-spend/);
  assert.match(html, /data-custom-roll/);
  assert.match(html, /Free Form/);
  assert.doesNotMatch(html, /Manage Activities|data-manage-custom/);
});

test("malformed payout tags preserve the rolled result instead of allowing rerolls", async () => {
  const f = fixture();
  f.table("Bad tag [Money](1d6)");
  await f.definition(null, "t");
  await f.api.spendCustomActivity("a", "d", "", 1);
  await f.api.rollCustomActivity("a", f.cycle());
  await f.api.rollCustomActivity("a", f.cycle());
  assert.equal(f.counts().draws, 1);
  assert.equal(f.actor.system.wealth.value, 100);
  assert.doesNotMatch(
    f.api.customActivityView("a", 11).latestResult,
    /Automatic payout skipped/,
  );
});
test("whole-amount rewards cap HP and Humanity gains and update Empathy", async () => {
  const f = fixture();
  f.table("Recovery [Hitpoints](50) [Humanity](50) [Reputation](2)");
  await f.definition(null, "t");
  await f.api.spendCustomActivity("a", "d", "", 1);
  await f.api.rollCustomActivity("a", f.cycle());
  assert.equal(f.actor.system.derivedStats.hp.value, 30);
  assert.equal(f.actor.system.derivedStats.humanity.value, 50);
  assert.equal(f.actor.system.stats.emp.value, 5);
  assert.equal(f.actor.system.reputation.value, 4);
});

test("selector lists available activities and starting queues a task without spending days", async () => {
  const f = fixture();
  await f.definition(3);
  assert.equal(f.api.customActivityView("a", 12).queue.length, 0);
  assert.equal(f.api.customActivityView("a", 12).choices.length, 1);
  await f.api.startCustomActivity("a", "d");
  const view = f.api.customActivityView("a", 12);
  assert.equal(view.queue.length, 1);
  assert.equal(view.queue[0].progress, 0);
  assert.equal(view.choices.length, 0);
  assert.equal(f.state().events.at(-1).days, 0);
  await assert.rejects(f.api.startCustomActivity("a", "d"), /already/);
  await f.api.spendCustomActivity("a", "d", f.cycle(), 3);
  assert.equal(f.api.customActivityView("a", 9).queue.length, 0);
  assert.equal(f.api.customActivityView("a", 9).choices.length, 1);
});

test("GM configuration rejects broken or unreadable tables before saving any activity", async () => {
  const f = fixture();
  f.table("Plain result without payout");
  const table = f.game.tables[0];
  table.update = () => {
    throw Error("Must never update a table");
  };
  table.normalize = table.update;
  const attempt = async (change, pattern) => {
    const before = structuredClone(f.api.customActivities());
    change();
    await assert.rejects(f.definition(null, "t"), pattern);
    assert.deepEqual(structuredClone(f.api.customActivities()), before);
  };
  await attempt(() => (table.formula = ""), /set a dice formula/);
  await attempt(() => (table.formula = "broken("), /invalid/);
  table.formula = "1d6";
  await attempt(() => (table.results = []), /at least one result/);
  table.results = [{ id: "r", range: [2, 6] }];
  await attempt(() => {}, /do not cover/);
  table.results[0].range = [1, 6];
  table.results[0].drawn = true;
  await attempt(() => {}, /all results/);
  table.results[0].drawn = false;
  table.testUserPermission = () => false;
  await attempt(() => {}, /Observer.*Owner/);
  table.testUserPermission = () => true;
  await f.definition(null, "t");
  assert.equal(f.api.customActivities().length, 1);
  assert.equal(f.counts().draws, 0);
  assert.equal(f.counts().rolls, 0);
});

test("a formula removed after setup never triggers table normalization or a payout", async () => {
  const f = fixture();
  f.table("Result [Money](50)");
  await f.definition(null, "t");
  await f.api.spendCustomActivity("a", "d", "", 1);
  const table = f.game.tables[0];
  table.formula = "";
  table.roll = () => {
    throw Error("Would normalize and write");
  };
  table.update = () => {
    throw Error("Must not update");
  };
  await f.api.rollCustomActivity("a", f.cycle());
  assert.equal(f.actor.system.wealth.value, 100);
  assert.equal(f.counts().draws, 0);
  assert.match(f.api.customActivityView("a", 11).latestResult, /Result/);
});
test("malformed or unknown trailing payout blocks are ignored without partial awards", () => {
  const f = fixture();
  for (const ending of [
    "[Money](1 0)",
    "[money](10)",
    "[Unknown](10) [Money](50)",
    "[Money](bad) [Humanity](4)",
    "[Money](1.5)",
  ])
    assert.equal(f.model.parseCustomRewards(ending).length, 0);
});

test("manual payout rolls survive reopening and apply together once, including retries", async () => {
  const f = fixture();
  f.table("A discovery. [Money](10) [Humanity](2d6) [Hitpoints](-1d5)");
  await f.definition(null, "t");
  await f.api.spendCustomActivity("a", "d", "", 1);
  const resume = (rewardIndex) =>
    f.api.rollCustomActivity("a", f.cycle(), {
      deferDice: true,
      ...(rewardIndex === undefined ? {} : { rewardIndex }),
    });
  await resume();
  assert.equal(f.counts().draws, 1);
  assert.equal(f.counts().rolls, 0);
  assert.equal(f.counts().actorWrites, 0);
  let result = f.model.customCycles(f.state().events)[0].result;
  assert.equal(result.text, "A discovery.");
  assert.equal(result.rewards[1].amount, null);
  f.model.validateCustomEvent(f.state().events.at(-1));
  await resume(1);
  await resume(); // Reopening neither rerolls nor applies a partial payout.
  await resume(1); // A repeated click also preserves the saved roll.
  assert.equal(f.counts().rolls, 1);
  assert.equal(f.counts().actorWrites, 0);
  assert.equal(f.api.customActivityView("a", 11).queue[0].resume, true);
  f.failAt(f.counts().writes + 3); // Final Journal write after the native update.
  await assert.rejects(resume(2), /Journal failed/);
  assert.equal(f.counts().actorWrites, 1);
  await resume();
  result = f.model.customCycles(f.state().events)[0].result;
  assert.equal(result.applied, true);
  assert.equal(f.actor.system.wealth.value, 110);
  assert.equal(f.actor.system.derivedStats.humanity.value, 36);
  assert.equal(f.actor.system.derivedStats.hp.value, 15);
  assert.equal(f.counts().draws, 1);
  assert.equal(f.counts().rolls, 2);
  assert.equal(f.counts().actorWrites, 1);
});

test("result presentation separates escaped descriptions, payouts, and pending roll controls", () => {
  const f = fixture();
  const old = {
    text: "A <clue>. [Humanity](+2) — Humanity +2 = 2",
    tableTotal: 3,
    applied: true,
    rewards: [{ type: "Humanity", formula: "+2", amount: 2 }],
  };
  const html = f.view.customResultHtml(old, true);
  assert.match(html, /custom-activity-result-text.*A &lt;clue&gt;\./);
  assert.match(
    html,
    /<ul class="custom-activity-payouts"><li><strong>Humanity:<\/strong> \+2/,
  );
  assert.match(html, /Applied/);
  assert.doesNotMatch(html, /\[Humanity\]|data-custom-reward|<clue>/);
  const pending = f.view.customResultHtml(
    {
      ...old,
      applied: false,
      rewards: [{ type: "Humanity", formula: "2d6", amount: null }],
      text: "Clue.",
    },
    true,
  );
  assert.match(pending, /data-custom-reward="0"/);
  assert.match(pending, /Continue Result/);
  assert.match(pending, /Pending/);
  assert.doesNotMatch(pending, /data-custom-apply/);
  const invalid = "A clue. [Reputation](+1) [Humanity](+2))";
  assert.equal(f.model.parseCustomRewards(invalid).length, 0);
  assert.equal(f.model.customResultDescription(invalid), invalid);
});
