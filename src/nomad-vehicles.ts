import { MODULE_ID } from "./constants";
import { queueAction } from "./action-coordinator";
import {
  actorPayoutJournal,
  ensureActorPayoutJournal,
  readRecord,
  recordPage,
  writeRecord,
  journalTable,
  recordEscape as esc,
} from "./journal-records";
import { getHeadquarters } from "./headquarters";
import { nomadRespecDays } from "./nomad-model";
import type { DowntimeState } from "./downtime-model";
import { teammateActorIds } from "./actor-policy";

type VehicleLink = { actorId: string; name: string };
type Roster = {
  slots: Array<VehicleLink | null>;
  history: Array<{ date: string; action: string; name: string }>;
};
// Vehicles are existing character/mook Actors; no inventory, HP or permissions are copied.
export function isNomad(actor?: FoundryActor): boolean {
  return Array.from(actor?.items ?? []).some((item) => {
    const role = item.system as { rank?: number; mainRoleAbility?: string };
    return (
      item.type === "role" &&
      Number(role?.rank) > 0 &&
      (item.name.trim().toLowerCase() === "nomad" ||
        role.mainRoleAbility?.trim().toLowerCase() === "moto")
    );
  });
}
export function hasNomadGarage(): boolean {
  return getHeadquarters(false).headquarters.some((hq) =>
    hq.improvements.some((i) => i.name.trim().toLowerCase() === "garage"),
  );
}
export function readNomadVehicles(actorId: string): Roster {
  return readRecord(actorPayoutJournal(actorId), "nomadVehicles", {
    slots: Array(6).fill(null),
    history: [],
  });
}
// Display and hook paths inspect only bounded slots; callers cannot mutate the stored record.
export function nomadVehicleSlots(actorId: string): Roster["slots"] {
  const data = recordPage(
    actorPayoutJournal(actorId),
    "nomadVehicles",
  )?.getFlag?.(MODULE_ID, "data") as Roster | undefined;
  return (data?.slots ?? []).map((slot) => (slot ? { ...slot } : null));
}
function owner(actorId: string): FoundryActor {
  const actor = game.actors.get(actorId);
  if (
    !actor ||
    !game.user ||
    (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER"))
  )
    throw new Error("You do not control this Nomad.");
  if (!isNomad(actor)) throw new Error("A ranked Nomad role is required.");
  return actor;
}
function canView(actor: FoundryActor): boolean {
  return (
    !!game.user &&
    (game.user.isGM || actor.testUserPermission(game.user, "OBSERVER"))
  );
}
export function nomadVehicleCandidates(actorId: string): FoundryActor[] {
  owner(actorId);
  const slots = nomadVehicleSlots(actorId);
  const actors = Array.from(game.actors);
  const teammates = teammateActorIds(actors);
  const assigned = new Set(
    Array.from(game.users).map((user) => user.character?.id),
  );
  return actors
    .filter(
      (a) =>
        a.id !== actorId &&
        ["character", "mook"].includes(a.type) &&
        canView(a) &&
        !assigned.has(a.id) &&
        !teammates.has(a.id) &&
        !slots.some((s) => s?.actorId === a.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function setNomadVehicle(
  actorId: string,
  slot: number,
  vehicleId?: string,
): Promise<void> {
  return queueAction(async () => {
    const actor = owner(actorId);
    if (!Number.isInteger(slot) || slot < 0 || slot >= 6)
      throw new Error("Choose one of the six vehicle slots.");
    const roster = readNomadVehicles(actorId);
    const existing = roster.slots[slot];
    let vehicle: FoundryActor | undefined;
    if (vehicleId) {
      if (existing)
        throw new Error("Remove this vehicle before selecting another.");
      vehicle = nomadVehicleCandidates(actorId).find((a) => a.id === vehicleId);
      if (!vehicle)
        throw new Error("Choose an available vehicle Actor you can view.");
    } else {
      if (!existing) return;
      const linked = game.actors.get(existing.actorId);
      if (linked && !canView(linked))
        throw new Error("You cannot view this vehicle.");
    }
    roster.slots[slot] = vehicle
      ? { actorId: vehicle.id, name: vehicle.name }
      : null;
    roster.history.push({
      date: new Date().toISOString(),
      action: vehicle ? "Added" : "Removed",
      name: vehicle?.name ?? existing!.name,
    });
    const journal = await ensureActorPayoutJournal(actor);
    await writeRecord(
      journal,
      "nomadVehicles",
      "Nomad Vehicles",
      roster,
      "Nomad vehicle links; HP remains on each Actor. Respec progress and day charges are in Downtime Log.",
      "<h2>Vehicles</h2>" +
        journalTable(
          ["Slot", "Vehicle"],
          roster.slots.flatMap((s, i) =>
            s
              ? [
                  [
                    String(i + 1),
                    esc(game.actors.get(s.actorId)?.name ?? s.name),
                  ],
                ]
              : [],
          ),
        ) +
        "<h2>Roster History</h2>" +
        journalTable(
          ["Date", "Action", "Vehicle"],
          roster.history.map((h) => [esc(h.date), esc(h.action), esc(h.name)]),
        ),
    );
  });
}
// Recheck role and Garage at execution; the respec task is shared, not tied to one vehicle.
export function requireNomadGarage(actorId: string): void {
  owner(actorId);
  if (!hasNomadGarage())
    throw new Error(
      "An HQ Garage improvement is required to respec a Nomad vehicle.",
    );
}
// Hub roster reads only links and native Actor data, without loading downtime history.
export function nomadVehiclePanel(actor: FoundryActor | undefined) {
  if (!isNomad(actor) || !actor) return { visible: false, slots: [] };
  const roster = { slots: nomadVehicleSlots(actor.id) };
  // Reveal row two when row one is full; retain it while any later vehicle remains linked.
  const showSecondRow =
    [0, 1, 2].every((index) => !!roster.slots[index]) ||
    roster.slots.slice(3, 6).some(Boolean);
  return {
    visible: true,
    slots: Array.from(
      { length: showSecondRow ? 6 : 3 },
      (_, index) => index,
    ).flatMap((index) => {
      const link = roster.slots[index];
      const vehicle = link && game.actors.get(link.actorId);
      if (vehicle && !canView(vehicle)) return [];
      const hp = (
        vehicle?.system as {
          derivedStats?: { hp?: { value?: number; max?: number } };
        }
      )?.derivedStats?.hp;
      return [
        {
          index,
          number: index + 1,
          occupied: !!link,
          name: vehicle?.name ?? link?.name,
          img: vehicle?.img ?? "icons/svg/mystery-man.svg",
          missing: !!link && !vehicle,
          hp: Number.isFinite(hp?.value) ? hp!.value : "—",
          maxHp: Number.isFinite(hp?.max) ? hp!.max : "—",
        },
      ];
    }),
  };
}
// Only the shared Garage-gated respec task belongs in Spend Downtime.
export function nomadRespecPanel(
  actor: FoundryActor | undefined,
  state: DowntimeState,
  available: number,
) {
  const garage = isNomad(actor) && hasNomadGarage();
  const days = actor ? nomadRespecDays(state.events, actor.id) : 0;
  return {
    // Keep the task visible without a Garage, but disable every task action.
    visible: isNomad(actor),
    cannotReset: !garage,
    garage,
    days,
    progress: (days / 7) * 100,
    remaining: 7 - days,
    complete: days === 7,
    cannotAdd: !garage || days >= 7 || available < 1,
    cannotFill: !garage || days >= 7 || available < 7 - days,
  };
}
export function bindNomadVehicles(
  root: HTMLElement,
  actorId: () => string,
  refresh: () => void,
  spend?: (days: number, reset: boolean) => Promise<void>,
) {
  root
    .querySelectorAll<HTMLButtonElement>("[data-nomad-action]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        // Capture the displayed Nomad before a selection dialog can outlive a character switch.
        const nomadId = actorId();
        const index = Number(button.dataset.slot);
        const link = nomadVehicleSlots(nomadId)[index];
        const action = button.dataset.nomadAction;
        const run = (fn: () => Promise<void>) => {
          button.disabled = true;
          void fn()
            .then(refresh)
            .catch((error) => ui.notifications.error(String(error)))
            .finally(() => {
              button.disabled = false;
            });
        };
        if (action === "open" && link) {
          const vehicle = game.actors.get(link.actorId);
          if (vehicle && canView(vehicle)) vehicle.sheet?.render(true);
        } else if (action === "add") {
          const choices = nomadVehicleCandidates(nomadId);
          if (!choices.length) {
            ui.notifications.info(
              "No available vehicle Actors. Ask the GM to grant access.",
            );
            return;
          }
          new Dialog({
            title: "Add Nomad Vehicle",
            content:
              '<label>Vehicle Actor</label><select name="vehicle"><option value="">Choose Actor</option>' +
              choices
                .map(
                  (a) =>
                    '<option value="' +
                    esc(a.id) +
                    '">' +
                    esc(a.name) +
                    "</option>",
                )
                .join("") +
              "</select>",
            buttons: {
              add: {
                label: "Add Vehicle",
                callback: (html) => {
                  const id =
                    html[0]?.querySelector<HTMLSelectElement>(
                      '[name="vehicle"]',
                    )?.value;
                  if (id) run(() => setNomadVehicle(nomadId, index, id));
                },
              },
              cancel: { label: "Cancel" },
            },
            default: "cancel",
          }).render(true);
        } else if (action === "remove" && link) {
          new Dialog({
            title: "Remove Vehicle",
            content:
              "<p>Remove this roster link? The Actor and spent respec days remain unchanged.</p>",
            buttons: {
              remove: {
                label: "Remove",
                callback: () => run(() => setNomadVehicle(nomadId, index)),
              },
              cancel: { label: "Cancel" },
            },
            default: "cancel",
          }).render(true);
        } else if (spend && ["day", "fill", "reset"].includes(action ?? "")) {
          run(() =>
            spend(
              action === "reset" ? 0 : Number(button.dataset.days ?? 1),
              action === "reset",
            ),
          );
        }
      }),
    );
}
