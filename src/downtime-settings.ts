import { MODULE_ID } from "./constants";
export const FULL_WEEK_SETTING = "requireFullDowntimeWeek";
// This world rule applies equally to player and GM action entry points.
export function requiresFullDowntimeWeek(): boolean {
  return game.settings.get(MODULE_ID, FULL_WEEK_SETTING) === true;
}
