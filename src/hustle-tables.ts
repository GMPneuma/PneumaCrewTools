import { updateHustleSummaries } from "./hustle-summary-migration";
import { isPrimaryGM as primaryGM } from "./action-coordinator";
import { recordEscape as escape } from "./journal-format";
import { MODULE_ID } from "./constants";
import { HUSTLE_TABLES } from "./hustle-table-data";

let queue: Promise<void> = Promise.resolve();
let ready = false;

// Native text results remain readable and rollable with the module disabled.
export function hustleTableData(
  table: (typeof HUSTLE_TABLES)[number],
  folderId: string,
) {
  return {
    name: `Hustle - ${table.role}`,
    folder: folderId,
    img: `modules/${MODULE_ID}/images/roles/${table.role.toLowerCase()}.svg`,
    formula: "1d6",
    replacement: true,
    displayRoll: true,
    ownership: { default: 2 },
    flags: { [MODULE_ID]: { hustleRole: table.role, hustleSummaryVersion: 1 } },
    description: `<p>${escape(table.role)} weekly hustle.</p>`,
    results: table.rows.map((row) => ({
      type: 0,
      text: `<p>${escape(row.activity)}</p><p><strong>Rank 1 to 4:</strong> ${row.earnings[0]}eb · <strong>Rank 5 to 7:</strong> ${row.earnings[1]}eb · <strong>Rank 8 to 10:</strong> ${row.earnings[2]}eb</p>`,
      img: "icons/svg/coins.svg",
      weight: 1,
      range: [row.roll, row.roll],
      drawn: false,
      flags: {
        [MODULE_ID]: {
          hustle: {
            roll: row.roll,
            activity: row.activity,
            earnings: [...row.earnings],
          },
        },
      },
    })),
  };
}

export function ensureHustleTables(): Promise<void> {
  const next = queue.then(async () => {
    if (!primaryGM()) return;
    const folder =
      Array.from(game.folders).find(
        (f) => f.type === "RollTable" && f.name === "CrewTools" && !f.folder,
      ) ??
      (await Folder.create({
        name: "CrewTools",
        type: "RollTable",
        folder: null,
        sorting: "a",
      }));
    for (const table of HUSTLE_TABLES) {
      if (!primaryGM()) return;
      const existing = Array.from(game.tables).find(
        (t) => t.getFlag(MODULE_ID, "hustleRole") === table.role,
      );
      if (existing) {
        await updateHustleSummaries(
          existing,
          table.role,
          hustleTableData(table, folder.id),
        );
        continue;
      }
      await RollTable.create(hustleTableData(table, folder.id));
    }
  });
  queue = next.catch(() => undefined);
  return next;
}
function initialize(): void {
  if (!ready) return;
  void ensureHustleTables().catch((error) => {
    console.error(MODULE_ID + " | Hustle tables", error);
    ui.notifications.error(
      "Hustle tables could not be created. " +
        (error instanceof Error ? error.message : String(error)),
    );
  });
}
export function registerHustleTables(): void {
  Hooks.on("userConnected", initialize);
}
export function readyHustleTables(): void {
  ready = true;
  initialize();
}
