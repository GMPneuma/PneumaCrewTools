import { valueAt, arrayAt } from "./system-resources";
export { valueAt, numberAt } from "./system-resources";
import { moneyChange, humanityUpdate } from "./actor-resources";
import type { PayoutChange } from "./payout-record";
import type { PayoutItem } from "./payout-execution";
// Native resource snapshots and update payloads for payout execution.
export interface ActorSnapshot {
  actor: FoundryActor;
  update: Record<string, unknown>;
  expected: Record<string, unknown>;
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

export function createSnapshot(
  actor: FoundryActor,
  update: Record<string, unknown>,
): ActorSnapshot {
  return {
    actor,
    update: Object.fromEntries(
      Object.keys(update).map((path) => [
        path,
        structuredClone(valueAt(actor.system, path.replace(/^system\./, ""))),
      ]),
    ),
    expected: structuredClone(update),
  };
}

export async function restoreSnapshot(snapshot: ActorSnapshot): Promise<void> {
  const { actor, update, expected } = snapshot;
  const live = Object.fromEntries(
    Object.keys(expected).map((path) => [
      path,
      valueAt(actor.system, path.replace(/^system\./, "")),
    ]),
  );
  if (JSON.stringify(live) === JSON.stringify(update)) return;
  if (JSON.stringify(live) !== JSON.stringify(expected))
    throw new Error(
      "Resources changed after this payout; review before restoring " +
        actor.name +
        ".",
    );
  await actor.update(update);
}
export function assertSnapshotCurrent(snapshot: ActorSnapshot): void {
  const live = Object.fromEntries(
    Object.keys(snapshot.update).map((path) => [
      path,
      valueAt(snapshot.actor.system, path.replace(/^system\./, "")),
    ]),
  );
  if (JSON.stringify(live) !== JSON.stringify(snapshot.update))
    throw new Error(
      snapshot.actor.name +
        "'s resources changed before applying the payout. Preview again.",
    );
}
