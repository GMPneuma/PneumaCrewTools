import { recordEscape as escape } from "./journal-format";

// Shared presentation only: callers post these after their resource changes commit.
export interface RollCard {
  title: string;
  subject: string;
  outcome: string;
  success: boolean;
  tone?: "neutral";
  actions?: Array<{ action: string; label: string }>;
  check?: { total: number; dv: number; label: string; targetLabel?: string };
  detail?: string;
  effect?: string;
}
export function rollCard(data: RollCard): string {
  const status = data.tone ?? (data.success ? "success" : "failure");
  return `<div class="rollcard crewtools-roll"><div class="rollcard-top"><div class="cpr-block crewtools-roll-card">
    <div class="crewtools-roll-title ${status}"><h3>${escape(data.title)}</h3><strong class="crewtools-roll-outcome ${status}">${escape(data.outcome)}</strong></div>
    <p class="crewtools-roll-subject">${escape(data.subject)}</p>
    ${data.check ? `<div class="crewtools-roll-check"><span>${escape(data.check.label)}</span><strong>${escape(data.check.total)} <small>${escape(data.check.targetLabel ?? "vs DV")} ${escape(data.check.dv)}</small></strong></div>` : ""}
    ${data.detail ? `<p class="crewtools-roll-detail">${escape(data.detail)}</p>` : ""}
    ${data.effect ? `<div class="crewtools-roll-effect ${status}">${escape(data.effect)}</div>` : ""}
    ${data.actions?.length ? `<div class="crewtools-card-actions">${data.actions.map((a) => `<button type="button" data-crew-action="${escape(a.action)}">${escape(a.label)}</button>`).join("")}</div>` : ""}
  </div></div></div>`;
}
