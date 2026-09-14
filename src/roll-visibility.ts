import { MODULE_ID } from "./constants";
export const PRIVATE_ROLLS_SETTING = "privateActivityRolls";
// Explicit recipients keep module rolls independent of the user's last native roll mode.
export function activityRollRecipients(
  actor?: FoundryActor,
  userId?: string,
): string[] {
  if (game.settings.get(MODULE_ID, PRIVATE_ROLLS_SETTING) !== true) return [];
  return Array.from(game.users)
    .filter(
      (user) =>
        user.isGM ||
        user.id === userId ||
        actor?.testUserPermission(user, "OWNER"),
    )
    .map((user) => user.id);
}
