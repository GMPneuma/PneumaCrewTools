import { registerRentSettings } from "./rent-form";
import { registerRentReconciliation } from "./rent";
import { registerPharmaTransfers } from "./pharma-transfer";
import { registerFactions } from "./factions";
import {
  ensureActorPayoutJournal,
  findRecordJournal,
  refreshRecordTables,
} from "./journal-records";
import { registerHustleTables, readyHustleTables } from "./hustle-tables";
import { registerActorExclusions } from "./actor-exclusions";
import { registerSettingsLayout } from "./settings-layout";
import { registerCrewHud, readyCrewHud } from "./crew-hud";
import { registerHeadquarters, readyHeadquarters } from "./headquarters";
import {
  registerDowntime,
  readyDowntime,
  withDowntimeLock,
  isDowntimeGM,
} from "./downtime";
import { registerCampaignCalendar, readyCampaignCalendar } from "./calendar";
import { registerUiAppearance, applyUiAppearance } from "./ui-appearance";
import "./styles/pneuma-crewtools.css";
import { pneumaCrewToolsApi } from "./api";
import { MODULE_ID } from "./constants";
import { registerDiscordLinks } from "./discord-summary";
import {
  hasInboxItemsForCurrentUser,
  openPlayerHub,
  registerPayoutInboxSettings,
} from "./payout-inbox";
import {
  ensurePayoutJournal,
  registerPayoutJournalSettings,
} from "./payout-journal";
import { registerHumanityPromptHandler } from "./humanity-prompts";
import { registerPayoutDateSetting } from "./payout-date";
import { registerPayoutContainerSettings } from "./payout-container";
import { registerPayoutDataManager } from "./payout-data-manager";
import { registerPayoutWindowControl } from "./window-controls";

// Foundry v12 requests scene controls before the init hook fires, so this
// listener must be registered as soon as the module script is evaluated.
registerPayoutWindowControl();
registerHumanityPromptHandler();

Hooks.once("init", () => {
  console.info(`${MODULE_ID} | Initializing`);

  registerActorExclusions();
  registerFactions();
  registerPharmaTransfers();
  registerRentSettings();
  registerRentReconciliation();
  registerUiAppearance();
  registerSettingsLayout();
  registerCampaignCalendar();
  registerCrewHud();
  registerDowntime();
  registerHeadquarters();
  registerHustleTables();
  registerDiscordLinks();
  registerPayoutJournalSettings();
  registerPayoutInboxSettings();
  registerPayoutDateSetting();
  registerPayoutContainerSettings();
  registerPayoutDataManager();

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = pneumaCrewToolsApi;
});

Hooks.once("ready", () => {
  console.info(`${MODULE_ID} | Ready`);
  applyUiAppearance();
  readyCampaignCalendar();
  readyCrewHud();
  readyDowntime();
  readyHeadquarters();
  readyHustleTables();
  if (isDowntimeGM()) {
    void withDowntimeLock(async () => {
      await ensurePayoutJournal();
      await refreshRecordTables();
      // Only the retired module-tagged duplicate log is removed; the ledger remains authoritative.
      for (const journal of Array.from(game.journal))
        if (journal.getFlag?.(MODULE_ID, "recordKind") === "payoutLog")
          await journal.delete();
      for (const actor of game.actors) {
        if (findRecordJournal("character", actor.id))
          await ensureActorPayoutJournal(actor);
      }
    }).catch((error) => ui.notifications.error(String(error)));
  }
  if (!game.user?.isGM && hasInboxItemsForCurrentUser()) openPlayerHub();
});

// Keep private payout Journal permissions aligned with native character ownership.
Hooks.on(
  "updateActor",
  (actor: FoundryActor, changes: Record<string, unknown>) => {
    if (
      isDowntimeGM() &&
      ("name" in changes || "ownership" in changes) &&
      findRecordJournal("character", actor.id)
    )
      void withDowntimeLock(() => ensureActorPayoutJournal(actor)).catch(
        (error) => ui.notifications.error(String(error)),
      );
  },
);
