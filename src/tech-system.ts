import type { techProjects } from "./tech-project-model";
// Native Cyberpunk role, roll, item export, and installed-item operations.
export function techSkills(actor: FoundryActor) {
  return Array.from(actor.items ?? []).filter(
    (i) =>
      i.type === "skill" && (i.system as { stat?: string })?.stat === "tech",
  );
}
export function techRole(actor: FoundryActor) {
  return Array.from(actor.items ?? []).find(
    (i) =>
      i.type === "role" &&
      ((i.system as { rank?: number })?.rank ?? 0) > 0 &&
      (i.name.trim().toLowerCase() === "tech" ||
        String(
          (i.system as { mainRoleAbility?: string })?.mainRoleAbility,
        ).toLowerCase() === "maker"),
  );
}
export function itemPrice(item: FoundryItem): number {
  const value = (item.system as { price?: { market?: unknown } })?.price
    ?.market;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 100)
    throw new Error(
      "Projects require an item costing at least Premium (100 eb). Use free-form downtime for cheaper items.",
    );
  return value;
}
// Use the native skill roll's modifiers and critical dice, then add the matching Maker specialty.
export async function checkProject(
  actor: FoundryActor,
  project: ReturnType<typeof techProjects>[number],
) {
  const skill = techSkills(actor).find((i) => i.id === project.skillId),
    role = techRole(actor);
  const name = {
    fabricate: "Fabrication Expertise",
    upgrade: "Upgrade Expertise",
    invention: "Invention Expertise",
  }[project.mode];
  const specialty = (
    role?.system as { abilities?: { name: string; rank: number }[] }
  )?.abilities?.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (!skill?.createRoll || !specialty || !Number.isFinite(specialty.rank))
    throw new Error(
      "The native TECH skill or " + name + " specialty is unavailable.",
    );
  const roll = skill.createRoll("skill", actor);
  roll.addMod([{ value: specialty.rank, source: name }]);
  // Keep Maker's bonus in the normal native modifier dialog before rolling.
  if (
    !(await roll.handleRollDialog(
      { type: "crewtools", ctrlKey: false, metaKey: false },
      actor,
      skill,
    ))
  )
    return;
  await roll.roll();
  if (!Number.isFinite(roll.resultTotal))
    throw new Error("The native skill roll did not return a total.");
  return {
    total: roll.resultTotal,
    dv: project.dv,
    success: roll.resultTotal > project.dv,
    burned: roll.resultTotal > project.dv ? 0 : project.half,
    skillId: skill.id,
    skillName: skill.name,
    specialty: name,
    rank: specialty.rank,
  };
}
export function snapshot(item: FoundryItem): Record<string, unknown> {
  const data = structuredClone(
    item.toCompendium ? item.toCompendium(null) : item.toObject(),
  );
  delete data._id;
  delete data.folder;
  delete data.ownership;
  const system = (data.system ??= {}) as Record<string, unknown>;
  if ("amount" in system) system.amount = 1;
  return data;
}
export async function removeItem(item: FoundryItem) {
  const amount = (item.system as { amount?: number })?.amount;
  if (amount && amount > 1) {
    await item.update!({ "system.amount": amount - 1 });
    return;
  }
  const children = item.recursiveGetAllInstalledItems?.() ?? [];
  const ids = [...children.map((i) => i.id), item.id];
  if (item.parent?.documentName === "Actor")
    await item.parent.deleteEmbeddedDocuments("Item", ids, {
      deleteInstalled: true,
      unloadAmmo: false,
    });
  else {
    if (
      (item.system as { isInstalled?: boolean })?.isInstalled &&
      item.uninstall
    )
      await item.uninstall({ skipDialog: true });
    await Item.deleteDocuments(ids);
  }
}
