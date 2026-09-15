import { MODULE_ID } from "./constants";
export const EXCLUDED_ACTORS_SETTING = "excludedActorIds";

// Holding containers are infrastructure, never selectable player Actors.
export function isUpgradeStorageActor(actor: FoundryActor): boolean {
  return (
    actor.type === "container" &&
    typeof actor.getFlag?.(MODULE_ID, "upgradeProjectsFor") === "string"
  );
}

// Build fresh per-operation sets: no persistent cache can outlive a roster or permission change.
export function teammateActorIds(
  actors = Array.from(game.actors),
): Set<string> {
  const existing = new Set(actors.map((actor) => actor.id));
  const ids = new Set<string>();
  for (const journal of game.journal ?? []) {
    if (
      journal.getFlag?.(MODULE_ID, "recordKind") !== "character" ||
      !existing.has(String(journal.getFlag?.(MODULE_ID, "actorId")))
    )
      continue;
    const page = Array.from(journal.pages).find(
      (p) => p.getFlag?.(MODULE_ID, "recordKey") === "teammates",
    );
    const data = page?.getFlag?.(MODULE_ID, "data") as
      { slots?: Array<{ actorId: string } | null> } | undefined;
    for (const member of data?.slots ?? []) if (member) ids.add(member.actorId);
  }
  return ids;
}
export function isTeammateActor(actorId: string): boolean {
  return teammateActorIds().has(actorId);
}
// Exclusion identity remains the world Actor ID; only the lookup strategy changes.
export function excludedActorIds(
  actors = Array.from(game.actors),
): Set<string> {
  const stored = game.settings.get(MODULE_ID, EXCLUDED_ACTORS_SETTING);
  const excluded = new Set<string>(Array.isArray(stored) ? stored : []);
  const teammates = teammateActorIds(actors);
  for (const actor of actors)
    if (isUpgradeStorageActor(actor) || teammates.has(actor.id))
      excluded.add(actor.id);
  return excluded;
}
export function isActorExcluded(actorId: string): boolean {
  return excludedActorIds().has(actorId);
}
export function isCrewActor(actor: FoundryActor): boolean {
  return (
    actor.type === "character" &&
    !isActorExcluded(actor.id) &&
    Array.from(game.users).some(
      (user) => !user.isGM && actor.testUserPermission(user, "OWNER"),
    )
  );
}
export function accessibleCrewActors(): FoundryActor[] {
  const user = game.user;
  if (!user) return [];
  const actors = Array.from(game.actors);
  const excluded = excludedActorIds(actors);
  const players = Array.from(game.users).filter((player) => !player.isGM);
  return actors
    .filter(
      (actor) =>
        actor.type === "character" &&
        !excluded.has(actor.id) &&
        (user.isGM
          ? players.some((player) => actor.testUserPermission(player, "OWNER"))
          : actor.testUserPermission(user, "OWNER")),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
