import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
import { journalWorld } from "./journal-world.mjs";
function fixture() {
  let date = "2078-02-06",
    seq = 0;
  const gm = { id: "gm", isGM: true, active: true },
    one = { id: "one", isGM: false },
    two = { id: "two", isGM: false };
  const game = {
    user: gm,
    users: [gm, one, two],
    actors: [],
    settings: {
      get: (_ns, key) =>
        key === "rentModifiers" ? "-50,-25,-10,0,10,25,50,100" : [],
      set: async () => {},
    },
  };
  function actor(id, user, type = "character") {
    const a = {
      id,
      name: id,
      type,
      flags: {},
      system: { wealth: { value: 5000, transactions: [] } },
      testUserPermission: (u) => u.id === user?.id,
      getFlag: (ns, key) => a.flags[ns]?.[key],
      async update(data) {
        assert.ok(
          game.user.isGM || this.testUserPermission(game.user),
          "Actor permission",
        );
        for (const [key, value] of Object.entries(data)) {
          if (type === "character")
            assert.ok(key.startsWith("system."), "No character metadata");
          let obj = this;
          const parts = key.split(".");
          for (const part of parts.slice(0, -1)) obj = obj[part] ??= {};
          obj[parts.at(-1)] = structuredClone(value);
        }
      },
    };
    game.actors.push(a);
    if (user) user.character = a;
    return a;
  }
  const a = actor("A", one),
    b = actor("B", two),
    hq = actor("HQ", null, "container");
  const hooks = new Map();
  const forms = [];
  const docs = journalWorld(game),
    cache = new Map();
  const hqs = [{ id: "hq", actorId: hq.id, name: "Home", improvements: [] }];
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const out = {};
    cache.set(name, out);
    const source = ts.transpileModule(
      fs.readFileSync("src/" + name + ".ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(source, {
      exports: out,
      require: (key) =>
        key === "./calendar"
          ? { getCampaignDate: () => date }
          : key === "./headquarters"
            ? { getHeadquarters: () => ({ headquarters: hqs }) }
            : load(key.slice(2)),
      game,
      ...docs,
      structuredClone,
      console,
      foundry: { utils: { randomID: () => "id" + ++seq } },
      Hooks: {
        on: (name, fn) => hooks.set(name, fn),
        once: (name, fn) => hooks.set(name, fn),
      },
      FormApplication: class {
        render() {
          forms.push(this);
          return this;
        }
        activateListeners() {}
      },
      ui: { notifications: { error() {} } },
    });
    return out;
  }
  const api = load("rent"),
    store = load("journal-records");
  const prepare = async () => {
    await api.saveRentRates(
      [{ id: "apt", name: "Apartment", cost: 1000 }],
      [{ id: "food", name: "Food", cost: 100 }],
    );
    await store.ensureActorPayoutJournal(a);
    await store.ensureActorPayoutJournal(b);
    await load("hq-records").ensureHqPages(
      hq,
      { improvements: [] },
      { typeId: "", modifier: 0, bills: [] },
    );
    await api.setHqRent(hq.id, "apt", 0);
    load("hq-records").hqPage("HQ").ownership = { default: 2 };
  };
  return {
    game,
    gm,
    one,
    two,
    a,
    b,
    hq,
    api,
    store,
    load,
    prepare,
    hooks,
    forms,
    date: (v) => (date = v),
  };
}
test("percentage choices validate, deduplicate and calculate rounded rent", () => {
  const m = fixture().load("rent-model");
  assert.deepEqual(
    Array.from(m.parseRentModifiers("-50%, 0, +10%, +100,10")),
    [-50, 0, 10, 100],
  );
  assert.equal(m.rentCharge({ cost: 1000, name: "Rent" }, 10).amount, 1100);
  assert.equal(m.rentCharge({ cost: 101, name: "Rent" }, -50).amount, 51);
  assert.throws(() => m.parseRentModifiers("-101, 0"));
  assert.throws(() => m.parseRentModifiers("10,,20"));
});
test("Rent Is Due creates a task; choices and prices are recorded only when paying", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.saveResidence("A", {
    residence: "apt",
    modifier: 10,
    lifestyle: "food",
  });
  await f.api.issueRent();
  await f.api.issueRent();
  let data = f.api.characterRent("A");
  assert.equal(data.bills.length, 0);
  assert.equal(data.due.length, 1);
  assert.equal(f.a.system.wealth.value, 5000);
  f.game.user = f.one;
  f.gm.active = false;
  const choice = { residence: "apt", modifier: -50, lifestyle: "food" };
  await f.api.payPersonalRent("A", "2078-02", "rent", choice);
  assert.equal(f.a.system.wealth.value, 4500);
  data = f.api.characterRent("A");
  assert.equal(data.bills[0].rent.amount, 500);
  assert.equal(data.bills[0].lifestyle, undefined);
  assert.equal(data.due.length, 1);
  await assert.rejects(
    f.api.payPersonalRent("A", "2078-02", "rent"),
    /already paid/,
  );
  await f.api.payPersonalRent("A", "2078-02", "lifestyle", choice);
  assert.equal(f.a.system.wealth.value, 4400);
  assert.equal(f.api.characterRent("A").due.length, 0);
  await f.api.saveResidence("A", { ...choice, modifier: 10 });
  assert.equal(f.api.characterRent("A").bills[0].rent.amount, 500);
  f.game.user = f.gm;
  f.gm.active = true;
  await f.api.issueRent();
  assert.equal(f.api.characterRent("A").due.length, 0);
  f.date("2078-03-06");
  await f.api.issueRent();
  data = f.api.characterRent("A");
  assert.equal(data.bills.length, 1);
  assert.equal(data.due[0].period, "2078-03");
});

test("HQ residence avoids personal rent; offline contributions reconcile once with excess refunded", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.saveResidence("A", {
    residence: "hq:HQ",
    modifier: 0,
    lifestyle: "food",
  });
  await f.api.issueRent();
  assert.equal(f.api.characterRent("A").bills.length, 1);
  f.game.user = f.one;
  assert.equal(f.api.characterRent("A").bills[0].hqId, "HQ");
  assert.equal(f.a.system.wealth.value, 5000);
  f.gm.active = false;
  f.game.user = f.one;
  await f.api.contributeRent("A", "HQ", "2078-02", 700);
  assert.equal(f.a.system.wealth.value, 4300);
  assert.equal(f.api.rentStatus("A").pending, 700);
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 0);
  f.game.user = f.two;
  await f.api.contributeRent("B", "HQ", "2078-02", 700);
  assert.equal(f.b.system.wealth.value, 4300);
  f.game.user = f.gm;
  f.gm.active = true;
  await f.api.reconcileRent();
  await f.api.reconcileRent();
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 1000);
  assert.equal(f.api.hqRent(f.hq).bills[0].contributions.length, 2);
  assert.equal(f.b.system.wealth.value, 4700);
  assert.equal(f.api.rentStatus("B").pending, 0);
  assert.equal(f.api.characterRent("B").contributions[0].refunded, 400);
  const page = f.store.recordPage(f.store.actorPayoutJournal("B"), "rent");
  assert.match(page.text.content, /400 eb refunded/);
});
test("payment failures restore money and bills; another player cannot pay or change the character", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.saveResidence("A", {
    residence: "apt",
    modifier: 0,
    lifestyle: "food",
  });
  await f.api.issueRent();
  f.game.user = f.two;
  await assert.rejects(f.api.payPersonalRent("A", "2078-02", "rent"), /owned/);
  f.game.user = f.one;
  const page = f.store.recordPage(f.store.actorPayoutJournal("A"), "rent"),
    update = page.update;
  let count = 0;
  page.update = async function (data) {
    if (++count === 2) throw Error("receipt failed");
    return update.call(this, data);
  };
  await assert.rejects(
    f.api.payPersonalRent("A", "2078-02", "rent"),
    /receipt failed/,
  );
  assert.equal(f.a.system.wealth.value, 5000);
  assert.equal(f.api.characterRent("A").bills.length, 0);
  assert.equal(f.api.characterRent("A").due.length, 1);
  assert.equal(f.api.characterRent("A").attempt, undefined);
});
test("supplied charts are defaults, rates are GM-managed, and maintenance preserves rent pages", async () => {
  const f = fixture();
  assert.equal(f.api.rentConfig().housing.length, 11);
  assert.deepEqual(
    Array.from(f.api.rentConfig().lifestyles, (r) => r.cost),
    [100, 300, 600, 1500],
  );
  await f.prepare();
  await f.api.issueRent();
  const page = f.store.recordPage(f.store.actorPayoutJournal("A"), "rent"),
    text = page.text.content;
  await f.store.refreshRecordTables();
  assert.equal(page.text.content, text);
  f.game.user = f.one;
  await assert.rejects(f.api.saveRentRates([], []), /GM/);
});
test("Player Hub labels pending rent below Money and rent templates compile", () => {
  const template = Handlebars.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  );
  const html = template({
    status: { money: 4300 },
    rent: { pending: 700, due: true },
  });
  assert.match(
    html,
    /<dt>Money<\/dt>[\s\S]*?Pending Rent Payment:\s+700\s+eb[\s\S]*?<dt>IP/,
  );
  for (const file of ["rent", "rent-settings"])
    assert.doesNotThrow(() =>
      Handlebars.compile(
        fs.readFileSync("static/templates/" + file + ".hbs", "utf8"),
      )({}),
    );
});

test("rent reconciliation hooks process a pending payment when the GM connects", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.issueRent();
  f.game.user = f.one;
  f.gm.active = false;
  await f.api.contributeRent("A", "HQ", "2078-02", 500);
  f.api.registerRentReconciliation();
  f.game.user = f.gm;
  f.gm.active = true;
  f.hooks.get("userConnected")();
  await f.load("action-coordinator").queueAction(async () => {});
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 500);
  assert.equal(f.api.characterRent("A").contributions[0].status, "confirmed");
});

test("a failed overpayment refund can retry without crediting HQ or refunding twice", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.issueRent();
  f.game.user = f.one;
  await f.api.contributeRent("A", "HQ", "2078-02", 1000);
  f.game.user = f.two;
  await f.api.contributeRent("B", "HQ", "2078-02", 500);
  const page = f.store.recordPage(f.store.actorPayoutJournal("B"), "rent"),
    update = page.update;
  let writes = 0;
  page.update = async function (data) {
    if (++writes === 2) throw Error("refund receipt failed");
    return update.call(this, data);
  };
  f.game.user = f.gm;
  await assert.rejects(f.api.reconcileRent(), /refund receipt failed/);
  assert.equal(f.b.system.wealth.value, 4500);
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 1000);
  await f.api.reconcileRent();
  await f.api.reconcileRent();
  assert.equal(f.b.system.wealth.value, 5000);
  assert.equal(f.api.hqRent(f.hq).bills[0].contributions.length, 2);
});

test("player form pays its current dropdown choices without saving preferences first", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.saveResidence("A", {
    residence: "apt",
    modifier: 10,
    lifestyle: "food",
  });
  await f.api.issueRent();
  f.game.user = f.one;
  f.gm.active = false;
  f.load("rent-form").openRent("A");
  const form = f.forms.at(-1);
  form.getData();
  const inputs = Object.fromEntries(
    Object.entries({
      residence: "apt",
      modifier: "-50",
      lifestyle: "food",
    }).map(([key, value]) => [
      key,
      {
        value,
        addEventListener(_e, fn) {
          this.change = fn;
        },
      },
    ]),
  );
  const button = {
    dataset: { rentAction: "rent", period: "2078-02" },
    addEventListener(_e, fn) {
      this.click = fn;
    },
  };
  const root = {
    querySelector(selector) {
      return inputs[selector.match(/name="(.+?)"/)?.[1]] ?? null;
    },
    querySelectorAll(selector) {
      return selector.includes("name=residence")
        ? Object.values(inputs)
        : selector === "[data-rent-action]" || selector === "button"
          ? [button]
          : [];
    },
  };
  form.activateListeners([root]);
  inputs.modifier.change();
  assert.equal(form.getData().bills[0].rent.amount, 500);
  assert.equal(f.api.characterRent("A").bills.length, 0);
  button.click();
  await f.load("action-coordinator").queueAction(async () => {});
  assert.equal(f.a.system.wealth.value, 4500);
  assert.equal(f.api.characterRent("A").bills[0].rent.amount, 500);
});

test("supplied zero-rent options and lifestyle changes complete the self-task at payment", async () => {
  const f = fixture();
  await f.api.issueRent();
  f.game.user = f.one;
  f.gm.active = false;
  const choice = { residence: "street", modifier: 0, lifestyle: "freshFood" };
  await f.api.payPersonalRent("A", "2078-02", "rent", choice);
  assert.equal(f.a.system.wealth.value, 5000);
  assert.equal(f.api.characterRent("A").due.length, 1);
  await f.api.payPersonalRent("A", "2078-02", "lifestyle", {
    ...choice,
    lifestyle: "genericPrepak",
  });
  assert.equal(f.a.system.wealth.value, 4700);
  assert.equal(
    f.api.characterRent("A").bills[0].lifestyle.name,
    "Generic Prepak",
  );
  assert.equal(f.api.characterRent("A").due.length, 0);
  assert.equal(f.api.rentStatus("A").due, false);
});

test("housing status is a Journal-backed reminder and respects the vehicle bed exemption", async () => {
  const f = fixture();
  await f.api.issueRent();
  f.game.user = f.one;
  const before = structuredClone(f.a.system);
  await f.api.saveResidence("A", {
    residence: "street",
    modifier: 0,
    lifestyle: "kibble",
  });
  assert.match(f.api.rentStatus("A").housingReminder, /nightly DV15 Endurance/);
  const page = f.store.recordPage(f.store.actorPayoutJournal("A"), "rent");
  assert.match(page.text.content, /Housing status/);
  assert.match(page.text.content, /DV15 Endurance/);
  await f.api.saveResidence("A", {
    residence: "vehicle",
    modifier: 0,
    lifestyle: "kibble",
  });
  assert.match(f.api.rentStatus("A").housingReminder, /without a bed/);
  await f.api.saveResidence("A", {
    residence: "vehicle",
    modifier: 0,
    lifestyle: "kibble",
    vehicleHasBed: true,
  });
  assert.equal(f.api.rentStatus("A").housingReminder, "");
  assert.equal(f.api.characterRent("A").choice.vehicleHasBed, true);
  await f.api.saveResidence("A", {
    residence: "cubeHotel",
    modifier: 0,
    lifestyle: "kibble",
  });
  assert.equal(f.api.rentStatus("A").housingReminder, "");
  assert.deepEqual(f.a.system, before);
  assert.deepEqual(f.a.flags, {});
});

test("Player Hub shows the housing reminder and rent form offers a bed exemption only for vehicles", () => {
  const hub = Handlebars.compile(
    fs.readFileSync("static/templates/payout-inbox.hbs", "utf8"),
  );
  assert.match(
    hub({
      status: {},
      rent: { housingReminder: "Nightly DV15 Endurance check required" },
    }),
    /hub-housing-reminder[\s\S]*DV15 Endurance/,
  );
  const rent = Handlebars.compile(
    fs.readFileSync("static/templates/rent.hbs", "utf8"),
  );
  assert.match(
    rent({ vehicleResidence: true, vehicleHasBed: true }),
    /name="vehicleHasBed"\s+checked/,
  );
  assert.doesNotMatch(
    rent({ vehicleResidence: false }),
    /name="vehicleHasBed"/,
  );
});

test("between-bill changes charge only increases, never refund downgrades, and saving twice is free", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.saveRentRates(
    [
      { id: "apt", name: "Apartment", cost: 1000 },
      { id: "cheap", name: "Cheap", cost: 500 },
    ],
    [
      { id: "food", name: "Food", cost: 100 },
      { id: "better", name: "Better", cost: 300 },
    ],
  );
  const choice = { residence: "apt", lifestyle: "food", modifier: 0 };
  await f.api.saveResidence("A", choice);
  f.game.user = f.one;
  const changed = { ...choice, residence: "cheap", lifestyle: "better" };
  assert.equal(
    f.api.previewChoiceChange(f.api.characterRent("A"), changed).amount,
    200,
  );
  await f.api.saveResidence("A", changed);
  assert.equal(f.a.system.wealth.value, 4800);
  await f.api.saveResidence("A", changed);
  assert.equal(f.a.system.wealth.value, 4800);
  await f.api.saveResidence("A", { ...changed, lifestyle: "food" });
  assert.equal(f.a.system.wealth.value, 4800);
  const page = f.store.recordPage(f.store.actorPayoutJournal("A"), "rent");
  assert.match(page.text.content, /Lifestyle: Better.*200/);
  await f.api.saveResidence("A", { ...choice, residence: "hq:HQ" });
  assert.equal(f.a.system.wealth.value, 4800);
  await f.api.saveResidence("A", choice);
  assert.equal(f.a.system.wealth.value, 3800);
});

test("a residence increase cannot save without funds and rolls back on failed Journal receipt", async () => {
  const f = fixture();
  await f.prepare();
  const choice = { residence: "apt", lifestyle: "food", modifier: 0 };
  await f.api.saveResidence("A", choice);
  f.game.user = f.one;
  f.a.system.wealth.value = 10;
  await assert.rejects(
    f.api.saveResidence("A", { ...choice, modifier: 100 }),
    /Not enough money/,
  );
  assert.equal(f.api.characterRent("A").choice.modifier, 0);
  f.a.system.wealth.value = 5000;
  const page = f.store.recordPage(f.store.actorPayoutJournal("A"), "rent"),
    original = page.update;
  let writes = 0;
  page.update = async function (data) {
    if (++writes === 2) throw Error("receipt failed");
    return original.call(this, data);
  };
  await assert.rejects(
    f.api.saveResidence("A", { ...choice, modifier: 100 }),
    /receipt failed/,
  );
  assert.equal(f.a.system.wealth.value, 5000);
  assert.equal(f.api.characterRent("A").choice.modifier, 0);
  assert.equal(f.api.characterRent("A").changes, undefined);
});

test("paying an outstanding lifestyle bill cannot bypass an increase to already-paid rent", async () => {
  const f = fixture();
  await f.prepare();
  const choice = { residence: "apt", lifestyle: "food", modifier: 0 };
  await f.api.saveResidence("A", choice);
  await f.api.issueRent();
  f.game.user = f.one;
  await f.api.payPersonalRent("A", "2078-02", "rent", choice);
  await f.api.payPersonalRent("A", "2078-02", "lifestyle", {
    ...choice,
    modifier: 50,
  });
  assert.equal(f.a.system.wealth.value, 3400);
  assert.equal(f.api.characterRent("A").changes[0].amount, 500);
  assert.equal(f.api.characterRent("A").bills[0].rent.amount, 1000);
});

test("saving HQ residence settles personal rent automatically while shared HQ rent remains due", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.saveResidence("A", {
    residence: "apt",
    modifier: 0,
    lifestyle: "food",
  });
  await f.api.issueRent();
  f.game.user = f.one;
  await f.api.payPersonalRent("A", "2078-02", "lifestyle");
  await f.api.saveResidence("A", {
    residence: "hq:HQ",
    modifier: 0,
    lifestyle: "food",
  });
  assert.equal(f.api.characterRent("A").bills[0].hqId, "HQ");
  assert.equal(f.api.characterRent("A").due.length, 0);
  assert.equal(f.a.system.wealth.value, 4900);
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 0);
  assert.equal(f.api.hqRent(f.hq).bills[0].charge.amount, 1000);
  const html = Handlebars.compile(
    fs.readFileSync("static/templates/rent.hbs", "utf8"),
  )({
    hasActor: true,
    ready: true,
    bills: [{ hq: true, period: "2078-02", date: "02-06-2078" }],
  });
  assert.doesNotMatch(html, /Confirm HQ Residence|data-rent-action="rent"/);
  assert.match(html, /Shared HQ\s+rent/);
});

test("HQ page owners pay and confirm rent without a connected GM", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.issueRent();
  f.load("hq-records").hqPage("HQ").ownership = { default: 3 };
  f.gm.active = false;
  f.game.user = f.one;
  await f.api.contributeRent("A", "HQ", "2078-02", 700);
  assert.equal(f.a.system.wealth.value, 4300);
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 700);
  assert.equal(f.api.characterRent("A").contributions[0].status, "confirmed");
  assert.equal(f.api.rentStatus("A").pending, 0);
  await f.api.reconcileRent();
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 700);
  assert.equal(f.a.system.wealth.value, 4300);
});
test("HQ page owners reconcile prior pending overpayments and receive refunds without GM", async () => {
  const f = fixture();
  await f.prepare();
  await f.api.issueRent();
  f.gm.active = false;
  f.game.user = f.one;
  await f.api.contributeRent("A", "HQ", "2078-02", 700);
  f.game.user = f.two;
  await f.api.contributeRent("B", "HQ", "2078-02", 700);
  f.load("hq-records").hqPage("HQ").ownership = { default: 3 };
  f.game.user = f.one;
  await f.api.reconcileRent();
  f.game.user = f.two;
  await f.api.reconcileRent();
  await f.api.reconcileRent();
  assert.equal(f.api.hqRent(f.hq).bills[0].paid, 1000);
  assert.equal(f.b.system.wealth.value, 4700);
  assert.equal(f.api.characterRent("B").contributions[0].refunded, 400);
});
