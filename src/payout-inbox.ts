import { MODULE_ID, PAYOUT_ACKNOWLEDGMENTS_ENABLED_SETTING } from "./constants";
import { createUniqueId } from "./id";
import {
  clearAllPendingHumanityRolls,
  getPendingHumanityRolls,
  resolvePendingHumanityRoll,
  resolvedContent,
  type PendingHumanityRoll,
} from "./humanity-prompts";
import type { PayoutPlan } from "./payout-execution";

export interface PayoutAcknowledgment {
  id: string;
  payoutRecordId: string;
  sessionLabel: string;
  inGameDate?: string;
  userId: string;
  userName: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  acknowledgedAt: string | null;
  awards: PayoutAcknowledgmentAward[];
}

export interface PayoutAcknowledgmentAward {
  text: string;
  label?: string;
  value?: string;
  description?: string;
  img?: string;
  icon?: string;
}

interface InboxCard {
  id: string;
  sessionLabel: string;
  inGameDate: string;
  userName: string;
  actorName: string;
  createdAt: string;
  awards: PayoutAcknowledgmentAward[];
  pendingRolls: Array<PendingHumanityRoll & { actionLabel: string }>;
  pendingRollCount: number;
  statusLabel: string;
  statusClass: string;
  acknowledgmentId?: string;
  userId: string;
  expanded: boolean;
  showUserName: boolean;
}

interface InboxData {
  cards: InboxCard[];
  hasItems: boolean;
  isGM: boolean;
  gmActionsEnabled: boolean;
  hasPendingRolls: boolean;
  hasAcknowledgments: boolean;
}

let payoutInbox: PayoutInbox | null = null;

export function registerPayoutInboxSettings(): void {
  game.settings.register(MODULE_ID, PAYOUT_ACKNOWLEDGMENTS_ENABLED_SETTING, {
    name: "Require payout acknowledgment",
    hint: "Add completed payouts to each recipient's Payout Inbox until they confirm receipt. Acknowledgment does not approve or alter the payout.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

export function openPayoutInbox(): void {
  void pruneResolvedAcknowledgments()
    .catch(() =>
      ui.notifications.warn("Older Inbox entries could not be cleaned up."),
    )
    .finally(() => {
      if (!payoutInbox?.rendered) payoutInbox = new PayoutInbox();
      payoutInbox.render(true);
    });
}

export function hasInboxItemsForCurrentUser(): boolean {
  return (
    collectPendingRolls().length > 0 || collectAcknowledgments().length > 0
  );
}

export async function clearAllPayoutAcknowledgments(): Promise<number> {
  if (!game.user?.isGM)
    throw new Error("Only a GM can clear payout acknowledgments.");
  const users = Array.from(game.users);
  const count = users.reduce((total, user) => {
    const value = user.getFlag(MODULE_ID, "payoutAcknowledgments");
    return total + (Array.isArray(value) ? value.length : 0);
  }, 0);
  await Promise.all(
    users.map((user) =>
      user.update({ [`flags.${MODULE_ID}.payoutAcknowledgments`]: [] }),
    ),
  );
  return count;
}

export async function createPayoutAcknowledgments(
  payoutRecordId: string,
  plan: PayoutPlan,
): Promise<() => Promise<void>> {
  if (
    game.settings.get(MODULE_ID, PAYOUT_ACKNOWLEDGMENTS_ENABLED_SETTING) ===
    false
  )
    return async () => undefined;
  const snapshots: Array<{
    user: FoundryUser;
    entries: PayoutAcknowledgment[];
  }> = [];
  try {
    for (const { actor, participant } of plan.actors) {
      const user = Array.from(game.users).find(
        ({ id }) => id === participant.userId,
      );
      if (!user) continue;
      const entries = getAcknowledgments(user);
      snapshots.push({ user, entries });
      const retainedEntries = entries.filter(
        ({ acknowledgedAt }) => !acknowledgedAt,
      );
      await user.update({
        [`flags.${MODULE_ID}.payoutAcknowledgments`]: [
          ...retainedEntries,
          {
            id: createUniqueId(),
            payoutRecordId,
            sessionLabel: plan.sessionLabel,
            inGameDate: plan.inGameDate,
            userId: user.id,
            userName: user.name,
            actorId: actor.id,
            actorName: actor.name,
            createdAt: new Date().toISOString(),
            acknowledgedAt: null,
            awards: plan.changes
              .filter(({ targetId }) => targetId === actor.id)
              .map(formatPayoutChange),
          } satisfies PayoutAcknowledgment,
        ],
      });
    }
  } catch (error) {
    await rollbackAcknowledgments(snapshots);
    throw error;
  }
  return async () => rollbackAcknowledgments(snapshots);
}

class PayoutInbox extends FormApplication {
  #gmActionsEnabled = false;

  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: `${MODULE_ID}-inbox`,
      classes: [...(super.defaultOptions.classes ?? []), MODULE_ID],
      title: "Payout Inbox",
      template: `modules/${MODULE_ID}/templates/payout-inbox.hbs`,
      width: 650,
      height: "auto",
      resizable: true,
    };
  }

  override getData(): InboxData {
    const isGM = Boolean(game.user?.isGM);
    const pendingRolls = collectPendingRolls().map((roll) => ({
      ...roll,
      actionLabel:
        roll.reward === "humanityGain" ? "Gain Humanity" : "Lose Humanity",
    }));
    const cards = buildInboxCards(
      collectAcknowledgments(),
      pendingRolls,
      isGM,
    ).slice(0, 100);
    return {
      cards,
      hasItems: cards.length > 0,
      isGM,
      gmActionsEnabled: this.#gmActionsEnabled,
      hasPendingRolls: pendingRolls.length > 0,
      hasAcknowledgments: cards.some(
        ({ acknowledgmentId }) => acknowledgmentId,
      ),
    };
  }

  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    root
      .querySelectorAll<HTMLDetailsElement>("[data-inbox-expanded]")
      .forEach((card) => {
        card.open = card.dataset.inboxExpanded === "true";
      });
    const gmActionsToggle = root.querySelector<HTMLInputElement>(
      "[data-enable-gm-actions]",
    );
    const playerActionButtons = root.querySelectorAll<HTMLButtonElement>(
      "[data-player-inbox-action]",
    );
    const gmActionButtons = root.querySelectorAll<HTMLButtonElement>(
      "[data-gm-inbox-action]",
    );
    if (game.user?.isGM)
      playerActionButtons.forEach((button) => {
        button.disabled = !this.#gmActionsEnabled;
      });
    const syncGmButtons = () =>
      gmActionButtons.forEach((button) => {
        button.disabled =
          !this.#gmActionsEnabled || button.dataset.available !== "true";
      });
    syncGmButtons();
    if (gmActionsToggle) {
      gmActionsToggle.checked = this.#gmActionsEnabled;
      gmActionsToggle.addEventListener("change", (event) => {
        this.#gmActionsEnabled = (
          event.currentTarget as HTMLInputElement
        ).checked;
        playerActionButtons.forEach((button) => {
          button.disabled = !this.#gmActionsEnabled;
        });
        syncGmButtons();
      });
    }
    root
      .querySelectorAll<HTMLButtonElement>("[data-roll-id]")
      .forEach((button) =>
        button.addEventListener("click", () => void this.#rollHumanity(button)),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-ack-id]")
      .forEach((button) =>
        button.addEventListener("click", () => void this.#acknowledge(button)),
      );
    root
      .querySelector<HTMLButtonElement>("[data-acknowledge-all]")
      ?.addEventListener("click", () => void this.#acknowledgeAll());
    root
      .querySelector<HTMLButtonElement>("[data-roll-all]")
      ?.addEventListener("click", () => void this.#rollAll());
    root
      .querySelector<HTMLButtonElement>("[data-cancel-all-rolls]")
      ?.addEventListener("click", () => void this.#cancelAllRolls());
  }

  protected override async _updateObject(): Promise<void> {}

  async #rollHumanity(button: HTMLButtonElement): Promise<void> {
    if (!this.#playerActionAllowed()) return;
    const actorId = button.dataset.actorId;
    const rollId = button.dataset.rollId;
    if (!actorId || !rollId) return;
    button.disabled = true;
    try {
      const result = await resolvePendingHumanityRoll(actorId, rollId);
      await updateRelatedChatMessages(
        result.prompt.id,
        resolvedContent(result),
      );
      ui.notifications.info(
        `${result.prompt.actorName} Humanity: ${result.previousHumanity} → ${result.newHumanity}`,
      );
      this.render(true);
    } catch (error) {
      button.disabled = false;
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async #acknowledge(button: HTMLButtonElement): Promise<void> {
    if (!this.#playerActionAllowed()) return;
    const userId = button.dataset.userId;
    const acknowledgmentId = button.dataset.ackId;
    const user = userId
      ? Array.from(game.users).find(({ id }) => id === userId)
      : undefined;
    if (!user || !acknowledgmentId) return;
    if (!game.user?.isGM && game.user?.id !== user.id) {
      ui.notifications.error("This acknowledgment belongs to another player.");
      return;
    }
    const entries = getAcknowledgments(user);
    await user.update({
      [`flags.${MODULE_ID}.payoutAcknowledgments`]: entries.filter(
        ({ id, acknowledgedAt }) => id !== acknowledgmentId && !acknowledgedAt,
      ),
    });
    ui.notifications.info("Payout acknowledged.");
    this.render(true);
  }

  async #acknowledgeAll(): Promise<void> {
    if (!this.#gmBulkActionAllowed()) return;
    try {
      const count = await clearAllPayoutAcknowledgments();
      ui.notifications.info(
        count
          ? `${count} payout acknowledgment${count === 1 ? "" : "s"} cleared.`
          : "There are no payouts awaiting acknowledgment.",
      );
      this.render(true);
    } catch (error) {
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async #rollAll(): Promise<void> {
    if (!this.#gmBulkActionAllowed()) return;
    const rolls = collectPendingRolls();
    let resolved = 0;
    const failures: string[] = [];
    for (const roll of rolls) {
      try {
        const result = await resolvePendingHumanityRoll(roll.actorId, roll.id);
        await updateRelatedChatMessages(
          result.prompt.id,
          resolvedContent(result),
        );
        resolved += 1;
      } catch (error) {
        failures.push(
          `${roll.actorName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (resolved)
      ui.notifications.info(
        `${resolved} Humanity roll${resolved === 1 ? "" : "s"} resolved.`,
      );
    if (failures.length)
      ui.notifications.error(
        `${failures.length} Humanity roll${failures.length === 1 ? "" : "s"} failed: ${failures.join("; ")}`,
      );
    if (!rolls.length)
      ui.notifications.info("There are no pending Humanity rolls.");
    this.render(true);
  }

  async #cancelAllRolls(): Promise<void> {
    if (!this.#gmBulkActionAllowed() || !(await confirmCancelAllRolls()))
      return;
    try {
      const rolls = collectPendingRolls();
      const count = await clearAllPendingHumanityRolls();
      await Promise.allSettled(
        rolls.map(({ id }) =>
          updateRelatedChatMessages(
            id,
            '<div class="pneuma-crewtools-humanity-prompt"><p><strong>Cancelled:</strong> This pending Humanity roll was cancelled by the GM.</p></div>',
          ),
        ),
      );
      ui.notifications.info(
        count
          ? `${count} pending Humanity roll${count === 1 ? "" : "s"} cancelled.`
          : "There are no pending Humanity rolls.",
      );
      this.render(true);
    } catch (error) {
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  #gmBulkActionAllowed(): boolean {
    if (game.user?.isGM && this.#gmActionsEnabled) return true;
    ui.notifications.warn(
      "Enable GM controls at the top of the Inbox to use bulk actions.",
    );
    return false;
  }

  #playerActionAllowed(): boolean {
    if (!game.user?.isGM || this.#gmActionsEnabled) return true;
    ui.notifications.warn(
      "Enable GM controls at the top of the Inbox to act for a player.",
    );
    return false;
  }
}

function confirmCancelAllRolls(): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    new Dialog({
      title: "Cancel all pending Humanity rolls?",
      content:
        "<p>This permanently removes every pending Humanity roll without changing any Actor's Humanity.</p>",
      buttons: {
        cancelRolls: {
          icon: '<i class="fas fa-ban"></i>',
          label: "Cancel all rolls",
          callback: () => answer(true),
        },
        keep: { label: "Keep rolls", callback: () => answer(false) },
      },
      default: "keep",
      close: () => answer(false),
    }).render(true);
  });
}

function collectPendingRolls(): PendingHumanityRoll[] {
  return Array.from(game.actors).flatMap((actor) =>
    getPendingHumanityRolls(actor).filter(
      ({ userId }) => game.user?.isGM || game.user?.id === userId,
    ),
  );
}

function collectAcknowledgments(): PayoutAcknowledgment[] {
  return Array.from(game.users).flatMap((user) => {
    if (!game.user?.isGM && game.user?.id !== user.id) return [];
    return getAcknowledgments(user).filter(
      ({ acknowledgedAt }) => !acknowledgedAt,
    );
  });
}

function buildInboxCards(
  acknowledgments: PayoutAcknowledgment[],
  pendingRolls: Array<PendingHumanityRoll & { actionLabel: string }>,
  showUserName: boolean,
): InboxCard[] {
  const cards = new Map<string, InboxCard>();
  const keyFor = (payoutRecordId: string, userId: string, actorId: string) =>
    `${payoutRecordId}:${userId}:${actorId}`;

  for (const acknowledgment of acknowledgments) {
    const key = keyFor(
      acknowledgment.payoutRecordId,
      acknowledgment.userId,
      acknowledgment.actorId,
    );
    cards.set(key, {
      id: acknowledgment.id,
      sessionLabel: acknowledgment.sessionLabel || "Payout",
      inGameDate: acknowledgment.inGameDate?.trim() || "Date not recorded",
      userName: acknowledgment.userName,
      actorName: acknowledgment.actorName,
      createdAt: acknowledgment.createdAt,
      awards: acknowledgment.awards,
      pendingRolls: [],
      pendingRollCount: 0,
      statusLabel: "Ready to acknowledge",
      statusClass: "inbox-card--ready",
      acknowledgmentId: acknowledgment.id,
      userId: acknowledgment.userId,
      expanded: false,
      showUserName,
    });
  }

  for (const roll of pendingRolls) {
    const key = keyFor(roll.payoutRecordId, roll.userId, roll.actorId);
    const card = cards.get(key) ?? {
      id: roll.id,
      sessionLabel: "Payout",
      inGameDate: "Date not recorded",
      userName:
        Array.from(game.users).find(({ id }) => id === roll.userId)?.name ??
        "Player",
      actorName: roll.actorName,
      createdAt: roll.createdAt,
      awards: [],
      pendingRolls: [],
      pendingRollCount: 0,
      statusLabel: "",
      statusClass: "",
      userId: roll.userId,
      expanded: false,
      showUserName,
    };
    card.pendingRolls.push(roll);
    card.pendingRollCount = card.pendingRolls.length;
    card.statusLabel = `${card.pendingRollCount} Humanity roll${card.pendingRollCount === 1 ? "" : "s"} pending`;
    card.statusClass = "inbox-card--pending";
    cards.set(key, card);
  }

  const sorted = [...cards.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  if (sorted[0]) sorted[0].expanded = true;
  return sorted;
}

async function pruneResolvedAcknowledgments(): Promise<void> {
  const users = game.user?.isGM
    ? Array.from(game.users)
    : game.user
      ? [game.user]
      : [];
  await Promise.all(
    users.map(async (user) => {
      const entries = getAcknowledgments(user);
      const pending = entries.filter(({ acknowledgedAt }) => !acknowledgedAt);
      if (pending.length === entries.length) return;
      await user.update({
        [`flags.${MODULE_ID}.payoutAcknowledgments`]: pending,
      });
    }),
  );
}

function getAcknowledgments(user: FoundryUser): PayoutAcknowledgment[] {
  const value = user.getFlag(MODULE_ID, "payoutAcknowledgments");
  return Array.isArray(value)
    ? value.filter(isAcknowledgment).map((entry) => ({
        ...structuredClone(entry),
        awards: Array.isArray(entry.awards)
          ? entry.awards.map((award) =>
              typeof award === "string"
                ? { text: award, icon: iconForAwardText(award) }
                : isAcknowledgmentAward(award)
                  ? {
                      ...structuredClone(award),
                      icon:
                        award.icon ??
                        (award.img ? undefined : iconForAwardText(award.text)),
                    }
                  : { text: "Payout detail unavailable." },
            )
          : [
              {
                text: "Payout details unavailable for this older acknowledgment.",
              },
            ],
      }))
    : [];
}

async function rollbackAcknowledgments(
  snapshots: Array<{ user: FoundryUser; entries: PayoutAcknowledgment[] }>,
): Promise<void> {
  await Promise.allSettled(
    snapshots.map(({ user, entries }) =>
      user.update({ [`flags.${MODULE_ID}.payoutAcknowledgments`]: entries }),
    ),
  );
}

async function updateRelatedChatMessages(
  rollId: string,
  content: string,
): Promise<void> {
  const messages = Array.from(game.messages).filter((message) => {
    const prompt = message.getFlag(MODULE_ID, "humanityPrompt");
    return (
      typeof prompt === "object" &&
      prompt !== null &&
      (prompt as Record<string, unknown>).id === rollId
    );
  });
  await Promise.allSettled(
    messages.map((message) => message.update({ content })),
  );
}

function isAcknowledgment(value: unknown): value is PayoutAcknowledgment {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.payoutRecordId === "string" &&
    typeof entry.userId === "string" &&
    (entry.acknowledgedAt === null || typeof entry.acknowledgedAt === "string")
  );
}

function isAcknowledgmentAward(
  value: unknown,
): value is PayoutAcknowledgmentAward {
  if (typeof value !== "object" || value === null) return false;
  const award = value as Record<string, unknown>;
  return (
    typeof award.text === "string" &&
    (award.img === undefined || typeof award.img === "string") &&
    (award.icon === undefined || typeof award.icon === "string")
  );
}

function formatPayoutChange(
  change: PayoutPlan["changes"][number],
): PayoutAcknowledgmentAward {
  const labels: Record<string, string> = {
    money: "Money",
    ip: "IP",
    hqIp: "HQ IP",
    humanityGain: "Humanity Gain",
    humanityLoss: "Humanity Loss",
    reputation: "Reputation",
    factionReputation: "Specific Reputation",
    item: "Item",
    downtime: "Downtime",
  };
  const faction = String(change.details?.faction ?? "").trim();
  const description = String(change.details?.description ?? "").trim();
  const result =
    change.reward === "item"
      ? `×${change.amount}`
      : change.reward === "downtime"
        ? `${change.amount} ${Math.abs(change.amount) === 1 ? "day" : "days"}`
        : change.details?.pendingPlayerRoll
          ? `${String(change.details.formula)} — pending roll`
          : `${change.previousValue} → ${change.newValue} (${change.amount >= 0 ? "+" : ""}${change.amount})`;
  const label =
    change.reward === "item"
      ? `Item: ${String(change.details?.itemName ?? "Unknown")}`
      : `${labels[change.reward] ?? change.reward}${faction ? ` (${faction})` : ""}`;
  return {
    text: `${label}: ${result}${description ? ` — ${description}` : ""}`,
    label,
    value: result,
    description,
    ...(change.reward === "item" && typeof change.details?.img === "string"
      ? { img: change.details.img }
      : { icon: iconForReward(change.reward) }),
  };
}

function iconForReward(reward: string): string {
  return (
    {
      money: "fas fa-coins",
      ip: "fas fa-star",
      hqIp: "fas fa-building",
      humanityGain: "fas fa-heart",
      humanityLoss: "fas fa-heart-crack",
      reputation: "fas fa-medal",
      factionReputation: "fas fa-flag",
      downtime: "fas fa-clock",
      item: "fas fa-box-open",
    }[reward] ?? "fas fa-circle"
  );
}

function iconForAwardText(text: string): string {
  const label = text.split(":", 1)[0]?.trim().toLowerCase() ?? "";
  if (label.startsWith("money")) return iconForReward("money");
  if (label.startsWith("hq ip")) return iconForReward("hqIp");
  if (label === "ip") return iconForReward("ip");
  if (label.startsWith("humanity gain")) return iconForReward("humanityGain");
  if (label.startsWith("humanity loss")) return iconForReward("humanityLoss");
  if (label.startsWith("specific reputation"))
    return iconForReward("factionReputation");
  if (label.startsWith("reputation")) return iconForReward("reputation");
  if (label.startsWith("downtime")) return iconForReward("downtime");
  if (label.startsWith("item")) return iconForReward("item");
  return "fas fa-circle";
}
