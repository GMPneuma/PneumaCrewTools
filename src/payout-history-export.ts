import { getPayoutLedger } from "./payout-ledger";
import { getDiscordLinks, showDiscordSummary } from "./discord-summary";
import { historicalDiscordMarkdown } from "./historical-discord";
import { escape } from "./downtime-store";
import { displayDate } from "./date-format";

// This read-only picker never calls payout execution or writes to the ledger.
export function openPayoutHistoryExport(): void {
  if (!game.user?.isGM) throw new Error("Only a GM can export payout history.");
  const records = [...getPayoutLedger().records].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  if (!records.length) {
    ui.notifications.info("No recorded payouts to export.");
    return;
  }
  new Dialog({
    title: "Export Payout to Discord",
    content:
      '<p>Choose a recorded payout. Exporting does not apply rewards.</p><label>Recorded payout<select name="payoutRecord" style="width:100%;margin:0.5rem 0 1rem">' +
      records
        .map(
          (record) =>
            '<option value="' +
            escape(record.id) +
            '">' +
            escape(
              record.sessionLabel +
                (record.inGameDate
                  ? " — " + displayDate(record.inGameDate)
                  : "") +
                " · " +
                record.createdAt,
            ) +
            "</option>",
        )
        .join("") +
      "</select></label>",
    buttons: {
      export: {
        label: "Show Discord Markdown",
        callback: (html) => {
          if (!game.user?.isGM) return;
          const id = html[0]?.querySelector<HTMLSelectElement>(
            '[name="payoutRecord"]',
          )?.value;
          const record = records.find((record) => record.id === id);
          if (record)
            showDiscordSummary(
              historicalDiscordMarkdown(record, getDiscordLinks()),
            );
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "export",
  }).render(true);
}
