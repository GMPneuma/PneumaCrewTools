import { storedDetails } from "./journal-format";
import { recordSummary } from "./payout-journal-view";
export {
  recordEscape,
  readableRecord,
  journalTable,
  storedDetails,
} from "./journal-format";
import { displayDate } from "./date-format";
import { MODULE_ID } from "./constants";

// Journal identity is stored on the document, not in a hidden world setting.
export function findRecordJournal(
  kind: string,
  actorId?: string,
): FoundryJournalEntry | undefined {
  return Array.from(game.journal).find(
    (j) =>
      j.getFlag?.(MODULE_ID, "recordKind") === kind &&
      j.getFlag?.(MODULE_ID, "actorId") === actorId,
  );
}
export async function recordFolder(privateGM = false): Promise<string> {
  const find = (name: string, parent: string | null) =>
    Array.from(game.folders).find(
      (f) =>
        f.type === "JournalEntry" &&
        f.name === name &&
        (typeof f.folder === "string" ? f.folder : (f.folder?.id ?? null)) ===
          parent,
    );
  const crew =
    find("CrewTools", null) ??
    (await Folder.create({
      name: "CrewTools",
      type: "JournalEntry",
      folder: null,
    }));
  if (!privateGM) return crew.id;
  return (
    find("CrewTools-GM", crew.id) ??
    (await Folder.create({
      name: "CrewTools-GM",
      type: "JournalEntry",
      folder: crew.id,
    }))
  ).id;
}
export async function ensureRecordJournal(
  kind: string,
  name: string,
  audience: "crew" | "gm" | FoundryActor,
): Promise<FoundryJournalEntry> {
  const actor = typeof audience === "object" ? audience : undefined;
  let journal = findRecordJournal(kind, actor?.id);
  // Players may update their prepared records, but only a GM provisions Journals.
  if (!game.user?.isGM) {
    if (!journal || !actor || !actor.testUserPermission(game.user!, "OWNER"))
      throw new Error("A GM must prepare this character's payout Journal.");
    return journal;
  }
  const ownership = Object.fromEntries([
    ["default", audience === "crew" ? 2 : 0],
    ...Array.from(game.users).map((u) => [
      u.id,
      u.isGM || actor?.testUserPermission(u, "OWNER")
        ? 3
        : audience === "crew"
          ? 2
          : 0,
    ]),
  ]);
  const folder = await recordFolder(audience === "gm");
  if (!journal)
    journal = await JournalEntry.create({
      name,
      folder,
      ownership,
      flags: {
        [MODULE_ID]: {
          recordKind: kind,
          ...(actor ? { actorId: actor.id } : {}),
        },
      },
      pages: [],
    });
  else {
    const changes: Record<string, unknown> = {};
    if (journal.name !== name) changes.name = name;
    const currentFolder =
      typeof journal.folder === "string" ? journal.folder : journal.folder?.id;
    if (currentFolder !== folder) changes.folder = folder;
    const current = journal.ownership ?? {};
    if (
      Object.keys(current).length !== Object.keys(ownership).length ||
      Object.entries(ownership).some(([id, level]) => current[id] !== level)
    )
      changes.ownership = ownership;
    if (Object.keys(changes).length) await journal.update(changes);
  }
  return journal;
}
export function recordPage(
  journal: FoundryJournalEntry | undefined,
  key: string,
) {
  return Array.from(journal?.pages ?? []).find(
    (p) => p.getFlag?.(MODULE_ID, "recordKey") === key,
  );
}
export function readRecord<T>(
  journal: FoundryJournalEntry | undefined,
  key: string,
  fallback: T,
): T {
  return structuredClone(
    (recordPage(journal, key)?.getFlag?.(MODULE_ID, "data") as T | undefined) ??
      fallback,
  );
}
export async function writeRecord(
  journal: FoundryJournalEntry,
  key: string,
  name: string,
  data: unknown,
  purpose: string,
  content?: string,
): Promise<void> {
  const page = recordPage(journal, key);
  const dataChanged =
    !page ||
    JSON.stringify(page.getFlag?.(MODULE_ID, "data")) !== JSON.stringify(data);
  // Unchanged history needs neither rendering nor a document update.
  if (page && !dataChanged && content === undefined) return;
  const text =
    (content ?? recordSummary(key, data)) +
    (content
      ? ""
      : storedDetails(
          data,
          purpose +
            " Stored on this page in flags." +
            MODULE_ID +
            ".data. Editing text does not change records.",
        ));
  if (page) {
    const changes: Record<string, unknown> = {};
    if (dataChanged) changes["flags." + MODULE_ID + ".data"] = data;
    if (page.text?.content !== text) changes["text.content"] = text;
    if (Object.keys(changes).length) await page.update(changes);
  } else
    await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name,
        type: "text",
        flags: { [MODULE_ID]: { recordKey: key, data } },
        text: { content: text, format: 1 },
      },
    ]);
}
export async function clearRecords(
  journal: FoundryJournalEntry | undefined,
): Promise<void> {
  const ids = Array.from(journal?.pages ?? [])
    .filter((p) => p.getFlag?.(MODULE_ID, "recordKey"))
    .map((p) => p.id);
  if (journal && ids.length)
    await journal.deleteEmbeddedDocuments("JournalEntryPage", ids);
}
export function actorPayoutJournal(actorId: string) {
  return findRecordJournal("character", actorId);
}
export async function ensureActorPayoutJournal(actor: FoundryActor) {
  return ensureRecordJournal("character", "Crew Tools — " + actor.name, actor);
}
export function actorPayoutRecords<T>(actorId: string, key: string): T[] {
  return readRecord<T[]>(actorPayoutJournal(actorId), key, []);
}
export async function saveActorPayoutRecords(
  actor: FoundryActor,
  key: string,
  records: unknown[],
): Promise<void> {
  const journal = await ensureActorPayoutJournal(actor);
  await writeRecord(
    journal,
    key,
    key === "acknowledgments" ? "Payout Receipts" : "Humanity Rolls",
    records,
    key === "acknowledgments"
      ? "Rewards are already applied. Acknowledged means the character’s owner has seen the receipt."
      : "Pending Humanity rolls and completed results for this character. Completing a roll updates Humanity and EMP.",
  );
}

// Refresh presentation only; authoritative records and native resources are untouched.
export async function refreshRecordTables(): Promise<void> {
  for (const journal of game.journal) {
    const kind = journal.getFlag?.(MODULE_ID, "recordKind");
    if (!["character", "payoutLedger"].includes(String(kind))) continue;
    for (const page of journal.pages) {
      const key = page.getFlag?.(MODULE_ID, "recordKey");
      if (
        ["rent", "rentConfig", "hqRent", "teammates", "nomadVehicles"].includes(
          String(key),
        )
      )
        continue;
      const data = page.getFlag?.(MODULE_ID, "data");
      if (typeof key !== "string" || data === undefined) continue;
      const record = data as import("./payout-record").PayoutRecord;
      const name =
        kind === "payoutLedger"
          ? record.sessionLabel +
            (record.inGameDate ? " — " + displayDate(record.inGameDate) : "")
          : page.name;
      const text =
        recordSummary(key, data) +
        storedDetails(
          data,
          key === "pharmaTransfers"
            ? "Pharmaceutical transfers by Actor and transfer ID. Keep delivers inventory; Use Now delivers inventory then uses one dose; Reject returns doses when the sender is connected. Interrupted transfers need review. Records and item data are stored in flags.pneuma-crewtools.data; editing text does not change inventory."
            : key === "factionReputation"
              ? "Current faction reputation for this character, separate from sheet Reputation. Actor and faction IDs identify records; names are labels. Stored in flags.pneuma-crewtools.data; editing text does not change scores."
              : "These tables show saved payout records. Receipt acknowledgment confirms receipt, not payment approval. Records are stored in flags.pneuma-crewtools.data; editing text does not change them.",
        );
      if (page.text?.content !== text || page.name !== name)
        await page.update({ name, "text.content": text });
    }
  }
}

// Read character records in one Journal pass; counting callers need no cloned display data.
export function allActorRecords(key: string): unknown[] {
  const actorIds = new Set(Array.from(game.actors, (actor) => actor.id));
  return Array.from(game.journal).flatMap((journal) => {
    if (
      journal.getFlag?.(MODULE_ID, "recordKind") !== "character" ||
      !actorIds.has(String(journal.getFlag?.(MODULE_ID, "actorId")))
    )
      return [];
    const data = recordPage(journal, key)?.getFlag?.(MODULE_ID, "data");
    return Array.isArray(data) ? data : [];
  });
}
