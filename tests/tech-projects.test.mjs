import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
  let id = 0,
    rollTotal = 25,
    rollCount = 0,
    attempt = null,
    failSave = false;
  const settings = new Map([
    ["techCraftingMonthDays", 28],
    ["techMultipleWithoutWorkshop", false],
  ]);
  const registered = new Map(),
    uuids = new Map(),
    messages = [];
  const gm = { id: "gm", isGM: true, active: true },
    player = { id: "player", isGM: false, active: true };
  const game = {
    user: gm,
    users: [gm, player],
    actors: [],
    folders: [],
    settings: {
      get: (_ns, k) => settings.get(k),
      register: (_ns, k, v) => registered.set(k, v),
      registerMenu: (_ns, k, v) => registered.set(k, v),
      set: async (_ns, k, v) => settings.set(k, v),
    },
  };
  const makeItem = (data, parent) => {
    const raw = structuredClone(data);
    raw._id ??= "i" + ++id;
    const item = {
      id: raw._id,
      name: raw.name,
      type: raw.type,
      system: raw.system ?? {},
      parent,
      documentName: "Item",
      uuid: parent
        ? "Actor." + parent.id + ".Item." + raw._id
        : "Item." + raw._id,
      toObject: () => structuredClone(raw),
      toCompendium: () => structuredClone(raw),
      testUserPermission: (u) => u.isGM || u.id === "player",
      update: async (update) => {
        for (const [key, value] of Object.entries(update)) {
          let node = item;
          const parts = key.split(".");
          for (const part of parts.slice(0, -1)) node = node[part] ??= {};
          node[parts.at(-1)] = value;
        }
        if ("system.amount" in update) {
          raw.system.amount = update["system.amount"];
          item.system.amount = update["system.amount"];
        }
      },
    };
    uuids.set(item.uuid, item);
    return item;
  };
  const makeActor = (data) => {
    const actor = {
      ...data,
      id: data.id ?? "a" + ++id,
      documentName: "Actor",
      items: [],
      getFlag: (ns, k) => data.flags?.[ns]?.[k],
      testUserPermission: (u) => u.id === "player",
      createEmbeddedDocuments: async (_type, rows) =>
        rows.map((d) => {
          const i = makeItem(d, actor);
          actor.items.push(i);
          return i;
        }),
      deleteEmbeddedDocuments: async (_type, ids) => {
        for (const i of actor.items.filter((i) => ids.includes(i.id)))
          uuids.delete(i.uuid);
        actor.items = actor.items.filter((i) => !ids.includes(i.id));
      },
    };
    game.actors.push(actor);
    return actor;
  };
  const actor = makeActor({ id: "hero", name: "Tech", type: "character" });
  actor.items.push({
    id: "role",
    name: "Tech",
    type: "role",
    system: {
      rank: 4,
      mainRoleAbility: "Maker",
      abilities: [
        { name: "Fabrication Expertise", rank: 3 },
        { name: "Upgrade Expertise", rank: 2 },
        { name: "Invention Expertise", rank: 1 },
      ],
    },
  });
  let addedMods = [];
  actor.items.push({
    id: "skill",
    name: "Basic Tech",
    type: "skill",
    system: { stat: "tech", level: 6 },
    createRoll: (type, a) => {
      assert.equal(type, "skill");
      assert.equal(a.id, "hero");
      return {
        addMod: (m) => {
          addedMods = m;
        },
        handleRollDialog: async () => true,
        roll: async () => {
          rollCount++;
        },
        get resultTotal() {
          return rollTotal;
        },
      };
    },
  });
  const globals = {
    FormApplication: class {},
    game,
    console,
    structuredClone,
    fromUuid: async (u) => uuids.get(u),
    foundry: { utils: { randomID: () => ("id" + ++id).padEnd(16, "x") } },
    Actor: { create: async (d) => makeActor(d) },
    Item: {
      deleteDocuments: async (ids) => {
        for (const [uuid, i] of uuids)
          if (ids.includes(i.id)) uuids.delete(uuid);
      },
    },
    Folder: {
      create: async (d) => {
        const f = {
          ...d,
          id: "f" + ++id,
          folder: game.folders.find((f) => f.id === d.folder) ?? null,
        };
        game.folders.push(f);
        return f;
      },
    },
    ChatMessage: { create: async (d) => messages.push(d) },
  };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const code = ts.transpileModule(
      fs.readFileSync("src/" + name + ".ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    vm.runInNewContext(code, {
      ...globals,
      exports,
      require: (p) => load(p.slice(2)),
    });
    return exports;
  }
  const model = load("downtime-model"),
    tech = load("tech-project-model"),
    service = load("tech-projects");
  let state = {
    version: 1,
    period: 1,
    accounts: [{ actorId: "hero", name: "Tech", characterJournalId: "j" }],
    events: [
      {
        id: "award",
        actorId: "hero",
        kind: "award",
        days: 100,
        period: 1,
        date: "2078-01-01",
        reason: "Gig",
        payoutId: "p",
      },
    ],
  };
  async function run(kind, input, projectId, slots = 1, workshop = false) {
    if (attempt) throw Error("GM review required");
    const event = {
      id: "e" + ++id,
      actorId: "hero",
      kind,
      days: ["techDay", "techWorkshop"].includes(kind) ? 1 : 0,
      period: state.period,
      date: "2078-01-01",
      reason: kind,
      projectId,
      requestId: "r" + id,
    };
    await service.processTechRequest({
      state: structuredClone(state),
      event,
      actor,
      input,
      requester: player,
      slots,
      workshop,
      save: async (s) => {
        if (failSave) throw Error("save failed");
        model.validateDowntime(s);
        state = structuredClone(s);
      },
      attempt: async (d) => {
        attempt = d;
      },
    });
    return event.id;
  }
  const invention = (category = "expensive", price = 500, slot = 0) => ({
    mode: "invention",
    slot,
    name: "New widget",
    description: "A useful <widget>",
    category,
    price,
    skillId: "skill",
  });
  return {
    game,
    actor,
    gm,
    player,
    settings,
    registered,
    model,
    tech,
    service,
    run,
    invention,
    makeActor,
    makeItem,
    uuids,
    messages,
    state: () => state,
    projects: () => tech.techProjects(state, "hero"),
    attempt: () => attempt,
    rolls: () => rollCount,
    mods: () => addedMods,
    roll: (n) => {
      rollTotal = n;
    },
    fail: () => {
      failSave = true;
    },
  };
}
test("TECH costs enforce Premium+, 28-day default month and Super Luxury ceiling", () => {
  const f = fixture();
  for (const [c, p, d, dv] of [
    ["premium", 100, 1, 17],
    ["expensive", 500, 7, 21],
    ["veryExpensive", 1000, 14, 24],
    ["luxury", 5000, 28, 29],
    ["superLuxury", 10000, 28, 29],
    ["superLuxury", 10001, 56, 29],
  ])
    assert.deepEqual(
      JSON.parse(JSON.stringify(f.tech.projectSchedule(c, p, 28))),
      { required: d, dv, monthDays: 28 },
    );
  assert.equal(f.tech.projectSchedule("superLuxury", 25000, 30).required, 90);
  assert.throws(() => f.tech.projectSchedule("costly", 50, 28), /Premium/);
  assert.throws(() => f.tech.projectSchedule("luxury", 5000, 0), /28–31/);
  f.service.registerTechSettings();
  assert.equal(f.registered.get("techCraftingMonthDays").default, 28);
  assert.equal(f.registered.get("techMultipleWithoutWorkshop").default, false);
  assert.equal(f.service.techSlotLimit(false), 1);
  assert.equal(f.service.techSlotLimit(true), 2);
  f.settings.set("techMultipleWithoutWorkshop", true);
  assert.equal(f.service.techSlotLimit(false), 3);
});
test("TECH slots reject non-Tech, occupied and locked slots and retain start duration", async () => {
  const f = fixture();
  await assert.rejects(
    f.run("techStart", f.invention("luxury", 5000, 1)),
    /enabled/,
  );
  const id = await f.run("techStart", f.invention("luxury", 5000));
  f.settings.set("techCraftingMonthDays", 30);
  assert.equal(f.projects()[0].required, 28);
  await assert.rejects(f.run("techStart", f.invention()), /occupied/);
  await f.run("techStart", f.invention("premium", 100, 1), undefined, 3);
  assert.equal(f.projects().filter((p) => p.active).length, 2);
  await assert.rejects(
    f.run("techDay", undefined, f.projects()[1].id, 1),
    /Workshop/,
  );
  f.actor.items = f.actor.items.filter((i) => i.type !== "role");
  await assert.rejects(f.run("techDay", undefined, id), /TECH role/);
});
test("successful early check completes only at full days and creates one invention", async () => {
  const f = fixture();
  const id = await f.run("techStart", f.invention());
  await assert.rejects(f.run("techRoll", undefined, id), /half/);
  for (let n = 0; n < 3; n++) await f.run("techDay", undefined, id);
  await f.run("techRoll", undefined, id);
  assert.equal(f.mods()[0].value, 1);
  assert.equal(f.projects()[0].success, true);
  assert.equal(f.projects()[0].active, true);
  assert.equal(f.actor.items.filter((i) => i.type === "gear").length, 0);
  for (let n = 0; n < 4; n++) await f.run("techDay", undefined, id);
  assert.equal(f.projects()[0].active, false);
  const item = f.actor.items.find((i) => i.type === "gear");
  assert.equal(item.name, "New widget");
  assert.match(item.system.description.value, /&lt;widget&gt;/);
  assert.equal(f.model.downtimeBalance(f.state(), "hero"), 93);
  await assert.rejects(f.run("techDay", undefined, id), /Active TECH/);
  assert.equal(f.actor.items.filter((i) => i.type === "gear").length, 1);
});
test("failure burns floored half and requires new allocation before retry even with spare progress", async () => {
  const f = fixture();
  const id = await f.run("techStart", f.invention());
  for (let n = 0; n < 7; n++) await f.run("techDay", undefined, id);
  f.roll(21);
  await f.run("techRoll", undefined, id);
  assert.equal(f.projects()[0].progress, 4);
  assert.equal(f.projects()[0].burned, 3);
  await assert.rejects(f.run("techRoll", undefined, id), /half/);
  for (let n = 0; n < 3; n++) await f.run("techDay", undefined, id);
  f.roll(22);
  await f.run("techRoll", undefined, id);
  assert.equal(f.projects()[0].active, false);
  assert.equal(f.model.downtimeBalance(f.state(), "hero"), 90);
});
test("Premium permits zero-day initial check per floor rule, then needs one allocated day", async () => {
  const f = fixture();
  const id = await f.run("techStart", f.invention("premium", 100));
  f.roll(17);
  await f.run("techRoll", undefined, id);
  assert.equal(f.projects()[0].burned, 0);
  f.roll(18);
  await f.run("techRoll", undefined, id);
  assert.equal(f.projects()[0].active, true);
  await f.run("techDay", undefined, id);
  assert.equal(f.projects()[0].active, false);
});
test("fabrication copies one item, preserves original and uses source price over request price", async () => {
  const f = fixture();
  await f.service.storageActor(f.actor);
  f.gm.active = false;
  f.game.user = f.player;
  const item = f.makeItem(
    {
      name: "Pistol",
      type: "weapon",
      system: { price: { market: 500 }, amount: 10, damage: "2d6" },
    },
    undefined,
  );
  const id = await f.run("techStart", {
    ...f.invention("premium", 100),
    mode: "fabricate",
    sourceUuid: item.uuid,
  });
  assert.equal(f.projects()[0].required, 7);
  for (let n = 0; n < 7; n++) await f.run("techDay", undefined, id);
  await f.run("techRoll", undefined, id);
  assert.equal(f.uuids.has(item.uuid), true);
  const made = f.actor.items.find((i) => i.type === "weapon");
  assert.equal(made.system.amount, 1);
  assert.equal(made.system.damage, "2d6");
});
test("upgrade moves original into module container offline and returns it with notes only", async () => {
  const f = fixture();
  await f.service.storageActor(f.actor);
  f.gm.active = false;
  f.game.user = f.player;
  const actorCount = f.game.actors.length;
  const other = f.makeActor({ name: "Storage", type: "container" });
  const item = f.makeItem(
    {
      name: "Pistol",
      type: "weapon",
      system: {
        price: { market: 100 },
        amount: 1,
        damage: "2d6",
        description: { value: "Original" },
      },
    },
    other,
  );
  other.items.push(item);
  const id = await f.run("techStart", {
    ...f.invention("premium", 100),
    mode: "upgrade",
    sourceUuid: item.uuid,
    description: "Improved grip",
  });
  assert.equal(other.items.length, 0);
  assert.equal(f.game.actors.length, actorCount + 1);
  const p = f.projects()[0],
    storage = f.game.actors.find((a) => a.id === p.storageActorId);
  assert.equal(storage.items.length, 1);
  assert.equal(storage.ownership.player, 3);
  assert.equal(
    f.game.folders.find((x) => x.id === storage.folder).name,
    "CrewTools",
  );
  await f.run("techRoll", undefined, id);
  await f.run("techDay", undefined, id);
  assert.equal(storage.items.length, 0);
  const done = f.actor.items.find((i) => i.type === "weapon");
  assert.equal(done.system.damage, "2d6");
  assert.match(done.system.description.value, /Improved grip/);
  assert.equal(f.attempt(), null);
});
test("upgrade splits a stack and cancellation returns one unmodified item", async () => {
  const f = fixture();
  const item = f.makeItem(
    {
      name: "Gadget",
      type: "gear",
      system: {
        price: { market: 100 },
        amount: 3,
        description: { value: "Original" },
      },
    },
    f.actor,
  );
  f.actor.items.push(item);
  const id = await f.run("techStart", {
    ...f.invention("premium", 100),
    mode: "upgrade",
    sourceUuid: item.uuid,
    description: "pending changes",
  });
  assert.equal(item.system.amount, 2);
  await f.run("techCancel", undefined, id);
  assert.equal(f.actor.items.filter((i) => i.type === "gear").length, 2);
  assert.equal(
    f.actor.items
      .filter((i) => i.type === "gear")
      .reduce((n, i) => n + i.system.amount, 0),
    3,
  );
  assert.equal(f.projects()[0].active, false);
});
test("failed Item delivery save leaves an auditable guard and prevents repeat delivery", async () => {
  const f = fixture();
  const id = await f.run("techStart", f.invention("premium", 100));
  await f.run("techRoll", undefined, id);
  f.fail();
  await assert.rejects(f.run("techDay", undefined, id), /save failed/);
  assert.equal(f.actor.items.filter((i) => i.type === "gear").length, 1);
  assert.equal(f.attempt().action, "Deliver project item");
  await assert.rejects(f.run("techDay", undefined, id), /GM review/);
  assert.equal(f.actor.items.filter((i) => i.type === "gear").length, 1);
});
test("unauthorized sources, compendium upgrades and sub-Premium items are rejected", async () => {
  const f = fixture();
  const item = f.makeItem({
    name: "Item",
    type: "gear",
    system: { price: { market: 100 } },
  });
  item.testUserPermission = () => false;
  await assert.rejects(
    f.run("techStart", {
      ...f.invention(),
      mode: "upgrade",
      sourceUuid: item.uuid,
    }),
    /permission/,
  );
  item.testUserPermission = () => true;
  item.pack = "pack";
  await assert.rejects(
    f.run("techStart", {
      ...f.invention(),
      mode: "upgrade",
      sourceUuid: item.uuid,
    }),
    /compendium/,
  );
  item.pack = undefined;
  item.system.price.market = 50;
  await assert.rejects(
    f.run("techStart", {
      ...f.invention(),
      mode: "fabricate",
      sourceUuid: item.uuid,
    }),
    /Premium/,
  );
});

test("TECH roll cancellation preserves project progress and a confirmed native dialog includes modifiers", async () => {
  const f = fixture();
  const id = await f.run("techStart", f.invention("premium", 100));
  const before = JSON.stringify(f.state());
  let accepted = false,
    total = 0;
  f.actor.items.find((i) => i.id === "skill").createRoll = () => ({
    addMod: (mods) => {
      total = mods[0].value;
    },
    handleRollDialog: async (_event, actor, item) => {
      assert.equal(actor, f.actor);
      assert.equal(item.id, "skill");
      total += 20;
      return accepted;
    },
    roll: async () => {
      assert.equal(accepted, true);
    },
    get resultTotal() {
      return total;
    },
  });
  await f.run("techRoll", undefined, id);
  assert.equal(JSON.stringify(f.state()), before);
  accepted = true;
  await f.run("techRoll", undefined, id);
  assert.equal(f.projects()[0].success, true);
});

test("failed TECH check card shows outcome and burned days without internal Actor IDs", async () => {
  const f = fixture();
  const id = await f.run("techStart", f.invention("premium", 100));
  f.roll(8);
  await f.run("techRoll", undefined, id);
  const card = f.messages.at(-1).content;
  assert.match(card, /crewtools-roll-card/);
  assert.match(card, /FAILURE/);
  assert.match(card, /vs DV 17/);
  assert.match(card, /0 days burned/);
  assert.doesNotMatch(card, /Actor\./);
});

test("non-TECH repairs retain one original Item and restore native armor without fabrication", async () => {
  const f = fixture();
  f.actor.items = f.actor.items.filter((i) => i.type !== "role");
  const item = f.makeItem(
    {
      name: "Light Armorjack",
      type: "armor",
      system: {
        price: { market: 100 },
        amount: 1,
        isBodyLocation: true,
        bodyLocation: { sp: 11, ablation: 5 },
      },
    },
    f.actor,
  );
  f.actor.items.push(item);
  const input = {
    ...f.invention("premium", 100),
    mode: "repair",
    sourceUuid: item.uuid,
  };
  const id = await f.run("techStart", input);
  await assert.rejects(
    f.run("techStart", { ...input, slot: 1 }, undefined, 3),
    /slot/,
  );
  await f.run("techRoll", undefined, id);
  assert.equal(f.projects()[0].success, true);
  assert.equal(f.mods().length, 0);
  await f.run("techDay", undefined, id);
  assert.equal(f.projects()[0].active, false);
  assert.equal(item.system.bodyLocation.ablation, 0);
  assert.equal(item.system.bodyLocation.sp, 11);
  assert.equal(f.actor.items.filter((i) => i.type === "armor").length, 1);
  assert.equal(f.model.downtimeBalance(f.state(), "hero"), 99);
  assert.match(f.messages.at(-1).content, /Repair Gear/);
});
test("armor overrides use actual price category, honor TECH-only, and snapshot duration", async () => {
  for (const techOnly of [false, true]) {
    const f = fixture();
    f.actor.items = f.actor.items.filter((i) => i.type !== "role");
    f.settings.set("armorRepairTimes", {
      enabled: true,
      techOnly,
      days: { expensive: 2 },
    });
    const item = f.makeItem(
      {
        name: "Special Kevlar",
        type: "armor",
        system: { price: { market: 500 }, amount: 1 },
      },
      f.actor,
    );
    f.actor.items.push(item);
    await f.run("techStart", {
      ...f.invention(),
      mode: "repair",
      sourceUuid: item.uuid,
    });
    assert.equal(f.projects()[0].required, techOnly ? 7 : 2);
    f.settings.set("armorRepairTimes", {
      enabled: false,
      techOnly: false,
      days: { expensive: 9 },
    });
    f.model.validateDowntime(f.state());
    assert.equal(f.projects()[0].required, techOnly ? 7 : 2);
  }
  const f = fixture();
  f.settings.set("armorRepairTimes", {
    enabled: true,
    techOnly: true,
    days: { premium: 3 },
  });
  const armor = f.makeItem(
    { name: "Armor", type: "armor", system: { price: { market: 100 } } },
    f.actor,
  );
  f.actor.items.push(armor);
  await f.run("techStart", {
    ...f.invention("premium", 100),
    mode: "repair",
    sourceUuid: armor.uuid,
  });
  assert.equal(f.projects()[0].required, 3);
});
test("repair cancellation preserves damage; missing original prevents completion", async () => {
  const f = fixture();
  const item = f.makeItem(
    {
      name: "Armor",
      type: "armor",
      system: {
        price: { market: 100 },
        isHeadLocation: true,
        headLocation: { ablation: 4 },
      },
    },
    f.actor,
  );
  f.actor.items.push(item);
  const input = {
    ...f.invention("premium", 100),
    mode: "repair",
    sourceUuid: item.uuid,
  };
  let id = await f.run("techStart", input);
  await f.run("techCancel", undefined, id);
  assert.equal(item.system.headLocation.ablation, 4);
  id = await f.run("techStart", input);
  await f.run("techRoll", undefined, id);
  f.uuids.delete(item.uuid);
  await assert.rejects(f.run("techDay", undefined, id), /missing/);
  assert.equal(f.projects().find((p) => p.id === id).progress, 0);
});
test("Workshop I advances two projects for one day; II advances three; completion remains explicit", async () => {
  for (const slots of [2, 3]) {
    const f = fixture();
    assert.equal(f.service.techSlotLimit(slots === 2 ? 1 : 2), slots);
    const ids = [];
    for (let slot = 0; slot < slots; slot++) {
      const id = await f.run(
        "techStart",
        f.invention("premium", 100, slot),
        undefined,
        slots,
      );
      ids.push(id);
      await f.run("techRoll", undefined, id, slots);
    }
    await assert.rejects(
      f.run("techDay", undefined, ids[0], slots, true),
      /all projects/,
    );
    await f.run("techWorkshop", undefined, undefined, slots, true);
    assert.equal(f.model.downtimeBalance(f.state(), "hero"), 99);
    assert.ok(f.projects().every((p) => p.progress === 1 && p.active));
    await assert.rejects(
      f.run("techWorkshop", undefined, undefined, slots, true),
      /No projects/,
    );
    for (const id of ids) await f.run("techFinish", undefined, id, slots, true);
    assert.ok(f.projects().every((p) => !p.active));
    assert.equal(f.model.downtimeBalance(f.state(), "hero"), 99);
  }
});
test("Workshop batch write failure spends no day and credits no projects", async () => {
  const f = fixture();
  await f.run("techStart", f.invention(), undefined, 2);
  await f.run("techStart", f.invention("expensive", 500, 1), undefined, 2);
  await assert.rejects(
    f.run("techWorkshop", undefined, undefined, 2, false),
    /Workshop/,
  );
  f.fail();
  await assert.rejects(
    f.run("techWorkshop", undefined, undefined, 2, true),
    /save failed/,
  );
  assert.ok(f.projects().every((p) => p.progress === 0));
  assert.equal(f.model.downtimeBalance(f.state(), "hero"), 100);
});

test("repair uses native Field Expertise modifiers without adding the bonus twice", async () => {
  const f = fixture();
  f.actor.items[0].system.abilities.push({ name: "Field Expertise", rank: 4 });
  const item = f.makeItem(
    { name: "Armor", type: "armor", system: { price: { market: 100 } } },
    f.actor,
  );
  f.actor.items.push(item);
  const id = await f.run("techStart", {
    ...f.invention("premium", 100),
    mode: "repair",
    sourceUuid: item.uuid,
  });
  await f.run("techRoll", undefined, id);
  assert.equal(f.mods().length, 0);
});

test("armor repair settings default off, expose price tiers, reject invalid days and non-GM changes", async () => {
  const f = fixture();
  f.service.registerTechSettings();
  const Type = f.registered.get("armorRepair").type,
    form = new Type();
  assert.equal(form.getData().enabled, false);
  assert.equal(form.getData().rows.length, 5);
  await form._updateObject(null, {
    enabled: true,
    techOnly: true,
    days0: 2,
    days1: "",
  });
  assert.equal(f.settings.get("armorRepairTimes").days.premium, 2);
  assert.equal(f.settings.get("armorRepairTimes").techOnly, true);
  await assert.rejects(form._updateObject(null, { days0: 0 }), /whole days/);
  f.game.user = f.player;
  await assert.rejects(form._updateObject(null, { days0: 2 }), /GM/);
});

// Exercise the adapter with native-shaped modifier arrays, including dialog changes.
function techAdapter() {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/tech-system.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports },
  );
  return exports;
}

test("Item Skills admit only the seven eligible skills, including Electronics/Security Tech", () => {
  const names = [
    "Basic Tech",
    "Cybertech",
    "Air Vehicle Tech",
    "Land Vehicle Tech",
    "Sea Vehicle Tech",
    "Weaponstech",
    "Electronics/Security Tech",
    "First Aid",
    "Pick Lock",
    "Forgery",
  ];
  const actor = {
    items: names.map((name, id) => ({
      id: String(id),
      name,
      type: "skill",
      system: { stat: "tech" },
    })),
  };
  assert.deepEqual(
    Array.from(techAdapter().techSkills(actor), (i) => i.name),
    names.slice(0, 7),
  );
});

for (const [mode, specialty] of Object.entries({
  fabricate: "Fabrication Expertise",
  upgrade: "Upgrade Expertise",
  invention: "Invention Expertise",
  repair: "Field Expertise",
})) {
  test(`${mode} preserves native modifiers and uses only its matching Expertise`, async () => {
    const field = { source: "Field Expertise", value: 4 };
    const wound = { source: "Wound State", value: -2 };
    let rolled = false;
    const roll = {
      mods: [field, wound],
      addMod(mods) {
        this.mods.push(...mods);
      },
      async handleRollDialog() {
        assert.equal(
          this.mods.some((m) => m.source === "Field Expertise"),
          mode === "repair",
        );
        if (mode !== "repair") this.mods.push(field);
        return true;
      },
      async roll() {
        rolled = true;
      },
      resultTotal: 25,
    };
    const skill = {
      id: "skill",
      type: "skill",
      name: "Electronics/Security Tech",
      system: { stat: "tech" },
      createRoll: () => roll,
    };
    const actor = {
      items: [
        skill,
        {
          id: "role",
          name: "Tech",
          type: "role",
          system: { rank: 4, abilities: [{ name: specialty, rank: 4 }] },
        },
      ],
    };
    await techAdapter().checkProject(actor, {
      mode,
      skillId: "skill",
      dv: 17,
      half: 1,
    });
    assert.equal(rolled, true);
    assert.equal(roll.mods.filter((m) => m.source === specialty).length, 1);
    assert.equal(roll.mods.includes(wound), true);
    assert.equal(
      roll.mods.reduce((sum, m) => sum + m.value, 0),
      2,
    );
  });
}
