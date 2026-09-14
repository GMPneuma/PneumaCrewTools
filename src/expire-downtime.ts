import { startNextDowntimeSession } from "./downtime-service";
export async function confirmExpireDowntime(): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    new Dialog({
      title: "Expire Unused Downtime?",
      content:
        "<p>Expire every character's unused downtime now?</p><p>Days already allocated to hustles, therapy and projects remain. Active Medtech workdays must be finished first.</p>",
      buttons: {
        cancel: { label: "Cancel", callback: () => resolve(false) },
        expire: {
          label: "Expire Unused Downtime",
          callback: () => resolve(true),
        },
      },
      default: "cancel",
      close: () => resolve(false),
    }).render(true);
  });
  if (!confirmed) return;
  await startNextDowntimeSession();
  ui.notifications.info(
    "Unused downtime expired. The next downtime session has started.",
  );
}
