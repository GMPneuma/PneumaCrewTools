import { MODULE_ID } from "./constants";
import { withGMAction } from "./action-coordinator";
import { captureBackup } from "./module-data-service";
import { moduleFlags, type JsonObject } from "./module-data-model";
import { recordSummary } from "./payout-journal-view";
import { storedDetails } from "./journal-format";
import { activityHtml } from "./downtime-journal-view";
import { purgePharmaHistory } from "./pharma-transfer";

type Mode =
  | "receipts"
  | "humanity"
  | "activities"
  | "pharma"
  | "roster"
  | "payouts"
  | "protected";
export interface CleanupRow {
  id: string;
  name: string;
  location: string;
  objectType: string;
  category: string;
  count: number;
  eligible: number;
  bytes: number;
  recommended: number | null;
  note: string;
  mode: Mode;
  journalId?: string;
  pageId?: string;
  actorId?: string;
  key: string;
  snapshot: string;
  data: any;
  raw: JsonObject;
}
export function recordBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}
export function formatRecordSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function safeKeep(keep: number): void {
  if (!Number.isSafeInteger(keep) || keep < 0)
    throw new Error("Keep records must be a non-negative whole number.");
}
function eligible(row: CleanupRow, value: any): boolean {
  if (row.mode === "receipts")
    return typeof value.acknowledgedAt === "string" && !!value.acknowledgedAt;
  if (row.mode === "humanity")
    return typeof value.resolvedAt === "string" && !!value.resolvedAt;
  if (row.mode === "activities")
    return ["completed", "failed", "cancelled"].includes(value.status);
  return row.mode === "roster" || row.mode === "payouts";
}
function recordCount(value: any): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return value == null ? 0 : 1;
  const lists = Object.values(value).filter(Array.isArray) as unknown[][];
  return lists.length ? lists.reduce((n, list) => n + list.length, 0) : 1;
}
function recordCategory(key: string, fallback: string): string {
  if (["customActivities", "factions"].includes(key))
    return "Static setup & reference data";
  if (["acknowledgments", "humanity", "attendance"].includes(key))
    return "Payouts";
  if (["actorLedger", "ledger", "activities"].includes(key))
    return "Downtime & projects";
  if (key === "pharmaTransfers") return "Pharmaceutical transfers";
  if (
    ["headquarters", "hq", "rent", "rentConfig"].includes(key) ||
    fallback === "Headquarters"
  )
    return "Headquarters & rent";
  if (key === "factionReputation" || fallback === "Factions") return "Factions";
  if (["teammates", "nomadVehicles"].includes(key))
    return "Teammates & vehicles";
  return "Other stored data";
}
export function cleanupRows(backup = captureBackup()): CleanupRow[] {
  const folders = new Map(
    backup.entries.filter((e) => e.kind === "folder").map((e) => [e.id, e]),
  );
  const folderPath = (id: unknown): string => {
    const names: string[] = [],
      seen = new Set();
    while (typeof id === "string" && !seen.has(id)) {
      seen.add(id);
      const folder = folders.get(id);
      if (!folder) break;
      names.unshift(folder.name);
      id = folder.data.folder;
    }
    return names.length ? names.join(" → ") + " → " : "";
  };
  const rows: CleanupRow[] = [];
  for (const entry of backup.entries.filter((e) => e.kind !== "folder")) {
    // Module Hustle RollTables are static reference content, not accumulated records.
    if (entry.kind === "table") continue;
    const jf = moduleFlags(entry.data);
    const location =
      (entry.kind === "journal" ? "Journal sidebar → " : `${entry.kind} → `) +
      folderPath(entry.data.folder) +
      entry.name;
    if (entry.kind === "journal" && jf.recordKind === "payoutLedger") {
      const pages = (entry.data.pages ?? []).filter(
        (p: JsonObject) => moduleFlags(p).recordKey,
      );
      // Creation order is stable even when Foundry page sort order is changed.
      pages.sort(
        (a: JsonObject, b: JsonObject) =>
          (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0),
      );
      rows.push({
        id: entry.id,
        name: "Payout history",
        category: "Payouts",
        location,
        objectType: "Journal Entry · payout pages",
        count: pages.length,
        eligible: pages.length,
        bytes: recordBytes(entry.data),
        recommended: 100,
        note: "Keeps the newest payout pages. Awarded resources are unchanged.",
        mode: "payouts",
        journalId: entry.id,
        key: "",
        snapshot: JSON.stringify(entry.data),
        data: pages,
        raw: entry.data,
      });
      continue;
    }
    if (entry.kind !== "journal") {
      rows.push({
        id: `${entry.kind}:${entry.parentId ?? ""}:${entry.id}`,
        name: entry.name,
        category:
          entry.kind === "setting"
            ? "Static setup & reference data"
            : "Other stored data",
        location,
        objectType:
          entry.kind === "setting"
            ? "World setting"
            : entry.kind === "actor"
              ? "Actor · module flags"
              : "Item · module flags",
        count: recordCount(entry.data),
        eligible: 0,
        bytes: recordBytes(entry.data),
        recommended: null,
        note: "Current configuration or native document. Not disposable history.",
        mode: "protected",
        key: "",
        snapshot: JSON.stringify(entry.data),
        data: entry.data,
        raw: entry.data,
      });
      continue;
    }
    for (const page of entry.data.pages ?? []) {
      const flags = moduleFlags(page),
        key = String(flags.recordKey ?? flags.kind ?? "");
      const data =
        flags.data ??
        flags.activities ??
        flags.downtime ??
        flags.headquarters ??
        flags;
      let mode: Mode = "protected",
        note = "Current configuration or linked data; keep all records.",
        recommended: number | null = null;
      if (key === "acknowledgments") {
        mode = "receipts";
        recommended = 50;
        note = "Only acknowledged receipts are removed. Pending receipts stay.";
      } else if (key === "humanity") {
        mode = "humanity";
        recommended = 50;
        note = "Only resolved rolls are removed. Pending rolls stay.";
      } else if (key === "activities") {
        mode = "activities";
        recommended = 50;
        note =
          "Only finished, failed or cancelled projects are removed. Active projects stay.";
      } else if (key === "pharmaTransfers") {
        mode = "pharma";
        recommended = 50;
        note =
          "Only transfers settled on both sides are removed, together with their older chat cards.";
      } else if (["teammates", "nomadVehicles"].includes(key)) {
        mode = "roster";
        recommended = 100;
        note =
          "Removes old change history only. Current slots and Loyalty stay.";
      } else if (key === "actorLedger" || key === "headquarters")
        note =
          "Protected: transaction history is still required to calculate balances and progress.";
      else if (["rent", "hq", "rentConfig"].includes(key))
        note =
          "Protected: billing and settlement records still prevent duplicate charges and refunds.";
      if (
        flags.medicalAttempt ||
        flags.techAttempt ||
        flags.healingAttempt ||
        flags.hustleAttempt
      ) {
        mode = "protected";
        recommended = null;
        note =
          "An interrupted action needs resolution before this history can be purged.";
      }
      const history =
        mode === "roster"
          ? (data.history ?? [])
          : key === "actorLedger"
            ? (data.events ?? [])
            : key === "headquarters"
              ? (data.transactions ?? [])
              : data;
      const row: CleanupRow = {
        id: entry.id + ":" + page._id,
        name: page.name,
        category: recordCategory(key, entry.category),
        location: location + " → " + page.name,
        objectType: "Journal Entry Page",
        count: recordCount(history),
        eligible: 0,
        bytes: recordBytes(page),
        recommended,
        note,
        mode,
        journalId: entry.id,
        pageId: page._id,
        actorId: jf.actorId,
        key,
        snapshot: JSON.stringify(page),
        data,
        raw: page,
      };
      if (mode !== "protected" && mode !== "pharma")
        row.eligible = (Array.isArray(history) ? history : []).filter(
          (r: any) => eligible(row, r),
        ).length;
      rows.push(row);
    }
  }
  const transfers = rows.filter((r) => r.mode === "pharma");
  for (const row of transfers) {
    if (!row.actorId || !game.actors.get(row.actorId)) {
      row.mode = "protected";
      row.recommended = null;
      row.note = "The character Actor is missing; resolve its links first.";
      continue;
    }
    row.eligible = row.data.filter((t: any) => {
      const terminal =
        t.direction === "sent"
          ? ["consumed", "returned"].includes(t.status)
          : ["consumed", "rejected"].includes(t.status);
      if (!terminal) return false;
      if (t.settled) return true;
      const otherId = t.direction === "sent" ? t.targetId : t.sourceId;
      const other = transfers
        .find((r) => r.actorId === otherId)
        ?.data.find(
          (r: any) =>
            r.id === t.id &&
            r.sourceId === t.sourceId &&
            r.targetId === t.targetId &&
            r.direction !== t.direction,
        );
      return (
        !!other &&
        t.itemId === other.itemId &&
        t.amount === other.amount &&
        ((t.status === "consumed" && other.status === "consumed") ||
          (t.status === "returned" && other.status === "rejected") ||
          (t.status === "rejected" && other.status === "returned"))
      );
    }).length;
  }
  const chat = Array.from(game.messages ?? []).filter((m) =>
    ["pharmaOffer", "pharmaResponse", "humanityPrompt"].some((key) =>
      m.getFlag(MODULE_ID, key),
    ),
  );
  const rawChat = chat.map(
    (m) =>
      (m as unknown as { toObject?: () => unknown }).toObject?.() ??
      Object.fromEntries(
        ["pharmaOffer", "pharmaResponse", "humanityPrompt"].map((key) => [
          key,
          m.getFlag(MODULE_ID, key),
        ]),
      ),
  );
  rows.push({
    id: "chat",
    category: "Chat cards",
    name: "Humanity and pharma chat cards",
    location: "Chat log",
    objectType: "ChatMessage",
    count: chat.length,
    eligible: 0,
    bytes: recordBytes(rawChat),
    recommended: null,
    note: "Pharma cards are purged with settled transfers. Pending handoff messages are protected.",
    mode: "protected",
    key: "",
    snapshot: "",
    data: rawChat,
    raw: { messages: rawChat },
  });
  return rows;
}
export function previewRetention(row: CleanupRow, keep: number): number {
  safeKeep(keep);
  return Math.max(0, row.eligible - keep);
}
export async function purgeRecordHistory(
  id: string,
  keep: number,
  expected: string,
): Promise<number> {
  safeKeep(keep);
  if (!game.user?.isGM) throw new Error("Only a GM can purge records.");
  const fresh = () => {
    const row = cleanupRows().find((r) => r.id === id);
    if (!row || row.snapshot !== expected)
      throw new Error(
        "Records changed. Refresh the list and review the purge again.",
      );
    if (row.mode === "protected")
      throw new Error("These records are protected: " + row.note);
    if ([...game.users].some((u) => u.active && u.id !== game.user!.id))
      throw new Error(
        "Have other users disconnect before purging so active saves cannot overwrite each other.",
      );
    return row;
  };
  const initial = fresh();
  if (initial.mode === "pharma") {
    await purgePharmaHistory(keep, initial.actorId, () => {
      fresh();
    });
    const after = cleanupRows().find((r) => r.id === id);
    return initial.count - (after?.count ?? 0);
  }
  return withGMAction(async () => {
    const row = fresh();
    const count = previewRetention(row, keep);
    if (!count) return 0;
    const journal = Array.from(game.journal).find(
      (j) => j.id === row.journalId,
    )!;
    if (row.mode === "payouts") {
      await journal.deleteEmbeddedDocuments(
        "JournalEntryPage",
        row.data.slice(0, count).map((p: JsonObject) => p._id),
      );
      return count;
    }
    const page = Array.from(journal.pages).find((p) => p.id === row.pageId)!;
    const values = row.mode === "roster" ? row.data.history : row.data;
    // Receipt writes regroup rows by owner, so array order is not always age order.
    const candidates = values
      .map((value: any, index: number) => ({ value, index }))
      .filter(({ value }: { value: any }) => eligible(row, value));
    if (row.mode === "receipts" || row.mode === "humanity")
      candidates.sort(
        (a: { value: any; index: number }, b: { value: any; index: number }) =>
          (Date.parse(a.value.createdAt) || 0) -
            (Date.parse(b.value.createdAt) || 0) || a.index - b.index,
      );
    const discarded = new Set(
      candidates.slice(0, count).map(({ index }: { index: number }) => index),
    );
    const remaining = values.filter(
      (_value: any, index: number) => !discarded.has(index),
    );
    const data =
      row.mode === "roster" ? { ...row.data, history: remaining } : remaining;
    await page.update({
      [`flags.${MODULE_ID}.${row.mode === "activities" ? "activities" : "data"}`]:
        data,
      "text.content":
        row.mode === "activities"
          ? activityHtml(data)
          : recordSummary(row.key, data) +
            storedDetails(
              data,
              "Crew Tools records. Purging history does not reverse resource changes.",
            ),
    });
    return count;
  });
}
