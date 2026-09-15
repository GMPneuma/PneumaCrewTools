import { TECH_CATEGORIES } from "./tech-project-model";
import { MODULE_ID } from "./constants";
import { CrewToolsForm } from "./foundry-form";
export const ARMOR_REPAIR_SETTING = "armorRepairTimes";
export const REPAIR_CATEGORIES = TECH_CATEGORIES;
export interface ArmorRepairConfig {
  enabled: boolean;
  techOnly: boolean;
  days: Record<string, number>;
}
export function armorRepairConfig(): ArmorRepairConfig {
  const value = game.settings.get(MODULE_ID, ARMOR_REPAIR_SETTING) as
    ArmorRepairConfig | undefined;
  return value && typeof value === "object"
    ? value
    : { enabled: false, techOnly: false, days: {} };
}
export function armorRepairDays(
  type: string,
  isTech: boolean,
): number | undefined {
  const config = armorRepairConfig();
  if (!config.enabled || (config.techOnly && !isTech)) return;
  const days = config.days[type];
  return typeof days === "number" && Number.isSafeInteger(days) && days > 0
    ? days
    : undefined;
}
class ArmorRepairSettings extends CrewToolsForm {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-armor-repair",
      title: "Armor Repair Times",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/armor-repair-settings.hbs`,
      width: 460,
      height: "auto",
      closeOnSubmit: true,
    };
  }
  override getData() {
    const config = armorRepairConfig();
    return {
      ...config,
      rows: REPAIR_CATEGORIES.map(({ id, name }, index) => ({
        name,
        index,
        days: config.days[id] ?? "",
      })),
    };
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ) {
    if (!game.user?.isGM)
      throw new Error("Only a GM can configure repair times.");
    const days: Record<string, number> = {};
    REPAIR_CATEGORIES.forEach(({ id }, index) => {
      const raw = data["days" + index];
      if (raw !== "" && raw !== undefined) {
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 1)
          throw new Error("Repair overrides must be whole days of at least 1.");
        days[id] = n;
      }
    });
    await game.settings.set(MODULE_ID, ARMOR_REPAIR_SETTING, {
      enabled: !!data.enabled,
      techOnly: !!data.techOnly,
      days,
    });
  }
}
export function registerArmorRepairSettings() {
  game.settings.register(MODULE_ID, ARMOR_REPAIR_SETTING, {
    name: "Armor repair times",
    scope: "world",
    config: false,
    type: Object,
    default: { enabled: false, techOnly: false, days: {} },
  });
  game.settings.registerMenu(MODULE_ID, "armorRepair", {
    name: "Armor Repair Times",
    label: "Configure Armor Repair Times",
    hint: "Optional armor repair durations, with a TECH-only option.",
    icon: "fas fa-screwdriver-wrench",
    type: ArmorRepairSettings,
    restricted: true,
  });
}
