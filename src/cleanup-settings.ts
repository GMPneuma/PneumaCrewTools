import { buildCleanupTree } from "./cleanup-tree";
import { CrewToolsForm } from "./foundry-form";
import { MODULE_ID } from "./constants";
import {
  cleanupRows,
  formatRecordSize,
  previewRetention,
  purgeRecordHistory,
} from "./record-cleanup";
import { recordEscape } from "./journal-format";
import {
  captureBackup,
  previewMissingUserCleanup,
  applyMissingUserCleanup,
  downloadJson,
  openJournal,
  previewCleanup,
  applyCleanup,
  recordWarnings,
  type OperationReport,
} from "./module-data-service";
import { type CleanupKind } from "./module-data-model";

const RESET_ACTIONS = [
  {
    id: "pendingReceipts",
    label: "Dismiss unacknowledged payout receipts",
    consequence:
      "Removes acknowledgment requests. Awarded resources remain unchanged.",
  },
  {
    id: "pendingHumanity",
    label: "Cancel pending Humanity rolls",
    consequence:
      "Cancels these Humanity obligations without rolling or changing Humanity.",
  },
  {
    id: "attendance",
    label: "Reset attendance records",
    consequence:
      "Deletes selected attendance records. Awarded resources remain unchanged.",
  },
  {
    id: "reputation",
    label: "Reset faction reputation scores",
    consequence:
      "Removes current faction reputation scores for the selected characters.",
  },
] as const;

export class CleanupSettings extends CrewToolsForm {
  private busy = false;
  private snapshot?: {
    backup: ReturnType<typeof captureBackup>;
    rows: ReturnType<typeof cleanupRows>;
  };
  private keep = new Map<string, number>();
  private expandedCategories = new Set<string>();
  private resetKind: CleanupKind = "pendingReceipts";
  private actorId = "";
  private advancedOpen = false;
  private report?: OperationReport;
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-cleanup",
      title: "Crew Tools — Data & Cleanup",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/cleanup.hbs`,
      width: 1020,
      height: 760,
      resizable: true,
      closeOnSubmit: false,
      scrollY: [".cleanup-records"],
    };
  }
  override getData() {
    if (!this.snapshot) {
      const backup = captureBackup();
      this.snapshot = { backup, rows: cleanupRows(backup) };
    }
    const { backup, rows } = this.snapshot;
    const actors = new Set([...game.actors].map((a) => a.id));
    const users = new Set([...game.users].map((u) => u.id));
    const names = new Map([...game.actors].map((a) => [a.id, a.name]));
    for (const row of rows)
      if (row.actorId && !names.has(row.actorId))
        names.set(row.actorId, `Missing character (${row.actorId})`);
    const reset = RESET_ACTIONS.find((a) => a.id === this.resetKind)!;
    const targets = this.advancedOpen
      ? previewCleanup(this.resetKind, this.actorId)
      : [];
    const viewRows = rows.map((r) => ({
      id: r.id,
      category: r.category,
      bytes: r.bytes,
      name: r.name,
      location: r.location,
      objectType: r.objectType,
      journalId: r.journalId,
      pageId: r.pageId,
      warnings: recordWarnings(
        { actorId: r.actorId, record: r.raw },
        actors,
        users,
      ),
      count: r.count,
      eligible: r.eligible,
      protectedCount: r.count - r.eligible,
      size: formatRecordSize(r.bytes),
      recommended: r.recommended,
      keep: this.keep.get(r.id) ?? r.recommended ?? 0,
      note: r.note,
      canPurge: r.mode !== "protected",
      purgeDisabled: this.busy || r.mode === "protected",
      busy: this.busy,
    }));
    const tree = buildCleanupTree(backup, viewRows, game);
    const sizeNodes = (nodes: typeof tree): void => {
      for (const node of nodes) {
        Object.assign(node, {
          size: node.bytes ? formatRecordSize(node.bytes) : "",
          typeLabel:
            (
              {
                JournalEntry: "Journal Entry",
                JournalEntryPage: "Journal Page",
                ChatMessage: "Chat Message",
                TableResult: "Table Result",
              } as Record<string, string>
            )[node.type] ?? node.type,
        });
        sizeNodes(node.children);
      }
    };
    sizeNodes(tree);
    return {
      busy: this.busy,
      advancedOpen: this.advancedOpen,
      report: this.report,
      resetActions: RESET_ACTIONS.map((a) => ({
        ...a,
        selected: a.id === this.resetKind,
      })),
      actors: [...names].map(([id, name]) => ({
        id,
        name,
        selected: id === this.actorId,
      })),
      resetConsequence: reset.consequence,
      resetTargets: targets.map((t) => ({
        name: t.name,
        count: t.removed.length,
      })),
      resetCount: targets.reduce((n, t) => n + t.removed.length, 0),
      resetDisabled: this.busy || !targets.length,
      totalSize: formatRecordSize(rows.reduce((n, r) => n + r.bytes, 0)),
      totalRecords: rows.reduce((n, r) => n + r.count, 0),
      othersOnline: [...game.users].some(
        (u) => u.active && u.id !== game.user?.id,
      ),
      tree,
    };
  }
  override async close(): Promise<void> {
    this.snapshot = undefined;
    await super.close();
  }
  protected override async _updateObject(): Promise<void> {}
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    root
      .querySelectorAll<HTMLDetailsElement>("[data-cleanup-category]")
      .forEach((section) => {
        const name = section.dataset.cleanupCategory!;
        section.open = this.expandedCategories.has(name);
        section.addEventListener("toggle", () => {
          if (section.open) this.expandedCategories.add(name);
          else this.expandedCategories.delete(name);
        });
      });
    root
      .querySelector("[data-cleanup-refresh]")
      ?.addEventListener("click", () => {
        if (!this.busy) {
          this.snapshot = undefined;
          this.render(false);
        }
      });
    root.querySelector("[data-export-all]")?.addEventListener(
      "click",
      () =>
        void this.run(async () =>
          downloadJson(
            {
              ...captureBackup(),
              format: "pneuma-crewtools-record-snapshot",
            },
            "records",
          ),
        ),
    );
    root
      .querySelectorAll<HTMLButtonElement>("[data-export-row]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void this.run(async () => {
              const row = cleanupRows().find(
                (r) => r.id === button.dataset.exportRow,
              );
              if (!row)
                throw new Error(
                  "This record location no longer exists. Refresh the list.",
                );
              downloadJson(
                {
                  format: "pneuma-crewtools-record-snapshot",
                  createdAt: new Date().toISOString(),
                  location: row.location,
                  objectType: row.objectType,
                  journalId: row.journalId,
                  pageId: row.pageId,
                  record: row.raw,
                },
                "selected-records",
              );
            }),
        ),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-open-journal]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          if (!this.busy)
            openJournal(button.dataset.openJournal!, button.dataset.page);
        }),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-open-object]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void this.run(async () => {
              const doc = (await fromUuid(button.dataset.openObject!)) as {
                sheet?: { render(force: boolean): unknown };
              } | null;
              if (!doc?.sheet)
                throw new Error("This object is unavailable or has no sheet.");
              doc.sheet.render(true);
            }),
        ),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-clean-missing-user]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () => void this.cleanMissingUser(button.dataset.cleanMissingUser!),
        ),
      );
    root.querySelectorAll<HTMLInputElement>("[data-keep]").forEach((input) =>
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (input.value.trim() && Number.isSafeInteger(n) && n >= 0)
          this.keep.set(input.dataset.keep!, n);
      }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-purge]").forEach((button) =>
      button.addEventListener("click", () => {
        const input = button
          .closest("[data-record-controls]")
          ?.querySelector<HTMLInputElement>("[data-keep]");
        if (input?.value.trim() && input.reportValidity())
          void this.purge(button.dataset.purge!, Number(input.value));
      }),
    );
    const advanced = root.querySelector<HTMLDetailsElement>(
      "[data-reset-section]",
    );
    if (advanced) advanced.open = this.advancedOpen;
    advanced?.addEventListener("toggle", () => {
      if (!this.busy && advanced.open !== this.advancedOpen) {
        this.advancedOpen = advanced.open;
        this.render(false);
      }
    });
    root
      .querySelector<HTMLSelectElement>("[data-reset-kind]")
      ?.addEventListener("change", (event) => {
        this.resetKind = (event.target as HTMLSelectElement)
          .value as CleanupKind;
        this.report = undefined;
        this.render(false);
      });
    root
      .querySelector<HTMLSelectElement>("[data-reset-actor]")
      ?.addEventListener("change", (event) => {
        this.actorId = (event.target as HTMLSelectElement).value;
        this.report = undefined;
        this.render(false);
      });
    root
      .querySelector("[data-reset-review]")
      ?.addEventListener("click", () => void this.reset());
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    document
      .getElementById(MODULE_ID + "-cleanup")
      ?.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button,input,select")
      .forEach((e) => (e.disabled = true));
    try {
      await action();
    } catch (error) {
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.snapshot = undefined;
      this.busy = false;
      this.render(false);
    }
  }
  private async cleanMissingUser(userId: string): Promise<void> {
    await this.run(async () => {
      const targets = previewMissingUserCleanup(userId);
      if (!targets.length) {
        ui.notifications.info(
          "No obsolete permissions remain for this User. Saved historical references can still appear in the tree.",
        );
        return;
      }
      if (
        !(await confirmAction(
          "Clean up deleted User permissions?",
          "<p>Remove " +
            targets.length +
            " obsolete permission entries for <strong>User." +
            recordEscape(userId) +
            "</strong>?</p><ul>" +
            targets
              .map((t) => "<li>" + recordEscape(t.name) + "</li>")
              .join("") +
            "</ul><p>Character Actors, Journals, saved history and remaining users’ access are preserved. Historical references to this user may remain. This cannot be undone.</p>",
          "Remove obsolete permissions",
        ))
      )
        return;
      this.report = await applyMissingUserCleanup(userId, targets);
      if (this.report.failed.length) {
        this.advancedOpen = true;
        ui.notifications.error(
          "Cleanup stopped after a failure. Review the results below.",
        );
      } else
        ui.notifications.info(
          "Removed " +
            this.report.completed.length +
            " obsolete permission entries. Saved history was preserved.",
        );
    });
  }
  private async reset(): Promise<void> {
    await this.run(async () => {
      const action = RESET_ACTIONS.find((a) => a.id === this.resetKind);
      if (!action) throw new Error("Choose a cancellation or reset action.");
      const targets = previewCleanup(this.resetKind, this.actorId);
      const count = targets.reduce((n, t) => n + t.removed.length, 0);
      if (!count) return;
      if (
        !(await confirmAction(
          action.label,
          `<p>${recordEscape(action.consequence)}</p><p>This affects ${count} records and cannot be undone.</p><ul>${targets.map((t) => `<li>${recordEscape(t.name)}: ${t.removed.length}</li>`).join("")}</ul>`,
          action.label,
        ))
      )
        return;
      this.report = await applyCleanup(this.resetKind, this.actorId, targets);
      if (this.report.failed.length)
        ui.notifications.error(
          "The operation stopped after a failure. Review the results below.",
        );
      else
        ui.notifications.info(
          `Updated ${this.report.completed.length} record locations.`,
        );
    });
  }
  private async purge(id: string, keep: number): Promise<void> {
    await this.run(async () => {
      const row = cleanupRows().find((r) => r.id === id);
      if (!row)
        throw new Error(
          "This record location no longer exists. Refresh the list.",
        );
      const count = previewRetention(row, keep);
      if (!count) {
        ui.notifications.info("No completed records exceed this limit.");
        return;
      }
      const confirmed = await confirmAction(
        "Purge completed history?",
        `<p><strong>${recordEscape(row.name)}</strong></p><p>${recordEscape(row.location)}</p><p>Remove ${count} older completed records and keep the newest ${keep}? Pending and protected records stay. This cannot be undone.</p>${row.mode === "pharma" ? "<p>Associated old offer and response chat cards will also be removed.</p>" : ""}`,
        `Purge ${count} records`,
      );
      if (!confirmed) return;
      const removed = await purgeRecordHistory(id, keep, row.snapshot);
      ui.notifications.info(`Purged ${removed} records from ${row.name}.`);
    });
  }
}
function confirmAction(
  title: string,
  content: string,
  label: string,
): Promise<boolean> {
  return new Promise((resolve) =>
    new Dialog({
      title,
      content,
      buttons: {
        cancel: { label: "Cancel", callback: () => resolve(false) },
        purge: { label, callback: () => resolve(true) },
      },
      default: "cancel",
      close: () => resolve(false),
    }).render(true),
  );
}
export function registerCleanupSettings(): void {
  game.settings.registerMenu(MODULE_ID, "payoutDataManager", {
    name: "Data & Cleanup",
    label: "Manage Data & Cleanup",
    hint: "Inspect and export records, review diagnostics, and choose how much completed history to keep.",
    icon: "fas fa-database",
    type: CleanupSettings,
    restricted: true,
  });
}
