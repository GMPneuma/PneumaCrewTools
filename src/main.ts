import "./styles/pneuma-crewtools.css";
import { registerHqIntegration } from "./hq-integration";
import { pneumaCrewToolsApi } from "./api";
import { MODULE_ID } from "./constants";
import { registerDiscordLinks } from "./discord-summary";
import { registerPayoutLedger } from "./payout-ledger";
import { ensurePayoutLog, registerPayoutLogSettings } from "./payout-log";
import {
  hasInboxItemsForCurrentUser,
  openPayoutInbox,
  registerPayoutInboxSettings,
} from "./payout-inbox";
import {
  ensurePayoutJournal,
  registerHqIpTotalHandler,
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
registerHqIpTotalHandler();

Hooks.once("init", () => {
  console.info(`${MODULE_ID} | Initializing`);

  registerHqIntegration();
  registerPayoutLedger();
  registerDiscordLinks();
  registerPayoutJournalSettings();
  registerPayoutInboxSettings();
  registerPayoutDateSetting();
  registerPayoutLogSettings();
  registerPayoutContainerSettings();
  registerPayoutDataManager();

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = pneumaCrewToolsApi;
});

Hooks.once("ready", () => {
  console.info(`${MODULE_ID} | Ready`);
  if (game.user?.isGM) {
    void ensurePayoutJournal();
    void ensurePayoutLog();
  }
  if (!game.user?.isGM && hasInboxItemsForCurrentUser()) openPayoutInbox();
});
