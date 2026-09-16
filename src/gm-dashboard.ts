import { openPayoutHistoryExport } from "./payout-history-export";
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

// Only close adjustment dialogs after validation and persistence succeed.
class AdjustmentDialog extends Dialog {
  private saving = false;
  override async submit(button: DialogButtonConfig): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await button.callback?.(this.element);
      await this.close();
    } catch (error) {
      report(error);
    } finally {
      this.saving = false;
    }
  }
}

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
            new AdjustmentDialog({
              title: "Adjust Player Downtime",
              content:
                '<div class="pneuma-crewtools crew-downtime-adjustment"><label class="crew-adjustment-field">Character<select name="actorId">' +
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
                '</select></label><div class="crew-adjustment-balance"><span>Current downtime</span><strong data-current-days aria-live="polite"></strong></div><label class="crew-adjustment-field">Adjust days by<input type="number" name="adjustment" step="1" value="0" aria-describedby="crew-adjustment-hint"></label><p id="crew-adjustment-hint" class="notes">Positive adds days; negative removes days.</p><label class="crew-adjustment-field">Reason<input type="text" name="reason" required maxlength="500" placeholder="Reason for this adjustment"></label></div>',
              render: (html) => {
                const root = html[0];
                // Scope spacing to this dialog without changing other native dialogs.
                root
                  ?.closest(".app")
                  ?.classList.add("crew-downtime-adjustment-dialog");
                const select =
                  root?.querySelector<HTMLSelectElement>('[name="actorId"]');
                const refresh = () => {
                  const value = root?.querySelector("[data-current-days]");
                  if (value && select) {
                    try {
                      value.textContent = `${storedDowntimeBalance(select.value)} days`;
                      value.removeAttribute("title");
                    } catch {
                      value.textContent = "Unavailable";
                      value.setAttribute(
                        "title",
                        "No valid saved downtime balance is available for this character.",
                      );
                    }
                  }
                };
                select?.addEventListener("change", refresh);
                refresh();
              },
              buttons: {
                apply: {
                  label: "Apply Adjustment",
                  callback: async (html) => {
                    const root = html[0];
                    const adjustment = {
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
                    };
                    await adjustPlayerDowntime(
                      adjustment.actorId,
                      adjustment.amount,
                      adjustment.reason,
                    );
                    resolve(adjustment);
                  },
                },
                cancel: { label: "Cancel", callback: () => resolve(null) },
              },
              default: "apply",
              close: () => resolve(null),
            }).render(true);
          });
          if (adjustment) {
            ui.notifications.info(
              "Downtime adjusted and recorded in the Downtime Log.",
            );
          }
          break;
        }
        case "hqIp": {
          // Shared HQ IP belongs to the world, independent of the selected headquarters.
          await new Promise<{
            amount: number;
            reason: string;
          } | null>((resolve) => {
            new AdjustmentDialog({
              title: "Adjust Shared HQ IP",
              content: `<div class="pneuma-crewtools hq-ip-adjustment">
                <div class="hq-ip-balance"><span>Shared HQ IP</span><strong>${headquartersIp().toLocaleString("en-US")}</strong></div>
                <div class="hq-ip-fields">
                  <label for="crew-hq-ip-adjustment">Adjust by</label>
                  <input id="crew-hq-ip-adjustment" type="number" name="ipAdjustment" step="1" value="0" aria-describedby="crew-hq-ip-hint">
                  <p id="crew-hq-ip-hint" class="hq-ip-hint">Positive adds IP; negative removes IP.</p>
                  <label for="crew-hq-ip-reason">Reason</label>
                  <input id="crew-hq-ip-reason" type="text" name="ipReason" required maxlength="200" placeholder="What is this adjustment for?">
                </div>
              </div>`,
              render: (html: FoundryHtml) => {
                html[0]?.closest(".app")?.classList.add("crew-hq-ip-dialog");
              },
              buttons: {
                apply: {
                  label: "Apply Adjustment",
                  callback: async (html: FoundryHtml) => {
                    const adjustment = {
                      amount: Number(
                        html[0]?.querySelector<HTMLInputElement>(
                          '[name="ipAdjustment"]',
                        )?.value,
                      ),
                      reason:
                        html[0]?.querySelector<HTMLInputElement>(
                          '[name="ipReason"]',
                        )?.value ?? "",
                    };
                    await adjustHeadquartersIp(
                      adjustment.amount,
                      adjustment.reason,
                    );
                    resolve(adjustment);
                  },
                },
                cancel: { label: "Cancel", callback: () => resolve(null) },
              },
              default: "apply",
              close: () => resolve(null),
            }).render(true);
          });

          break;
        }
        case "playerHub":
          openPlayerHub();
          break;
        case "rent": {
          // Leave rent records unchanged unless the GM explicitly confirms.
          const confirmed = await new Promise<boolean>((resolve) => {
            new Dialog({
              title: "Mark Rent Due",
              content:
                "<p>Mark rent and lifestyle due for the current campaign month? This adds amounts due for eligible characters and headquarters; it does not deduct money.</p>",
              buttons: {
                confirm: {
                  label: "Mark Rent Due",
                  callback: () => resolve(true),
                },
                cancel: { label: "Cancel", callback: () => resolve(false) },
              },
              default: "cancel",
              close: () => resolve(false),
            }).render(true);
          });
          if (confirmed)
            ui.notifications.info(
              "Rent and lifestyle are due: " + (await issueRent()),
            );
          break;
        }
        case "exportPayout":
          openPayoutHistoryExport();
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
