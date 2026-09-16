import {
  rollTableReadOnly,
  validateActivityTable,
  tableResultText,
} from "./table-roll";
import { MODULE_ID } from "./constants";
import { queueAction, withGMAction } from "./action-coordinator";
import { createUniqueId } from "./id";
import { getCampaignDate } from "./calendar";
import {
  getDowntime,
  ownedCharacter,
  actorLedger,
  ledgerHtml,
} from "./downtime-store";
import {
  recordDowntimeTransaction,
  downtimeBalance,
  validateDowntime,
  type DowntimeEvent,
} from "./downtime-model";
import { reservedMedicalDay } from "./medtech";
import { activityPage } from "./downtime-records";
import {
  findRecordJournal,
  ensureRecordJournal,
  readRecord,
  writeRecord,
} from "./journal-records";
import { journalTable, recordEscape as esc } from "./journal-format";
import {
  moneyChange,
  humanityUpdate,
  type ResourceChange,
} from "./actor-resources";
import { numberAt, hpUpdate } from "./system-resources";
import {
  customCycles,
  parseCustomRewards,
  customResultDescription,
  validateCustomActivity,
  type CustomActivity,
  type RewardType,
} from "./custom-downtime-model";
export function customActivities(): CustomActivity[] {
  return readRecord(
    findRecordJournal("customActivities"),
    "customActivities",
    [],
  );
}
export function saveCustomActivities(
  definitions: CustomActivity[],
): Promise<void> {
  return withGMAction(async () => {
    const ids = new Set<string>();
    for (const definition of definitions) {
      validateCustomActivity(definition);
      if (ids.has(definition.id)) throw new Error("Duplicate activity ID.");
      ids.add(definition.id);
      if (definition.tableId) {
        const table = Array.from(game.tables).find(
          (t) => t.id === definition.tableId,
        );
        if (!table)
          throw new Error(
            "Choose an available RollTable for " + definition.name + ".",
          );
        await validateActivityTable(table);
      }
    }
    const journal = await ensureRecordJournal(
      "customActivities",
      "Custom Downtime Activities",
      "crew",
    );
    await writeRecord(
      journal,
      "customActivities",
      "Custom Downtime Activities",
      definitions,
      "",
      journalTable(
        ["Activity", "Days", "RollTable"],
        definitions.map((d) => [
          esc(d.name),
          String(d.days ?? "1 (simple activity)"),
          esc(
            Array.from(game.tables).find((t) => t.id === d.tableId)?.name ??
              "None",
          ),
        ]),
      ),
    );
  });
}
// Commit progress and its day charge in one update to the existing Downtime Log.
async function saveCustomState(state: ReturnType<typeof getDowntime>) {
  validateDowntime(state);
  const actorId = state.accounts[0]?.actorId;
  const page = actorId && actorLedger(actorId);
  if (!page)
    throw new Error("The GM must prepare this character's downtime first.");
  const { activities: _activities, ...data } = state;
  await page.update({
    ["flags." + MODULE_ID + ".downtime"]: data,
    ["flags." + MODULE_ID + ".downtimeBalance"]: downtimeBalance(
      state,
      actorId,
    ),
    "text.content": ledgerHtml(state),
  });
}
export function customActivityView(actorId: string, available: number) {
  const cycles = customCycles(getDowntime(actorId).events);
  const definitions = customActivities();
  // Existing projects retain their saved definition even after a catalog edit/removal.
  const active = cycles.filter(
    (c) =>
      c.progress < (c.definition.days ?? 1) ||
      (c.definition.tableId && !c.result?.applied),
  );
  return {
    choices: definitions
      .filter((d) => !active.some((c) => c.definition.id === d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        tracked: d.days !== null,
        canUse: d.days !== null || available > 0,
      })),
    latestResult: [...cycles].reverse().find((c) => c.result?.applied)?.result
      ?.text,
    queue: active.map((c) => ({
      ...c,
      id: c.definition.id,
      name: c.definition.name,
      tracked: c.definition.days !== null,
      required: c.definition.days ?? 1,
      remaining: (c.definition.days ?? 1) - c.progress,
      canSpend: available > 0 && c.progress < (c.definition.days ?? 1),
      canRoll: !!c.definition.tableId && c.progress >= (c.definition.days ?? 1),
      resume: !!c.result,
      resultText: c.result?.text,
    })),
  };
}
// Starting a tracked task reserves a queue entry, without spending any days.
export function startCustomActivity(
  actorId: string,
  definitionId: string,
): Promise<void> {
  return queueAction(async () => {
    ownedCharacter(actorId);
    const state = getDowntime(actorId);
    const definition = customActivities().find((d) => d.id === definitionId);
    if (!definition || definition.days === null)
      throw new Error("Choose a tracked activity.");
    validateCustomActivity(definition);
    if (
      customCycles(state.events).some(
        (c) =>
          c.definition.id === definitionId &&
          (c.progress < (c.definition.days ?? 1) ||
            (c.definition.tableId && !c.result?.applied)),
      )
    )
      throw new Error("This activity is already in the queue.");
    recordDowntimeTransaction(state, {
      id: createUniqueId(),
      actorId,
      kind: "resource",
      days: 0,
      period: state.period,
      date: getCampaignDate(),
      reason: definition.name + " — started",
      custom: {
        definition: structuredClone(definition),
        cycle: createUniqueId(),
        started: true,
      },
    });
    await saveCustomState(state);
  });
}
export function spendCustomActivity(
  actorId: string,
  definitionId: string,
  cycleId: string,
  days: number,
): Promise<void> {
  return queueAction(async () => {
    ownedCharacter(actorId);
    const state = getDowntime(actorId);
    const cycles = customCycles(state.events);
    const cycle = cycles.find((c) => c.cycle === cycleId);
    const definition =
      cycle?.definition ??
      customActivities().find((d) => d.id === definitionId);
    if (!definition || (cycleId && !cycle))
      throw new Error("Activity no longer exists. Reopen Spend Downtime.");
    validateCustomActivity(definition);
    if (
      !cycle &&
      cycles.some(
        (c) =>
          c.definition.id === definitionId &&
          (c.progress < (c.definition.days ?? 1) ||
            (c.definition.tableId && !c.result?.applied)),
      )
    )
      throw new Error(
        "This activity is already in progress. Reopen Spend Downtime.",
      );
    if (
      !Number.isSafeInteger(days) ||
      days < 1 ||
      days > (definition.days ?? 1) - (cycle?.progress ?? 0)
    )
      throw new Error(
        "Choose whole days up to the activity's remaining requirement.",
      );
    if (
      days >
      downtimeBalance(state, actorId) -
        reservedMedicalDay(activityPage(actorId))
    )
      throw new Error("Not enough available downtime days.");
    const progress = (cycle?.progress ?? 0) + days;
    recordDowntimeTransaction(state, {
      id: createUniqueId(),
      actorId,
      kind: "spend",
      days,
      period: state.period,
      date: getCampaignDate(),
      reason:
        definition.name +
        " — " +
        progress +
        "/" +
        (definition.days ?? 1) +
        " days" +
        (progress === (definition.days ?? 1) ? "; complete" : ""),
      custom: {
        definition: structuredClone(definition),
        cycle: cycle?.cycle ?? createUniqueId(),
      },
    });
    await saveCustomState(state);
  });
}
// Signed changes use native resource paths and preserve the system's transaction lists.
export function customResourceUpdate(
  actor: FoundryActor,
  amounts: Map<RewardType, number>,
  reason: string,
) {
  const update: Record<string, unknown> = {};
  const resources: ResourceChange[] = [];
  for (const [type, amount] of amounts) {
    if (!Number.isSafeInteger(amount))
      throw new Error("Payout amount is too large.");
    if (type === "Money") {
      const change = moneyChange(actor, amount, reason);
      Object.assign(update, change.update);
      resources.push(change.change);
      continue;
    }
    const path =
      type === "Humanity"
        ? "derivedStats.humanity"
        : type === "Hitpoints"
          ? "derivedStats.hp"
          : "reputation";
    const before = numberAt(actor.system, path + ".value");
    // Match native payouts: gains cannot exceed maximum HP/Humanity; losses may be negative.
    const after =
      type === "Reputation"
        ? before + amount
        : Math.min(numberAt(actor.system, path + ".max"), before + amount);
    if (!Number.isSafeInteger(after))
      throw new Error("Payout total is too large.");
    Object.assign(
      update,
      type === "Humanity"
        ? humanityUpdate(after)
        : type === "Hitpoints"
          ? hpUpdate(after)
          : { "system.reputation.value": after },
    );
    if (type === "Reputation") {
      const history =
        (actor.system as { reputation: { transactions?: unknown[] } })
          .reputation.transactions ?? [];
      if (!Array.isArray(history))
        throw new Error("Character Reputation ledger is invalid.");
      update["system.reputation.transactions"] = [
        ...history,
        [
          (amount >= 0 ? "Increased" : "Decreased") +
            " by " +
            Math.abs(amount) +
            " to " +
            after,
          reason,
        ],
      ];
    }
    resources.push({
      resource: type,
      amount: after - before,
      before,
      after,
      reason,
    });
  }
  return { update, resources };
}
export function rollCustomActivity(
  actorId: string,
  cycleId: string,
  options: { deferDice?: boolean; rewardIndex?: number } = {},
): Promise<void> {
  return queueAction(async () => {
    const actor = ownedCharacter(actorId);
    const state = getDowntime(actorId);
    const cycles = customCycles(state.events);
    const cycle = cycles.find((c) => c.cycle === cycleId);
    if (
      !cycle ||
      cycle.progress < (cycle.definition.days ?? 1) ||
      !cycle.definition.tableId
    )
      throw new Error("Complete this activity before rolling its table.");
    if (cycle.result?.applied) return;
    if (
      cycles.some((c) => c.cycle !== cycleId && c.result && !c.result.applied)
    )
      throw new Error(
        "Finish the pending activity result before rolling another activity.",
      );
    let event = state.events.find(
      (e) => e.custom?.cycle === cycleId && e.custom.result,
    );
    if (!event) {
      const table = Array.from(game.tables).find(
        (t) => t.id === cycle.definition.tableId,
      );
      if (
        !table ||
        (!game.user?.isGM &&
          table.testUserPermission?.(game.user!, "OBSERVER") !== true)
      )
        throw new Error(
          "The selected RollTable is missing or not visible. Ask the GM to grant Observer access to it.",
        );
      const draw = await rollTableReadOnly(table);
      if (!draw.results.length)
        throw new Error(
          "The RollTable returned no result. Check its ranges and available results.",
        );
      const rewards: NonNullable<
        NonNullable<DowntimeEvent["custom"]>["result"]
      >["rewards"] = [];
      const texts: string[] = [];
      for (const result of draw.results) {
        const text = tableResultText(result.text);
        const specifications = draw.payoutEnabled
          ? parseCustomRewards(text)
          : [];
        texts.push(
          specifications.length ? customResultDescription(text) : text,
        );
        for (const reward of specifications) {
          const amount = reward.formula.includes("d")
            ? options.deferDice
              ? null
              : (await new Roll(reward.formula).evaluate()).total
            : Number(reward.formula);
          if (amount !== null && !Number.isSafeInteger(amount))
            throw new Error("Invalid payout roll total.");
          rewards.push({ ...reward, amount });
        }
      }
      event = {
        id: createUniqueId(),
        actorId,
        kind: "resource",
        days: 0,
        date: getCampaignDate(),
        period: state.period,
        reason:
          cycle.definition.name +
          " — table " +
          draw.roll.total +
          ": " +
          texts.join("; "),
        custom: {
          definition: cycle.definition,
          cycle: cycleId,
          result: {
            text: texts.join("; "),
            tableTotal: draw.roll.total,
            rewards,
            applied: false,
          },
        },
      };
      recordDowntimeTransaction(state, event);
      // Save the result before changing resources. Retrying uses these rolls, not fresh dice.
      await saveCustomState(state);
    }
    const result = event.custom!.result!;
    if (options.rewardIndex !== undefined) {
      const reward = result.rewards[options.rewardIndex];
      if (!Number.isSafeInteger(options.rewardIndex) || !reward)
        throw new Error("Choose a payout from this saved result.");
      if (reward.amount === null) {
        const amount = (await new Roll(reward.formula).evaluate()).total;
        if (!Number.isSafeInteger(amount))
          throw new Error("Invalid payout roll total.");
        reward.amount = amount;
        await saveCustomState(state);
      }
    }
    // Each saved dice result survives dialog closure and later payout retries.
    if (result.rewards.some((reward) => reward.amount === null)) return;
    if (actor.getFlag(MODULE_ID, "customActivityReceipt") !== event.id) {
      const amounts = new Map<RewardType, number>();
      for (const reward of result.rewards)
        amounts.set(
          reward.type,
          (amounts.get(reward.type) ?? 0) + reward.amount!,
        );
      const change = customResourceUpdate(
        actor,
        amounts,
        cycle.definition.name,
      );
      event.resources = change.resources;
      await saveCustomState(state);
      // The receipt witness commits atomically with native resources. A failed final
      // Journal save can retry without granting the reward a second time.
      await actor.update({
        ...change.update,
        ["flags." + MODULE_ID + ".customActivityReceipt"]: event.id,
      });
    }
    result.applied = true;
    await saveCustomState(state);
  });
}
