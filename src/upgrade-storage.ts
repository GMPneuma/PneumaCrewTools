import { MODULE_ID } from "./constants";
// Native holding containers contain real Items; project metadata remains in Journals.
// Keep generated holding containers tied to the character's current owners.
export async function syncUpgradeStorage(
  actorIds?: readonly string[],
): Promise<void> {
  for (const container of game.actors) {
    const actorId = container.getFlag?.(MODULE_ID, "upgradeProjectsFor");
    if (
      typeof actorId !== "string" ||
      (actorIds && !actorIds.includes(actorId))
    )
      continue;
    const owner = Array.from(game.actors).find((a) => a.id === actorId);
    const ownership = Object.fromEntries([
      ["default", 0],
      ...Array.from(game.users)
        .filter((u) => !u.isGM && owner?.testUserPermission(u, "OWNER"))
        .map((u) => [u.id, 3]),
    ]);
    const name = owner ? "Upgrade Projects — " + owner.name : container.name;
    if (
      JSON.stringify(ownership) !== JSON.stringify(container.ownership) ||
      name !== container.name
    )
      await container.update({ name, ownership });
  }
}
export async function storageActor(owner: FoundryActor): Promise<FoundryActor> {
  const existing = Array.from(game.actors).filter(
    (a) => a.getFlag?.(MODULE_ID, "upgradeProjectsFor") === owner.id,
  );
  if (existing.length > 1)
    throw new Error("Multiple Upgrade Projects containers exist.");
  if (existing[0]) return existing[0];
  if (!game.user?.isGM)
    throw new Error(
      "A GM must connect once after this character gains TECH or Netrunner to automatically prepare its Upgrade Projects container.",
    );
  let folder = Array.from(game.folders).find(
    (f) => f.type === "Actor" && f.name === "CrewTools" && !f.folder,
  );
  if (!folder)
    folder = await Folder.create({
      name: "CrewTools",
      type: "Actor",
      folder: null,
      sorting: "a",
    });
  if (
    !Array.from(game.folders).some(
      (f) =>
        f.type === "Actor" &&
        f.name === "CrewTools-GM" &&
        f.folder?.id === folder!.id,
    )
  )
    await Folder.create({
      name: "CrewTools-GM",
      type: "Actor",
      folder: folder.id,
      sorting: "a",
    });
  return Actor.create({
    name: "Upgrade Projects — " + owner.name,
    type: "container",
    folder: folder.id,
    ownership: Object.fromEntries([
      ["default", 0],
      ...Array.from(game.users)
        .filter((u) => !u.isGM && owner.testUserPermission(u, "OWNER"))
        .map((u) => [u.id, 3]),
    ]),
    flags: { [MODULE_ID]: { upgradeProjectsFor: owner.id } },
  });
}
