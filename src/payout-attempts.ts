import { MODULE_ID } from "./constants";
import { withGMAction } from "./action-coordinator";
import { withResourceLock } from "./resource-lock";
import {
  ensureRecordJournal,
  findRecordJournal,
  readRecord,
  writeRecord,
  recordEscape,
  readableRecord,
  storedDetails,
} from "./journal-records";
import { getPayoutLedger } from "./payout-ledger";
import type { PayoutRecord } from "./payout-record";
import type { PayoutPlan } from "./payout-execution";

export interface PayoutAttempt {
  id: string;
  record: PayoutRecord;
  status: "pending" | "completed" | "rolledBack" | "needsReview" | "resolved";
  steps: Array<{
    label: string;
    status: "started" | "finished";
    details?: unknown;
  }>;
  error?: string;
  resolution?: { userId: string; date: string; notes: string };
}
function attempts(): PayoutAttempt[] {
  const journal = findRecordJournal("payoutAttempts");
  return Array.from(journal?.pages ?? [])
    .flatMap((page) => {
      const key = page.getFlag?.(MODULE_ID, "recordKey");
      return typeof key === "string"
        ? [readRecord<PayoutAttempt>(journal, key, null!)]
        : [];
    })
    .filter(Boolean);
}
export function unresolvedPayoutAttempts(): PayoutAttempt[] {
  const completed = new Set(getPayoutLedger().records.map((r) => r.id));
  return attempts().filter(
    (a) =>
      a.status === "needsReview" ||
      (a.status === "pending" && !completed.has(a.id)),
  );
}
export async function savePayoutAttempt(attempt: PayoutAttempt): Promise<void> {
  if (!game.user?.isGM)
    throw new Error("Only a GM can record payout recovery.");
  const journal = await ensureRecordJournal(
    "payoutAttempts",
    "Payout Recovery",
    "gm",
  );
  await writeRecord(
    journal,
    attempt.id,
    attempt.record.sessionLabel || "Payout",
    attempt,
    "Payout recovery",
    "<p>A payout attempt is saved before rewards change. Started steps may have persisted even without a finished checkpoint. Review Actor resources, items, Journals, receipts, Humanity prompts and GameTime before resolving an interrupted payout.</p>" +
      readableRecord(attempt) +
      storedDetails(attempt),
  );
}
export async function beginPayoutAttempt(
  record: PayoutRecord,
  plan: PayoutPlan,
): Promise<PayoutAttempt> {
  if (unresolvedPayoutAttempts().length)
    throw new Error(
      "An interrupted payout needs review. Open Review Interrupted Payouts in the GM Dashboard before applying another payout.",
    );
  const attempt: PayoutAttempt = {
    id: record.id,
    record,
    status: "pending",
    steps: [],
  };
  // Preserve item quantities/sources and recipients for manual reconciliation.
  attempt.steps.push({
    label: "Planned item deliveries",
    status: "finished",
    details: {
      actors: plan.actors.map((input) => ({
        actorId: input.actor.id,
        items: input.items,
      })),
      container: plan.payoutContainer?.actor.id,
      communalItems: plan.communalItems,
      advanceDays: plan.advanceDays ?? 0,
    },
  });
  await savePayoutAttempt(attempt);
  return attempt;
}
export async function checkpointPayout<T>(
  attempt: PayoutAttempt,
  label: string,
  action: () => Promise<T>,
  details?: unknown,
): Promise<T> {
  const step = { label, status: "started" as "started" | "finished", details };
  attempt.steps.push(step);
  await savePayoutAttempt(attempt);
  const result = await action();
  if (result !== undefined) step.details = { before: details, result };
  step.status = "finished";
  await savePayoutAttempt(attempt);
  return result;
}
export async function resolvePayoutAttempt(
  id: string,
  notes: string,
): Promise<void> {
  if (!game.user?.isGM)
    throw new Error("Only a GM can resolve an interrupted payout.");
  return withGMAction(() =>
    withResourceLock(async () => {
      if (!notes.trim() || notes.length > 2000)
        throw new Error("Enter reconciliation notes (up to 2000 characters).");
      const attempt = unresolvedPayoutAttempts().find((a) => a.id === id);
      if (!attempt) throw new Error("This payout no longer needs review.");
      attempt.status = "resolved";
      attempt.resolution = {
        userId: game.user!.id,
        date: new Date().toISOString(),
        notes: notes.trim(),
      };
      await savePayoutAttempt(attempt);
    }),
  );
}
class PayoutRecoveryDialog extends Dialog {
  private saving = false;
  override async submit(button: DialogButtonConfig): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await button.callback?.(this.element);
      await this.close();
    } catch (error) {
      ui.notifications.error(String(error));
    } finally {
      this.saving = false;
    }
  }
}
export function openPayoutRecovery(): void {
  if (!game.user?.isGM)
    throw new Error("Only a GM can review interrupted payouts.");
  const pending = unresolvedPayoutAttempts();
  if (!pending.length) {
    ui.notifications.info("No interrupted payouts need review.");
    return;
  }
  const journal = findRecordJournal("payoutAttempts");
  journal?.sheet?.render(true);
  const dialog = new PayoutRecoveryDialog({
    title: "Review Interrupted Payouts",
    content: `<p>Review the saved attempt in the Payout Recovery Journal. Started steps may already have applied. Correct any partial rewards using the Actor sheets and Crew Tools records before resolving. Resolving never reapplies rewards.</p>
      <label>Payout<select name="attempt">${pending.map((a) => `<option value="${recordEscape(a.id)}">${recordEscape(a.record.sessionLabel || a.id)}</option>`).join("")}</select></label>
      <label>Reconciliation notes<textarea name="notes" maxlength="2000"></textarea></label>
      <label><input type="checkbox" name="reviewed"> I inspected and reconciled this payout's rewards and records.</label>`,
    buttons: {
      resolve: {
        label: "Mark Reconciled",
        callback: async (html) => {
          const root = html[0];
          if (
            !root?.querySelector<HTMLInputElement>('[name="reviewed"]')?.checked
          ) {
            throw new Error(
              "Inspect and reconcile the payout before marking it resolved.",
            );
          }
          await resolvePayoutAttempt(
            root.querySelector<HTMLSelectElement>('[name="attempt"]')!.value,
            root.querySelector<HTMLTextAreaElement>('[name="notes"]')!.value,
          );
          ui.notifications.info("Payout reconciliation recorded.");
        },
      },
      cancel: { label: "Close" },
    },
    default: "cancel",
  });
  dialog.render(true);
}
