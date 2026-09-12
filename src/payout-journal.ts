import {
  MODULE_ID,
  PAYOUT_JOURNAL_DATA_SETTING,
  PAYOUT_JOURNAL_ID_SETTING,
} from "./constants";
import type { PayoutPlan } from "./payout-execution";

export interface HqImprovement {
  name: string;
  ipSpent: number;
}

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
  reason: string;
}

export interface AttendanceRecord {
  userId: string;
  userName: string;
  sessions: number;
  lastSession: string;
}

export interface PayoutJournalData {
  hqImprovements: HqImprovement[];
  hqIpTransactions: HqIpTransaction[];
  factionReputations: FactionReputationRecord[];
  attendance: AttendanceRecord[];
}

const EMPTY_DATA: PayoutJournalData = {
  hqImprovements: [],
  hqIpTransactions: [],
  factionReputations: [],
  attendance: [],
};

const JOURNAL_OBSERVER = 2;
const JOURNAL_OWNER = 3;
const synchronizingHqPageIds = new Set<string>();

export function registerHqIpTotalHandler(): void {
  Hooks.on("updateJournalEntryPage", (page, changes, _options, userId) => {
    if (!game.user?.isGM || userId !== game.user.id) return;
    if (synchronizingHqPageIds.has(page.id)) return;
    const journalId = game.settings.get(MODULE_ID, PAYOUT_JOURNAL_ID_SETTING);
    if (typeof journalId !== "string" || !journalId) return;
    const journal = game.journal.get(journalId);
    const hqPage = journal
      ? Array.from(journal.pages).find(({ name }) => name === "HQ")
      : undefined;
    if (hqPage?.id !== page.id) return;

    const changedText = changes["text.content"];
    const nestedText = changes.text;
    const nestedContent =
      typeof nestedText === "object" && nestedText !== null
        ? (nestedText as Record<string, unknown>).content
        : undefined;
    const content =
      typeof changedText === "string"
        ? changedText
        : typeof nestedContent === "string"
          ? nestedContent
          : undefined;
    if (typeof content !== "string") return;
    const synchronized = synchronizeHqIpTotal(content);
    if (synchronized === content) return;

    synchronizingHqPageIds.add(page.id);
    void page
      .update({ "text.content": synchronized })
      .catch((error) =>
        console.error(
          `${MODULE_ID} | Could not synchronize HQ IP total.`,
          error,
        ),
      )
      .finally(() => synchronizingHqPageIds.delete(page.id));
  });
}

export function registerPayoutJournalSettings(): void {
  game.settings.register(MODULE_ID, PAYOUT_JOURNAL_ID_SETTING, {
    name: "Payout Journal ID",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, PAYOUT_JOURNAL_DATA_SETTING, {
    name: "Payout Journal Data",
    scope: "world",
    config: false,
    type: Object,
    default: EMPTY_DATA,
  });
}

export function getPayoutJournalData(): PayoutJournalData {
  const value = game.settings.get(MODULE_ID, PAYOUT_JOURNAL_DATA_SETTING);
  if (!isJournalData(value)) return structuredClone(EMPTY_DATA);
  return structuredClone(value);
}

export type PayoutJournalDataSection =
  "reputation" | "attendance" | "hq" | "all";

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
  if (section === "hq" || section === "all") {
    updated.hqImprovements = [];
    updated.hqIpTransactions = [];
  }
  await game.settings.set(MODULE_ID, PAYOUT_JOURNAL_DATA_SETTING, updated);

  const pages = new Map(
    Array.from(journal.pages).map((page) => [page.name, page]),
  );
  const updates: Promise<unknown>[] = [];
  if (section === "hq" || section === "all") {
    const page = pages.get("HQ");
    if (page)
      updates.push(page.update({ "text.content": renderHqPage(updated) }));
  }
  if (section === "reputation" || section === "all") {
    const page = pages.get("Player Reputation");
    if (page)
      updates.push(
        page.update({ "text.content": renderReputationPage(updated) }),
      );
  }
  if (section === "attendance" || section === "all") {
    const page = pages.get("Attendance");
    if (page)
      updates.push(
        page.update({ "text.content": renderAttendancePage(updated) }),
      );
  }
  await Promise.all(updates);
}

export async function ensurePayoutJournal(): Promise<FoundryJournalEntry> {
  const storedId = game.settings.get(MODULE_ID, PAYOUT_JOURNAL_ID_SETTING);
  const hadRegisteredJournal = typeof storedId === "string" && storedId !== "";
  let journal = hadRegisteredJournal ? game.journal.get(storedId) : undefined;
  const registeredJournalWasDeleted = hadRegisteredJournal && !journal;
  if (!journal) {
    journal = await JournalEntry.create({
      name: "Payouts",
      ownership: payoutJournalOwnership(),
      pages: [
        textPage("HQ", renderHqPage(EMPTY_DATA), 100000),
        textPage("Player Reputation", renderReputationPage(EMPTY_DATA), 200000),
        textPage("Attendance", renderAttendancePage(EMPTY_DATA), 300000),
      ],
    });
  }
  const existingPages = new Set(
    Array.from(journal.pages).map(({ name }) => name),
  );
  const missingPages = [
    ["HQ", renderHqPage(EMPTY_DATA), 100000],
    ["Player Reputation", renderReputationPage(EMPTY_DATA), 200000],
    ["Attendance", renderAttendancePage(EMPTY_DATA), 300000],
  ].flatMap(([name, content, sort]) =>
    existingPages.has(String(name))
      ? []
      : [textPage(String(name), String(content), Number(sort))],
  );
  if (missingPages.length)
    await journal.createEmbeddedDocuments("JournalEntryPage", missingPages);
  await journal.update({ ownership: payoutJournalOwnership() });
  await migrateExistingHqPage(journal);
  if (registeredJournalWasDeleted)
    await game.settings.set(
      MODULE_ID,
      PAYOUT_JOURNAL_DATA_SETTING,
      structuredClone(EMPTY_DATA),
    );
  await game.settings.set(MODULE_ID, PAYOUT_JOURNAL_ID_SETTING, journal.id);
  await renderPayoutJournal(journal, getPayoutJournalData());
  return journal;
}

function payoutJournalOwnership(): Record<string, number> {
  return Object.fromEntries([
    ["default", JOURNAL_OBSERVER],
    ...Array.from(game.users).map(({ id, isGM }) => [
      id,
      isGM ? JOURNAL_OWNER : JOURNAL_OBSERVER,
    ]),
  ]);
}

export async function applyPayoutToJournal(
  plan: PayoutPlan,
): Promise<() => Promise<void>> {
  const journal = await ensurePayoutJournal();
  const previous = getPayoutJournalData();
  const updated = structuredClone(previous);
  const hqPage = Array.from(journal.pages).find(({ name }) => name === "HQ");
  const previousHqContent = hqPage?.text?.content;

  updated.hqIpTransactions.push(...plan.hqIpTransactions);

  for (const { participant } of plan.actors) {
    const existing = updated.attendance.find(
      ({ userId }) => userId === participant.userId,
    );
    if (existing) {
      existing.sessions += 1;
      existing.userName = participant.userName;
      existing.lastSession = plan.sessionLabel;
    } else {
      updated.attendance.push({
        userId: participant.userId,
        userName: participant.userName,
        sessions: 1,
        lastSession: plan.sessionLabel,
      });
    }
  }

  for (const reputation of plan.factionReputations) {
    const index = updated.factionReputations.findIndex(
      ({ actorId, faction }) =>
        actorId === reputation.actorId &&
        faction.toLocaleLowerCase() === reputation.faction.toLocaleLowerCase(),
    );
    if (index >= 0) updated.factionReputations[index] = reputation;
    else updated.factionReputations.push(reputation);
  }

  try {
    await saveAndRender(journal, updated);
    if (hqPage && plan.hqIpTransactions.length)
      await appendHqIpRows(hqPage, plan.hqIpTransactions);
  } catch (error) {
    await saveAndRender(journal, previous).catch(() => undefined);
    if (hqPage && typeof previousHqContent === "string")
      await hqPage
        .update({ "text.content": previousHqContent })
        .catch(() => undefined);
    throw error;
  }
  return async () => {
    await saveAndRender(journal, previous);
    if (hqPage && typeof previousHqContent === "string")
      await hqPage.update({ "text.content": previousHqContent });
  };
}

async function appendHqIpRows(
  page: FoundryJournalPage,
  transactions: HqIpTransaction[],
): Promise<void> {
  const content = page.text?.content;
  if (typeof content !== "string")
    throw new Error("The HQ journal page has no editable text content.");

  const template = document.createElement("template");
  template.innerHTML = content;
  const heading = Array.from(template.content.querySelectorAll("h2")).find(
    ({ textContent }) => textContent?.trim() === "HQ IP Journal",
  );
  const table = heading?.nextElementSibling;
  const body = table?.querySelector("tbody");
  if (!body) throw new Error("The HQ IP Journal table could not be found.");

  const rows = Array.from(body.querySelectorAll("tr"));
  if (
    rows.length === 2 &&
    rows[1]?.textContent?.trim().toLocaleLowerCase() === "no entries yet."
  )
    rows[1].remove();

  for (const { date, amount, reason } of transactions) {
    const row = document.createElement("tr");
    for (const value of [
      date,
      amount >= 0 ? `+${amount}` : String(amount),
      reason,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  await page.update({
    "text.content": synchronizeHqIpTotal(template.innerHTML),
  });
}

async function saveAndRender(
  journal: FoundryJournalEntry,
  data: PayoutJournalData,
): Promise<void> {
  await game.settings.set(MODULE_ID, PAYOUT_JOURNAL_DATA_SETTING, data);
  await renderPayoutJournal(journal, data);
}

async function renderPayoutJournal(
  journal: FoundryJournalEntry,
  data: PayoutJournalData,
): Promise<void> {
  const pages = new Map(
    Array.from(journal.pages).map((page) => [page.name, page]),
  );
  await Promise.all([
    pages
      .get("Player Reputation")
      ?.update({ "text.content": renderReputationPage(data) }),
    pages
      .get("Attendance")
      ?.update({ "text.content": renderAttendancePage(data) }),
  ]);
}

function renderHqPage(data: PayoutJournalData): string {
  const total = data.hqIpTransactions.reduce(
    (sum, { amount }) => sum + amount,
    0,
  );
  return `${renderHqIpTotal(total)}<h2>Purchased Improvements</h2>${table(
    ["Improvement", "IP Spent"],
    data.hqImprovements.map(({ name, ipSpent }) => [name, String(ipSpent)]),
  )}<h2>HQ IP Journal</h2>${table(
    ["Date", "Adjustment", "Reason"],
    data.hqIpTransactions.map(({ date, amount, reason }) => [
      date,
      amount >= 0 ? `+${amount}` : String(amount),
      reason,
    ]),
  )}`;
}

function renderReputationPage(data: PayoutJournalData): string {
  return table(
    ["Actor", "Reputation", "Faction", "Reason"],
    data.factionReputations.map(
      ({ actorName, reputation, faction, reason }) => [
        actorName,
        String(reputation),
        faction,
        reason,
      ],
    ),
  );
}

function renderAttendancePage(data: PayoutJournalData): string {
  return table(
    ["Player", "Sessions Played", "Last Session"],
    [...data.attendance]
      .sort(
        (a, b) =>
          a.sessions - b.sessions || a.userName.localeCompare(b.userName),
      )
      .map(({ userName, sessions, lastSession }) => [
        userName,
        String(sessions),
        lastSession || "—",
      ]),
  );
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

async function migrateExistingHqPage(
  journal: FoundryJournalEntry,
): Promise<void> {
  const page = Array.from(journal.pages).find(({ name }) => name === "HQ");
  const content = page?.text?.content;
  if (!page || typeof content !== "string") return;

  const migrated = content
    .replace(/^\s*<h1>\s*HQ\s*<\/h1>/i, "")
    .replace(
      /<thead>\s*(<tr>[\s\S]*?<\/tr>)\s*<\/thead>\s*<tbody>/gi,
      "<tbody>$1",
    );
  const synchronized = synchronizeHqIpTotal(migrated);
  if (synchronized !== content)
    await page.update({ "text.content": synchronized });
}

function synchronizeHqIpTotal(content: string): string {
  const template = document.createElement("template");
  template.innerHTML = content;
  const headings = Array.from(template.content.querySelectorAll("h2"));
  const journalHeading = headings.find(
    ({ textContent }) => textContent?.trim() === "HQ IP Journal",
  );
  const journalTable = journalHeading?.nextElementSibling;
  const rows = Array.from(journalTable?.querySelectorAll("tbody tr") ?? []);
  const total = rows.slice(1).reduce((sum, row) => {
    const amount = Number(
      row.querySelectorAll("td")[1]?.textContent?.trim().replaceAll(",", ""),
    );
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);

  const totalValue = template.content.querySelector<HTMLElement>(
    "[data-pneuma-crewtools-hq-ip-total]",
  );
  if (totalValue) totalValue.textContent = String(total);
  else {
    const totalTemplate = document.createElement("template");
    totalTemplate.innerHTML = renderHqIpTotal(total);
    template.content.insertBefore(
      totalTemplate.content,
      template.content.firstChild,
    );
  }
  return template.innerHTML;
}

function renderHqIpTotal(total: number): string {
  return `<h2>Current HQ IP</h2><p><strong data-pneuma-crewtools-hq-ip-total>${total}</strong></p>`;
}

function textPage(name: string, content: string, sort: number): object {
  return { name, type: "text", sort, text: { content, format: 1 } };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isJournalData(value: unknown): value is PayoutJournalData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.hqImprovements) &&
    Array.isArray(data.hqIpTransactions) &&
    Array.isArray(data.factionReputations) &&
    Array.isArray(data.attendance)
  );
}
