import { valueAt, arrayAt } from "./system-resources";
export { valueAt, numberAt } from "./system-resources";
import { moneyChange, humanityUpdate } from "./actor-resources";
import type { PayoutChange } from "./payout-record";
import type { PayoutActorInput, PayoutItem } from "./payout-execution";
// Native resource snapshots and update payloads for payout execution.
export interface ActorSnapshot {
  actor: FoundryActor;
  update: Record<string, unknown>;
}

const PATHS = {
  money: "wealth",
  ip: "improvementPoints",
  reputation: "reputation",
} as const;

export function buildContainerMoneyUpdate(
  actor: FoundryActor,
  amount: number,
  description: string,
  sessionLabel: string,
): Record<string, unknown> {
  return moneyChange(
    actor,
    amount,
    (sessionLabel.trim() || "Payout") +
      " - " +
      (description.trim() || "No description"),
  ).update;
}

export function buildActorUpdate(
  actor: FoundryActor,
  changes: PayoutChange[],
  sessionLabel: string,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const change of changes) {
    if (change.newValue === null) continue;
    if (change.reward === "humanityGain" || change.reward === "humanityLoss") {
      Object.assign(update, humanityUpdate(change.newValue));
      continue;
    }
    if (change.reward === "money") {
      if ("system.wealth.value" in update) continue;
      let projected = actor;
      for (const related of changes.filter((c) => c.reward === "money")) {
        const reason =
          (sessionLabel.trim() || "Payout") +
          " - " +
          String(
            related.details?.description ?? "PneumaCrewTools payout",
          ).trim();
        const money = moneyChange(projected, related.amount, reason);
        Object.assign(update, money.update);
        projected = {
          ...actor,
          system: {
            ...(actor.system as object),
            wealth: {
              value: money.change.after,
              transactions: money.update["system.wealth.transactions"],
            },
          },
        };
      }
      continue;
    }
    const path = PATHS[change.reward as keyof typeof PATHS];
    if (!path) continue;
    update[`system.${path}.value`] = change.newValue;
    const transactions = structuredClone(
      arrayAt(actor.system, `${path}.transactions`),
    );
    for (const related of changes.filter(
      (item) => item.reward === change.reward,
    )) {
      const description = String(
        related.details?.description ?? "PneumaCrewTools payout",
      ).trim();
      const transactionDescription = `${sessionLabel.trim() || "Payout"} - ${description || "No description"}`;
      transactions.push([
        `${related.amount >= 0 ? "Increased" : "Decreased"} by ${Math.abs(related.amount)} to ${related.newValue}`,
        transactionDescription,
      ]);
    }
    update[`system.${path}.transactions`] = transactions;
  }
  return update;
}

export function itemDocumentsForPayout(
  item: PayoutItem,
): Record<string, unknown>[] {
  const source = structuredClone(item.source);
  delete source._id;
  const system = source.system;
  if (
    typeof system === "object" &&
    system !== null &&
    typeof (system as Record<string, unknown>).amount === "number"
  ) {
    (system as Record<string, unknown>).amount = item.quantity;
    return [source];
  }
  return Array.from({ length: item.quantity }, () => structuredClone(source));
}

export function createSnapshot(input: PayoutActorInput): ActorSnapshot {
  const actor = input.actor;
  return {
    actor,
    update: {
      "system.wealth": structuredClone(valueAt(actor.system, "wealth")),
      "system.improvementPoints": structuredClone(
        valueAt(actor.system, "improvementPoints"),
      ),
      "system.derivedStats.humanity": structuredClone(
        valueAt(actor.system, "derivedStats.humanity"),
      ),
      "system.stats.emp": structuredClone(valueAt(actor.system, "stats.emp")),
      "system.reputation": structuredClone(valueAt(actor.system, "reputation")),
    },
  };
}
