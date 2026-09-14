import { activityHtml } from "./downtime-journal-view";
export { activityHtml } from "./downtime-journal-view";
import { MODULE_ID } from "./constants";
import {
  actorPayoutJournal,
  ensureActorPayoutJournal,
  recordPage,
} from "./journal-records";
import {
  hustleDays,
  downtimeBalance,
  type DowntimeState,
} from "./downtime-model";
import type { ActivityRecord } from "./activity-records";

// Character pages own separate concerns; the service assembles a transient model for calculations.
export function resourcePage(actorId: string) {
  return Array.from(actorPayoutJournal(actorId)?.pages ?? []).find(
    (p) => p.getFlag?.(MODULE_ID, "kind") === "actorLedger",
  );
}
// HUD reads this scalar without loading or replaying transaction history.
export function storedDowntimeBalance(actorId: string): number {
  const balance = resourcePage(actorId)?.getFlag?.(
    MODULE_ID,
    "downtimeBalance",
  );
  if (
    typeof balance !== "number" ||
    !Number.isSafeInteger(balance) ||
    balance < 0
  )
    throw new Error("Character downtime balance is unavailable.");
  return balance;
}
const hustleCache = new WeakMap<object, number>();
export function storedHustleDays(actorId: string): number {
  const page = resourcePage(actorId);
  const stored = page?.getFlag?.(MODULE_ID, "hustleDays");
  if (typeof stored === "number" && Number.isSafeInteger(stored) && stored >= 0)
    return stored;
  const state = page?.getFlag?.(MODULE_ID, "downtime") as
    DowntimeState | undefined;
  if (!state) throw new Error("Character hustle progress is unavailable.");
  // Cache legacy reads until maintenance or the next transaction stores the scalar.
  let days = hustleCache.get(state);
  if (days === undefined) {
    days = hustleDays(state, actorId);
    hustleCache.set(state, days);
  }
  return days;
}
export function activityPage(actorId: string) {
  return recordPage(actorPayoutJournal(actorId), "activities");
}
export function activityRecords(actorId: string): ActivityRecord[] {
  return structuredClone(
    (activityPage(actorId)?.getFlag?.(MODULE_ID, "activities") as
      ActivityRecord[] | undefined) ?? [],
  );
}
export async function saveActivities(
  actorId: string,
  records: ActivityRecord[],
  clearMedicalAttempt = false,
) {
  const page = activityPage(actorId);
  if (!page) throw new Error("Character Active Projects page is missing.");
  await page.update({
    ["flags." + MODULE_ID + ".activities"]: records,
    ...(clearMedicalAttempt
      ? { ["flags." + MODULE_ID + ".medicalAttempt"]: null }
      : {}),
    "text.content": activityHtml(records),
  });
}
export async function ensureCharacterPages(
  actor: FoundryActor,
  state: DowntimeState,
  content: string,
) {
  const journal =
    actorPayoutJournal(actor.id) ?? (await ensureActorPayoutJournal(actor));
  if (!resourcePage(actor.id))
    await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name: "Downtime Log",
        type: "text",
        flags: {
          [MODULE_ID]: {
            kind: "actorLedger",
            downtime: state,
            downtimeBalance: downtimeBalance(state, actor.id),
            hustleDays: hustleDays(state, actor.id),
          },
        },
        text: { content },
      },
    ]);
  if (!activityPage(actor.id))
    await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name: "Active Projects",
        type: "text",
        flags: { [MODULE_ID]: { recordKey: "activities", activities: [] } },
        text: { content: activityHtml([]) },
      },
    ]);
}

export async function saveCharacterState(
  state: DowntimeState,
  content: string,
) {
  const account = state.accounts[0];
  if (!account) throw new Error("Choose a character account.");
  const records = (state.activities ?? []).filter(
    (r) => r.actorId === account.actorId,
  );
  const { activities, ...transactions } = state;
  const previous = activityRecords(account.actorId);
  const changed = JSON.stringify(previous) !== JSON.stringify(records);
  const page = activityPage(account.actorId);
  const previousContent = page?.text?.content ?? "";
  if (changed) await saveActivities(account.actorId, records);
  try {
    await resourcePage(account.actorId)!.update({
      ["flags." + MODULE_ID + ".downtime"]: transactions,
      ["flags." + MODULE_ID + ".hustleDays"]: hustleDays(
        state,
        account.actorId,
      ),
      ["flags." + MODULE_ID + ".downtimeBalance"]: downtimeBalance(
        state,
        account.actorId,
      ),
      "text.content": content,
    });
  } catch (error) {
    // A failed charge must not leave a newly created or advanced activity behind.
    if (changed) {
      try {
        await page!.update({
          ["flags." + MODULE_ID + ".activities"]: previous,
          "text.content": previousContent,
        });
      } catch (rollbackError) {
        throw new Error(
          "Character resource save failed and Active Projects could not be restored. Check the character Journal before retrying.",
          { cause: rollbackError },
        );
      }
    }
    throw error;
  }
}
