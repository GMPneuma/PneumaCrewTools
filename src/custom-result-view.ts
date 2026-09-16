import { recordEscape as esc } from "./journal-format";
import {
  customResultDescription,
  type CustomProgress,
} from "./custom-downtime-model";

export function customResultHtml(
  result: NonNullable<CustomProgress["result"]>,
  interactive = false,
): string {
  // Older saved results appended an inline payout summary to the original tags.
  const oldSummary =
    " — " +
    result.rewards
      .map((r) => r.type + " " + r.formula + " = " + r.amount)
      .join("; ");
  const text =
    result.rewards.length && result.text.endsWith(oldSummary)
      ? result.text.slice(0, -oldSummary.length)
      : result.text;
  const description = result.rewards.length
    ? customResultDescription(text)
    : text;
  const rows = result.rewards
    .map((reward, index) => {
      const amount =
        reward.amount === null
          ? "Pending"
          : (reward.amount >= 0 ? "+" : "") + reward.amount;
      const dice = reward.formula.includes("d");
      const control =
        reward.amount === null && interactive
          ? ` <button type="button" data-custom-reward="${index}"><i class="fas fa-dice" aria-hidden="true"></i> Roll ${esc(reward.formula)}</button>`
          : dice
            ? " (" + esc(reward.formula) + ")"
            : "";
      return (
        "<li><strong>" +
        esc(reward.type) +
        ":</strong> " +
        esc(amount) +
        control +
        "</li>"
      );
    })
    .join("");
  return (
    '<div class="custom-result-heading">Result</div><div class="custom-activity-result-text">' +
    esc(description) +
    "</div>" +
    (rows
      ? '<div class="custom-result-heading">Payouts<span class="custom-result-status">' +
        (result.applied ? "Applied" : "Pending") +
        '</span></div><ul class="custom-activity-payouts">' +
        rows +
        "</ul>"
      : '<p class="notes">No payouts for this result.</p>') +
    (interactive &&
    !result.applied &&
    result.rewards.every((r) => r.amount !== null)
      ? '<button type="button" data-custom-apply>Apply Saved Payouts</button>'
      : "") +
    '<p class="notes custom-result-note">' +
    (result.applied
      ? "Saved in Downtime Log."
      : result.rewards.some((r) => r.amount === null)
        ? "Roll each pending payout to apply all rewards and losses together. You can close this window and choose Continue Result later; completed rolls are saved."
        : "Payouts pending. Apply the saved payouts to retry.") +
    "</p>"
  );
}
