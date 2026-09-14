import { displayDate } from "./date-format";
import { recordEscape, journalTable, readableRecord } from "./journal-format";

export function recordSummary(key: string, data: unknown): string {
  const rows = Array.isArray(data) ? data : null;
  if (rows && key === "pharmaTransfers")
    return journalTable(
      ["Date", "Transfer", "Pharmaceutical", "Doses", "Status"],
      rows.map((r) => [
        recordEscape(displayDate(r.date)),
        `@UUID[Actor.${recordEscape(r.sourceId)}]{${recordEscape(r.sourceName)}} → @UUID[Actor.${recordEscape(r.targetId)}]{${recordEscape(r.targetName)}}`,
        recordEscape(r.itemName),
        recordEscape(r.amount),
        recordEscape(r.status),
      ]),
    );
  if (rows && key === "factionReputation")
    return journalTable(
      ["Faction", "Reputation", "Reason"],
      rows.map((r) => [
        recordEscape(r.faction),
        recordEscape(r.reputation),
        recordEscape(r.reason),
      ]),
    );
  if (rows && key === "acknowledgments")
    return journalTable(
      ["Date", "Payout", "Awards", "Status"],
      [...rows]
        .reverse()
        .map((r) => [
          recordEscape(displayDate(r.inGameDate)),
          recordEscape(r.sessionLabel),
          (r.awards ?? [])
            .map((a: { text?: string }) => recordEscape(a.text))
            .join("<br>"),
          r.acknowledgedAt ? "Acknowledged" : "Unseen",
        ]),
    );
  if (rows && key === "humanity")
    return journalTable(
      ["Description", "Roll", "Result", "Humanity", "Status"],
      [...rows]
        .reverse()
        .map((r) => [
          recordEscape(r.description),
          recordEscape(r.formula),
          recordEscape(r.rollTotal ?? "—"),
          r.resolvedAt
            ? recordEscape(r.previousHumanity) +
              " → " +
              recordEscape(r.newHumanity)
            : "—",
          r.resolvedAt ? "Completed" : "Awaiting roll",
        ]),
    );
  if (
    data &&
    !Array.isArray(data) &&
    typeof data === "object" &&
    "changes" in data
  ) {
    return payoutSummary(data as import("./payout-record").PayoutRecord);
  }
  return readableRecord(data);
}

// Group the applied ledger changes using the familiar payout form sections.
export function payoutSummary(
  payout: import("./payout-record").PayoutRecord,
): string {
  const link = (id: string | null, name: string) =>
    id
      ? "@UUID[Actor." + recordEscape(id) + "]{" + recordEscape(name) + "}"
      : recordEscape(name);
  const labels: Record<string, string> = {
    money: "Money",
    communalMoney: "Money",
    ip: "IP",
    hqIp: "HQ IP",
    reputation: "Reputation",
    factionReputation: "Faction Reputation",
    humanityGain: "Gain Humanity",
    humanityLoss: "Lose Humanity",
    downtime: "Downtime",
    item: "Item",
  };
  const section = (
    title: string,
    changes: import("./payout-record").PayoutChange[],
  ) =>
    "<h2>" +
    title +
    "</h2>" +
    journalTable(
      ["Recipient", "Type", "Amount", "Description"],
      changes.map((c) => [
        link(
          c.targetType === "actor" || c.reward === "factionReputation"
            ? c.targetId
            : null,
          c.targetName,
        ),
        recordEscape(
          (labels[c.reward] ?? c.reward) +
            (c.details?.itemName
              ? ": " + c.details.itemName
              : c.details?.faction
                ? ": " + c.details.faction
                : ""),
        ),
        recordEscape(
          c.details?.pendingPlayerRoll
            ? String(c.details.formula) + " (awaiting roll)"
            : c.reward === "item"
              ? "×" + c.amount
              : (c.amount >= 0 ? "+" : "") +
                c.amount +
                (c.reward === "downtime" ? " days" : ""),
        ),
        recordEscape(c.details?.description ?? c.details?.reason ?? ""),
      ]),
    );
  const communal = (c: import("./payout-record").PayoutChange) =>
    c.details?.scope === "communal" ||
    c.reward === "hqIp" ||
    c.reward === "communalMoney";
  return (
    "<p><strong>In-Game Date:</strong> " +
    recordEscape(displayDate(payout.inGameDate) || "Not specified") +
    "</p><p><strong>Recipients:</strong> " +
    payout.participants.map((p) => link(p.actorId, p.actorName)).join(", ") +
    "</p><p><strong>Notes:</strong> " +
    recordEscape(payout.notes || "None") +
    "</p>" +
    section("Communal Payout", payout.changes.filter(communal)) +
    section(
      "Primary Payout",
      payout.changes.filter(
        (c) => !communal(c) && c.details?.scope === "group",
      ),
    ) +
    (payout.changes.some((c) => c.details?.scope === "absent")
      ? section(
          "Downtime — not in payout",
          payout.changes.filter((c) => c.details?.scope === "absent"),
        )
      : "") +
    section(
      "Individual Payouts",
      payout.changes.filter(
        (c) =>
          !communal(c) &&
          c.details?.scope !== "group" &&
          c.details?.scope !== "absent" &&
          c.reward !== "attendance",
      ),
    )
  );
}
