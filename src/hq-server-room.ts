import { MODULE_ID } from "./constants";
import { getHeadquarters } from "./headquarters";
import { hqPage } from "./hq-records";
import { improvementLevel } from "./hq-benefits";
import { queueAction, isPrimaryGM } from "./action-coordinator";
export function serverRoomItem(hqId: string): FoundryItem | undefined {
  return Array.from(game.items ?? []).find(
    (i) =>
      i.type === "netarch" && i.getFlag?.(MODULE_ID, "hqServerRoom") === hqId,
  );
}
export function serverRoomLink(hqId: string) {
  const item = serverRoomItem(hqId);
  return item &&
    game.user &&
    (game.user.isGM || item.testUserPermission?.(game.user, "OBSERVER"))
    ? { id: item.id, name: item.name }
    : undefined;
}
export async function ensureServerRooms(): Promise<void> {
  if (!isPrimaryGM()) return;
  const hqs = getHeadquarters(false).headquarters;
  for (const item of Array.from(game.items ?? [])) {
    const id = item.getFlag?.(MODULE_ID, "hqServerRoom");
    if (
      id &&
      !hqs.some((h) => h.id === id && improvementLevel(h, "serverRoom") > 0)
    )
      await item.update?.({
        ownership: Object.fromEntries([
          ["default", 0],
          ...Array.from(game.users)
            .filter((u) => !u.isGM)
            .map((u) => [u.id, 0]),
        ]),
      });
  }
  for (const hq of hqs) {
    if (!improvementLevel(hq, "serverRoom")) continue;
    const actor = game.actors.get(hq.actorId),
      page = hqPage(hq.actorId);
    if (!actor || !page) continue;
    const ownership: Record<string, number> = { default: 0 };
    for (const user of game.users)
      if (!user.isGM)
        ownership[user.id] =
          actor.testUserPermission(user, "OBSERVER") &&
          page.testUserPermission?.(user, "OBSERVER")
            ? 2
            : 0;
    const existing = serverRoomItem(hq.id);
    if (existing) {
      // This generated Item follows HQ visibility; preserve its architecture and edits.
      await existing.update?.({ ownership });
      continue;
    }
    const folder =
      Array.from(game.folders).find(
        (f) => f.type === "Item" && f.name === "CrewTools" && !f.folder,
      ) ??
      (await Folder.create({ name: "CrewTools", type: "Item", sorting: "a" }));
    await Item.create({
      name: hq.name + " — NET Architecture",
      type: "netarch",
      folder: folder.id,
      ownership,
      flags: { [MODULE_ID]: { hqServerRoom: hq.id } },
    });
  }
}
export function registerServerRooms(): void {
  const refresh = () => {
    if (isPrimaryGM())
      void queueAction(ensureServerRooms).catch((error) =>
        ui.notifications.error(String(error)),
      );
  };
  Hooks.once("ready", refresh);
  Hooks.on("updateJournalEntryPage", (page) => {
    if (
      page.getFlag?.(MODULE_ID, "kind") === "headquarters" ||
      page.getFlag?.(MODULE_ID, "recordKey") === "hq"
    )
      refresh();
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (
      hqPage(actor.id) &&
      Object.keys(changes).some(
        (k) => k === "ownership" || k.startsWith("ownership."),
      )
    )
      refresh();
  });
  Hooks.on("updateUser", refresh);
  Hooks.on("userConnected", refresh);
  Hooks.on("createJournalEntryPage", (page) => {
    if (page.getFlag?.(MODULE_ID, "recordKey") === "hq") refresh();
  });
  Hooks.on("deleteJournalEntryPage", (page) => {
    if (page.getFlag?.(MODULE_ID, "recordKey") === "hq") refresh();
  });
}
export function openServerRoom(hqId: string): void {
  const item = serverRoomItem(hqId);
  if (serverRoomLink(hqId)) item?.sheet?.render(true);
  else
    ui.notifications.info(
      "A GM must be online to prepare or grant access to this NET Architecture.",
    );
}
