import { activityRollRecipients } from "./roll-visibility";
import { rollCard } from "./roll-card";
import {
  techSkills,
  techRole,
  itemPrice,
  checkProject,
  snapshot,
  removeItem,
} from "./tech-system";
import { storageActor } from "./upgrade-storage";
export { techSkills, techRole, itemPrice } from "./tech-system";
export { storageActor, syncUpgradeStorage } from "./upgrade-storage";
import { deliverItems } from "./actor-resources";
import { MODULE_ID } from "./constants";
import {
  downtimeBalance,
  recordDowntimeTransaction,
  type DowntimeState,
  type DowntimeEvent,
} from "./downtime-model";
import {
  TECH_CATEGORIES,
  TECH_MONTH_SETTING,
  TECH_MULTIPLE_SETTING,
  projectSchedule,
  techProjects,
  recordTechActivity,
  type TechInput,
  type TechSpec,
} from "./tech-project-model";

export function techSlotLimit(hasWorkshop: boolean): number {
  return hasWorkshop ||
    game.settings.get(MODULE_ID, TECH_MULTIPLE_SETTING) === true
    ? 3
    : 1;
}
export function registerTechSettings() {
  game.settings.register(MODULE_ID, TECH_MONTH_SETTING, {
    name: "TECH crafting days per month",
    hint: "Used when starting Luxury and Super Luxury projects. Existing project durations stay fixed.",
    scope: "world",
    config: true,
    type: Number,
    default: 28,
    range: { min: 28, max: 31, step: 1 },
  });
  game.settings.register(MODULE_ID, TECH_MULTIPLE_SETTING, {
    name: "Allow multiple projects even without Workshop",
    hint: "Enable all three TECH project slots without an HQ Workshop.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}
export function categoryForPrice(price: number): string {
  return [...TECH_CATEGORIES].reverse().find((c) => price >= c.price)?.id ?? "";
}
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function validateTechRequest(
  state: DowntimeState,
  event: DowntimeEvent,
  actor: FoundryActor,
  slots: number,
  input?: TechInput,
) {
  if (!techRole(actor)) throw new Error("A ranked TECH role is required.");
  if (event.days !== (event.kind === "techDay" ? 1 : 0))
    throw new Error("Invalid TECH day count.");
  if (event.period !== state.period)
    throw new Error("This request belongs to an earlier session.");
  if (event.kind === "techStart") {
    if (
      !input ||
      !["fabricate", "upgrade", "invention"].includes(input.mode) ||
      !Number.isInteger(input.slot) ||
      input.slot < 0 ||
      input.slot >= slots
    )
      throw new Error("Choose an enabled TECH project slot.");
    if (
      techProjects(state, actor.id).some(
        (p) => p.active && p.slot === input.slot,
      )
    )
      throw new Error("This project slot is occupied.");
    if (
      !input.name?.trim() ||
      input.name.length > 100 ||
      typeof input.description !== "string" ||
      input.description.length > 4000
    )
      throw new Error(
        "Enter a project name and description (up to 4,000 characters).",
      );
    if (!techSkills(actor).some((s) => s.id === input.skillId))
      throw new Error("Choose a TECH skill on this character.");
    if (input.mode === "invention" && !input.description.trim())
      throw new Error("Describe the invention.");
    return;
  }
  const project = techProjects(state, actor.id).find(
    (p) => p.id === event.projectId && p.active,
  );
  if (!project)
    throw new Error("Active TECH project not found for this character.");
  if (event.kind !== "techCancel" && project.slot >= slots)
    throw new Error(
      "This slot requires a Workshop or the multiple-projects setting.",
    );
  if (event.kind === "techDay") {
    if (event.days !== 1 || downtimeBalance(state, actor.id) < 1)
      throw new Error("One available downtime day is required.");
    if (project.progress >= project.required)
      throw new Error(
        "Required days are already allocated. Roll the skill check.",
      );
  } else if (event.kind === "techRoll") {
    if (!project.canRoll)
      throw new Error(
        "Allocate half the required days before rolling; after failure allocate another half.",
      );
  } else if (event.kind !== "techCancel")
    throw new Error("Unknown TECH action.");
}
export interface TechProcessContext {
  state: DowntimeState;
  event: DowntimeEvent;
  actor: FoundryActor;
  input?: TechInput;
  requester?: FoundryUser;
  slots: number;
  save: (state: DowntimeState) => Promise<void>;
  attempt: (details: Record<string, unknown> | null) => Promise<void>;
}
export async function processTechRequest(
  ctx: TechProcessContext,
): Promise<void> {
  const { state, event, actor, input, slots } = ctx;
  validateTechRequest(state, event, actor, slots, input);
  let mutation = false;
  if (event.kind === "techStart") {
    const data = input!;
    let source: FoundryItem | undefined;
    if (data.mode !== "invention") {
      source = (await fromUuid(data.sourceUuid ?? "")) as
        FoundryItem | undefined;
      if (!source || source.documentName !== "Item")
        throw new Error("Drop a native Item onto the project.");
      if (
        !ctx.requester ||
        !source.testUserPermission?.(
          ctx.requester,
          data.mode === "upgrade" ? "OWNER" : "OBSERVER",
        )
      )
        throw new Error("You do not have permission to use this source Item.");
      if (data.mode === "upgrade" && source.pack)
        throw new Error(
          "Upgrade a world or inventory Item, not a compendium template.",
        );
      data.price = itemPrice(source);
      data.category = categoryForPrice(data.price);
      data.name = source.name;
    }
    const month = Number(
      game.settings.get(MODULE_ID, TECH_MONTH_SETTING) ?? 28,
    );
    const spec: TechSpec = {
      ...data,
      ...projectSchedule(data.category, data.price, month),
      itemData: source
        ? snapshot(source)
        : {
            name: data.name,
            type: "gear",
            img: "icons/svg/item-bag.svg",
            system: {
              description: { value: "<p>" + esc(data.description) + "</p>" },
              price: { market: data.price },
              amount: 1,
            },
          },
    };
    if (data.mode === "upgrade" && source) {
      const storage = await storageActor(actor);
      const itemId = foundry.utils.randomID(16);
      await ctx.attempt({
        requestId: event.requestId,
        projectId: event.id,
        sourceUuid: data.sourceUuid,
        destinationActorId: storage.id,
        destinationItemId: itemId,
        action: "Move upgrade item",
      });
      mutation = true;
      const [stored] = await deliverItems(
        storage,
        [{ ...spec.itemData, _id: itemId }],
        { keepId: true },
      );
      if (!stored) throw new Error("Upgrade item could not be stored.");
      await removeItem(source);
      spec.storageActorId = storage.id;
      spec.storageItemId = stored.id;
    }
    event.tech = spec;
    event.reason =
      spec.mode +
      ": " +
      spec.name +
      "; " +
      spec.required +
      " days; DV " +
      spec.dv;
  } else {
    const project = techProjects(state, actor.id).find(
      (p) => p.id === event.projectId,
    )!;
    if (event.kind === "techRoll") {
      event.techCheck = await checkProject(actor, project);
      if (!event.techCheck) return;
      event.reason =
        project.name +
        ": " +
        event.techCheck.skillName +
        " + " +
        event.techCheck.specialty +
        " " +
        event.techCheck.rank +
        " = " +
        event.techCheck.total +
        " vs DV " +
        project.dv +
        "; " +
        (event.techCheck.success
          ? "success"
          : "failure; " + project.half + " days burned");
    } else
      event.reason =
        (event.kind === "techCancel" ? "Cancel " : "Allocate day: ") +
        project.name;
  }
  recordTechActivity(state, event);
  const { tech, techCheck, techDelivery, ...resourceEvent } = event;
  recordDowntimeTransaction(state, {
    ...resourceEvent,
    activityId: event.projectId ?? event.id,
  });
  const project = techProjects(state, actor.id).find(
    (p) => p.id === event.projectId,
  );
  if (
    project &&
    ((project.success && project.progress >= project.required) ||
      event.kind === "techCancel")
  ) {
    if (event.kind !== "techCancel" || project.mode === "upgrade") {
      let held: FoundryItem | undefined;
      if (project.mode === "upgrade") {
        const storage = Array.from(game.actors).find(
          (a) => a.id === project.storageActorId,
        );
        held = Array.from(storage?.items ?? []).find(
          (i) => i.id === project.storageItemId,
        );
        if (!held)
          throw new Error("Upgrade item is missing from its container.");
      }
      const itemId = foundry.utils.randomID(16);
      await ctx.attempt({
        requestId: event.requestId,
        projectId: project.id,
        action: "Deliver project item",
        sourceUuid: held?.uuid ?? null,
        destinationActorId: actor.id,
        destinationItemId: itemId,
      });
      mutation = true;
      const data = held ? snapshot(held) : structuredClone(project.itemData);
      if (
        project.mode === "upgrade" &&
        event.kind !== "techCancel" &&
        project.description.trim()
      ) {
        const system = (data.system ??= {}) as {
          description?: { value?: string };
        };
        system.description ??= { value: "" };
        system.description.value =
          (system.description.value ?? "") +
          "<p><strong>TECH upgrade notes:</strong> " +
          esc(project.description) +
          "</p>";
      }
      const [delivered] = await deliverItems(
        actor,
        [{ ...data, _id: itemId }],
        { keepId: true },
      );
      if (!delivered) throw new Error("Project item could not be delivered.");
      if (held) await removeItem(held);
      event.techDelivery = { actorId: actor.id, itemId: delivered.id };
      event.reason +=
        "; delivered " +
        delivered.name +
        " to Actor." +
        actor.id +
        ".Item." +
        delivered.id;
    }
  }
  recordTechActivity(state, event);
  const transaction = state.events.find((e) => e.id === event.id);
  if (transaction) transaction.reason = event.reason;
  // Once Items were moved, an interrupted write retains a visible Journal guard for GM reconciliation.
  await ctx.save(state);
  if (mutation) await ctx.attempt(null);
  if (event.techCheck || event.techDelivery) {
    try {
      await ChatMessage.create({
        speaker: { actor: actor.id, alias: actor.name },
        whisper: activityRollRecipients(actor),
        content: rollCard({
          title: "TECH Project",

          subject: project?.name ?? event.tech?.name ?? "Project",
          outcome:
            event.kind === "techCancel"
              ? "RETURNED"
              : event.techDelivery
                ? "COMPLETE"
                : event.techCheck?.success
                  ? "SUCCESS"
                  : "FAILURE",
          success: event.techCheck?.success ?? true,
          check: event.techCheck
            ? {
                total: event.techCheck.total,
                dv: event.techCheck.dv,
                label:
                  event.techCheck.skillName +
                  " + " +
                  event.techCheck.specialty +
                  " " +
                  event.techCheck.rank,
              }
            : undefined,
          effect:
            event.kind === "techCancel"
              ? "Item returned to inventory. Allocated days are lost."
              : event.techDelivery
                ? "Item added to inventory."
                : event.techCheck?.success
                  ? "Check passed. " +
                    project?.progress +
                    " / " +
                    project?.required +
                    " days allocated."
                  : (event.techCheck?.burned ?? 0) +
                    " days burned. Add days before retrying.",
        }),
      });
    } catch (error) {
      console.error(MODULE_ID + " | TECH chat", error);
    }
  }
}
