interface SettingRow {
  namespace?: string;
  scope?: string;
  config?: boolean;
}
interface MenuRow {
  namespace?: string;
  restricted?: boolean;
}
interface Category {
  id: string;
  settings: SettingRow[];
  menus: MenuRow[];
  count: number;
}
interface CategoryData {
  categories: Category[];
  total: number;
  canConfigure: boolean;
}
interface NativeHTML {
  find(selector: string): { remove(): void };
}
declare class SettingsConfig {
  constructor(object: object, options: object);
  _prepareCategoryData(): CategoryData;
  activateListeners(html: NativeHTML): void;
  protected _onResetDefaults(event: Event): void;
  protected _updateObject(
    event: Event,
    data: Record<string, unknown>,
  ): Promise<unknown>;
  render(force: boolean): unknown;
}
declare function $(element: HTMLElement): NativeHTML;
declare class ContextMenu {
  constructor(
    element: NativeHTML,
    selector: string,
    entries: { name: string; icon: string; callback: () => unknown }[],
    options: { eventName: string; onOpen: () => void; onClose: () => void },
  );
  close(): Promise<void>;
  render(target: NativeHTML, options?: object): unknown;
}
const registry = () =>
  game.settings as unknown as {
    settings: Map<string, SettingRow>;
    menus: Map<string, MenuRow>;
  };
const modules = () =>
  game.modules as unknown as Map<
    string,
    { id: string; title: string; active: boolean }
  >;

const isPlayerSetting = (value: unknown, moduleId: string) => {
  const entry = value as {
    namespace?: string;
    scope?: string;
    config?: boolean;
  };
  return (
    entry.namespace === moduleId &&
    entry.scope === "client" &&
    entry.config === true
  );
};

/** Filter native prepared rows, retaining their native input types, values and listeners. */
export function createPlayerModuleSettings(moduleId: string) {
  class PlayerModuleSettings extends SettingsConfig {
    constructor(readonly moduleId: string) {
      super(
        {},
        {
          id: `pneuma-player-settings-${moduleId}`,
          title: `User Settings — ${modules().get(moduleId)?.title ?? moduleId}`,
          width: 560,
          height: 600,
          classes: ["package-configuration", "pneuma-player-settings"],
        },
      );
    }
    override _prepareCategoryData(): CategoryData {
      const data = super._prepareCategoryData();
      // Foundry v12 uses a Map; the pinned type declarations describe an array.
      const source = data.categories as unknown as
        Map<string, Category> | Category[];
      const rows = source instanceof Map ? [...source.values()] : source;
      const categories = rows
        .filter((category) => category.id === this.moduleId)
        .map((category) => {
          const settings = category.settings.filter((entry) =>
            isPlayerSetting(entry, this.moduleId),
          );
          const menus = category.menus.filter((entry) => !entry.restricted);
          return {
            ...category,
            settings,
            menus,
            count: settings.length + menus.length,
          };
        });
      return {
        ...data,
        categories: (source instanceof Map
          ? new Map(categories.map((row) => [row.id, row]))
          : categories) as unknown as Category[],
        total: categories.reduce((sum, row) => sum + row.count, 0),
        canConfigure: false,
      };
    }
    override activateListeners(html: NativeHTML): void {
      super.activateListeners(html);
      // The global reset is intentionally absent from this limited view.
      html
        .find(
          'button[name="reset"], button[data-action="reset"], .reset-defaults',
        )
        .remove();
    }
    protected override _onResetDefaults(_event: Event): void {
      /* No global reset in a module-only view. */
    }
    protected override async _updateObject(
      event: Event,
      formData: Record<string, unknown>,
    ): Promise<unknown> {
      const allowed = Object.fromEntries(
        Object.entries(formData).filter(([key]) => {
          const setting = registry().settings.get(key);
          return setting && isPlayerSetting(setting, this.moduleId);
        }),
      );
      return super._updateObject(event, allowed as Record<string, unknown>);
    }
  }

  return new PlayerModuleSettings(moduleId);
}

export function playerSettingsModules(): {
  id: string;
  title: string;
  available: boolean;
}[] {
  return [...(modules().values() ?? [])]
    .filter(
      (module) =>
        module.active &&
        [
          "pneuma-combattools",
          "pneuma-crewtools",
          "pneuma-scenetools",
          "pneuma-visualtools",
        ].includes(module.id),
    )
    .map((module) => ({
      id: module.id,
      title: module.title.replace(/^Pneuma(?:'s)?\s*/i, ""),
      available:
        [...(registry().settings.values() ?? [])].some((entry) =>
          isPlayerSetting(entry, module.id),
        ) ||
        [...(registry().menus.values() ?? [])].some(
          (entry) => entry.namespace === module.id && !entry.restricted,
        ),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
export function addPlayerSettingsGear(root: HTMLElement): void {
  if (!root || root.querySelector(".pneuma-player-settings-launcher")) return;
  const launcher = document.createElement("div");
  launcher.className = "pneuma-player-settings-launcher";
  const gear = document.createElement("button");
  gear.type = "button";
  gear.title = "User Settings";
  gear.setAttribute("aria-label", "User Settings");
  gear.setAttribute("aria-expanded", "false");
  gear.innerHTML = '<i class="fas fa-gear" aria-hidden="true"></i>';
  const anchor = document.createElement("div");
  anchor.className = "pneuma-player-settings-anchor";
  anchor.append(gear);
  launcher.append(anchor);
  root.prepend(launcher);
  const entries = playerSettingsModules();
  class UserSettingsMenu extends ContextMenu {
    override async render(
      target: NativeHTML,
      options?: object,
    ): Promise<unknown> {
      const result = await super.render(target, options);
      const list = document.getElementById("context-menu");
      if (!list) return result;
      list.classList.add("pneuma-user-settings-popup", "pneuma-panel");
      list.setAttribute("aria-label", "User Settings");
      if (!list.querySelector(".pneuma-user-settings-heading")) {
        const heading = document.createElement("div");
        heading.className = "pneuma-user-settings-heading combat-heading";
        heading.textContent = "User Settings";
        list.prepend(heading);
      }
      list.querySelectorAll(".context-item").forEach((item, index) => {
        if (!entries[index]?.available) {
          item.setAttribute("aria-disabled", "true");
          item.setAttribute("title", "No user settings");
        }
      });
      const bounds = gear.getBoundingClientRect();
      document.body.append(list);
      list.style.position = "fixed";
      list.style.bottom = "auto";
      list.style.top =
        Math.max(
          8,
          Math.min(
            bounds.bottom + 4,
            window.innerHeight - list.offsetHeight - 8,
          ),
        ) + "px";
      list.style.left =
        Math.max(
          8,
          Math.min(bounds.left, window.innerWidth - list.offsetWidth - 8),
        ) + "px";
      list.style.right = "auto";
      list.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          void this.close();
          gear.focus();
        }
      });
      return result;
    }
  }
  const menu = new UserSettingsMenu(
    $(root),
    ".pneuma-player-settings-anchor",
    entries.map((module) => ({
      name: module.title + (module.available ? "" : " — No player settings"),
      icon: module.available
        ? '<i class="fas fa-sliders-h"></i>'
        : '<i class="fas fa-ban"></i>',
      callback: () => {
        if (module.available)
          createPlayerModuleSettings(module.id).render(true);
      },
    })),
    {
      eventName: "click",
      onOpen: () => gear.setAttribute("aria-expanded", "true"),
      onClose: () => gear.setAttribute("aria-expanded", "false"),
    },
  );
  launcher.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      void menu.close();
      gear.focus();
    }
  });
}
