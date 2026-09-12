import { DEFAULT_PAYOUT_CONTAINER_SETTING, MODULE_ID } from "./constants";

interface PayoutContainerConfigData {
  selectedId: string;
  containers: Array<{ actorId: string; actorName: string }>;
  hasContainers: boolean;
}

export function registerPayoutContainerSettings(): void {
  game.settings.register(MODULE_ID, DEFAULT_PAYOUT_CONTAINER_SETTING, {
    name: "Default Payout Container ID",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
  game.settings.registerMenu(MODULE_ID, "payoutContainerMenu", {
    name: "Default Payout Container",
    label: "Configure Payout Container",
    hint: "Choose the default Cyberpunk RED Container Actor for Communal Money and Items. Players should access it through a linked token.",
    icon: "fas fa-box-open",
    type: PayoutContainerConfig,
    restricted: true,
  });
}

export function getPayoutContainers(): FoundryActor[] {
  return Array.from(game.actors)
    .filter(({ type }) => type === "container")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getDefaultPayoutContainerId(): string {
  const value = game.settings.get(MODULE_ID, DEFAULT_PAYOUT_CONTAINER_SETTING);
  return typeof value === "string" &&
    game.actors.get(value)?.type === "container"
    ? value
    : "";
}

class PayoutContainerConfig extends FormApplication {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: `${MODULE_ID}-payout-container`,
      title: "PneumaCrewTools: Default Payout Container",
      template: `modules/${MODULE_ID}/templates/payout-container.hbs`,
      width: 480,
      height: "auto",
      closeOnSubmit: true,
    };
  }

  override getData(): PayoutContainerConfigData {
    const containers = getPayoutContainers().map(({ id, name }) => ({
      actorId: id,
      actorName: name,
    }));
    return {
      selectedId: getDefaultPayoutContainerId(),
      containers,
      hasContainers: containers.length > 0,
    };
  }

  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const select = html[0]?.querySelector<HTMLSelectElement>(
      '[name="payoutContainerId"]',
    );
    if (select) select.value = select.dataset.selected ?? "";
  }

  protected override async _updateObject(
    _event: Event,
    formData: Record<string, unknown>,
  ): Promise<void> {
    const actorId = String(formData.payoutContainerId ?? "");
    if (actorId && game.actors.get(actorId)?.type !== "container")
      throw new Error("The selected Payout Container is no longer available.");
    await game.settings.set(
      MODULE_ID,
      DEFAULT_PAYOUT_CONTAINER_SETTING,
      actorId,
    );
    ui.notifications.info("Default Payout Container saved.");
  }
}
