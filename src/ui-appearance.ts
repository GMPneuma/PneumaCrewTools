import { MODULE_ID } from "./constants";

// Add future UI colors here; registration, picker and CSS application are shared.
const UI_COLORS = [
  {
    key: "calendarFontColor",
    name: "Appearance: Calendar Font Color",
    hint: "Date display text color on this device. Default: aqua (#7fffea).",
    variable: "--pneuma-calendar-font-color",
    default: "#7fffea",
  },
  {
    key: "hudIconColor",
    name: "Appearance: HUD Icon Color",
    hint: "Shortcut icon color when nothing is waiting, on this device.",
    variable: "--pneuma-hud-icon-color",
    default: "#86aaa8",
  },
  {
    key: "hudAttentionColor",
    name: "Appearance: HUD Attention Color",
    hint: "Shortcut icon color for waiting payouts and unspent downtime, on this device.",
    variable: "--pneuma-hud-attention-color",
    default: "#ffc36a",
  },
] as const;

function validColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}

export function applyUiAppearance(): void {
  for (const color of UI_COLORS) {
    document.documentElement.style.setProperty(
      color.variable,
      validColor(game.settings.get(MODULE_ID, color.key), color.default),
    );
  }
}

export function registerUiAppearance(): void {
  for (const color of UI_COLORS) {
    game.settings.register(MODULE_ID, color.key, {
      name: color.name,
      hint: color.hint,
      scope: "client",
      config: true,
      type: String,
      default: color.default,
      onChange: () => applyUiAppearance(),
    });
  }
  Hooks.on(
    "renderSettingsConfig",
    (_app: unknown, html: FoundryHtml | HTMLElement) => {
      const root = html instanceof HTMLElement ? html : html[0];
      for (const color of UI_COLORS) {
        const input = root?.querySelector<HTMLInputElement>(
          `input[name="${MODULE_ID}.${color.key}"]`,
        );
        if (!input) continue;
        const value = validColor(input.value, color.default);
        input.type = "color";
        input.value = value;
      }
    },
  );
}
