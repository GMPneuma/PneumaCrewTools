import { isNetrunner } from "./netrunner-system";
// Read the embedded Items directly so opening and managing a deck always uses the native document.
export function netrunnerPanel(actor?: FoundryActor) {
  return {
    visible: isNetrunner(actor),
    decks: Array.from(actor?.items ?? [])
      .filter((item) => item.type === "cyberdeck")
      .map((item) => {
        const state =
          (item.system as { equipped?: string }).equipped ?? "owned";
        return {
          id: item.id,
          name: item.name,
          img: item.img,
          state: game.i18n.localize("CPR.global.equipState." + state),
          icon:
            state === "equipped"
              ? "fas fa-hand"
              : state === "carried"
                ? "fas fa-suitcase"
                : "fas fa-circle-notch",
        };
      }),
  };
}
export async function deckAction(
  actorId: string,
  itemId: string,
  action: string,
  event: Event,
) {
  const actor = game.actors.get(actorId);
  if (
    !actor ||
    !game.user ||
    (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER"))
  )
    throw new Error("You do not control this Netrunner.");
  if (!isNetrunner(actor))
    throw new Error("A ranked Netrunner role is required.");
  const item = Array.from(actor.items ?? []).find(
    (i) => i.id === itemId && i.type === "cyberdeck",
  );
  if (!item) throw new Error("Cyberdeck no longer exists in this inventory.");
  if (action === "open") {
    item.sheet?.render(true);
    return;
  }
  // CPR v12 handlers enforce the single-equipped-deck rule and update installed Items together.
  if (action === "equip") {
    const sheet = actor.sheet as unknown as {
      _cycleEquipState?: (event: Event) => void;
    };
    if (!sheet?._cycleEquipState)
      throw new Error("The native equipment control is unavailable.");
    sheet._cycleEquipState(event);
  } else if (action === "programs" || action === "upgrades") {
    const sheet = item.sheet as unknown as {
      _manageInstalledItems?: (type: string) => Promise<void>;
    };
    if (!sheet?._manageInstalledItems)
      throw new Error("The native cyberdeck manager is unavailable.");
    await sheet._manageInstalledItems(
      action === "programs" ? "program" : "itemUpgrade",
    );
  }
}
export function bindNetrunner(root: HTMLElement, actorId: string) {
  root.querySelectorAll<HTMLElement>("[data-deck-action]").forEach((button) => {
    // Icon links retain keyboard activation without native button styling.
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        button.click();
      }
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void deckAction(
        actorId,
        button.dataset.itemId!,
        button.dataset.deckAction!,
        event,
      ).catch((error) =>
        ui.notifications.error(
          error instanceof Error ? error.message : String(error),
        ),
      );
    });
  });
}
