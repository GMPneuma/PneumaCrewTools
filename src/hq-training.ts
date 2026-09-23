import { MODULE_ID } from "./constants";
import { crewImprovementLevel } from "./hq-benefits";
import type { HeadquartersState } from "./headquarters";
import type { PayoutPlan } from "./payout-execution";
const names = [
  "Athletics",
  "Archery",
  "Autofire",
  "Brawling",
  "Evasion",
  "Handgun",
  "Heavy Weapons",
  "Martial Arts",
  "Melee Weapon",
  "Shoulder Arms",
];
export function trainingSkills(actor: FoundryActor): FoundryItem[] {
  return Array.from(actor.items ?? []).filter(
    (i) =>
      i.type === "skill" &&
      (names.some((n) => n.toLowerCase() === i.name.trim().toLowerCase()) ||
        (i.system as { skillType?: string })?.skillType === "martialArts"),
  );
}
export function trainingEffects(actor: FoundryActor): FoundryActiveEffect[] {
  return Array.from(actor.effects ?? []).filter(
    (e) => e.getFlag(MODULE_ID, "hqTraining") === true,
  );
}
export function trainingLimit(
  actor: FoundryActor,
  state: HeadquartersState,
): number {
  const level = crewImprovementLevel(state, "trainingArea");
  if (!level) return 0;
  const solo = Array.from(actor.items ?? []).some(
    (i) =>
      i.type === "role" &&
      Number((i.system as { rank?: number })?.rank) > 0 &&
      (i.name.toLowerCase() === "solo" ||
        (
          i.system as { mainRoleAbility?: string }
        )?.mainRoleAbility?.toLowerCase() === "combat awareness"),
  );
  return level >= 2 && solo ? 2 : 1;
}
export function trainingData(
  actor: FoundryActor,
  state: HeadquartersState,
  ids: string[],
): Record<string, unknown> {
  const limit = trainingLimit(actor, state);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > limit ||
    new Set(ids).size !== ids.length
  )
    throw new Error(
      "Choose distinct eligible skills for the available Training Area.",
    );
  const skills = ids.map((id) =>
    trainingSkills(actor).find((s) => s.id === id),
  );
  if (skills.some((s) => !s))
    throw new Error("Choose skills belonging to this character.");
  const cats: Record<number, string> = {},
    situational: Record<number, object> = {};
  const changes = skills.map((s, index) => {
    cats[index] = "skill";
    situational[index] = { isSituational: false, onByDefault: true };
    const slug = s!.name.replace(/ /g, "").replace(/[/&]/g, "And");
    return {
      key: "bonuses." + slug.charAt(0).toLowerCase() + slug.slice(1),
      mode: 2,
      value: "1",
    };
  });
  return {
    name: "HQ Training — " + skills.map((s) => s!.name).join(", "),
    img: "icons/svg/upgrade.svg",
    disabled: false,
    changes,
    flags: {
      [MODULE_ID]: { hqTraining: true, skills: ids },
      "cyberpunk-red-core": { changes: { cats, situational } },
    },
  };
}
export async function applyTraining(
  actor: FoundryActor,
  data: Record<string, unknown>,
): Promise<() => Promise<void>> {
  const existing = trainingEffects(actor);
  if (existing.length > 1)
    throw new Error("Multiple HQ Training effects need GM review.");
  const old = existing[0];
  if (old) {
    const before = old.toObject();
    await old.update(data);
    return async () => {
      await old.update(before);
    };
  }
  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return async () => {
    await actor.deleteEmbeddedDocuments(
      "ActiveEffect",
      created.map((e) => e.id),
    );
  };
}
export async function expireTrainingForPayout(
  plan: PayoutPlan,
): Promise<() => Promise<void>> {
  const changed: FoundryActiveEffect[] = [];
  const undo = async () => {
    for (const effect of changed) await effect.update({ disabled: false });
  };
  try {
    for (const input of plan.actors) {
      if (
        !input.entries.some(
          (e) => e.reward === "ip" && e.scope === "group" && e.amount > 0,
        )
      )
        continue;
      for (const effect of trainingEffects(input.actor).filter(
        (e) => !e.disabled,
      )) {
        await effect.update({ disabled: true });
        changed.push(effect);
      }
    }
  } catch (error) {
    await undo();
    throw error;
  }
  return undo;
}
export function trainingPanel(
  actor: FoundryActor | undefined,
  state: HeadquartersState,
  available: number,
) {
  if (!actor) return { visible: false };
  const limit = trainingLimit(actor, state);
  return {
    visible: limit > 0,
    second: limit === 2,
    skills: trainingSkills(actor),
    cannotTrain: available < 7,
    current: trainingEffects(actor)
      .filter((e) => !e.disabled)
      .map((e) => e.name)
      .join("; "),
  };
}
