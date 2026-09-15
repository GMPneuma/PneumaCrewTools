import { CrewToolsForm } from "./foundry-form";
import { MODULE_ID } from "./constants";
import { recordEscape } from "./journal-format";
import { openDowntime } from "./downtime";
import { openHeadquarters } from "./headquarters";
import { openRent } from "./rent-form";
import {
  CLEANUP_LABELS,
  DATA_CATEGORIES,
  moduleFlags,
  type CleanupKind,
  type DataCategory,
} from "./module-data-model";
import {
  applyCleanup,
  captureBackup,
  downloadJson,
  inspectEntries,
  openJournal,
  previewCleanup,
  type OperationReport,
} from "./module-data-service";

export function registerPayoutDataManager(): void {
  game.settings.registerMenu(MODULE_ID, "payoutDataManager", {
    name: "Module Data",
    label: "View or Manage Module Data",
    hint: "Inspect records, perform targeted cleanup, and export CrewTools bookkeeping.",
    icon: "fas fa-database",
    type: PayoutDataManager,
    restricted: true,
  });
}

// The window only builds previews; mutations remain in the serialized GM service.
class PayoutDataManager extends CrewToolsForm {
  private busy = false;
  private actorId = "";
  private cleanup: CleanupKind = "pendingReceipts";
  private categories: DataCategory[] = [...DATA_CATEGORIES];
  private report?: OperationReport;
  private opened = new Set(["records"]);
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-data-manager",
      classes: [MODULE_ID],
      title: "CrewTools — Manage Module Data",
      template: `modules/${MODULE_ID}/templates/payout-data-manager.hbs`,
      width: 820,
      height: 780,
      resizable: true,
      scrollY: [".window-content"],
      closeOnSubmit: false,
    };
  }
  override getData() {
    const backup = captureBackup(),
      entries = inspectEntries(backup);
    const actorNames = new Map([...game.actors].map((a) => [a.id, a.name]));
    for (const e of backup.entries)
      if (
        e.kind === "journal" &&
        moduleFlags(e.data).actorId &&
        !actorNames.has(moduleFlags(e.data).actorId)
      )
        actorNames.set(
          moduleFlags(e.data).actorId,
          e.name + " (missing Actor)",
        );
    const targets = previewCleanup(this.cleanup, this.actorId);
    return {
      busy: this.busy,
      worldId: backup.worldId,
      moduleVersion: backup.moduleVersion,
      groups: DATA_CATEGORIES.map((name) => ({
        name,
        entries: entries.filter((e) => e.category === name),
      })),
      categories: DATA_CATEGORIES.map((name) => ({
        name,
        selected: this.categories.includes(name),
      })),
      actors: [...actorNames].map(([id, name]) => ({
        id,
        name,
        selected: id === this.actorId,
      })),
      cleanupOptions: Object.entries(CLEANUP_LABELS).map(([id, label]) => ({
        id,
        label,
        selected: id === this.cleanup,
      })),
      cleanupTargets: targets.map((t) => ({
        ...t,
        count: t.removed.length,
        records: t.removed
          .map(
            (r) =>
              r.sessionLabel ||
              r.actorName ||
              r.faction ||
              r.description ||
              r.id ||
              "Record",
          )
          .join("; "),
      })),
      cleanupCount: targets.reduce((n, t) => n + t.removed.length, 0),
      cleanupWarning:
        this.cleanup === "reputation"
          ? "This resets selected faction scores; it is not just history cleanup."
          : this.cleanup === "pendingHumanity"
            ? "This cancels pending Humanity obligations without rolling or changing Humanity."
            : "Deleting records does not reverse awarded money, IP, items, downtime, or Humanity.",
      report: this.report,
      technical: JSON.stringify(backup, null, 2),
    };
  }
  protected override async _updateObject(): Promise<void> {}
  // Keep expanded sections stable when selections rerender the form.
  override render(force = false, options?: { focus?: boolean }): this {
    const root = document.getElementById(MODULE_ID + "-data-manager");
    if (root)
      this.opened = new Set(
        [
          ...root.querySelectorAll<HTMLDetailsElement>(
            "details[data-section][open]",
          ),
        ].map((e) => e.dataset.section!),
      );
    return super.render(force, options);
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    root
      .querySelectorAll<HTMLDetailsElement>("details[data-section]")
      .forEach((e) => (e.open = this.opened.has(e.dataset.section!)));
    root
      .querySelector<HTMLSelectElement>("[name=actor]")
      ?.addEventListener("change", (e) => {
        this.actorId = (e.target as HTMLSelectElement).value;
        this.render(false);
      });
    root
      .querySelector<HTMLSelectElement>("[name=cleanup]")
      ?.addEventListener("change", (e) => {
        this.cleanup = (e.target as HTMLSelectElement).value as CleanupKind;
        this.render(false);
      });
    root
      .querySelectorAll<HTMLInputElement>("[data-category]")
      .forEach((input) =>
        input.addEventListener("change", () => {
          this.categories = [
            ...root.querySelectorAll<HTMLInputElement>(
              "[data-category]:checked",
            ),
          ].map((i) => i.value as DataCategory);
          this.render(false);
        }),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-open-journal]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          openJournal(button.dataset.openJournal!, button.dataset.page),
        ),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-action]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () => void this.run(() => this.action(button.dataset.action!)),
        ),
      );
  }
  // Disable the whole form during dialogs/writes so duplicate clicks cannot queue cleanup.
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    document
      .querySelectorAll<HTMLInputElement>(
        `#${MODULE_ID}-data-manager button, #${MODULE_ID}-data-manager input, #${MODULE_ID}-data-manager select`,
      )
      .forEach((e) => (e.disabled = true));
    try {
      await action();
    } catch (error) {
      ui.notifications.error(String(error));
    } finally {
      this.busy = false;
      this.render(false);
    }
  }
  private async action(action: string): Promise<void> {
    if (action === "refresh") {
      return;
    }
    if (action === "backup") {
      downloadJson(captureBackup(), "backup");
      return;
    }
    if (action === "export") {
      const snapshot = captureBackup();
      downloadJson(
        {
          ...snapshot,
          format: "pneuma-crewtools-record-snapshot",
          entries: snapshot.entries.filter(
            (e) => this.categories.includes(e.category) && e.kind !== "folder",
          ),
        },
        "selected-records",
      );
      return;
    }
    if (action === "export-cleanup") {
      downloadJson(
        {
          format: "pneuma-crewtools-record-snapshot",
          createdAt: new Date().toISOString(),
          records: previewCleanup(this.cleanup, this.actorId),
        },
        "cleanup-records",
      );
      return;
    }
    if (action === "downtime") {
      openDowntime(this.actorId || undefined);
      return;
    }
    if (action === "hq") {
      openHeadquarters();
      return;
    }
    if (action === "rent") {
      openRent(this.actorId || undefined);
      return;
    }
    if (action === "settings") {
      (
        game.settings as unknown as {
          sheet: { render(force: boolean): unknown };
        }
      ).sheet.render(true);
      return;
    }
    if (action === "report") {
      downloadJson(this.report, "operation-report");
      return;
    }
    if (action === "clear") {
      const targets = previewCleanup(this.cleanup, this.actorId);
      if (!targets.length) return;
      const names = targets
        .map((t) => `${t.name}: ${t.removed.length} records`)
        .join("\n");
      const consequence =
        this.cleanup === "reputation"
          ? "This resets the selected faction scores."
          : this.cleanup === "pendingHumanity"
            ? "This cancels pending Humanity obligations without applying them."
            : "This removes records without reversing native rewards.";
      if (
        !(await confirmAction(
          "Clear " + CLEANUP_LABELS[this.cleanup] + "?",
          consequence + "\n" + names,
        ))
      )
        return;
      this.report = await applyCleanup(this.cleanup, this.actorId, targets);
    }
  }
}

// Confirmation text is escaped; record names cannot become dialog markup.
function confirmAction(title: string, text: string): Promise<boolean> {
  return new Promise((resolve) =>
    new Dialog({
      title,
      content: `<p style="white-space:pre-wrap">${recordEscape(text)}</p>`,
      buttons: {
        confirm: { label: "Confirm", callback: () => resolve(true) },
        cancel: { label: "Cancel", callback: () => resolve(false) },
      },
      default: "cancel",
      close: () => resolve(false),
    }).render(true),
  );
}
