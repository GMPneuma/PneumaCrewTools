import {
  useDowntime,
  downtimeBalance,
  hustleDays,
  type DowntimeState,
  type DowntimeEvent,
} from "./downtime-model";
export const DOWNTIME_ACTIVITIES = [
  { id: "spend", label: "Free-form activity", requiresRole: null },
  { id: "rest", label: "Rest to heal", requiresRole: null },
  { id: "crafting", label: "TECH crafting", requiresRole: "tech" },
  { id: "hustle", label: "Hustle", requiresRole: "any" },
] as const;
export function characterRoles(actor?: FoundryActor) {
  return Array.from(actor?.items ?? [])
    .filter((item) => item.type === "role")
    .flatMap((item) => {
      const data = item.system as
        { rank?: unknown; mainRoleAbility?: unknown } | undefined;
      const rank = data?.rank;
      if (typeof rank !== "number" || !Number.isSafeInteger(rank) || rank < 1)
        return [];
      return [
        {
          id: item.id,
          name: item.name,
          rank,
          tech:
            item.name.trim().toLowerCase() === "tech" ||
            String(data?.mainRoleAbility ?? "")
              .trim()
              .toLowerCase() === "maker",
        },
      ];
    });
}
export function applyActivityRequest(
  state: DowntimeState,
  event: DowntimeEvent,
  actor?: FoundryActor,
  fullWeek = false,
): void {
  if (!event.reason?.trim() || event.reason.trim().length > 500)
    throw new Error("Describe the activity in 1–500 characters.");
  if (event.period !== state.period)
    throw new Error("This request belongs to an earlier session period.");
  if (
    event.requestId &&
    state.events.some((e) => e.requestId === event.requestId)
  )
    throw new Error("Request already processed.");
  if (!actor || actor.id !== event.actorId)
    throw new Error("Choose an owned character for this activity.");
  if (event.kind === "spend") {
    useDowntime(state, event);
    return;
  }
  const roles = characterRoles(actor);
  if (fullWeek && event.kind === "hustle")
    throw new Error(
      "Hustle requires seven available downtime days spent together when rolling.",
    );
  if (event.kind === "hustleRoll") {
    if (!roles.some((r) => r.id === event.roleItemId && r.rank <= 10))
      throw new Error("Choose a ranked role belonging to this character.");
    if (event.days !== 0)
      throw new Error("Hustle rolls do not accept a custom day count.");
    if (fullWeek) {
      if (downtimeBalance(state, actor.id) < 7)
        throw new Error(
          "Seven available downtime days are required to hustle.",
        );
      // Allocate and resolve the week in the same command and Journal save.
      useDowntime(state, {
        ...event,
        id: event.id + ":week",
        requestId: undefined,
        kind: "hustle",
        days: 7,
        reason: "Weekly hustle — 7 days",
      });
    }
    if (event.days !== 0 || hustleDays(state, actor.id) < 7)
      throw new Error("Allocate at least seven hustle days before rolling.");
    state.events.push(event);
    return;
  }
  // Dedicated Hustle allocations belong to the Actor's shared hustle pool.
  if (event.kind === "hustle") {
    if (!roles.some((r) => r.rank <= 10))
      throw new Error("Hustling requires a ranked role.");
    useDowntime(state, event);
    return;
  }
  if (event.kind !== "rest") throw new Error("Unknown downtime activity.");
  useDowntime(state, event);
}
