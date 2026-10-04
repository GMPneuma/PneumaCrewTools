import { MODULE_ID } from "./constants";
import { deliverItems } from "./actor-resources";
import { storageActor } from "./upgrade-storage";
import type { TechSpec } from "./tech-project-model";

type Guard = (details: Record<string, unknown>) => Promise<void>;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const markedName = (spec: TechSpec) =>
  `${spec.originalName} (being ${spec.mode === "repair" ? "repaired" : "upgraded"})`;

// Originals and their installed trees stay in place. The container item is only a reference.
export async function beginInventoryProject(
  actor: FoundryActor,
  source: FoundryItem,
  spec: TechSpec,
  projectId: string,
  guard: Guard,
): Promise<void> {
  if (!source.update) throw new Error("The original Item cannot be updated.");
  const system = source.system as {
    amount?: number;
    isInstalled?: boolean;
    installedItems?: { list?: unknown[] };
  };
  const amount = system.amount ?? 1;
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new Error("The Item must have a positive whole-number quantity.");
  if (
    amount > 1 &&
    (system.isInstalled ||
      system.installedItems?.list?.length ||
      source.recursiveGetAllInstalledItems?.().length)
  )
    throw new Error(
      "Split this stack using the character sheet before starting a project on an installed Item or an Item with installed contents.",
    );
  const storage = await storageActor(actor);
  if (!game.user || !storage.testUserPermission(game.user, "OWNER"))
    throw new Error(
      "You do not have permission to use this character's project container.",
    );
  const referenceId = foundry.utils.randomID(16);
  const remainderId = amount > 1 ? foundry.utils.randomID(16) : undefined;
  const remainder = amount > 1 ? structuredClone(source.toObject()) : undefined;
  if (remainder) {
    remainder._id = remainderId;
    delete remainder.folder;
    delete remainder.ownership;
    (remainder.system as { amount: number }).amount = amount - 1;
  }
  spec.originalName = source.name;
  spec.storageActorId = storage.id;
  spec.storageItemId = referenceId;
  await guard({
    projectId,
    action: "Mark project Item",
    sourceUuid: source.uuid,
    originalName: source.name,
    markedName: markedName(spec),
    originalAmount: amount,
    destinationActorId: storage.id,
    destinationItemId: referenceId,
    remainderActorId: remainder ? actor.id : undefined,
    remainderItemId: remainderId,
  });
  await source.update({
    name: markedName(spec),
    ...(amount > 1 ? { "system.amount": 1 } : {}),
  });
  if (remainder)
    await deliverItems(actor, [remainder], {
      keepId: true,
      CPRsplitStack: true,
    });
  await deliverItems(
    storage,
    [
      {
        _id: referenceId,
        name: markedName(spec),
        type: "gear",
        img: source.img ?? "icons/svg/item-bag.svg",
        system: {
          amount: 1,
          price: { market: 0 },
          description: {
            value: `<p>Project reference. The original Item remains in the character's inventory.</p><p>@UUID[${escape(source.uuid!)}]{${escape(spec.originalName)}}</p>`,
          },
        },
        flags: {
          [MODULE_ID]: {
            techProjectReference: {
              projectId,
              sourceUuid: source.uuid,
              mode: spec.mode,
            },
          },
        },
      },
    ],
    { keepId: true, CPRsplitStack: true },
  );
}

export async function finishInventoryProject(
  actor: FoundryActor,
  requester: FoundryUser | undefined,
  spec: TechSpec,
  projectId: string,
  cancel: boolean,
  guard: Guard,
): Promise<FoundryItem> {
  const item = (await fromUuid(spec.sourceUuid ?? "")) as
    FoundryItem | undefined;
  if (
    !item ||
    item.documentName !== "Item" ||
    item.parent?.id !== actor.id ||
    !requester ||
    !item.testUserPermission?.(requester, "OWNER") ||
    !item.update
  )
    throw new Error("The original project Item is missing or no longer owned.");
  const storage = Array.from(game.actors).find(
    (a) => a.id === spec.storageActorId,
  );
  const reference = Array.from(storage?.items ?? []).find(
    (i) => i.id === spec.storageItemId,
  );
  if (reference) {
    if (!game.user || !storage!.testUserPermission(game.user, "OWNER"))
      throw new Error(
        "You do not have permission to use this character's project container.",
      );
    const link = reference.getFlag?.(MODULE_ID, "techProjectReference") as
      { projectId?: string; sourceUuid?: string } | undefined;
    if (link?.projectId !== projectId || link.sourceUuid !== item.uuid)
      throw new Error(
        "The project reference does not match the original Item. GM review is required.",
      );
  }
  const update: Record<string, unknown> = {};
  // Preserve a deliberate rename made while the project was running.
  if (item.name === markedName(spec)) update.name = spec.originalName;
  const system = item.system as {
    description?: { value?: string };
    isHeadLocation?: boolean;
    isBodyLocation?: boolean;
    isShield?: boolean;
    shieldHitPoints?: { max: number };
    headLocation?: { ablation: number };
    bodyLocation?: { ablation: number };
  };
  if (!cancel && spec.mode === "upgrade" && spec.description.trim())
    update["system.description.value"] =
      (system.description?.value ?? "") +
      "<p><strong>TECH upgrade notes:</strong> " +
      escape(spec.description) +
      "</p>";
  if (!cancel && spec.mode === "repair" && item.type === "armor") {
    if (system.isHeadLocation && system.headLocation)
      update["system.headLocation.ablation"] = 0;
    if (system.isBodyLocation && system.bodyLocation)
      update["system.bodyLocation.ablation"] = 0;
    if (system.isShield && Number.isFinite(system.shieldHitPoints?.max))
      update["system.shieldHitPoints.value"] = system.shieldHitPoints!.max;
  }
  await guard({
    projectId,
    action: cancel ? "Cancel inventory project" : "Complete inventory project",
    sourceUuid: item.uuid,
    update,
    destinationActorId: storage?.id,
    destinationItemId: reference?.id,
  });
  if (Object.keys(update).length) await item.update(update);
  // Delete only the reference document; never uninstall or delete the original.
  if (reference) await storage!.deleteEmbeddedDocuments("Item", [reference.id]);
  return item;
}
