import type { ActivityRecord } from "./activity-records";
import type { DowntimeEvent, DowntimeState } from "./downtime-model";

export const TECH_MONTH_SETTING = "techCraftingMonthDays";
export const TECH_MULTIPLE_SETTING = "techMultipleWithoutWorkshop";
export const TECH_CATEGORIES = [
  { id: "premium", name: "Premium", price: 100, days: 1, dv: 17 },
  { id: "expensive", name: "Expensive", price: 500, days: 7, dv: 21 },
  {
    id: "veryExpensive",
    name: "Very Expensive",
    price: 1000,
    days: 14,
    dv: 24,
  },
  { id: "luxury", name: "Luxury", price: 5000, days: 0, dv: 29 },
  { id: "superLuxury", name: "Super Luxury", price: 10000, days: 0, dv: 29 },
] as const;
export type TechMode = "fabricate" | "upgrade" | "invention";
export interface TechInput {
  mode: TechMode;
  slot: number;
  sourceUuid?: string;
  name: string;
  description: string;
  category: string;
  price: number;
  skillId: string;
}
export interface TechSpec extends TechInput {
  required: number;
  dv: number;
  monthDays: number;
  itemData: Record<string, unknown>;
  storageActorId?: string;
  storageItemId?: string;
}
export interface TechCheck {
  total: number;
  dv: number;
  success: boolean;
  burned: number;
  skillId: string;
  skillName: string;
  specialty: string;
  rank: number;
}
export interface TechDelivery {
  actorId: string;
  itemId: string;
}
export function projectSchedule(
  category: string,
  price: number,
  monthDays: number,
) {
  const tier = TECH_CATEGORIES.find((c) => c.id === category);
  if (!tier)
    throw new Error(
      "Projects require Premium or higher. Use free-form downtime for cheaper items.",
    );
  if (!Number.isSafeInteger(monthDays) || monthDays < 28 || monthDays > 31)
    throw new Error("TECH months must contain 28–31 days.");
  if (!Number.isSafeInteger(price) || price < tier.price)
    throw new Error("Enter a valid cost for the selected category.");
  const required =
    tier.days ||
    monthDays * (category === "superLuxury" ? Math.ceil(price / 10000) : 1);
  if (!Number.isSafeInteger(required))
    throw new Error("Project duration is too large.");
  return { required, dv: tier.dv, monthDays };
}
export function techProjects(state: DowntimeState, actorId: string) {
  return (state.activities ?? [])
    .filter((r) => r.kind === "tech" && r.actorId === actorId)
    .map((record) => {
      const history = record.events.map((e) => e.data.event as DowntimeEvent);
      const start = history.find((e) => e.kind === "techStart")!;
      const events = history.filter((e) => e.id !== start.id);
      const allocated = events
        .filter((e) => e.kind === "techDay")
        .reduce((n, e) => n + e.days, 0);
      const checks = events.filter((e) => e.kind === "techRoll" && e.techCheck);
      const burned = checks.reduce((n, e) => n + (e.techCheck?.burned ?? 0), 0);
      const lastFailure = [...checks]
        .reverse()
        .find((e) => !e.techCheck!.success);
      const sinceFailure = lastFailure
        ? events
            .slice(events.indexOf(lastFailure) + 1)
            .filter((e) => e.kind === "techDay")
            .reduce((n, e) => n + e.days, 0)
        : allocated;
      const success = checks.some((e) => e.techCheck!.success);
      const half = Math.floor(start.tech!.required / 2);
      return {
        id: start.id,
        ...start.tech!,
        actorId,
        allocated,
        burned,
        progress: allocated - burned,
        success,
        active: !events.some((e) => e.techDelivery || e.kind === "techCancel"),
        canRoll: !success && allocated - burned >= half && sinceFailure >= half,
        half,
      };
    });
}
export function validateTechEvent(event: DowntimeEvent) {
  if (event.kind === "techStart") {
    const t = event.tech;
    if (
      !t ||
      !["fabricate", "upgrade", "invention"].includes(t.mode) ||
      !Number.isInteger(t.slot) ||
      t.slot < 0 ||
      t.slot > 2 ||
      !t.name?.trim() ||
      typeof t.description !== "string" ||
      !t.skillId ||
      !t.itemData
    )
      throw new Error("Invalid TECH project.");
    const schedule = projectSchedule(t.category, t.price, t.monthDays);
    if (schedule.required !== t.required || schedule.dv !== t.dv)
      throw new Error("Invalid TECH project schedule.");
    if (t.mode === "upgrade" && (!t.storageActorId || !t.storageItemId))
      throw new Error("Upgrade project requires a stored item.");
  }
  if (
    ["techDay", "techRoll", "techCancel"].includes(event.kind) &&
    !event.projectId
  )
    throw new Error("TECH actions require a project ID.");
  if (event.kind === "techRoll") {
    const c = event.techCheck;
    if (
      !c ||
      !Number.isFinite(c.total) ||
      !Number.isInteger(c.dv) ||
      c.success !== c.total > c.dv ||
      !Number.isSafeInteger(c.burned) ||
      c.burned < 0 ||
      !c.skillId ||
      !c.skillName ||
      !c.specialty ||
      !Number.isFinite(c.rank)
    )
      throw new Error("Invalid TECH check.");
  }
}

// TECH records own progress and outcomes; resource transactions hold only charges and references.
export function recordTechActivity(
  state: DowntimeState,
  event: DowntimeEvent,
): void {
  state.activities ??= [];
  const projectId = event.kind === "techStart" ? event.id : event.projectId!;
  let record = state.activities.find(
    (r) => r.id === projectId && r.kind === "tech",
  );
  if (!record) {
    if (!event.tech) throw new Error("TECH project is missing.");
    record = {
      id: projectId,
      actorId: event.actorId,
      name: event.tech.name,
      kind: "tech",
      status: "active",
      startedAt: event.date,
      progress: { value: 0, required: event.tech.required, unit: "days" },
      details: { mode: event.tech.mode, slot: event.tech.slot },
      events: [],
    } satisfies ActivityRecord;
    state.activities.push(record);
  }
  const entry = {
    id: event.id,
    date: event.date,
    action: event.kind,
    text: event.reason,
    data: { event: structuredClone(event) },
  };
  const index = record.events.findIndex((e) => e.id === event.id);
  if (index < 0) record.events.push(entry);
  else record.events[index] = entry;
  const project = techProjects(state, event.actorId).find(
    (p) => p.id === projectId,
  )!;
  record.progress.value = project.progress;
  record.status = record.events.some((e) => e.action === "techCancel")
    ? "cancelled"
    : project.active
      ? "active"
      : "completed";
  if (record.status !== "active") record.completedAt = event.date;
}
