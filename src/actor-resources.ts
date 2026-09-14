// Native resource adapters are shared by payouts and all downtime activities.
export interface ResourceChange {
  resource: string;
  amount: number;
  before: number;
  after: number;
  reason: string;
}
export function moneyChange(
  actor: FoundryActor,
  amount: number,
  reason: string,
) {
  const wealth = (
    actor.system as { wealth?: { value: number; transactions?: unknown[] } }
  ).wealth;
  if (!wealth || !Number.isFinite(wealth.value) || !Number.isFinite(amount))
    throw new Error("Character money is unavailable.");
  if (wealth.value + amount < 0)
    throw new Error("Not enough money: " + Math.abs(amount) + " eb required.");
  if (wealth.transactions !== undefined && !Array.isArray(wealth.transactions))
    throw new Error("Character money transaction history is invalid.");
  const before = wealth.value,
    after = before + amount,
    transactions = structuredClone(wealth.transactions ?? []);
  return {
    change: {
      resource: "money",
      amount,
      before,
      after,
      reason,
    } satisfies ResourceChange,
    update: {
      "system.wealth.value": after,
      "system.wealth.transactions": [
        ...transactions,
        [
          (amount >= 0 ? "Increased" : "Decreased") +
            " by " +
            Math.abs(amount) +
            " to " +
            after,
          reason,
        ],
      ],
    },
    restore: {
      "system.wealth.value": before,
      "system.wealth.transactions": transactions,
    },
  };
}
export function humanityUpdate(value: number): Record<string, unknown> {
  return {
    "system.derivedStats.humanity.value": value,
    "system.stats.emp.value": Math.floor(value / 10),
  };
}
export async function deliverItems(
  actor: FoundryActor,
  items: Record<string, unknown>[],
  options: { keepId?: boolean; CPRsplitStack?: boolean } = {},
) {
  const created = await actor.createEmbeddedDocuments("Item", items, options);
  if (!created.length && items.length)
    throw new Error("Item delivery was incomplete.");
  return created;
}
