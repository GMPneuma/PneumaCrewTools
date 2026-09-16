import type { ActivityRecord } from "./activity-records";
import { customResultHtml } from "./custom-result-view";
import {
  downtimeBalance,
  type DowntimeEvent,
  type DowntimeState,
} from "./downtime-model";
import { displayDate } from "./date-format";
import {
  journalTable,
  storedDetails,
  readableRecord,
  recordEscape,
} from "./journal-format";

// Read only the saved outcome, so later table edits cannot rewrite history.
function actionOutput(event: DowntimeEvent): string {
  const result = event.custom?.result;
  const reason =
    result && event.custom
      ? event.custom.definition.name + " — table " + result.tableTotal
      : event.reason || event.kind;
  const text = result?.text ?? event.hustleReward?.resultText;
  if (result) return recordEscape(reason) + customResultHtml(result);
  return (
    recordEscape(reason) +
    (text
      ? '<div style="margin-top:0.35em;white-space:pre-wrap">' +
        recordEscape(text) +
        "</div>"
      : "")
  );
}

// Render stored records without fetching or changing Foundry documents.
export function activityHtml(records: ActivityRecord[]): string {
  const table = (rows: ActivityRecord[]) =>
    journalTable(
      ["Activity", "Type", "Progress", "Status", "Latest result"],
      rows.map((r) => [
        recordEscape(r.name),
        recordEscape(
          {
            tech: "TECH",
            patient: "Therapy · Patient",
            provider: "Therapy · Provider",
            medicalDay: "Medical work",
          }[r.kind],
        ),
        recordEscape(
          r.progress.value +
            " / " +
            r.progress.required +
            " " +
            r.progress.unit,
        ),
        recordEscape(r.status),
        recordEscape(r.events.at(-1)?.text ?? ""),
      ]),
    );
  const active = records.filter((r) => r.status === "active");
  const finished = records.filter((r) => r.status !== "active").reverse();
  return (
    "<p>Project and treatment progress for this character.</p>" +
    "<h2>Active</h2>" +
    table(active) +
    (finished.length
      ? "<details><summary>Completed and closed activities (" +
        finished.length +
        ")</summary>" +
        table(finished) +
        "</details>"
      : "") +
    storedDetails(
      records,
      "Project and treatment records are stored in flags.pneuma-crewtools.activities. Day charges appear in Downtime Log; editing text changes neither.",
    )
  );
}

export function resourceTransactionsHtml(
  state: DowntimeState,
  guards: unknown[] = [],
): string {
  const events = state.events.map(
    ({ tech, techCheck, techDelivery, ...event }) => event,
  );
  return (
    "<p><strong>Available downtime: " +
    (state.accounts[0]
      ? downtimeBalance(state, state.accounts[0].actorId)
      : 0) +
    " days</strong></p><p>Downtime awards and spending · Session " +
    state.period +
    "</p>" +
    journalTable(
      ["Date", "Activity / Result", "Days", "Resource change"],
      [...events]
        .reverse()
        .map((e) => [
          recordEscape(displayDate(e.date)),
          actionOutput(e),
          e.days ? (e.kind === "award" ? "+" : "−") + e.days : "—",
          recordEscape(
            e.resources
              ?.map((r) => r.resource + ": " + r.before + " → " + r.after)
              .join("; ") ??
              (e.healing
                ? "HP: " + e.healing.before + " → " + e.healing.after
                : e.hustleReward
                  ? "Money: " +
                    e.hustleReward.before +
                    " → " +
                    e.hustleReward.after
                  : ""),
          ),
        ]),
    ) +
    (guards.length
      ? "<h2>Actions needing review</h2><p>Payment in progress or interrupted action: review the recorded attempt before retrying.</p>" +
        readableRecord(guards)
      : "") +
    storedDetails(
      events,
      "Awards add days; spending and allocations subtract them. Transactions and the current balance are stored on this page in flags.pneuma-crewtools.downtime and downtimeBalance. Editing text does not change balances.",
    )
  );
}
