// Export metadata and cleanup selection contain no Foundry writes.
export const DATA_CATEGORIES = [
  "Payouts",
  "Characters",
  "Factions",
  "Headquarters",
  "Configuration",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];
// Native document JSON has heterogeneous nested schemas for inspection and export.
export type JsonObject = Record<string, any>;
export interface BackupEntry {
  kind: "journal" | "actor" | "item" | "table" | "setting" | "folder";
  id: string;
  parentId?: string;
  name: string;
  category: DataCategory;
  data: JsonObject;
}
export interface ModuleBackup {
  format: "pneuma-crewtools-backup";
  schemaVersion: 1;
  createdAt: string;
  worldId: string;
  moduleVersion: string;
  entries: BackupEntry[];
}
export const NAMESPACE = "pneuma-crewtools";
export const moduleFlags = (data: JsonObject): JsonObject =>
  data.flags?.[NAMESPACE] ?? {};
// Derive grouping from document identity, using native document flags.
export function categoryFor(
  kind: BackupEntry["kind"],
  data: JsonObject,
): DataCategory {
  const flags = moduleFlags(data);
  if (kind === "setting") return "Configuration";
  if (kind === "table") return "Payouts";
  if (flags.recordKind === "factions") return "Factions";
  if (flags.headquarters || flags.hq || flags.kind === "headquarters")
    return "Headquarters";
  if (["payoutReference", "payoutLedger"].includes(flags.recordKind))
    return "Payouts";
  return "Characters";
}

export const CLEANUP_LABELS = {
  pendingReceipts: "Unacknowledged receipts",
  receipts: "Acknowledged receipt history",
  pendingHumanity: "Pending Humanity rolls",
  humanity: "Completed Humanity history",
  attendance: "Attendance",
  reputation: "Faction reputation",
  history: "Payout history",
} as const;
export type CleanupKind = keyof typeof CLEANUP_LABELS;
export function cleanupKey(kind: CleanupKind): string {
  return {
    pendingReceipts: "acknowledgments",
    receipts: "acknowledgments",
    pendingHumanity: "humanity",
    humanity: "humanity",
    attendance: "attendance",
    reputation: "factionReputation",
    history: "",
  }[kind];
}
export function matchesCleanup(
  row: JsonObject,
  kind: CleanupKind,
  actorId = "",
): boolean {
  if (actorId && row.actorId !== actorId) return false;
  if (kind === "pendingReceipts") return row.acknowledgedAt === null;
  if (kind === "receipts")
    return typeof row.acknowledgedAt === "string" && !!row.acknowledgedAt;
  if (kind === "pendingHumanity") return !row.resolvedAt;
  if (kind === "humanity") return !!row.resolvedAt;
  return true;
}

// The preview identifies missing ID references without guessing from character names.
export function missingReferences(
  data: unknown,
  actors: Set<string>,
  users: Set<string>,
): string[] {
  const missing = new Set<string>();
  const visit = (value: unknown, field = "") => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (/actorId$/i.test(key) ||
          ["sourceId", "targetId", "upgradeProjectsFor"].includes(key)) &&
        typeof child === "string" &&
        child &&
        !actors.has(child)
      )
        missing.add("Missing Actor: " + child);
      if (
        /userId$/i.test(key) &&
        typeof child === "string" &&
        child &&
        !users.has(child)
      )
        missing.add("Missing User: " + child);
      if (key === "ownership" && child && typeof child === "object")
        for (const id of Object.keys(child))
          if (id !== "default" && !users.has(id))
            missing.add("Missing permission User: " + id);
      if (
        field === "actorIds" &&
        typeof child === "string" &&
        !actors.has(child)
      )
        missing.add("Missing Actor: " + child);
      visit(child, key);
    }
  };
  visit(data);
  return [...missing];
}
