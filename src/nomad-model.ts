import type { DowntimeEvent } from "./downtime-model";

// Respec progress is derived from the same transactions that spend its days.
export function nomadRespecDays(
  events: DowntimeEvent[],
  actorId: string,
): number {
  return events
    .filter((e) => e.actorId === actorId)
    .reduce(
      (days, e) =>
        e.kind === "nomadRespecReset"
          ? 0
          : e.kind === "nomadRespecDay"
            ? days + e.days
            : days,
      0,
    );
}
export function validateNomadEvent(
  event: DowntimeEvent,
  prior: DowntimeEvent[],
): void {
  if (!event.kind.startsWith("nomadRespec")) return;
  validateNomadProgress(event, nomadRespecDays(prior, event.actorId));
}
// Share the same validation between single commands and a one-pass ledger audit.
export function validateNomadProgress(
  event: DowntimeEvent,
  progress: number,
): void {
  if (event.kind === "nomadRespecReset") {
    if (event.days !== 0 || progress !== 7)
      throw new Error("Complete the current seven-day respec first.");
  } else if (
    !Number.isSafeInteger(event.days) ||
    event.days < 1 ||
    progress + event.days > 7
  ) {
    throw new Error(
      "Allocate only the remaining days of this seven-day respec.",
    );
  }
}
