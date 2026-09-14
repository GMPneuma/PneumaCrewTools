import type { PlayerAccount } from "./player-discovery";
import type { PayoutActorInput } from "./payout-execution";
// Use the same eligible Actor ordering as the participant picker: assigned first, then name.
// A shared Actor receives at most one award, and participating players never receive a second one.
export function absentRecipients(
  accounts: PlayerAccount[],
  present: PayoutActorInput[],
  choices: Map<string, string> = new Map(),
) {
  const users = new Set(present.map((p) => p.participant.userId));
  const actors = new Set(present.map((p) => p.actor.id));
  return accounts.flatMap((account) => {
    if (users.has(account.userId)) return [];
    const choice =
      account.actors.find((a) => a.actorId === choices.get(account.userId)) ??
      account.actors[0];
    if (!choice || actors.has(choice.actorId)) return [];
    actors.add(choice.actorId);
    return [
      {
        userId: account.userId,
        userName: account.userName,
        actorId: choice.actorId,
        actorName: choice.actorName,
      },
    ];
  });
}
// Nonparticipant awards are independent of primary awards and require explicit opt-in.
export function syncAbsentDowntimeControl(root: HTMLElement): void {
  const grant = root.querySelector<HTMLInputElement>(
    '[name="grantAbsentDowntime"]',
  );
  const absent = root.querySelector<HTMLInputElement>(
    '[name="absentDowntime"]',
  );
  if (grant) grant.disabled = false;
  if (absent) absent.disabled = !grant?.checked;
}

export function populateTimeDowntime(root: HTMLElement): void {
  const value = Number(
    root.querySelector<HTMLInputElement>('[name="advanceDays"]')?.value,
  );
  if (!Number.isSafeInteger(value) || value < 0) return;
  const primary = root.querySelector<HTMLInputElement>(
    '[name="groupDowntime"]',
  );
  const absent = root.querySelector<HTMLInputElement>(
    '[name="absentDowntime"]',
  );
  if (primary) primary.value = String(Math.max(0, value - 1));
  if (absent) absent.value = String(value);
  syncAbsentDowntimeControl(root);
}
