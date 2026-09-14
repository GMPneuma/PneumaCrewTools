import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(name, globals, deps = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("../src/" + name + ".ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      require: (k) => deps[k] ?? load(k.slice(2), globals, deps),
      structuredClone,
      console,
      ...globals,
    },
  );
  return exports;
}
function fixture() {
  let n = 0,
    total = 14,
    humanityTotal = 9,
    balance = 30,
    failSave = false,
    rolls = 0;
  const user = { id: "player", isGM: false, active: true },
    gm = { id: "gm", isGM: true, active: false };
  const role = {
    id: "med-role",
    name: "Medtech",
    type: "role",
    system: {
      rank: 4,
      mainRoleAbility: "Medicine",
      abilities: [
        { name: "Medical Tech Skill", rank: 3 },
        { name: "Surgery Skill", rank: 4 },
      ],
    },
    createRoll: (type, a, extra) => {
      assert.equal(type, "roleAbility");
      assert.equal(extra.rollSubType, "subRoleAbility");
      return {
        handleRollDialog: async () => true,
        roll: async () => {
          rolls++;
        },
        get resultTotal() {
          return total;
        },
      };
    },
  };
  const actor = {
    id: "doctor",
    name: "Doctor",
    type: "character",
    system: {
      wealth: { value: 5000, transactions: [] },
      derivedStats: { humanity: { value: 40, max: 45 } },
      stats: { emp: { value: 4 } },
    },
    items: [role],
    testUserPermission: (u) => u.id === user.id,
    update: async (data) => {
      for (const [key, value] of Object.entries(data)) {
        let obj = actor;
        const parts = key.split(".");
        for (const p of parts.slice(0, -1)) obj = obj[p];
        obj[parts.at(-1)] = structuredClone(value);
      }
    },
    createEmbeddedDocuments: async (_type, rows) =>
      rows.map((data) => {
        const item = {
          ...structuredClone(data),
          id: data._id,
          async update(changes) {
            this.system.amount = changes["system.amount"];
          },
        };
        actor.items.push(item);
        return item;
      }),
  };
  const patient = {
    id: "patient",
    name: "Patient",
    type: "character",
    testUserPermission: (u) => u.id === "patient-owner",
  };
  const game = {
    user,
    users: [user, gm, { id: "patient-owner", isGM: false }],
    actors: [actor, patient],
    settings: { get: () => [] },
  };
  game.actors.get = (id) => game.actors.find((a) => a.id === id);
  const flags = {},
    page = {
      text: { content: "" },
      getFlag: (_ns, key) => flags[key],
      update: async (data) => {
        for (const [key, value] of Object.entries(data)) {
          if (key.startsWith("flags.pneuma-crewtools."))
            flags[key.split(".").at(-1)] = structuredClone(value);
          else if (key === "text.content") page.text.content = value;
        }
      },
    };
  const makeItem = (type, name, system) => ({
    id: name,
    uuid: "Item." + name,
    documentName: "Item",
    type,
    name,
    system,
    testUserPermission: () => true,
    toObject: () => ({ name, type, system: structuredClone(system) }),
  });
  const injury = makeItem("criticalInjury", "Broken Arm", {
      treatment: { dvSurgery: 13 },
    }),
    drug = makeItem("drug", "Speedheal", {
      amount: 1,
      description: { value: "Native medicine" },
    });
  const messages = [];
  const globals = {
    ChatMessage: { create: async (data) => messages.push(data) },
    game,
    foundry: { utils: { randomID: () => String(++n) } },
    fromUuid: async (uuid) => [injury, drug].find((i) => i.uuid === uuid),
    Roll: class {
      constructor(formula) {
        assert.ok(["2d6", "4d6"].includes(formula));
      }
      async evaluate() {
        return { total: humanityTotal };
      }
    },
  };
  const system = load("medtech-system", globals);
  const med = load("medtech", globals, {
    "./constants": { MODULE_ID: "pneuma-crewtools" },
    "./actor-policy": { isActorExcluded: (id) => id === "excluded" },
    "./medtech-system": system,
  });
  const run = (action) =>
    med.processMedical(
      {
        actor,
        page,
        balance,
        date: "2078-02-06",
        save: async (m, days) => {
          if (failSave) throw Error("save failed");
          if (days > balance) throw Error("overspend");
          balance -= days;
          flags.activities = structuredClone(m.records);
          flags.medicalAttempt = null;
          page.text.content = med.medicalHtml(m);
        },
      },
      action,
    );
  return {
    game,
    messages,
    actor,
    patient,
    role,
    drug,
    injury,
    page,
    flags,
    med,
    run,
    state: () => med.readMedical(page),
    balance: () => balance,
    roll: (n) => {
      total = n;
    },
    rolls: () => rolls,
    money: (n) => {
      actor.system.wealth.value = n;
    },
    days: (n) => {
      balance = n;
    },
    fail: () => {
      failSave = true;
    },
    gain: (n) => {
      humanityTotal = n;
    },
  };
}
const courseDays = async (f, provider = false) => {
  for (let n = 0; n < 7; n++)
    await f.run({ kind: provider ? "providerDay" : "patientDay" });
};
test("paid patient therapy charges the selected cost at start and prompts a capped Humanity recovery after seven days", async () => {
  const f = fixture();
  await f.run({ kind: "patientStart", type: "standard" });
  assert.equal(f.actor.system.wealth.value, 4500);
  await assert.rejects(f.run({ kind: "patientComplete" }), /seven/);
  await courseDays(f);
  await f.run({ kind: "patientComplete" });
  assert.equal(f.balance(), 23);
  assert.equal(f.actor.system.derivedStats.humanity.value, 45);
  assert.equal(f.actor.system.stats.emp.value, 4);
  assert.equal(f.state().patient, undefined);
  assert.equal(f.actor.system.wealth.transactions.length, 1);
  await assert.rejects(f.run({ kind: "patientComplete" }), /seven/);
});
test("all therapy costs, Medical Tech DVs, and Humanity formulas match the supplied table", () => {
  const f = fixture();
  assert.deepEqual(
    Array.from(f.med.THERAPIES, (t) => [
      t.id,
      t.cost,
      t.materials,
      t.dv,
      t.formula,
    ]),
    [
      ["addiction", 1000, 500, 15, ""],
      ["standard", 500, 100, 15, "2d6"],
      ["extreme", 1000, 500, 17, "4d6"],
    ],
  );
});
test("PC patient therapy is free, needs success confirmation, and can record a failed week without recovery", async () => {
  const f = fixture();
  await f.run({ kind: "patientStart", type: "extreme", pc: true });
  assert.equal(f.actor.system.wealth.value, 5000);
  await courseDays(f);
  await assert.rejects(f.run({ kind: "patientComplete" }), /Confirm/);
  await f.run({ kind: "patientFailed" });
  assert.equal(f.state().patient, undefined);
  assert.equal(f.actor.system.derivedStats.humanity.value, 40);
  assert.equal(f.balance(), 23);
});
test("provider failure consumes the week and material cost without changing the other Actor", async () => {
  const f = fixture();
  await f.run({ kind: "providerStart", type: "extreme", targetId: "patient" });
  assert.equal(f.actor.system.wealth.value, 4500);
  await courseDays(f, true);
  f.roll(17);
  await f.run({ kind: "providerComplete" });
  assert.equal(f.state().provider, undefined);
  const record = f.state().records.find((r) => r.kind === "provider");
  assert.equal(record.status, "failed");
  assert.equal(record.details.targetId, "patient");
  assert.equal(record.events.at(-1).data.result.check.dv, 17);
  assert.equal(record.events[0].data.resources[0].amount, -500);

  assert.equal(f.balance(), 23);
  assert.match(
    f.state().history.at(-1).text,
    /failed; week and materials lost/,
  );
  assert.equal(f.actor.system.derivedStats.humanity.value, 40);
});
test("addiction therapy records the named addiction and one-year consequence without rolling Humanity", async () => {
  const f = fixture();
  await assert.rejects(
    f.run({ kind: "patientStart", type: "addiction" }),
    /Name the addiction/,
  );
  await f.run({
    kind: "patientStart",
    type: "addiction",
    addiction: "Synthcoke",
  });
  await courseDays(f);
  await f.run({ kind: "patientComplete" });
  assert.equal(f.actor.system.wealth.value, 4000);
  assert.match(f.state().history.at(-1).text, /Synthcoke.*one year/);
  assert.equal(f.actor.system.derivedStats.humanity.value, 40);
});
test("pharma retries cost hours, charge 200 once, and immediately add Medical Tech Skill doses on success", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  const task = f.state().day.tasks[0];
  f.roll(13);
  await f.run({ kind: "taskRoll", taskId: task.id });
  assert.equal(f.state().day.hours, 1);
  assert.equal(f.actor.system.wealth.value, 4800);
  assert.equal(f.actor.items.length, 1);
  f.roll(14);
  await f.run({ kind: "taskRoll", taskId: task.id });
  assert.equal(f.state().day.hours, 2);
  assert.equal(f.actor.system.wealth.value, 4800);
  assert.equal(f.actor.items.find((i) => i.type === "drug").system.amount, 3);
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId: task.id }),
    /unfinished/,
  );
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 29);
  assert.equal(f.state().day, undefined);
  assert.equal(f.actor.items.filter((i) => i.type === "drug").length, 1);
  assert.match(f.state().history.at(-1).text, /14 hours forfeited/);
});
test("Surgery uses the native injury DV and four hours for every attempt", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "surgery", uuid: f.injury.uuid });
  const task = f.state().day.tasks[0];
  f.roll(13);
  await f.run({ kind: "taskRoll", taskId: task.id });
  assert.equal(f.state().day.hours, 4);
  f.roll(14);
  await f.run({ kind: "taskRoll", taskId: task.id });
  assert.equal(f.state().day.hours, 8);
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 29);
  assert.equal(f.actor.system.wealth.value, 5000);
});
test("failed attempts cannot exceed sixteen hours and ending an exhausted day discards unfinished work", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  const task = f.state().day.tasks[0];
  f.roll(1);
  for (let n = 0; n < 16; n++)
    await f.run({ kind: "taskRoll", taskId: task.id });
  assert.equal(f.state().day.hours, 16);
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId: task.id }),
    /16 hours/,
  );
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 29);
  assert.equal(f.state().day, undefined);
  assert.equal(f.actor.system.wealth.value, 4800);
  assert.equal(f.actor.items.filter((i) => i.type === "drug").length, 0);
});
test("unattempted tasks can be removed, attempted work cannot be erased, and a workday reserves one available day", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  let task = f.state().day.tasks[0];
  await f.run({ kind: "taskRemove", taskId: task.id });
  assert.equal(f.state().day, undefined);
  await f.run({ kind: "taskAdd", taskKind: "surgery", uuid: f.injury.uuid });
  task = f.state().day.tasks[0];
  await f.run({ kind: "taskRoll", taskId: task.id });
  assert.equal(f.med.reservedMedicalDay(f.page), 1);
  await assert.rejects(
    f.run({ kind: "taskRemove", taskId: task.id }),
    /unattempted/,
  );
});
test("missing funds, days, role abilities, excluded targets and self therapy are rejected before payment", async () => {
  const f = fixture();
  f.money(199);
  await assert.rejects(
    f.run({ kind: "patientStart", type: "standard" }),
    /Not enough money/,
  );
  await assert.rejects(
    f.run({ kind: "providerStart", type: "standard", targetId: "doctor" }),
    /another player/,
  );
  f.days(0);
  await assert.rejects(
    f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid }),
    /One downtime day/,
  );
  f.days(1);
  f.role.system.rank = 0;
  await assert.rejects(
    f.run({ kind: "taskAdd", taskKind: "surgery", uuid: f.injury.uuid }),
    /Medtech/,
  );
});
test("a lost delivery save retains a readable attempt and cannot create more doses on retry", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  const task = f.state().day.tasks[0];
  f.fail();
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId: task.id }),
    /save failed/,
  );
  assert.equal(f.actor.items.filter((i) => i.type === "drug").length, 1);
  assert.ok(f.flags.medicalAttempt);
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId: task.id }),
    /interrupted/,
  );
  assert.equal(f.actor.items.filter((i) => i.type === "drug").length, 1);
  assert.equal(f.rolls(), 1);
});
test("a failed provider result save blocks rerolling the same paid week", async () => {
  const f = fixture();
  await f.run({ kind: "providerStart", type: "standard", targetId: "patient" });
  await courseDays(f, true);
  f.fail();
  await assert.rejects(f.run({ kind: "providerComplete" }), /save failed/);
  await assert.rejects(f.run({ kind: "providerComplete" }), /interrupted/);
  assert.equal(f.rolls(), 1);
});

function fullWeeks(f) {
  f.game.settings.get = (_ns, key) => key === "requireFullDowntimeWeek";
}
test("weekly therapy rejects fewer than seven free days before charging money", async () => {
  const f = fixture();
  fullWeeks(f);
  f.days(6);
  for (const action of [
    { kind: "patientStart", type: "standard" },
    { kind: "patientStart", type: "standard", pc: true },
    { kind: "providerStart", type: "standard", targetId: "patient" },
  ])
    await assert.rejects(f.run(action), /Seven available/);
  assert.equal(f.balance(), 6);
  assert.equal(f.actor.system.wealth.value, 5000);
  assert.equal(f.state().records.length, 0);
  assert.equal(f.med.medicalView(f.actor, f.page, 6).canStartPatient, false);
  assert.equal(f.med.medicalView(f.actor, f.page, 6).canStartProvider, false);
});
test("weekly paid and PC patient therapy debit exactly seven days at start", async () => {
  for (const pc of [false, true]) {
    const f = fixture();
    fullWeeks(f);
    f.days(8);
    await f.run({ kind: "patientStart", type: "standard", pc });
    assert.equal(f.balance(), 1);
    assert.equal(f.state().patient.days, 7);
    assert.equal(f.actor.system.wealth.value, pc ? 5000 : 4500);
    await assert.rejects(f.run({ kind: "patientDay" }), /unfinished/);
    await f.run({ kind: "patientComplete", pcSuccess: true });
    assert.equal(f.balance(), 1);
    assert.equal(f.state().patient, undefined);
    assert.equal(f.actor.system.derivedStats.humanity.value, 45);
  }
});
test("weekly provider therapy pays materials and loses the spent week on a failed check", async () => {
  const f = fixture();
  fullWeeks(f);
  f.days(7);
  await f.run({ kind: "providerStart", type: "standard", targetId: "patient" });
  assert.equal(f.balance(), 0);
  assert.equal(f.state().provider.days, 7);
  assert.equal(f.actor.system.wealth.value, 4900);
  await f.run({ kind: "providerComplete" });
  assert.equal(f.balance(), 0);
  assert.equal(f.state().provider, undefined);
  assert.equal(f.state().records.at(-1).status, "failed");
});
test("a reserved Medtech workday is not available for weekly therapy", async () => {
  const f = fixture();
  f.days(7);
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  await f.run({ kind: "taskRoll", taskId: f.state().day.tasks[0].id });
  fullWeeks(f);
  const money = f.actor.system.wealth.value;
  await assert.rejects(
    f.run({ kind: "patientStart", type: "standard" }),
    /Seven available/,
  );
  assert.equal(f.balance(), 7);
  assert.equal(f.actor.system.wealth.value, money);
  assert.equal(f.med.medicalView(f.actor, f.page, 7).canStartPatient, false);
});

test("native roll construction errors do not lock the medical workday", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "surgery", uuid: f.injury.uuid });
  const taskId = f.state().day.tasks[0].id;
  const createRoll = f.role.createRoll;
  f.role.createRoll = () => undefined;
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId }),
    /could not be created/,
  );
  assert.equal(f.flags.medicalAttempt, null);
  assert.equal(f.state().day.hours, 0);
  f.role.createRoll = createRoll;
  await f.run({ kind: "taskRoll", taskId });
  assert.equal(f.state().day.hours, 4);
  assert.equal(f.state().day.tasks[0].success, true);
});

test("a roll-only interruption can be explicitly cleared and retried without resource changes", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "surgery", uuid: f.injury.uuid });
  const taskId = f.state().day.tasks[0].id;
  f.flags.medicalAttempt = { action: "taskRoll", stateBefore: f.state() };
  assert.equal(
    f.med.medicalView(f.actor, f.page, 30).canClearMedicalRoll,
    true,
  );
  await f.run({ kind: "clearRoll" });
  assert.equal(f.flags.medicalAttempt, null);
  assert.equal(f.state().day.hours, 0);
  await f.run({ kind: "taskRoll", taskId });
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 29);
  assert.equal(f.state().day, undefined);
});

test("medical recovery never clears a native resource attempt or bypasses ownership", async () => {
  const f = fixture();
  f.flags.medicalAttempt = {
    update: { "system.wealth.value": 4800 },
    state: {},
  };
  assert.equal(
    f.med.medicalView(f.actor, f.page, 30).canClearMedicalRoll,
    false,
  );
  await assert.rejects(f.run({ kind: "clearRoll" }), /native resources/);
  assert.ok(f.flags.medicalAttempt);
  f.flags.medicalAttempt = { stateBefore: {} };
  f.game.user = { id: "stranger", isGM: false };
  await assert.rejects(f.run({ kind: "clearRoll" }), /owned character/);
  assert.ok(f.flags.medicalAttempt);
});

test("cancelling the pharma modifier dialog spends no money, hours or days and leaves no lock", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  const taskId = f.state().day.tasks[0].id;
  const before = JSON.stringify(f.flags);
  f.role.createRoll = () => ({
    handleRollDialog: async () => false,
    roll: async () => {
      throw Error("must not roll");
    },
  });
  await f.run({ kind: "taskRoll", taskId });
  assert.equal(JSON.stringify(f.flags), before);
  assert.equal(f.actor.system.wealth.value, 5000);
  assert.equal(f.balance(), 30);
  assert.equal(f.state().day.hours, 0);
});

test("medical cards show the committed check, result and inventory outcome publicly by default", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  await f.run({ kind: "taskRoll", taskId: f.state().day.tasks[0].id });
  assert.equal(f.messages.length, 1);
  const card = f.messages[0];
  assert.match(card.content, /crewtools-roll-card/);
  assert.match(card.content, /SUCCESS/);
  assert.match(card.content, /vs DV 13/);
  assert.match(card.content, /3 doses added to inventory/);
  assert.deepEqual(Array.from(card.whisper), []);
});

test("all eight pharmaceuticals remain available without compendium entries and basic doses can be made", async () => {
  const f = fixture();
  await f.med.loadMedicalCatalog();
  const drugs = f.med.medicalView(f.actor, f.page, 30).pharma;
  assert.deepEqual(
    Array.from(drugs, (d) => d.name),
    [
      "Antibiotic",
      "Rapiddetox",
      "Speedheal",
      "Stim",
      "Surge",
      "Radaway",
      "Sedative",
      "Veritas",
    ],
  );
  await f.run({
    kind: "taskAdd",
    taskKind: "pharma",
    uuid: drugs.find((d) => d.name === "Veritas").uuid,
  });
  await f.run({ kind: "taskRoll", taskId: f.state().day.tasks[0].id });
  const item = f.actor.items.find((i) => i.name === "Veritas");
  assert.equal(item.type, "drug");
  assert.equal(item.system.amount, 3);
});

test("catalog preserves native pharma data and refreshes when Items are added", async () => {
  const f = fixture();
  f.game.items = [f.drug, f.injury];
  await f.med.loadMedicalCatalog();
  let view = f.med.medicalView(f.actor, f.page, 30);
  assert.equal(
    view.pharma.find((d) => d.name === "Speedheal").uuid,
    f.drug.uuid,
  );
  assert.equal(view.injuries[0].uuid, f.injury.uuid);
  f.game.items = [{ ...f.drug, name: " Veritas ", uuid: "Item.veritas" }];
  await f.med.loadMedicalCatalog();
  view = f.med.medicalView(f.actor, f.page, 30);
  assert.equal(view.pharma.length, 8);
  assert.equal(
    view.pharma.find((d) => d.name === "Veritas").uuid,
    "Item.veritas",
  );
});

test("Medtech can end a workday with failed and unrolled tasks", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  await f.run({ kind: "taskAdd", taskKind: "surgery", uuid: f.injury.uuid });
  f.roll(1);
  await f.run({ kind: "taskRoll", taskId: f.state().day.tasks[0].id });
  assert.equal(
    f.med.medicalView(f.actor, f.page, f.balance()).canFinishMedicalDay,
    true,
  );
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 29);
  assert.equal(f.state().day, undefined);
  assert.equal(f.actor.system.wealth.value, 4800);
  assert.equal(f.actor.items.filter((i) => i.type === "drug").length, 0);
  assert.match(
    f.state().history.at(-1).text,
    /15 hours forfeited.*unfinished, discarded/,
  );
});

test("Medtech can spend a day with one unrolled task or an empty list, but needs available downtime", async () => {
  const f = fixture();
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  assert.equal(
    f.med.medicalView(f.actor, f.page, f.balance()).canFinishMedicalDay,
    true,
  );
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 29);
  assert.equal(f.state().day, undefined);
  assert.equal(f.actor.system.wealth.value, 5000);
  assert.match(f.state().history.at(-1).text, /16 hours forfeited/);
  await f.run({ kind: "finishDay" });
  assert.equal(f.balance(), 28);
  f.days(0);
  assert.equal(
    f.med.medicalView(f.actor, f.page, 0).canFinishMedicalDay,
    false,
  );
  await assert.rejects(f.run({ kind: "finishDay" }), /downtime/);
});

test("patient and provider therapy fill only the remaining days and reject insufficient balance", async () => {
  for (const role of ["patient", "provider"]) {
    const f = fixture();
    await f.run({
      kind: role + "Start",
      type: "standard",
      targetId: "patient",
    });
    await f.run({ kind: role + "Day" });
    await f.run({ kind: role + "Day" });
    f.days(4);
    let view = f.med.medicalView(f.actor, f.page, f.balance())[role];
    assert.equal(view.daysNeeded, 5);
    assert.equal(view.canFill, false);
    await assert.rejects(
      f.run({ kind: role + "Day", fillWeek: true }),
      /downtime/,
    );
    assert.equal(f.state()[role].days, 2);
    f.days(5);
    view = f.med.medicalView(f.actor, f.page, f.balance())[role];
    assert.equal(view.canFill, true);
    await f.run({ kind: role + "Day", fillWeek: true });
    assert.equal(f.balance(), 0);
    assert.equal(f.state()[role].days, 7);
    await assert.rejects(
      f.run({ kind: role + "Day", fillWeek: true }),
      /unfinished/,
    );
  }
});

test("medical catalog shares loads and reuses pack documents until invalidated", async () => {
  const f = fixture();
  let reads = 0;
  f.game.packs = [
    {
      documentName: "Item",
      collection: "system.drugs",
      getDocuments: async () => {
        reads++;
        return [f.drug];
      },
    },
  ];
  await Promise.all([f.med.loadMedicalCatalog(), f.med.loadMedicalCatalog()]);
  await f.med.loadMedicalCatalog();
  assert.equal(reads, 1);
  f.med.invalidateMedicalCatalog();
  await f.med.loadMedicalCatalog();
  assert.equal(reads, 1);
  f.med.invalidateMedicalCatalog(true);
  await f.med.loadMedicalCatalog();
  assert.equal(reads, 2);
});

test("Cancelling patient or provider therapy forfeits paid costs and allocated days", async () => {
  for (const provider of [false, true]) {
    for (const weekly of [false, true]) {
      const f = fixture();
      if (weekly) fullWeeks(f);
      const key = provider ? "provider" : "patient";
      await f.run({
        kind: key + "Start",
        type: "standard",
        targetId: f.patient.id,
      });
      assert.equal(f.actor.system.wealth.value, provider ? 4900 : 4500);
      if (!weekly) await f.run({ kind: key + "Day" });
      const balance = f.balance();
      const money = f.actor.system.wealth.value;
      await f.run({ kind: key + "Cancel" });
      assert.equal(f.state()[key], undefined);
      assert.equal(f.balance(), balance);
      assert.equal(f.actor.system.wealth.value, money);
      assert.equal(
        f.state().records.find((r) => r.kind === key).status,
        "cancelled",
      );
      await assert.rejects(
        f.run({ kind: key + "Cancel" }),
        /No active therapy/,
      );
      assert.equal(f.balance(), balance);
      await f.run({
        kind: key + "Start",
        type: "standard",
        targetId: f.patient.id,
      });
      assert.equal(f.actor.system.wealth.value, money - (provider ? 100 : 500));
    }
  }
});

test("Crafted pharma increments only the first matching stack and preserves item data", async () => {
  const f = fixture();
  const craft = async () => {
    await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
    const task = f.state().day.tasks.at(-1);
    await f.run({ kind: "taskRoll", taskId: task.id });
  };
  await craft();
  const first = f.actor.items.find((i) => i.type === "drug");
  const description = structuredClone(first.system.description);
  const second = {
    id: "second",
    type: "drug",
    name: first.name,
    system: { amount: 8 },
  };
  const other = {
    id: "other",
    type: "drug",
    name: "Antibiotic",
    system: { amount: 4 },
  };
  f.actor.items.push(second, other);
  first.name = " SPEEDHEAL ";
  await craft();
  assert.equal(first.system.amount, 6);
  assert.equal(second.system.amount, 8);
  assert.equal(other.system.amount, 4);
  assert.deepEqual(first.system.description, description);
  assert.equal(f.actor.items.filter((i) => i.type === "drug").length, 3);
  first.system.amount = 0;
  await craft();
  assert.equal(first.system.amount, 3);
  await f.run({ kind: "taskAdd", taskKind: "pharma", uuid: f.drug.uuid });
  const task = f.state().day.tasks.at(-1);
  f.fail();
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId: task.id }),
    /save failed/,
  );
  assert.equal(first.system.amount, 6);
  await assert.rejects(
    f.run({ kind: "taskRoll", taskId: task.id }),
    /interrupted/,
  );
  assert.equal(first.system.amount, 6);
});
