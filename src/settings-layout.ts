import { MODULE_ID } from "./constants";

// Categorize visible native controls; hidden data settings never produce a row.
const GROUP_KEYS: Record<string, string[]> = {
  // Keep public credits alongside the module-wide settings.
  Module: ["actorExclusions", "payoutDataManager", "iconCredits"],
  Payout: ["payoutContainerMenu", "payoutAcknowledgmentsEnabled"],
  "Faction Reputation": ["factions"],
  Calendar: ["useSimpleCalendar"],
  Headquarters: ["hqImprovements"],
  Teammates: ["loyaltyCheckDie"],
  HUD: [
    "hideCrewHud",
    "shortcutDisplay",
    "calendarFontColor",
    "hudIconColor",
    "hudAttentionColor",
  ],
  Downtime: [
    "customDowntimeActivities",
    "privateActivityRolls",
    "multiplyAntibioticBonus",
    "requireFullDowntimeWeek",
  ],
  "Rent & Lifestyle": ["rentSettings"],
  Crafting: [
    "techCraftingMonthDays",
    "techMultipleWithoutWorkshop",
    "armorRepair",
  ],
};
const DISCORD_KEYS = ["discordMarkdownEnabled", "discordLinksMenu"];

// Correct stale category labels without replacing native counters, icons or click handlers.
export function labelModuleSettings(root: HTMLElement): void {
  for (const category of root.querySelectorAll(
    '[data-tab="' + MODULE_ID + '"], [data-category="' + MODULE_ID + '"]',
  )) {
    const walker = document.createTreeWalker(category, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (node.nodeValue)
        node.nodeValue = node.nodeValue.replace(
          /PneumaCrewTools|PneumaCrewTolls/g,
          "Pneuma's Crew Tools",
        );
  }
}

// Move rows intact to preserve native handlers, unsaved values and permission filtering.
export function groupModuleSettings(root: HTMLElement): void {
  const controls = root.querySelectorAll<HTMLElement>(
    '[name^="' + MODULE_ID + '."], button[data-key^="' + MODULE_ID + '."]',
  );
  const rows = new Map<HTMLElement, string>();
  for (const control of controls) {
    const row = control.closest<HTMLElement>(".form-group");
    const key = (
      control.getAttribute("name") ??
      control.dataset.key ??
      ""
    ).slice(MODULE_ID.length + 1);
    // Discord payout tools are GM-only; retain the client preference for GMs.
    if (row && !game.user?.isGM && DISCORD_KEYS.includes(key)) {
      row.remove();
      continue;
    }
    if (row && !rows.has(row)) rows.set(row, key);
  }
  if (!rows.size) return;
  let wrapper = root.querySelector<HTMLElement>(".pneuma-settings-groups");
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "pneuma-settings-groups";
    rows.keys().next().value!.before(wrapper);
  }
  // Detach native rows before rebuilding, including on repeated renders.
  // This also removes groups that have become empty or single-option groups.
  for (const row of rows.keys()) row.remove();
  wrapper.replaceChildren();
  const standalone = document.createDocumentFragment();
  const grouped = document.createDocumentFragment();
  const section = (parent: HTMLElement, title: string, key: string) => {
    let group = parent.querySelector<HTMLFieldSetElement>(
      ':scope > [data-crew-settings-group="' + key + '"]',
    );
    if (!group) {
      group = document.createElement("fieldset");
      group.dataset.crewSettingsGroup = key;
      group.className =
        key === "discord" ? "pneuma-discord-settings" : "pneuma-settings-group";
      const legend = document.createElement("legend");
      legend.textContent = title;
      group.append(legend);
      parent.append(group);
    }
    return group;
  };
  for (const title of Object.keys(GROUP_KEYS)) {
    const matching = [...rows].filter(([, key]) => {
      const category =
        Object.entries(GROUP_KEYS).find(([, keys]) =>
          keys.includes(key),
        )?.[0] ?? "Module";
      return category === title;
    });
    if (!matching.length) continue;
    if (matching.length === 1) {
      standalone.append(matching[0]![0]);
      continue;
    }
    const discordRows = matching.filter(([, key]) =>
      DISCORD_KEYS.includes(key),
    );
    // A lone Discord option follows the same standalone rule as other groups.
    if (discordRows.length === 1) standalone.append(discordRows[0]![0]);
    const sectionRows = matching.filter(
      ([, key]) => !DISCORD_KEYS.includes(key) || discordRows.length > 1,
    );
    if (sectionRows.length === 1) {
      standalone.append(sectionRows[0]![0]);
      continue;
    }
    if (!sectionRows.length) continue;
    const group = section(wrapper, title, title.toLowerCase());
    grouped.append(group);
    for (const [row, key] of sectionRows)
      if (!DISCORD_KEYS.includes(key)) group.append(row);
    if (discordRows.length > 1) {
      const discord = section(group, "Discord Features", "discord");
      group.append(discord);
      for (const [row] of discordRows) discord.append(row);
    }
  }
  wrapper.append(standalone, grouped);
}

export function registerSettingsLayout(): void {
  Hooks.on("renderSettingsConfig", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    if (root) {
      labelModuleSettings(root);
      groupModuleSettings(root);
    }
  });
}
