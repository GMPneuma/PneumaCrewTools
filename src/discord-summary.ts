import { CrewToolsForm } from "./foundry-form";
import { displayDate } from "./date-format";
import { accessibleCrewActors, isActorExcluded } from "./actor-policy";
import {
  DISCORD_LINKS_SETTING,
  DISCORD_MARKDOWN_ENABLED_SETTING,
  MODULE_ID,
} from "./constants";
import type { PayoutPlan } from "./payout-execution";

export interface DiscordLink {
  kind: "user" | "role";
  id: string;
}

export type DiscordLinks = Record<string, DiscordLink>;
const CREW_LINK_KEY = "__everyone__";

export function registerDiscordLinks(): void {
  game.settings.register(MODULE_ID, DISCORD_MARKDOWN_ENABLED_SETTING, {
    name: "Show Discord Markdown after payout",
    hint: "Open a copy-ready Discord summary after a payout is applied.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, DISCORD_LINKS_SETTING, {
    name: "Discord Actor Links",
    hint: "Maps character Actors to Discord user IDs for payout summaries.",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.registerMenu(MODULE_ID, "discordLinksMenu", {
    name: "Discord Links",
    label: "Configure Discord Links",
    hint: "Link character Actors to Discord user IDs for mention-ready payout summaries.",
    icon: "fab fa-discord",
    type: DiscordLinksConfig,
    restricted: true,
  });
}

export function isDiscordMarkdownEnabled(): boolean {
  return (
    game.settings.get(MODULE_ID, DISCORD_MARKDOWN_ENABLED_SETTING) !== false
  );
}

interface DiscordLinksConfigData {
  crewRoleId: string;
  players: Array<{
    actorId: string;
    actorName: string;
    discordId: string;
    mentionKind: "user" | "role";
  }>;
}

class DiscordLinksConfig extends CrewToolsForm {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: `${MODULE_ID}-discord-links`,
      title: "Pneuma's Crew Tools: Discord Links",
      template: `modules/${MODULE_ID}/templates/discord-links.hbs`,
      width: 520,
      height: "auto",
      closeOnSubmit: true,
    };
  }

  override getData(): DiscordLinksConfigData {
    const links = getDiscordLinks();
    return {
      crewRoleId: links[CREW_LINK_KEY]?.id ?? "",
      players: accessibleCrewActors().map(({ id, name }) => ({
        actorId: id,
        actorName: name,
        discordId: links[id]?.id ?? "",
        mentionKind: links[id]?.kind === "role" ? "role" : "user",
      })),
    };
  }

  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    html[0]
      ?.querySelectorAll<HTMLSelectElement>("[data-mention-kind]")
      .forEach((select) => {
        select.value = select.dataset.selected ?? "user";
      });
  }

  protected override async _updateObject(
    _event: Event,
    formData: Record<string, unknown>,
  ): Promise<void> {
    const ids = formMap(formData, "ids");
    const kinds = formMap(formData, "kinds");
    const links: DiscordLinks = {};
    for (const [actorId, rawValue] of Object.entries(ids)) {
      const discordId = String(rawValue ?? "").trim();
      if (!discordId) continue;
      if (!/^\d{15,22}$/.test(discordId))
        throw new Error("Discord user and role IDs must contain 15–22 digits.");
      links[actorId] = {
        kind:
          actorId === CREW_LINK_KEY || kinds[actorId] === "role"
            ? "role"
            : "user",
        id: discordId,
      };
    }
    await setDiscordLinks(links);
    ui.notifications.info("Discord links saved.");
  }
}

export function getDiscordLinks(): DiscordLinks {
  const value = game.settings.get(MODULE_ID, DISCORD_LINKS_SETTING);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([actorId, link]) => {
      if (typeof link !== "object" || link === null) return [];
      const candidate = link as Record<string, unknown>;
      if (typeof candidate.id !== "string") return [];
      return [
        [
          actorId,
          {
            kind:
              candidate.kind === "role" ? ("role" as const) : ("user" as const),
            id: candidate.id,
          },
        ],
      ];
    }),
  );
}

async function setDiscordLinks(links: DiscordLinks): Promise<void> {
  await game.settings.set(MODULE_ID, DISCORD_LINKS_SETTING, links);
}

export function buildDiscordMarkdown(
  plan: PayoutPlan,
  links: DiscordLinks,
): string {
  const lines = [`## ${plan.sessionLabel}`, ""];
  if (plan.inGameDate.trim())
    lines.push(`**In-Game Date:** ${displayDate(plan.inGameDate.trim())}`);
  if (plan.notes.trim()) lines.push(`**Notes:** ${plan.notes.trim()}`);
  if (plan.inGameDate.trim() || plan.notes.trim()) lines.push("");

  if (
    plan.hqIpTransactions.length ||
    plan.communalItems.length ||
    plan.payoutContainer?.moneyAmount
  ) {
    lines.push("**Communal Payout**");
    if (
      plan.payoutContainer &&
      (plan.payoutContainer.moneyAmount || plan.communalItems.length)
    )
      lines.push(`- **Payout Container:** ${plan.payoutContainer.actor.name}`);
    for (const entry of plan.hqIpTransactions)
      lines.push(
        `- **HQ IP:** ${formatAdjustment(entry.amount)}${entry.reason.trim() ? ` — ${entry.reason.trim()}` : ""}`,
      );
    if (plan.payoutContainer?.moneyAmount)
      lines.push(
        `- **Money:** ${formatAdjustment(plan.payoutContainer.moneyAmount)}${plan.payoutContainer.moneyDescription.trim() ? ` — ${plan.payoutContainer.moneyDescription.trim()}` : ""}`,
      );
    for (const item of plan.communalItems)
      lines.push(
        `- **Item: ${item.name}:** ×${item.quantity}${item.description.trim() ? ` — ${item.description.trim()}` : ""}`,
      );
    lines.push("");
  }

  const groupEntries = plan.actors[0]?.entries.filter(
    ({ scope }) => scope === "group",
  );
  if (groupEntries?.length) {
    lines.push("**Primary Payout**");
    const crewLink = links[CREW_LINK_KEY];
    const crewMention = crewLink ? `<@&${crewLink.id}>` : "recipient";
    for (const entry of groupEntries) {
      const amount =
        entry.reward === "downtime"
          ? formatDays(entry.amount)
          : (entry.formula ?? formatAdjustment(entry.amount));
      lines.push(
        `- Each ${crewMention} — **${rewardLabel(entry.reward)}:** ${amount}${entry.description.trim() ? ` — ${entry.description.trim()}` : ""}`,
      );
    }
    lines.push("");
  }

  for (const { actor } of plan.actors) {
    if (isActorExcluded(actor.id)) continue;
    const link = links[actor.id];
    const mention = link
      ? link.kind === "role"
        ? `<@&${link.id}>`
        : `<@${link.id}>`
      : actor.name;
    const changes = plan.changes.filter(
      ({ targetId, details }) =>
        targetId === actor.id && details?.scope === "individual",
    );
    if (!changes.length) continue;
    const awards = changes.map((change) => {
      const description = String(change.details?.description ?? "").trim();
      const result =
        change.reward === "item"
          ? `×${change.amount}`
          : change.details?.pendingPlayerRoll
            ? `${String(change.details.formula)} (player roll pending)`
            : `${change.previousValue} → ${change.newValue} (${formatAdjustment(change.amount)})`;
      const faction = String(change.details?.faction ?? "").trim();
      const label =
        change.reward === "item"
          ? `Item: ${String(change.details?.itemName ?? "Unknown")}`
          : `${rewardLabel(change.reward)}${faction ? ` (${faction})` : ""}`;
      return `**${label}:** ${result}${description ? ` — ${description}` : ""}`;
    });
    lines.push(`- ${mention} — **${actor.name}:** ${awards.join("; ")}`);
  }
  if (plan.absentDowntime?.length) {
    lines.push("", "**Downtime — not in payout**");
    for (const { actor, days } of plan.absentDowntime) {
      const link = links[actor.id];
      const mention = link
        ? link.kind === "role"
          ? "<@&" + link.id + ">"
          : "<@" + link.id + ">"
        : actor.name;
      lines.push("- " + mention + " — **Downtime:** " + formatDays(days));
    }
  }
  return lines.join("\n").trim();
}

export function showDiscordSummary(markdown: string): void {
  const content = document.createElement("div");
  content.className = "discord-summary-dialog";
  const intro = document.createElement("p");
  intro.textContent = "Copy this summary into Discord:";
  const textarea = document.createElement("textarea");
  textarea.rows = 16;
  textarea.readOnly = true;
  textarea.value = markdown;
  textarea.textContent = markdown;
  content.append(intro, textarea);

  new Dialog({
    title: "Discord payout summary",
    content: content.outerHTML,
    buttons: {
      copy: {
        icon: '<i class="fas fa-copy"></i>',
        label: "Copy Markdown",
        callback: (html) => {
          const value =
            html[0]?.querySelector<HTMLTextAreaElement>("textarea")?.value;
          if (!value) return;
          void navigator.clipboard.writeText(value).then(
            () => ui.notifications.info("Discord payout summary copied."),
            () =>
              ui.notifications.warn(
                "Copy failed. Select the text and copy it manually.",
              ),
          );
        },
      },
    },
    default: "copy",
  }).render(true);
}

function formatAdjustment(amount: number): string {
  return amount >= 0 ? `+${amount}` : String(amount);
}

function rewardLabel(reward: string): string {
  return (
    (
      {
        money: "Money",
        ip: "IP",
        hqIp: "HQ IP",
        humanityGain: "Gain Humanity",
        humanityLoss: "Lose Humanity",
        reputation: "Reputation",
        factionReputation: "Faction Reputation",
        item: "Item",
        downtime: "Downtime",
      } as Record<string, string>
    )[reward] ?? reward
  );
}

function formatDays(amount: number): string {
  return `${amount} ${Math.abs(amount) === 1 ? "day" : "days"}`;
}

function formMap(
  formData: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const nested = formData[prefix];
  if (typeof nested === "object" && nested !== null)
    return nested as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(formData)
      .filter(([key]) => key.startsWith(`${prefix}.`))
      .map(([key, value]) => [key.slice(prefix.length + 1), value]),
  );
}
