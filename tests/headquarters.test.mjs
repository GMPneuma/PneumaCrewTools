import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import Handlebars from "handlebars";
function fixture(customCatalog = []) {
  let sequence = 0,
    fail = false,
    queue = Promise.resolve();
  const game = {
    user: { id: "player", isGM: true },
    folders: [],
    journal: new Map(),
    actors: new Map(),
  };
  for (const key of ["journal", "actors"])
    game[key][Symbol.iterator] = function* () {
      yield* this.values();
    };
  const folders = game.folders;
  const make = (data) => {
    const d = { id: String(++sequence), ...structuredClone(data) };
    d.testUserPermission = (user, permission = "OWNER") =>
      user.isGM ||
      (d.ownership?.[user.id] ?? d.ownership?.default ?? 0) >=
        (permission === "OBSERVER" ? 2 : 3);
    d.getFlag = (ns, key) => d.flags?.[ns]?.[key];
    d.update = async (changes) => {
      if (fail && d.getFlag("pneuma-crewtools", "kind") === "headquarters")
        throw Error("write failed");
      for (const [key, value] of Object.entries(changes)) {
        if (key === "folder") {
          d.folder = folders.find((f) => f.id === value) ?? null;
          continue;
        }
        const parts = key.split(".");
        let target = d;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete target[last.slice(2)];
        else target[last] = structuredClone(value);
      }
    };
    return d;
  };
  const Actor = {
    create: async (data) => {
      const a = make(data);
      a.folder = folders.find((f) => f.id === data.folder) ?? null;
      a.delete = async () => game.actors.delete(a.id);
      game.actors.set(a.id, a);
      return a;
    },
  };
  const JournalEntry = {
    create: async (data) => {
      const j = make({ ...data, pages: undefined });
      j.pages = (data.pages ?? []).map(make);
      j.createEmbeddedDocuments = async (_, pages) => {
        const made = pages.map(make);
        j.pages.push(...made);
        return made;
      };
      game.journal.set(j.id, j);
      return j;
    },
  };
  const deps = {
    "./hq-catalog": {
      getHqCatalog: () => [
        ...customCatalog,
        {
          id: "medbay",
          name: "Medbay",
          cost: 40,
          description: "Recovery",
          effect: "medbay",
        },
      ],
      HqCatalogSettings: class {},
    },
    "./rent": {
      rentConfig: () => ({
        housing: [{ id: "apt", name: "Apartment", cost: 1000 }],
      }),
      hqRent: (actor) =>
        actor.getFlag("pneuma-crewtools", "rent") ?? {
          typeId: "",
          modifier: 0,
          bills: [],
        },
      rentModifiers: () => [0, 10],
    },
    "./rent-model": {
      rentCharge: (rate, modifier) => ({
        amount: Math.round(rate.cost * (1 + modifier / 100)),
      }),
      modifierLabel: (value) => value + "%",
    },
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./actor-policy": { isActorExcluded: () => false },
    "./id": { createUniqueId: () => "id-" + ++sequence },
    "./calendar": { getCampaignDate: () => "2078-02-06" },
    "./downtime": {
      isDowntimeGM: () => game.user.isGM,
      withDowntimeLock: (fn) => {
        const next = queue.then(() => {
          if (!game.user.isGM) throw Error("GM only");
          return fn();
        });
        queue = next.catch(() => {});
        return next;
      },
    },
  };
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(new URL("../src/headquarters.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const dates = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/date-format.ts", import.meta.url),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    { exports: dates },
  );
  deps["./date-format"] = dates;
  const forms = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/foundry-form.ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { exports: forms, FormApplication: class {} },
  );
  deps["./foundry-form"] = forms;
  const refresh = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("../src/ui-refresh.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { exports: refresh, require: () => ({ MODULE_ID: "pneuma-crewtools" }) },
  );
  deps["./ui-refresh"] = refresh;
  const extra = {};
  function loadExtra(name) {
    if (deps["./" + name]) return deps["./" + name];
    if (extra[name]) return extra[name];
    const out = (extra[name] = {});
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports: out,
        require: (k) => deps[k] ?? loadExtra(k.slice(2)),
        game,
        JournalEntry,
        structuredClone,
        Folder: {
          create: async (data) => {
            const f = {
              id: String(++sequence),
              ...data,
              folder: folders.find((f) => f.id === data.folder) ?? null,
            };
            folders.push(f);
            return f;
          },
        },
      },
    );
    return out;
  }
  deps["./hq-records"] = loadExtra("hq-records");
  deps["./rent"].hqRent = (actor) => deps["./hq-records"].readHqRent(actor.id);
  vm.runInNewContext(code, {
    exports,
    require: (k) =>
      k === "./action-coordinator"
        ? {
            queueAction: (fn) => {
              const next = queue.then(fn);
              queue = next.catch(() => {});
              return next;
            },
            withGMAction: deps["./downtime"].withDowntimeLock,
            isPrimaryGM: deps["./downtime"].isDowntimeGM,
          }
        : deps[k],
    structuredClone,
    Error,
    game,
    Actor,
    JournalEntry,
    FormApplication: class {},
    Folder: {
      create: async (data) => {
        const f = {
          id: String(++sequence),
          ...data,
          folder: folders.find((f) => f.id === data.folder) ?? null,
        };
        folders.push(f);
        return f;
      },
    },
    ui: { notifications: { error() {} } },
    Hooks: { on() {} },
  });
  return {
    api: exports,
    records: deps["./hq-records"],
    game,
    Actor,
    fail: (value) => {
      fail = value;
    },
    award: async (amount = 10, id = "payout-1") =>
      deps["./downtime"].withDowntimeLock(() =>
        exports.applyHeadquartersPayout(
          {
            inGameDate: "2078-02-06",
            sessionLabel: "Gig",
            hqIpTransactions: [{ amount, reason: "Award" }],
          },
          id,
        ),
      ),
  };
}
test("multiple HQs use standard containers, shared module folders, tags and readable Journals", async () => {
  const f = fixture();
  const a = await f.api.saveHeadquarters({
    name: "Workshop",
    image: "images/hq.webp",
  });
  const b = await f.api.saveHeadquarters({ name: "Safehouse", image: "" });
  assert.notEqual(a, b);
  assert.equal(f.api.getHeadquarters().headquarters.length, 2);
  assert.equal(f.game.actors.size, 2);
  for (const type of ["Actor", "JournalEntry"]) {
    const folder = f.game.folders.find(
      (d) => d.type === type && d.name === "CrewTools",
    );
    assert.ok(folder);
    if (type === "Actor")
      assert.ok(
        f.game.folders.some(
          (d) =>
            d.type === type &&
            d.name === "CrewTools-GM" &&
            d.folder?.id === folder.id,
        ),
      );
  }
  for (const actor of f.game.actors) {
    assert.equal(actor.type, "container");
    assert.equal(actor.folder.name, "CrewTools");
    assert.ok(f.records.hqPage(actor.id));
    assert.equal(actor.getFlag("pneuma-crewtools", "hq"), undefined);
    assert.equal(actor.ownership.default, 2);
  }
  const journal = [...f.game.journal][0];
  assert.equal(journal.ownership.default, 2);
  assert.equal(journal.name, "Headquarters");
  assert.equal(journal.pages.length, 3);
  for (const actor of f.game.actors) {
    const page = f.records.hqPage(actor.id);
    assert.equal(page.ownership.default, 3);
    assert.match(page.text.content, /Stats &amp; Improvements/);
    assert.match(page.text.content, /Rent &amp; Payments/);
  }
  assert.match(journal.pages[0].text.content, /About this page/);
});
test("existing containers retain inventory and permissions; native identity replaces relinking", async () => {
  const f = fixture();
  const a = await f.Actor.create({
    type: "container",
    name: "Existing",
    ownership: { default: 0 },
    system: { wealth: { value: 300 } },
    flags: {},
  });
  const id = await f.api.saveHeadquarters({
    name: "HQ",
    image: "",
    actorId: a.id,
  });
  assert.equal(a.system.wealth.value, 300);
  assert.equal(a.ownership.default, 0);
  assert.equal(a.folder, null);
  await assert.rejects(
    f.api.saveHeadquarters({ name: "Other", image: "", actorId: a.id }),
    /already an HQ/,
  );
  const b = await f.Actor.create({ type: "container", name: "Replacement" });
  await assert.rejects(
    f.api.saveHeadquarters({
      id,
      name: "HQ renamed",
      image: "",
      actorId: b.id,
    }),
    /cannot be relinked/,
  );
  await a.update({ name: "Native rename", img: "new.webp" });
  assert.equal(f.api.getHeadquarters().headquarters[0].name, "Native rename");
  assert.equal(f.api.getHeadquarters().headquarters[0].image, "new.webp");
  assert.equal(id, a.id);
  assert.equal(a.system.wealth.value, 300);
  assert.equal(b.getFlag("pneuma-crewtools", "hq"), undefined);
});
test("payouts credit shared HQ IP, improvements debit it atomically, and overspending is rejected", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "HQ", image: "" });
  await f.award(10);
  assert.equal(f.api.headquartersIp(), 10);
  await assert.rejects(f.award(10), /already awarded/);
  const results = await Promise.allSettled([
    f.api.buyHqImprovement(id, "Workshop", 7, "GM-entered effect"),
    f.api.buyHqImprovement(id, "Security", 7, ""),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.api.headquartersIp(), 3);
  assert.equal(f.api.getHeadquarters().headquarters[0].improvements.length, 1);
  f.fail(true);
  await assert.rejects(
    f.api.buyHqImprovement(id, "Small", 2, ""),
    /write failed/,
  );
  assert.equal(f.api.headquartersIp(), 3);
  assert.equal(f.api.getHeadquarters().headquarters[0].improvements.length, 1);
});
test("HQ creation does not write a roster; payout rollback restores HQ IP", async () => {
  const f = fixture();
  await f.api.saveHeadquarters({ name: "First", image: "" });
  const undo = await f.award(10);
  await undo();
  assert.equal(f.api.headquartersIp(), 0);
  f.fail(true);
  await f.api.saveHeadquarters({ name: "Independent", image: "" });
  assert.equal(f.game.actors.size, 2);
  assert.equal(
    [...f.game.journal][0].pages[0].getFlag("pneuma-crewtools", "headquarters")
      .headquarters,
    undefined,
  );
});
test("players can buy improvements without Container ownership", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "HQ", image: "" });
  await f.award(5);
  f.game.user.isGM = false;
  assert.equal(f.api.getHeadquarters().headquarters[0].name, "HQ");
  await assert.rejects(
    f.api.saveHeadquarters({ name: "Bad", image: "" }),
    /GM only/,
  );
  await f.api.buyHqImprovement(id, "Workshop", 1, "");
  assert.equal(f.api.headquartersIp(), 4);
  assert.equal(f.game.actors.get(id).testUserPermission(f.game.user), false);
  f.records.hqPage(id).ownership.default = 2;
  await assert.rejects(
    f.api.buyHqImprovement(id, "Bad", 1, ""),
    /cannot spend/,
  );
});
test("HQ player template exposes current improvements and container, with no history or GM controls", () => {
  const template = Handlebars.compile(
    fs.readFileSync(
      new URL("../static/templates/headquarters.hbs", import.meta.url),
      "utf8",
    ),
  );
  const html = template({
    canManage: false,
    ip: 5,
    hq: {
      name: "HQ",
      improvements: [{ name: "Workshop", cost: 5, notes: "Tools" }],
    },
    hasContainer: true,
    containerName: "Storage",
  });
  assert.match(html, /Workshop/);
  assert.match(html, /data-open-container/);
  assert.doesNotMatch(html, /data-buy-improvement|Save Headquarters|history/i);
});

test("HQ descriptions and explicit improvements can be edited and removed without refunding IP", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({
    name: "Clinic",
    image: "",
    description: "Watson, second floor",
  });
  await f.api.adjustHeadquartersIp(20, "Starting crew pool");
  await f.api.buyHqImprovement(id, "Recovery Suite", 5, "Beds", "medbay");
  let hq = f.api.getHeadquarters().headquarters[0];
  assert.equal(hq.description, "Watson, second floor");
  const improvementId = hq.improvements[0].id;
  await f.api.editHqImprovement(
    id,
    improvementId,
    "Machine Shop",
    "Tools",
    "workshop",
  );
  hq = f.api.getHeadquarters().headquarters[0];
  assert.equal(hq.improvements[0].effect, "workshop");
  assert.equal(hq.improvements[0].cost, 5);
  assert.equal(f.api.headquartersIp(), 15);
  f.fail(true);
  await assert.rejects(
    f.api.removeHqImprovement(id, improvementId),
    /write failed/,
  );
  f.fail(false);
  assert.equal(f.api.getHeadquarters().headquarters[0].improvements.length, 1);
  await f.api.removeHqImprovement(id, improvementId);
  assert.equal(f.api.getHeadquarters().headquarters[0].improvements.length, 0);
  assert.equal(f.api.headquartersIp(), 15);
  assert.match(
    f.api.getHeadquarters().transactions.at(-1).reason,
    /no IP refund/,
  );
});

test("HQ corrections reject overdraws, invalid effects and non-GM writes", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "HQ", image: "" });
  await f.api.adjustHeadquartersIp(10, "Starting points");
  await assert.rejects(
    f.api.adjustHeadquartersIp(-11, "Correction"),
    /overdrawn/,
  );
  await assert.rejects(f.api.adjustHeadquartersIp(2, ""), /reason/);
  await assert.rejects(
    f.api.buyHqImprovement(id, "Bad effect", 1, "", "unknown"),
    /effect/,
  );
  assert.equal(f.api.headquartersIp(), 10);
  await f.api.buyHqImprovement(id, "Medbay", 2, "", "medbay");
  const itemId = f.api.getHeadquarters().headquarters[0].improvements[0].id;
  f.game.user.isGM = false;
  await assert.rejects(f.api.adjustHeadquartersIp(10, "Cheat"), /GM only/);
  await assert.rejects(
    f.api.editHqImprovement(id, itemId, "Renamed", "", "notes"),
    /GM only/,
  );
  await assert.rejects(f.api.removeHqImprovement(id, itemId), /GM only/);
  assert.equal(f.api.headquartersIp(), 8);
});

test("A billed HQ cannot be relinked away from its rent contribution records", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "HQ", image: "" });
  const hq = f.api.getHeadquarters().headquarters[0];
  const actor = f.game.actors.get(hq.actorId);
  await actor.update({
    "flags.pneuma-crewtools.rent": {
      bills: [
        {
          period: "2078-02",
          date: "2078-02-06",
          charge: { name: "Apartment", amount: 1000 },
          paid: 0,
          contributions: [],
        },
      ],
    },
  });
  const other = await f.Actor.create({ type: "container", name: "Other" });
  await assert.rejects(
    f.api.saveHeadquarters({ id, name: "HQ", image: "", actorId: other.id }),
    /cannot be relinked/,
  );
  await f.api.saveHeadquarters({
    id,
    name: "Renamed",
    image: "",
    actorId: actor.id,
  });
  assert.equal(f.api.getHeadquarters().headquarters[0].name, "Renamed");
});

test("HQ form shows selected rent and effects with GM-only management controls", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({
    name: "Clinic",
    image: "",
    description: "Watson",
  });
  await f.api.buyHqImprovement(id, "Recovery suite", 0, "", "medbay");
  const actor = f.game.actors.get(
    f.api.getHeadquarters().headquarters[0].actorId,
  );
  await f.records.saveHqRentRecord(actor, {
    typeId: "apt",
    modifier: 10,
    bills: [
      {
        date: "2078-02-06",
        paid: 400,
        charge: { name: "Apartment", amount: 1100 },
        contributions: [],
      },
    ],
  });
  const form = new f.api.HeadquartersForm();
  let data = await form.getData();
  assert.equal(data.rentAmount, 1100);
  assert.equal(data.rentBills[0].remaining, 700);
  assert.equal(
    data.hq.improvements[0].effects.find((e) => e.selected).id,
    "medbay",
  );
  const render = Handlebars.compile(
    fs.readFileSync("static/templates/headquarters.hbs", "utf8"),
  );
  let html = render(data);
  assert.match(html, /data-remove-improvement/);
  assert.match(html, /hq-save-properties/);
  assert.match(html, /700 eb due/);
  f.game.user.isGM = false;
  data = await form.getData();
  html = render(data);
  assert.doesNotMatch(
    html,
    /data-edit-improvement|data-remove-improvement|data-adjust-ip|data-rent-save/,
  );
  assert.match(html, /data-rent-open/);
});

test("previous HQ roster and Actor rent transfer to one editable HQ page", async () => {
  const f = fixture();
  await f.api.adjustHeadquartersIp(10, "Setup");
  const actor = await f.Actor.create({
    type: "container",
    name: "Native HQ",
    img: "native.webp",
    flags: {
      "pneuma-crewtools": {
        rent: {
          bills: [
            {
              period: "2078-02",
              date: "2078-02-06",
              charge: { name: "Apartment", amount: 1000 },
              paid: 0,
              contributions: [],
            },
          ],
        },
      },
    },
  });
  const page = [...f.game.journal][0].pages[0];
  const stored = page.getFlag("pneuma-crewtools", "headquarters");
  await page.update({
    "flags.pneuma-crewtools.headquarters": {
      ...stored,
      headquarters: [
        {
          id: "old-id",
          actorId: actor.id,
          name: "Old display",
          image: "",
          description: "Location",
          improvements: [
            {
              id: "workshop",
              name: "Workshop",
              cost: 0,
              notes: "",
              date: "2078-02-06",
              effect: "workshop",
            },
          ],
        },
      ],
    },
  });
  await f.api.adjustHeadquartersIp(1, "After conversion");
  const hq = f.api.getHeadquarters().headquarters[0];
  assert.equal(hq.id, actor.id);
  assert.equal(hq.name, "Native HQ");
  assert.equal(hq.improvements[0].effect, "workshop");
  assert.equal(f.records.readHqRent(actor.id).bills.length, 1);
  assert.equal(
    page.getFlag("pneuma-crewtools", "headquarters").headquarters,
    undefined,
  );
  assert.equal(f.api.headquartersIp(), 11);
  await actor.delete();
  assert.equal(f.api.getHeadquarters().headquarters.length, 0);
});

test("custom improvement tiers use their descriptions and stop at the configured final level", async () => {
  for (const hasLevel2 of [false, true]) {
    const option = {
      id: "custom",
      name: "Custom Room",
      cost: 15,
      description: "First benefit",
      effect: "notes",
      hasLevel2,
      level2Description: "Second benefit",
    };
    const f = fixture([option]);
    const id = await f.api.saveHeadquarters({
      name: "Home",
      image: "",
      bedrooms: 2,
      maxImprovements: 1,
      rentType: "apt",
      rentModifier: 0,
    });
    await f.award(100);
    await f.api.buyHqImprovement(
      id,
      option.name,
      15,
      "stale description",
      "notes",
      option.id,
    );
    assert.equal(
      f.api.getHeadquarters().headquarters[0].improvements[0].notes,
      "First benefit",
    );
    const form = new f.api.HeadquartersForm();
    form.selectedId = id;
    if (hasLevel2) {
      assert.equal(
        form.getData().catalog.find((i) => i.id === option.id).description,
        "Second benefit",
      );
      await f.api.buyHqImprovement(
        id,
        option.name,
        15,
        "stale description",
        "notes",
        option.id,
      );
      assert.equal(
        f.api.getHeadquarters().headquarters[0].improvements[0].notes,
        "Second benefit",
      );
      assert.equal(
        f.api.getHeadquarters().headquarters[0].improvements[0].level,
        2,
      );
    }
    assert.equal(
      form.getData().catalog.some((i) => i.id === option.id),
      false,
    );
    await assert.rejects(
      f.api.buyHqImprovement(id, option.name, 15, "", "notes", option.id),
      /final level/,
    );
    assert.equal(f.api.headquartersIp(), hasLevel2 ? 70 : 85);
  }
});

test("HQ properties and rent persist on the Journal page; catalog levels preserve capacity and custom cost", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({
    name: "Home",
    image: "",
    bedrooms: 2,
    maxImprovements: 1,
    rentType: "apt",
    rentModifier: 10,
  });
  const actor = f.game.actors.get(id);
  assert.equal(f.records.hqProperties(id).bedrooms, 2);
  assert.equal(f.records.readHqRent(id).modifier, 10);
  await f.award(100);
  await f.api.buyHqImprovement(
    id,
    "Custom Room",
    15,
    "Short notes",
    "notes",
    "custom",
  );
  await f.api.buyHqImprovement(
    id,
    "Custom Room",
    15,
    "Short notes",
    "notes",
    "custom",
  );
  const hq = f.api.getHeadquarters().headquarters[0];
  assert.equal(hq.improvements.length, 1);
  assert.equal(hq.improvements[0].level, 2);
  assert.equal(hq.bedrooms, 2);
  assert.equal(hq.maxImprovements, 1);
  assert.equal(f.api.headquartersIp(), 70);
  await assert.rejects(
    f.api.buyHqImprovement(id, "Other", 5, "", "notes", "other"),
    /limit/,
  );
  f.fail(true);
  await assert.rejects(
    f.api.buyHqImprovement(id, "Custom Room", 15, "", "notes", "custom"),
    /write failed/,
  );
  assert.equal(
    f.api.getHeadquarters().headquarters[0].improvements[0].level,
    2,
  );
  assert.equal(f.api.headquartersIp(), 70);
});

test("HQ status skips the ledger, and stored IP reads skip transaction history", async () => {
  const f = fixture();
  await f.api.saveHeadquarters({ name: "Base" });
  await f.award(25);
  const ledger = [...f.game.journal.values()]
    .flatMap((j) => j.pages)
    .find((p) => p.getFlag("pneuma-crewtools", "kind") === "headquarters");
  const stored = ledger.getFlag("pneuma-crewtools", "headquarters");
  assert.equal(stored.balance, 25);
  Object.defineProperty(stored, "transactions", {
    get() {
      throw Error("history read");
    },
  });
  assert.equal(f.api.headquartersIp(), 25);
  assert.equal(f.api.getHeadquarters(false).headquarters.length, 1);
  assert.throws(() => f.api.getHeadquarters(), /history read/);
});

test("HQ uses the full native Stash preset and preserves ownership", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "HQ" });
  const actor = f.game.actors.get(id);
  assert.equal(actor.type, "container");
  assert.equal(actor.getFlag("cyberpunk-red-core", "container-type"), "stash");
  await actor.update({
    "flags.cyberpunk-red-core.container-type": "shop",
    "flags.cyberpunk-red-core.players-modify": false,
  });
  await f.api.saveHeadquarters({ id, name: "HQ" });
  assert.equal(actor.getFlag("cyberpunk-red-core", "container-type"), "stash");
  assert.equal(actor.getFlag("cyberpunk-red-core", "players-modify"), true);
  assert.equal(actor.ownership.default, 2);
});

test("failed HQ page creation preserves Actor metadata for retry", async () => {
  const f = fixture();
  await f.api.adjustHeadquartersIp(10, "Setup");
  const actor = await f.Actor.create({
    type: "container",
    name: "Legacy",
    flags: {
      "pneuma-crewtools": {
        hq: { description: "Keep", bedrooms: 2, improvements: [] },
        rent: { typeId: "apt", modifier: 10, bills: [] },
      },
    },
  });
  const journal = [...f.game.journal][0],
    create = journal.createEmbeddedDocuments;
  journal.createEmbeddedDocuments = async () => {
    throw Error("page failed");
  };
  await assert.rejects(f.api.adjustHeadquartersIp(1, "Convert"), /page failed/);
  assert.equal(actor.getFlag("pneuma-crewtools", "hq").bedrooms, 2);
  assert.equal(actor.getFlag("pneuma-crewtools", "rent").modifier, 10);
  journal.createEmbeddedDocuments = create;
  await f.api.adjustHeadquartersIp(1, "Convert");
  assert.equal(f.records.hqProperties(actor.id).bedrooms, 2);
  assert.equal(f.records.readHqRent(actor.id).modifier, 10);
  assert.equal(actor.getFlag("pneuma-crewtools", "hq"), undefined);
  assert.equal(actor.getFlag("pneuma-crewtools", "rent"), undefined);
});

test("HQ deletion marks inactive, hides native documents and preserves contents and records", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "Retired HQ" });
  const other = await f.api.saveHeadquarters({ name: "Active HQ" });
  const actor = f.game.actors.get(id);
  actor.items = [{ name: "Stored gear" }];
  actor.ownership.specificPlayer = 3;
  const page = f.records.hqPage(id);
  page.ownership.specificPlayer = 3;
  const properties = structuredClone(page.flags["pneuma-crewtools"].properties);
  const rental = structuredClone(page.flags["pneuma-crewtools"].rent);
  const ip = f.api.headquartersIp();
  f.game.user.isGM = false;
  await assert.rejects(f.api.deactivateHeadquarters(id), /GM/);
  f.game.user.isGM = true;
  await f.api.deactivateHeadquarters(id);
  await f.api.deactivateHeadquarters(id);
  assert.equal(page.getFlag("pneuma-crewtools", "inactive"), true);
  assert.equal(actor.ownership.default, 0);
  assert.equal(actor.ownership.specificPlayer, 0);
  assert.equal(page.ownership.default, 0);
  assert.equal(page.ownership.specificPlayer, 0);
  assert.deepEqual(actor.items, [{ name: "Stored gear" }]);
  assert.deepEqual(page.flags["pneuma-crewtools"].properties, properties);
  assert.deepEqual(page.flags["pneuma-crewtools"].rent, rental);
  assert.equal(f.api.headquartersIp(), ip);
  assert.deepEqual(
    Array.from(f.api.getHeadquarters().headquarters, (h) => h.id),
    [other],
  );
  assert.equal(f.records.canPayHq(id), false);
  const form = new f.api.HeadquartersForm();
  form.selectedId = id;
  const gm = form.getData();
  assert.equal(gm.hq.id, other);
  assert.equal(gm.inactiveHqs[0].name, "Retired HQ");
  assert.equal(
    gm.containers.some((c) => c.id === id),
    false,
  );
  await assert.rejects(
    f.api.saveHeadquarters({ id, name: "Reused HQ" }),
    /inactive/,
  );
  f.game.user.isGM = false;
  assert.equal(form.getData().inactiveHqs.length, 0);
  const template = Handlebars.compile(
    fs.readFileSync("static/templates/headquarters.hbs", "utf8"),
  );
  assert.match(template(gm), /data-delete-hq/);
  assert.doesNotMatch(template(form.getData()), /data-delete-hq|Retired HQ/);
});
test("failed HQ deactivation restores container permissions", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "HQ" });
  const actor = f.game.actors.get(id);
  actor.ownership.player = 3;
  const before = structuredClone(actor.ownership);
  f.records.hqPage(id).update = async () => {
    throw Error("page failed");
  };
  await assert.rejects(f.api.deactivateHeadquarters(id), /page failed/);
  assert.deepEqual(actor.ownership, before);
  assert.equal(f.api.getHeadquarters().headquarters.length, 1);
});

test("player HQ discovery and facility checks require both native document permissions", async () => {
  const f = fixture();
  const id = await f.api.saveHeadquarters({ name: "Private HQ" });
  const actor = f.game.actors.get(id);
  const page = f.records.hqPage(id);
  page.flags["pneuma-crewtools"].properties.improvements = [
    { id: "garage", name: "Garage", cost: 0, notes: "", date: "2078-02-06" },
    {
      id: "server",
      catalogId: "serverRoom",
      name: "Server Room",
      level: 2,
      cost: 0,
      notes: "",
      date: "2078-02-06",
    },
  ];
  const loadFacility = (name) => {
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync("src/" + name + ".ts", "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      { exports, require: (key) => (key === "./headquarters" ? f.api : {}) },
    );
    return exports;
  };
  const nomad = loadFacility("nomad-vehicles");
  const netrunner = loadFacility("netrunner-system");
  const check = (visible) => {
    assert.equal(
      f.api.getHeadquarters(false).headquarters.length,
      visible ? 1 : 0,
    );
    assert.equal(nomad.hasNomadGarage(), visible);
    assert.equal(
      netrunner.serverRoomAvailable(f.api.getHeadquarters(false)),
      visible,
    );
  };
  f.game.user.isGM = false;
  check(true);
  actor.ownership.default = 0;
  check(false);
  actor.ownership.player = 2;
  check(true);
  page.ownership.default = 0;
  check(false);
  page.ownership.player = 2;
  check(true);
  page.ownership.player = 1;
  check(false);
  f.game.user.id = "another-player";
  check(false);
  f.game.user.isGM = true;
  check(true);
});

test("HQ access selection overrides defaults on both documents and Everyone restores access", async () => {
  const f = fixture();
  f.game.users = [
    { id: "alex", name: "Alex", isGM: false },
    { id: "sam", name: "Sam", isGM: false },
    { id: "gm", name: "GM", isGM: true },
  ];
  const id = await f.api.saveHeadquarters({ name: "HQ" });
  const actor = f.game.actors.get(id),
    page = f.records.hqPage(id);
  actor.ownership.alex = 3;
  actor.ownership.gm = 3;
  await f.api.saveHeadquartersAccess(id, false, ["alex"]);
  assert.equal(f.api.headquartersAccess(id).summary, "Alex");
  assert.equal(actor.ownership.alex, 3);
  assert.equal(actor.ownership.gm, 3);
  for (const doc of [actor, page]) {
    assert.equal(doc.ownership.default, 0);
    assert.equal(doc.testUserPermission(f.game.users[0], "OBSERVER"), true);
    assert.equal(doc.testUserPermission(f.game.users[1], "OBSERVER"), false);
  }
  f.game.user = f.game.users[1];
  assert.equal(f.api.getHeadquarters(false).headquarters.length, 0);
  await assert.rejects(f.api.saveHeadquartersAccess(id, true, []));
  f.game.user = f.game.users[2];
  await f.api.saveHeadquartersAccess(id, true, []);
  for (const doc of [actor, page]) {
    assert.equal(doc.ownership.default, 2);
    assert.equal(Object.hasOwn(doc.ownership, "alex"), false);
    assert.equal(Object.hasOwn(doc.ownership, "sam"), false);
    assert.equal(doc.testUserPermission(f.game.users[0], "OBSERVER"), true);
    assert.equal(
      doc.testUserPermission({ id: "new-player", isGM: false }, "OBSERVER"),
      true,
    );
  }
  assert.equal(actor.ownership.gm, 3);
  assert.equal(f.api.headquartersAccess(id).summary, "Everyone");
  f.game.user = f.game.users[1];
  assert.equal(f.api.getHeadquarters(false).headquarters.length, 1);
  f.game.user = f.game.users[2];
  await f.api.saveHeadquartersAccess(id, false, []);
  assert.equal(f.api.headquartersAccess(id).summary, "GM only");
});

test("HQ access failed page write restores explicit and inherited actor permissions", async () => {
  const f = fixture();
  f.game.users = [{ id: "alex", name: "Alex", isGM: false }];
  const id = await f.api.saveHeadquarters({ name: "HQ" });
  const actor = f.game.actors.get(id),
    page = f.records.hqPage(id);
  const before = structuredClone(actor.ownership);
  page.update = async () => {
    throw Error("page failed");
  };
  await assert.rejects(
    f.api.saveHeadquartersAccess(id, false, []),
    /page failed/,
  );
  assert.deepEqual(actor.ownership, before);
  actor.ownership.alex = 3;
  const explicitBefore = structuredClone(actor.ownership);
  await assert.rejects(
    f.api.saveHeadquartersAccess(id, true, []),
    /page failed/,
  );
  assert.deepEqual(actor.ownership, explicitBefore);
  await assert.rejects(
    f.api.saveHeadquartersAccess(id, false, ["missing"]),
    /no longer exists/,
  );
});
