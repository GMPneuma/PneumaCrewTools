import { MODULE_ID } from "./constants";
import {
  buildDiscordMarkdown,
  getDiscordLinks,
  isDiscordMarkdownEnabled,
  showDiscordSummary,
} from "./discord-summary";
import {
  executePayoutPlan,
  planActorChanges,
  type CharacterReward,
  type PayoutItem,
  type PayoutPlan,
  type RewardEntry,
} from "./payout-execution";
import { getPayoutJournalData } from "./payout-journal";
import { createUniqueId } from "./id";
import { getLastPayoutDate, saveLastPayoutDate } from "./payout-date";
import {
  getDefaultPayoutContainerId,
  getPayoutContainers,
} from "./payout-container";
import type { PayoutChange } from "./payout-record";
import {
  discoverPlayerAccounts,
  type PlayerAccount,
  type PlayerDiscoveryIssue,
} from "./player-discovery";

interface ActorOptionView {
  actorId: string;
  actorName: string;
  primary: boolean;
  selected: boolean;
  shared: boolean;
}

interface PlayerView {
  userId: string;
  userName: string;
  active: boolean;
  presenceClass: string;
  presenceLabel: string;
  selected: boolean;
  eligible: boolean;
  eligibilityClass: string;
  defaultActor: ActorOptionView | null;
  otherActors: ActorOptionView[];
  hasOtherActors: boolean;
  warningText: string;
}

interface PayoutWindowData {
  players: PlayerView[];
  playerCount: number;
  activePlayerCount: number;
  inGameDate: string;
  payoutContainers: Array<{ actorId: string; actorName: string }>;
  defaultPayoutContainerId: string;
}

const ISSUE_LABELS: Record<PlayerDiscoveryIssue, string> = {
  noAssignedActor: "No default character assigned.",
  noEligibleActors: "No owned character Actors are eligible for payout.",
  unsupportedAssignedActorType:
    "The assigned Actor is not a Cyberpunk RED character.",
  sharedActor: "One or more Actors are shared with another player.",
};

class PayoutValidationError extends Error {
  constructor(
    message: string,
    readonly field?: HTMLElement,
  ) {
    super(message);
  }
}

export class PayoutWindow extends FormApplication {
  #additionalEntryIndex = 0;
  #individualEntryIndex = 0;
  #plan: PayoutPlan | null = null;
  #submitting = false;
  #droppedItems = new Map<string, PayoutItem>();

  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: `${MODULE_ID}-window`,
      classes: [...(super.defaultOptions.classes ?? []), MODULE_ID],
      title: "PneumaCrewTools",
      template: `modules/${MODULE_ID}/templates/payout-window.hbs`,
      width: 900,
      height: 760,
      resizable: true,
      closeOnSubmit: false,
      submitOnChange: false,
    };
  }

  override getData(): PayoutWindowData {
    const accounts = discoverPlayerAccounts();
    return {
      players: accounts.map(toPlayerView),
      playerCount: accounts.length,
      activePlayerCount: accounts.filter(({ active }) => active).length,
      inGameDate: getLastPayoutDate(),
      payoutContainers: getPayoutContainers().map(({ id, name }) => ({
        actorId: id,
        actorName: name,
      })),
      defaultPayoutContainerId: getDefaultPayoutContainerId(),
    };
  }

  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);

    const root = html[0];
    if (!root) return;

    root.addEventListener("click", (event) => this.#openActorLink(event));
    root.addEventListener("dragover", (event) => this.#allowItemDrop(event));
    root.addEventListener("drop", (event) => void this.#handleItemDrop(event));

    this.#initializeSelection(root);
    this.#initializePayoutContainer(root);
    root
      .querySelector<HTMLInputElement>('[name="inGameDate"]')
      ?.addEventListener("change", (event) => {
        const input = event.currentTarget as HTMLInputElement;
        void saveLastPayoutDate(input.value).catch(() =>
          ui.notifications.warn("The default in-game date could not be saved."),
        );
      });

    root
      .querySelectorAll<HTMLInputElement>("[data-user-toggle]")
      .forEach((input) =>
        input.addEventListener("change", () => {
          this.#syncUserRow(input);
          this.#updateSelectionSummary(root);
        }),
      );

    root
      .querySelectorAll<HTMLInputElement>("[data-actor-toggle]")
      .forEach((input) =>
        input.addEventListener("change", () => {
          if (input.checked) {
            this.#selectOnlyActorInRow(input);
            this.#deduplicateActor(root, input);
          }
          this.#updateSelectionSummary(root);
        }),
      );

    root
      .querySelectorAll<HTMLButtonElement>("[data-show-other-actors]")
      .forEach((button) =>
        button.addEventListener("click", () => this.#toggleOtherActors(button)),
      );

    root
      .querySelector<HTMLButtonElement>("[data-next-step]")
      ?.addEventListener("click", () => this.#goToRewards(root));
    root
      .querySelector<HTMLButtonElement>("[data-previous-step]")
      ?.addEventListener("click", () => this.#showStep(root, "participants"));
    root
      .querySelector<HTMLButtonElement>("[data-preview-step]")
      ?.addEventListener("click", () => void this.#goToPreview(root));
    root
      .querySelector<HTMLButtonElement>("[data-preview-back]")
      ?.addEventListener("click", () => this.#showStep(root, "rewards"));
    root
      .querySelector<HTMLButtonElement>("[data-apply-payout]")
      ?.addEventListener("click", () => void this.#applyPayout(root));

    root.addEventListener("input", (event) => {
      this.#plan = null;
      const target = event.target;
      if (target instanceof HTMLElement) this.#clearFieldError(target);
      if (
        target instanceof HTMLInputElement &&
        target.matches("[data-entry-amount]") &&
        target.closest(".payout-entry--two-digit")
      )
        target.value = target.value.replace(/\D/g, "").slice(0, 2);
    });

    root
      .querySelector<HTMLButtonElement>("[data-add-entry]")
      ?.addEventListener("click", () => this.#addAdditionalEntry(root));
    root
      .querySelector<HTMLElement>("[data-additional-entries]")
      ?.addEventListener("click", (event) => this.#removeEntry(event));
    root
      .querySelector<HTMLElement>("[data-additional-entries]")
      ?.addEventListener("change", (event) => this.#syncEntryControls(event));
    root
      .querySelector<HTMLElement>("[data-communal-item-drop]")
      ?.addEventListener("click", (event) => this.#removeEntry(event));

    root
      .querySelector<HTMLElement>("[data-individual-payouts]")
      ?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const addButton = target.closest<HTMLButtonElement>(
          "[data-add-individual-entry]",
        );
        if (addButton) this.#addIndividualEntry(root, addButton);
        else this.#removeEntry(event);
      });
    root
      .querySelector<HTMLElement>("[data-individual-payouts]")
      ?.addEventListener("change", (event) => this.#syncEntryControls(event));

    this.#updateSelectionSummary(root);
  }

  protected override async _updateObject(
    _event: Event,
    _formData: Record<string, unknown>,
  ): Promise<void> {
    // Reward fields and preview are introduced in the next roadmap items.
  }

  #initializeSelection(root: HTMLElement): void {
    root
      .querySelectorAll<HTMLInputElement>("[data-user-toggle]")
      .forEach((userToggle) => {
        userToggle.checked = userToggle.dataset.selected === "true";
        userToggle.disabled = userToggle.dataset.eligible !== "true";
      });

    root
      .querySelectorAll<HTMLInputElement>("[data-actor-toggle]")
      .forEach((actorToggle) => {
        actorToggle.checked = actorToggle.dataset.selected === "true";
        const row = actorToggle.closest<HTMLElement>("[data-player-row]");
        const userToggle =
          row?.querySelector<HTMLInputElement>("[data-user-toggle]");
        actorToggle.disabled = !userToggle?.checked;
      });

    const selectedActorIds = new Set<string>();
    root
      .querySelectorAll<HTMLInputElement>("[data-actor-toggle]:checked")
      .forEach((actorToggle) => {
        const actorId = actorToggle.dataset.actorId;
        if (!actorId) return;
        if (selectedActorIds.has(actorId)) actorToggle.checked = false;
        else selectedActorIds.add(actorId);
      });
  }

  #initializePayoutContainer(root: HTMLElement): void {
    const select = root.querySelector<HTMLSelectElement>(
      '[name="payoutContainerId"]',
    );
    if (!select) return;
    select.value = select.dataset.selected ?? "";
    const synchronize = () => {
      const link = root.querySelector<HTMLAnchorElement>(
        "[data-payout-container-link]",
      );
      const actor = select.value ? game.actors.get(select.value) : undefined;
      if (!link) return;
      link.hidden = !actor;
      link.dataset.actorId = actor?.id ?? "";
      link.textContent = actor ? `Open ${actor.name}` : "";
      link.title = actor ? `Open ${actor.name}` : "";
      this.#plan = null;
    };
    select.addEventListener("change", synchronize);
    synchronize();
  }

  #syncUserRow(userToggle: HTMLInputElement): void {
    const row = userToggle.closest<HTMLElement>("[data-player-row]");
    if (!row) return;

    const actorToggles = Array.from(
      row.querySelectorAll<HTMLInputElement>("[data-actor-toggle]"),
    );

    for (const actorToggle of actorToggles) {
      actorToggle.disabled = !userToggle.checked;
    }

    if (userToggle.checked && !actorToggles.some(({ checked }) => checked)) {
      const defaultActor =
        actorToggles.find((actor) => actor.dataset.primary === "true") ??
        actorToggles[0];
      if (defaultActor) defaultActor.checked = true;
    }
  }

  #toggleOtherActors(button: HTMLButtonElement): void {
    const row = button.closest<HTMLElement>("[data-player-row]");
    const otherActors = row?.querySelector<HTMLElement>("[data-other-actors]");
    if (!otherActors) return;

    otherActors.hidden = !otherActors.hidden;
    button.textContent = otherActors.hidden
      ? "Show other actors"
      : "Hide other actors";
    button.setAttribute("aria-expanded", String(!otherActors.hidden));
  }

  #goToRewards(root: HTMLElement): void {
    this.#clearValidation(root);
    const sessionLabel = root.querySelector<HTMLInputElement>(
      '[name="sessionLabel"]',
    );
    const selectedActors = Array.from(
      root.querySelectorAll<HTMLInputElement>(
        "[data-actor-toggle]:checked:not(:disabled)",
      ),
    );
    const selectedPlayers = root.querySelectorAll(
      "[data-user-toggle]:checked",
    ).length;

    if (!sessionLabel?.value.trim()) {
      this.#showValidationError(
        root,
        new PayoutValidationError(
          "Enter a session name before continuing.",
          sessionLabel ?? undefined,
        ),
      );
      return;
    }

    if (selectedPlayers === 0 || selectedActors.length === 0) {
      this.#showValidationError(
        root,
        new PayoutValidationError(
          "Select at least one player and Actor before continuing.",
          root.querySelector<HTMLElement>(".participant-list") ?? undefined,
        ),
      );
      return;
    }

    if (selectedActors.length !== selectedPlayers) {
      this.#showValidationError(
        root,
        new PayoutValidationError(
          "Every selected player must have exactly one Actor selected.",
          root.querySelector<HTMLElement>(".participant-list") ?? undefined,
        ),
      );
      return;
    }

    const sessionSummary = root.querySelector<HTMLElement>(
      "[data-session-summary]",
    );
    if (sessionSummary) sessionSummary.textContent = sessionLabel.value.trim();
    this.#setText(
      root,
      "[data-reward-in-game-date]",
      root
        .querySelector<HTMLInputElement>('[name="inGameDate"]')
        ?.value.trim() || "Not specified",
    );
    this.#setText(
      root,
      "[data-reward-notes]",
      root.querySelector<HTMLTextAreaElement>('[name="notes"]')?.value.trim() ||
        "None",
    );

    const recipients = root.querySelector<HTMLElement>("[data-recipient-list]");
    if (recipients)
      recipients.replaceChildren(...this.#actorLinkList(selectedActors));

    this.#populateIndividualPayouts(root, selectedActors);

    this.#showStep(root, "rewards");
  }

  #populateIndividualPayouts(
    root: HTMLElement,
    selectedActors: HTMLInputElement[],
  ): void {
    const container = root.querySelector<HTMLElement>(
      "[data-individual-payouts]",
    );
    const template = root.querySelector<HTMLTemplateElement>(
      "[data-individual-row-template]",
    );
    if (!container || !template) return;

    const existingRows = new Map(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-individual-row]"),
      ).map((row) => [row.dataset.actorId, row]),
    );

    const rows = selectedActors.flatMap((actor) => {
      const actorId = actor.dataset.actorId;
      if (!actorId) return [];

      const existing = existingRows.get(actorId);
      if (existing) return [existing];

      const row = template.content.firstElementChild?.cloneNode(
        true,
      ) as HTMLElement | null;
      if (!row) return [];

      row.dataset.actorId = actorId;
      const actorName = actor.dataset.actorName ?? actorId;
      const heading = row.querySelector<HTMLElement>(
        "[data-individual-actor-name]",
      );
      if (heading)
        heading.replaceChildren(this.#createActorLink(actorId, actorName));

      return [row];
    });

    container.replaceChildren(...rows);
  }

  #addAdditionalEntry(root: HTMLElement): void {
    const container = root.querySelector<HTMLElement>(
      "[data-additional-entries]",
    );
    const template = root.querySelector<HTMLTemplateElement>(
      "[data-additional-entry-template]",
    );
    if (!container || !template) return;

    const entry = template.content.firstElementChild?.cloneNode(
      true,
    ) as HTMLElement | null;
    if (!entry) return;

    const index = this.#additionalEntryIndex++;
    entry
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "[data-additional-field]",
      )
      .forEach((field) => {
        const name = field.dataset.additionalField;
        if (name) field.name = `additional.${index}.${name}`;
      });

    container.append(entry);
  }

  #addIndividualEntry(root: HTMLElement, button: HTMLButtonElement): void {
    const row = button.closest<HTMLElement>("[data-individual-row]");
    const container = row?.querySelector<HTMLElement>(
      "[data-individual-entries]",
    );
    const template = root.querySelector<HTMLTemplateElement>(
      "[data-individual-entry-template]",
    );
    const actorId = row?.dataset.actorId;
    if (!container || !template || !actorId) return;

    const entry = template.content.firstElementChild?.cloneNode(
      true,
    ) as HTMLElement | null;
    if (!entry) return;

    const index = this.#individualEntryIndex++;
    entry
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "[data-entry-field]",
      )
      .forEach((field) => {
        const name = field.dataset.entryField;
        if (name) field.name = `individual.${actorId}.${index}.${name}`;
      });
    container.append(entry);
  }

  #removeEntry(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const entry = target
      .closest<HTMLButtonElement>("[data-remove-entry]")
      ?.closest<HTMLElement>("[data-payout-entry]");
    const itemKey = entry?.dataset.itemKey;
    if (itemKey) this.#droppedItems.delete(itemKey);
    entry?.remove();
  }

  #allowItemDrop(event: DragEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-item-drop-zone]"))
      event.preventDefault();
  }

  async #handleItemDrop(event: DragEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const zone = target.closest<HTMLElement>("[data-item-drop-zone]");
    if (!zone) return;
    event.preventDefault();

    try {
      const raw = event.dataTransfer?.getData("text/plain");
      const dropData = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const uuid = typeof dropData.uuid === "string" ? dropData.uuid : "";
      if (dropData.type !== "Item" || !uuid)
        throw new Error("Drop a Foundry Item document here.");
      const document = await fromUuid(uuid);
      if (!this.#isFoundryItem(document))
        throw new Error("The dropped Item document could not be loaded.");
      const items = await this.#flattenPayoutItems(document, uuid);
      for (const item of items) this.#appendDroppedItem(zone, item);
      if (items.length > 1)
        ui.notifications.info(
          `${document.name} was added unloaded with ${items.length - 1} linked ${items.length === 2 ? "item" : "items"} listed separately.`,
        );
      this.#plan = null;
    } catch (error) {
      ui.notifications.warn(this.#errorMessage(error));
    }
  }

  #appendDroppedItem(zone: HTMLElement, item: PayoutItem): void {
    const list = zone.querySelector<HTMLElement>("[data-item-drop-list]");
    if (!list) return;
    const key = createUniqueId();
    this.#droppedItems.set(key, item);

    const entry = document.createElement("div");
    entry.className = "payout-entry dropped-item-entry";
    entry.dataset.payoutEntry = "";
    entry.dataset.itemKey = key;
    const image = document.createElement("img");
    image.src = item.img;
    image.alt = "";
    const identity = document.createElement("span");
    identity.className = "dropped-item-identity";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const type = document.createElement("small");
    type.textContent = item.type;
    identity.append(name, type);
    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.min = "1";
    quantity.max = "99";
    quantity.step = "1";
    quantity.value = String(item.quantity);
    quantity.title = "Quantity";
    quantity.setAttribute("aria-label", `${item.name} quantity`);
    quantity.dataset.itemQuantity = "";
    const description = document.createElement("input");
    description.type = "text";
    description.placeholder = "Description";
    description.maxLength = 100;
    description.setAttribute("aria-label", `${item.name} description`);
    description.dataset.itemDescription = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-entry";
    remove.title = "Remove Item";
    remove.dataset.removeEntry = "";
    remove.innerHTML = '<i class="fas fa-trash"></i>';
    entry.append(image, identity, quantity, description, remove);
    list.append(entry);
  }

  #readDroppedItems(container: ParentNode | null): PayoutItem[] {
    return Array.from(
      container?.querySelectorAll<HTMLElement>("[data-item-key]") ?? [],
    ).map((entry) => {
      const item = this.#droppedItems.get(entry.dataset.itemKey ?? "");
      if (!item) throw new Error("A dropped Item is no longer available.");
      const quantity = Number(
        entry.querySelector<HTMLInputElement>("[data-item-quantity]")?.value,
      );
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99)
        throw new Error(`${item.name} quantity must be between 1 and 99.`);
      return {
        ...item,
        quantity,
        description:
          entry
            .querySelector<HTMLInputElement>("[data-item-description]")
            ?.value.trim() ?? "",
      };
    });
  }

  #isFoundryItem(value: unknown): value is FoundryItem {
    if (typeof value !== "object" || value === null) return false;
    const item = value as Partial<FoundryItem>;
    return (
      typeof item.name === "string" &&
      typeof item.type === "string" &&
      typeof item.toObject === "function" &&
      (item.documentName === undefined || item.documentName === "Item")
    );
  }

  async #flattenPayoutItems(
    root: FoundryItem,
    rootUuid: string,
  ): Promise<PayoutItem[]> {
    const items: PayoutItem[] = [];
    const visited = new Set<string>();

    const visit = async (
      item: FoundryItem,
      uuid: string,
      quantity = 1,
    ): Promise<void> => {
      if (visited.has(uuid)) return;
      visited.add(uuid);
      const source = item.toObject();
      const installedUuids = this.#installedItemUuids(source);
      const ammo = this.#loadedAmmo(source);
      items.push({
        uuid,
        name: item.name,
        type: item.type,
        img: item.img ?? "icons/svg/item-bag.svg",
        quantity,
        description: "",
        source: this.#standaloneItemSource(source),
      });

      for (const installedUuid of installedUuids) {
        const installed = await this.#resolveRelatedItem(installedUuid, uuid);
        if (!installed)
          throw new Error(
            `${item.name} has an installed Item that could not be loaded (${installedUuid}). Nothing was added.`,
          );
        await visit(installed.document, installed.uuid);
      }

      if (ammo) {
        const ammunition = await this.#resolveRelatedItem(ammo.uuid, uuid);
        if (!ammunition)
          throw new Error(
            `${item.name}'s loaded ammunition could not be loaded (${ammo.uuid}). Nothing was added.`,
          );
        if (!visited.has(ammunition.uuid))
          await visit(ammunition.document, ammunition.uuid, ammo.rounds);
      }
    };

    await visit(root, rootUuid);
    return items;
  }

  async #resolveRelatedItem(
    reference: string,
    ownerUuid: string,
  ): Promise<{ document: FoundryItem; uuid: string } | null> {
    const candidates = [reference];
    if (!reference.includes(".")) {
      const embeddedMarker = ownerUuid.lastIndexOf(".Item.");
      if (embeddedMarker >= 0)
        candidates.unshift(
          `${ownerUuid.slice(0, embeddedMarker)}.Item.${reference}`,
        );
      else if (ownerUuid.startsWith("Item."))
        candidates.unshift(`Item.${reference}`);
    }

    for (const uuid of new Set(candidates)) {
      const document = await fromUuid(uuid).catch(() => null);
      if (this.#isFoundryItem(document)) return { document, uuid };
    }
    return null;
  }

  #installedItemUuids(source: Record<string, unknown>): string[] {
    const system = this.#objectField(source, "system");
    const installedItems = this.#objectField(system, "installedItems");
    const list = installedItems?.list;
    return Array.isArray(list)
      ? list.filter(
          (uuid): uuid is string => typeof uuid === "string" && uuid.length > 0,
        )
      : [];
  }

  #loadedAmmo(
    source: Record<string, unknown>,
  ): { uuid: string; rounds: number } | null {
    const system = this.#objectField(source, "system");
    const magazine = this.#objectField(system, "magazine");
    const ammoData = this.#objectField(magazine, "ammoData");
    const uuid = ammoData?.uuid;
    const rounds = magazine?.value;
    return typeof uuid === "string" &&
      uuid.length > 0 &&
      typeof rounds === "number" &&
      Number.isSafeInteger(rounds) &&
      rounds > 0
      ? { uuid, rounds }
      : null;
  }

  #standaloneItemSource(
    original: Record<string, unknown>,
  ): Record<string, unknown> {
    const source = structuredClone(original);
    const system = this.#objectField(source, "system");
    const installedItems = this.#objectField(system, "installedItems");
    if (installedItems) {
      installedItems.list = [];
      if ("usedSlots" in installedItems) installedItems.usedSlots = 0;
    }
    if (system && "installedIn" in system) system.installedIn = "";
    if (system && "isInstalled" in system) system.isInstalled = false;
    const magazine = this.#objectField(system, "magazine");
    if (magazine) {
      magazine.value = 0;
      magazine.ammoData = { name: "", uuid: "" };
    }
    const programs = this.#objectField(system, "programs");
    if (programs) {
      programs.installed = [];
      programs.rezzed = [];
    }
    return source;
  }

  #objectField(value: unknown, key: string): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null) return null;
    const result = (value as Record<string, unknown>)[key];
    return typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : null;
  }

  #syncEntryControls(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const entry = target.closest<HTMLElement>("[data-payout-entry]");
    if (!entry) return;

    const type = entry.querySelector<HTMLSelectElement>("[data-entry-type]");
    const mode = entry.querySelector<HTMLSelectElement>("[data-entry-mode]");
    const amount = entry.querySelector<HTMLInputElement>("[data-entry-amount]");
    const faction = entry.querySelector<HTMLInputElement>(
      "[data-entry-faction]",
    );
    if (!type || !mode || !amount) return;

    const humanity =
      type.value === "humanityGain" || type.value === "humanityLoss";
    const twoDigitAmount =
      humanity ||
      type.value === "newReputation" ||
      type.value === "specificReputation";
    entry.classList.toggle("payout-entry--two-digit", twoDigitAmount);
    mode.hidden = !humanity;
    mode.disabled = !humanity;
    amount.disabled = humanity && mode.value !== "fixed";
    if (humanity && mode.value !== "fixed") amount.value = "0";
    if (twoDigitAmount) {
      amount.type = "text";
      amount.inputMode = "numeric";
      amount.maxLength = 2;
      amount.max = "99";
      amount.value = amount.value.replace(/\D/g, "").slice(0, 2);
    } else {
      amount.type = "number";
      amount.removeAttribute("inputmode");
      amount.removeAttribute("maxlength");
      amount.removeAttribute("max");
    }
    amount.placeholder = humanity && mode.value !== "fixed" ? "Dice" : "Amount";
    if (faction) {
      const specificReputation = type.value === "specificReputation";
      faction.hidden = !specificReputation;
      faction.disabled = !specificReputation;
    }
  }

  async #goToPreview(root: HTMLElement): Promise<void> {
    this.#clearValidation(root);
    try {
      this.#plan = await this.#buildPlan(root);
    } catch (error) {
      this.#showValidationError(root, error);
      return;
    }
    const sessionLabel = root.querySelector<HTMLInputElement>(
      '[name="sessionLabel"]',
    );
    const notes = root.querySelector<HTMLTextAreaElement>('[name="notes"]');
    const selectedActors = Array.from(
      root.querySelectorAll<HTMLInputElement>(
        "[data-actor-toggle]:checked:not(:disabled)",
      ),
    );

    this.#setText(root, "[data-preview-session]", sessionLabel?.value.trim());
    root
      .querySelector<HTMLElement>("[data-preview-recipients]")
      ?.replaceChildren(...this.#actorLinkList(selectedActors));
    this.#setText(root, "[data-preview-notes]", notes?.value.trim() || "None");
    this.#setText(root, "[data-preview-in-game-date]", this.#plan.inGameDate);

    const communalList = root.querySelector<HTMLElement>(
      "[data-preview-communal]",
    );
    if (communalList) {
      const items = [
        ...(this.#plan.payoutContainer &&
        (this.#plan.payoutContainer.moneyAmount !== 0 ||
          this.#plan.communalItems.length)
          ? [
              this.#createPayoutContainerPreviewItem(
                this.#plan.payoutContainer.actor,
              ),
            ]
          : []),
        ...this.#plan.hqIpTransactions.map(({ amount, reason }) =>
          this.#createPreviewItem("HQ IP", String(amount), reason),
        ),
        ...(this.#plan.payoutContainer?.moneyAmount
          ? [
              this.#createPreviewItem(
                "Money",
                String(this.#plan.payoutContainer.moneyAmount),
                this.#plan.payoutContainer.moneyDescription,
              ),
            ]
          : []),
        ...this.#plan.communalItems.map((item) =>
          this.#createPreviewItem(
            `Item: ${item.name}`,
            `×${item.quantity}`,
            item.description,
          ),
        ),
      ];
      communalList.replaceChildren(...items);
      communalList.classList.toggle("preview-list--empty", items.length === 0);
      if (!items.length)
        communalList.textContent = "No communal payouts entered.";
    }

    const groupList = root.querySelector<HTMLElement>("[data-preview-group]");
    if (groupList) {
      const items: HTMLElement[] = [];
      const primaryFields = [
        ["Money", "groupMoney", "groupMoneyDescription"],
        ["IP", "groupIp", "groupIpDescription"],
        ["Downtime", "groupDowntime", "groupDowntimeDescription"],
      ] as const;
      for (const [label, amountName, descriptionName] of primaryFields) {
        const amount = root.querySelector<HTMLInputElement>(
          `[name="${amountName}"]`,
        )?.value;
        const description = root.querySelector<HTMLInputElement>(
          `[name="${descriptionName}"]`,
        )?.value;
        if (Number(amount) !== 0)
          items.push(
            this.#createPreviewItem(
              label,
              label === "Downtime"
                ? this.#formatDays(Number(amount))
                : (amount ?? "0"),
              description,
            ),
          );
      }
      root
        .querySelectorAll<HTMLElement>(
          "[data-additional-entries] [data-payout-entry]",
        )
        .forEach((entry) => items.push(this.#previewItemFromEntry(entry)));
      groupList.replaceChildren(...items);
      groupList.classList.toggle("preview-list--empty", items.length === 0);
      if (items.length === 0)
        groupList.textContent = "No primary payouts entered.";
    }

    const individualPreview = root.querySelector<HTMLElement>(
      "[data-preview-individual]",
    );
    if (individualPreview) {
      const cards = this.#plan.actors.flatMap(({ actor }) => {
        const changes = this.#plan?.changes.filter(
          ({ targetId }) => targetId === actor.id,
        );
        if (!changes?.length) return [];
        const card = document.createElement("details");
        card.className = "preview-recipient";
        card.open = true;
        const heading = document.createElement("summary");
        const icon = document.createElement("i");
        icon.className = "fas fa-user";
        heading.append(icon, " ", this.#createActorLink(actor.id, actor.name));
        const list = document.createElement("ul");
        list.className = "preview-list";
        list.append(
          ...changes.map((change) => {
            const item = this.#createPreviewItem(
              change.reward === "item"
                ? `Item: ${String(change.details?.itemName ?? "Unknown")}`
                : this.#rewardLabel(change.reward),
              change.reward === "item"
                ? `×${change.amount}`
                : change.reward === "downtime"
                  ? this.#formatDays(change.amount)
                  : change.details?.pendingPlayerRoll
                    ? `${String(change.details.formula)} — pending player roll`
                    : `${change.previousValue} → ${change.newValue}`,
              String(change.details?.description ?? ""),
            );
            item.classList.add(
              change.details?.scope === "individual"
                ? "preview-item--individual"
                : "preview-item--primary",
            );
            return item;
          }),
        );
        card.append(heading, list);
        return [card];
      });
      individualPreview.replaceChildren(...cards);
      individualPreview.classList.toggle(
        "preview-list--empty",
        cards.length === 0,
      );
      if (cards.length === 0)
        individualPreview.textContent = "No individual payouts entered.";
    }

    this.#showStep(root, "preview");
  }

  async #buildPlan(root: HTMLElement): Promise<PayoutPlan> {
    this.#validateTextLengths(root);
    const journalData = getPayoutJournalData();
    const sessionLabel = root
      .querySelector<HTMLInputElement>('[name="sessionLabel"]')
      ?.value.trim();
    if (!sessionLabel)
      throw new PayoutValidationError(
        "A session name is required.",
        root.querySelector<HTMLInputElement>('[name="sessionLabel"]') ??
          undefined,
      );
    const inGameDate =
      root
        .querySelector<HTMLInputElement>('[name="inGameDate"]')
        ?.value.trim() ?? "";
    const communalItems = this.#readDroppedItems(
      root.querySelector("[data-communal-item-drop]"),
    );
    const communalMoneyAmount = Number(
      root.querySelector<HTMLInputElement>('[name="communalMoney"]')?.value,
    );
    if (!Number.isSafeInteger(communalMoneyAmount))
      throw new PayoutValidationError(
        "Communal Money must be a whole number.",
        root.querySelector<HTMLInputElement>('[name="communalMoney"]') ??
          undefined,
      );
    const communalMoneyDescription =
      root
        .querySelector<HTMLInputElement>('[name="communalMoneyDescription"]')
        ?.value.trim() ?? "";
    const payoutContainerId =
      root.querySelector<HTMLSelectElement>('[name="payoutContainerId"]')
        ?.value ?? "";
    const payoutContainerActor = payoutContainerId
      ? game.actors.get(payoutContainerId)
      : undefined;
    if (payoutContainerActor && payoutContainerActor.type !== "container")
      throw new PayoutValidationError(
        "The selected Payout Container is invalid.",
        root.querySelector<HTMLSelectElement>('[name="payoutContainerId"]') ??
          undefined,
      );
    if ((communalMoneyAmount || communalItems.length) && !payoutContainerActor)
      throw new PayoutValidationError(
        "Select a Payout Container before adding Communal Money or Items.",
        root.querySelector<HTMLSelectElement>('[name="payoutContainerId"]') ??
          undefined,
      );
    const payoutContainer = payoutContainerActor
      ? {
          actor: payoutContainerActor,
          moneyAmount: communalMoneyAmount,
          moneyDescription: communalMoneyDescription,
        }
      : null;

    const groupEntries: RewardEntry[] = [];
    const primary = [
      ["money", "groupMoney", "groupMoneyDescription"],
      ["ip", "groupIp", "groupIpDescription"],
      ["downtime", "groupDowntime", "groupDowntimeDescription"],
    ] as const;
    for (const [reward, amountName, descriptionName] of primary) {
      const amountField =
        root.querySelector<HTMLInputElement>(`[name="${amountName}"]`) ??
        undefined;
      const amount = Number(amountField?.value);
      if (!Number.isSafeInteger(amount))
        throw new PayoutValidationError(
          `${this.#rewardLabel(reward)} must be a whole number.`,
          amountField,
        );
      if (reward === "downtime" && amount < 0)
        throw new PayoutValidationError(
          "Downtime cannot be negative.",
          amountField,
        );
      if (amount !== 0)
        groupEntries.push({
          reward,
          amount,
          scope: "group",
          description:
            root.querySelector<HTMLInputElement>(`[name="${descriptionName}"]`)
              ?.value ?? "",
        });
    }
    for (const entry of root.querySelectorAll<HTMLElement>(
      "[data-additional-entries] [data-payout-entry]",
    ))
      groupEntries.push({ ...this.#readRewardEntry(entry), scope: "group" });

    const hqIpAmount = Number(
      root.querySelector<HTMLInputElement>('[name="groupHqIp"]')?.value,
    );
    if (!Number.isSafeInteger(hqIpAmount))
      throw new PayoutValidationError(
        "HQ IP must be a whole number.",
        root.querySelector<HTMLInputElement>('[name="groupHqIp"]') ?? undefined,
      );
    const hqIpDescription =
      root
        .querySelector<HTMLInputElement>('[name="groupHqIpDescription"]')
        ?.value.trim() ?? "";
    const hqIpTransactions = hqIpAmount
      ? [
          {
            date: inGameDate || new Date().toISOString().slice(0, 10),
            amount: hqIpAmount,
            reason: hqIpDescription || sessionLabel,
          },
        ]
      : [];

    const actors: PayoutPlan["actors"] = [];
    const humanityPrompts: PayoutPlan["humanityPrompts"] = [];
    const factionReputations: PayoutPlan["factionReputations"] = [];
    const journalChanges: PayoutChange[] = [];
    for (const selected of root.querySelectorAll<HTMLInputElement>(
      "[data-actor-toggle]:checked:not(:disabled)",
    )) {
      const actorId = selected.dataset.actorId;
      const actor = actorId ? game.actors.get(actorId) : undefined;
      const playerRow = selected.closest<HTMLElement>("[data-player-row]");
      const userId = playerRow?.dataset.userId;
      const user = Array.from(game.users).find(({ id }) => id === userId);
      if (!actor || actor.type !== "character" || !user)
        throw new Error("A selected recipient is missing or unsupported.");
      const row = Array.from(
        root.querySelectorAll<HTMLElement>("[data-individual-row]"),
      ).find(({ dataset }) => dataset.actorId === actor.id);
      const individualEntries = Array.from(
        row?.querySelectorAll<HTMLElement>(
          "[data-individual-entries] [data-payout-entry]",
        ) ?? [],
      ).map((entry) => ({
        ...this.#readRewardEntry(entry),
        scope: "individual" as const,
      }));
      const individualItems = this.#readDroppedItems(
        row?.querySelector("[data-individual-item-drop]") ?? null,
      );
      const entries = [...groupEntries, ...individualEntries];
      actors.push({
        actor,
        participant: {
          userId: user.id,
          userName: user.name,
          actorId: actor.id,
          actorName: actor.name,
        },
        entries,
        items: individualItems,
      });
      for (const item of individualItems)
        journalChanges.push({
          reward: "item",
          targetType: "actor",
          targetId: actor.id,
          targetName: actor.name,
          amount: item.quantity,
          previousValue: null,
          newValue: null,
          details: {
            itemName: item.name,
            itemType: item.type,
            img: item.img,
            uuid: item.uuid,
            description: item.description,
            scope: "individual",
          },
        });
      for (const entry of entries) {
        if (entry.reward === "factionReputation") {
          const faction = entry.faction ?? "";
          const previous = journalData.factionReputations.find(
            (record) =>
              record.actorId === actor.id &&
              record.faction.toLocaleLowerCase() ===
                faction.toLocaleLowerCase(),
          );
          factionReputations.push({
            actorId: actor.id,
            actorName: actor.name,
            reputation: entry.amount,
            faction,
            reason: entry.description,
          });
          journalChanges.push({
            reward: "factionReputation",
            targetType: "journal",
            targetId: actor.id,
            targetName: actor.name,
            amount: entry.amount - (previous?.reputation ?? 0),
            previousValue: previous?.reputation ?? 0,
            newValue: entry.amount,
            details: {
              faction,
              description: entry.description,
              scope: "individual",
            },
          });
          continue;
        }
        if (!entry.formula) continue;
        if (entry.reward !== "humanityGain" && entry.reward !== "humanityLoss")
          throw new Error("Only Humanity entries can use dice.");
        humanityPrompts.push({
          actorId: actor.id,
          actorName: actor.name,
          userId: user.id,
          reward: entry.reward,
          formula: entry.formula,
          description: entry.description,
        });
      }
    }
    if (!actors.length) throw new Error("Select at least one recipient.");
    if (hqIpAmount) {
      journalChanges.push({
        reward: "hqIp",
        targetType: "world",
        targetId: null,
        targetName: "HQ",
        amount: hqIpAmount,
        previousValue: null,
        newValue: null,
        details: {
          description: hqIpDescription,
          scope: "group",
        },
      });
    }
    if (payoutContainer && communalMoneyAmount) {
      const previousValue = Number(
        this.#valueAt(payoutContainer.actor.system, "wealth.value"),
      );
      if (!Number.isFinite(previousValue))
        throw new Error("The Payout Container has no valid Money balance.");
      journalChanges.push({
        reward: "communalMoney",
        targetType: "actor",
        targetId: payoutContainer.actor.id,
        targetName: payoutContainer.actor.name,
        amount: communalMoneyAmount,
        previousValue,
        newValue: previousValue + communalMoneyAmount,
        details: {
          description: communalMoneyDescription,
          scope: "communal",
        },
      });
    }
    for (const item of communalItems)
      journalChanges.push({
        reward: "item",
        targetType: "actor",
        targetId: payoutContainer?.actor.id ?? null,
        targetName: payoutContainer?.actor.name ?? "Payout Container",
        amount: item.quantity,
        previousValue: null,
        newValue: null,
        details: {
          itemName: item.name,
          itemType: item.type,
          img: item.img,
          uuid: item.uuid,
          description: item.description,
          scope: "communal",
        },
      });
    for (const { participant } of actors) {
      const previous =
        journalData.attendance.find(
          ({ userId }) => userId === participant.userId,
        )?.sessions ?? 0;
      journalChanges.push({
        reward: "attendance",
        targetType: "user",
        targetId: participant.userId,
        targetName: participant.userName,
        amount: 1,
        previousValue: previous,
        newValue: previous + 1,
      });
    }
    return {
      sessionLabel,
      inGameDate,
      notes:
        root.querySelector<HTMLTextAreaElement>('[name="notes"]')?.value ?? "",
      actors,
      changes: [...actors.flatMap(planActorChanges), ...journalChanges],
      humanityPrompts,
      factionReputations,
      hqIpTransactions,
      communalItems,
      payoutContainer,
    };
  }

  #readRewardEntry(entry: HTMLElement): RewardEntry {
    const type =
      entry.querySelector<HTMLSelectElement>("[data-entry-type]")?.value;
    const reward =
      type === "newReputation"
        ? "reputation"
        : type === "specificReputation"
          ? "factionReputation"
          : type;
    if (!this.#isCharacterReward(reward))
      throw new Error("Invalid reward type.");
    const mode = entry.querySelector<HTMLSelectElement>("[data-entry-mode]");
    const formula =
      mode && !mode.disabled && mode.value !== "fixed" ? mode.value : undefined;
    const amount = Number(
      entry.querySelector<HTMLInputElement>("[data-entry-amount]")?.value,
    );
    const amountField =
      entry.querySelector<HTMLInputElement>("[data-entry-amount]") ?? undefined;
    if (!formula && !Number.isSafeInteger(amount))
      throw new PayoutValidationError(
        `${this.#rewardLabel(reward)} must be a whole number.`,
        amountField,
      );
    if ((reward === "humanityGain" || reward === "humanityLoss") && amount < 0)
      throw new PayoutValidationError(
        "Humanity amounts cannot be negative.",
        amountField,
      );
    if (reward === "downtime" && amount < 0)
      throw new PayoutValidationError(
        "Downtime cannot be negative.",
        amountField,
      );
    if (
      (reward === "humanityGain" ||
        reward === "humanityLoss" ||
        reward === "reputation" ||
        reward === "factionReputation") &&
      amount > 99
    )
      throw new PayoutValidationError(
        `${this.#rewardLabel(reward)} cannot exceed 99.`,
        amountField,
      );
    if (reward === "reputation" && amount < 0)
      throw new PayoutValidationError(
        "Reputation cannot be negative.",
        amountField,
      );
    const faction = entry
      .querySelector<HTMLInputElement>("[data-entry-faction]")
      ?.value.trim();
    if (reward === "factionReputation" && !faction)
      throw new PayoutValidationError(
        "Enter a faction for Specific Reputation.",
        entry.querySelector<HTMLInputElement>("[data-entry-faction]") ??
          undefined,
      );
    return {
      reward,
      amount: formula ? 0 : amount,
      scope: "individual",
      formula,
      faction,
      setValue: reward === "reputation",
      description: this.#entryDescription(entry),
    };
  }

  #validateTextLengths(root: HTMLElement): void {
    for (const field of root.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >('input[type="text"], textarea')) {
      if (field.maxLength < 0 || field.value.length <= field.maxLength)
        continue;
      const label =
        field.getAttribute("aria-label") ??
        field.closest("label")?.querySelector("span")?.textContent?.trim() ??
        field.placeholder ??
        field.name ??
        "Text field";
      throw new PayoutValidationError(
        `${label} cannot exceed ${field.maxLength} characters.`,
        field,
      );
    }
  }

  #showValidationError(root: HTMLElement, error: unknown): void {
    const message = this.#errorMessage(error);
    const field =
      error instanceof PayoutValidationError ? error.field : undefined;
    const target = field ?? this.#fieldForValidationMessage(root, message);
    if (target) {
      target.setAttribute("aria-invalid", "true");
      const note = document.createElement("small");
      note.className = "payout-field-error";
      note.dataset.payoutFieldError = "";
      note.textContent = message;
      target.insertAdjacentElement("afterend", note);
      target.focus();
    } else {
      const note = document.createElement("p");
      note.className = "payout-validation-summary";
      note.dataset.payoutFieldError = "";
      note.textContent = message;
      root
        .querySelector<HTMLElement>("[data-step-panel]:not([hidden])")
        ?.prepend(note);
    }
    ui.notifications.warn(message);
  }

  #fieldForValidationMessage(
    root: HTMLElement,
    message: string,
  ): HTMLElement | undefined {
    const normalized = message.toLocaleLowerCase();
    const name = normalized.includes("payout container")
      ? "payoutContainerId"
      : normalized.includes("hq ip")
        ? "groupHqIp"
        : normalized.includes("downtime")
          ? "groupDowntime"
          : normalized.includes("session")
            ? "sessionLabel"
            : undefined;
    return name
      ? (root.querySelector<HTMLElement>(`[name="${name}"]`) ?? undefined)
      : undefined;
  }

  #clearFieldError(field: HTMLElement): void {
    field.removeAttribute("aria-invalid");
    const sibling = field.nextElementSibling;
    if (
      sibling instanceof HTMLElement &&
      sibling.dataset.payoutFieldError !== undefined
    )
      sibling.remove();
  }

  #clearValidation(root: HTMLElement): void {
    root
      .querySelectorAll<HTMLElement>("[data-payout-field-error]")
      .forEach((note) => note.remove());
    root
      .querySelectorAll<HTMLElement>('[aria-invalid="true"]')
      .forEach((field) => field.removeAttribute("aria-invalid"));
  }

  async #applyPayout(root: HTMLElement): Promise<void> {
    if (this.#submitting) {
      ui.notifications.warn(
        "This payout is already being applied. Wait for it to finish before trying again.",
      );
      return;
    }
    if (!this.#plan) {
      ui.notifications.warn("Preview the payout again before applying it.");
      return;
    }
    const button = root.querySelector<HTMLButtonElement>("[data-apply-payout]");
    this.#submitting = true;
    if (button) button.disabled = true;
    try {
      const plan = this.#plan;
      const discordLinks = getDiscordLinks();
      await executePayoutPlan(plan);
      await saveLastPayoutDate(plan.inGameDate).catch(() =>
        ui.notifications.warn(
          "Payout applied, but the last-used in-game date could not be saved.",
        ),
      );
      ui.notifications.info("Payout applied and recorded successfully.");
      await this.close();
      if (isDiscordMarkdownEnabled())
        showDiscordSummary(buildDiscordMarkdown(plan, discordLinks));
    } catch (error) {
      ui.notifications.error(
        `Payout failed and was rolled back: ${this.#errorMessage(error)}`,
      );
      this.#submitting = false;
      if (button) button.disabled = false;
    }
  }

  #isCharacterReward(value: unknown): value is CharacterReward {
    return [
      "money",
      "ip",
      "humanityGain",
      "humanityLoss",
      "reputation",
      "factionReputation",
      "downtime",
    ].includes(String(value));
  }

  #rewardLabel(reward: string): string {
    return (
      (
        {
          money: "Money",
          ip: "IP",
          hqIp: "HQ IP",
          humanityGain: "Gain Humanity",
          humanityLoss: "Lose Humanity",
          reputation: "Reputation",
          factionReputation: "Specific Reputation",
          item: "Item",
          downtime: "Downtime",
        } as Record<string, string>
      )[reward] ?? reward
    );
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  #valueAt(value: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[key];
    }, value);
  }

  #previewItemFromEntry(entry: HTMLElement): HTMLLIElement {
    const type = entry.querySelector<HTMLSelectElement>("[data-entry-type]");
    const amount = entry.querySelector<HTMLInputElement>("[data-entry-amount]");
    const mode = entry.querySelector<HTMLSelectElement>("[data-entry-mode]");
    const amountText =
      type?.value === "downtime"
        ? this.#formatDays(Number(amount?.value || 0))
        : mode && !mode.disabled && mode.value !== "fixed"
          ? mode.value
          : amount?.value || "0";
    return this.#createPreviewItem(
      type?.selectedOptions[0]?.textContent ?? "Payout",
      amountText,
      this.#entryDescription(entry),
    );
  }

  #entryDescription(entry: HTMLElement): string {
    return (
      entry.querySelector<HTMLInputElement>(
        '[data-entry-field="description"], [data-additional-field="description"]',
      )?.value ?? ""
    );
  }

  #formatDays(amount: number): string {
    return `${amount} ${Math.abs(amount) === 1 ? "day" : "days"}`;
  }

  #createPreviewItem(
    label: string,
    amount: string,
    description?: string,
  ): HTMLLIElement {
    const item = document.createElement("li");
    const labelElement = document.createElement("span");
    labelElement.className = "preview-item-label";
    labelElement.textContent = label;
    const amountElement = document.createElement("strong");
    amountElement.className = "preview-item-amount";
    amountElement.textContent = amount;
    const descriptionElement = document.createElement("span");
    descriptionElement.className = "preview-item-description";
    descriptionElement.textContent = description?.trim() || "No description";
    item.append(labelElement, amountElement, descriptionElement);
    return item;
  }

  #createPayoutContainerPreviewItem(actor: FoundryActor): HTMLLIElement {
    const item = this.#createPreviewItem(
      "Payout Container",
      actor.name,
      "Destination for Communal Money and Items",
    );
    item
      .querySelector(".preview-item-amount")
      ?.replaceChildren(this.#createActorLink(actor.id, actor.name));
    return item;
  }

  #setText(root: HTMLElement, selector: string, value?: string): void {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value ?? "";
  }

  #openActorLink(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLElement>("[data-actor-link]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const actor = link.dataset.actorId
      ? game.actors.get(link.dataset.actorId)
      : undefined;
    if (!actor) {
      ui.notifications.warn("That Actor could not be found.");
      return;
    }
    actor.sheet?.render(true);
  }

  #actorLinkList(actors: HTMLInputElement[]): Node[] {
    return actors.flatMap((actor, index) => {
      const actorId = actor.dataset.actorId ?? actor.value;
      const link = this.#createActorLink(
        actorId,
        actor.dataset.actorName ?? actor.value,
      );
      return index === 0 ? [link] : [document.createTextNode(", "), link];
    });
  }

  #createActorLink(actorId: string, actorName: string): HTMLAnchorElement {
    const link = document.createElement("a");
    link.className = "actor-sheet-link";
    link.dataset.actorLink = "";
    link.dataset.actorId = actorId;
    link.href = "#";
    link.textContent = actorName;
    link.title = `Open ${actorName}`;
    return link;
  }

  #showStep(
    root: HTMLElement,
    step: "participants" | "rewards" | "preview",
  ): void {
    root.querySelectorAll<HTMLElement>("[data-step-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.stepPanel !== step;
    });
    root
      .querySelectorAll<HTMLElement>("[data-step-indicator]")
      .forEach((indicator) => {
        indicator.classList.toggle(
          "wizard-step--active",
          indicator.dataset.stepIndicator === step,
        );
      });
  }

  #deduplicateActor(root: HTMLElement, selected: HTMLInputElement): void {
    const actorId = selected.dataset.actorId;
    if (!actorId) return;

    root
      .querySelectorAll<HTMLInputElement>("[data-actor-toggle]")
      .forEach((actorToggle) => {
        if (
          actorToggle !== selected &&
          actorToggle.dataset.actorId === actorId
        ) {
          actorToggle.checked = false;
        }
      });
  }

  #selectOnlyActorInRow(selected: HTMLInputElement): void {
    selected
      .closest<HTMLElement>("[data-player-row]")
      ?.querySelectorAll<HTMLInputElement>("[data-actor-toggle]")
      .forEach((actor) => {
        if (actor !== selected) actor.checked = false;
      });
  }

  #updateSelectionSummary(root: HTMLElement): void {
    const selectedPlayers = root.querySelectorAll(
      "[data-user-toggle]:checked",
    ).length;
    const selectedActorIds = new Set(
      Array.from(
        root.querySelectorAll<HTMLInputElement>(
          "[data-actor-toggle]:checked:not(:disabled)",
        ),
      ).map(({ value }) => value),
    );
    const summary = root.querySelector<HTMLElement>("[data-selection-summary]");

    if (summary) {
      summary.textContent = `${selectedPlayers} player${selectedPlayers === 1 ? "" : "s"}, ${selectedActorIds.size} Actor${selectedActorIds.size === 1 ? "" : "s"} selected`;
    }
  }
}

function toPlayerView(account: PlayerAccount): PlayerView {
  const selected = account.eligible;
  const defaultActor =
    account.actors.find(({ assigned }) => assigned) ?? account.actors[0];
  const actorViews = account.actors.map((actor) => ({
    actorId: actor.actorId,
    actorName: actor.actorName,
    primary: actor.actorId === defaultActor?.actorId,
    selected: actor.actorId === defaultActor?.actorId,
    shared: actor.sharedWithUserIds.length > 0,
  }));
  const primaryActor =
    actorViews.find(({ actorId }) => actorId === defaultActor?.actorId) ?? null;
  const otherActors = actorViews.filter(({ primary }) => !primary);

  return {
    userId: account.userId,
    userName: account.userName,
    active: account.active,
    presenceClass: account.active ? "presence--active" : "",
    presenceLabel: account.active ? "Online" : "Offline",
    selected,
    eligible: account.eligible,
    eligibilityClass: account.eligible ? "" : "participant--ineligible",
    defaultActor: primaryActor,
    otherActors,
    hasOtherActors: otherActors.length > 0,
    warningText: account.issues.map((issue) => ISSUE_LABELS[issue]).join(" "),
  };
}
