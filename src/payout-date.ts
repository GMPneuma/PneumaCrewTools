import { LAST_PAYOUT_DATE_SETTING, MODULE_ID } from "./constants";

export function registerPayoutDateSetting(): void {
  game.settings.register(MODULE_ID, LAST_PAYOUT_DATE_SETTING, {
    name: "Last Payout Date",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
}

export function getLastPayoutDate(): string {
  const value = game.settings.get(MODULE_ID, LAST_PAYOUT_DATE_SETTING);
  return typeof value === "string" ? value : "";
}

export async function saveLastPayoutDate(value: string): Promise<void> {
  await game.settings.set(MODULE_ID, LAST_PAYOUT_DATE_SETTING, value.trim());
}

// Foundry v13 migration note: when Cyberpunk RED supports v13, this default
// may be seeded from GameTime/CalendarData without adding a calendar UI here.
