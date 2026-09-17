import { advanceCampaignDays } from "./calendar";
import {
  buildContainerMoneyUpdate,
  buildActorUpdate,
  itemDocumentsForPayout,
  createSnapshot,
  valueAt,
  type ActorSnapshot,
} from "./payout-system";
import { planActorChanges } from "./payout-plan";
export { planActorChanges } from "./payout-plan";
import { deliverItems } from "./actor-resources";
import { isActorExcluded } from "./actor-policy";
import { applyHeadquartersPayout } from "./headquarters";
import { applyDowntimeAwards, withDowntimeLock } from "./downtime";
import { appendPayoutRecord } from "./payout-ledger";
import {
  applyPayoutToJournal,
  type FactionReputationRecord,
  type HqIpTransaction,
} from "./payout-journal";
import {
  createHumanityPrompt,
  createPendingHumanityRoll,
  appendPendingHumanityRolls,
  type HumanityPrompt,
} from "./humanity-prompts";
import { createPayoutAcknowledgments } from "./payout-inbox";
import {
  createPayoutRecord,
  type PayoutChange,
  type PayoutParticipant,
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
  factionId?: string;
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

export interface AbsentDowntimeAward {
  actor: FoundryActor;
  participant: PayoutParticipant;
  days: number;
}

export interface PayoutPlan {
  advanceDays?: number;
  sessionLabel: string;
  inGameDate: string;
  notes: string;
  actors: PayoutActorInput[];
  absentDowntime?: AbsentDowntimeAward[];
  changes: PayoutChange[];
  humanityPrompts: HumanityPrompt[];
  factionReputations: FactionReputationRecord[];
  hqIpTransactions: HqIpTransaction[];
  communalItems: PayoutItem[];
  payoutContainer: PayoutContainerInput | null;
}

export async function executePayoutPlan(plan: PayoutPlan): Promise<void> {
  if (!game.user?.isGM) throw new Error("Only a GM can apply payouts.");
  return withDowntimeLock(() => executeLockedPayout(plan));
}
async function executeLockedPayout(plan: PayoutPlan): Promise<void> {
  if (!game.user?.isGM) throw new Error("Only a GM can apply payouts.");
  const advanceDays = plan.advanceDays ?? 0;
  if (!Number.isSafeInteger(advanceDays) || advanceDays < 0)
    throw new Error("Invalid GameTime day advance.");
  let previousWorldTime: number | undefined;
  const actorIds = new Set<string>();
  for (const { actor } of plan.actors) {
    if (isActorExcluded(actor.id))
      throw new Error("This payout contains an excluded Actor: " + actor.name);
    if (actorIds.has(actor.id))
      throw new Error(
        "An Actor can receive a payout only once per application.",
      );
    actorIds.add(actor.id);
  }
  for (const award of plan.absentDowntime ?? []) {
    if (!Number.isSafeInteger(award.days) || award.days < 1)
      throw new Error(
        "Absent-character downtime must be a positive whole number.",
      );
    if (
      isActorExcluded(award.actor.id) ||
      award.actor.type !== "character" ||
      actorIds.has(award.actor.id) ||
      plan.actors.some((a) => a.participant.userId === award.participant.userId)
    )
      throw new Error("Invalid or duplicate absent downtime recipient.");
    actorIds.add(award.actor.id);
  }
  if (plan.payoutContainer && isActorExcluded(plan.payoutContainer.actor.id))
    throw new Error("The payout container is excluded from Crew Tools.");
  // Reject changed previews before any resource or Journal write.
  for (const input of plan.actors) {
    const current = planActorChanges(input);
    const preview = plan.changes.filter(
      (change) =>
        change.targetId === input.actor.id &&
        [
          "money",
          "ip",
          "humanityGain",
          "humanityLoss",
          "reputation",
          "downtime",
        ].includes(change.reward) &&
        change.details?.scope !== "absent",
    );
    const values = (changes: PayoutChange[]) =>
      changes.map(({ reward, amount, previousValue, newValue }) => ({
        reward,
        amount,
        previousValue,
        newValue,
      }));
    if (JSON.stringify(values(current)) !== JSON.stringify(values(preview)))
      throw new Error(
        input.actor.name +
          "'s resources changed. Preview the payout again before applying it.",
      );
  }
  const record = createPayoutRecord({
    createdByUserId: game.user.id,
    createdByUserName: game.user.name,
    sessionLabel: plan.sessionLabel,
    inGameDate: plan.inGameDate,
    notes: plan.notes,
    participants: plan.actors.map(({ actor, participant }) => ({
      ...participant,
      actorId: actor.id,
      actorName: actor.name,
    })),
    changes: plan.changes,
  });
  const pendingRolls = plan.humanityPrompts.map((prompt) =>
    createPendingHumanityRoll(prompt, record.id),
  );
  const rollbackPending: Array<() => Promise<void>> = [];
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
  let rollbackHeadquarters: (() => Promise<void>) | null = null;
  let rollbackDowntime: (() => Promise<void>) | null = null;
  let rollbackJournal: (() => Promise<void>) | null = null;
  let rollbackAcknowledgments: (() => Promise<void>) | null = null;
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
        const created = await deliverItems(
          actor,
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
      const update = buildActorUpdate(
        actorInput.actor,
        changes,
        plan.sessionLabel,
      );
      // Journal-only rewards must not issue even an empty Actor/flag update.
      if (Object.keys(update).length) {
        await actorInput.actor.update(update);
        const snapshot = snapshots.find(
          ({ actor }) => actor === actorInput.actor,
        );
        if (snapshot) updated.push(snapshot);
      }
      if (actorInput.items.length) {
        const itemData = actorInput.items.flatMap(itemDocumentsForPayout);
        const created = await deliverItems(actorInput.actor, itemData, {
          CPRsplitStack: true,
        });
        createdItems.push({
          actor: actorInput.actor,
          ids: created.map(({ id }) => id),
        });
      }
    }
    for (const { actor } of plan.actors) {
      const rolls = pendingRolls.filter((r) => r.actorId === actor.id);
      if (rolls.length)
        rollbackPending.push(await appendPendingHumanityRolls(actor, rolls));
    }
    for (const prompt of pendingRolls)
      promptMessages.push(await createHumanityPrompt(prompt));
    rollbackDowntime = await applyDowntimeAwards(plan, record.id);
    rollbackHeadquarters = await applyHeadquartersPayout(plan, record.id);
    rollbackJournal = await applyPayoutToJournal(plan);
    rollbackAcknowledgments = await createPayoutAcknowledgments(
      record.id,
      plan,
    );
    if (advanceDays > 0) {
      previousWorldTime = game.time.worldTime;
      await advanceCampaignDays(advanceDays);
    }
    await appendPayoutRecord(record);
  } catch (error) {
    const failures: string[] = [];
    const restore = async (label: string, undo: () => Promise<unknown>) => {
      try {
        await undo();
      } catch (failure) {
        failures.push(label);
        console.error("Crew Tools payout rollback failed: " + label, failure);
      }
    };
    if (previousWorldTime !== undefined) {
      const previous = previousWorldTime;
      await restore("GameTime", () =>
        game.time.advance(previous - game.time.worldTime),
      );
    }
    for (const undo of rollbackPending.reverse())
      await restore("Humanity records", undo);
    for (const { actor, update } of updated)
      await restore("Resources for " + actor.name, () => actor.update(update));
    for (const { actor, ids } of createdItems)
      await restore("Items for " + actor.name, () =>
        actor.deleteEmbeddedDocuments("Item", ids),
      );
    if (containerUpdated && containerSnapshot) {
      const snapshot = containerSnapshot;
      await restore("Communal container money", () =>
        snapshot.actor.update({ "system.wealth": snapshot.wealth }),
      );
    }
    if (rollbackHeadquarters) await restore("HQ IP", rollbackHeadquarters);
    if (rollbackDowntime) await restore("Downtime", rollbackDowntime);
    if (rollbackJournal) await restore("Payout Journal", rollbackJournal);
    if (rollbackAcknowledgments)
      await restore("Acknowledgments", rollbackAcknowledgments);
    for (const message of promptMessages)
      await restore("Humanity chat prompt", () => message.delete());
    if (failures.length)
      throw new Error(
        "Rollback incomplete: " +
          failures.join("; ") +
          ". Inspect these records before retrying. Original error: " +
          (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    throw error;
  }
}
