import { MODULE_ID } from "./constants";
import { recordFolder } from "./journal-records";
import { recordEscape as esc, journalTable } from "./journal-format";
import { displayDate } from "./date-format";
import type { HeadquartersRecord } from "./headquarters";
import type { HqRent } from "./rent-model";
export type HqProperties = Pick<
  HeadquartersRecord,
  "description" | "bedrooms" | "maxImprovements" | "improvements"
>;
export function headquartersJournal(): FoundryJournalEntry | undefined {
  const journals = Array.from(game.journal).filter(
    (j) => j.getFlag?.(MODULE_ID, "headquarters") === true,
  );
  if (journals.length > 1)
    throw new Error("Multiple Headquarters Journals exist.");
  return journals[0];
}
export function hqPage(actorId: string) {
  return Array.from(headquartersJournal()?.pages ?? []).find(
    (p) =>
      p.getFlag?.(MODULE_ID, "recordKey") === "hq" &&
      p.getFlag?.(MODULE_ID, "hqActorId") === actorId,
  );
}
export function hqProperties(actorId: string): HqProperties | undefined {
  const data = hqPage(actorId)?.getFlag?.(MODULE_ID, "properties") as
    HqProperties | undefined;
  return data ? structuredClone(data) : undefined;
}
export function readHqRent(actorId: string): HqRent {
  return structuredClone(
    (hqPage(actorId)?.getFlag?.(MODULE_ID, "rent") as HqRent | undefined) ?? {
      typeId: "",
      modifier: 0,
      bills: [],
    },
  );
}
export function canPayHq(actorId: string): boolean {
  const page = hqPage(actorId);
  if (!page || !game.user || page.getFlag?.(MODULE_ID, "inactive") === true)
    return false;
  return (
    game.user.isGM || page.testUserPermission?.(game.user, "OWNER") === true
  );
}
export async function ensureHeadquartersJournal() {
  if (!game.user?.isGM)
    throw new Error("A GM must prepare the Headquarters Journal.");
  let journal = headquartersJournal();
  if (!journal)
    journal = await JournalEntry.create({
      name: "Headquarters",
      folder: await recordFolder(),
      ownership: { default: 2 },
      flags: { [MODULE_ID]: { headquarters: true } },
      pages: [],
    });
  else if (journal.name !== "Headquarters")
    await journal.update({ name: "Headquarters" });
  return journal;
}
function propertiesHtml(data: HqProperties): string {
  return (
    "<p>" +
    esc(data.description ?? "") +
    "</p>" +
    journalTable(
      ["Bedrooms", "Maximum improvements"],
      [[esc(data.bedrooms ?? 0), esc(data.maxImprovements ?? "No limit")]],
    ) +
    journalTable(
      ["Improvement", "Level", "Notes"],
      data.improvements.map((i) => [
        esc(i.name),
        esc(i.level ?? 1),
        esc(i.notes),
      ]),
    )
  );
}
function rentHtml(data: HqRent): string {
  return (
    "<p>Rent: " +
    esc(data.typeId ? "Configured" : "Not configured") +
    " · Modifier: " +
    esc(data.modifier) +
    "%</p>" +
    journalTable(
      ["Due date", "Rent", "Paid", "Remaining"],
      data.bills.map((b) => [
        esc(displayDate(b.date)),
        esc(b.charge.name) + ": " + b.charge.amount + " eb",
        b.paid + " eb",
        Math.max(0, b.charge.amount - b.paid) + " eb",
      ]),
    ) +
    journalTable(
      ["Due date", "Contributor", "Applied", "Refunded"],
      data.bills.flatMap((b) =>
        b.contributions.map((c) => [
          esc(displayDate(b.date)),
          esc(c.actorName),
          c.amount + " eb",
          c.refund + " eb",
        ]),
      ),
    )
  );
}
async function writePage(
  actor: FoundryActor,
  kind: "hqProperties" | "hqRent",
  data: HqProperties | HqRent,
) {
  const page = hqPage(actor.id);
  const key = kind === "hqProperties" ? "properties" : "rent";
  const properties =
    kind === "hqProperties"
      ? (data as HqProperties)
      : (hqProperties(actor.id) ?? { improvements: [] });
  const rental = kind === "hqRent" ? (data as HqRent) : readHqRent(actor.id);
  const content =
    "<h2>Stats &amp; Improvements</h2>" +
    propertiesHtml(properties) +
    "<h2>Rent &amp; Payments</h2>" +
    rentHtml(rental);
  if (page) {
    const changes: Record<string, unknown> = {};
    if (JSON.stringify(page.getFlag?.(MODULE_ID, key)) !== JSON.stringify(data))
      changes["flags." + MODULE_ID + "." + key] = data;
    if (page.text?.content !== content) changes["text.content"] = content;
    if (page.name !== actor.name) changes.name = actor.name;
    if (Object.keys(changes).length) await page.update(changes);
  } else await ensureHqPages(actor, properties, rental);
}
export async function saveHqProperties(
  actor: FoundryActor,
  data: HqProperties,
) {
  if (!game.user?.isGM && !canPayHq(actor.id))
    throw new Error("You cannot update this HQ page.");
  await writePage(actor, "hqProperties", data);
}
export async function saveHqRentRecord(actor: FoundryActor, data: HqRent) {
  if (!game.user?.isGM && !canPayHq(actor.id))
    throw new Error("You cannot update this HQ payment page.");
  await writePage(actor, "hqRent", data);
}
export async function ensureHqPages(
  actor: FoundryActor,
  properties: HqProperties,
  rental: HqRent,
) {
  const existing = hqPage(actor.id);
  if (existing) {
    if (existing.name !== actor.name)
      await existing.update({ name: actor.name });
    return;
  }
  const journal = await ensureHeadquartersJournal();
  await journal.createEmbeddedDocuments("JournalEntryPage", [
    {
      name: actor.name,
      type: "text",
      ownership: { default: 3 },
      flags: {
        [MODULE_ID]: {
          recordKey: "hq",
          hqActorId: actor.id,
          properties,
          rent: rental,
        },
      },
      text: {
        content:
          "<h2>Stats &amp; Improvements</h2>" +
          propertiesHtml(properties) +
          "<h2>Rent &amp; Payments</h2>" +
          rentHtml(rental),
      },
    },
  ]);
}
