/** Brief, optional explanations; tables remain the main content. */
export function journalExplanation(kind: "reputation" | "attendance"): string {
  const text =
    kind === "attendance"
      ? "Each applied payout counts once per selected character, even when session labels match. Last Session shows the payout name. Excluded characters are hidden; this does not track time online."
      : "Current faction reputation by character, updated through payouts. This is separate from Reputation on the character sheet.";
  return (
    "<details><summary>About this page</summary><p>" +
    text +
    " Records use Actor IDs and are stored in flags.pneuma-crewtools.data. Editing text does not change them.</p></details>"
  );
}
