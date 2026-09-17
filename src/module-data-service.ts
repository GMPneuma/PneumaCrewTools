import { withGMAction } from "./action-coordinator";
import { storedDetails } from "./journal-format";
import { recordSummary } from "./payout-journal-view";
import {
  categoryFor,
  cleanupKey,
  matchesCleanup,
  missingReferences,
  moduleFlags,
  NAMESPACE,
  CLEANUP_LABELS,
  type BackupEntry,
  type CleanupKind,
  type JsonObject,
  type ModuleBackup,
} from "./module-data-model";

// Native v12 document APIs are isolated here; backup files never receive a live Document.
interface DataDocument {
  _source?: JsonObject;
  flags?: JsonObject;
  id: string;
  name: string;
  pages?: Iterable<DataDocument>;
  items?: Iterable<DataDocument>;
  results?: Iterable<DataDocument>;
  sheet?: { render(force: boolean, options?: object): unknown };
  toObject(): JsonObject;
  update(data: JsonObject, options?: JsonObject): Promise<unknown>;
  createEmbeddedDocuments(
    type: string,
    rows: JsonObject[],
    options?: JsonObject,
  ): Promise<unknown>;
  deleteEmbeddedDocuments(
    type: string,
    ids: string[],
    options?: JsonObject,
  ): Promise<unknown>;
}
interface DataWorld {
  world: { id: string };
  modules: Map<string, { version: string }>;
  journal: Iterable<DataDocument>;
  actors: Iterable<DataDocument>;
  items?: Iterable<DataDocument>;
  tables: Iterable<DataDocument>;
  messages?: Iterable<DataDocument>;
  folders: Iterable<DataDocument>;
  settings: typeof game.settings & {
    settings: Map<
      string,
      {
        namespace: string;
        key: string;
        scope: string;
        name?: string;
        type?: { name: string };
        choices?: Record<string, string>;
      }
    >;
  };
}
const world = () => game as unknown as DataWorld;
const documents = (
  kind: BackupEntry["kind"],
  parentId?: string,
): DataDocument[] => {
  const w = world();
  if (kind === "item" && parentId)
    return [
      ...(documents("actor").find((a) => a.id === parentId)?.items ?? []),
    ];
  return [
    ...(kind === "journal"
      ? w.journal
      : kind === "actor"
        ? w.actors
        : kind === "item"
          ? (w.items ?? [])
          : kind === "table"
            ? w.tables
            : kind === "folder"
              ? w.folders
              : []),
  ];
};
function requireGM(): void {
  if (!game.user?.isGM) throw new Error("Only a GM can manage module data.");
}
const clone = <T>(v: T): T => structuredClone(v);
function ownData(raw: JsonObject): JsonObject {
  return { ...raw, flags: { [NAMESPACE]: clone(moduleFlags(raw)) } };
}
export function captureBackup(): ModuleBackup {
  requireGM();
  const entries: BackupEntry[] = [];
  const add = (
    kind: BackupEntry["kind"],
    doc: DataDocument,
    parentId?: string,
  ) => {
    // Native documents expose flags without serializing their embedded inventory.
    const flags = moduleFlags(
      doc._source ??
        (doc.flags !== undefined ? { flags: doc.flags } : doc.toObject()),
    );
    if (!Object.keys(flags).length) return;
    if (kind === "table" && !flags.hustleRole) return;
    const raw = ["actor", "item"].includes(kind)
      ? { flags: { [NAMESPACE]: clone(flags) } }
      : doc.toObject();
    const data = ownData(raw);
    // Preserve ordinary page content in a module Journal, but not other modules' flags.
    if (kind === "journal") data.pages = (raw.pages ?? []).map(ownData);
    if (kind === "table") data.results = (raw.results ?? []).map(ownData);
    entries.push({
      kind,
      id: doc.id,
      name: doc.name,
      ...(parentId ? { parentId } : {}),
      category: categoryFor(kind, data),
      data,
    });
  };
  for (const kind of ["journal", "actor", "item", "table"] as const)
    for (const doc of documents(kind)) add(kind, doc);
  for (const actor of documents("actor"))
    for (const item of actor.items ?? []) add("item", item, actor.id);
  for (const config of world().settings.settings.values())
    if (config.namespace === NAMESPACE && config.scope === "world") {
      entries.push({
        kind: "setting",
        id: config.key,
        name: config.name ?? config.key,
        category: "Configuration",
        data: { value: clone(game.settings.get(NAMESPACE, config.key)) },
      });
    }
  // Include ancestor folders so recreated Journal/table IDs retain their organization.
  const folders = documents("folder");
  const folderIds = new Set<string>();
  const addFolder = (id: unknown) => {
    if (typeof id !== "string" || folderIds.has(id)) return;
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    folderIds.add(id);
    const data = folder.toObject();
    addFolder(data.folder);
    entries.push({
      kind: "folder",
      id,
      name: folder.name,
      category: "Characters",
      data: {
        _id: id,
        name: folder.name,
        type: data.type,
        folder: data.folder,
        sorting: data.sorting,
        color: data.color,
      },
    });
  };
  for (const e of [...entries]) addFolder(e.data.folder);
  return {
    format: "pneuma-crewtools-backup",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    worldId: world().world.id,
    moduleVersion: world().modules.get(NAMESPACE)!.version,
    entries,
  };
}
export function downloadJson(value: unknown, label: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `crewtools-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export interface OperationReport {
  completed: string[];
  skipped: string[];
  failed: string[];
}
export interface CleanupTarget {
  journalId: string;
  pageId: string;
  name: string;
  key: string;
  removed: JsonObject[];
  remaining: JsonObject[];
  before: string;
}
export function previewCleanup(
  kind: CleanupKind,
  actorId = "",
): CleanupTarget[] {
  requireGM();
  if (!Object.hasOwn(CLEANUP_LABELS, kind))
    throw new Error("Unknown cleanup category.");
  const targets: CleanupTarget[] = [];
  for (const journal of documents("journal")) {
    const jf = moduleFlags(journal.toObject());
    if (kind === "history" && actorId) continue;
    if (
      kind === "history"
        ? jf.recordKind !== "payoutLedger"
        : !["character", "payoutReference"].includes(jf.recordKind)
    )
      continue;
    if (actorId && jf.recordKind === "character" && jf.actorId !== actorId)
      continue;
    for (const page of journal.pages ?? []) {
      const raw = page.toObject(),
        flags = moduleFlags(raw),
        key = flags.recordKey;
      if (kind === "history" ? !key : key !== cleanupKey(kind)) continue;
      if (kind !== "history" && !Array.isArray(flags.data)) continue;
      const rows: JsonObject[] = kind === "history" ? [flags.data] : flags.data;
      const removed = rows.filter(
        (r) =>
          r &&
          matchesCleanup(r, kind, jf.recordKind === "character" ? "" : actorId),
      );
      if (!removed.length) continue;
      targets.push({
        journalId: journal.id,
        pageId: page.id,
        name: journal.name + " / " + page.name,
        key,
        removed,
        remaining: rows.filter((r) => !removed.includes(r)),
        before: JSON.stringify(raw),
      });
    }
  }
  return targets;
}
export async function applyCleanup(
  kind: CleanupKind,
  actorId: string,
  expected: CleanupTarget[],
): Promise<OperationReport> {
  return withGMAction(async () => {
    if ([...game.users].some((u) => u.active && u.id !== game.user!.id))
      throw new Error(
        "Have all other users disconnect before clearing records.",
      );
    const current = previewCleanup(kind, actorId);
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error("Records changed. Preview the cleanup again.");
    const result: OperationReport = { completed: [], skipped: [], failed: [] };
    for (const target of current) {
      if (result.failed.length) {
        result.skipped.push(target.name);
        continue;
      }
      try {
        const journal = documents("journal").find(
          (j) => j.id === target.journalId,
        )!;
        const page = [...journal.pages!].find((p) => p.id === target.pageId)!;
        if (kind === "history")
          await journal.deleteEmbeddedDocuments("JournalEntryPage", [page.id]);
        else
          await page.update({
            [`flags.${NAMESPACE}.data`]: target.remaining,
            "text.content":
              recordSummary(target.key, target.remaining) +
              storedDetails(
                target.remaining,
                "Managed CrewTools records. Clearing history does not reverse native rewards.",
              ),
          });
        result.completed.push(target.name);
      } catch (error) {
        result.failed.push(target.name + ": " + String(error));
      }
    }
    return result;
  });
}
export function openJournal(id: string, pageId?: string): void {
  documents("journal")
    .find((j) => j.id === id)
    ?.sheet?.render(true, { pageId });
}
export function inspectEntries(backup: ModuleBackup) {
  const actors = new Set(documents("actor").map((a) => a.id)),
    users = new Set([...game.users].map((u) => u.id));
  return backup.entries
    .filter((e) => e.kind !== "folder")
    .map((e) => {
      const pages: JsonObject[] = e.data.pages ?? [];
      // Include nested rent obligations and downtime events alongside simple record arrays.
      const rows = pages.flatMap((p) => {
        const f = moduleFlags(p),
          data = f.data;
        const direct = [data, f.activities, f.downtime?.events].flatMap((v) =>
          Array.isArray(v) ? v : [],
        );
        if (data && !Array.isArray(data)) {
          direct.push(
            ...(Array.isArray(data.contributions) ? data.contributions : []),
          );
          direct.push(
            ...(Array.isArray(data.due)
              ? data.due.map((r: JsonObject) => ({ ...r, status: "pending" }))
              : []),
          );
          for (const bill of Array.isArray(data.bills) ? data.bills : []) {
            for (const charge of [bill.rent, bill.lifestyle])
              if (charge)
                direct.push({
                  ...charge,
                  status: charge.paid ? "completed" : "pending",
                });
          }
        }
        return direct;
      });
      const pending = rows.filter(
        (r) =>
          r &&
          (r.acknowledgedAt === null ||
            (r.reward && !r.resolvedAt) ||
            r.status === "active" ||
            [
              "pending",
              "offered",
              "withdrawing",
              "delivering",
              "receiving",
              "returning",
              "refunding",
              "interrupted",
            ].includes(r.status)),
      ).length;
      const completed = rows.filter(
        (r) =>
          r &&
          (r.acknowledgedAt ||
            r.resolvedAt ||
            [
              "completed",
              "consumed",
              "returned",
              "confirmed",
              "rejected",
              "cancelled",
              "failed",
            ].includes(r.status)),
      ).length;
      const warnings = recordWarnings(e.data, actors, users);
      return {
        ...e,
        journalId: e.kind === "journal" ? e.id : "",
        count: pages.length
          ? `${pages.length} pages; ${rows.length} records`
          : e.kind === "table"
            ? `${e.data.results.length} results`
            : "1 record",
        pending,
        completed,
        warnings,
        settingValue: e.kind === "setting" ? JSON.stringify(e.data.value) : "",
      };
    });
}

// Shared diagnostics for the consolidated row inventory and exported-data inspection.
export function recordWarnings(
  data: unknown,
  actors: Set<string>,
  users: Set<string>,
): string[] {
  const warnings = missingReferences(data, actors, users);
  let interrupted = false;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        [
          "hustleAttempt",
          "techAttempt",
          "healingAttempt",
          "medicalAttempt",
          "attempt",
        ].includes(key) &&
        child != null &&
        child !== false
      )
        interrupted = true;
      if (
        key === "status" &&
        [
          "interrupted",
          "withdrawing",
          "delivering",
          "receiving",
          "returning",
          "refunding",
        ].includes(String(child))
      )
        interrupted = true;
      visit(child);
    }
  };
  visit(data);
  if (interrupted)
    warnings.push(
      "Interrupted or unfinished operation: inspect the Journal before retrying.",
    );
  return warnings;
}

export interface MissingUserCleanupTarget {
  uuid: string;
  name: string;
  before: string;
}

// Match the tree's ownership scope: module documents and pages/results inside
// module documents. A reference to an ordinary Actor does not claim its data.
function modulePermissionDocuments() {
  const found: Array<{ uuid: string; name: string; doc: DataDocument }> = [];
  const visit = (
    type: string,
    doc: DataDocument,
    parent = "",
    path = "",
    inherited = false,
  ) => {
    const uuid = parent ? `${parent}.${type}.${doc.id}` : `${type}.${doc.id}`;
    const name = path ? `${path} → ${doc.name}` : `${type} → ${doc.name}`;
    const owned = Object.keys(moduleFlags(doc.toObject())).length > 0;
    if (owned || inherited) found.push({ uuid, name, doc });
    for (const page of doc.pages ?? [])
      visit("JournalEntryPage", page, uuid, name, owned);
    for (const item of doc.items ?? []) visit("Item", item, uuid, name);
    for (const result of doc.results ?? [])
      visit("TableResult", result, uuid, name, owned);
  };
  for (const [kind, type] of [
    ["journal", "JournalEntry"],
    ["actor", "Actor"],
    ["item", "Item"],
    ["table", "RollTable"],
    ["folder", "Folder"],
  ] as const)
    for (const doc of documents(kind)) visit(type, doc);
  for (const doc of world().messages ?? []) visit("ChatMessage", doc);
  return found;
}
function requireMissingUser(userId: string): void {
  requireGM();
  if (!/^[A-Za-z0-9_-]+$/.test(userId) || userId === "default")
    throw new Error("Choose a missing Foundry User account.");
  if ([...game.users].some((u) => u.id === userId))
    throw new Error(
      "This User account exists. Its permissions cannot be cleaned up as obsolete.",
    );
}
export function previewMissingUserCleanup(
  userId: string,
): MissingUserCleanupTarget[] {
  requireMissingUser(userId);
  return modulePermissionDocuments().flatMap(({ uuid, name, doc }) => {
    const ownership = doc.toObject().ownership ?? {};
    return Object.hasOwn(ownership, userId)
      ? [{ uuid, name, before: JSON.stringify(ownership) }]
      : [];
  });
}
export async function applyMissingUserCleanup(
  userId: string,
  expected: MissingUserCleanupTarget[],
): Promise<OperationReport> {
  return withGMAction(async () => {
    const check = () => {
      requireMissingUser(userId);
      if ([...game.users].some((u) => u.active && u.id !== game.user!.id))
        throw new Error(
          "Have all other users disconnect before clearing records.",
        );
    };
    check();
    const current = previewMissingUserCleanup(userId);
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error("Permissions changed. Preview the cleanup again.");
    const report: OperationReport = { completed: [], skipped: [], failed: [] };
    for (const target of current) {
      if (report.failed.length) {
        report.skipped.push(target.name);
        continue;
      }
      try {
        check();
        const entry = modulePermissionDocuments().find(
          (d) => d.uuid === target.uuid,
        );
        if (
          !entry ||
          JSON.stringify(entry.doc.toObject().ownership ?? {}) !== target.before
        )
          throw new Error("Permissions changed. Preview the cleanup again.");
        // Native key deletion preserves default and every remaining User's access.
        await entry.doc.update({ [`ownership.-=${userId}`]: null });
        report.completed.push(target.name);
      } catch (error) {
        report.failed.push(`${target.name}: ${String(error)}`);
      }
    }
    return report;
  });
}
