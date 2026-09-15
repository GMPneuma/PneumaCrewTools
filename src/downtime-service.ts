import { serverRoomAvailable } from "./netrunner-system";
import { requireNomadGarage } from "./nomad-vehicles";
import { validateNomadEvent, nomadRespecDays } from "./nomad-model";
import { activityRollRecipients } from "./roll-visibility";
import { rollCard } from "./roll-card";
import { requiresFullDowntimeWeek } from "./downtime-settings";
import { hpUpdate } from "./system-resources";
import { displayDate } from "./date-format";
import {
  actorLedger,
  getDowntime,
  escape,
  actorLink,
  ledgerHtml,
  characterState,
  save,
  ensureDowntime,
  ownedCharacter,
} from "./downtime-store";
export { getDowntime } from "./downtime-store";

import {
  activityPage,
  activityRecords,
  saveCharacterState,
} from "./downtime-records";
import { moneyChange } from "./actor-resources";
import { queueAction, isPrimaryGM, withGMAction } from "./action-coordinator";
import {
  readMedical,
  reservedMedicalDay,
  processMedical,
  type MedicalAction,
} from "./medtech";
import { isActorExcluded } from "./actor-policy";
import { getHeadquarters } from "./headquarters";
import {
  MULTIPLY_ANTIBIOTIC_SETTING,
  defaultHealingOptions,
  healingPreview,
  healingSummary,
  type HealingOptions,
  type HealingResult,
} from "./downtime-healing";
import { characterRoles, applyActivityRequest } from "./downtime-activities";
import { MODULE_ID } from "./constants";
import { createUniqueId } from "./id";
import { getCampaignDate } from "./calendar";
import type { PayoutPlan } from "./payout-execution";
import {
  validateDowntime,
  downtimeBalance,
  wholeDays,
  type HustleReward,
  awardDowntime,
  recordDowntimeTransaction,
  type DowntimeState,
  type DowntimeEvent,
  type DowntimeUse,
} from "./downtime-model";
import { type TechInput } from "./tech-project-model";
import { techSlotLimit, processTechRequest } from "./tech-projects";
export function workshopLevel(): number {
  return getHeadquarters(false).headquarters.reduce(
    (level, h) =>
      Math.max(
        level,
        ...h.improvements
          .filter(
            (i) =>
              i.effect === "workshop" ||
              (i.effect === undefined &&
                ["workshop", "workshopaddon"].includes(
                  i.name
                    .trim()
                    .toLowerCase()
                    .replace(/[\s-]+/g, ""),
                )),
          )
          .map((i) => i.level ?? 1),
      ),
    0,
  );
}
// Any registered HQ with Server Room II enables the role's single crafting slot.
export function hasServerRoom(): boolean {
  return serverRoomAvailable(getHeadquarters(false));
}
export function currentTechSlots(): number {
  return techSlotLimit(workshopLevel());
}

export const isDowntimeGM = isPrimaryGM;
export const withDowntimeLock = withGMAction;
// Called only while the payout owns the shared downtime lock.
export async function applyDowntimeAwards(
  plan: PayoutPlan,
  payoutId: string,
): Promise<() => Promise<void>> {
  // Provision only actual payout recipients, never every player-owned Actor.
  const recipients = [
    ...plan.actors,
    ...(plan.absentDowntime ?? []).map(({ actor, participant, days }) => ({
      actor,
      participant,
      items: [],
      entries: [
        {
          reward: "downtime" as const,
          amount: days,
          scope: "individual" as const,
          description: "Not in this payout",
        },
      ],
    })),
  ];
  const actorIds = recipients.map(({ actor }) => actor.id);
  await ensureDowntime(actorIds, actorIds);
  const before = getDowntime();
  const state = structuredClone(before);
  // Each selected Actor receives its own award, even when one user owns several.
  const seen = new Set<string>();
  for (const input of recipients) {
    const actorId = input.actor.id;
    if (seen.has(actorId))
      throw new Error("Duplicate character in downtime payout.");
    seen.add(actorId);
    const days = input.entries
      .filter((entry) => entry.reward === "downtime" && entry.amount !== 0)
      .reduce((sum, entry) => sum + wholeDays(entry.amount), 0);
    if (!days) continue;
    if (isActorExcluded(actorId))
      throw new Error("Actor is excluded from Crew Tools.");
    if (!state.accounts.some((a) => a.actorId === actorId))
      throw new Error("Downtime recipients must be character Actors.");
    awardDowntime(state, {
      id: createUniqueId(),
      actorId,
      kind: "award",
      days,
      period: state.period,
      date: plan.inGameDate,
      reason: plan.sessionLabel,
      payoutId,
    });
  }
  try {
    await save(state);
  } catch (error) {
    await save(before);
    throw error;
  }
  return () => save(before);
}
interface SpendRequest {
  days: number;
  kind:
    | DowntimeUse
    | "hustleRoll"
    | "techStart"
    | "techDay"
    | "techRoll"
    | "techCancel"
    | "techFinish"
    | "techWorkshop"
    | "nomadRespecDay"
    | "nomadRespecReset";
  actorId: string;
  projectId?: string;
  roleItemId?: string;
  reason: string;
  period: number;
  healing?: HealingOptions;
  tech?: TechInput;
}
async function executeDowntimeCommand(
  request: SpendRequest,
  requestId: string,
  actor: FoundryActor,
  state: DowntimeState,
): Promise<void> {
  const account = state.accounts.find((a) => a.actorId === actor.id);
  if (!account) throw new Error("Character downtime account is missing.");
  const ledgerPage = () => actorLedger(actor.id);
  const save = async (data: DowntimeState) => {
    validateDowntime(data);
    await saveCharacterState(data, ledgerHtml(data));
  };
  let event = state.events.find((e) => e.requestId === requestId);
  if (
    !event &&
    typeof request.kind === "string" &&
    request.kind.startsWith("tech")
  ) {
    if (ledgerPage()?.getFlag?.(MODULE_ID, "techAttempt"))
      throw new Error(
        "An interrupted TECH item transfer needs GM review in the Downtime Journal.",
      );
    try {
      if (request.actorId !== account.actorId)
        throw new Error("Request character does not match its Journal.");
      const requester = game.user!;
      event = {
        id: createUniqueId(),
        actorId: actor.id,
        kind: request.kind,
        days: request.days,
        period: request.period,
        date: getCampaignDate(),
        reason: request.reason,
        projectId: request.projectId,
        requestId,
      };
      await processTechRequest({
        state,
        event,
        actor,
        input: request.tech ? structuredClone(request.tech) : undefined,
        requester,
        slots: currentTechSlots(),
        workshop: workshopLevel() > 0,
        serverRoom: hasServerRoom(),
        save,
        attempt: async (details) => {
          const ledger = ledgerPage()!;
          await ledger.update({
            ["flags." + MODULE_ID + ".techAttempt"]: details,
            "text.content":
              ledgerHtml(getDowntime(request.actorId)) +
              (details
                ? "<h2>TECH item transfer in progress</h2><pre>" +
                  escape(JSON.stringify(details, null, 2)) +
                  "</pre><p>If interrupted, inspect the listed source and destination Items before clearing techAttempt. Do not repeat the move blindly.</p>"
                : ""),
          });
        },
      });
    } catch (error) {
      if (ledgerPage()?.getFlag?.(MODULE_ID, "techAttempt")) throw error;
      const committed = getDowntime(request.actorId).events.find(
        (e) => e.requestId === requestId,
      );
      if (committed) {
        event = committed;
        Object.assign(state, getDowntime(request.actorId));
      } else {
        throw error;
      }
    }
  }
  const techAttempt = ledgerPage()?.getFlag?.(MODULE_ID, "techAttempt") as
    { requestId?: string } | undefined;
  if (event && techAttempt?.requestId === requestId)
    await ledgerPage()!.update({
      ["flags." + MODULE_ID + ".techAttempt"]: null,
    });
  if (!event) {
    if (
      ledgerPage()?.getFlag?.(MODULE_ID, "healingAttempt") ||
      ledgerPage()?.getFlag?.(MODULE_ID, "hustleAttempt")
    )
      throw new Error(
        "An interrupted healing or hustle payment needs GM review in the Journals before retrying.",
      );
    let healActor: FoundryActor | undefined;

    if (
      typeof request.reason !== "string" ||
      request.reason.trim().length > 500
    )
      throw new Error("Describe the activity in 1–500 characters.");
    if (request.actorId !== account.actorId)
      throw new Error("Request character does not match its Journal.");
    const candidate: DowntimeEvent = {
      id: createUniqueId(),
      kind: request.kind,
      days: request.days,
      period: request.period,
      reason: request.reason.trim(),
      date: getCampaignDate(),
      requestId,
      actorId: account.actorId,
      projectId: request.projectId,
      roleItemId: request.roleItemId,
    };
    if (candidate.kind === "rest") {
      candidate.healing = healingPreview(
        actor,
        request.healing ?? defaultHealingOptions(),
        getHeadquarters(false),
        game.settings.get(MODULE_ID, MULTIPLY_ANTIBIOTIC_SETTING) !== false,
        request.days,
      );
      if (!candidate.healing.restored)
        throw new Error("Character is already at maximum HP.");
      candidate.reason = healingSummary(candidate.healing);
      healActor = actor;
    }
    if (
      candidate.kind === "nomadRespecDay" ||
      candidate.kind === "nomadRespecReset"
    ) {
      // Progress and the downtime charge commit together on the character's ledger page.
      requireNomadGarage(actor.id);
      validateNomadEvent(candidate, state.events);
      if (candidate.kind === "nomadRespecDay") {
        const progress =
          nomadRespecDays(state.events, actor.id) + candidate.days;
        candidate.reason =
          "Respec Nomad Vehicle — " +
          progress +
          "/7 days" +
          (progress === 7 ? "; complete — change vehicle manually" : "");
      }
      recordDowntimeTransaction(state, candidate);
    } else
      applyActivityRequest(state, candidate, actor, requiresFullDowntimeWeek());
    event = candidate;

    // Commit healing once. Failed HP/ledger writes retain an attempt marker until resolved.
    if (event.kind === "rest" && event.healing && healActor) {
      // Persist the attempt on Downtime Log before touching HP. An interruption stops replay.
      await ledgerPage()!.update({
        [`flags.${MODULE_ID}.healingAttempt`]: event.healing,
        "text.content":
          ledgerHtml(getDowntime(request.actorId)) +
          "<h2>Healing in progress</h2><p>" +
          escape(healingSummary(event.healing)) +
          "</p>",
      });
      await healActor.update(hpUpdate(event.healing.after));
      try {
        await save(state);
      } catch (error) {
        try {
          await healActor.update(hpUpdate(event.healing.before));
          await ledgerPage()!.update({
            [`flags.${MODULE_ID}.healingAttempt`]: null,
            "text.content": ledgerHtml(getDowntime(request.actorId)),
          });
        } catch {
          throw new Error(
            "Healing ledger save and HP rollback failed. Stop processing and reconcile this character's HP and request Journal.",
          );
        }
        throw error;
      }
    } else if (event.kind === "hustleRoll") {
      // Persist the rolled result before paying. Uncertain writes stop replay.
      const actor = Array.from(game.actors).find(
        (a) => a.id === account.actorId,
      )!;
      const role = characterRoles(actor).find(
        (r) => r.id === event!.roleItemId,
      )!;
      const tables = Array.from(game.tables).filter(
        (t) =>
          String(t.getFlag(MODULE_ID, "hustleRole")).toLowerCase() ===
          role.name.trim().toLowerCase(),
      );
      if (tables.length !== 1)
        throw new Error(
          "Exactly one Hustle table is required for " + role.name + ".",
        );
      const before = (actor.system as { wealth?: { value?: unknown } }).wealth
        ?.value;
      if (typeof before !== "number" || !Number.isSafeInteger(before))
        throw new Error("Character money is unavailable.");
      const draw = await tables[0]!.roll({ recursive: false });
      const result = draw.results.length === 1 ? draw.results[0] : undefined;
      const data = result?.getFlag(MODULE_ID, "hustle") as
        { activity?: unknown; earnings?: unknown; roll?: unknown } | undefined;
      const earnings = data?.earnings;
      const amount = Array.isArray(earnings)
        ? earnings[role.rank <= 4 ? 0 : role.rank <= 7 ? 1 : 2]
        : undefined;
      if (
        !result ||
        typeof data?.activity !== "string" ||
        !Array.isArray(earnings) ||
        earnings.length !== 3 ||
        !earnings.every((n) => Number.isSafeInteger(n) && n >= 0) ||
        !Number.isInteger(draw.roll.total) ||
        draw.roll.total < 1 ||
        draw.roll.total > 6 ||
        data.roll !== draw.roll.total ||
        !Number.isSafeInteger(before + amount)
      )
        throw new Error(
          "Invalid structured Hustle table result. No days or money were changed.",
        );
      const reward: HustleReward = {
        tableId: tables[0]!.id,
        resultId: result.id,
        roll: draw.roll.total,
        roleName: role.name,
        rank: role.rank,
        activity: data.activity,
        amount,
        before,
        after: before + amount,
      };
      event.hustleReward = reward;
      event.reason = hustleSummary(reward);
      const money = moneyChange(
        actor,
        reward.amount,
        "Hustle — " +
          displayDate(event.date) +
          " — " +
          role.name +
          " (rank " +
          role.rank +
          ")",
      );
      const ledger = ledgerPage()!;
      await ledger.update({
        ["flags." + MODULE_ID + ".hustleAttempt"]: {
          requestId,
          actorId: actor.id,
          reward,
        },
        "text.content":
          ledgerHtml(getDowntime(request.actorId)) +
          "<h2>Payment in progress</h2><p>" +
          actorLink(actor.id) +
          " — " +
          escape(event.reason) +
          ". If interrupted, compare Actor money and this attempt before clearing hustleAttempt.</p>",
      });
      await actor.update(money.update);
      try {
        await save(state);
      } catch (error) {
        try {
          await actor.update(money.restore);
          // Keep the guard after rollback: Actor update hooks must not reroll a failed payment.
          await ledger.update({
            ["flags." + MODULE_ID + ".hustleAttempt"]: {
              requestId,
              actorId: actor.id,
              reward,
              rolledBack: true,
            },
            "text.content":
              ledgerHtml(getDowntime(request.actorId)) +
              "<h2>Hustle payment rolled back</h2><p>" +
              escape(hustleSummary(reward)) +
              ". Money was restored to " +
              reward.before +
              " eb and allocated days remain. GM review is required before retrying.</p>",
          });
        } catch {
          throw new Error(
            "Hustle ledger save and money rollback failed. GM review required in the Downtime Journal.",
          );
        }
        throw error;
      }
      await ledger.update({
        ["flags." + MODULE_ID + ".hustleAttempt"]: null,
      });
      // Chat is informational; failure cannot undo or repeat a committed payment.
      try {
        await ChatMessage.create({
          speaker: { actor: actor.id, alias: actor.name },
          whisper: activityRollRecipients(actor),
          type: 5,
          rolls: [draw.roll],
          content: rollCard({
            title: "Hustle — " + role.name,

            subject: "Rank " + role.rank + " · 7 downtime days",
            outcome: "PAID",
            success: true,
            detail: reward.activity,
            effect: "+" + reward.amount.toLocaleString() + " eb paid",
          }),
          flags: { [MODULE_ID]: { hustleRequestId: requestId } },
        });
      } catch (error) {
        console.error(MODULE_ID + " | Hustle chat", error);
      }
    } else await save(state);
  }
  // A committed reward is never paid again if final request status failed.
  const pendingHustle = ledgerPage()?.getFlag?.(MODULE_ID, "hustleAttempt") as
    { requestId?: string } | undefined;
  if (event.kind === "hustleRoll" && pendingHustle?.requestId === requestId)
    await ledgerPage()!.update({
      ["flags." + MODULE_ID + ".hustleAttempt"]: null,
    });
  if (ledgerPage()?.getFlag?.(MODULE_ID, "healingAttempt"))
    await ledgerPage()!.update({
      ["flags." + MODULE_ID + ".healingAttempt"]: null,
    });
}
// Serialize repeat clicks locally, including the read/validate/write sequence.
function submitActivityRequest(request: SpendRequest): Promise<void> {
  const run = queueAction(() => submitActivityRequestNow(request));
  return run;
}
async function submitActivityRequestNow(request: SpendRequest): Promise<void> {
  const actor = ownedCharacter(request.actorId);
  const state = getDowntime(request.actorId);
  const account = state.accounts.find((a) => a.actorId === actor.id);
  if (!account || !actorLedger(actor.id))
    throw new Error(
      "A GM must open Downtime once to prepare this character's Journal.",
    );
  request.period = state.period;
  if (
    reservedMedicalDay(activityPage(actor.id)) > 0 &&
    (requiresFullDowntimeWeek() && request.kind === "hustleRoll"
      ? 7
      : request.days) >
      downtimeBalance(state, actor.id) -
        reservedMedicalDay(activityPage(actor.id))
  )
    throw new Error(
      "One downtime day is reserved for the Medtech work list. Finish that workday first.",
    );
  const commandId = createUniqueId();
  try {
    await executeDowntimeCommand(request, commandId, actor, state);
  } catch (error) {
    if (
      !getDowntime(request.actorId).events.some(
        (e) => e.requestId === commandId,
      )
    )
      throw error;
  }
}
export function healingFormula(h: HealingResult): string {
  const base = [
    "BODY " + h.body,
    ...(h.medbay ? ["2 medbay"] : []),
    ...(h.antibiotic && h.multiplyAntibiotic ? ["2 antibiotic"] : []),
  ].join(" + ");
  return (
    "(" +
    base +
    ")" +
    (h.enhancedAntibodies ? " × 2 antibodies" : "") +
    (h.cryotank ? " × 2 cryotank" : "") +
    (h.antibiotic && !h.multiplyAntibiotic ? " + 2 antibiotic" : "") +
    " = " +
    h.rate +
    " HP/day"
  );
}
function hustleSummary(h: HustleReward): string {
  return (
    h.roleName +
    " rank " +
    h.rank +
    "; roll " +
    h.roll +
    ": " +
    h.activity +
    "; 7 allocated days used; +" +
    h.amount +
    " eb (" +
    h.before +
    " → " +
    h.after +
    "); RollTable." +
    h.tableId +
    ", result " +
    h.resultId
  );
}
export async function requestTechAction(
  kind:
    | "techStart"
    | "techDay"
    | "techRoll"
    | "techCancel"
    | "techFinish"
    | "techWorkshop",
  actorId: string,
  projectId?: string,
  tech?: TechInput,
): Promise<void> {
  return submitActivityRequest({
    kind,
    actorId,
    projectId,
    tech,
    days: ["techDay", "techWorkshop"].includes(kind) ? 1 : 0,
    period: 0,
    reason: tech?.name ?? kind,
  });
}
export async function requestHustleRoll(
  actorId: string,
  roleItemId: string,
): Promise<void> {
  return submitActivityRequest({
    actorId,
    roleItemId,
    kind: "hustleRoll",
    days: 0,
    reason: "Roll weekly hustle",
    period: 0,
  });
}
export async function requestDowntimeUse(
  days: number,
  kind: DowntimeUse,
  reason: string,
  actorId = game.user?.character?.id ?? "",
  details: { healing?: HealingOptions } = {},
): Promise<void> {
  return submitActivityRequest({
    days,
    kind,
    reason: reason.trim(),
    period: 0,
    ...details,
    actorId,
  });
}

export function requestMedicalAction(
  actorId: string,
  action: MedicalAction,
): Promise<void> {
  const run = queueAction(async () => {
    const actor = ownedCharacter(actorId),
      page = activityPage(actorId);
    if (!page)
      throw new Error("A GM must prepare this character's Journal first.");
    const completed = await processMedical(
      {
        actor,
        page,
        balance: downtimeBalance(getDowntime(actorId), actorId),
        date: getCampaignDate(),
        save: async (m, days, reason, transaction) => {
          const all = getDowntime(actorId);
          if (days)
            applyActivityRequest(
              all,
              {
                id: createUniqueId(),
                actorId,
                kind: "spend",
                days,
                period: all.period,
                date: getCampaignDate(),
                reason,
                ...transaction,
              },
              actor,
            );
          if (!days && transaction.resources.length)
            recordDowntimeTransaction(all, {
              id: createUniqueId(),
              actorId,
              kind: "resource",
              days: 0,
              period: all.period,
              date: getCampaignDate(),
              reason,
              ...transaction,
            });
          const data = characterState(all, actorId);
          validateDowntime(data);
          data.activities = [
            ...activityRecords(actorId).filter((r) => r.kind === "tech"),
            ...m.records,
          ];
          await saveCharacterState(data, ledgerHtml(data));
          await page.update({
            ["flags." + MODULE_ID + ".medicalAttempt"]: null,
          });
        },
      },
      action,
    );
    if (
      completed &&
      ["taskRoll", "providerComplete", "patientComplete"].includes(action.kind)
    ) {
      const message = readMedical(page).history.at(-1)?.text;
      if (message) ui.notifications.info(message);
    }
  });
  return run;
}

export async function startNextDowntimeSession(): Promise<void> {
  await withDowntimeLock(async () => {
    const state = getDowntime();
    if (state.accounts.some((a) => reservedMedicalDay(activityPage(a.actorId))))
      throw new Error(
        "Finish active Medtech workdays before starting the next session.",
      );
    for (const account of state.accounts) {
      const days = downtimeBalance(state, account.actorId);
      if (days > 0)
        state.events.push({
          id: createUniqueId(),
          actorId: account.actorId,
          days,
          kind: "expire",
          period: state.period,
          date: getCampaignDate(),
          reason: "Unallocated days expired at the start of the next session.",
        });
    }
    state.period++;
    await save(state);
  });
}
export function report(error: unknown): void {
  console.error(MODULE_ID + " | Downtime", error);
  ui.notifications.error(
    error instanceof Error ? error.message : "Downtime update failed.",
  );
}
// Coalesce related Actor/role hooks into one maintenance pass on the shared queue.
let maintenanceQueued = false;
let fullMaintenance = false;
const maintenanceActors = new Set<string>();
export function scheduleDowntimeMaintenance(actorId?: string): void {
  if (!isDowntimeGM()) return;
  if (actorId) maintenanceActors.add(actorId);
  else fullMaintenance = true;
  if (maintenanceQueued) return;
  maintenanceQueued = true;
  void withDowntimeLock(async () => {
    const targets = fullMaintenance ? undefined : [...maintenanceActors];
    maintenanceActors.clear();
    fullMaintenance = false;
    maintenanceQueued = false;
    await ensureDowntime([], targets);
  }).catch(report);
}

// GM corrections use the existing ledger transaction path and never change allocated activities.
export async function adjustPlayerDowntime(
  actorId: string,
  amount: number,
  reason: string,
): Promise<void> {
  await withGMAction(async () => {
    if (
      !Number.isSafeInteger(amount) ||
      amount === 0 ||
      !reason.trim() ||
      reason.trim().length > 500
    )
      throw new Error(
        "Enter a nonzero whole-day adjustment and a reason (up to 500 characters).",
      );
    const actor = game.actors.get(actorId);
    if (!actor || actor.type !== "character" || isActorExcluded(actorId))
      throw new Error("Choose an eligible character.");
    await ensureDowntime([actorId], [actorId]);
    const state = getDowntime(actorId);
    const before = downtimeBalance(state, actorId);
    const after = before + amount;
    if (
      !Number.isSafeInteger(after) ||
      after < reservedMedicalDay(activityPage(actorId))
    )
      throw new Error(
        "The adjustment cannot make downtime negative or remove a reserved medical day.",
      );
    const id = createUniqueId();
    recordDowntimeTransaction(state, {
      id,
      actorId,
      kind: amount > 0 ? "award" : "spend",
      days: Math.abs(amount),
      period: state.period,
      date: getCampaignDate(),
      reason:
        "GM adjustment: " +
        reason.trim() +
        " (" +
        before +
        " → " +
        after +
        " days)",
      ...(amount > 0 ? { payoutId: id } : {}),
    });
    await save(state);
  });
}

// Shared seven-day Nomad task; resetting a completed cycle never charges another day.
export function requestNomadRespec(
  actorId: string,
  days: number,
  reset = false,
): Promise<void> {
  return submitActivityRequest({
    actorId,
    days,
    kind: reset ? "nomadRespecReset" : "nomadRespecDay",
    period: 0,
    reason: reset ? "Respec Nomad Vehicle — new task" : "Respec Nomad Vehicle",
  });
}
