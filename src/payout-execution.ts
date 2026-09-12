import { appendPayoutRecord } from "./payout-ledger";
import { MODULE_ID } from "./constants";
import {
  applyPayoutToJournal,
  type FactionReputationRecord,
  type HqIpTransaction,
} from "./payout-journal";
import {
  createHumanityPrompt,
  createPendingHumanityRoll,
  getPendingHumanityRolls,
  type HumanityPrompt,
  type PendingHumanityRoll,
} from "./humanity-prompts";
import { createPayoutAcknowledgments } from "./payout-inbox";
import { appendPayoutLog } from "./payout-log";
import {
  createPayoutRecord,
  type PayoutChange,
  type PayoutParticipant,
  type PayoutRewardType,
} from "./payout-record";

export type CharacterReward =
  | "money"
  | "ip"
  | "humanityGain"
  | "humanityLoss"
  | "reputation"
  | "factionReputation"
  | "downtime";

export interface RewardEntry {
  reward: CharacterReward;
  amount: number;
  description: string;
  setValue?: boolean;
  formula?: string;
  faction?: string;
  scope: "group" | "individual";
}

export interface PayoutItem {
  uuid: string;
  name: string;
  type: string;
  img: string;
  quantity: number;
  description: string;
  source: Record<string, unknown>;
}

export interface PayoutActorInput {
  actor: FoundryActor;
  participant: PayoutParticipant;
  entries: RewardEntry[];
  items: PayoutItem[];
}

export interface PayoutContainerInput {
  actor: FoundryActor;
  moneyAmount: number;
  moneyDescription: string;
}

export interface PayoutPlan {
  sessionLabel: string;
  inGameDate: string;
  notes: string;
  actors: PayoutActorInput[];
  changes: PayoutChange[];
  humanityPrompts: HumanityPrompt[];
  factionReputations: FactionReputationRecord[];
  hqIpTransactions: HqIpTransaction[];
  communalItems: PayoutItem[];
  payoutContainer: PayoutContainerInput | null;
}

interface ActorSnapshot {
  actor: FoundryActor;
  update: Record<string, unknown>;
}

const PATHS = {
  money: "wealth",
  ip: "improvementPoints",
  reputation: "reputation",
} as const;

export function planActorChanges(input: PayoutActorInput): PayoutChange[] {
  const actor = input.actor;
  const values = {
    money: numberAt(actor.system, "wealth.value"),
    ip: numberAt(actor.system, "improvementPoints.value"),
    humanity: numberAt(actor.system, "derivedStats.humanity.value"),
    humanityMax: numberAt(actor.system, "derivedStats.humanity.max"),
    reputation: numberAt(actor.system, "reputation.value"),
  };
  const changes: PayoutChange[] = [];

  for (const entry of input.entries) {
    if (entry.reward === "factionReputation") continue;
    if (entry.reward === "downtime") {
      changes.push({
        reward: "downtime",
        targetType: "actor",
        targetId: actor.id,
        targetName: actor.name,
        amount: entry.amount,
        previousValue: null,
        newValue: null,
        details: {
          description: entry.description,
          scope: entry.scope,
          displayOnly: true,
          unit: "days",
        },
      });
      continue;
    }
    if (entry.formula) {
      changes.push({
        reward: entry.reward as PayoutRewardType,
        targetType: "actor",
        targetId: actor.id,
        targetName: actor.name,
        amount: 0,
        previousValue: null,
        newValue: null,
        details: {
          description: entry.description,
          formula: entry.formula,
          pendingPlayerRoll: true,
          scope: entry.scope,
        },
      });
      continue;
    }
    let previousValue: number;
    let newValue: number;
    if (entry.reward === "humanityGain" || entry.reward === "humanityLoss") {
      previousValue = values.humanity;
      const signed =
        entry.reward === "humanityGain" ? entry.amount : -entry.amount;
      newValue = Math.min(values.humanityMax, previousValue + signed);
      values.humanity = newValue;
    } else {
      const key = entry.reward;
      previousValue = values[key];
      newValue = entry.setValue ? entry.amount : previousValue + entry.amount;
      values[key] = newValue;
    }
    changes.push({
      reward: entry.reward as PayoutRewardType,
      targetType: "actor",
      targetId: actor.id,
      targetName: actor.name,
      amount: newValue - previousValue,
      previousValue,
      newValue,
      details: {
        description: entry.description,
        formula: entry.formula ?? "",
        requestedAmount: entry.amount,
        scope: entry.scope,
      },
    });
  }
  return changes;
}

export async function executePayoutPlan(plan: PayoutPlan): Promise<void> {
  if (!game.user?.isGM) throw new Error("Only a GM can apply payouts.");
  const record = createPayoutRecord({
    createdByUserId: game.user.id,
    createdByUserName: game.user.name,
    sessionLabel: plan.sessionLabel,
    inGameDate: plan.inGameDate,
    notes: plan.notes,
    participants: plan.actors.map(({ participant }) => participant),
    changes: plan.changes,
  });
  const pendingRolls = plan.humanityPrompts.map((prompt) =>
    createPendingHumanityRoll(prompt, record.id),
  );
  const snapshots = plan.actors.map(createSnapshot);
  const updated: ActorSnapshot[] = [];
  const createdItems: Array<{ actor: FoundryActor; ids: string[] }> = [];
  const containerSnapshot = plan.payoutContainer
    ? {
        actor: plan.payoutContainer.actor,
        wealth: structuredClone(
          valueAt(plan.payoutContainer.actor.system, "wealth"),
        ),
      }
    : null;
  let containerUpdated = false;
  const promptMessages: FoundryChatMessage[] = [];
  let rollbackJournal: (() => Promise<void>) | null = null;
  let rollbackAcknowledgments: (() => Promise<void>) | null = null;
  let rollbackPayoutLog: (() => Promise<void>) | null = null;
  try {
    if (plan.payoutContainer) {
      const { actor, moneyAmount, moneyDescription } = plan.payoutContainer;
      if (moneyAmount) {
        await actor.update(
          buildContainerMoneyUpdate(
            actor,
            moneyAmount,
            moneyDescription,
            plan.sessionLabel,
          ),
        );
        containerUpdated = true;
      }
      if (plan.communalItems.length) {
        const created = await actor.createEmbeddedDocuments(
          "Item",
          plan.communalItems.flatMap(itemDocumentsForPayout),
          { CPRsplitStack: true },
        );
        createdItems.push({ actor, ids: created.map(({ id }) => id) });
      }
    }
    for (const actorInput of plan.actors) {
      const changes = plan.changes.filter(
        ({ targetId }) => targetId === actorInput.actor.id,
      );
      await actorInput.actor.update(
        buildActorUpdate(
          actorInput.actor,
          changes,
          pendingRolls.filter(({ actorId }) => actorId === actorInput.actor.id),
          plan.sessionLabel,
        ),
      );
      const snapshot = snapshots.find(
        ({ actor }) => actor === actorInput.actor,
      );
      if (snapshot) updated.push(snapshot);
      if (actorInput.items.length) {
        const itemData = actorInput.items.flatMap(itemDocumentsForPayout);
        const created = await actorInput.actor.createEmbeddedDocuments(
          "Item",
          itemData,
          { CPRsplitStack: true },
        );
        createdItems.push({
          actor: actorInput.actor,
          ids: created.map(({ id }) => id),
        });
      }
    }
    for (const prompt of pendingRolls)
      promptMessages.push(await createHumanityPrompt(prompt));
    rollbackJournal = await applyPayoutToJournal(plan);
    rollbackAcknowledgments = await createPayoutAcknowledgments(
      record.id,
      plan,
    );
    rollbackPayoutLog = await appendPayoutLog(plan);
    await appendPayoutRecord(record);
  } catch (error) {
    await Promise.allSettled(
      updated.map(({ actor, update }) => actor.update(update)),
    );
    await Promise.allSettled(
      createdItems.map(({ actor, ids }) =>
        actor.deleteEmbeddedDocuments("Item", ids),
      ),
    );
    if (containerUpdated && containerSnapshot)
      await containerSnapshot.actor
        .update({ "system.wealth": containerSnapshot.wealth })
        .catch(() => undefined);
    if (rollbackJournal) await rollbackJournal().catch(() => undefined);
    if (rollbackAcknowledgments)
      await rollbackAcknowledgments().catch(() => undefined);
    if (rollbackPayoutLog) await rollbackPayoutLog().catch(() => undefined);
    await Promise.allSettled(promptMessages.map((message) => message.delete()));
    throw error;
  }
}

function buildContainerMoneyUpdate(
  actor: FoundryActor,
  amount: number,
  description: string,
  sessionLabel: string,
): Record<string, unknown> {
  const previousValue = numberAt(actor.system, "wealth.value");
  const newValue = previousValue + amount;
  const transactions = structuredClone(
    arrayAt(actor.system, "wealth.transactions"),
  );
  transactions.push([
    `${amount >= 0 ? "Increased" : "Decreased"} by ${Math.abs(amount)} to ${newValue}`,
    `${sessionLabel.trim() || "Payout"} - ${description.trim() || "No description"}`,
  ]);
  return {
    "system.wealth.value": newValue,
    "system.wealth.transactions": transactions,
  };
}

function buildActorUpdate(
  actor: FoundryActor,
  changes: PayoutChange[],
  pendingRolls: PendingHumanityRoll[],
  sessionLabel: string,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    [`flags.${MODULE_ID}.pendingHumanityRolls`]: [
      ...getPendingHumanityRolls(actor),
      ...pendingRolls,
    ],
  };
  for (const change of changes) {
    if (change.newValue === null) continue;
    if (change.reward === "humanityGain" || change.reward === "humanityLoss") {
      update["system.derivedStats.humanity.value"] = change.newValue;
      update["system.stats.emp.value"] = Math.floor(change.newValue / 10);
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

function itemDocumentsForPayout(item: PayoutItem): Record<string, unknown>[] {
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

function createSnapshot(input: PayoutActorInput): ActorSnapshot {
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
      [`flags.${MODULE_ID}.pendingHumanityRolls`]:
        getPendingHumanityRolls(actor),
    },
  };
}

function valueAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function numberAt(value: unknown, path: string): number {
  const result = valueAt(value, path);
  if (typeof result !== "number" || !Number.isFinite(result))
    throw new Error(`Actor is missing numeric system.${path}.`);
  return result;
}

function arrayAt(value: unknown, path: string): unknown[] {
  const result = valueAt(value, path);
  if (!Array.isArray(result))
    throw new Error(`Actor is missing system.${path}.`);
  return result;
}
