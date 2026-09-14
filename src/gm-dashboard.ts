import { confirmExpireDowntime } from "./expire-downtime";
import { accessibleCrewActors } from "./actor-policy";
import { storedDowntimeBalance } from "./downtime-records";
import { escape } from "./downtime-store";
import { adjustPlayerDowntime } from "./downtime-service";
import { issueRent } from "./rent";
import { PlayerHub, openPlayerHub } from "./payout-inbox";
import { MODULE_ID } from "./constants";
import { openCampaignCalendar } from "./calendar";
import { openDowntime } from "./downtime";
import { report } from "./downtime-service";
import {
  openHeadquarters,
  adjustHeadquartersIp,
  headquartersIp,
} from "./headquarters";
import { coalesceRefresh, isCrewPage } from "./ui-refresh";

// Reuse the inbox's pending records and guarded GM controls, rather than maintaining another queue.
export class GMDashboard extends PlayerHub {
  private busy = false;
  constructor(private readonly openPayout: () => void) {
    super();
  }
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-gm-dashboard",
      title: "Crew Tools GM Dashboard",
      height: 680,
    };
  }
  override getData() {
    if (!game.user?.isGM) throw new Error("Only a GM can open this dashboard.");
    return { ...super.getData(), gmDashboard: true };
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    html[0]
      ?.querySelectorAll<HTMLButtonElement>("[data-gm-dashboard-action]")
      .forEach((button) => {
        button.addEventListener("click", () => void this.act(button));
      });
  }
  private async act(button: HTMLButtonElement): Promise<void> {
    if (!game.user?.isGM || this.busy) return;
    this.busy = true;
    button.disabled = true;
    try {
      switch (button.dataset.gmDashboardAction) {
        case "adjustDowntime": {
          const actors = accessibleCrewActors();
          if (!actors.length) throw new Error("No eligible player characters.");
          const adjustment = await new Promise<{
            actorId: string;
            amount: number;
            reason: string;
          } | null>((resolve) => {
            new Dialog({
              title: "Adjust Player Downtime",
              content:
                '<div class="form-group"><label>Character</label><select name="actorId">' +
                actors
                  .map(
                    (a) =>
                      '<option value="' +
                      escape(a.id) +
                      '">' +
                      escape(a.name) +
                      "</option>",
                  )
                  .join("") +
                '</select></div><p>Current downtime: <strong data-current-days></strong> days</p><div class="form-group"><label>Adjust days by</label><input type="number" name="adjustment" step="1" value="0"></div><div class="form-group"><label>Reason</label><input type="text" name="reason" maxlength="500"></div>',
              render: (html) => {
                const root = html[0];
                const select =
                  root?.querySelector<HTMLSelectElement>('[name="actorId"]');
                const refresh = () => {
                  const value = root?.querySelector("[data-current-days]");
                  if (value && select) {
                    try {
                      value.textContent = String(
                        storedDowntimeBalance(select.value),
                      );
                    } catch {
                      value.textContent = "Unavailable";
                    }
                  }
                };
                select?.addEventListener("change", refresh);
                refresh();
              },
              buttons: {
                apply: {
                  label: "Apply Adjustment",
                  callback: (html) => {
                    const root = html[0];
                    resolve({
                      actorId:
                        root?.querySelector<HTMLSelectElement>(
                          '[name="actorId"]',
                        )?.value ?? "",
                      amount: Number(
                        root?.querySelector<HTMLInputElement>(
                          '[name="adjustment"]',
                        )?.value,
                      ),
                      reason:
                        root?.querySelector<HTMLInputElement>('[name="reason"]')
                          ?.value ?? "",
                    });
                  },
                },
                cancel: { label: "Cancel", callback: () => resolve(null) },
              },
              default: "apply",
              close: () => resolve(null),
            }).render(true);
          });
          if (adjustment) {
            await adjustPlayerDowntime(
              adjustment.actorId,
              adjustment.amount,
              adjustment.reason,
            );
            ui.notifications.info(
              "Downtime adjusted and recorded in the Downtime Log.",
            );
          }
          break;
        }
        case "hqIp": {
          // Shared HQ IP belongs to the world, independent of the selected headquarters.
          const adjustment = await new Promise<{
            amount: number;
            reason: string;
          } | null>((resolve) => {
            new Dialog({
              title: "Adjust Shared HQ IP",
              content: `<div class="pneuma-crewtools hq-ip-adjustment">
                <div class="hq-ip-balance"><span>Shared HQ IP</span><strong>${headquartersIp().toLocaleString("en-US")}</strong></div>
                <div class="hq-ip-fields">
                  <label for="crew-hq-ip-adjustment">Adjust by</label>
                  <input id="crew-hq-ip-adjustment" type="number" name="ipAdjustment" step="1" value="0" aria-describedby="crew-hq-ip-hint">
                  <p id="crew-hq-ip-hint" class="hq-ip-hint">Positive adds IP; negative removes IP.</p>
                  <label for="crew-hq-ip-reason">Reason</label>
                  <input id="crew-hq-ip-reason" type="text" name="ipReason" maxlength="200" placeholder="What is this adjustment for?">
                </div>
              </div>`,
              render: (html: FoundryHtml) => {
                html[0]?.closest(".app")?.classList.add("crew-hq-ip-dialog");
              },
              buttons: {
                apply: {
                  label: "Apply Adjustment",
                  callback: (html: FoundryHtml) =>
                    resolve({
                      amount: Number(
                        html[0]?.querySelector<HTMLInputElement>(
                          '[name="ipAdjustment"]',
                        )?.value,
                      ),
                      reason:
                        html[0]?.querySelector<HTMLInputElement>(
                          '[name="ipReason"]',
                        )?.value ?? "",
                    }),
                },
                cancel: { label: "Cancel", callback: () => resolve(null) },
              },
              default: "apply",
              close: () => resolve(null),
            }).render(true);
          });
          if (adjustment)
            await adjustHeadquartersIp(adjustment.amount, adjustment.reason);
          break;
        }
        case "playerHub":
          openPlayerHub();
          break;
        case "rent":
          ui.notifications.info(
            "Rent and lifestyle are due: " + (await issueRent()),
          );
          break;
        case "payout":
          this.openPayout();
          break;
        case "calendar":
          openCampaignCalendar();
          break;
        case "downtime":
          openDowntime();
          break;
        case "headquarters":
          openHeadquarters();
          break;
        case "expire":
          await confirmExpireDowntime();
          break;
      }
    } catch (error) {
      report(error);
    } finally {
      this.busy = false;
      button.disabled = false;
    }
  }
}

let dashboard: GMDashboard | undefined;
let listening = false;
export function openDashboard(openPayout: () => void): void {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only a GM can open the GM Dashboard.");
    return;
  }
  if (!listening) {
    listening = true;
    const refresh = coalesceRefresh(() => {
      if (dashboard?.rendered) dashboard.render(false);
    });
    const refreshPage = (page: FoundryJournalPage) => {
      if (dashboard?.rendered && isCrewPage(page)) refresh();
    };
    Hooks.on("createJournalEntryPage", refreshPage);
    Hooks.on("updateJournalEntryPage", refreshPage);
    Hooks.on("deleteJournalEntryPage", refreshPage);
    Hooks.on("deleteJournalEntry", (journal: FoundryJournalEntry) => {
      if (dashboard?.rendered && journal.getFlag?.(MODULE_ID, "recordKind"))
        refresh();
    });
  }
  if (!dashboard?.rendered) dashboard = new GMDashboard(openPayout);
  dashboard.render(true);
}
