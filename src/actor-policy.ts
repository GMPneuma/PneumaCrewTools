import { MODULE_ID } from "./constants";
export const EXCLUDED_ACTORS_SETTING = "excludedActorIds";

// Holding containers are infrastructure, never selectable player Actors.
export function isUpgradeStorageActor(actor: FoundryActor): boolean {
  return (
    actor.type === "container" &&
    typeof actor.getFlag?.(MODULE_ID, "upgradeProjectsFor") === "string"
  );
}

// Exclusion identity is the world Actor ID, so renames cannot undo the choice.
export function isActorExcluded(actorId: string): boolean {
  const actor = Array.from(game.actors).find((a) => a.id === actorId);
  if (actor && isUpgradeStorageActor(actor)) return true;
  const ids = game.settings.get(MODULE_ID, EXCLUDED_ACTORS_SETTING);
  return Array.isArray(ids) && ids.includes(actorId);
}
export function isCrewActor(actor: FoundryActor): boolean {
  return (
    actor.type === "character" &&
    !isActorExcluded(actor.id) &&
    Array.from(game.users).some(
      (u) => !u.isGM && actor.testUserPermission(u, "OWNER"),
    )
  );
}
export function accessibleCrewActors(): FoundryActor[] {
  return Array.from(game.actors)
    .filter(
      (actor) =>
        !isActorExcluded(actor.id) &&
        actor.type === "character" &&
        game.user &&
        (game.user.isGM
          ? isCrewActor(actor)
          : actor.testUserPermission(game.user, "OWNER")),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
