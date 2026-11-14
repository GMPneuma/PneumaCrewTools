import { registerShortcutDisplay, showHudShortcuts } from "./shortcut-display";
import { openGMDashboard } from "./window-controls";
import { rentNeedsAttention } from "./rent";
import { MODULE_ID } from "./constants";
import { coalesceRefresh, isCrewPage } from "./ui-refresh";
import { excludedActorIds } from "./actor-policy";
import { getIndex } from "./downtime-store";
import { storedDowntimeBalance } from "./downtime-records";
import { openPlayerHub, waitingPayoutCount } from "./payout-inbox";
import { addPlayerSettingsGear } from "./player-settings";

let ready = false;
let mapButton: HTMLButtonElement | undefined;
let observedHud: HTMLElement | null = null;
let mapAnchor: ResizeObserver | undefined;
let mapPositionFrame = 0;
function scheduleSceneList(): void {
  if (!mapPositionFrame) mapPositionFrame = requestAnimationFrame(() => { mapPositionFrame = 0; positionSceneList(); });
}

function positionSceneList(): void {
  const hud = document.getElementById("pneuma-crewtools-calendar");
  if (!hud) return;
  const bounds = hud.getBoundingClientRect();
  const controls = document.getElementById("controls");
  const buttons = Array.from(
    controls?.querySelectorAll(".scene-control, .control-tool") ?? [],
  )
    .map((button) => button.getBoundingClientRect())
    .filter((rect) => rect.width && rect.height);
  const edge = buttons.length
    ? Math.max(...buttons.map((rect) => rect.right))
    : controls?.getBoundingClientRect().right;
  const set = (name: string, value: string) => {
    if (document.body.style.getPropertyValue(name) !== value) document.body.style.setProperty(name, value);
  };
  set(
    "--pneuma-map-left",
    Math.max(bounds.left, edge ? edge + 8 : 0) + "px",
  );
  set(
    "--pneuma-native-map-left",
    bounds.right + 8 + "px",
  );
  set("--pneuma-map-top", bounds.bottom + 4 + "px");
}

function closeSceneList(): void {
  mapButton?.setAttribute("aria-expanded", "false");
}

// One stable hub button preserves focus while status updates.
function button(
  action: string,
  icon: string,
  open: () => unknown,
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset.hudAction = action;
  const glyph = document.createElement("i");
  glyph.className = icon;
  glyph.setAttribute("aria-hidden", "true");
  element.append(glyph);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    open();
  });
  return element;
}

export function refreshCrewHud(): void {
  if (!ready) return;
  const root = document.getElementById("pneuma-crewtools-calendar");
  if (root !== observedHud) {
    mapAnchor?.disconnect();
    observedHud = root;
    if (root) {
      mapAnchor ??= new ResizeObserver(scheduleSceneList);
      mapAnchor.observe(root);
      positionSceneList();
    }
  }
  if (root) addPlayerSettingsGear(root);
  if (!root || !showHudShortcuts()) {
    mapButton = undefined;
    root?.querySelector(".pneuma-crew-hud")?.remove();
    return;
  }
  let row = root.querySelector<HTMLElement>(".pneuma-crew-hud");
  if (!row) {
    row = document.createElement("div");
    row.className = "pneuma-crew-hud";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Crew Tools shortcuts");
    row.append(
      button("hub", "fas fa-users", () => {
        if (game.user?.isGM) openGMDashboard();
        else openPlayerHub();
      }),
    );
    root.insertBefore(row, root.querySelector(".pneuma-external-shortcut"));
  }
  if (!game.settings.get(MODULE_ID, "replaceMapControl")) {
    mapButton?.remove();
    mapButton = undefined;
  } else if (!mapButton || mapButton.parentElement !== row) {
    mapButton = button("maps", "fas fa-map", () => {
      const open = mapButton!.getAttribute("aria-expanded") !== "true";
      mapButton!.setAttribute("aria-expanded", String(open));
      if (open) {
        document.dispatchEvent(new Event("pneumaCrewMapOpened"));
        positionSceneList();
        void ui.navigation?.expand();
      }
    });
    mapButton.title = "Scene navigation";
    mapButton.setAttribute("aria-label", mapButton.title);
    mapButton.setAttribute("aria-controls", "scene-list");
    closeSceneList();
    row.append(mapButton);
  }
  if (mapButton)
    mapButton.dataset.layout = String(
      game.settings.get(MODULE_ID, "mapListLayout"),
    );
  const hub = row.querySelector<HTMLButtonElement>('[data-hud-action="hub"]')!;
  const crew = game.user?.isGM ? "crew " : "";
  const payouts = waitingPayoutCount();
  // A broken ledger is unknown, never a misleading zero. Opening the form exposes the error.
  let days: number | null;
  try {
    const state = getIndex();
    const excluded = excludedActorIds();
    days = state.accounts
      .filter((account) => {
        if (excluded.has(account.actorId)) return false;
        if (game.user?.isGM) return true;
        const actor = game.actors.get(account.actorId);
        return (
          actor?.type === "character" &&
          game.user &&
          actor.testUserPermission(game.user, "OWNER")
        );
      })
      .reduce(
        (sum, account) => sum + storedDowntimeBalance(account.actorId),
        0,
      );
  } catch {
    days = null;
  }
  const rent = rentNeedsAttention();
  const text = `${game.user?.isGM ? "GM Hub" : "Player Hub"} — ${payouts} ${crew}payout acknowledgments waiting; ${days === null ? "downtime status unavailable" : days + " unspent " + crew + "downtime days"}${rent ? "; rent or lifestyle needs attention" : ""}`;
  hub.title = text;
  hub.setAttribute("aria-label", text);
  hub.classList.toggle(
    "has-attention",
    payouts > 0 || (days !== null && days > 0) || rent,
  );
  hub.classList.toggle("status-unavailable", days === null);
}

export function registerCrewHud(): void {
  document.addEventListener("pneumaCrewBiomonitorOpened", closeSceneList);
  game.settings.register(MODULE_ID, "replaceMapControl", {
    name: "Replace Foundry Map Control Button",
    hint: "Show scene navigation in the Crew HUD. Turn off to use Foundry’s own control beside the HUD.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshCrewHud,
  });
  game.settings.register(MODULE_ID, "mapListLayout", {
    name: "Crew HUD Map List Layout",
    hint: "Arrangement of scenes when Crew Tools replaces the map control.",
    scope: "client",
    config: true,
    type: String,
    default: "normal",
    choices: { normal: "Normal (horizontal)", vertical: "Vertical" },
    onChange: refreshCrewHud,
  });
  Hooks.on("renderSceneControls", scheduleSceneList);
  window.addEventListener("resize", scheduleSceneList);
  document.addEventListener("contextmenu", (event) => {
    if (mapButton?.getAttribute("aria-expanded") !== "true") return;
    const scene = event.target instanceof Element && event.target.closest<HTMLElement>("#navigation #scene-list .scene");
    if (!scene) return;
    const bounds = scene.getBoundingClientRect();
    scene.style.setProperty("--pneuma-menu-left", bounds.left + "px");
    scene.style.setProperty("--pneuma-menu-edge", bounds.bottom + "px");
    scene.style.setProperty("--pneuma-menu-above", bounds.top + "px");
    scene.toggleAttribute("data-pneuma-menu-up", bounds.top > innerHeight - bounds.bottom);
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (
      event.target instanceof Element &&
      !event.target.closest('#navigation, [data-hud-action="maps"]')
    )
      closeSceneList();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      mapButton?.getAttribute("aria-expanded") === "true"
    ) {
      closeSceneList();
      mapButton.focus();
    }
  });
  registerShortcutDisplay(refreshCrewHud);
  const refresh = coalesceRefresh(refreshCrewHud);
  const refreshPage = (page: FoundryJournalPage) => {
    if (isCrewPage(page)) refresh();
  };
  const refreshJournal = (journal: FoundryJournalEntry) => {
    if (
      ["recordKind", "downtime", "headquarters"].some(
        (key) => journal.getFlag?.(MODULE_ID, key) !== undefined,
      )
    )
      refresh();
  };
  // Status is Journal-driven; unrelated world activity never schedules a HUD read.
  Hooks.on("createJournalEntry", refreshJournal);
  Hooks.on("updateJournalEntry", refreshJournal);
  Hooks.on("deleteJournalEntry", refreshJournal);
  Hooks.on("createJournalEntryPage", refreshPage);
  Hooks.on("updateJournalEntryPage", refreshPage);
  Hooks.on("deleteJournalEntryPage", refreshPage);
}

export function readyCrewHud(): void {
  ready = true;
  refreshCrewHud();
}
