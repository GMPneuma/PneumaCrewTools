import { MODULE_ID } from "./constants";
export const SHORTCUT_DISPLAY_SETTING = "shortcutDisplay";
// Scene controls can be requested before init registers settings; retain the existing default then.
export function shortcutDisplay(): "both" | "hud" | "token" {
  try {
    const value = game.settings.get(MODULE_ID, SHORTCUT_DISPLAY_SETTING);
    return value === "hud" || value === "token" ? value : "both";
  } catch {
    return "both";
  }
}
export function showHudShortcuts(): boolean {
  return shortcutDisplay() !== "token";
}
export function showTokenShortcuts(): boolean {
  return shortcutDisplay() !== "hud";
}
// Client scope lets players select their own controls without changing other players' screens.
export function registerShortcutDisplay(refreshHud: () => void): void {
  game.settings.register(MODULE_ID, SHORTCUT_DISPLAY_SETTING, {
    name: "Crew Tools shortcut location",
    hint: "Choose where Crew Tools shortcut buttons appear on this device. The calendar remains visible.",
    scope: "client",
    config: true,
    type: String,
    default: "both",
    choices: { hud: "HUD only", token: "Token Controls only", both: "Both" },
    onChange: () => {
      refreshHud();
      // Foundry v12 rebuilds and renders the native controls through initialize.
      ui.controls?.initialize();
    },
  });
}
