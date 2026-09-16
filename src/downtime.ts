import { PRIVATE_ROLLS_SETTING } from "./roll-visibility";
import { FULL_WEEK_SETTING } from "./downtime-settings";
import { coalesceRefresh, isCrewPage } from "./ui-refresh";
// Public entry point and window lifecycle; rules and storage are separate modules.
import { DowntimeForm } from "./downtime-form";
import { invalidateMedicalCatalog } from "./medtech";

import { isDowntimeGM, scheduleDowntimeMaintenance } from "./downtime-service";
import { registerTechSettings } from "./tech-projects";
import { MULTIPLY_ANTIBIOTIC_SETTING } from "./downtime-healing";
import { EXCLUDED_ACTORS_SETTING } from "./actor-policy";
import { MODULE_ID } from "./constants";
export * from "./downtime-service";
export { getDowntime } from "./downtime-store";
export { DowntimeForm } from "./downtime-form";
let window: DowntimeForm | undefined;
export function openDowntime(actorId?: string): void {
  window ??= new DowntimeForm();
  window.selectedActorId = actorId;
  window.render(true);
}

export function registerDowntime(): void {
  registerTechSettings();
  game.settings.register(MODULE_ID, PRIVATE_ROLLS_SETTING, {
    name: "Private activity rolls",
    hint: "Show hustle, therapy, Humanity, TECH crafting, Medtech, and Loyalty roll results only to the character's owners and GMs. Disabled: results appear in public chat.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, FULL_WEEK_SETTING, {
    name: "Must have 7 downtime days available for hustle and therapy",
    hint: "Spend all seven days at once when rolling a hustle or starting therapy. Applies to patients and Medtechs; reserved medical workdays are unavailable.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, MULTIPLY_ANTIBIOTIC_SETTING, {
    name: "Multiply antibiotic bonus",
    hint: "Include the +2 HP antibiotic bonus before Enhanced Antibodies and cryotank multipliers. Disable to add it afterward.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      if (window?.rendered) window.render(false);
    },
  });
  const refreshRoles = coalesceRefresh(() => {
    if (window?.rendered) window.render(false);
  });
  Hooks.on("updateSetting", (setting?: { key?: string }) => {
    if (setting?.key?.startsWith(MODULE_ID + ".")) refreshRoles();
    if (
      setting?.key === MODULE_ID + "." + EXCLUDED_ACTORS_SETTING &&
      isDowntimeGM()
    )
      scheduleDowntimeMaintenance();
  });
  const roleChanged = (item: FoundryItem) => {
    if (item.type === "drug" || item.type === "criticalInjury") {
      invalidateMedicalCatalog();
      if (item.parent?.documentName !== "Actor") refreshRoles();
    }
    if (item.parent?.id === window?.selectedActorId) refreshRoles();
    if (item.type === "role" && item.parent?.documentName === "Actor")
      scheduleDowntimeMaintenance(item.parent.id);
  };
  Hooks.on("updateCompendium", (pack) => {
    if (!/critical.injur|drugs/i.test(pack.collection)) return;
    invalidateMedicalCatalog(true);
    refreshRoles();
  });
  Hooks.on("createItem", roleChanged);
  Hooks.on("updateItem", roleChanged);
  Hooks.on("deleteItem", roleChanged);
  Hooks.on("createActor", (actor: FoundryActor) => {
    if (["character", "mook"].includes(actor.type)) refreshRoles();
    scheduleDowntimeMaintenance(actor.id);
  });
  Hooks.on("deleteActor", (actor) => {
    if (["character", "mook"].includes(actor.type)) refreshRoles();
  });
  Hooks.on(
    "updateActor",
    (actor: FoundryActor, changes: Record<string, unknown>) => {
      const membership = Object.keys(changes).some((key) =>
        /^(name|ownership|type)(\.|$)/.test(key),
      );
      if (membership || actor.id === window?.selectedActorId) refreshRoles();
      if (membership) scheduleDowntimeMaintenance(actor.id);
    },
  );
  const refreshPage = (page: FoundryJournalPage) => {
    // Catalog edits refresh the same Other Activity section for open player forms.
    if (page.getFlag?.(MODULE_ID, "recordKey") === "customActivities") {
      refreshRoles();
      return;
    }
    if (!isCrewPage(page)) return;
    const actorId = page.parent?.getFlag?.(MODULE_ID, "actorId");
    if (
      !actorId ||
      actorId === window?.selectedActorId ||
      page.getFlag?.(MODULE_ID, "recordKey") === "hq"
    )
      refreshRoles();
  };
  Hooks.on("updateJournalEntryPage", refreshPage);
  Hooks.on("createJournalEntryPage", refreshPage);
  Hooks.on("deleteJournalEntryPage", refreshPage);
  Hooks.on("userConnected", () => scheduleDowntimeMaintenance());
}

export function readyDowntime(): void {
  scheduleDowntimeMaintenance();
}
