import { getFactionReputations, saveFactionReputations } from "./factions";
import { recordEscape as escapeHtml } from "./journal-format";
import { EXCLUDED_ACTORS_SETTING, isActorExcluded } from "./actor-policy";
import { journalExplanation } from "./journal-explanations";
import { MODULE_ID } from "./constants";
import {
  findRecordJournal,
  ensureRecordJournal,
  readRecord,
  writeRecord,
} from "./journal-records";
import type { PayoutPlan } from "./payout-execution";

export interface HqIpTransaction {
  date: string;
  amount: number;
  reason: string;
}

export interface FactionReputationRecord {
  actorId: string;
  actorName: string;
  reputation: number;
  faction: string;
  factionId?: string;
  reason: string;
}

export interface AttendanceRecord {
  actorId: string;
  actorName: string;
  sessions: number;
  lastSession: string;
}

export interface PayoutJournalData {
  factionReputations: FactionReputationRecord[];
  attendance: AttendanceRecord[];
}

const EMPTY_DATA: PayoutJournalData = {
  factionReputations: [],
  attendance: [],
};

export function registerPayoutJournalSettings(): void {
  Hooks.on("updateSetting", (setting?: { key?: string }) => {
    if (
      setting?.key === MODULE_ID + "." + EXCLUDED_ACTORS_SETTING &&
      game.user?.isGM
    )
      void ensurePayoutJournal().catch((error) =>
        ui.notifications.error(String(error)),
      );
  });
}

export function getPayoutJournalData(): PayoutJournalData {
  const journal = findRecordJournal("payoutReference");
  const value = {
    factionReputations: getFactionReputations(),
    attendance: readRecord(journal, "attendance", []),
  };
  if (!isJournalData(value)) return structuredClone(EMPTY_DATA);
  return structuredClone(value);
}

export type PayoutJournalDataSection = "reputation" | "attendance" | "all";

export async function clearPayoutJournalData(
  section: PayoutJournalDataSection,
): Promise<void> {
  if (!game.user?.isGM)
    throw new Error("Only a GM can clear payout journal data.");
  const journal = await ensurePayoutJournal();
  const updated = getPayoutJournalData();
  if (section === "reputation" || section === "all")
    updated.factionReputations = [];
  if (section === "attendance" || section === "all") updated.attendance = [];
  await renderPayoutJournal(journal, updated);
}

export async function ensurePayoutJournal(): Promise<FoundryJournalEntry> {
  const journal = await ensureRecordJournal(
    "payoutReference",
    "Attendance",
    "crew",
  );
  const data = getPayoutJournalData();
  await writeRecord(
    journal,
    "attendance",
    "Attendance",
    data.attendance,
    "Payout attendance by character.",
    renderAttendancePage(data),
  );
  return journal;
}

export async function applyPayoutToJournal(
  plan: PayoutPlan,
): Promise<() => Promise<void>> {
  const journal = await ensurePayoutJournal();
  const previous = getPayoutJournalData();
  const updated = structuredClone(previous);
  const counted = new Set<string>();
  for (const { actor } of plan.actors) {
    if (isActorExcluded(actor.id) || counted.has(actor.id)) continue;
    counted.add(actor.id);
    const existing = updated.attendance.find(
      ({ actorId }) => actorId === actor.id,
    );
    if (existing) {
      existing.sessions += 1;
      existing.actorName = actor.name;
      existing.lastSession = plan.sessionLabel;
    } else {
      updated.attendance.push({
        actorId: actor.id,
        actorName: actor.name,
        sessions: 1,
        lastSession: plan.sessionLabel,
      });
    }
  }

  for (const reputation of plan.factionReputations) {
    const index = updated.factionReputations.findIndex(
      (row) =>
        row.actorId === reputation.actorId &&
        (reputation.factionId
          ? row.factionId === reputation.factionId
          : row.faction.toLocaleLowerCase() ===
            reputation.faction.toLocaleLowerCase()),
    );
    if (index >= 0) updated.factionReputations[index] = reputation;
    else updated.factionReputations.push(reputation);
  }

  try {
    await saveAndRender(journal, updated);
  } catch (error) {
    try {
      await saveAndRender(journal, previous);
    } catch (rollbackError) {
      throw new Error(
        "Rollback incomplete: Payout Journal. Inspect attendance and faction reputation before retrying. Original error: " +
          (error instanceof Error ? error.message : String(error)),
        { cause: rollbackError },
      );
    }
    throw error;
  }
  return async () => saveAndRender(journal, previous);
}
async function saveAndRender(
  journal: FoundryJournalEntry,
  data: PayoutJournalData,
): Promise<void> {
  await renderPayoutJournal(journal, data);
}

async function renderPayoutJournal(
  journal: FoundryJournalEntry,
  data: PayoutJournalData,
): Promise<void> {
  // Only characters with an existing balance or a new award need this page.
  const existingReputations = getFactionReputations();
  const actorIds = new Set(
    [...existingReputations, ...data.factionReputations].map((r) => r.actorId),
  );
  for (const actorId of actorIds) {
    const actor = game.actors.get(actorId);
    const rows = data.factionReputations.filter((r) => r.actorId === actorId);
    const current = existingReputations.filter((r) => r.actorId === actorId);
    if (actor && JSON.stringify(rows) !== JSON.stringify(current))
      await saveFactionReputations(actor, rows);
  }
  await writeRecord(
    journal,
    "attendance",
    "Attendance",
    data.attendance,
    "Shared payout participation by Actor ID; each applied payout counts once per selected character.",
    renderAttendancePage(data),
  );
}

function renderAttendancePage(data: PayoutJournalData): string {
  return (
    journalExplanation("attendance") +
    table(
      ["Character", "Sessions Played", "Last Session Name"],
      [...data.attendance]
        .filter((row) => !isActorExcluded(row.actorId))
        .sort(
          (a, b) =>
            a.sessions - b.sessions || a.actorName.localeCompare(b.actorName),
        )
        .map(({ actorId, actorName, sessions, lastSession }) => [
          actorReference(actorId, actorName),
          String(sessions),
          lastSession || "—",
        ]),
    )
  );
}

// Foundry enriches UUID references into ordinary clickable Journal links.
function actorReference(id: string, name: string): string {
  const current = game.actors.get(id)?.name ?? name;
  return `@UUID[Actor.${id}]{${current.replace(/[{}]/g, "")}}`;
}
function table(headers: string[], rows: string[][]): string {
  const body = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("")
    : `<tr><td colspan="${headers.length}"><em>No entries yet.</em></td></tr>`;
  return `<table><tbody><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr>${body}</tbody></table>`;
}

function isJournalData(value: unknown): value is PayoutJournalData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.factionReputations) && Array.isArray(data.attendance)
  );
}
