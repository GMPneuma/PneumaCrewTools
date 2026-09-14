import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      new URL("../src/medtech-system.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports },
);
const actor = () => ({
  items: [
    {
      id: "medicine",
      name: "Medtech",
      type: "role",
      system: {
        rank: 4,
        mainRoleAbility: "Medicine",
        abilities: [
          { name: "Medical Tech (Pharmaceuticals)", rank: 2 },
          { name: "Medical Tech Skill", rank: 3 },
          { name: "Surgery Skill", rank: 4 },
        ],
      },
    },
  ],
});
test("Medical Tech uses the role's derived skill, not pharmaceutical rank or an ordinary skill", () => {
  const a = actor();
  a.items.push({
    id: "fake",
    name: "Medical Tech Skill",
    type: "skill",
    system: { level: 10 },
  });
  assert.equal(exports.medicalAbility(a, "Medical Tech Skill").ability.rank, 3);
  assert.equal(exports.medicalAbility(a, "Surgery Skill").ability.rank, 4);
});
test("medical rolls pass the native sub-role configuration and require exceeding the DV", async () => {
  const a = actor();
  let total = 13,
    calls = 0;
  a.items[0].createRoll = (type, subject, options) => {
    assert.equal(type, "roleAbility");
    assert.equal(subject, a);
    assert.equal(options.rollSubType, "subRoleAbility");
    assert.equal(options.subRoleName, "Medical Tech Skill");
    return {
      handleRollDialog: async () => true,
      roll: async () => {
        calls++;
      },
      get resultTotal() {
        return total;
      },
    };
  };
  assert.equal(
    (await exports.rollMedicalAbility(a, "Medical Tech Skill", 13)).success,
    false,
  );
  total = 14;
  assert.equal(
    (await exports.rollMedicalAbility(a, "Medical Tech Skill", 13)).success,
    true,
  );
  assert.equal(calls, 2);
});
test("unranked and non-Medtech actors cannot use the role abilities", () => {
  const a = actor();
  a.items[0].system.abilities[1].rank = 0;
  assert.throws(() => exports.medicalAbility(a, "Medical Tech Skill"));
  a.items[0].system.rank = 0;
  assert.equal(exports.medtechRole(a), undefined);
});
test("surgery reads the native treatment DV and excludes unsupported injuries", () => {
  assert.equal(
    exports.surgeryDifficulty({
      type: "criticalInjury",
      system: { treatment: { dvSurgery: 13 } },
    }),
    13,
  );
  for (const item of [
    { type: "criticalInjury", system: { treatment: { dvSurgery: 0 } } },
    { type: "gear", system: { treatment: { dvSurgery: 17 } } },
  ])
    assert.throws(() => exports.surgeryDifficulty(item));
});

test("native medical dialog applies modifiers before the attempt and cancellation never rolls", async () => {
  const a = actor();
  let accept = true,
    total = 12,
    guarded = false,
    rolled = false;
  a.items[0].createRoll = () => ({
    handleRollDialog: async (event, subject, item) => {
      assert.equal(subject, a);
      assert.equal(item, a.items[0]);
      assert.equal(event.ctrlKey, false);
      assert.equal(event.metaKey, false);
      assert.equal(guarded, false);
      total += 3;
      return accept;
    },
    roll: async () => {
      assert.equal(guarded, true);
      rolled = true;
    },
    get resultTotal() {
      return total;
    },
  });
  const result = await exports.rollMedicalAbility(
    a,
    "Surgery Skill",
    13,
    async () => {
      guarded = true;
    },
  );
  assert.equal(result.total, 15);
  assert.equal(result.success, true);
  assert.equal(rolled, true);
  accept = false;
  guarded = false;
  rolled = false;
  assert.equal(
    await exports.rollMedicalAbility(a, "Surgery Skill", 13, async () => {
      guarded = true;
    }),
    undefined,
  );
  assert.equal(guarded, false);
  assert.equal(rolled, false);
});
