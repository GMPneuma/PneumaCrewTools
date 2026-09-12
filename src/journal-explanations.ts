/** Plain-language notes kept alongside each generated Journal page. */
export function journalExplanation(
  kind: "hq" | "reputation" | "attendance" | "payout-log",
): string {
  const notes = {
    hq: [
      [
        "Purpose",
        "A shared reference for headquarters improvements and HQ Improvement Points (IP). All players can read this page; GMs can edit it.",
      ],
      [
        "How to read it",
        "Current HQ IP is the sum of the Adjustment column in HQ IP Journal. Positive numbers add IP; negative numbers spend or remove IP. Purchased Improvements lists the improvement name and its recorded IP cost. Date and Reason describe each adjustment.",
      ],
      [
        "What changes it",
        "Applying a payout adds its HQ IP entries. Saving GM edits recalculates the displayed total from the adjustment table. Adding an improvement does not automatically spend IP: record the matching negative adjustment separately.",
      ],
      [
        "Editing and storage",
        "Keep the HQ page name, section headings, table order, and columns intact. The total is calculated, so edit adjustments instead. Manual HQ edits live on this page; the inherited module also stores payout-generated HQ entries separately in world settings. Manual table edits do not update that separate data. Clearing HQ data replaces these tables.",
      ],
    ],
    reputation: [
      [
        "Purpose",
        "A shared list of each character's reputation with particular factions. All players can read it; GMs control the payouts that update it.",
      ],
      [
        "How to read it",
        "Actor is the character's name. Reputation is the recorded score for the named Faction. Reason describes the latest recorded change. Each row represents one character and faction, not a full history.",
      ],
      [
        "What changes it",
        "A payout with faction reputation updates that character's row for that faction. This table is separate from the standard Reputation value on the character sheet.",
      ],
      [
        "Editing and storage",
        "This page is generated from world settings in the current implementation. Direct edits do not change those settings or the character sheet and are replaced when the page refreshes. Keep personal notes on a separate page.",
      ],
    ],
    attendance: [
      [
        "Purpose",
        "A shared attendance summary based on who receives payouts. All players can read it.",
      ],
      [
        "How to read it",
        "Player is the Foundry account, not the character. Sessions Played counts that account's participation in applied payouts. Last Session is the latest payout's session label. A dash means no session label is recorded.",
      ],
      [
        "What changes it",
        "Each applied payout adds one to the count for each selected player. Applying more than one payout with the same session label counts each payout; the module does not merge matching labels. Rows are sorted by count, then player name.",
      ],
      [
        "Editing and storage",
        "This summary is generated from world settings. Direct edits do not update those settings and are replaced when the page refreshes. It does not monitor connections or track time spent online.",
      ],
    ],
    "payout-log": [
      [
        "Purpose",
        "A GM-only record of one applied payout. This page is written when the GM applies the payout; reading or editing it does not apply, reverse, or repeat that payout.",
      ],
      [
        "How to read it",
        "The page name contains the session label and any entered game date. Recipients and Notes provide context. Communal Payout lists shared awards; Primary Payout lists awards intended for each selected character; Individual Payouts lists character-specific awards. Amount uses signed adjustments, item quantities marked with ×, days, or a dice formula. None means that section has no entries.",
      ],
      [
        "Limits and storage",
        "Amounts and formulas describe the payout plan. This page is not a complete list of resolved rolls or before-and-after balances. The current implementation keeps the detailed payout ledger separately in world settings. Editing this page does not update that ledger or any Actor, Item, pending roll, or player acknowledgment.",
      ],
      [
        "Removal",
        "Deleting this page removes this written summary only; it does not undo rewards. The Module Data history-clear action also clears the separate payout ledger. Saved page text remains readable when the module is disabled.",
      ],
    ],
  };
  return `<h2>About this page</h2>${notes[kind].map(([label, text]) => `<p><strong>${label}:</strong> ${text}</p>`).join("")}<hr>`;
}
