import { MODULE_ID } from "./constants";
import { actorLedger, getDowntime, ledgerHtml } from "./downtime-store";
import { withGMAction } from "./action-coordinator";
import { withResourceLock } from "./resource-lock";
import { recordEscape as escape } from "./journal-format";

export function interruptedTechAttempt(actorId: string): unknown {
  return actorLedger(actorId)?.getFlag?.(MODULE_ID, "techAttempt");
}

export function clearInterruptedTechAttempt(
  actorId: string,
  expected: unknown,
  note: string,
): Promise<void> {
  return withGMAction(() =>
    withResourceLock(async () => {
      if (!game.user?.isGM)
        throw new Error("Only the GM can clear a TECH blocker.");
      const ledger = actorLedger(actorId);
      if (!ledger) throw new Error("The character's Downtime Log is missing.");
      const pending = interruptedTechAttempt(actorId);
      if (!pending || JSON.stringify(pending) !== JSON.stringify(expected))
        throw new Error(
          "The TECH attempt changed. Reopen the review before clearing it.",
        );
      if (!note.trim() || note.trim().length > 1000)
        throw new Error("Enter a review note of 1–1000 characters.");
      const previous = ledger.getFlag?.(MODULE_ID, "techRecoveries");
      if (
        previous !== undefined &&
        previous !== null &&
        !Array.isArray(previous)
      )
        throw new Error(
          "TECH recovery history is invalid. Inspect the Downtime Log.",
        );
      const history = [
        ...(Array.isArray(previous) ? previous : []),
        {
          clearedAt: new Date().toISOString(),
          gmId: game.user.id,
          gmName: game.user.name ?? game.user.id,
          note: note.trim(),
          attempt: structuredClone(pending),
        },
      ];
      const overrides = { techAttempt: null, techRecoveries: history };
      // Clearing and retaining the exact attempt share one native page update.
      await ledger.update({
        [`flags.${MODULE_ID}.techAttempt`]: null,
        [`flags.${MODULE_ID}.techRecoveries`]: history,
        "text.content": ledgerHtml(getDowntime(actorId), overrides),
      });
    }),
  );
}

export async function reviewInterruptedTechAttempt(
  actorId: string,
): Promise<void> {
  if (!game.user?.isGM)
    throw new Error("Only the GM can review a TECH blocker.");
  const attempt = structuredClone(interruptedTechAttempt(actorId));
  if (!attempt)
    throw new Error("This character has no interrupted TECH attempt.");
  const fields =
    typeof attempt === "object" && attempt !== null
      ? (attempt as Record<string, unknown>)
      : {};
  const links: Array<{ label: string; uuid: string }> = [];
  if (typeof fields.sourceUuid === "string" && fields.sourceUuid)
    links.push({ label: "Original / source Item", uuid: fields.sourceUuid });
  for (const [label, actorKey, itemKey] of [
    [
      "Project reference / destination Item",
      "destinationActorId",
      "destinationItemId",
    ],
    ["Stack remainder", "remainderActorId", "remainderItemId"],
  ]) {
    if (
      typeof fields[actorKey!] === "string" &&
      typeof fields[itemKey!] === "string"
    )
      links.push({
        label: label!,
        uuid: `Actor.${fields[actorKey!]}.Item.${fields[itemKey!]}`,
      });
  }
  await new Promise<void>((resolve) => {
    class RecoveryDialog extends Dialog {
      override async submit(button: DialogButtonConfig): Promise<void> {
        if (button.label !== "Clear TECH Blocker") {
          await super.submit(button);
          return;
        }
        const html = this.element;
        const confirmed = html[0]?.querySelector<HTMLInputElement>(
          "[data-tech-recovery-confirm]",
        )?.checked;
        const note =
          html[0]?.querySelector<HTMLTextAreaElement>(
            "[data-tech-recovery-note]",
          )?.value ?? "";
        if (!confirmed || !note.trim()) {
          ui.notifications.warn(
            "Review the items and project records, confirm, and enter a review note before clearing.",
          );
          return;
        }
        try {
          await clearInterruptedTechAttempt(actorId, attempt, note);
          ui.notifications.info(
            "TECH blocker cleared. The saved attempt remains in the Downtime Log recovery history.",
          );
          await this.close();
        } catch (error) {
          ui.notifications.error(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    new RecoveryDialog(
      {
        title:
          "Review Interrupted TECH Action — " +
          (game.actors.get(actorId)?.name ?? actorId),
        content: `<div class="crewtools-tech-recovery"><p>Review the original Item, project reference, any stack remainder, and Active Projects. Reconcile partial changes before clearing this blocker.</p><p>Clearing enables further TECH actions. It does not undo Item changes, refund days, complete the project, or fix the original failure.</p>${links.length ? `<ul>${links.map((link) => `<li><a class="content-link" data-uuid="${escape(link.uuid)}"><i class="fas fa-suitcase" aria-hidden="true"></i> ${escape(link.label)}</a></li>`).join("")}</ul>` : ""}<details><summary>Saved attempt details</summary><pre>${escape(JSON.stringify(attempt, null, 2))}</pre></details><p><label>Review note<textarea data-tech-recovery-note rows="3" maxlength="1000" placeholder="What completed, what you corrected, and why retrying is appropriate"></textarea></label></p><p><label><input type="checkbox" data-tech-recovery-confirm> I reviewed the items and project records and reconciled any partial changes.</label></p></div>`,
        buttons: {
          journal: {
            label: "Open Downtime Log",
            icon: '<i class="fas fa-book-open"></i>',
            callback: () => {
              const ledger = actorLedger(actorId);
              ledger?.parent?.sheet?.render(true, { pageId: ledger.id });
            },
          },
          clear: {
            label: "Clear TECH Blocker",
            icon: '<i class="fas fa-unlock"></i>',
          },
          cancel: { label: "Keep Blocked" },
        },
        default: "cancel",
        close: resolve,
      },
      { width: 600, classes: [MODULE_ID] },
    ).render(true);
  });
}
