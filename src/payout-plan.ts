import type { PayoutPlan, PayoutActorInput } from "./payout-execution";
import type { PayoutJournalData } from "./payout-journal";
import type { PayoutChange, PayoutRewardType } from "./payout-record";
import { nativeValue, numberAt } from "./system-resources";

// Forms collect a draft; this function owns the resulting rewards and Journal entries.
export type PayoutDraft = Pick<
  PayoutPlan,
  | "advanceDays"
  | "sessionLabel"
  | "inGameDate"
  | "notes"
  | "actors"
  | "absentDowntime"
  | "communalItems"
  | "payoutContainer"
  | "hqIpTransactions"
>;
export function buildPayoutPlan(
  draft: PayoutDraft,
  journalData: PayoutJournalData,
): PayoutPlan {
  const {
    sessionLabel,
    inGameDate,
    notes,
    actors,
    communalItems,
    payoutContainer,
    hqIpTransactions,
  } = draft;
  const hqIpAmount = hqIpTransactions.reduce((sum, t) => sum + t.amount, 0);
  const hqIpDescription = hqIpTransactions
    .map((t) => t.reason)
    .filter(Boolean)
    .join("; ");
  const communalMoneyAmount = payoutContainer?.moneyAmount ?? 0;
  const communalMoneyDescription = payoutContainer?.moneyDescription ?? "";
  const humanityPrompts: PayoutPlan["humanityPrompts"] = [];
  const factionReputations: PayoutPlan["factionReputations"] = [];
  // The form explicitly opts in to nonparticipant awards independently of primary rewards.
  const absentDowntime = draft.absentDowntime ?? [];
  const journalChanges: PayoutChange[] = absentDowntime.map(
    ({ actor, days }) => ({
      reward: "downtime",
      targetType: "actor",
      targetId: actor.id,
      targetName: actor.name,
      amount: days,
      previousValue: null,
      newValue: null,
      details: {
        scope: "absent",
        description: "Not in this payout",
        unit: "days",
      },
    }),
  );
  for (const {
    actor,
    participant: user,
    entries,
    items: individualItems,
  } of actors) {
    for (const item of individualItems)
      journalChanges.push({
        reward: "item",
        targetType: "actor",
        targetId: actor.id,
        targetName: actor.name,
        amount: item.quantity,
        previousValue: null,
        newValue: null,
        details: {
          itemName: item.name,
          itemType: item.type,
          img: item.img,
          uuid: item.uuid,
          description: item.description,
          scope: "individual",
        },
      });
    for (const entry of entries) {
      if (entry.reward === "factionReputation") {
        const faction = entry.faction ?? "";
        const previous = [
          ...journalData.factionReputations,
          ...factionReputations,
        ]
          .reverse()
          .find(
            (record) =>
              record.actorId === actor.id &&
              (entry.factionId
                ? record.factionId === entry.factionId
                : record.faction.toLocaleLowerCase() ===
                  faction.toLocaleLowerCase()),
          );
        factionReputations.push({
          actorId: actor.id,
          actorName: actor.name,
          reputation: entry.amount,
          faction,
          factionId: entry.factionId ?? "",
          reason: entry.description,
        });
        journalChanges.push({
          reward: "factionReputation",
          targetType: "journal",
          targetId: actor.id,
          targetName: actor.name,
          amount: entry.amount - (previous?.reputation ?? 0),
          previousValue: previous?.reputation ?? 0,
          newValue: entry.amount,
          details: {
            faction,
            factionId: entry.factionId ?? "",
            description: entry.description,
            scope: entry.scope,
          },
        });
        continue;
      }
      if (!entry.formula) continue;
      if (entry.reward !== "humanityGain" && entry.reward !== "humanityLoss")
        throw new Error("Only Humanity entries can use dice.");
      humanityPrompts.push({
        actorId: actor.id,
        actorName: actor.name,
        userId: user.userId,
        reward: entry.reward,
        formula: entry.formula,
        description: entry.description,
      });
    }
  }
  if (!actors.length) throw new Error("Select at least one recipient.");
  if (hqIpAmount) {
    journalChanges.push({
      reward: "hqIp",
      targetType: "world",
      targetId: null,
      targetName: "HQ",
      amount: hqIpAmount,
      previousValue: null,
      newValue: null,
      details: {
        description: hqIpDescription,
        scope: "group",
      },
    });
  }
  if (payoutContainer && communalMoneyAmount) {
    const previousValue = Number(
      nativeValue(payoutContainer.actor, "wealth.value"),
    );
    if (!Number.isFinite(previousValue))
      throw new Error("The Payout Container has no valid Money balance.");
    journalChanges.push({
      reward: "communalMoney",
      targetType: "actor",
      targetId: payoutContainer.actor.id,
      targetName: payoutContainer.actor.name,
      amount: communalMoneyAmount,
      previousValue,
      newValue: previousValue + communalMoneyAmount,
      details: {
        description: communalMoneyDescription,
        scope: "communal",
      },
    });
  }
  for (const item of communalItems)
    journalChanges.push({
      reward: "item",
      targetType: "actor",
      targetId: payoutContainer?.actor.id ?? null,
      targetName: payoutContainer?.actor.name ?? "Payout Container",
      amount: item.quantity,
      previousValue: null,
      newValue: null,
      details: {
        itemName: item.name,
        itemType: item.type,
        img: item.img,
        uuid: item.uuid,
        description: item.description,
        scope: "communal",
      },
    });
  for (const { actor } of actors) {
    const previous =
      journalData.attendance.find(({ actorId }) => actorId === actor.id)
        ?.sessions ?? 0;
    journalChanges.push({
      reward: "attendance",
      targetType: "actor",
      targetId: actor.id,
      targetName: actor.name,
      amount: 1,
      previousValue: previous,
      newValue: previous + 1,
    });
  }
  return {
    sessionLabel,
    inGameDate,
    notes,
    actors,
    advanceDays: draft.advanceDays,
    changes: [...actors.flatMap(planActorChanges), ...journalChanges],
    absentDowntime,
    humanityPrompts,
    factionReputations,
    hqIpTransactions,
    communalItems,
    payoutContainer,
  };
}

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
          userId: input.participant.userId,
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
