import { activityRollRecipients } from "./roll-visibility";
import { PHARMACEUTICALS } from "./pharmaceuticals";
import { requiresFullDowntimeWeek } from "./downtime-settings";
import type { ActivityRecord, ActivityEvent } from "./activity-records";
import { rollCard, type RollCard } from "./roll-card";
import { activityHtml } from "./downtime-journal-view";
import { readableRecord } from "./journal-records";
import { deliverItems, moneyChange, humanityUpdate } from "./actor-resources";
import { MODULE_ID } from "./constants";
import { isActorExcluded } from "./actor-policy";
import {
  medtechRole,
  medicalAbility,
  rollMedicalAbility,
  surgeryDifficulty,
} from "./medtech-system";

export const THERAPIES = [
  {
    id: "addiction",
    name: "Addiction",
    cost: 1000,
    materials: 500,
    dv: 15,
    formula: "",
  },
  {
    id: "standard",
    name: "Standard Humanity Loss",
    cost: 500,
    materials: 100,
    dv: 15,
    formula: "2d6",
  },
  {
    id: "extreme",
    name: "Extreme Humanity Loss",
    cost: 1000,
    materials: 500,
    dv: 17,
    formula: "4d6",
  },
] as const;
export type TherapyId = (typeof THERAPIES)[number]["id"];
interface Course {
  id: string;
  type: TherapyId;
  days: number;
  pc: boolean;
  targetId?: string;
  targetName?: string;
  addiction: string;
}
interface Task {
  id: string;
  kind: "surgery" | "pharma";
  uuid: string;
  name: string;
  dv: number;
  hours: number;
  attempts: number;
  success: boolean;
  paid: boolean;
  doses: number;
  itemData?: Record<string, unknown>;
}
interface Workday {
  id: string;
  hours: number;
  tasks: Task[];
}
export interface MedicalState {
  version: 1;
  records: ActivityRecord<Course | Workday>[];
  patient?: Course;
  provider?: Course;
  day?: Workday;
  history: { date: string; text: string }[];
}
export interface MedicalAction {
  kind:
    | "patientCancel"
    | "providerCancel"
    | "patientStart"
    | "providerStart"
    | "patientDay"
    | "providerDay"
    | "patientFailed"
    | "patientComplete"
    | "providerComplete"
    | "taskAdd"
    | "taskRemove"
    | "taskRoll"
    | "clearRoll"
    | "finishDay";
  type?: string;
  pc?: boolean;
  targetId?: string;
  addiction?: string;
  taskKind?: string;
  uuid?: string;
  taskId?: string;
  pcSuccess?: boolean;
  fillWeek?: boolean;
}
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const id = () => foundry.utils.randomID(16);
export function readMedical(page?: FoundryJournalPage): MedicalState {
  const records = structuredClone(
    (page?.getFlag?.(MODULE_ID, "activities") as
      ActivityRecord<Course | Workday>[] | undefined) ?? [],
  ).filter((r) => r.kind !== "tech");
  const current = (kind: ActivityRecord["kind"]) =>
    records.find((r) => r.kind === kind && r.status === "active")?.details;
  const m: MedicalState = {
    version: 1,
    records,
    patient: current("patient") as Course | undefined,
    provider: current("provider") as Course | undefined,
    day: current("medicalDay") as Workday | undefined,
    history: records.flatMap((r) =>
      r.events.map((e) => ({ date: e.date, text: e.text })),
    ),
  };
  if (m.version !== 1 || !Array.isArray(m.history))
    throw new Error("Invalid medical Journal data.");
  for (const c of [m.patient, m.provider])
    if (
      c &&
      (!THERAPIES.some((t) => t.id === c.type) ||
        !Number.isInteger(c.days) ||
        c.days < 0 ||
        c.days > 7 ||
        !c.id)
    )
      throw new Error("Invalid therapy course.");
  if (
    m.day &&
    (!Number.isInteger(m.day.hours) ||
      m.day.hours < 0 ||
      m.day.hours > 16 ||
      !Array.isArray(m.day.tasks) ||
      m.day.tasks.some(
        (t) =>
          !["surgery", "pharma"].includes(t.kind) ||
          !Number.isInteger(t.attempts) ||
          t.attempts < 0 ||
          t.hours !== (t.kind === "surgery" ? 4 : 1),
      ))
  )
    throw new Error("Invalid Medtech workday.");
  return m;
}
export function reservedMedicalDay(page?: FoundryJournalPage): number {
  return readMedical(page).day?.hours ? 1 : 0;
}
export function medicalHtml(m: MedicalState): string {
  return (
    "<h2>Medical activities</h2><p>Active, completed, failed and cancelled activities retain their structured fields and events. Each event records its action, input, days, resource changes, skill result and delivered Items. Patient and provider courses are independent.</p>" +
    readableRecord(m.records)
  );
}
export function medicalTargets(actorId: string): FoundryActor[] {
  return Array.from(game.actors).filter(
    (a) =>
      a.id !== actorId &&
      a.type === "character" &&
      !isActorExcluded(a.id) &&
      Array.from(game.users).some(
        (u) => !u.isGM && a.testUserPermission(u, "OWNER"),
      ),
  );
}
export interface MedicalContext {
  actor: FoundryActor;
  page: FoundryJournalPage;
  balance: number;
  date: string;
  save: (
    state: MedicalState,
    days: number,
    reason: string,
    transaction: {
      activityId?: string;
      resources: import("./actor-resources").ResourceChange[];
    },
  ) => Promise<void>;
}
function snapshot(item: FoundryItem) {
  const data = structuredClone(item.toCompendium?.(null) ?? item.toObject());
  delete data._id;
  delete data.folder;
  delete data.ownership;
  return data;
}
export async function processMedical(
  ctx: MedicalContext,
  a: MedicalAction,
): Promise<boolean> {
  const { actor, page, date } = ctx;
  const m = readMedical(page);
  if (
    !game.user ||
    (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) ||
    isActorExcluded(actor.id)
  )
    throw new Error("Choose an owned character.");
  if (a.kind === "clearRoll") {
    if (!canClearMedicalRoll(page))
      throw new Error(
        "This action may have changed native resources. Review its Journal record before resolving it.",
      );
    // Only discard a roll-stage marker. Money and inventory attempts remain protected.
    await page.update({
      ["flags." + MODULE_ID + ".medicalAttempt"]: null,
      "text.content": activityHtml(
        (page.getFlag?.(MODULE_ID, "activities") as
          ActivityRecord[] | undefined) ?? [],
      ),
    });
    return false;
  }
  if (page.getFlag?.(MODULE_ID, "medicalAttempt"))
    throw new Error(
      "An interrupted medical action needs review in this character’s Journal.",
    );
  const before = structuredClone({
    patient: m.patient,
    provider: m.provider,
    medicalDay: m.day,
  });
  const messages: string[] = [];
  const log = (text: string) => {
    messages.push(text);
    m.history.push({ date, text });
  };
  const result: Record<string, unknown> = {};
  let card: RollCard | undefined;
  const resources: Array<{
    resource: string;
    amount: number;
    before: number;
    after: number;
    reason: string;
  }> = [];

  const beginRoll = async () => {
    await page.update({
      ["flags." + MODULE_ID + ".medicalAttempt"]: {
        id: id(),
        action: a.kind,
        date,
        stateBefore: m,
      },
      "text.content":
        (page.text?.content ?? "") +
        "<h2>Medical roll in progress</h2><p>Do not reroll an interrupted action before checking this character’s medicalAttempt record.</p>",
    });
  };
  let days = 0;
  let update: Record<string, unknown> | undefined;
  let items: Record<string, unknown>[] = [];
  let pharmaStack: FoundryItem | undefined;
  let stackUpdate:
    { itemId: string; before: number; after: number } | undefined;
  const debit = (amount: number, description: string) => {
    const money = moneyChange(actor, -amount, description + " — " + date);
    update = money.update;
    resources.push(money.change);
    log(description + ": " + amount + " eb paid.");
  };
  if (a.kind === "patientStart" || a.kind === "providerStart") {
    const fullWeek = requiresFullDowntimeWeek();
    if (fullWeek && ctx.balance - reservedMedicalDay(page) < 7)
      throw new Error(
        "Seven available downtime days are required to start therapy.",
      );
    const provider = a.kind === "providerStart",
      key = provider ? "provider" : "patient";
    if (m[key]) throw new Error("Finish the current therapy course first.");
    const t = THERAPIES.find((t) => t.id === a.type);
    if (!t) throw new Error("Choose a therapy type.");
    if (t.id === "addiction" && !a.addiction?.trim())
      throw new Error("Name the addiction being treated.");
    const target = provider
      ? medicalTargets(actor.id).find((t) => t.id === a.targetId)
      : undefined;
    if (provider) {
      medicalAbility(actor, "Medical Tech Skill");
      if (!target) throw new Error("Choose another player character.");
    }
    const cost = provider ? t.materials : a.pc ? 0 : t.cost;
    if (cost)
      debit(cost, (provider ? "Therapy materials: " : "Therapy: ") + t.name);
    m[key] = {
      id: id(),
      type: t.id,
      days: fullWeek ? 7 : 0,
      pc: !provider && a.pc === true,
      targetId: target?.id,
      targetName: target?.name,
      addiction: a.addiction?.trim() ?? "",
    };
    if (fullWeek) days = 7;
    log(
      "Started " +
        (provider ? "providing " : "receiving ") +
        t.name +
        (target ? " for " + target.name + " (Actor." + target.id + ")" : "") +
        ".",
    );
  } else if (a.kind === "patientDay" || a.kind === "providerDay") {
    const c = a.kind === "providerDay" ? m.provider : m.patient;
    if (!c || c.days >= 7)
      throw new Error("Choose an unfinished therapy course.");
    if (a.kind === "providerDay") medicalAbility(actor, "Medical Tech Skill");
    // Compute the remainder from the current course inside the serialized action.
    days = requiresFullDowntimeWeek() ? 7 : a.fillWeek ? 7 - c.days : 1;
    if (ctx.balance - reservedMedicalDay(page) < days)
      throw new Error(
        days === 7
          ? "Seven available downtime days are required for therapy."
          : "No unreserved downtime days available.",
      );
    c.days = Math.min(7, c.days + days);
    log("Allocated therapy day " + c.days + "/7 (" + a.kind + ").");
  } else if (a.kind === "patientCancel" || a.kind === "providerCancel") {
    const key = a.kind === "patientCancel" ? "patient" : "provider";
    const course = m[key];
    if (!course) throw new Error("No active therapy course to cancel.");
    // Allocations and the starting payment were already spent; cancellation refunds neither.
    log(
      "Cancelled therapy; " +
        course.days +
        " allocated downtime days forfeited. No money refunded.",
    );
    delete m[key];
  } else if (a.kind === "patientFailed") {
    if (!m.patient?.pc || m.patient.days !== 7)
      throw new Error(
        "Only a completed week of PC therapy can be recorded as failed.",
      );
    log("PC therapy failed; seven patient downtime days lost, no recovery.");
    delete m.patient;
  } else if (a.kind === "patientComplete" || a.kind === "providerComplete") {
    const provider = a.kind === "providerComplete",
      c = provider ? m.provider : m.patient;
    if (!c || c.days !== 7)
      throw new Error("Allocate seven therapy days first.");
    const t = THERAPIES.find((t) => t.id === c.type)!;
    if (provider) {
      medicalAbility(actor, "Medical Tech Skill");
      const roll = await rollMedicalAbility(
        actor,
        "Medical Tech Skill",
        t.dv,
        beginRoll,
      );
      if (!roll) return false;
      result.check = { ...roll, dv: t.dv, ability: "Medical Tech Skill" };
      result.success = roll.success;
      card = {
        title: "Medtech — Therapy",

        subject: t.name + " · " + c.targetName,
        outcome: roll.success ? "SUCCESS" : "FAILURE",
        success: roll.success,
        check: { total: roll.total, dv: t.dv, label: "Medical Tech" },
        effect: roll.success
          ? "Therapy succeeded. Patient can complete their therapy course."
          : "Therapy failed. Seven days and materials are lost.",
      };
      log(
        "Therapy " +
          t.name +
          " for " +
          c.targetName +
          " (Actor." +
          c.targetId +
          "): " +
          roll.total +
          " vs DV " +
          t.dv +
          "; " +
          (roll.success ? "success" : "failed; week and materials lost") +
          ".",
      );
      delete m.provider;
    } else {
      if (c.pc && !a.pcSuccess)
        throw new Error(
          "Confirm that your PC therapist’s Medical Tech check succeeded.",
        );
      if (t.formula) {
        const h = (
          actor.system as {
            derivedStats?: { humanity?: { value: number; max: number } };
          }
        ).derivedStats?.humanity;
        if (!h || !Number.isFinite(h.value) || !Number.isFinite(h.max))
          throw new Error("Native current/maximum Humanity is unavailable.");
        await beginRoll();
        const roll = await new Roll(t.formula).evaluate();
        if (!Number.isFinite(roll.total))
          throw new Error("Humanity roll returned no total.");
        const after = Math.max(h.value, Math.min(h.max, h.value + roll.total));
        update = humanityUpdate(after);
        result.humanity = {
          formula: t.formula,
          total: roll.total,
          before: h.value,
          after,
          maximum: h.max,
        };
        card = {
          title: "Therapy — Humanity",

          subject: t.name,
          outcome: "COMPLETE",
          success: true,
          detail: t.formula + " rolled " + roll.total,
          effect:
            "+" +
            (after - h.value) +
            " Humanity · " +
            h.value +
            " → " +
            after +
            " / " +
            h.max,
        };
        resources.push({
          resource: "humanity",
          amount: after - h.value,
          before: h.value,
          after,
          reason: t.name,
        });
        log(
          t.name +
            ": rolled " +
            roll.total +
            " (" +
            t.formula +
            "); Humanity " +
            h.value +
            " → " +
            after +
            "; native maximum " +
            h.max +
            ".",
        );
      } else
        log(
          "Addiction therapy completed for " +
            c.addiction +
            ". Remove one addiction manually. For one year, secondary-effect resistance rolls against that addiction’s source automatically fail.",
        );
      delete m.patient;
    }
  } else {
    if (!medtechRole(actor))
      throw new Error("A ranked Medtech role is required.");
    if (ctx.balance < 1)
      throw new Error("One downtime day is required for this work list.");
    if (a.kind === "taskAdd") {
      if (!["surgery", "pharma"].includes(a.taskKind ?? ""))
        throw new Error("Choose Surgery or Pharmaceuticals.");
      const kind = a.taskKind as Task["kind"];
      const basicDrug =
        kind === "pharma"
          ? PHARMACEUTICALS.find((name) => a.uuid === "pharma:" + name)
          : undefined;
      const item = basicDrug
        ? undefined
        : ((await fromUuid(a.uuid ?? "")) as FoundryItem | undefined);
      if (
        !basicDrug &&
        (!item ||
          !game.user ||
          !item.testUserPermission?.(game.user, "OBSERVER"))
      )
        throw new Error("Choose a readable medical Item.");
      medicalAbility(
        actor,
        kind === "surgery" ? "Surgery Skill" : "Medical Tech Skill",
      );
      const dv = kind === "surgery" ? surgeryDifficulty(item!) : 13;
      if (kind === "pharma" && !basicDrug && item?.type !== "drug")
        throw new Error("Choose a pharmaceutical drug Item.");
      m.day ??= { id: id(), hours: 0, tasks: [] };
      if (m.day.tasks.length >= 16)
        throw new Error("At most 16 tasks fit in a day.");
      const hours = kind === "surgery" ? 4 : 1;
      if (
        m.day.hours +
          hours +
          m.day.tasks
            .filter((t) => !t.success)
            .reduce((n, t) => n + t.hours, 0) >
        16
      )
        throw new Error("The unfinished tasks will not fit in this day.");
      m.day.tasks.push({
        id: id(),
        kind,
        uuid: item?.uuid ?? a.uuid!,
        name: basicDrug ?? item!.name,
        dv,
        hours,
        attempts: 0,
        success: false,
        paid: false,
        doses: 0,
        itemData:
          kind === "pharma"
            ? basicDrug
              ? { name: basicDrug, type: "drug", system: { amount: 1 } }
              : snapshot(item!)
            : undefined,
      });
      log(
        "Added " +
          (basicDrug ?? item!.name) +
          " (" +
          kind +
          ", DV " +
          dv +
          ", " +
          hours +
          " h per attempt).",
      );
    } else if (a.kind === "taskRemove") {
      const task = m.day?.tasks.find((t) => t.id === a.taskId);
      if (!task || task.attempts)
        throw new Error("Only unattempted tasks can be removed.");
      m.day!.tasks = m.day!.tasks.filter((t) => t.id !== a.taskId);
      if (!m.day!.tasks.length && !m.day!.hours) delete m.day;
    } else if (a.kind === "taskRoll") {
      const d = m.day,
        task = d?.tasks.find((t) => t.id === a.taskId);
      if (!d || !task || task.success)
        throw new Error("Choose an unfinished task.");
      if (d.hours + task.hours > 16)
        throw new Error("This attempt exceeds 16 hours. End this workday.");
      const name =
        task.kind === "surgery" ? "Surgery Skill" : "Medical Tech Skill";
      const ability = medicalAbility(actor, name);
      if (task.kind === "pharma" && !task.paid) {
        debit(200, "Pharmaceutical materials: " + task.name);
        task.paid = true;
      }
      const roll = await rollMedicalAbility(actor, name, task.dv, beginRoll);
      if (!roll) return false;
      result.check = { ...roll, dv: task.dv, ability: name, taskId: task.id };
      d.hours += task.hours;
      task.attempts++;
      task.success = roll.success;
      if (task.success && task.kind === "pharma") {
        task.doses = ability.ability.rank;
        // Use the first matching native drug stack, including an empty stack.
        pharmaStack = Array.from(actor.items ?? []).find(
          (item) =>
            item.type === "drug" &&
            item.name.trim().toLowerCase() ===
              String(task.itemData?.name ?? task.name)
                .trim()
                .toLowerCase(),
        );
        if (pharmaStack) {
          const before = (pharmaStack.system as { amount: number }).amount;
          const after = before + task.doses;
          if (
            !Number.isSafeInteger(before) ||
            before < 0 ||
            !Number.isSafeInteger(after)
          )
            throw new Error(
              "The existing pharmaceutical stack has an invalid quantity.",
            );
          stackUpdate = { itemId: pharmaStack.id, before, after };
        }
        items = [
          {
            ...task.itemData,
            _id: pharmaStack?.id ?? id(),
            system: {
              ...(task.itemData?.system as object),
              amount: task.doses,
            },
          },
        ];
      }
      card = {
        title:
          task.kind === "surgery" ? "MedTech - Surgery" : "MedTech - Pharma",

        subject: task.name,
        outcome: roll.success ? "SUCCESS" : "FAILURE",
        success: roll.success,
        check: { total: roll.total, dv: task.dv, label: name },
        effect:
          roll.success && task.kind === "pharma"
            ? task.doses + " doses added to inventory."
            : undefined,
      };
      log(
        task.name +
          ": " +
          roll.total +
          " vs DV " +
          task.dv +
          "; " +
          (task.success ? "success" : "failed") +
          "; " +
          task.hours +
          " h; day " +
          d.hours +
          "/16 h.",
      );
    } else if (a.kind === "finishDay") {
      // Ending the workday deliberately discards any unfinished or unrolled tasks.
      const d = m.day ?? { hours: 0, tasks: [] };
      log(
        "Spent one downtime day: " +
          d.hours +
          " hours used; " +
          (16 - d.hours) +
          " hours forfeited; list cleared. " +
          d.tasks
            .map(
              (t) =>
                t.name +
                ": " +
                (t.success
                  ? t.kind === "pharma"
                    ? t.doses + " doses"
                    : "surgery successful"
                  : "unfinished, discarded"),
            )
            .join("; "),
      );
      days = 1;
      delete m.day;
    } else throw new Error("Unknown medical action.");
  }
  const reason = messages.join(" ") || "Medtech work list updated";
  const kind: ActivityRecord["kind"] = a.kind.startsWith("patient")
    ? "patient"
    : a.kind.startsWith("provider")
      ? "provider"
      : "medicalDay";
  const current = kind === "medicalDay" ? m.day : m[kind];
  const details = current ?? before[kind];
  if (details) {
    const existing = m.records.find((r) => r.id === details.id);
    const status = current
      ? "active"
      : a.kind === "patientFailed" ||
          (a.kind === "providerComplete" && result.success === false)
        ? "failed"
        : a.kind === "taskRemove" ||
            a.kind === "patientCancel" ||
            a.kind === "providerCancel"
          ? "cancelled"
          : "completed";
    const entry: ActivityEvent = {
      id: id(),
      date,
      action: a.kind,
      text: reason,
      data: {
        input: structuredClone(a),
        days,
        resources,
        result,
        items: items.map((item) => ({
          actorId: actor.id,
          itemId: item._id,
          name: item.name,
          amount: (item.system as { amount?: number })?.amount,
        })),
      },
    };
    const record: ActivityRecord<Course | Workday> = {
      id: details.id,
      actorId: actor.id,
      name:
        kind === "medicalDay"
          ? "Medtech Workday"
          : THERAPIES.find((t) => t.id === (details as Course).type)!.name,
      kind,
      status,
      startedAt: existing?.startedAt ?? date,
      ...(current ? {} : { completedAt: date }),
      progress: {
        value:
          kind === "medicalDay"
            ? (details as Workday).hours
            : (details as Course).days,
        required: kind === "medicalDay" ? 16 : 7,
        unit: kind === "medicalDay" ? "hours" : "days",
      },
      details: structuredClone(details),
      events: [...(existing?.events ?? []), entry],
    };
    m.records = [...m.records.filter((r) => r.id !== record.id), record];
  }

  // Guard native mutations before touching money, Humanity or inventory. Unknown outcomes need reconciliation.
  if (update || items.length)
    await page.update({
      ["flags." + MODULE_ID + ".medicalAttempt"]: {
        id: id(),
        action: a.kind,
        date,
        update,
        items,
        stackUpdate,
        state: m,
        days,
      },
      "text.content":
        (page.text?.content ?? "") +
        "<h2>Medical action in progress</h2><pre>" +
        esc(
          JSON.stringify(
            { action: a.kind, update, items, stackUpdate },
            null,
            2,
          ),
        ) +
        "</pre>",
    });
  if (update) await actor.update(update);
  if (pharmaStack && stackUpdate) {
    if (!pharmaStack.update)
      throw new Error("Native Item updates are unavailable.");
    await pharmaStack.update({ "system.amount": stackUpdate.after });
  } else if (items.length) {
    const created = await deliverItems(actor, items, {
      keepId: true,
    });
    if (created.length !== items.length)
      throw new Error(
        "Pharmaceutical delivery was incomplete; inspect the medical attempt record.",
      );
  }
  await ctx.save(m, days, reason, { activityId: details?.id, resources });
  // Chat is a receipt, never part of committing or retrying the medical action.
  if (card) {
    try {
      await ChatMessage.create({
        speaker: { actor: actor.id, alias: actor.name },
        whisper: activityRollRecipients(actor),
        content: rollCard(card),
      });
    } catch (error) {
      console.error(MODULE_ID + " | Medical chat", error);
    }
  }
  // Clear the attempt only after the save callback commits the activity and resource records.
  return true;
}

function canClearMedicalRoll(page: FoundryJournalPage | undefined): boolean {
  const attempt = page?.getFlag?.(MODULE_ID, "medicalAttempt") as
    { stateBefore?: unknown; update?: unknown; items?: unknown } | undefined;
  return !!attempt?.stateBefore && !attempt.update && !attempt.items;
}

export interface MedicalCatalogItem {
  uuid: string;
  name: string;
  dv?: number;
}
let injuries: MedicalCatalogItem[] = [],
  pharma: MedicalCatalogItem[] = PHARMACEUTICALS.map((name) => ({
    name,
    uuid: "pharma:" + name,
  }));
let catalogLoad: Promise<void> | undefined;
let catalogItems: FoundryItem[] | undefined;
let catalogRevision = 0;
let loadedRevision = -1;
const catalogPacks = new Map<string, FoundryItem[]>();
export function invalidateMedicalCatalog(packChanged = false): void {
  catalogRevision++;
  if (packChanged) catalogPacks.clear();
}
// Share concurrent loads and retain compendium documents until their pack changes.
export async function loadMedicalCatalog(): Promise<void> {
  if (catalogLoad) return catalogLoad;
  const items = Array.from(game.items ?? []);
  if (
    loadedRevision === catalogRevision &&
    catalogItems?.length === items.length &&
    items.every((item, i) => item === catalogItems?.[i])
  )
    return;
  const revision = catalogRevision;
  catalogLoad = buildMedicalCatalog(revision)
    .then((complete) => {
      if (complete) {
        loadedRevision = revision;
        catalogItems = items;
      }
    })
    .finally(() => {
      catalogLoad = undefined;
    });
  return catalogLoad;
}
async function buildMedicalCatalog(revision: number): Promise<boolean> {
  let complete = true;
  const docs: FoundryItem[] = [...(game.items ?? [])];
  for (const pack of game.packs ?? []) {
    if (
      pack.documentName !== "Item" ||
      !/critical.injur|drugs/i.test(pack.collection)
    )
      continue;
    try {
      let items = catalogPacks.get(pack.collection);
      if (!items) {
        items = await pack.getDocuments();
        if (revision === catalogRevision)
          catalogPacks.set(pack.collection, items);
      }
      docs.push(...items);
    } catch (error) {
      complete = false;
      console.warn(
        MODULE_ID + " | Medical catalog pack unavailable: " + pack.collection,
        error,
      );
    }
  }
  const injuryMap = new Map<string, MedicalCatalogItem>(),
    drugMap = new Map<string, MedicalCatalogItem>();
  for (const item of docs) {
    if (
      !item.uuid ||
      !game.user ||
      !item.testUserPermission?.(game.user, "OBSERVER")
    )
      continue;
    if (item.type === "criticalInjury") {
      try {
        const dv = surgeryDifficulty(item);
        injuryMap.set(item.name, { uuid: item.uuid, name: item.name, dv });
      } catch {
        /* Non-surgical injuries are not surgery choices. */
      }
    }
    // Drug Items have no pharmaceutical type flag; use the campaign's pharmaceutical list.
    if (
      item.type === "drug" &&
      PHARMACEUTICALS.some(
        (name) => name.toLowerCase() === item.name.trim().toLowerCase(),
      )
    )
      drugMap.set(item.name.trim().toLowerCase(), {
        uuid: item.uuid,
        name: item.name,
      });
  }
  injuries = [...injuryMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  // Keep the campaign's complete list even when a compendium omits a drug.
  pharma = PHARMACEUTICALS.map((name) => ({
    name,
    uuid: drugMap.get(name.toLowerCase())?.uuid ?? "pharma:" + name,
  }));
  return complete;
}
export function medicalView(
  actor: FoundryActor | undefined,
  page: FoundryJournalPage | undefined,
  balance: number,
) {
  const fullWeek = requiresFullDowntimeWeek();
  const available = balance - reservedMedicalDay(page);
  const m = readMedical(page),
    canMedtech = !!actor && !!medtechRole(actor);
  const viewCourse = (c: Course | undefined, provider: boolean) =>
    c
      ? {
          ...c,
          name: THERAPIES.find((t) => t.id === c.type)?.name,
          progress: (100 * c.days) / 7,
          canAdd: c.days < 7 && available >= (fullWeek ? 7 : 1),
          daysNeeded: Math.max(0, 7 - c.days),
          canFill: c.days < 7 && available >= 7 - c.days,
          needsDays: c.days < 7,
          canFinish: c.days === 7,
          formula: THERAPIES.find((t) => t.id === c.type)?.formula,
          provider,
        }
      : undefined;
  let medicalRank = 0,
    surgeryRank = 0;
  if (actor) {
    try {
      medicalRank = medicalAbility(actor, "Medical Tech Skill").ability.rank;
    } catch {}
    try {
      surgeryRank = medicalAbility(actor, "Surgery Skill").ability.rank;
    } catch {}
  }
  const day = m.day;
  return {
    canMedtech,
    canClearMedicalRoll: canClearMedicalRoll(page),
    medicalRank,
    surgeryRank,
    therapyTypes: THERAPIES,
    patient: viewCourse(m.patient, false),
    provider: viewCourse(m.provider, true),
    targets: actor
      ? medicalTargets(actor.id).map((a) => ({ id: a.id, name: a.name }))
      : [],
    injuries,
    pharma,
    canStartPatient: !m.patient && (!fullWeek || available >= 7),
    canStartProvider:
      canMedtech &&
      medicalRank > 0 &&
      !m.provider &&
      (!fullWeek || available >= 7),
    canAddMedicalTask: canMedtech && balance > 0,
    medicalTasks:
      day?.tasks.map((t) => ({
        ...t,
        canRoll: !t.success && day.hours + t.hours <= 16,
        canRemove: !t.attempts,
        status: t.success ? "Successful" : "Needs check",
      })) ?? [],
    medicalHours: day?.hours ?? 0,
    medicalRemaining: 16 - (day?.hours ?? 0),
    medicalReserved: !!day?.hours,
    canFinishMedicalDay: canMedtech && balance > 0,
  };
}
