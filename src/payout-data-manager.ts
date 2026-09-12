import {
  MODULE_ID,
  PAYOUT_JOURNAL_ID_SETTING,
  PAYOUT_LOG_JOURNAL_ID_SETTING,
} from "./constants";
import {
  clearAllPendingHumanityRolls,
  getPendingHumanityRolls,
} from "./humanity-prompts";
import { clearAllPayoutAcknowledgments } from "./payout-inbox";
import { clearPayoutJournalData, getPayoutJournalData } from "./payout-journal";
import { clearPayoutLedger, getPayoutLedger } from "./payout-ledger";
import { clearPayoutLog } from "./payout-log";

type ClearSection =
  | "reputation"
  | "attendance"
  | "hq"
  | "acknowledgments"
  | "humanity"
  | "history"
  | "all";

interface PayoutDataManagerData {
  reputationCount: number;
  attendanceCount: number;
  hqCount: number;
  acknowledgmentCount: number;
  humanityCount: number;
  historyCount: number;
  storedDataJson: string;
}

export function registerPayoutDataManager(): void {
  game.settings.registerMenu(MODULE_ID, "payoutDataManager", {
    name: "Module Data",
    label: "View or Clear Module Data",
    hint: "Inspect and selectively clear recorded or pending PneumaCrewTools data.",
    icon: "fas fa-database",
    type: PayoutDataManager,
    restricted: true,
  });
}

class PayoutDataManager extends FormApplication {
  #busy = false;

  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: `${MODULE_ID}-data-manager`,
      classes: [...(super.defaultOptions.classes ?? []), MODULE_ID],
      title: "PneumaCrewTools: Module Data",
      template: `modules/${MODULE_ID}/templates/payout-data-manager.hbs`,
      width: 720,
      height: 760,
      resizable: true,
    };
  }

  override getData(): PayoutDataManagerData {
    const journalData = getPayoutJournalData();
    const ledger = getPayoutLedger();
    const acknowledgments = Array.from(game.users).flatMap((user) => {
      const entries = user.getFlag(MODULE_ID, "payoutAcknowledgments");
      return Array.isArray(entries)
        ? [{ userId: user.id, userName: user.name, entries }]
        : [];
    });
    const pendingHumanityRolls = Array.from(game.actors).flatMap((actor) => {
      const entries = getPendingHumanityRolls(actor);
      return entries.length
        ? [{ actorId: actor.id, actorName: actor.name, entries }]
        : [];
    });
    const payoutJournal = journalSnapshot(PAYOUT_JOURNAL_ID_SETTING);
    const payoutLog = journalSnapshot(PAYOUT_LOG_JOURNAL_ID_SETTING);
    const acknowledgmentCount = acknowledgments.reduce(
      (total, user) => total + user.entries.length,
      0,
    );
    const humanityCount = pendingHumanityRolls.reduce(
      (total, actor) => total + actor.entries.length,
      0,
    );
    return {
      reputationCount: journalData.factionReputations.length,
      attendanceCount: journalData.attendance.length,
      hqCount:
        journalData.hqImprovements.length + journalData.hqIpTransactions.length,
      acknowledgmentCount,
      humanityCount,
      historyCount: ledger.records.length + (payoutLog?.pages.length ?? 0),
      storedDataJson: JSON.stringify(
        {
          journalReferenceData: journalData,
          internalPayoutLedger: ledger,
          unacknowledgedPayouts: acknowledgments,
          pendingHumanityRolls,
          moduleJournals: { payouts: payoutJournal, payoutLog },
        },
        null,
        2,
      ),
    };
  }

  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    html[0]
      ?.querySelectorAll<HTMLButtonElement>("[data-clear-section]")
      .forEach((button) =>
        button.addEventListener("click", () => void this.#clear(button)),
      );
  }

  protected override async _updateObject(): Promise<void> {}

  async #clear(button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return;
    const section = button.dataset.clearSection;
    if (!isClearSection(section)) return;
    if (!(await confirmClear(section))) return;
    this.#busy = true;
    this.#setButtonsDisabled(true);
    try {
      await clearSection(section);
      ui.notifications.info(`${clearLabel(section)} cleared.`);
      this.render(true);
    } catch (error) {
      ui.notifications.error(
        `Could not clear ${clearLabel(section).toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.#busy = false;
      this.#setButtonsDisabled(false);
    }
  }

  #setButtonsDisabled(disabled: boolean): void {
    document
      .querySelectorAll<HTMLButtonElement>(
        `#${MODULE_ID}-data-manager [data-clear-section]`,
      )
      .forEach((button) => {
        button.disabled = disabled;
      });
  }
}

async function clearSection(section: ClearSection): Promise<void> {
  if (section === "reputation") return clearPayoutJournalData("reputation");
  if (section === "attendance") return clearPayoutJournalData("attendance");
  if (section === "hq") return clearPayoutJournalData("hq");
  if (section === "acknowledgments") {
    await clearAllPayoutAcknowledgments();
    return;
  }
  if (section === "humanity") {
    await clearAllPendingHumanityRolls();
    return;
  }
  if (section === "history") {
    await clearPayoutLedger();
    await clearPayoutLog();
    return;
  }
  await clearPayoutJournalData("all");
  await clearAllPayoutAcknowledgments();
  await clearAllPendingHumanityRolls();
  await clearPayoutLedger();
  await clearPayoutLog();
}

function journalSnapshot(settingKey: string): {
  id: string;
  name: string;
  pages: Array<{ id: string; name: string; content: string }>;
} | null {
  const id = game.settings.get(MODULE_ID, settingKey);
  const journal = typeof id === "string" ? game.journal.get(id) : undefined;
  return journal
    ? {
        id: journal.id,
        name: journal.name,
        pages: Array.from(journal.pages).map((page) => ({
          id: page.id,
          name: page.name,
          content: page.text?.content ?? "",
        })),
      }
    : null;
}

function isClearSection(value: unknown): value is ClearSection {
  return [
    "reputation",
    "attendance",
    "hq",
    "acknowledgments",
    "humanity",
    "history",
    "all",
  ].includes(String(value));
}

function clearLabel(section: ClearSection): string {
  return (
    {
      reputation: "Reputation data",
      attendance: "Attendance data",
      hq: "HQ data",
      acknowledgments: "Unacknowledged payouts",
      humanity: "Pending Humanity rolls",
      history: "Payout history",
      all: "All recorded and pending payout data",
    } satisfies Record<ClearSection, string>
  )[section];
}

function confirmClear(section: ClearSection): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    new Dialog({
      title: `Clear ${clearLabel(section)}?`,
      content: `<p>This permanently clears <strong>${clearLabel(section)}</strong>. Module configuration is preserved.</p>`,
      buttons: {
        clear: {
          icon: '<i class="fas fa-trash"></i>',
          label: "Clear",
          callback: () => answer(true),
        },
        cancel: { label: "Cancel", callback: () => answer(false) },
      },
      default: "cancel",
      close: () => answer(false),
    }).render(true);
  });
}
