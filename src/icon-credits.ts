import { MODULE_ID } from "./constants";
import { CrewToolsForm } from "./foundry-form";

// Use the native settings application so everyone can read the bundled credits.
class IconCredits extends CrewToolsForm {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-icon-credits",
      title: "Icon credits",
      template: "modules/" + MODULE_ID + "/templates/icon-credits.hbs",
      width: 600,
      height: "auto",
      resizable: true,
      scrollY: [".window-content"],
    };
  }

  // Credits contain no editable settings or persistent state.
  protected override async _updateObject(): Promise<void> {}
}

export function registerIconCredits(): void {
  game.settings.registerMenu(MODULE_ID, "iconCredits", {
    name: "Icon credits",
    label: "Icon credits",
    hint: "Original icon artists, source links, and licenses.",
    icon: "fas fa-palette",
    type: IconCredits,
    restricted: false,
  });
}
