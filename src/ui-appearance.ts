import { MODULE_ID } from "./constants";

// Add future UI colors here; registration, picker and CSS application are shared.
const UI_COLORS = [
  {
    key: "calendarFontColor",
    name: "Appearance: Calendar Font Color",
    hint: "Date display text color on this device. Default: Biomonitor blue (#b8efeb).",
    variable: "--pneuma-calendar-font-color",
    default: "#b8efeb",
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

/** Replace the former shipped aqua default without resetting other custom colors. */
export async function readyUiAppearance(): Promise<void> {
  const saved = game.settings.get(MODULE_ID, "calendarFontColor");
  if (typeof saved === "string" && saved.toLowerCase() === "#7fffea") {
    await game.settings.set(MODULE_ID, "calendarFontColor", "#b8efeb");
  }
  applyUiAppearance();
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
      if (!root) return;
      for (const color of UI_COLORS) {
        const input = root?.querySelector<HTMLInputElement>(
          `input[name="${MODULE_ID}.${color.key}"]`,
        );
        if (!input) continue;
        const value = validColor(input.value, color.default);
        input.type = "color";
        input.value = value;
      }
      const lastColor = UI_COLORS[UI_COLORS.length - 1]!;
      const lastRow = root
        ?.querySelector<HTMLInputElement>(
          `input[name="${MODULE_ID}.${lastColor.key}"]`,
        )
        ?.closest(".form-group");
      if (!lastRow || root.querySelector("[data-reset-hud-colors]")) return;
      const reset = document.createElement("button");
      reset.type = "button";
      reset.dataset.resetHudColors = "";
      reset.textContent = "Reset HUD Colors to Defaults";
      reset.title =
        "Reset all three HUD colors on this device and apply immediately.";
      reset.addEventListener("click", async () => {
        reset.disabled = true;
        try {
          for (const color of UI_COLORS) {
            await game.settings.set(MODULE_ID, color.key, color.default);
          }
        } catch (error) {
          console.error(`${MODULE_ID} | HUD color reset failed`, error);
          ui.notifications.error(
            "Could not reset all HUD colors. Please try again.",
          );
        } finally {
          for (const color of UI_COLORS) {
            const input = root.querySelector<HTMLInputElement>(
              `input[name="${MODULE_ID}.${color.key}"]`,
            );
            if (input)
              input.value = validColor(
                game.settings.get(MODULE_ID, color.key),
                color.default,
              );
          }
          applyUiAppearance();
          reset.disabled = false;
        }
      });
      lastRow.append(reset);
    },
  );
}
