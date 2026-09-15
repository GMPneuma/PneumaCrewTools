import { CrewToolsForm } from "./foundry-form";
import {
  EXCLUDED_ACTORS_SETTING,
  isActorExcluded,
  isUpgradeStorageActor,
  isTeammateActor,
} from "./actor-policy";
import { MODULE_ID } from "./constants";

// Include every Actor type with a non-GM owner, including already hidden Actors.
function hasPlayerOwner(actor: FoundryActor): boolean {
  return Array.from(game.users).some(
    (user) => !user.isGM && actor.testUserPermission(user, "OWNER"),
  );
}

class ActorExclusionsForm extends CrewToolsForm {
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-actor-exclusions",
      title: "Hide Player Actors",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/actor-exclusions.hbs`,
      width: 540,
      height: 600,
      resizable: true,
      closeOnSubmit: true,
    };
  }
  override getData(): object {
    return {
      actors: Array.from(game.actors)
        .filter(
          (a) =>
            hasPlayerOwner(a) &&
            !isUpgradeStorageActor(a) &&
            !isTeammateActor(a.id),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          excluded: isActorExcluded(a.id),
        })),
    };
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!game.user?.isGM)
      throw new Error("Only GMs can change Actor exclusions.");
    // Save visible choices without changing exclusions for Actors outside this list.
    const ids = Array.from(game.actors)
      .filter((a) => !isUpgradeStorageActor(a))
      .filter((a) =>
        hasPlayerOwner(a)
          ? data["exclude." + a.id] === true
          : isActorExcluded(a.id),
      )
      .map((a) => a.id);
    await game.settings.set(MODULE_ID, EXCLUDED_ACTORS_SETTING, ids);
    ui.notifications.info("Actor exclusions saved.");
  }
}
export function registerActorExclusions(): void {
  game.settings.register(MODULE_ID, EXCLUDED_ACTORS_SETTING, {
    name: "Hide Player Actors",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });
  game.settings.registerMenu(MODULE_ID, "actorExclusions", {
    name: "Hide Player Actors",
    label: "Hide Player Actors",
    hint: "Hide player-owned Actors from Crew Tools selectors, payouts, attendance, downtime, and status indicators.",
    icon: "fas fa-user-slash",
    type: ActorExclusionsForm,
    restricted: true,
  });
  Hooks.on("updateSetting", (setting?: { key?: string }) => {
    if (setting?.key !== MODULE_ID + "." + EXCLUDED_ACTORS_SETTING) return;
    // Refresh module windows so an exclusion takes effect without a world reload.
    for (const app of Object.values(ui.windows ?? {}))
      if (app.rendered && app.options?.id?.startsWith(MODULE_ID))
        app.render(false);
  });
}
