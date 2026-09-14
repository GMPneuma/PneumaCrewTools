import { MODULE_ID } from "./constants";
// Batch hooks across awaited writes, with a 250 ms maximum postponement.
export function coalesceRefresh(refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = 0;
  return () => {
    if (timer === undefined) started = Date.now();
    else clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = undefined;
        refresh();
      },
      Math.max(0, Math.min(75, 250 - (Date.now() - started))),
    );
  };
}
export function isCrewPage(page: FoundryJournalPage): boolean {
  return ["recordKey", "kind"].some(
    (key) => page.getFlag?.(MODULE_ID, key) !== undefined,
  );
}
