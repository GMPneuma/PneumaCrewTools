import { headquartersIp } from "./headquarters";
import { actorPayoutRecords } from "./journal-records";
import type { FactionReputationRecord } from "./payout-journal";
import { medtechRole } from "./medtech-system";
import { accessibleCrewActors } from "./actor-policy";
import { getIndex } from "./downtime-store";
import { storedHustleDays, storedDowntimeBalance } from "./downtime-records";

export function getHubStatus(selectedActorId?: string) {
  const actors = accessibleCrewActors();
  const actor =
    actors.find((a) => a.id === selectedActorId) ??
    actors.find((a) => a.id === game.user?.character?.id) ??
    actors[0];
  const metric = (path: string) => {
    let value: unknown = actor?.system;
    for (const part of path.split("."))
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    return typeof value === "number" && Number.isFinite(value)
      ? value.toLocaleString("en-US")
      : "—";
  };
  let downtime = "—";
  let downtimeNote = "";
  let downtimeReady = false;
  let daysToHustle: number | null = null;
  try {
    const state = getIndex();
    const account = state.accounts.find((a) => a.actorId === actor?.id);
    if (account) {
      daysToHustle = Math.max(0, 7 - storedHustleDays(account.actorId));
      downtimeReady = true;
      downtime = String(storedDowntimeBalance(account.actorId));
    } else downtimeNote = "Downtime is awaiting GM setup.";
  } catch {
    downtimeNote = "Downtime records need GM attention.";
  }
  return {
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "No eligible characters",
    hasActor: Boolean(actor),
    isMedtech: !!actor && !!medtechRole(actor),
    downtime,
    downtimeReady,
    daysToHustle,
    downtimeNote,
    hqIp: headquartersIp().toLocaleString("en-US"),
    topFactions: actor
      ? actorPayoutRecords<FactionReputationRecord>(
          actor.id,
          "factionReputation",
        )
          .slice()
          .sort(
            (a, b) =>
              b.reputation - a.reputation || a.faction.localeCompare(b.faction),
          )
          .slice(0, 2)
      : [],
    money: metric("wealth.value"),
    ip: metric("improvementPoints.value"),
    reputation: metric("reputation.value"),
    actors: actors.map((p) => ({
      id: p.id,
      name: p.name,
      selected: p.id === actor?.id,
    })),
  };
}
