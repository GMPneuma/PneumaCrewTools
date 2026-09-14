import { openGMDashboard } from "./window-controls";
import { rentNeedsAttention } from "./rent";
import { MODULE_ID } from "./constants";
import { coalesceRefresh, isCrewPage } from "./ui-refresh";
import { isActorExcluded } from "./actor-policy";
import { getIndex } from "./downtime-store";
import { storedDowntimeBalance } from "./downtime-records";
import { openPlayerHub, waitingPayoutCount } from "./payout-inbox";

let ready = false;

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
  if (!root) return;
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
    root.append(row);
  }
  const hub = row.querySelector<HTMLButtonElement>('[data-hud-action="hub"]')!;
  const crew = game.user?.isGM ? "crew " : "";
  const payouts = waitingPayoutCount();
  // A broken ledger is unknown, never a misleading zero. Opening the form exposes the error.
  let days: number | null;
  try {
    const state = getIndex();
    days = state.accounts
      .filter((account) => {
        if (isActorExcluded(account.actorId)) return false;
        if (game.user?.isGM) return true;
        const actor = Array.from(game.actors).find(
          (a) => a.id === account.actorId,
        );
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
