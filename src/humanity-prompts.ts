import { activityRollRecipients } from "./roll-visibility";
import { recordEscape as escapeHtml } from "./journal-format";
import { humanityUpdate } from "./actor-resources";
import { actorPayoutRecords, saveActorPayoutRecords } from "./journal-records";
import { isActorExcluded } from "./actor-policy";
import { MODULE_ID } from "./constants";
import { createUniqueId } from "./id";

export interface HumanityPrompt {
  actorId: string;
  actorName: string;
  userId: string;
  reward: "humanityGain" | "humanityLoss";
  formula: string;
  description: string;
}

export interface PendingHumanityRoll extends HumanityPrompt {
  id: string;
  payoutRecordId: string;
  createdAt: string;
  resolvedAt?: string;
  rollTotal?: number;
  previousHumanity?: number;
  newHumanity?: number;
}

export function createPendingHumanityRoll(
  prompt: HumanityPrompt,
  payoutRecordId: string,
): PendingHumanityRoll {
  return {
    ...prompt,
    id: createUniqueId(),
    payoutRecordId,
    createdAt: new Date().toISOString(),
  };
}

export function getPendingHumanityRolls(
  actor: FoundryActor,
): PendingHumanityRoll[] {
  const value = actorPayoutRecords<PendingHumanityRoll>(actor.id, "humanity");
  return Array.isArray(value)
    ? value
        .filter(isPromptFlags)
        .filter((entry) => !entry.resolvedAt)
        .map((entry) => structuredClone(entry))
    : [];
}

export async function clearAllPendingHumanityRolls(): Promise<number> {
  if (!game.user?.isGM)
    throw new Error("Only a GM can clear pending Humanity rolls.");
  // Cleanup only touches existing pending records; reading does not provision Journals.
  const actors = Array.from(game.actors).filter(
    (actor) => getPendingHumanityRolls(actor).length > 0,
  );
  const count = actors.reduce(
    (total, actor) => total + getPendingHumanityRolls(actor).length,
    0,
  );
  await Promise.all(
    actors.map((actor) =>
      saveActorPayoutRecords(
        actor,
        "humanity",
        actorPayoutRecords<PendingHumanityRoll>(actor.id, "humanity").filter(
          (entry) => entry.resolvedAt,
        ),
      ),
    ),
  );
  return count;
}

export function registerHumanityPromptHandler(): void {
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html[0];
    const button = root?.querySelector<HTMLButtonElement>(
      "[data-pneuma-crewtools-humanity-roll]",
    );
    if (!button) return;
    const reference = message.getFlag(MODULE_ID, "humanityPrompt") as
      { actorId?: string; id?: string } | undefined;
    const flags = reference?.actorId
      ? getPendingHumanityRollsForId(reference.actorId).find(
          (p) => p.id === reference.id,
        )
      : undefined;
    if (!flags || (!game.user?.isGM && game.user?.id !== flags.userId)) {
      button.disabled = true;
      return;
    }
    button.addEventListener(
      "click",
      () => void resolvePrompt(message, button, flags),
    );
  });
}

function getPendingHumanityRollsForId(actorId: string): PendingHumanityRoll[] {
  if (isActorExcluded(actorId))
    throw new Error("This Actor is excluded from Crew Tools.");
  const actor = game.actors.get(actorId);
  return actor ? getPendingHumanityRolls(actor) : [];
}

export async function createHumanityPrompt(
  prompt: PendingHumanityRoll,
): Promise<FoundryChatMessage> {
  const action = prompt.reward === "humanityGain" ? "gain" : "lose";
  const description = escapeHtml(
    prompt.description || "PneumaCrewTools payout",
  );
  return ChatMessage.create({
    user: prompt.userId,
    whisper: activityRollRecipients(
      game.actors.get(prompt.actorId),
      prompt.userId,
    ),
    content: `<div class="pneuma-crewtools-humanity-prompt"><p><strong>${escapeHtml(prompt.actorName)}</strong> must roll <strong>${prompt.formula}</strong> to ${action} Humanity.</p><p>${description}</p><button type="button" data-pneuma-crewtools-humanity-roll><i class="fas fa-dice-d6"></i> Roll Humanity</button></div>`,
    flags: {
      [MODULE_ID]: {
        humanityPrompt: { actorId: prompt.actorId, id: prompt.id },
      },
    },
  });
}

async function resolvePrompt(
  message: FoundryChatMessage,
  button: HTMLButtonElement,
  prompt: PendingHumanityRoll,
): Promise<void> {
  button.disabled = true;
  try {
    const result = await resolvePendingHumanityRoll(prompt.actorId, prompt.id);
    await message.update({
      content: resolvedContent(result),
      whisper: activityRollRecipients(
        game.actors.get(prompt.actorId),
        prompt.userId,
      ),
      [`flags.${MODULE_ID}.humanityPrompt.resolvedAt`]:
        new Date().toISOString(),
    });
  } catch (error) {
    button.disabled = false;
    ui.notifications.error(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export interface HumanityRollResult {
  prompt: PendingHumanityRoll;
  rollTotal: number;
  previousHumanity: number;
  newHumanity: number;
}

export async function resolvePendingHumanityRoll(
  actorId: string,
  rollId: string,
): Promise<HumanityRollResult> {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error("The payout Actor no longer exists.");
  const pendingRolls = getPendingHumanityRolls(actor);
  const prompt = pendingRolls.find(({ id }) => id === rollId);
  if (!prompt) throw new Error("This Humanity roll has already been resolved.");
  if (!game.user?.isGM && game.user?.id !== prompt.userId)
    throw new Error("This Humanity roll belongs to another player.");
  const roll = await new Roll(prompt.formula).evaluate();
  const humanity = readHumanity(actor);
  const signed = prompt.reward === "humanityGain" ? roll.total : -roll.total;
  const newValue = Math.min(humanity.max, humanity.value + signed);
  await actor.update(humanityUpdate(newValue));
  await saveActorPayoutRecords(
    actor,
    "humanity",
    actorPayoutRecords<PendingHumanityRoll>(actor.id, "humanity").map(
      (entry) =>
        entry.id === rollId
          ? {
              ...entry,
              resolvedAt: new Date().toISOString(),
              rollTotal: roll.total,
              previousHumanity: humanity.value,
              newHumanity: newValue,
            }
          : entry,
    ),
  );
  return {
    prompt,
    rollTotal: roll.total,
    previousHumanity: humanity.value,
    newHumanity: newValue,
  };
}

export function resolvedContent(result: HumanityRollResult): string {
  return `<div class="pneuma-crewtools-humanity-prompt pneuma-crewtools-humanity-prompt--resolved"><p><strong>${escapeHtml(result.prompt.actorName)}</strong> rolled <strong>${result.rollTotal}</strong> (${result.prompt.formula}).</p><p>Humanity: <strong>${result.previousHumanity} → ${result.newHumanity}</strong></p><p>${escapeHtml(result.prompt.description)}</p></div>`;
}

function readHumanity(actor: FoundryActor): { value: number; max: number } {
  const system = actor.system as Record<string, any>;
  const humanity = system.derivedStats?.humanity;
  if (
    !humanity ||
    !Number.isFinite(humanity.value) ||
    !Number.isFinite(humanity.max)
  )
    throw new Error("The Actor has invalid Humanity data.");
  return { value: humanity.value, max: humanity.max };
}

function isPromptFlags(value: unknown): value is PendingHumanityRoll {
  if (typeof value !== "object" || value === null) return false;
  const flags = value as Record<string, unknown>;
  return (
    typeof flags.actorId === "string" &&
    typeof flags.userId === "string" &&
    typeof flags.formula === "string" &&
    typeof flags.id === "string" &&
    typeof flags.payoutRecordId === "string"
  );
}

// New pending actions and completed results share the character Journal; Actors hold only native resources.
export async function appendPendingHumanityRolls(
  actor: FoundryActor,
  rolls: PendingHumanityRoll[],
): Promise<() => Promise<void>> {
  const before = actorPayoutRecords<PendingHumanityRoll>(actor.id, "humanity");
  await saveActorPayoutRecords(actor, "humanity", [...before, ...rolls]);
  return async () => saveActorPayoutRecords(actor, "humanity", before);
}
