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
    ),
  ];
}
export class HqCatalogSettings extends CrewToolsForm {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-hq-catalog",
      title: "HQ Improvements",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/hq-catalog.hbs`,
      width: 640,
      height: "auto",
      closeOnSubmit: false,
    };
  }
  override getData() {
    return {
      defaults: DEFAULT_HQ_IMPROVEMENTS,
      custom: getHqCatalog().filter(
        (i) => !DEFAULT_HQ_IMPROVEMENTS.some((d) => d.id === i.id),
      ),
    };
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!game.user?.isGM) throw new Error("Only a GM can manage improvements.");
    try {
      const custom = getHqCatalog()
        .filter((i) => !DEFAULT_HQ_IMPROVEMENTS.some((d) => d.id === i.id))
        .filter((i) => !data["remove." + i.id])
        .map((i) => ({ ...i, cost: Number(data["cost." + i.id] ?? i.cost) }));
      if (custom.some((i) => !Number.isSafeInteger(i.cost) || i.cost < 0))
        throw new Error("Custom IP costs must be non-negative whole numbers.");
      const name = String(data.name ?? "").trim(),
        description = String(data.description ?? "").trim(),
        cost = Number(data.cost ?? 40);
      if (name) {
        if (
          name.length > 100 ||
          description.length > 200 ||
          !Number.isSafeInteger(cost) ||
          cost < 0
        )
          throw new Error(
            "Enter a name, a short description, and a non-negative whole IP cost.",
          );
        if (
          getHqCatalog().some(
            (i) => i.name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw new Error("An improvement with this name already exists.");
        custom.push({
          id: createUniqueId(),
          name,
          description,
          cost,
          effect: "notes",
        });
      }
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
          ["Name", "HQ IP", "Description"],
          custom.map((i) => [
            recordEscape(i.name),
            String(i.cost),
            recordEscape(i.description),
          ]),
        ),
      );
      this.render(false);
    } catch (error) {
      ui.notifications.error(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
