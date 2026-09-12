import { MODULE_ID } from "./constants";

export const HQ_MODULE_ID = "no-place-like-home";
const SETTING = "integrateNoPlaceLikeHome";
const OVERRIDE_SETTING = "overrideNoPlaceLikeHomeVersionCheck";
const TESTED_VERSION = "0.4.1";
interface HqState {
  schema: number;
  ip: number;
  log: unknown[];
  stashUuid?: string;
}
export interface HqAward {
  journalId: string;
  name: string;
  amount: number;
  previousValue: number;
  reason: string;
}

export function hqIntegrationEnabled(): boolean {
  const module = game.modules.get(HQ_MODULE_ID);
  return Boolean(
    module?.active &&
    game.settings.get(MODULE_ID, SETTING) &&
    (isTestedVersion(module.version) ||
      game.settings.get(MODULE_ID, OVERRIDE_SETTING)),
  );
}

function isTestedVersion(version?: string): boolean {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return false;
  const candidate = match.slice(1).map(Number);
  const tested = TESTED_VERSION.split(".").map(Number);
  for (let index = 0; index < tested.length; index += 1) {
    const candidatePart = candidate[index] ?? 0;
    const testedPart = tested[index] ?? 0;
    if (candidatePart !== testedPart) return candidatePart < testedPart;
  }
  return true;
}
function hqState(journal: FoundryJournalEntry): HqState | null {
  const raw = journal.getFlag(HQ_MODULE_ID, "hq") as HqState | undefined;
  return raw &&
    raw.schema === 1 &&
    Number.isSafeInteger(raw.ip) &&
    raw.ip >= 0 &&
    Array.isArray(raw.log)
    ? raw
    : null;
}
export function getHeadquarters(): FoundryJournalEntry[] {
  return hqIntegrationEnabled()
    ? Array.from(game.journal)
        .filter((j) => j.isOwner && hqState(j))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
}
export function prepareHqAward(
  journalId: string,
  amount: number,
  reason: string,
): HqAward {
  const journal = getHeadquarters().find((j) => j.id === journalId);
  const state = journal && hqState(journal);
  if (!journal || !state)
    throw new Error(
      "Select an available No Place Like Home HQ before awarding HQ IP.",
    );
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(state.ip + amount)
  )
    throw new Error(
      "HQ IP awards must be positive whole numbers within the supported range.",
    );
  return {
    journalId,
    name: journal.name,
    amount,
    previousValue: state.ip,
    reason,
  };
}
export function hqOptions() {
  return getHeadquarters().map((journal) => {
    const state = hqState(journal)!;
    const stash = Array.from(game.actors).find(
      (a) => a.uuid === state.stashUuid && a.type === "container",
    );
    return {
      id: journal.id,
      name: journal.name,
      balance: state.ip,
      stashId: stash?.id ?? "",
    };
  });
}
export async function applyHqAward(
  award: HqAward,
): Promise<() => Promise<void>> {
  if (!game.user?.isGM) throw new Error("Only a GM can award HQ IP.");
  const fresh = prepareHqAward(award.journalId, award.amount, award.reason);
  if (fresh.previousValue !== award.previousValue)
    throw new Error(
      "The HQ balance changed. Return to rewards and preview the payout again.",
    );
  const journal = game.journal.get(award.journalId)!;
  const state = hqState(journal)!;
  const previousLog = structuredClone(state.log);
  const nextIp = state.ip + award.amount;
  const nextLog = [
    ...previousLog,
    {
      date: new Date().toLocaleString(),
      user: game.user.name,
      label:
        "Awarded " +
        award.amount +
        " HQ IP via PneumaCrewTools: " +
        award.reason,
    },
  ];
  await journal.update({
    ["flags." + HQ_MODULE_ID + ".hq.ip"]: nextIp,
    ["flags." + HQ_MODULE_ID + ".hq.log"]: nextLog,
  });
  return async () => {
    const current = hqState(journal);
    if (
      !current ||
      current.ip !== nextIp ||
      JSON.stringify(current.log) !== JSON.stringify(nextLog)
    )
      throw new Error(
        "HQ changed after this payout; automatic HQ rollback stopped to preserve newer changes.",
      );
    await journal.update({
      ["flags." + HQ_MODULE_ID + ".hq.ip"]: award.previousValue,
      ["flags." + HQ_MODULE_ID + ".hq.log"]: previousLog,
    });
  };
}
export function registerHqIntegration(): void {
  game.settings.register(MODULE_ID, SETTING, {
    name: "Integrate with No Place Like Home",
    hint: "Award HQ IP directly to an HQ sheet and select its shared stash. Requires No Place Like Home to be active in this world.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, OVERRIDE_SETTING, {
    name: "Override No Place Like Home version check",
    hint: "Currently only tested on version 0.4.1 or earlier. Future updates to No Place Like Home may cause this module to break things. Enable this override to allow a newer or unrecognized version; HQ data validation remains enabled.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  Hooks.on("renderSettingsConfig", (_app, html) => {
    const input = html[0]?.querySelector<HTMLInputElement>(
      '[name="' + MODULE_ID + "." + SETTING + '"]',
    );
    if (!input) return;
    const override = html[0]?.querySelector<HTMLInputElement>(
      '[name="' + MODULE_ID + "." + OVERRIDE_SETTING + '"]',
    );
    const module = game.modules.get(HQ_MODULE_ID);
    const integrationRow = input.closest<HTMLElement>(".form-group");
    const overrideRow = override?.closest<HTMLElement>(".form-group");
    if (
      integrationRow &&
      overrideRow &&
      !integrationRow.closest("[data-nplh-settings-group]")
    ) {
      const group = document.createElement("section");
      group.className = "nplh-settings-group";
      group.dataset.nplhSettingsGroup = "";
      const heading = document.createElement("h3");
      heading.textContent = "No Place Like Home Module integration";
      integrationRow.before(group);
      group.append(heading, integrationRow, overrideRow);
    }
    const unavailable = !game.user?.isGM || !module?.active;
    if (override) override.disabled = unavailable;
    const synchronize = () => {
      input.disabled =
        unavailable ||
        (!isTestedVersion(module?.version) && !override?.checked);
    };
    synchronize();
    override?.addEventListener("change", synchronize);
    const integrationNotes = integrationRow?.querySelector(".notes");
    if (
      integrationNotes &&
      !integrationNotes.querySelector("[data-hq-download]")
    ) {
      const link = document.createElement("a");
      link.textContent = "Get No Place Like Home";
      link.href =
        "https://discord.com/channels/1095235148821303297/1546129535119007835";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.hqDownload = "";
      integrationNotes.append(document.createElement("br"), link);
    }
    const overrideNotes = overrideRow?.querySelector(".notes");
    if (
      overrideNotes &&
      !overrideNotes.querySelector("[data-hq-version-status]")
    ) {
      const status = document.createElement("span");
      status.dataset.hqVersionStatus = "";
      status.textContent = `Detected version: ${module?.version ?? "unavailable"}. Versions through ${TESTED_VERSION} are accepted without an override.`;
      overrideNotes.prepend(status, document.createElement("br"));
    }
  });
}
