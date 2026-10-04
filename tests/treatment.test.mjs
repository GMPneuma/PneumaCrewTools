import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture() {
  const messages = [],
    dialogs = [],
    calls = [],
    updates = [];
  const user = { id: "player", isGM: false, targets: new Set() };
  const actor = {
    id: "healer",
    name: "Healer",
    type: "character",
    items: [],
    system: { stats: { luck: { value: 6 } } },
    testUserPermission: () => true,
    update: async (data) => {
      updates.push(data);
      actor.system.stats.luck.value = data["system.stats.luck.value"];
    },
  };
  const roll = {
    luck: 0,
    resultTotal: 18,
    rollCard: "native-card.hbs",
    wasCritical: () => true,
    handleRollDialog: async (event) => {
      calls.push({ dialog: event });
      return true;
    },
    roll: async () => calls.push({ rolled: true }),
  };
  const item = (name, type = "skill", system = {}) => ({
    name,
    type,
    system,
    createRoll: (type, healer, options) => {
      calls.push({ type, healer: healer.id, options });
      return roll;
    },
    confirmRoll: async (r) => {
      calls.push({ confirmed: true });
      return r;
    },
  });
  actor.items = [
    item("First Aid"),
    item("Paramedic"),
    item("Medtech", "role", {
      rank: 4,
      mainRoleAbility: "Medicine",
      abilities: [{ name: "Surgery Skill", rank: 2, hasRoll: true }],
    }),
  ];
  const injuries = [
    {
      name: "Broken Arm",
      type: "criticalInjury",
      system: {
        quickFix: { dvParamedic: 13 },
        treatment: { dvParamedic: 15, dvSurgery: 13 },
      },
    },
    {
      name: "Foreign Object",
      type: "criticalInjury",
      system: {
        quickFix: { dvFirstAid: 13, dvParamedic: 13 },
        treatment: { type: "quickFix", dvParamedic: 13 },
      },
    },
  ];
  const game = {
    user,
    actors: new Map([[actor.id, actor]]),
    packs: ["body", "head"].map((location) => ({
      collection: "cyberpunk-red-core.core_critical-injuries-" + location,
      getDocuments: async () => injuries,
    })),
    settings: { get: () => "blindroll" },
  };
  const canvas = { tokens: { placeables: [] } };
  const cache = new Map();
  const load = (name) => {
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
      exports,
      require: (p) => load(p.slice(2)),
      game,
      canvas,
      Dialog: class {
        constructor(config, options) {
          dialogs.push({ config, options });
        }
        render() {}
      },
      renderTemplate: async (_path, r) => {
        assert.equal(r.criticalCard, true);
        return '<div class="rollcard"><div class="rollcard-top">Native roll</div></div>';
      },
      ChatMessage: {
        applyRollMode: (data, mode) => {
          data.mode = mode;
          data.blind = true;
        },
        create: async (data) => messages.push(data),
      },
      console,
    });
    return exports;
  };
  return {
    api: load("treatment"),
    game,
    actor,
    roll,
    injuries,
    canvas,
    calls,
    updates,
    dialogs,
    messages,
  };
}
const choice = {
  name: "Broken Arm",
  stage: "Treatment",
  skill: "Paramedic",
  dv: 15,
};
test("injury choices retain both treatment skills and QuickFix-only cures", () => {
  const f = fixture();
  assert.deepEqual(
    Array.from(f.api.injuryTreatmentChoices(f.injuries[0]), (c) => [
      c.stage,
      c.skill,
      c.dv,
    ]),
    [
      ["QuickFix", "Paramedic", 13],
      ["Treatment", "Paramedic", 15],
      ["Treatment", "Surgery", 13],
    ],
  );
  const permanent = f.api.injuryTreatmentChoices(f.injuries[1]);
  assert.equal(permanent.length, 2);
  assert.ok(permanent.every((c) => c.stage === "QuickFix" && c.permanent));
});
test("native treatment uses the Hub healer without a token or an online GM", async () => {
  const f = fixture();
  await f.api.rollTreatment(
    f.actor,
    choice,
    { name: "Offline Patient <name>" },
    { shiftKey: true },
  );
  assert.equal(f.calls[0].healer, "healer");
  assert.equal(f.calls[0].type, "skill");
  assert.equal(f.calls[1].dialog.ctrlKey, true);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].content, /rollcard-top/);
  assert.match(f.messages[0].content, /Success.*18 vs DV15/);
  assert.match(f.messages[0].content, /Offline Patient &lt;name&gt;/);
  assert.equal(f.messages[0].mode, "blindroll");
  assert.equal(f.messages[0].speaker.actor, "healer");
  assert.equal(f.updates.length, 0);
});
test("Surgery uses the native Medtech sub-role ability rather than a skill Item", async () => {
  const f = fixture();
  await f.api.rollTreatment(
    f.actor,
    { ...choice, skill: "Surgery" },
    { name: "Patient" },
    { shiftKey: false },
  );
  assert.equal(f.calls[0].type, "roleAbility");
  assert.equal(f.calls[0].options.rollSubType, "subRoleAbility");
  assert.equal(f.calls[0].options.subRoleName, "Surgery Skill");
});
test("cancelled modifiers spend no Luck, roll nothing and post no chat", async () => {
  const f = fixture();
  f.roll.luck = 3;
  f.roll.handleRollDialog = async () => false;
  await f.api.rollTreatment(
    f.actor,
    choice,
    { name: "Patient" },
    { shiftKey: false },
  );
  assert.equal(f.updates.length, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(
    f.calls.some((c) => c.confirmed || c.rolled),
    false,
  );
});
test("Luck spends only the confirmed amount and invalid spending stops the roll", async () => {
  for (const luck of [2, 7, -1]) {
    const f = fixture();
    f.roll.luck = luck;
    const action = () =>
      f.api.rollTreatment(
        f.actor,
        choice,
        { name: "Patient" },
        { shiftKey: false },
      );
    if (luck === 2) {
      await action();
      assert.equal(f.actor.system.stats.luck.value, 4);
      assert.equal(f.updates.length, 1);
    } else {
      await assert.rejects(action(), /Luck/);
      assert.equal(f.updates.length, 0);
      assert.equal(f.messages.length, 0);
      assert.equal(
        f.calls.some((c) => c.rolled),
        false,
      );
    }
  }
});
test("a tied DV fails and a named patient needs no Actor permission", async () => {
  const f = fixture();
  f.roll.resultTotal = 15;
  await f.api.rollTreatment(
    f.actor,
    choice,
    { name: "Patient", tokenUuid: "Scene.s.Token.t" },
    { shiftKey: false },
  );
  assert.match(f.messages[0].content, /Fail.*15 vs DV15/);
  assert.equal(
    f.messages[0].flags["pneuma-crewtools"].treatment.patientTokenUuid,
    "Scene.s.Token.t",
  );
  assert.equal(f.updates.length, 0);
});
test("invalid healer or missing patient prevents any native roll", async () => {
  const f = fixture();
  await assert.rejects(
    f.api.rollTreatment(f.actor, choice, { name: "  " }, { shiftKey: false }),
    /patient/,
  );
  f.actor.testUserPermission = () => false;
  await assert.rejects(f.api.openTreatment("healer"), /own/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.dialogs.length, 0);
});
test("patient picker shows visible player tokens including offline owners and defaults to the target", async () => {
  const f = fixture();
  const token = (name, visible, player = true) => ({
    name,
    isVisible: visible,
    actor: { hasPlayerOwner: player },
    document: { uuid: "Scene.s.Token." + name },
  });
  const patient = token("Offline", true);
  f.canvas.tokens.placeables = [
    token("Hidden", false),
    token("NPC", true, false),
    patient,
  ];
  f.game.user.targets.add(patient);
  await f.api.openTreatment("healer");
  const { config, options } = f.dialogs[0];
  assert.equal(config.title, "Treatment — Healer");
  assert.match(config.content, /Scene.s.Token.Offline" selected/);
  assert.doesNotMatch(config.content, /Scene.s.Token.Hidden|Scene.s.Token.NPC/);
  assert.match(config.content, /Type a patient name/);
  assert.match(config.content, /Body Crits/);
  assert.match(config.content, /Head Crits/);
  assert.equal(options.width, 720);
});
test("missing native catalogs report an error without creating a partial window", async () => {
  const f = fixture();
  f.game.packs = [];
  await assert.rejects(
    f.api.openTreatment("healer"),
    /compendium is unavailable/,
  );
  assert.equal(f.dialogs.length, 0);
});
