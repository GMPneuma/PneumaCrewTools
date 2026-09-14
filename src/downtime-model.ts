import type { ActivityRecord } from "./activity-records";
import type { ResourceChange } from "./actor-resources";
import { validateHealingResult, type HealingResult } from "./downtime-healing";
import {
  validateTechEvent,
  type TechSpec,
  type TechCheck,
  type TechDelivery,
} from "./tech-project-model";
export type DowntimeUse = "spend" | "rest" | "hustle";
export interface DowntimeAccount {
  actorId: string;
  name: string;
  characterJournalId: string;
}
export interface HustleReward {
  tableId: string;
  resultId: string;
  roll: number;
  roleName: string;
  rank: number;
  activity: string;
  amount: number;
  before: number;
  after: number;
}
export interface DowntimeEvent {
  id: string;
  actorId: string;
  kind:
    | "award"
    | "resource"
    | DowntimeUse
    | "expire"
    | "rejected"
    | "hustleRoll"
    | "techStart"
    | "techDay"
    | "techRoll"
    | "techCancel";
  days: number;
  period: number;
  date: string;
  reason: string;
  payoutId?: string;
  requestId?: string;
  activityId?: string;
  resources?: ResourceChange[];
  projectId?: string;
  roleItemId?: string;
  healing?: HealingResult;
  hustleReward?: HustleReward;
  tech?: TechSpec;
  techCheck?: TechCheck;
  techDelivery?: TechDelivery;
}
export interface DowntimeState {
  version: 1;
  period: number;
  accounts: DowntimeAccount[];
  events: DowntimeEvent[];
  activities?: ActivityRecord[];
}
export function emptyDowntime(): DowntimeState {
  return { version: 1, period: 1, accounts: [], events: [] };
}
export function downtimeBalance(state: DowntimeState, actorId: string): number {
  return state.events
    .filter((e) => e.actorId === actorId)
    .reduce(
      (n, e) =>
        n + (e.kind === "award" ? e.days : e.kind === "rejected" ? 0 : -e.days),
      0,
    );
}
// Allocated hustle days survive session boundaries; each completed roll uses seven.
export function hustleDays(state: DowntimeState, actorId: string): number {
  return state.events
    .filter((e) => e.actorId === actorId)
    .reduce(
      (n, e) =>
        n + (e.kind === "hustle" ? e.days : e.kind === "hustleRoll" ? -7 : 0),
      0,
    );
}
export function wholeDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Enter a positive whole number of downtime days.");
  return value;
}
export function awardDowntime(
  state: DowntimeState,
  event: DowntimeEvent,
): void {
  wholeDays(event.days);
  if (event.kind !== "award" || !event.payoutId)
    throw new Error("A downtime award needs a payout.");
  if (
    state.events.some(
      (e) => e.payoutId === event.payoutId && e.actorId === event.actorId,
    )
  )
    throw new Error(
      "This character's downtime has already been awarded for this payout.",
    );
  if (!Number.isSafeInteger(downtimeBalance(state, event.actorId) + event.days))
    throw new Error("Downtime balance is too large.");
  recordDowntimeTransaction(state, event);
}
export function useDowntime(state: DowntimeState, event: DowntimeEvent): void {
  wholeDays(event.days);
  if (!["spend", "rest", "crafting", "hustle"].includes(event.kind))
    throw new Error("Choose spending, crafting, or hustle.");
  if (!event.reason.trim())
    throw new Error("Describe how these days will be used.");
  if (event.period !== state.period)
    throw new Error("This request belongs to an earlier session period.");
  if (event.days > downtimeBalance(state, event.actorId))
    throw new Error("Not enough unspent downtime days.");
  if (
    event.requestId &&
    state.events.some((e) => e.requestId === event.requestId)
  )
    throw new Error("This request has already been processed.");
  recordDowntimeTransaction(state, event);
}
export function validateDowntime(state: DowntimeState): void {
  if (
    !state ||
    state.version !== 1 ||
    !Number.isSafeInteger(state.period) ||
    state.period < 1 ||
    !Array.isArray(state.accounts) ||
    !Array.isArray(state.events)
  )
    throw new Error("Invalid downtime ledger structure.");
  for (const activity of state.activities ?? [])
    if (activity.kind === "tech")
      for (const event of activity.events)
        validateTechEvent(event.data.event as DowntimeEvent);
  const actors = new Set<string>();
  const journals = new Set<string>();
  for (const account of state.accounts) {
    if (
      !account ||
      typeof account.actorId !== "string" ||
      !account.actorId ||
      typeof account.name !== "string" ||
      typeof account.characterJournalId !== "string" ||
      actors.has(account.actorId) ||
      (account.characterJournalId && journals.has(account.characterJournalId))
    )
      throw new Error("Invalid or duplicate downtime account.");
    actors.add(account.actorId);
    if (account.characterJournalId) journals.add(account.characterJournalId);
  }
  const ids = new Set<string>();
  const requests = new Set<string>();
  const awards = new Set<string>();
  const balances = new Map<string, number>();
  for (const event of state.events) {
    if (
      !event ||
      typeof event.id !== "string" ||
      !event.id ||
      ids.has(event.id) ||
      !actors.has(event.actorId) ||
      ![
        "award",
        "resource",
        "spend",
        "rest",
        "hustle",
        "expire",
        "rejected",
        "hustleRoll",
        "techStart",
        "techDay",
        "techRoll",
        "techCancel",
      ].includes(event.kind) ||
      !Number.isSafeInteger(event.days) ||
      ([
        "resource",
        "rejected",
        "hustleRoll",
        "techStart",
        "techRoll",
        "techCancel",
      ].includes(event.kind)
        ? event.days !== 0
        : event.days < 1) ||
      !Number.isSafeInteger(event.period) ||
      event.period < 1 ||
      event.period > state.period ||
      typeof event.date !== "string" ||
      typeof event.reason !== "string"
    )
      throw new Error("Invalid downtime history row.");
    if (event.healing) {
      if (event.kind !== "rest")
        throw new Error("Only rest can record healing.");
      validateHealingResult(event.healing, event.days);
    }
    if (event.kind === "hustleRoll") {
      const h = event.hustleReward;
      const prior = state.events.slice(0, state.events.indexOf(event));
      if (
        hustleDays({ ...state, events: prior }, event.actorId) < 7 ||
        !event.roleItemId ||
        !h ||
        !h.tableId ||
        !h.resultId ||
        !h.roleName ||
        typeof h.activity !== "string" ||
        !Number.isInteger(h.roll) ||
        h.roll < 1 ||
        h.roll > 6 ||
        !Number.isInteger(h.rank) ||
        h.rank < 1 ||
        h.rank > 10 ||
        !Number.isSafeInteger(h.amount) ||
        h.amount < 0 ||
        !Number.isSafeInteger(h.before) ||
        !Number.isSafeInteger(h.after) ||
        h.after !== h.before + h.amount
      )
        throw new Error(
          "Invalid hustle reward or insufficient allocated days.",
        );
    } else if (event.hustleReward)
      throw new Error("Only a hustle roll can record a reward.");

    ids.add(event.id);
    if (event.requestId !== undefined) {
      if (
        typeof event.requestId !== "string" ||
        !event.requestId ||
        requests.has(event.requestId)
      )
        throw new Error("Duplicate or invalid downtime request ID.");
      requests.add(event.requestId);
    }
    if (event.kind === "award") {
      const key = JSON.stringify([event.actorId, event.payoutId]);
      if (
        typeof event.payoutId !== "string" ||
        !event.payoutId ||
        awards.has(key)
      )
        throw new Error("Duplicate or invalid downtime payout ID.");
      awards.add(key);
    }
    const balance =
      (balances.get(event.actorId) ?? 0) +
      (event.kind === "award"
        ? event.days
        : event.kind === "rejected"
          ? 0
          : -event.days);
    if (!Number.isSafeInteger(balance) || balance < 0)
      throw new Error("Invalid downtime balance in history.");
    balances.set(event.actorId, balance);
  }
}

// All day charges share the same resource-account operation; activities add their own eligibility rules.
export function recordDowntimeTransaction(
  state: DowntimeState,
  event: DowntimeEvent,
): void {
  if (!Number.isSafeInteger(event.days) || event.days < 0)
    throw new Error("Enter non-negative whole downtime days.");
  if (
    event.kind !== "award" &&
    event.kind !== "rejected" &&
    event.days > downtimeBalance(state, event.actorId)
  )
    throw new Error("Not enough unspent downtime days.");
  state.events.push(event);
}
