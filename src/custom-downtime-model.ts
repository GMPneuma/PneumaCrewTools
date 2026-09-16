// Custom activities use existing spend/resource events, preserving one downtime balance.
import type { DowntimeEvent } from "./downtime-model";
export interface CustomActivity {
  id: string;
  name: string;
  days: number | null;
  tableId: string;
}
export type RewardType = "Money" | "Humanity" | "Hitpoints" | "Reputation";
export interface CustomProgress {
  definition: CustomActivity;
  cycle: string;
  started?: boolean;
  result?: {
    text: string;
    tableTotal: number;
    rewards: { type: RewardType; amount: number | null; formula: string }[];
    applied: boolean;
  };
}
export function validateCustomActivity(activity: CustomActivity): void {
  if (
    !activity.id ||
    !activity.name.trim() ||
    activity.name.length > 100 ||
    (activity.days !== null &&
      (!Number.isSafeInteger(activity.days) ||
        activity.days < 1 ||
        activity.days > 9999)) ||
    typeof activity.tableId !== "string"
  )
    throw new Error(
      "Enter a name and, optionally, 1–9999 whole days and a RollTable.",
    );
}
// Only trailing, explicit tags are payouts. No arbitrary expression evaluation.
export function parseCustomRewards(
  text: string,
): { type: RewardType; formula: string }[] {
  const suffix = text.match(/(?:\s*\[[^\]\r\n]*\]\s*\([^()\r\n]*\))+\s*$/)?.[0];
  if (!suffix) return [];
  const rewards: { type: RewardType; formula: string }[] = [];
  for (const match of suffix.matchAll(/\[([^\]]*)\]\s*\(([^()]*)\)/g)) {
    const type = match[1] as RewardType;
    const formula = match[2]!;
    if (!["Money", "Humanity", "Hitpoints", "Reputation"].includes(type))
      return [];
    const integer =
      /^[+-]?\d+$/.test(formula) && Number.isSafeInteger(Number(formula));
    const dice =
      (type === "Humanity" || type === "Hitpoints") &&
      /^(?:\+?[1-9]\d{0,2}d6|-[1-9]\d{0,2}d5)$/.test(formula);
    // An invalid trailing payout block is ordinary text, never a partial payout.
    if (!integer && !dice) return [];
    rewards.push({ type, formula });
  }
  return rewards;
}

export function customResultDescription(text: string): string {
  if (!parseCustomRewards(text).length) return text;
  return text
    .replace(/(?:\s*\[[^\]\r\n]*\]\s*\([^()\r\n]*\))+\s*$/, "")
    .trimEnd();
}

export function customCycles(events: DowntimeEvent[]) {
  const cycles = new Map<
    string,
    {
      cycle: string;
      definition: CustomActivity;
      progress: number;
      result?: CustomProgress["result"];
    }
  >();
  for (const event of events) {
    const custom = event.custom;
    if (!custom) continue;
    const cycle = cycles.get(custom.cycle) ?? {
      cycle: custom.cycle,
      definition: custom.definition,
      progress: 0,
    };
    if (event.kind === "spend") cycle.progress += event.days;
    if (custom.result) cycle.result = custom.result;
    cycles.set(cycle.cycle, cycle);
  }
  return Array.from(cycles.values());
}

// Reject malformed persisted progress before it can affect a balance or payout.
export function validateCustomEvent(event: DowntimeEvent): void {
  const custom = event.custom;
  if (!custom) return;
  validateCustomActivity(custom.definition);
  if (
    !custom.cycle ||
    !["spend", "resource"].includes(event.kind) ||
    (event.kind === "spend" && (event.days < 1 || !!custom.result)) ||
    (event.kind === "resource" &&
      ((!custom.result && !custom.started) || event.days !== 0))
  )
    throw new Error("Invalid custom activity history.");
  if (
    custom.result &&
    (!Number.isFinite(custom.result.tableTotal) ||
      typeof custom.result.text !== "string" ||
      typeof custom.result.applied !== "boolean" ||
      !Array.isArray(custom.result.rewards) ||
      custom.result.rewards.some(
        (r) =>
          !["Money", "Humanity", "Hitpoints", "Reputation"].includes(r.type) ||
          (r.amount === null
            ? custom.result!.applied ||
              !["Humanity", "Hitpoints"].includes(r.type) ||
              !/^(?:\+?[1-9]\d{0,2}d6|-[1-9]\d{0,2}d5)$/.test(r.formula)
            : !Number.isSafeInteger(r.amount)) ||
          typeof r.formula !== "string",
      ))
  )
    throw new Error("Invalid saved activity payout.");
}
