// Cyberpunk RED adapter: use native Medtech role abilities, not normal skill Items.
export function medtechRole(actor: FoundryActor): FoundryItem | undefined {
  return Array.from(actor.items ?? []).find((item) => {
    const data = item.system as { rank?: number; mainRoleAbility?: string };
    return (
      item.type === "role" &&
      Number(data.rank) > 0 &&
      (item.name.toLowerCase() === "medtech" ||
        data.mainRoleAbility?.toLowerCase() === "medicine")
    );
  });
}
export function medicalAbility(
  actor: FoundryActor,
  name: "Surgery Skill" | "Medical Tech Skill",
) {
  const role = medtechRole(actor);
  const ability = (
    role?.system as { abilities?: { name: string; rank: number }[] }
  )?.abilities?.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (
    !role ||
    !ability ||
    !Number.isSafeInteger(ability.rank) ||
    ability.rank < 1
  )
    throw new Error("A ranked " + name + " Medtech role ability is required.");
  return { role, ability };
}
export async function rollMedicalAbility(
  actor: FoundryActor,
  name: "Surgery Skill" | "Medical Tech Skill",
  dv: number,
  beforeRoll?: () => Promise<void>,
) {
  const { role, ability } = medicalAbility(actor, name);
  if (!role.createRoll)
    throw new Error("Native Medtech role rolls are unavailable.");
  const roll = role.createRoll("roleAbility", actor, {
    rollSubType: "subRoleAbility",
    subRoleName: ability.name,
  });
  if (!roll?.roll)
    throw new Error("Native Medtech role roll could not be created.");
  // Always offer native modifiers; cancelling leaves the workday untouched.
  if (
    !(await roll.handleRollDialog(
      { type: "crewtools", ctrlKey: false, metaKey: false },
      actor,
      role,
    ))
  )
    return;
  // Construct the native roll before marking an attempt; adapter errors cannot lock the workday.
  await beforeRoll?.();
  await roll.roll();
  if (!Number.isFinite(roll.resultTotal))
    throw new Error("The Medtech roll returned no total.");
  return {
    roleItemId: role.id,
    ability: ability.name,
    rank: ability.rank,
    total: roll.resultTotal,
    dv,
    success: roll.resultTotal > dv,
  };
}
// DVs come from native Critical Injury Items, including compendium/custom data.
export function surgeryDifficulty(item: FoundryItem): number {
  const dv = (item.system as { treatment?: { dvSurgery?: number } })?.treatment
    ?.dvSurgery;
  if (
    item.type !== "criticalInjury" ||
    !Number.isSafeInteger(dv) ||
    !dv ||
    dv < 1
  )
    throw new Error("Choose a Critical Injury with a Surgery treatment DV.");
  return dv;
}
