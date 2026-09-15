import type { HeadquartersState } from "./headquarters";
// Native role and inventory identity; the crafting track never substitutes Interface for TECH.
export function isNetrunner(actor?: FoundryActor): boolean {
  return Array.from(actor?.items ?? []).some((item) => {
    const role = item.system as { rank?: number; mainRoleAbility?: string };
    return (
      item.type === "role" &&
      Number(role.rank) > 0 &&
      (item.name.trim().toLowerCase() === "netrunner" ||
        role.mainRoleAbility?.trim().toLowerCase() === "interface")
    );
  });
}
export function netrunnerSkill(actor: FoundryActor) {
  return Array.from(actor.items ?? []).find(
    (item) =>
      item.type === "skill" &&
      (item.system as { stat?: string }).stat === "tech" &&
      item.name.toLowerCase().replace(/[^a-z]/g, "") ===
        "electronicssecuritytech",
  );
}
export function netrunnerItem(item: FoundryItem): boolean {
  return (
    item.type === "cyberdeck" ||
    item.type === "program" ||
    (item.type === "itemUpgrade" &&
      (item.system as { type?: string }).type === "cyberdeck")
  );
}

// Catalog identity survives a renamed Server Room; the name fallback supports older records.
export function serverRoomAvailable(state: HeadquartersState): boolean {
  return state.headquarters.some((hq) =>
    hq.improvements.some(
      (i) =>
        (i.catalogId === "serverRoom" ||
          (!i.catalogId &&
            i.name.toLowerCase().replace(/[^a-z]/g, "") === "serverroom")) &&
        (i.level ?? 1) >= 2,
    ),
  );
}
