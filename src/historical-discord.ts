import { displayDate } from "./date-format";
import type { PayoutRecord, PayoutChange } from "./payout-record";
import type { DiscordLinks } from "./discord-summary";

// Historical exports use only saved rewards and names; current links supply optional mentions.
export function historicalDiscordMarkdown(
  record: PayoutRecord,
  links: DiscordLinks,
): string {
  const lines = [`## ${record.sessionLabel}`, ""];
  if (record.inGameDate)
    lines.push(`**In-Game Date:** ${displayDate(record.inGameDate)}`);
  if (record.notes) lines.push(`**Notes:** ${record.notes}`);
  if (record.correctsRecordId)
    lines.push(`**Correction of payout:** ${record.correctsRecordId}`);
  const names = new Map(
    record.participants.map((p) => [p.actorId, p.actorName]),
  );
  for (const [scope, title] of [
    ["communal", "Communal Payout"],
    ["group", "Primary Payout"],
    ["individual", "Individual Payout"],
    ["absent", "Downtime — not in payout"],
  ]) {
    const changes = record.changes.filter(
      (c) =>
        c.reward !== "attendance" &&
        (c.reward === "hqIp" ||
        c.reward === "communalMoney" ||
        c.details?.scope === "communal"
          ? "communal"
          : c.details?.scope === "group"
            ? "group"
            : c.details?.scope === "absent"
              ? "absent"
              : "individual") === scope,
    );
    if (!changes.length) continue;
    lines.push("", `**${title}**`);
    for (const change of changes) {
      const name =
        change.targetName ||
        (change.targetId ? names.get(change.targetId) : undefined) ||
        "Crew";
      const link = change.targetId ? links[change.targetId] : undefined;
      const mention =
        scope !== "communal" && link
          ? `<@${link.kind === "role" ? "&" : ""}${link.id}> — `
          : "";
      lines.push(`- ${mention}**${name}:** ${award(change)}`);
    }
  }
  return lines.join("\n").trim();
}

function award(change: PayoutChange): string {
  const labels: Record<string, string> = {
    money: "Money",
    communalMoney: "Money",
    ip: "IP",
    hqIp: "HQ IP",
    humanityGain: "Gain Humanity",
    humanityLoss: "Lose Humanity",
    reputation: "Reputation",
    factionReputation: "Faction Reputation",
    downtime: "Downtime",
    item: "Item",
  };
  const details = change.details ?? {};
  let label = labels[change.reward] ?? change.reward;
  if (change.reward === "item") label += `: ${details.itemName ?? "Unknown"}`;
  if (details.faction) label += ` (${details.faction})`;
  const signed =
    change.amount >= 0 ? `+${change.amount}` : String(change.amount);
  const value = details.pendingPlayerRoll
    ? `${details.formula ?? "Player roll"} (pending at payout)`
    : change.reward === "item"
      ? `×${change.amount}`
      : change.reward === "downtime"
        ? `${signed} ${Math.abs(change.amount) === 1 ? "day" : "days"}`
        : change.previousValue !== null && change.newValue !== null
          ? `${change.previousValue} → ${change.newValue} (${signed})`
          : signed;
  return `**${label}:** ${value}${details.description ? ` — ${details.description}` : ""}`;
}
