import { MODULE_ID } from "./constants";
import { CrewToolsForm } from "./foundry-form";
import { createUniqueId } from "./id";
import { customActivities, saveCustomActivities } from "./custom-downtime";
import type { CustomActivity } from "./custom-downtime-model";

export class CustomDowntimeSettings extends CrewToolsForm {
  private drafts?: CustomActivity[];
  private focusNewId?: string;
  override async close(): Promise<void> {
    await super.close();
    this.drafts = undefined;
    this.focusNewId = undefined;
  }
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-custom-activities",
      title: "Custom Downtime Activities",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/custom-downtime-settings.hbs`,
      width: 1000,
      height: "auto",
      closeOnSubmit: false,
      submitOnChange: false,
    };
  }
  override getData() {
    if (!game.user?.isGM)
      throw new Error("Only a GM can manage custom activities.");
    this.drafts ??= structuredClone(customActivities());
    const tables = Array.from(game.tables)
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      activities: this.drafts.map((d) => ({
        ...d,
        tables: [
          ...(d.tableId && !tables.some((t) => t.id === d.tableId)
            ? [{ id: d.tableId, name: "Missing RollTable", selected: true }]
            : []),
          ...tables.map((t) => ({ ...t, selected: t.id === d.tableId })),
        ],
      })),
    };
  }
  // Keep edits in this window until Save, including across add/delete redraws.
  private readDrafts(data: Record<string, unknown>): void {
    for (const draft of this.drafts ?? []) {
      if ("name." + draft.id in data)
        draft.name = String(data["name." + draft.id] ?? "");
      if ("days." + draft.id in data) {
        const days = String(data["days." + draft.id] ?? "").trim();
        draft.days = days ? Number(days) : null;
      }
      if ("table." + draft.id in data)
        draft.tableId = String(data["table." + draft.id] ?? "");
    }
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    const capture = () => {
      const data: Record<string, unknown> = {};
      for (const control of root.querySelectorAll<
        HTMLInputElement | HTMLSelectElement
      >("input[name], select[name]"))
        data[control.name] = control.value;
      this.readDrafts(data);
    };
    root
      .querySelector<HTMLButtonElement>("[data-activity-add]")
      ?.addEventListener("click", () => {
        capture();
        const id = createUniqueId();
        (this.drafts ??= []).push({ id, name: "", days: null, tableId: "" });
        this.focusNewId = id;
        this.render(false);
      });
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-activity-delete]",
    )) {
      button.addEventListener("click", () => {
        capture();
        const id = button.dataset.activityDelete;
        const draft = this.drafts?.find((d) => d.id === id);
        if (!draft) return;
        const label = document.createElement("span");
        label.textContent = draft.name || "Untitled activity";
        new Dialog({
          title: "Delete Activity",
          content: `<p>Delete <strong>${label.innerHTML}</strong> from the activity list?</p><p>Existing projects keep their original settings. Save Activities to apply this change.</p>`,
          buttons: {
            cancel: { label: "Cancel" },
            delete: {
              label: "Delete Activity",
              icon: '<i class="fas fa-trash"></i>',
              callback: () => {
                capture();
                this.drafts = this.drafts?.filter((d) => d.id !== id);
                this.render(false);
              },
            },
          },
          default: "cancel",
        }).render(true);
      });
    }
    if (this.focusNewId) {
      const name = "name." + this.focusNewId;
      Array.from(root.querySelectorAll<HTMLInputElement>("input[name]"))
        .find((input) => input.name === name)
        ?.focus();
      this.focusNewId = undefined;
    }
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ) {
    if (!game.user?.isGM)
      throw new Error("Only a GM can manage custom activities.");
    this.drafts ??= structuredClone(customActivities());
    this.readDrafts(data);
    try {
      await saveCustomActivities(
        this.drafts.map((d) => ({ ...d, name: d.name.trim() })),
      );
      ui.notifications.info("Activities saved.");
      this.render(false);
    } catch (error) {
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
export function registerCustomDowntime() {
  game.settings.registerMenu(MODULE_ID, "customDowntimeActivities", {
    name: "Custom Downtime Activities",
    label: "Manage Activities",
    hint: "Create downtime activities with optional day requirements and RollTables.",
    icon: "fas fa-clipboard-list",
    type: CustomDowntimeSettings,
    restricted: true,
  });
}
