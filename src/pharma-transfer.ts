import { rollCard } from "./roll-card";
import { MODULE_ID } from "./constants";
import {
  isCrewActor,
  accessibleCrewActors,
  excludedActorIds,
} from "./actor-policy";
import { medtechRole } from "./medtech-system";
import { pharmaceuticalInventory, isPharmaceutical } from "./pharmaceuticals";
import {
  actorPayoutJournal,
  actorPayoutRecords,
  recordPage,
  writeRecord,
} from "./journal-records";
import { queueAction, isPrimaryGM } from "./action-coordinator";
import { getCampaignDate } from "./calendar";

interface PharmaTransfer {
  id: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  senderId: string;
  itemId: string;
  itemName: string;
  amount: number;
  date: string;
  item?: Record<string, unknown>;
  status:
    | "withdrawing"
    | "offered"
    | "receiving"
    | "rejected"
    | "consumed"
    | "returning"
    | "returned";
  direction: "sent" | "received";
  // Both Journal outcomes have been verified; survives pruning the other side.
  settled?: boolean;
}
const KEY = "pharmaTransfers";
function records(actorId: string): PharmaTransfer[] {
  return actorPayoutRecords<PharmaTransfer>(actorId, KEY);
}
function prepared(actor: FoundryActor) {
  const journal = actorPayoutJournal(actor.id);
  if (!journal)
    throw new Error(
      actor.name +
        " needs a Crew Tools character Journal prepared by a GM first.",
    );
  return journal;
}
async function save(actor: FoundryActor, rows: PharmaTransfer[]) {
  await writeRecord(
    prepared(actor),
    KEY,
    "Administer Pharma",
    rows.map(({ item, ...receipt }) =>
      ["consumed", "returned"].includes(receipt.status) ||
      (receipt.direction === "received" && receipt.status === "rejected")
        ? receipt
        : { ...receipt, item },
    ),
    "Sent and received doses share this table. Sent doses leave inventory when offered. The recipient uses or rejects them in chat. Transfers are identified by ID; Actor IDs identify sender and recipient. Interrupted withdrawals or deliveries must be checked before retrying. Item data stays here until delivery.",
  );
}
function owner(actor: FoundryActor) {
  if (!game.user || !actor.testUserPermission(game.user, "OWNER"))
    throw new Error("You do not own this character.");
}
function targets(sourceId: string) {
  const actors = Array.from(game.actors);
  const excluded = excludedActorIds(actors);
  const players = Array.from(game.users).filter((user) => !user.isGM);
  return actors
    .filter(
      (actor) =>
        actor.id !== sourceId &&
        actor.type === "character" &&
        !excluded.has(actor.id) &&
        players.some((user) => actor.testUserPermission(user, "OWNER")),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
// Chat display needs only one status, not a detached copy of every saved Item payload.
function transferStatus(
  actorId: string,
  id: string,
): Pick<PharmaTransfer, "status"> | undefined {
  const rows = recordPage(actorPayoutJournal(actorId), KEY)?.getFlag?.(
    MODULE_ID,
    "data",
  );
  const transfer = Array.isArray(rows)
    ? rows.find((row: PharmaTransfer) => row.id === id)
    : undefined;
  return transfer ? { status: transfer.status } : undefined;
}
type PharmaChoice = "reject" | "consume";
// Build once per operation, preserving the first valid owner response for each transfer.
function responseLookup(offers?: Map<string, FoundryChatMessage[]>) {
  const answers = new Map<string, PharmaChoice>();
  for (const message of game.messages) {
    const offer =
      offers &&
      (message.getFlag(MODULE_ID, "pharmaOffer") as PharmaTransfer | undefined);
    if (offers && offer?.item) {
      const key = offer.sourceId + ":" + offer.id;
      const list = offers.get(key) ?? [];
      list.push(message);
      offers.set(key, list);
    }
    const receipt = message.getFlag(MODULE_ID, "pharmaResponse") as
      { id?: string; targetId?: string; choice?: PharmaChoice } | undefined;
    if (
      !receipt?.id ||
      !receipt.targetId ||
      !["reject", "consume"].includes(receipt.choice ?? "")
    )
      continue;
    const key = receipt.targetId + ":" + receipt.id;
    if (
      !answers.has(key) &&
      message.author &&
      game.actors
        .get(receipt.targetId)
        ?.testUserPermission(message.author, "OWNER")
    )
      answers.set(key, receipt.choice!);
  }
  return answers;
}
// Rendering reuses this index; inventory/receipt operations still read fresh history.
let renderAnswers: Map<string, PharmaChoice> | undefined;
function invalidateRenderAnswers(): void {
  renderAnswers = undefined;
}
function renderResponseLookup() {
  return (renderAnswers ??= responseLookup());
}
function response(t: PharmaTransfer, answers = responseLookup()) {
  return answers.get(t.targetId + ":" + t.id);
}
// Maintenance waits for a sole GM so no other client can rewrite these shared arrays.
function canPurgePharma(): boolean {
  return (
    isPrimaryGM() &&
    !Array.from(game.users).some((u) => u.active && u.id !== game.user!.id)
  );
}
function transferKey(
  t: Pick<PharmaTransfer, "sourceId" | "targetId" | "id">,
): string {
  return t.sourceId + ":" + t.targetId + ":" + t.id;
}
function completedTransfer(t: PharmaTransfer): boolean {
  return t.direction === "sent"
    ? t.status === "consumed" || t.status === "returned"
    : t.status === "consumed" || t.status === "rejected";
}
export function purgePharmaHistory(
  keep: number,
  actorId = "",
  verify?: () => void,
): Promise<void> {
  return queueAction(() => {
    verify?.();
    return purgeCompletedPharma(keep, actorId);
  });
}
async function purgeCompletedPharma(
  keep: number,
  actorId: string,
): Promise<void> {
  if (!Number.isSafeInteger(keep) || keep < 0)
    throw new Error("Keep records must be a non-negative whole number.");
  if (!canPurgePharma())
    throw new Error(
      "Only the primary GM can purge; have other users disconnect first.",
    );
  const ledgers = Array.from(game.actors)
    .filter(
      (actor) => actor.type === "character" && actorPayoutJournal(actor.id),
    )
    .map((actor) => ({ actor, rows: records(actor.id) }));
  const sent = new Map<string, PharmaTransfer>();
  const received = new Map<string, PharmaTransfer>();
  for (const { actor, rows } of ledgers)
    for (const t of rows) {
      if (t.direction === "sent" && t.sourceId === actor.id)
        sent.set(transferKey(t), t);
      if (t.direction === "received" && t.targetId === actor.id)
        received.set(transferKey(t), t);
    }
  const settled = new Set<string>();
  for (const [key, source] of sent) {
    const target = received.get(key);
    if (
      target &&
      source.itemId === target.itemId &&
      source.amount === target.amount &&
      ((source.status === "consumed" && target.status === "consumed") ||
        (source.status === "returned" && target.status === "rejected"))
    )
      settled.add(key);
  }
  // Persist proof on both sides before deleting anything. An offline/missing peer
  // or interrupted outcome never qualifies just because one row says completed.
  for (const { actor, rows } of ledgers) {
    let changed = false;
    for (const t of rows)
      if (!t.settled && settled.has(transferKey(t))) {
        t.settled = true;
        changed = true;
      }
    if (changed) {
      if (!canPurgePharma())
        throw new Error(
          "Cleanup stopped because another user connected. Refresh and retry.",
        );
      await save(actor, rows);
    }
  }
  const purge = new Set<string>();
  for (const { actor, rows } of ledgers) {
    if (actorId && actor.id !== actorId) continue;
    const completed = rows.filter((t) => t.settled && completedTransfer(t));
    for (const t of completed.slice(0, Math.max(0, completed.length - keep)))
      purge.add(transferKey(t));
  }
  if (!purge.size) return;
  const responseKeys = new Set<string>();
  for (const { rows } of ledgers)
    for (const t of rows)
      if (purge.has(transferKey(t))) responseKeys.add(t.targetId + ":" + t.id);
  // Remove every copy of an old offer before removing its anti-repeat receipt.
  // A failed deletion leaves the Journals intact for a later maintenance pass.
  for (const message of Array.from(game.messages)) {
    const offer = message.getFlag(MODULE_ID, "pharmaOffer") as
      PharmaTransfer | undefined;
    const response = message.getFlag(MODULE_ID, "pharmaResponse") as
      { id: string; targetId: string } | undefined;
    if (
      (offer && purge.has(transferKey(offer))) ||
      (response && responseKeys.has(response.targetId + ":" + response.id))
    ) {
      if (!canPurgePharma())
        throw new Error(
          "Cleanup stopped because another user connected. Refresh and retry.",
        );
      await message.delete();
      invalidateRenderAnswers();
    }
  }
  for (const { actor } of ledgers) {
    if (actorId && actor.id !== actorId) continue;
    if (!canPurgePharma())
      throw new Error(
        "Cleanup stopped because another user connected. Refresh and retry.",
      );
    const rows = records(actor.id);
    let remainingCompleted = rows.filter(
      (t) => t.settled && completedTransfer(t),
    ).length;
    const remaining = rows.filter((t) => {
      if (
        remainingCompleted > keep &&
        t.settled &&
        completedTransfer(t) &&
        purge.has(transferKey(t))
      ) {
        remainingCompleted--;
        return false;
      }
      return true;
    });
    if (remaining.length !== rows.length) await save(actor, remaining);
  }
}
// Each owner updates only their own inventory and Journal; rejected doses wait safely while offline.
export function reconcilePharmaResponses() {
  return queueAction(async () => {
    const offers = new Map<string, FoundryChatMessage[]>();
    const answers = responseLookup(offers);
    for (const source of accessibleCrewActors()) {
      const rows = records(source.id);
      for (const t of rows) {
        if (t.direction !== "sent") continue;
        if (["consumed", "returned"].includes(t.status)) {
          await compactOffers(t, offers.get(t.sourceId + ":" + t.id) ?? []);
          continue;
        }
        if (t.status !== "offered") continue;
        const choice = response(t, answers);
        if (!choice) continue;
        if (choice === "reject") {
          if (!t.item)
            throw new Error("Returned doses are missing their Item data.");
          t.status = "returning";
          await save(source, rows);
          const created = await source.createEmbeddedDocuments(
            "Item",
            [
              {
                ...structuredClone(t.item),
                _id: t.id,
                system: { ...(t.item.system as object), amount: t.amount },
              },
            ],
            { keepId: true, CPRsplitStack: true },
          );
          if (created.length !== 1)
            throw new Error("Returned doses need review in Administer Pharma.");
          t.status = "returned";
        } else t.status = "consumed";
        await save(source, rows);
        await compactOffers(t, offers.get(t.sourceId + ":" + t.id) ?? []);
      }
    }
  });
}
// Keep snapshots until delivery or refund commits; only authors/GMs edit chat.
async function compactOffers(
  t: PharmaTransfer,
  messages: FoundryChatMessage[],
) {
  for (const message of messages) {
    const offer = message.getFlag(MODULE_ID, "pharmaOffer") as PharmaTransfer;
    if (
      offer.id !== t.id ||
      offer.sourceId !== t.sourceId ||
      offer.targetId !== t.targetId ||
      !offer.item
    )
      continue;
    if (!game.user?.isGM && message.author?.id !== game.user?.id) continue;
    try {
      await message.update({
        ["flags." + MODULE_ID + ".pharmaOffer.-=item"]: null,
      });
    } catch (error) {
      console.warn(
        "Crew Tools: completed Pharma chat could not be compacted",
        error,
      );
    }
  }
}
async function postOffer(t: PharmaTransfer) {
  const source = game.actors.get(t.sourceId),
    target = game.actors.get(t.targetId);
  if (!source || !target)
    throw new Error("Transfer character no longer exists.");
  const whisper = Array.from(game.users)
    .filter(
      (u) =>
        u.isGM ||
        source.testUserPermission(u, "OWNER") ||
        target.testUserPermission(u, "OWNER"),
    )
    .map((u) => u.id);
  await ChatMessage.create({
    user: game.user!.id,
    speaker: { actor: source.id, alias: source.name },
    whisper,
    flags: { [MODULE_ID]: { pharmaOffer: t } },
    content: rollCard({
      title: "Administer Pharma",
      subject: t.itemName + " × " + t.amount,
      detail: "To " + target.name,
      outcome: "OFFERED",
      success: true,
      tone: "neutral",
      actions: [
        { action: "consume", label: "Use Now" },
        { action: "reject", label: "Reject" },
      ],
    }),
  });
}
export function offerPharma(
  sourceId: string,
  itemId: string,
  targetId: string,
  amount: number,
) {
  return queueAction(async () => {
    const source = accessibleCrewActors().find((a) => a.id === sourceId),
      target = targets(sourceId).find((a) => a.id === targetId);
    if (!source || !medtechRole(source))
      throw new Error("Choose an owned Medtech character.");
    owner(source);
    if (!target) throw new Error("Choose another player-controlled character.");
    prepared(source);
    prepared(target);
    const item = Array.from(source.items ?? []).find((i) => i.id === itemId);
    const available = (item?.system as { amount?: number })?.amount;
    if (
      !item ||
      !isPharmaceutical(item) ||
      !Number.isSafeInteger(available) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > available!
    )
      throw new Error("Choose an available number of pharmaceutical doses.");
    const rows = records(source.id);
    if (rows.some((r) => r.status === "withdrawing" && r.itemId === itemId))
      throw new Error(
        "This item's interrupted transfer needs review in the Administer Pharma Journal page.",
      );
    const data = structuredClone(item.toObject());
    delete data._id;
    delete data._stats;
    data.system = { ...(data.system as object), amount };
    const transfer: PharmaTransfer = {
      id: foundry.utils.randomID(16),
      sourceId,
      sourceName: source.name,
      targetId,
      targetName: target.name,
      senderId: game.user!.id,
      itemId,
      itemName: item.name,
      amount,
      item: data,
      date: getCampaignDate(),
      status: "withdrawing",
      direction: "sent",
    };
    // Persist the intent before touching inventory; never automatically repeat an uncertain withdrawal.
    rows.push(transfer);
    await save(source, rows);
    if (amount === available)
      await source.deleteEmbeddedDocuments("Item", [item.id]);
    else {
      if (!item.update) throw new Error("Native Item updates are unavailable.");
      await item.update({ "system.amount": available! - amount });
    }
    transfer.status = "offered";
    await save(source, rows);
    await postOffer(transfer);
  });
}
async function postResponse(
  target: FoundryActor,
  source: FoundryActor,
  t: PharmaTransfer,
  choice: PharmaChoice,
) {
  await ChatMessage.create({
    user: game.user!.id,
    speaker: { actor: target.id, alias: target.name },
    whisper: Array.from(game.users)
      .filter(
        (u) =>
          u.isGM ||
          source.testUserPermission(u, "OWNER") ||
          target.testUserPermission(u, "OWNER"),
      )
      .map((u) => u.id),
    flags: {
      [MODULE_ID]: {
        pharmaResponse: { id: t.id, targetId: target.id, choice },
      },
    },
    content: rollCard({
      title: "Administer Pharma",
      subject: t.itemName + " × " + (choice === "consume" ? 1 : t.amount),
      detail: "From " + source.name,
      outcome: choice === "reject" ? "REJECTED" : "USED",
      success: choice === "consume",
      ...(choice === "reject" ? { tone: "neutral" as const } : {}),
    }),
  });
}
export function respondToPharma(
  message: FoundryChatMessage,
  choice: PharmaChoice = "consume",
) {
  return queueAction(async () => {
    if (!Array.from(game.messages).includes(message))
      throw new Error("This pharmaceutical offer is no longer available.");
    if (!["reject", "consume"].includes(choice))
      throw new Error("Choose Use Now or Reject.");
    const offer = message.getFlag(MODULE_ID, "pharmaOffer") as
      PharmaTransfer | undefined;
    if (
      !offer ||
      offer.status !== "offered" ||
      !/^[a-zA-Z0-9]{16}$/.test(offer.id)
    )
      throw new Error("Invalid pharmaceutical offer.");
    const source = game.actors.get(offer.sourceId),
      target = game.actors.get(offer.targetId);
    if (
      !source ||
      !target ||
      !isCrewActor(target) ||
      !message.author ||
      !source.testUserPermission(message.author, "OWNER")
    )
      throw new Error("This transfer is no longer available.");
    owner(target);
    prepared(target);
    const rows = records(target.id),
      existing = rows.find((r) => r.id === offer.id);
    if (existing) {
      const previous =
        existing.status === "rejected"
          ? "reject"
          : existing.status === "consumed"
            ? "consume"
            : undefined;
      if (!previous)
        throw new Error(
          "Check this interrupted delivery in the Administer Pharma Journal page before retrying.",
        );
      if (choice !== previous)
        throw new Error("This transfer was already answered.");
      if (!response(offer))
        await postResponse(target, source, existing, previous);
      return;
    }
    if (
      !offer.item ||
      !Number.isSafeInteger(offer.amount) ||
      offer.amount < 1 ||
      !isPharmaceutical(offer.item as unknown as FoundryItem)
    )
      throw new Error("Invalid pharmaceutical doses.");
    const received: PharmaTransfer = {
      ...structuredClone(offer),
      direction: "received",
      status: "receiving",
    };
    // Record the delivery before changing inventory; repeat clicks read this same row.
    rows.push(received);
    await save(target, rows);
    let completedChoice = choice;
    if (choice !== "reject") {
      // A fixed native Item ID prevents concurrent owners from creating the same delivery twice.
      const data = {
        ...structuredClone(offer.item),
        _id: offer.id,
        system: { ...(offer.item.system as object), amount: offer.amount },
      };
      const created = await target.createEmbeddedDocuments("Item", [data], {
        keepId: true,
        CPRsplitStack: true,
      });
      if (created.length !== 1)
        throw new Error(
          "Delivery could not be confirmed. Check Administer Pharma before retrying.",
        );
      const item = created[0]!;
      if (!item.snort)
        throw new Error("Native drug consumption is unavailable.");
      await item.snort();
      // Cancelling native use returns the delivery through the rejection flow.
      if ((item.system as { amount: number }).amount >= offer.amount) {
        await target.deleteEmbeddedDocuments("Item", [item.id]);
        completedChoice = "reject";
      }
    }
    received.status = completedChoice === "reject" ? "rejected" : "consumed";
    await save(target, rows);
    try {
      await postResponse(target, source, received, completedChoice);
    } catch {
      ui.notifications.warn(
        "The choice was recorded, but its chat receipt could not be posted. Reopen the offer to notify the sender.",
      );
    }
  });
}
export class PharmaTransferPanel {
  actorId = "";
  recipientId = "";
  private busy = false;
  getData(actorId: string) {
    if (actorId !== this.actorId) {
      this.actorId = actorId;
      this.recipientId = "";
    }
    const actor = accessibleCrewActors().find((a) => a.id === this.actorId);
    if (!actor || !medtechRole(actor))
      return { pharma: [], recipients: [], pending: [] };
    const answers = renderResponseLookup();
    return {
      actorName: actor.name,
      pharma: pharmaceuticalInventory(actor),
      recipients: targets(actor.id).map((a) => ({
        id: a.id,
        name: a.name,
        selected: a.id === this.recipientId,
      })),
      pending: records(actor.id).filter(
        (r) =>
          r.direction === "sent" &&
          r.status === "offered" &&
          !response(r, answers),
      ),
    };
  }
  bind(root: HTMLElement, refresh: () => void): void {
    root
      ?.querySelector<HTMLSelectElement>('[name="recipientId"]')
      ?.addEventListener("change", (event) => {
        this.recipientId = (event.target as HTMLSelectElement).value;
      });
    root
      ?.querySelectorAll<HTMLButtonElement>(
        "[data-transfer-pharma], [data-show-pharma-offer]",
      )
      .forEach((button) => {
        if (this.busy) button.disabled = true;
        button.addEventListener("click", () => {
          if (this.busy) return;
          this.busy = true;
          button.disabled = true;
          const id = button.dataset.transferPharma;
          const run = id
            ? offerPharma(this.actorId, id, this.recipientId, 1)
            : this.showOffer(button.dataset.showPharmaOffer!);
          void run
            .then(() =>
              ui.notifications.info(
                "Pharmaceutical offer sent. The recipient can use or reject it in chat.",
              ),
            )
            .catch((e) => ui.notifications.error(String(e)))
            .finally(() => {
              this.busy = false;
              refresh();
            });
        });
      });
  }
  private async showOffer(id: string) {
    const actor = game.actors.get(this.actorId);
    if (!actor) return;
    owner(actor);
    const t = records(actor.id).find(
      (r) => r.id === id && r.status === "offered",
    );
    if (t && !response(t)) await postOffer(t);
  }
}
export function registerPharmaTransfers(): void {
  invalidateRenderAnswers();
  // Any chat mutation may add, edit or remove a response (including its author).
  for (const hook of [
    "createChatMessage",
    "updateChatMessage",
    "deleteChatMessage",
  ] as const)
    Hooks.on(hook, invalidateRenderAnswers);
  // Valid responses depend on the author's current ownership/GM role.
  Hooks.on("updateActor", (_actor, changes) => {
    if (
      Object.keys(changes).some(
        (key) => key === "ownership" || key.startsWith("ownership."),
      )
    )
      invalidateRenderAnswers();
  });
  Hooks.on("createActor", invalidateRenderAnswers);
  Hooks.on("deleteActor", invalidateRenderAnswers);
  Hooks.on("updateUser", invalidateRenderAnswers);
  Hooks.on("deleteUser", invalidateRenderAnswers);
  Hooks.on("userConnected", () => {
    void reconcilePharmaResponses().catch((e) =>
      ui.notifications.error(String(e)),
    );
  });
  Hooks.once("ready", () => {
    invalidateRenderAnswers();
    void reconcilePharmaResponses().catch((e) =>
      ui.notifications.error(String(e)),
    );
  });
  Hooks.on("createChatMessage", (message) => {
    if (message.getFlag(MODULE_ID, "pharmaResponse"))
      void reconcilePharmaResponses().catch((e) =>
        ui.notifications.error(String(e)),
      );
  });
  Hooks.on("renderChatMessage", (message, html) => {
    const offer = message.getFlag(MODULE_ID, "pharmaOffer") as
      PharmaTransfer | undefined;
    if (!offer) return;
    const buttons = Array.from(
      html[0]?.querySelectorAll<HTMLButtonElement>(
        "[data-pharma-choice], [data-crew-action]",
      ) ?? [],
    ).filter((button) => {
      if (button.dataset.crewAction)
        button.dataset.pharmaChoice = button.dataset.crewAction;
      if (["consume", "reject"].includes(button.dataset.pharmaChoice ?? ""))
        return true;
      button.remove();
      return false;
    });
    if (!offer || !buttons?.length) return;
    const target = game.actors.get(offer.targetId);
    const canAccept =
      !!target && !!game.user && target.testUserPermission(game.user, "OWNER");
    const existing = canAccept
      ? transferStatus(offer.targetId, offer.id)
      : undefined;
    const answered = response(offer, renderResponseLookup());
    for (const button of buttons) {
      const previous =
        existing?.status === "rejected"
          ? "reject"
          : existing?.status === "consumed"
            ? "consume"
            : undefined;
      button.disabled =
        !canAccept ||
        !!answered ||
        (!!existing && button.dataset.pharmaChoice !== previous);
      button.addEventListener("click", () => {
        buttons.forEach((b) => {
          b.disabled = true;
        });
        void respondToPharma(
          message,
          button.dataset.pharmaChoice as PharmaChoice,
        )
          .then(() => {
            const status = records(offer.targetId).find(
              (r) => r.id === offer.id,
            )?.status;
            button.textContent =
              status === "rejected"
                ? "Rejected"
                : status === "consumed"
                  ? "Consumed"
                  : "Needs review";
          })
          .catch((e) => {
            ui.notifications.error(String(e));
          });
      });
    }
    if (existing || answered) {
      const label = document.createElement("p");
      label.textContent =
        existing?.status ?? (answered === "reject" ? "Rejected" : "Consumed");
      html[0]?.querySelector(".crewtools-pharma-offer")?.append(label);
    }
  });
}
