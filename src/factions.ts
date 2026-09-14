import { MODULE_ID } from "./constants";
import { CrewToolsForm } from "./foundry-form";
import { createUniqueId } from "./id";
import {
  findRecordJournal,
  ensureRecordJournal,
  readRecord,
  writeRecord,
  actorPayoutRecords,
  ensureActorPayoutJournal,
} from "./journal-records";
import { journalTable, recordEscape, storedDetails } from "./journal-format";
import type { FactionReputationRecord } from "./payout-journal";

export interface Faction {
  id: string;
  name: string;
  active: boolean;
}
export function getFactions(): Faction[] {
  return readRecord<Faction[]>(
    findRecordJournal("factions"),
    "factions",
    [],
  ).sort((a, b) => a.name.localeCompare(b.name));
}
export function getFactionReputations(): FactionReputationRecord[] {
  return Array.from(game.journal)
    .filter((j) => j.getFlag?.(MODULE_ID, "recordKind") === "character")
    .flatMap((j) =>
      readRecord<FactionReputationRecord[]>(j, "factionReputation", []),
    );
}
export async function saveFactionReputations(
  actor: FoundryActor,
  rows: FactionReputationRecord[],
): Promise<void> {
  const journal = await ensureActorPayoutJournal(actor);
  await writeRecord(
    journal,
    "factionReputation",
    "Faction Reputation",
    rows,
    "Current faction reputation for this character. Actor and faction IDs identify records; names are labels. Payouts set the listed reputation independently of sheet Reputation.",
  );
}
export async function saveFactions(factions: Faction[]): Promise<void> {
  if (!game.user?.isGM) throw new Error("Only a GM can manage factions.");
  const names = new Set<string>();
  for (const faction of factions) {
    faction.name = faction.name.trim();
    if (!faction.name || names.has(faction.name.toLocaleLowerCase()))
      throw new Error("Each faction needs a unique name.");
    names.add(faction.name.toLocaleLowerCase());
  }
  const journal = await ensureRecordJournal("factions", "Factions", "crew");
  await writeRecord(
    journal,
    "factions",
    "Factions",
    factions,
    "",
    journalTable(
      ["Faction", "Available for payouts"],
      factions.map((f) => [recordEscape(f.name), f.active ? "Yes" : "No"]),
    ) +
      storedDetails(
        "",
        "Managed through Crew Tools settings. Inactive factions are hidden from new payouts; existing character reputation remains. Structured records are stored in flags.pneuma-crewtools.data.",
      ),
  );
  // Stable IDs let renamed factions retain their character balances.
  for (const actor of game.actors) {
    const rows = actorPayoutRecords<FactionReputationRecord>(
      actor.id,
      "factionReputation",
    );
    let changed = false;
    for (const row of rows) {
      const faction = factions.find((f) => f.id === row.factionId);
      if (faction && row.faction !== faction.name) {
        row.faction = faction.name;
        changed = true;
      }
    }
    if (changed) await saveFactionReputations(actor, rows);
  }
}
export async function addFaction(name: string): Promise<Faction> {
  const faction = { id: createUniqueId(), name: name.trim(), active: true };
  await saveFactions([...getFactions(), faction]);
  return faction;
}
export function promptNewFaction(): Promise<Faction | null> {
  return new Promise((resolve) => {
    let submitted = false;
    new Dialog({
      title: "Add Faction",
      content:
        '<form><div class="form-group"><label>Faction name</label><input name="factionName" type="text" maxlength="80" autofocus></div></form>',
      buttons: {
        add: {
          label: "Add",
          callback: (html) => {
            submitted = true;
            void addFaction(
              html[0]?.querySelector<HTMLInputElement>('[name="factionName"]')
                ?.value ?? "",
            )
              .then(resolve)
              .catch((error) => {
                ui.notifications.error(String(error));
                resolve(null);
              });
          },
        },
        cancel: { label: "Cancel", callback: () => resolve(null) },
      },
      default: "add",
      close: () => {
        if (!submitted) resolve(null);
      },
    }).render(true);
  });
}
class FactionSettings extends CrewToolsForm {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-factions",
      title: "Faction Reputation",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/factions.hbs`,
      width: 480,
      height: "auto",
      closeOnSubmit: false,
    };
  }
  override getData(): object {
    return { factions: getFactions() };
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    html[0]
      ?.querySelector("[data-add-faction]")
      ?.addEventListener("click", () => {
        // Save edits before the add prompt refreshes the list.
        const rows = getFactions().map((f) => ({
          ...f,
          name:
            html[0]?.querySelector<HTMLInputElement>(`[name="name.${f.id}"]`)
              ?.value ?? f.name,
          active:
            html[0]?.querySelector<HTMLInputElement>(`[name="active.${f.id}"]`)
              ?.checked ?? false,
        }));
        void saveFactions(rows)
          .then(() => promptNewFaction())
          .then(() => this.render(false))
          .catch((e) => ui.notifications.error(String(e)));
      });
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await saveFactions(
        getFactions().map((f) => ({
          ...f,
          name: String(data["name." + f.id] ?? f.name),
          active: data["active." + f.id] === true,
        })),
      );
      this.render(false);
      ui.notifications.info("Factions saved.");
    } catch (e) {
      ui.notifications.error(String(e));
    }
  }
}
export function registerFactions(): void {
  game.settings.registerMenu(MODULE_ID, "factions", {
    name: "Faction list",
    label: "Manage Factions",
    icon: "fas fa-flag",
    type: FactionSettings,
    restricted: true,
    hint: "Add, rename, or hide factions from reputation payouts.",
  });
}
