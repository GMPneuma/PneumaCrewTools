import { isNetrunner } from "./netrunner-system";
import { recordEscape } from "./journal-format";
import { resourceTransactionsHtml } from "./downtime-journal-view";
import { ensureActorPayoutJournal } from "./journal-records";
import {
  activityPage,
  activityRecords,
  activityHtml,
  saveCharacterState,
  ensureCharacterPages,
} from "./downtime-records";
import { isActorExcluded } from "./actor-policy";
import { MODULE_ID } from "./constants";
import {
  validateDowntime,
  downtimeBalance,
  hustleDays,
  emptyDowntime,
  type DowntimeState,
} from "./downtime-model";
import { syncUpgradeStorage, storageActor } from "./upgrade-storage";
import { techRole } from "./tech-system";
const FLAG = "downtime";

export function ledgerPage(): FoundryJournalPage | undefined {
  const journals = Array.from(game.journal).filter(
    (j) => j.getFlag?.(MODULE_ID, FLAG) === "ledger",
  );
  if (journals.length > 1)
    throw new Error(
      "Multiple downtime ledgers found. Keep only one active ledger.",
    );
  return journals[0]
    ? Array.from(journals[0].pages).find(
        (p) => p.getFlag?.(MODULE_ID, "kind") === "ledger",
      )
    : undefined;
}

export function getIndex(): DowntimeState {
  const page = ledgerPage();
  if (!page) return emptyDowntime();
  const state = page.getFlag?.(MODULE_ID, FLAG) as DowntimeState | undefined;
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.accounts) ||
    !Array.isArray(state.events) ||
    !Number.isSafeInteger(state.period) ||
    state.period < 1
  )
    throw new Error(
      "The Downtime Journal data is invalid. Ask the GM to inspect it; no data was replaced.",
    );
  validateDowntime(state);
  return structuredClone(state);
}

export function actorLedger(
  actorId: string,
  index = getIndex(),
): FoundryJournalPage | undefined {
  const account = index.accounts.find((a) => a.actorId === actorId);
  return Array.from(
    game.journal.get(account?.characterJournalId ?? "")?.pages ?? [],
  ).find((p) => p.getFlag?.(MODULE_ID, "kind") === "actorLedger");
}

// Individual actions select their account before any history is read.
export function getDowntime(actorId?: string): DowntimeState {
  const state = getIndex();
  if (actorId !== undefined)
    state.accounts = state.accounts.filter((a) => a.actorId === actorId);
  state.events = [];
  state.activities = [];
  for (const account of state.accounts) {
    const stored = actorLedger(account.actorId, state)?.getFlag?.(
      MODULE_ID,
      FLAG,
    ) as DowntimeState | undefined;
    if (!stored) continue;
    const combined = {
      ...stored,
      activities: activityRecords(account.actorId),
    };
    validateDowntime(combined);
    if (
      stored.accounts.length !== 1 ||
      stored.accounts[0]?.actorId !== account.actorId ||
      stored.events.some((e) => e.actorId !== account.actorId) ||
      combined.activities.some((r) => r.actorId !== account.actorId)
    )
      throw new Error(
        "Character downtime Journal contains another Actor's records.",
      );
    state.events.push(...structuredClone(combined.events));
    state.activities.push(...structuredClone(combined.activities));
  }
  return state;
}

// Preserve this public helper while sharing the HTML encoding implementation.
export const escape = (value: unknown): string => recordEscape(String(value));

export function actorLink(actorId: string, savedName?: string): string {
  const actor = Array.from(game.actors).find((a) => a.id === actorId);
  const name =
    actor?.name ??
    savedName ??
    getIndex().accounts.find((a) => a.actorId === actorId)?.name ??
    "Missing character";
  return `<a class="content-link" draggable="true" data-link data-uuid="Actor.${escape(actorId)}"><i class="fas fa-user"></i> ${escape(name)}</a> <small>(Actor.${escape(actorId)})</small>`;
}

export function ledgerHtml(state: DowntimeState): string {
  const account = state.accounts[0],
    page = account ? actorLedger(account.actorId) : undefined;
  const guards = ["hustleAttempt", "techAttempt", "healingAttempt"].flatMap(
    (key) =>
      page?.getFlag?.(MODULE_ID, key)
        ? [{ kind: key, details: page.getFlag!(MODULE_ID, key) }]
        : [],
  );
  return resourceTransactionsHtml(state, guards);
}

export function characterState(
  state: DowntimeState,
  actorId: string,
): DowntimeState {
  return {
    ...state,
    accounts: state.accounts.filter((a) => a.actorId === actorId),
    activities: state.activities?.filter((r) => r.actorId === actorId),
    events: state.events.filter((e) => e.actorId === actorId),
  };
}

export async function save(state: DowntimeState): Promise<void> {
  validateDowntime(state);
  // Write only changed character pages, so unrelated owners never need write access.
  for (const account of state.accounts) {
    const page = actorLedger(account.actorId, state);
    if (!page) continue;
    const data: DowntimeState = {
      version: 1,
      period: state.period,
      accounts: [account],
      events: state.events.filter((e) => e.actorId === account.actorId),
      activities: state.activities?.filter(
        (r) => r.actorId === account.actorId,
      ),
    };
    if (
      JSON.stringify({
        ...(page.getFlag?.(MODULE_ID, FLAG) as DowntimeState),
        activities: activityRecords(account.actorId),
      }) === JSON.stringify(data)
    )
      continue;
    ownedCharacter(account.actorId);
    await saveCharacterState(data, ledgerHtml(data));
  }
  await saveDirectory(state);
}

// Shared lookup data is refreshed without rewriting any character activity pages.
async function saveDirectory(state: DowntimeState): Promise<void> {
  if (game.user?.isGM) {
    const index = {
      version: state.version,
      period: state.period,
      accounts: state.accounts,
      events: [],
    };
    const directoryUpdate = {
      [`flags.${MODULE_ID}.${FLAG}`]: index,
      "text.content":
        "<details><summary>About this page</summary><p>Character Journal links and session period for Crew Tools. Each character’s records are stored in their linked Journal.</p></details>" +
        state.accounts
          .map(
            (a) =>
              "<p>" +
              actorLink(a.actorId, a.name) +
              " — JournalEntry." +
              escape(a.characterJournalId) +
              "</p>",
          )
          .join(""),
    };
    const page = ledgerPage()!;
    if (
      JSON.stringify(page.getFlag?.(MODULE_ID, FLAG)) !==
        JSON.stringify(index) ||
      page.text?.content !== directoryUpdate["text.content"]
    )
      await page.update(directoryUpdate);
  }
}

export async function folder(
  name: string,
  parent: string | null,
): Promise<FoundryFolder> {
  const existing = Array.from(game.folders).find(
    (f) =>
      f.type === "JournalEntry" &&
      f.name === name &&
      (f.folder?.id ?? null) === parent,
  );
  return (
    existing ??
    Folder.create({ name, type: "JournalEntry", folder: parent, sorting: "a" })
  );
}

export function playerCharacter(actor: FoundryActor): boolean {
  return (
    !isActorExcluded(actor.id) &&
    actor.type === "character" &&
    Array.from(game.users).some(
      (user) => !user.isGM && actor.testUserPermission(user, "OWNER"),
    )
  );
}

export async function ensureDowntime(
  requiredActorIds: string[] = [],
  maintenanceActorIds?: readonly string[],
): Promise<void> {
  const crew = await folder("CrewTools", null);
  const technicalFolder = await folder("CrewTools-GM", crew.id);
  let page = ledgerPage();
  if (!page) {
    const existing = Array.from(game.journal).find(
      (j) => j.getFlag?.(MODULE_ID, FLAG) === "ledger",
    );
    const data = {
      name: "Directory",
      type: "text",
      text: { content: ledgerHtml(emptyDowntime()) },
      flags: { [MODULE_ID]: { kind: "ledger", [FLAG]: emptyDowntime() } },
    };
    if (existing)
      [page] = await existing.createEmbeddedDocuments("JournalEntryPage", [
        data,
      ]);
    else {
      const journal = await JournalEntry.create({
        name: "Downtime Directory",
        folder: technicalFolder.id,
        ownership: { default: 2 },
        flags: { [MODULE_ID]: { [FLAG]: "ledger" } },
        pages: [data],
      });
      page = Array.from(journal.pages)[0];
    }
  }
  // The directory is technical, but player clients still need read access for offline actions.
  const directory = Array.from(game.journal).find(
    (j) => j.getFlag?.(MODULE_ID, FLAG) === "ledger",
  )!;
  if (
    directory.name !== "Downtime Directory" ||
    directory.folder?.id !== technicalFolder.id
  )
    await directory.update({
      name: "Downtime Directory",
      folder: technicalFolder.id,
    });
  if (page?.name !== "Directory") await page!.update({ name: "Directory" });
  const state = getIndex();
  let changed = false;
  for (const actor of Array.from(game.actors).filter(
    (a) =>
      !isActorExcluded(a.id) &&
      a.type === "character" &&
      (!maintenanceActorIds || maintenanceActorIds.includes(a.id)) &&
      (requiredActorIds.includes(a.id) ||
        state.accounts.some((account) => account.actorId === a.id)),
  )) {
    let account = state.accounts.find((a) => a.actorId === actor.id);
    if (!account) {
      account = { actorId: actor.id, name: actor.name, characterJournalId: "" };
      state.accounts.push(account);
      changed = true;
    }
    if (account.name !== actor.name) {
      account.name = actor.name;
      changed = true;
    }
    const journal = await ensureActorPayoutJournal(actor);
    if (account.characterJournalId !== journal.id) {
      account.characterJournalId = journal.id;
      changed = true;
    }
    const data: DowntimeState = {
      version: 1,
      period: state.period,
      accounts: [account],
      events: [],
    };
    await ensureCharacterPages(actor, data, ledgerHtml(data));
  }

  // Persist bindings before resolving each character ledger. No legacy events are imported.
  if (changed)
    await ledgerPage()!.update({
      [`flags.${MODULE_ID}.${FLAG}`]: { ...state, events: [] },
    });
  // Prepare inventory storage for eligible TECHs and Netrunners; this does not create character Journals.
  for (const actor of Array.from(game.actors))
    if (
      (!maintenanceActorIds || maintenanceActorIds.includes(actor.id)) &&
      playerCharacter(actor) &&
      (techRole(actor) || isNetrunner(actor))
    )
      await storageActor(actor);
  await syncUpgradeStorage(maintenanceActorIds);
  // Only write accounts whose identity changed; ordinary Actor resource updates never run setup.
  if (changed) await save(getDowntime());
  else await saveDirectory(state);
  // Re-render existing pages after a presentation update without changing their records.
  for (const account of getDowntime().accounts.filter(
    (a) => !maintenanceActorIds || maintenanceActorIds.includes(a.actorId),
  )) {
    const page = actorLedger(account.actorId);
    const state = page?.getFlag?.(MODULE_ID, FLAG) as DowntimeState | undefined;
    if (page && state) {
      const text = ledgerHtml(state);
      const balance = downtimeBalance(state, account.actorId);
      const hustle = hustleDays(state, account.actorId);
      if (
        page.text?.content !== text ||
        page.getFlag?.(MODULE_ID, "downtimeBalance") !== balance ||
        page.getFlag?.(MODULE_ID, "hustleDays") !== hustle
      )
        await page.update({
          "text.content": text,
          ["flags." + MODULE_ID + ".downtimeBalance"]: balance,
          ["flags." + MODULE_ID + ".hustleDays"]: hustle,
        });
    }
    const activities = activityPage(account.actorId);
    if (activities) {
      const text = activityHtml(activityRecords(account.actorId));
      if (activities.text?.content !== text)
        await activities.update({ "text.content": text });
    }
  }
}

export function ownedCharacter(actorId: string): FoundryActor {
  const actor = Array.from(game.actors).find((a) => a.id === actorId);
  if (
    !actor ||
    isActorExcluded(actorId) ||
    actor.type !== "character" ||
    !game.user ||
    (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER"))
  )
    throw new Error("Choose an owned character to spend its downtime.");
  return actor;
}
