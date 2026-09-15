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
import { teammateActorIds } from "./actor-policy";
import { rollCard } from "./roll-card";
import { activityRollRecipients } from "./roll-visibility";

// World-wide die choice keeps every player's Loyalty checks consistent.
export function registerTeammateSettings(): void {
  game.settings.register(MODULE_ID, "loyaltyCheckDie", {
    name: "Loyalty check die",
    hint: "Choose the die used for Exec teammate Loyalty checks. Success still requires rolling below Loyalty.",
    scope: "world",
    config: true,
    type: String,
    choices: { "1d6": "1d6 (default)", "1d10": "1d10" },
    default: "1d6",
  });
}
interface Teammate {
  actorId: string;
  actorName: string;
  loyalty: number;
}
interface LoyaltyChange {
  date: string;
  actorName: string;
  action: string;
  previous: number | null;
  loyalty: number | null;
  reason: string;
}
interface Team {
  slots: Array<Teammate | null>;
  history: LoyaltyChange[];
}
// A roster links existing Actors; it never changes their permissions or resources.
export function isExec(actor: FoundryActor): boolean {
  return Array.from(actor.items ?? []).some((item) => {
    const role = item.system as { rank?: number; mainRoleAbility?: string };
    return (
      item.type === "role" &&
      Number(role.rank) > 0 &&
      (item.name.toLowerCase() === "exec" ||
        role.mainRoleAbility?.toLowerCase() === "teamwork")
    );
  });
}
function readSlots(actorId: string): Team["slots"] {
  const data = recordPage(actorPayoutJournal(actorId), "teammates")?.getFlag?.(
    MODULE_ID,
    "data",
  ) as Team | undefined;
  return data?.slots ?? [null, null, null];
}
export function readTeam(actorId: string): Team {
  return readRecord(actorPayoutJournal(actorId), "teammates", {
    slots: [null, null, null],
    history: [],
  });
}
function authorizedExec(actorId: string): FoundryActor {
  const actor = game.actors.get(actorId);
  if (
    !actor ||
    !game.user ||
    (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER"))
  )
    throw new Error("You do not control this Exec.");
  if (!isExec(actor)) throw new Error("A ranked Exec role is required.");
  return actor;
}
function slotIndex(slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 2)
    throw new Error("Choose one of the three teammate slots.");
}
function loyaltyValue(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error("Loyalty must be a whole number.");
}
export function teammateCandidates(execId: string): FoundryActor[] {
  // Reuse one fresh exclusion set for the entire picker.
  const actors = Array.from(game.actors);
  const teammates = teammateActorIds(actors);
  return actors
    .filter(
      (actor) =>
        actor.id !== execId &&
        ["character", "mook"].includes(actor.type) &&
        !teammates.has(actor.id) &&
        !Array.from(game.users).some((u) => u.character?.id === actor.id) &&
        !readSlots(actor.id).some(Boolean) &&
        game.user &&
        (game.user.isGM || actor.testUserPermission(game.user, "OBSERVER")),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
async function saveTeam(actor: FoundryActor, team: Team) {
  const journal = await ensureActorPayoutJournal(actor);
  const roster = team.slots.flatMap((member, index) =>
    member
      ? [
          [
            String(index + 1),
            esc(game.actors.get(member.actorId)?.name ?? member.actorName),
            String(member.loyalty),
          ],
        ]
      : [],
  );
  const history = team.history.map((h) => [
    esc(h.date),
    esc(h.actorName),
    esc(h.action),
    h.previous === null ? "—" : String(h.previous),
    h.loyalty === null ? "—" : String(h.loyalty),
    esc(h.reason),
  ]);
  await writeRecord(
    journal,
    "teammates",
    "Teammates",
    team,
    "Exec teammates and manual Loyalty changes.",
    "<h2>Teammates</h2>" +
      journalTable(["Slot", "Teammate", "Loyalty"], roster) +
      "<h2>Loyalty Log</h2>" +
      journalTable(
        ["Date", "Teammate", "Action", "Previous", "Loyalty", "Reason"],
        history,
      ),
  );
}
export async function linkTeammate(
  execId: string,
  slot: number,
  actorId: string,
  loyalty: number,
) {
  return queueAction(async () => {
    const exec = authorizedExec(execId);
    slotIndex(slot);
    loyaltyValue(loyalty);
    const team = readTeam(execId);
    if (team.slots[slot])
      throw new Error("Remove this slot's teammate before adding another.");
    const actor = teammateCandidates(execId).find((a) => a.id === actorId);
    if (!actor) throw new Error("Choose an available teammate Actor.");
    team.slots[slot] = { actorId, actorName: actor.name, loyalty };
    team.history.push({
      date: new Date().toISOString(),
      actorName: actor.name,
      action: "Added",
      previous: null,
      loyalty,
      reason: "Initial Loyalty",
    });
    await saveTeam(exec, team);
  });
}
export async function changeLoyalty(
  execId: string,
  slot: number,
  loyalty: number,
  reason: string,
) {
  return queueAction(async () => {
    const exec = authorizedExec(execId);
    slotIndex(slot);
    loyaltyValue(loyalty);
    const team = readTeam(execId),
      member = team.slots[slot];
    if (!member) throw new Error("This teammate slot is empty.");
    if (!reason.trim())
      throw new Error("Enter a reason for the Loyalty change.");
    if (member.loyalty === loyalty) return;
    team.history.push({
      date: new Date().toISOString(),
      actorName: game.actors.get(member.actorId)?.name ?? member.actorName,
      action: "Adjusted",
      previous: member.loyalty,
      loyalty,
      reason: reason.trim(),
    });
    member.loyalty = loyalty;
    await saveTeam(exec, team);
  });
}
export async function removeTeammate(execId: string, slot: number) {
  return queueAction(async () => {
    const exec = authorizedExec(execId);
    slotIndex(slot);
    const team = readTeam(execId),
      member = team.slots[slot];
    if (!member) return;
    team.history.push({
      date: new Date().toISOString(),
      actorName: member.actorName,
      action: "Removed",
      previous: member.loyalty,
      loyalty: null,
      reason: "Roster link removed",
    });
    team.slots[slot] = null;
    await saveTeam(exec, team);
  });
}
export async function rollLoyalty(execId: string, slot: number) {
  const exec = authorizedExec(execId);
  slotIndex(slot);
  const member = readSlots(execId)[slot];
  if (!member) throw new Error("This teammate slot is empty.");
  const actor = game.actors.get(member.actorId);
  if (!actor)
    throw new Error(
      "This teammate Actor is missing. Remove or restore the link.",
    );
  loyaltyValue(member.loyalty);
  // Accept only the two supported formulas and retain the original default.
  const formula =
    game.settings.get(MODULE_ID, "loyaltyCheckDie") === "1d10" ? "1d10" : "1d6";
  const roll = await new Roll(formula).evaluate();
  const success = roll.total < member.loyalty;
  // The result is informational: no Loyalty, assignment, or Actor state is changed.
  await ChatMessage.create({
    speaker: { actor: exec.id, alias: exec.name },
    whisper: activityRollRecipients(exec),
    rolls: [roll],
    content: rollCard({
      title: "Loyalty Check",
      subject: actor.name,
      outcome: success ? "SUCCESS" : "FAILURE",
      success,
      check: {
        total: roll.total,
        dv: member.loyalty,
        label: formula + " · Roll under Loyalty",
        targetLabel: "< Loyalty",
      },
    }),
  });
  return { total: roll.total, success };
}
export function teammatePanel(execId: string) {
  const actor = game.actors.get(execId);
  if (!actor || !isExec(actor)) return { visible: false, slots: [] };
  const slots = readSlots(execId);
  return {
    visible: true,
    slots: [0, 1, 2].flatMap((index) => {
      const member = slots[index],
        linked = member && game.actors.get(member.actorId);
      // Hide inaccessible roster members, including their names, portraits and Loyalty.
      if (
        linked &&
        (!game.user ||
          (!game.user.isGM &&
            !linked.testUserPermission(game.user, "OBSERVER")))
      )
        return [];
      return {
        index,
        number: index + 1,
        occupied: !!member,
        name: linked?.name ?? member?.actorName,
        // Resolve portraits from the Actor so later image changes appear automatically.
        img: linked?.img ?? "icons/svg/mystery-man.svg",
        loyalty: member?.loyalty,
        missing: !!member && !linked,
        canOpen:
          !!linked &&
          !!game.user &&
          (game.user.isGM || linked.testUserPermission(game.user, "OBSERVER")),
      };
    }),
  };
}
function promptTeammate(
  title: string,
  content: string,
  apply: (root: HTMLElement) => Promise<void>,
  refresh: () => void,
) {
  new Dialog({
    title,
    content,
    buttons: {
      save: {
        label: "Save",
        callback: (html) => {
          const root = html[0];
          if (!root) return;
          void apply(root)
            .then(refresh)
            .catch((error) => ui.notifications.error(String(error)));
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "cancel",
  }).render(true);
}
export function bindTeammates(
  root: HTMLElement,
  execId: string,
  refresh: () => void,
) {
  root
    .querySelectorAll<HTMLButtonElement>("[data-team-action]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const slot = Number(button.dataset.slot),
          action = button.dataset.teamAction;
        const member = readSlots(execId)[slot];
        if (action === "open" && member) {
          game.actors.get(member.actorId)?.sheet?.render(true);
          return;
        }
        if (action === "add") {
          const choices = teammateCandidates(execId);
          if (!choices.length) {
            ui.notifications.info(
              "No available teammate Actors. The GM can grant access to an existing Actor.",
            );
            return;
          }
          promptTeammate(
            "Add Teammate",
            '<div class="form-group"><label>Actor</label><select name="teammate"><option value="">Choose Actor</option>' +
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
              '</select></div><div class="form-group"><label>Initial Loyalty</label><input name="loyalty" type="number" step="1" required></div>',
            async (r) => {
              const value =
                r.querySelector<HTMLInputElement>('[name="loyalty"]')!.value;
              if (!value.trim()) throw new Error("Enter initial Loyalty.");
              await linkTeammate(
                execId,
                slot,
                r.querySelector<HTMLSelectElement>('[name="teammate"]')!.value,
                Number(value),
              );
            },
            refresh,
          );
          return;
        }
        if (action === "adjust" && member) {
          promptTeammate(
            "Adjust Loyalty",
            '<div class="form-group"><label>Loyalty</label><input name="loyalty" type="number" step="1" value="' +
              member.loyalty +
              '"></div><div class="form-group"><label>Reason</label><input name="reason" type="text" required></div>',
            async (r) => {
              const value =
                r.querySelector<HTMLInputElement>('[name="loyalty"]')!.value;
              if (!value.trim()) throw new Error("Enter Loyalty.");
              await changeLoyalty(
                execId,
                slot,
                Number(value),
                r.querySelector<HTMLInputElement>('[name="reason"]')!.value,
              );
            },
            refresh,
          );
          return;
        }
        if (action === "remove") {
          promptTeammate(
            "Remove Teammate",
            "<p>Remove this roster link? The Actor and Loyalty history will remain.</p>",
            async () => removeTeammate(execId, slot),
            refresh,
          );
          return;
        }
        if (action === "roll") {
          button.disabled = true;
          void rollLoyalty(execId, slot)
            .catch((error) => ui.notifications.error(String(error)))
            .finally(() => {
              button.disabled = false;
            });
        }
      }),
    );
}
