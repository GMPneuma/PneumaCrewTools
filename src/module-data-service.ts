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
    const raw = doc.toObject();
    if (!Object.keys(moduleFlags(raw)).length) return;
    if (kind === "table" && !moduleFlags(raw).hustleRole) return;
    const data = ["actor", "item"].includes(kind)
      ? { flags: ownData(raw).flags }
      : ownData(raw);
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
            ["pending", "offered", "withdrawing", "delivering"].includes(
              r.status,
            )),
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
      const warnings = missingReferences(e.data, actors, users);
      const serialized = JSON.stringify(e.data);
      if (
        /"(?:hustleAttempt|techAttempt|healingAttempt|medicalAttempt|attempt)":(?!null)/.test(
          serialized,
        ) ||
        /"status":"(?:interrupted|withdrawing|delivering|refunding)"/.test(
          serialized,
        )
      )
        warnings.push(
          "Interrupted operation: inspect the Journal before retrying.",
        );
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
