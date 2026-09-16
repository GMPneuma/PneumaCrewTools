import { MODULE_ID } from "./constants";
import { CrewToolsForm } from "./foundry-form";
import { createUniqueId } from "./id";
import {
  findRecordJournal,
  ensureRecordJournal,
  readRecord,
  writeRecord,
} from "./journal-records";
import { journalTable, recordEscape } from "./journal-format";
export interface HqImprovementOption {
  id: string;
  name: string;
  description: string;
  cost: number;
  hasLevel2?: boolean;
  level2Description?: string;
  effect: "notes" | "medbay" | "workshop";
}
// No Place Like Home, pages 3-6: short reference summaries, not automated benefits.
export const DEFAULT_HQ_IMPROVEMENTS: HqImprovementOption[] = [
  [
    "evidenceWall",
    "Evidence Wall",
    "A workspace for investigations and research.",
  ],
  ["garage", "Garage", "Vehicle storage and crew transport."],
  ["lockup", "Lockup", "Secure holding cells."],
  ["lounge", "Lounge", "A meeting space for contacts and negotiations."],
  ["medbay", "Medbay", "Medical treatment and recovery facilities."],
  ["moraleBoost", "Morale Boost", "Recreation and comforts for the crew."],
  ["rentReduction", "Rent Reduction", "Housing savings and room for tenants."],
  [
    "serverRoom",
    "Server Room",
    "Space for a NET Architecture and security systems.",
  ],
  ["studio", "Studio", "A space for creative work and performances."],
  [
    "trainingArea",
    "Training Area",
    "Facilities for combat and athletic practice.",
  ],
  ["workshop", "Workshop", "A workspace for TECH projects."],
  ["workstation", "Workstation", "Facilities for an Exec's team member."],
].map(([id = "", name = "", description = ""]) => ({
  id,
  name,
  description,
  cost: 40,
  effect: id === "medbay" ? "medbay" : id === "workshop" ? "workshop" : "notes",
}));
export function getHqCatalog(): HqImprovementOption[] {
  return [
    ...DEFAULT_HQ_IMPROVEMENTS,
    ...readRecord<HqImprovementOption[]>(
      findRecordJournal("hqCatalog"),
      "hqCatalog",
      [],
    ).map((i) => ({ ...i, hasLevel2: i.hasLevel2 ?? false })),
  ];
}
export class HqCatalogSettings extends CrewToolsForm {
  private drafts?: HqImprovementOption[];
  private focusId?: string;
  override async close(): Promise<void> {
    await super.close();
    this.drafts = undefined;
    this.focusId = undefined;
  }
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-hq-catalog",
      title: "Custom HQ Improvements",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/hq-catalog.hbs`,
      width: 680,
      height: "auto",
      closeOnSubmit: false,
      submitOnChange: false,
    };
  }
  override getData() {
    if (!game.user?.isGM) throw new Error("Only a GM can manage improvements.");
    this.drafts ??= structuredClone(
      getHqCatalog().filter(
        (i) => !DEFAULT_HQ_IMPROVEMENTS.some((d) => d.id === i.id),
      ),
    );
    return { defaults: DEFAULT_HQ_IMPROVEMENTS, custom: this.drafts };
  }
  private readDrafts(data: Record<string, unknown>): void {
    for (const item of this.drafts ?? []) {
      for (const field of ["name", "description", "level2Description"] as const)
        if (field + "." + item.id in data)
          item[field] = String(data[field + "." + item.id] ?? "");
      if ("cost." + item.id in data)
        item.cost = Number(data["cost." + item.id]);
      if ("hasLevel2." + item.id in data)
        item.hasLevel2 = data["hasLevel2." + item.id] === true;
    }
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    const capture = () => {
      const data: Record<string, unknown> = {};
      for (const input of root.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >("input[name], textarea[name]"))
        data[input.name] =
          input instanceof HTMLInputElement && input.type === "checkbox"
            ? input.checked
            : input.value;
      this.readDrafts(data);
    };
    root
      .querySelector("[data-add-improvement]")
      ?.addEventListener("click", () => {
        capture();
        const id = createUniqueId();
        (this.drafts ??= []).push({
          id,
          name: "",
          description: "",
          cost: 40,
          effect: "notes",
          hasLevel2: false,
          level2Description: "",
        });
        this.focusId = id;
        this.render(false);
      });
    for (const toggle of root.querySelectorAll<HTMLInputElement>(
      "[data-level-two]",
    ))
      toggle.addEventListener("change", () => {
        capture();
        const panel = toggle
          .closest("[data-improvement-row]")
          ?.querySelector<HTMLElement>("[data-level-two-description]");
        if (panel) panel.hidden = !toggle.checked;
        this.setPosition({ height: "auto" });
      });
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-delete-improvement]",
    ))
      button.addEventListener("click", () => {
        capture();
        const id = button.dataset.deleteImprovement;
        const item = this.drafts?.find((i) => i.id === id);
        if (!item) return;
        new Dialog({
          title: "Delete Custom Improvement",
          content: `<p>Delete <strong>${recordEscape(item.name || "Untitled improvement")}</strong> from the catalog?</p><p>Purchased improvements are kept. Save Changes to apply this deletion.</p>`,
          buttons: {
            cancel: { label: "Cancel" },
            delete: {
              label: "Delete Improvement",
              callback: () => {
                capture();
                this.drafts = this.drafts?.filter((i) => i.id !== id);
                this.render(false);
              },
            },
          },
          default: "cancel",
        }).render(true);
      });
    if (this.focusId) {
      const name = "name." + this.focusId;
      Array.from(root.querySelectorAll<HTMLInputElement>("input[name]"))
        .find((input) => input.name === name)
        ?.focus();
      this.focusId = undefined;
    }
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!game.user?.isGM) throw new Error("Only a GM can manage improvements.");
    this.getData();
    // Native form submission may omit unchecked boxes.
    for (const item of this.drafts ?? [])
      item.hasLevel2 = data["hasLevel2." + item.id] === true;
    this.readDrafts(data);
    try {
      const names = new Set(
        DEFAULT_HQ_IMPROVEMENTS.map((i) => i.name.toLowerCase()),
      );
      const custom = (this.drafts ?? []).map((i) => {
        const item = {
          ...i,
          name: i.name.trim(),
          description: i.description.trim(),
          level2Description: (i.level2Description ?? "").trim(),
        };
        if (
          !item.name ||
          item.name.length > 100 ||
          item.description.length > 200 ||
          item.level2Description.length > 200 ||
          !Number.isSafeInteger(item.cost) ||
          item.cost < 0
        )
          throw new Error(
            "Enter a name, descriptions of at most 200 characters, and a non-negative whole IP cost.",
          );
        if (names.has(item.name.toLowerCase()))
          throw new Error("An improvement with this name already exists.");
        names.add(item.name.toLowerCase());
        return item;
      });
      const journal = await ensureRecordJournal(
        "hqCatalog",
        "HQ Improvements",
        "crew",
      );
      await writeRecord(
        journal,
        "hqCatalog",
        "Custom Improvements",
        custom,
        "",
        journalTable(
          ["Name", "HQ IP per level", "Description", "Level 2"],
          custom.map((i) => [
            recordEscape(i.name),
            String(i.cost),
            recordEscape(i.description),
            i.hasLevel2
              ? recordEscape(i.level2Description || "Available")
              : "Not available",
          ]),
        ),
      );
      this.drafts = custom;
      this.render(false);
      ui.notifications.info("Custom improvements saved.");
    } catch (error) {
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
