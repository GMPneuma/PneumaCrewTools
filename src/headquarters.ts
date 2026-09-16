import {
  ensureHeadquartersJournal,
  headquartersJournal,
  hqPage,
  canPayHq,
  hqProperties,
  saveHqProperties,
  ensureHqPages,
  saveHqRentRecord,
  type HqProperties,
} from "./hq-records";
import { getHqCatalog, HqCatalogSettings } from "./hq-catalog";
import * as rent from "./rent";
import { rentCharge, modifierLabel } from "./rent-model";
import { openRent } from "./rent-form";
import { coalesceRefresh } from "./ui-refresh";
import { CrewToolsForm } from "./foundry-form";
import { displayDate } from "./date-format";
import { isActorExcluded } from "./actor-policy";
import { MODULE_ID } from "./constants";
import { createUniqueId } from "./id";
import { getCampaignDate } from "./calendar";
import {
  queueAction,
  withGMAction as withDowntimeLock,
  isPrimaryGM as isDowntimeGM,
} from "./action-coordinator";
import type { PayoutPlan } from "./payout-execution";
export interface HeadquartersRecord {
  id: string;
  name: string;
  image: string;
  description?: string;
  bedrooms?: number;
  maxImprovements?: number | null;
  actorId: string;
  improvements: Array<{
    id: string;
    catalogId?: string;
    level?: number;
    name: string;
    cost: number;
    notes: string;
    date: string;
    effect?: "notes" | "medbay" | "workshop";
  }>;
}
export interface HeadquartersState {
  version: 1;
  headquarters: HeadquartersRecord[];
  transactions: Array<{
    id: string;
    amount: number;
    reason: string;
    date: string;
    payoutId?: string;
    hqId?: string;
    improvementId?: string;
  }>;
}
const KEY = "headquarters";
// CPR's native Stash preset, applied atomically instead of separate flag updates.
const STASH_FLAGS = {
  "container-type": "stash",
  "items-free": true,
  "players-create": true,
  "players-delete": true,
  "players-modify": true,
  "players-move": true,
};
function stashChanges(actor: FoundryActor): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(STASH_FLAGS))
    if (actor.getFlag("cyberpunk-red-core", key) !== value)
      changes["flags.cyberpunk-red-core." + key] = value;
  for (const key of ["infinite-stock", "players-sell"])
    if (actor.getFlag("cyberpunk-red-core", key) !== undefined)
      changes["flags.cyberpunk-red-core.-=" + key] = null;
  return changes;
}
let window: HeadquartersForm | undefined;
const empty = (): HeadquartersState => ({
  version: 1,
  headquarters: [],
  transactions: [],
});
const ipCache = new WeakMap<object, number>();
export function headquartersIp(state?: HeadquartersState): number {
  if (state) return state.transactions.reduce((n, t) => n + t.amount, 0);
  const stored = page()?.getFlag?.(MODULE_ID, KEY) as
    (HeadquartersState & { balance?: number }) | undefined;
  if (!stored) return 0;
  if (Number.isSafeInteger(stored.balance)) return stored.balance!;
  // Older ledgers are calculated once per document version until their next save.
  let balance = ipCache.get(stored);
  if (balance === undefined) {
    balance = stored.transactions.reduce((n, t) => n + t.amount, 0);
    ipCache.set(stored, balance);
  }
  return balance;
}
function page(): FoundryJournalPage | undefined {
  const journals = Array.from(game.journal).filter(
    (j) => j.getFlag?.(MODULE_ID, KEY) === true,
  );
  if (journals.length > 1)
    throw new Error(
      "Multiple Headquarters Journals exist. Keep one active ledger.",
    );
  return (
    journals[0] &&
    Array.from(journals[0].pages).find(
      (p) => p.getFlag?.(MODULE_ID, "kind") === KEY,
    )
  );
}
// Native name/image come from the Container; all HQ bookkeeping comes from its Journal page.
export function getHeadquarters(includeLedger = true): HeadquartersState {
  const stored = (
    includeLedger ? page()?.getFlag?.(MODULE_ID, KEY) : undefined
  ) as HeadquartersState | undefined;
  const state: HeadquartersState = {
    version: 1,
    transactions: structuredClone(stored?.transactions ?? []),
    headquarters: Array.from(game.actors)
      .filter((actor) => {
        const document =
          actor.type === "container" ? hqPage(actor.id) : undefined;
        if (!document || document.getFlag?.(MODULE_ID, "inactive") === true)
          return false;
        // Every player list and facility check shares this permission boundary.
        // Use native permission tests so inherited and per-user access both apply.
        return (
          !!game.user &&
          (game.user.isGM ||
            (actor.testUserPermission(game.user, "OBSERVER") &&
              document.testUserPermission?.(game.user, "OBSERVER") === true))
        );
      })
      .map((actor) => {
        const data = hqProperties(actor.id)!;
        return {
          id: actor.id,
          actorId: actor.id,
          name: actor.name,
          image: actor.img ?? "",
          bedrooms: data.bedrooms ?? 0,
          maxImprovements: data.maxImprovements ?? null,
          description: data.description ?? "",
          improvements: structuredClone(data.improvements ?? []),
        };
      }),
  };
  validate(state);
  return state;
}
function validate(state: HeadquartersState): void {
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.headquarters) ||
    !Array.isArray(state.transactions)
  )
    throw new Error("Invalid Headquarters Journal data.");
  const ids = new Set<string>(),
    actors = new Set<string>(),
    purchases = new Set<string>(),
    transactions = new Set<string>(),
    payouts = new Set<string>();
  for (const hq of state.headquarters) {
    if (
      !hq ||
      typeof hq.id !== "string" ||
      !hq.id ||
      ids.has(hq.id) ||
      typeof hq.name !== "string" ||
      !hq.name.trim() ||
      typeof hq.image !== "string" ||
      typeof hq.actorId !== "string" ||
      !hq.actorId ||
      actors.has(hq.actorId) ||
      !Array.isArray(hq.improvements)
    )
      throw new Error("Invalid or duplicate headquarters.");
    ids.add(hq.id);
    actors.add(hq.actorId);
    for (const item of hq.improvements) {
      if (
        !item ||
        typeof item.id !== "string" ||
        purchases.has(item.id) ||
        !item.id ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        !Number.isSafeInteger(item.cost) ||
        item.cost < 0 ||
        typeof item.notes !== "string" ||
        typeof item.date !== "string"
      )
        throw new Error("Invalid HQ improvement.");
      if (
        item.effect !== undefined &&
        !["notes", "medbay", "workshop"].includes(item.effect)
      )
        throw new Error("Invalid improvement effect.");
      purchases.add(item.id);
    }
  }
  let balance = 0;
  for (const t of state.transactions) {
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id ||
      transactions.has(t.id) ||
      !Number.isSafeInteger(t.amount) ||
      typeof t.reason !== "string" ||
      typeof t.date !== "string"
    )
      throw new Error("Invalid HQ IP transaction.");
    transactions.add(t.id);
    if (t.payoutId) {
      if (payouts.has(t.payoutId)) throw new Error("Duplicate HQ IP payout.");
      payouts.add(t.payoutId);
    }
    balance += t.amount;
    if (!Number.isSafeInteger(balance) || balance < 0)
      throw new Error("HQ IP cannot be overdrawn.");
  }
}
function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function html(state: HeadquartersState): string {
  return (
    `<p>Shared crew HQ IP: <strong>${headquartersIp(state)}</strong></p>` +
    `<h2>HQ IP ledger</h2><table><thead><tr><th>Date</th><th>Adjustment</th><th>Reason</th><th>Source</th></tr></thead><tbody>${state.transactions.map((t) => `<tr><td>${esc(displayDate(t.date))}</td><td>${t.amount}</td><td>${esc(t.reason)}</td><td>${esc(t.payoutId ?? t.improvementId ?? "")}</td></tr>`).join("")}</tbody></table>
    <details><summary>About this page</summary><p>Payouts add shared HQ IP; improvement purchases spend it. HQ properties, improvements, bills, and payments live on each HQ page in this Journal. Editing this text does not change records.</p></details>`
  );
}
async function save(state: HeadquartersState): Promise<void> {
  validate(state);
  const document = page();
  if (!document) throw new Error("HQ IP Journal is missing.");
  const changed: Array<{ actor: FoundryActor; before: HqProperties }> = [];
  try {
    for (const hq of state.headquarters) {
      const actor = game.actors.get(hq.actorId);
      if (!actor) throw new Error("HQ Actor no longer exists.");
      const before = hqProperties(actor.id)!;
      const after = {
        bedrooms: hq.bedrooms ?? 0,
        maxImprovements: hq.maxImprovements ?? null,
        description: hq.description ?? "",
        improvements: hq.improvements,
      };
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changed.push({ actor, before });
      await saveHqProperties(actor, after);
    }
    await document.update({
      [`flags.${MODULE_ID}.${KEY}`]: {
        version: 1,
        transactions: state.transactions,
        balance: headquartersIp(state),
      },
      "text.content": html(state),
    });
  } catch (error) {
    for (const { actor, before } of changed.reverse())
      await saveHqProperties(actor, before);
    throw error;
  }
}
async function folders(type: "Actor" | "JournalEntry"): Promise<string> {
  const root =
    Array.from(game.folders).find(
      (f) => f.type === type && f.name === "CrewTools" && !f.folder,
    ) ?? (await Folder.create({ name: "CrewTools", type, sorting: "a" }));
  if (
    !Array.from(game.folders).some(
      (f) =>
        f.type === type &&
        f.name === "CrewTools-GM" &&
        f.folder?.id === root.id,
    )
  )
    await Folder.create({
      name: "CrewTools-GM",
      type,
      folder: root.id,
      sorting: "a",
    });
  return root.id;
}
async function ensure(): Promise<string> {
  const actorFolder = await folders("Actor");
  const journal = await ensureHeadquartersJournal();
  if (!page())
    await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name: "Shared HQ IP",
        type: "text",
        ownership: { default: 3 },
        flags: {
          [MODULE_ID]: {
            kind: KEY,
            [KEY]: { version: 1, transactions: [], balance: 0 },
          },
        },
        text: { content: html(empty()) },
      },
    ]);
  const current = page()!;
  if (current.ownership?.default !== 3)
    await current.update({ "ownership.default": 3 });
  const legacy = current.getFlag?.(MODULE_ID, KEY) as HeadquartersState;
  if (legacy.headquarters?.some((h) => !game.actors.get(h.actorId)))
    throw new Error(
      "Restore the missing HQ Container before converting HQ records.",
    );
  // Copy complete records first, then remove the obsolete Actor copies.
  for (const actor of game.actors) {
    const old = actor.getFlag?.(MODULE_ID, "hq") as HqProperties | undefined;
    const roster = legacy.headquarters?.find((h) => h.actorId === actor.id);
    if (actor.type !== "container" || (!old && !roster && !hqPage(actor.id)))
      continue;
    const properties = old ?? roster ?? hqProperties(actor.id)!;
    const rental = actor.getFlag?.(MODULE_ID, "rent") as
      import("./rent-model").HqRent | undefined;
    await ensureHqPages(
      actor,
      properties,
      rental ?? { typeId: "", modifier: 0, bills: [] },
    );
    const changes = stashChanges(actor);
    if (old) changes["flags." + MODULE_ID + ".-=hq"] = null;
    if (rental) changes["flags." + MODULE_ID + ".-=rent"] = null;
    if (Object.keys(changes).length) await actor.update(changes);
  }
  if (legacy.headquarters?.length) {
    const transactions = legacy.transactions.map((t) => ({
      ...t,
      ...(t.hqId
        ? {
            hqId:
              legacy.headquarters.find((h) => h.id === t.hqId)?.actorId ??
              t.hqId,
          }
        : {}),
    }));
    await current.update({
      ["flags." + MODULE_ID + "." + KEY]: {
        version: 1,
        transactions,
        balance: transactions.reduce((sum, t) => sum + t.amount, 0),
      },
    });
  }
  const content = html(getHeadquarters());
  if (current.text?.content !== content)
    await current.update({ "text.content": content });
  return actorFolder;
}
export async function saveHeadquarters(input: {
  id?: string;
  name: string;
  description?: string;
  actorId?: string;
  bedrooms?: number;
  maxImprovements?: number | null;
  rentType?: string;
  rentModifier?: number;
}): Promise<string> {
  return withDowntimeLock(async () => {
    const folderId = await ensure();
    const name = input.name.trim();
    if (!name || name.length > 100)
      throw new Error("Enter an HQ name of 1–100 characters.");
    const description = (input.description ?? "").trim();
    if (description.length > 2000)
      throw new Error("HQ description must be at most 2000 characters.");
    if (input.id && input.actorId && input.id !== input.actorId)
      throw new Error("An HQ is its Container Actor; it cannot be relinked.");
    const actorId = input.id || input.actorId;
    if (actorId && isActorExcluded(actorId))
      throw new Error("This container Actor is excluded from Crew Tools.");
    const actor = actorId ? game.actors.get(actorId) : undefined;
    if (actorId && actor?.type !== "container")
      throw new Error("Choose a Cyberpunk RED container Actor.");
    if (actorId && hqPage(actorId)?.getFlag?.(MODULE_ID, "inactive") === true)
      throw new Error(
        "This HQ is inactive. Remove its HQ Journal page and container to finish deleting it.",
      );
    if (input.id && !hqPage(input.id))
      throw new Error("Headquarters no longer exists.");
    if (!input.id && actor && hqPage(actor.id))
      throw new Error("This container is already an HQ.");
    const current = actor ? hqProperties(actor.id) : undefined;
    const bedrooms = input.bedrooms ?? current?.bedrooms ?? 0;
    const maxImprovements =
      input.maxImprovements === undefined
        ? (current?.maxImprovements ?? null)
        : input.maxImprovements;
    if (
      !Number.isSafeInteger(bedrooms) ||
      bedrooms < 0 ||
      (maxImprovements !== null &&
        (!Number.isSafeInteger(maxImprovements) ||
          maxImprovements < 0 ||
          maxImprovements < (current?.improvements.length ?? 0)))
    )
      throw new Error(
        "Enter whole bedrooms and an improvement limit no lower than the installed count.",
      );
    const rental = actor
      ? rent.hqRent(actor)
      : { typeId: "", modifier: 0, bills: [] };
    if (input.rentType !== undefined) {
      if (
        input.rentType &&
        !rent.rentConfig().housing.some((r) => r.id === input.rentType)
      )
        throw new Error("Choose a valid rent type.");
      if (!rent.rentModifiers().includes(input.rentModifier ?? 0))
        throw new Error("Choose a valid rent modifier.");
      rental.typeId = input.rentType;
      rental.modifier = input.rentModifier ?? 0;
    }
    const data = {
      bedrooms,
      maxImprovements,
      description,
      improvements: current?.improvements ?? [],
    };
    if (actor) {
      await actor.update({
        ...stashChanges(actor),
        name,
      });
      await ensureHqPages(actor, data, rental);
      await saveHqProperties(actor, data);
      await saveHqRentRecord(actor, rental);
      return actor.id;
    }
    const created = await Actor.create({
      name,
      type: "container",
      img: `modules/${MODULE_ID}/images/headquarters.svg`,
      folder: folderId,
      ownership: { default: 2 },
      flags: {
        "cyberpunk-red-core": { ...STASH_FLAGS },
      },
    });
    try {
      await ensureHqPages(created, data, rental);
    } catch (error) {
      await created.delete();
      throw error;
    }
    return created.id;
  });
}
export async function buyHqImprovement(
  hqId: string,
  name: string,
  cost: number,
  notes: string,
  effect?: "notes" | "medbay" | "workshop",
  catalogId?: string,
): Promise<void> {
  await queueAction(async () => {
    if (
      !game.user ||
      (!game.user.isGM &&
        (!canPayHq(hqId) || !page()?.testUserPermission?.(game.user, "OWNER")))
    )
      throw new Error("You cannot spend shared HQ IP for this HQ.");
    const state = getHeadquarters(),
      hq = state.headquarters.find((h) => h.id === hqId);
    if (!hq) throw new Error("Select a headquarters.");
    if (!name.trim() || name.trim().length > 100 || notes.length > 1000)
      throw new Error(
        "Enter an improvement name (up to 100 characters) and notes (up to 1000).",
      );
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > headquartersIp(state))
      throw new Error("Enter a whole HQ IP cost within the available pool.");
    const id = createUniqueId(),
      date = getCampaignDate();
    const existing = catalogId
      ? hq.improvements.find(
          (i) =>
            i.catalogId === catalogId ||
            (!i.catalogId &&
              i.name.toLowerCase() === name.trim().toLowerCase()),
        )
      : undefined;
    const option = catalogId
      ? getHqCatalog().find((i) => i.id === catalogId)
      : undefined;
    const nextLevel = existing ? (existing.level ?? 1) + 1 : 1;
    if (
      option?.hasLevel2 !== undefined &&
      nextLevel > (option.hasLevel2 ? 2 : 1)
    )
      throw new Error("This improvement has reached its final level.");
    if (option?.hasLevel2 !== undefined)
      notes =
        nextLevel === 2 ? (option.level2Description ?? "") : option.description;
    if (
      !existing &&
      hq.maxImprovements != null &&
      hq.improvements.length >= hq.maxImprovements
    )
      throw new Error("This HQ has reached its improvement limit.");
    if (existing) {
      existing.level = (existing.level ?? 1) + 1;
      existing.cost += cost;
      existing.catalogId = catalogId;
      if (option?.hasLevel2 !== undefined) existing.notes = notes.trim();
    } else
      hq.improvements.push({
        catalogId,
        level: 1,
        id,
        name: name.trim(),
        cost,
        notes: notes.trim(),
        effect,
        date,
      });
    state.transactions.push({
      id: createUniqueId(),
      amount: -cost,
      date,
      reason: hq.name + ": " + name.trim(),
      hqId,
      improvementId: existing?.id ?? id,
    });
    await save(state);
  });
}
// Corrections share the same GM action queue as payouts and purchases.
export async function adjustHeadquartersIp(
  amount: number,
  reason: string,
): Promise<void> {
  await withDowntimeLock(async () => {
    await ensure();
    const state = getHeadquarters();
    if (
      !Number.isSafeInteger(amount) ||
      amount === 0 ||
      !reason.trim() ||
      reason.length > 200
    )
      throw new Error(
        "Enter a nonzero whole-number adjustment and a reason (up to 200 characters).",
      );
    state.transactions.push({
      id: createUniqueId(),
      amount,
      reason: reason.trim(),
      date: getCampaignDate(),
    });
    await save(state);
  });
}
export async function editHqImprovement(
  hqId: string,
  improvementId: string,
  name: string,
  notes: string,
  effect: "notes" | "medbay" | "workshop",
): Promise<void> {
  await withDowntimeLock(async () => {
    const state = getHeadquarters();
    const item = state.headquarters
      .find((h) => h.id === hqId)
      ?.improvements.find((i) => i.id === improvementId);
    if (!item) throw new Error("Improvement no longer exists.");
    if (!name.trim() || name.trim().length > 100 || notes.length > 1000)
      throw new Error(
        "Enter a name (up to 100 characters) and notes (up to 1000).",
      );
    Object.assign(item, { name: name.trim(), notes: notes.trim(), effect });
    await save(state);
  });
}
export function headquartersAccess(actorId: string) {
  const actor = game.actors.get(actorId);
  const document = hqPage(actorId);
  const players = Array.from(game.users ?? [])
    .filter((u) => !u.isGM)
    .map((u) => ({
      id: u.id,
      name: u.name ?? u.id,
      selected:
        !!actor?.testUserPermission(u, "OBSERVER") &&
        document?.testUserPermission?.(u, "OBSERVER") === true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pageDefault = document?.ownership?.default ?? -1;
  const everyone =
    (actor?.ownership?.default ?? 0) >= 2 &&
    (pageDefault === -1
      ? (document?.parent?.ownership?.default ?? 0)
      : pageDefault) >= 2 &&
    players.every((p) => p.selected);
  return {
    everyone,
    players,
    summary: everyone
      ? "Everyone"
      : players
          .filter((p) => p.selected)
          .map((p) => p.name)
          .join(", ") || "GM only",
  };
}

export function saveHeadquartersAccess(
  actorId: string,
  everyone: boolean,
  selected: string[],
): Promise<void> {
  return withDowntimeLock(async () => {
    if (!game.user?.isGM) throw new Error("Only the GM can change HQ access.");
    const actor = game.actors.get(actorId),
      document = hqPage(actorId);
    if (
      !actor ||
      !document ||
      document.getFlag?.(MODULE_ID, "inactive") === true
    )
      throw new Error("Headquarters no longer exists or is inactive.");
    const players = Array.from(game.users ?? []).filter((u) => !u.isGM);
    const ids = new Set(selected);
    if (selected.some((id) => !players.some((u) => u.id === id)))
      throw new Error(
        "A selected player no longer exists. Reopen Player Access.",
      );
    const before = structuredClone(actor.ownership ?? {});
    const changes = (ownership: Record<string, number> = {}) => ({
      "ownership.default": everyone ? Math.max(2, ownership.default ?? 0) : 0,
      ...Object.fromEntries(
        players.map((u) => [
          // Foundry's Default choice removes the per-user override.
          everyone ? "ownership.-=" + u.id : "ownership." + u.id,
          everyone
            ? null
            : ids.has(u.id)
              ? Math.max(2, ownership[u.id] ?? ownership.default ?? 0)
              : 0,
        ]),
      ),
    });
    await actor.update(changes(before));
    try {
      await document.update(changes(document.ownership));
    } catch (error) {
      await actor.update(
        Object.fromEntries(
          ["default", ...players.map((u) => u.id)].map((id) =>
            Object.hasOwn(before, id)
              ? ["ownership." + id, before[id]]
              : ["ownership.-=" + id, null],
          ),
        ),
      );
      throw error;
    }
  });
}

// Soft deletion retains the HQ's records and contents for deliberate GM cleanup.
// Revoke native visibility as well as excluding it from module discovery.
export function deactivateHeadquarters(actorId: string): Promise<void> {
  return withDowntimeLock(async () => {
    const actor = game.actors.get(actorId);
    const document = hqPage(actorId);
    if (!actor || !document) throw new Error("Headquarters no longer exists.");
    if (document.getFlag?.(MODULE_ID, "inactive") === true) return;
    const ownership = structuredClone(actor.ownership ?? {});
    const hidden = (current: Record<string, number> = {}) =>
      Object.fromEntries(
        ["default", ...Object.keys(current)].map((id) => [
          "ownership." + id,
          0,
        ]),
      );
    await actor.update(hidden(ownership));
    try {
      await document.update({
        ...hidden(document.ownership),
        ["flags." + MODULE_ID + ".inactive"]: true,
        "text.content":
          "<p><strong>Inactive HQ.</strong> The GM may delete this HQ page and its container to finish removal. Keep the shared Headquarters Journal and Shared HQ IP page.</p>" +
          (document.text?.content ?? ""),
      });
    } catch (error) {
      // A failed page write must not leave an active HQ's container hidden.
      await actor.update({
        "ownership.default": ownership.default ?? 0,
        ...Object.fromEntries(
          Object.entries(ownership).map(([id, level]) => [
            "ownership." + id,
            level,
          ]),
        ),
      });
      throw error;
    }
  });
}
export async function removeHqImprovement(
  hqId: string,
  improvementId: string,
): Promise<void> {
  await withDowntimeLock(async () => {
    const state = getHeadquarters();
    const hq = state.headquarters.find((h) => h.id === hqId);
    const item = hq?.improvements.find((i) => i.id === improvementId);
    if (!hq || !item) throw new Error("Improvement no longer exists.");
    hq.improvements = hq.improvements.filter((i) => i.id !== improvementId);
    state.transactions.push({
      id: createUniqueId(),
      amount: 0,
      reason: hq.name + ": removed " + item.name + " (no IP refund)",
      date: getCampaignDate(),
      hqId,
      improvementId,
    });
    await save(state);
  });
}
// Caller holds the payout/downtime lock through its complete transaction.
export async function applyHeadquartersPayout(
  plan: PayoutPlan,
  payoutId: string,
): Promise<() => Promise<void>> {
  if (!plan.hqIpTransactions.length) return async () => {};
  await ensure();
  const before = getHeadquarters(),
    state = structuredClone(before);
  if (state.transactions.some((t) => t.payoutId === payoutId))
    throw new Error("HQ IP already awarded for this payout.");
  const amount = plan.hqIpTransactions.reduce((n, t) => {
    if (!Number.isSafeInteger(t.amount))
      throw new Error("HQ IP must be whole numbers.");
    return n + t.amount;
  }, 0);
  state.transactions.push({
    id: createUniqueId(),
    amount,
    date: plan.inGameDate,
    reason:
      plan.sessionLabel +
      ": " +
      plan.hqIpTransactions.map((t) => t.reason).join("; "),
    payoutId,
  });
  await save(state);
  return () => save(before);
}
function report(error: unknown): void {
  ui.notifications.error(
    error instanceof Error ? error.message : "Headquarters update failed.",
  );
}
export class HeadquartersForm extends CrewToolsForm {
  selectedId: string | undefined;
  #busy = false;
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-headquarters",
      title: "Crew Tools — Headquarters",
      classes: [...(super.defaultOptions.classes ?? []), MODULE_ID],
      template: `modules/${MODULE_ID}/templates/headquarters.hbs`,
      width: 640,
      height: 680,
      resizable: true,
      scrollY: [".window-content"],
      closeOnSubmit: false,
    };
  }
  override getData(): object {
    const state = getHeadquarters(false);
    if (
      this.selectedId === undefined ||
      (this.selectedId &&
        !state.headquarters.some((h) => h.id === this.selectedId))
    )
      this.selectedId = state.headquarters[0]?.id ?? "";
    const hq = state.headquarters.find((h) => h.id === this.selectedId);
    const actor = hq && game.actors.get(hq.actorId);
    const config = rent.rentConfig();
    const rental = actor && rent.hqRent(actor);
    const rate = config.housing.find((r) => r.id === rental?.typeId);
    const effectOptions = (effect = "notes") =>
      [
        { id: "notes", name: "Notes only" },
        { id: "medbay", name: "Medbay: +2 effective BODY when healing" },
        { id: "workshop", name: "Workshop: three TECH project slots" },
      ].map((e) => ({
        ...e,
        selected: e.id === effect,
        benefit: e.id !== "notes",
      }));
    return {
      hq: hq && {
        ...hq,
        improvements: hq.improvements.map((i) => ({
          ...i,
          level: i.level ?? 1,
          canManage: isDowntimeGM(),
          effects: effectOptions(
            i.effect ??
              (/^med[ -]?bay$/i.test(i.name.trim())
                ? "medbay"
                : /^workshop(?:[ -]?add[ -]?on)?$/i.test(i.name.trim())
                  ? "workshop"
                  : "notes"),
          ),
        })),
      },
      catalog: getHqCatalog()
        .map((i) => ({
          ...i,
          level:
            (hq?.improvements.find(
              (h) =>
                h.catalogId === i.id ||
                (!h.catalogId && h.name.toLowerCase() === i.name.toLowerCase()),
            )?.level ??
              (hq?.improvements.some(
                (h) => h.name.toLowerCase() === i.name.toLowerCase(),
              )
                ? 1
                : 0)) + 1,
        }))
        .filter(
          (i) => i.hasLevel2 === undefined || i.level <= (i.hasLevel2 ? 2 : 1),
        )
        .map((i) => ({
          ...i,
          description:
            i.level === 2 && i.hasLevel2
              ? (i.level2Description ?? "")
              : i.description,
        })),
      effects: effectOptions(),
      rentAmount:
        rate && rental ? rentCharge(rate, rental.modifier).amount : undefined,
      rentConfigured: !!rate,
      rentRates: config.housing.map((r) => ({
        ...r,
        selected: r.id === rental?.typeId,
      })),
      rentModifiers: rent.rentModifiers().map((value) => ({
        value,
        label: modifierLabel(value),
        selected: value === (rental?.modifier ?? 0),
      })),
      rentBills: (rental?.bills ?? [])
        .filter((b) => b.paid < b.charge.amount)
        .map((b) => ({
          date: displayDate(b.date),
          paid: b.paid,
          total: b.charge.amount,
          remaining: b.charge.amount - b.paid,
          progress: b.charge.amount ? (100 * b.paid) / b.charge.amount : 100,
        })),
      accessSummary: actor ? headquartersAccess(actor.id).summary : "Everyone",
      ip: headquartersIp(),
      canManage: isDowntimeGM(),
      canBuy:
        !!hq &&
        (isDowntimeGM() ||
          (canPayHq(hq.actorId) &&
            !!game.user &&
            page()?.testUserPermission?.(game.user, "OWNER"))),
      inactiveHqs: isDowntimeGM()
        ? Array.from(headquartersJournal()?.pages ?? [])
            .filter(
              (p) =>
                p.getFlag?.(MODULE_ID, "recordKey") === "hq" &&
                p.getFlag?.(MODULE_ID, "inactive") === true,
            )
            .map((p) => ({ name: p.name }))
        : [],
      hasHq: state.headquarters.length > 0,
      headquarters: state.headquarters.map((h) => ({
        ...h,
        selected: h.id === this.selectedId,
      })),
      hasContainer: actor?.type === "container" && !isActorExcluded(actor.id),
      containerName: actor?.name ?? "Container missing",
      containers: Array.from(game.actors)
        .filter(
          (a) =>
            a.type === "container" &&
            !isActorExcluded(a.id) &&
            hqPage(a.id)?.getFlag?.(MODULE_ID, "inactive") !== true &&
            !state.headquarters.some(
              (h) => h.actorId === a.id && h.id !== hq?.id,
            ),
        )
        .map((a) => ({
          id: a.id,
          name: a.name,
          selected: a.id === hq?.actorId,
        })),
    };
  }
  async #perform(action: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await action();
      this.render(false, { focus: false });
    } catch (e) {
      report(e);
    } finally {
      this.#busy = false;
    }
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!this.selectedId)
      root?.querySelector(".hq-editor")?.setAttribute("open", "");
    const choice = root?.querySelector<HTMLSelectElement>(
      '[name="improvementId"]',
    );
    const describe = () => {
      const text = root?.querySelector("[data-improvement-description]");
      if (text)
        text.textContent =
          choice?.selectedOptions[0]?.dataset.description ?? "";
    };
    choice?.addEventListener("change", describe);
    describe();
    const value = (name: string) =>
      root?.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('[name="' + name + '"]')?.value ?? "";
    root?.querySelector("[data-select-hq]")?.addEventListener("change", () => {
      this.selectedId = value("selectedHq");
      this.render(true);
    });
    root?.querySelector("[data-hq-access]")?.addEventListener("click", () => {
      const actorId = this.selectedId;
      if (!actorId || !isDowntimeGM()) return;
      const access = headquartersAccess(actorId);
      const dialog = new Dialog(
        {
          title: "HQ Player Access",
          content: `<div class="pneuma-crewtools"><div class="hq-access-dialog">
          <p>Players with access can see this HQ and use its improvements.</p>
          <label><input type="radio" name="hqAccess" value="everyone" ${access.everyone ? "checked" : ""}> <span>Everyone</span></label>
          <label><input type="radio" name="hqAccess" value="selected" ${!access.everyone ? "checked" : ""}> <span>Selected players</span></label>
          <div data-access-players ${access.everyone ? "hidden" : ""}>${access.players.map((p) => `<label><input type="checkbox" data-access-player value="${esc(p.id)}" ${p.selected ? "checked" : ""}> <span>${esc(p.name)}</span></label>`).join("") || "<p>No player users yet.</p>"}</div>
          </div></div>`,
          render: (html) => {
            const root = html[0];
            root?.querySelectorAll('[name="hqAccess"]').forEach((radio) =>
              radio.addEventListener("change", () => {
                const list = root.querySelector<HTMLElement>(
                  "[data-access-players]",
                );
                if (list)
                  list.hidden =
                    root.querySelector<HTMLInputElement>(
                      '[name="hqAccess"]:checked',
                    )?.value === "everyone";
                dialog.setPosition({ height: "auto" });
              }),
            );
          },
          buttons: {
            save: {
              label: "Save Access",
              callback: (html) => {
                const root = html[0];
                const everyone =
                  root?.querySelector<HTMLInputElement>(
                    '[name="hqAccess"]:checked',
                  )?.value === "everyone";
                const selected = Array.from(
                  root?.querySelectorAll<HTMLInputElement>(
                    "[data-access-player]:checked",
                  ) ?? [],
                ).map((input) => input.value);
                void this.#perform(() =>
                  saveHeadquartersAccess(actorId, everyone, selected),
                );
              },
            },
            cancel: { label: "Cancel" },
          },
          default: "cancel",
        },
        { width: 420, height: "auto", resizable: true },
      );
      dialog.render(true);
    });
    root?.querySelector("[data-new-hq]")?.addEventListener("click", () => {
      this.selectedId = "";
      this.render(true);
    });
    root?.querySelector("[data-delete-hq]")?.addEventListener("click", () => {
      const actorId = this.selectedId;
      if (!actorId) return;
      void this.#perform(async () => {
        const confirmed = await new Promise<boolean>((resolve) => {
          new Dialog({
            title: "Delete HQ",
            content:
              "<p>Mark this HQ inactive and hide its container and HQ Journal page from players? Its contents and records will be preserved. The GM can then delete that HQ page and container to finish removal. Keep the shared Headquarters Journal.</p>",
            buttons: {
              confirm: {
                label: "Mark Inactive",
                callback: () => resolve(true),
              },
              cancel: { label: "Cancel", callback: () => resolve(false) },
            },
            default: "cancel",
            close: () => resolve(false),
          }).render(true);
        });
        if (confirmed) {
          await deactivateHeadquarters(actorId);
          this.selectedId = undefined;
        }
      });
    });
    root
      ?.querySelector("[data-open-container]")
      ?.addEventListener("click", () => {
        const hq = getHeadquarters().headquarters.find(
          (h) => h.id === this.selectedId,
        );
        if (hq && !isActorExcluded(hq.actorId))
          game.actors.get(hq.actorId)?.sheet?.render(true);
      });
    root
      ?.querySelector("[data-rent-open]")
      ?.addEventListener("click", () => openRent());
    root
      ?.querySelectorAll<HTMLButtonElement>("[data-edit-improvement]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void this.#perform(() => {
              const id = button.dataset.editImprovement!;
              return editHqImprovement(
                this.selectedId ?? "",
                id,
                value("name-" + id),
                value("notes-" + id),
                value("effect-" + id) as "notes" | "medbay" | "workshop",
              );
            }),
        ),
      );
    root
      ?.querySelectorAll<HTMLButtonElement>("[data-remove-improvement]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void this.#perform(async () => {
              const confirmed = await new Promise<boolean>((resolve) =>
                new Dialog({
                  title: "Remove Improvement?",
                  content:
                    "<p>Remove this improvement and its benefits? HQ IP will not be refunded.</p>",
                  buttons: {
                    keep: { label: "Keep", callback: () => resolve(false) },
                    remove: { label: "Remove", callback: () => resolve(true) },
                  },
                  default: "keep",
                  close: () => resolve(false),
                }).render(true),
              );
              if (confirmed)
                await removeHqImprovement(
                  this.selectedId ?? "",
                  button.dataset.removeImprovement!,
                );
            }),
        ),
      );
    root?.querySelector("[data-buy-improvement]")?.addEventListener(
      "click",
      () =>
        void this.#perform(() => {
          const option = getHqCatalog().find(
            (i) => i.id === value("improvementId"),
          );
          if (!option) throw new Error("Choose an improvement.");
          return buyHqImprovement(
            this.selectedId ?? "",
            option.name,
            option.cost,
            option.description,
            option.effect,
            option.id,
          );
        }),
    );
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.#perform(async () => {
      this.selectedId = await saveHeadquarters({
        id: this.selectedId || undefined,
        name: String(data.name ?? ""),
        description: String(data.description ?? ""),
        actorId: String(data.actorId ?? ""),
        bedrooms: Number(data.bedrooms ?? 0),
        maxImprovements:
          data.maxImprovements === "" || data.maxImprovements == null
            ? null
            : Number(data.maxImprovements),
        rentType: String(data.rentType ?? ""),
        rentModifier: Number(data.rentModifier ?? 0),
      });
    });
  }
}
export function openHeadquarters(): void {
  const open = () => {
    window ??= new HeadquartersForm();
    window.render(true);
  };
  if (isDowntimeGM()) void withDowntimeLock(ensure).then(open).catch(report);
  else open();
}
export function registerHeadquarters(): void {
  game.settings.registerMenu(MODULE_ID, "hqImprovements", {
    name: "HQ Improvements",
    label: "Manage Custom Improvements",
    hint: "Add custom improvements with their own HQ IP costs.",
    icon: "fas fa-tools",
    type: HqCatalogSettings,
    restricted: true,
  });
  const refresh = coalesceRefresh(() => {
    if (window?.rendered) window.render(false, { focus: false });
  });
  Hooks.on("updateJournalEntryPage", (page: FoundryJournalPage) => {
    if (
      page.getFlag?.(MODULE_ID, "kind") === "headquarters" ||
      ["rentConfig", "hq"].includes(
        String(page.getFlag?.(MODULE_ID, "recordKey")),
      )
    )
      refresh();
  });
  Hooks.on("createJournalEntryPage", (page) => {
    if (page.getFlag?.(MODULE_ID, "recordKey") === "hq") refresh();
  });
  Hooks.on("deleteJournalEntryPage", (page) => {
    if (
      page.getFlag?.(MODULE_ID, "kind") === "headquarters" ||
      ["rentConfig", "hq"].includes(
        String(page.getFlag?.(MODULE_ID, "recordKey")),
      )
    )
      refresh();
  });
  Hooks.on(
    "updateActor",
    (actor: FoundryActor, changes: Record<string, unknown>) => {
      if (!window?.rendered) return;
      const paths = (value: Record<string, unknown>, prefix = ""): string[] =>
        Object.entries(value).flatMap(([key, child]) => {
          const path = prefix + key;
          return child && typeof child === "object" && !Array.isArray(child)
            ? paths(child as Record<string, unknown>, path + ".")
            : [path];
        });
      const keys = paths(changes);
      if (
        hqPage(actor.id) &&
        keys.some((key) =>
          ["name", "img", "type", "ownership"].some(
            (field) => key === field || key.startsWith(field + "."),
          ),
        )
      )
        refresh();
    },
  );
  Hooks.on("createActor", (actor) => {
    if (window?.rendered && hqPage(actor.id)) refresh();
  });
  Hooks.on("deleteActor", (actor) => {
    if (!window?.rendered) return;
    if (hqPage(actor.id)) refresh();
  });
}
export function readyHeadquarters(): void {
  if (isDowntimeGM()) void withDowntimeLock(ensure).catch(report);
}
