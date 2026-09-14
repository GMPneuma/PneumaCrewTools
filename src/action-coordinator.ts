// Shared sequencing belongs to application services, not a particular feature.
let queue: Promise<unknown> = Promise.resolve();
export function isPrimaryGM(): boolean {
  return (
    game.user?.isGM === true &&
    Array.from(game.users)
      .filter((u) => u.active && u.isGM)
      .sort((a, b) => a.id.localeCompare(b.id))[0]?.id === game.user.id
  );
}
export function queueAction<T>(action: () => Promise<T>): Promise<T> {
  const run = queue.then(action);
  queue = run.catch(() => undefined);
  return run;
}
export function withGMAction<T>(action: () => Promise<T>): Promise<T> {
  return queueAction(async () => {
    if (!isPrimaryGM())
      throw new Error(
        "The first active GM manages downtime and payouts. Ask that GM to apply this action.",
      );
    return action();
  });
}
