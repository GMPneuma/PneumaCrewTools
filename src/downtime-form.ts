import { accessibleCrewActors } from "./actor-policy";
import { medtechRole } from "./medtech-system";
import { loadMedicalCatalog } from "./medtech";
import { requiresFullDowntimeWeek } from "./downtime-settings";
import { CrewToolsForm } from "./foundry-form";
import { activityPage, storedDowntimeBalance } from "./downtime-records";
import {
  THERAPIES,
  medicalTargets,
  medicalView,
  reservedMedicalDay,
  type MedicalAction,
} from "./medtech";
import { isActorExcluded } from "./actor-policy";
import { getHeadquarters } from "./headquarters";
import {
  MULTIPLY_ANTIBIOTIC_SETTING,
  defaultHealingOptions,
  findMedbay,
  healingPreview,
  type HealingOptions,
  type HealingResult,
} from "./downtime-healing";
import { characterRoles } from "./downtime-activities";
import { MODULE_ID } from "./constants";
import { hustleDays } from "./downtime-model";
import {
  TECH_CATEGORIES,
  techProjects,
  type TechInput,
  type TechMode,
} from "./tech-project-model";
import { techSkills, itemPrice, categoryForPrice } from "./tech-projects";
import {
  actorLedger,
  getDowntime,
  getIndex,
  escape,
  playerCharacter,
  ownedCharacter,
} from "./downtime-store";
import {
  requestMedicalAction,
  requestTechAction,
  requestDowntimeUse,
  requestHustleRoll,
  currentTechSlots,
  healingFormula,
  report,
} from "./downtime-service";

export async function projectDialog(
  actorId: string,
  slot: number,
  mode: TechMode,
  sourceUuid?: string,
): Promise<void> {
  const actor = ownedCharacter(actorId);
  const source = sourceUuid
    ? ((await fromUuid(sourceUuid)) as FoundryItem)
    : undefined;
  if (mode !== "invention" && source?.documentName !== "Item")
    throw new Error("Drop an Item onto the project first.");
  const price = source ? itemPrice(source) : 100;
  const category = categoryForPrice(price);
  const skills = techSkills(actor);
  if (!skills.length) throw new Error("This character has no TECH skills.");
  const input = await new Promise<TechInput | null>((resolve) => {
    new Dialog({
      title:
        mode === "invention"
          ? "Invention"
          : mode === "upgrade"
            ? "Upgrade Item"
            : "Fabricate Item",
      content:
        '<form><div class="form-group"><label>Name</label><input name="projectName" maxlength="100" value="' +
        escape(source?.name ?? "") +
        '"></div>' +
        '<div class="form-group"><label>Description / upgrade notes</label><textarea name="description" maxlength="4000" rows="3"></textarea></div>' +
        (source
          ? "<p>Cost category: " + escape(category) + " · " + price + " eb</p>"
          : '<div class="form-group"><label>Cost category</label><select name="category">' +
            TECH_CATEGORIES.map(
              (c) => '<option value="' + c.id + '">' + c.name + "</option>",
            ).join("") +
            "</select></div>" +
            '<div class="form-group"><label>Super Luxury value (eb)</label><input name="price" type="number" min="10000" step="1" value="10000"></div>') +
        '<div class="form-group"><label>TECH skill</label><select name="skillId">' +
        skills
          .map(
            (i) =>
              '<option value="' +
              escape(i.id) +
              '">' +
              escape(i.name) +
              "</option>",
          )
          .join("") +
        "</select></div></form>",
      buttons: {
        start: {
          label: "Start Project",
          callback: (html) => {
            const val = (n: string) =>
              html[0]?.querySelector<HTMLInputElement>('[name="' + n + '"]')
                ?.value ?? "";
            const chosen = source ? category : val("category");
            resolve({
              mode,
              slot,
              sourceUuid,
              name: source?.name ?? val("projectName"),
              description: val("description"),
              category: chosen,
              price: source
                ? price
                : chosen === "superLuxury"
                  ? Number(val("price"))
                  : TECH_CATEGORIES.find((c) => c.id === chosen)!.price,
              skillId: val("skillId"),
            });
          },
        },
        cancel: { label: "Cancel", callback: () => resolve(null) },
      },
      default: "start",
      close: () => resolve(null),
    }).render(true);
  });
  if (input) await requestTechAction("techStart", actorId, undefined, input);
}

export async function startTherapyDialog(
  actorId: string,
  provider: boolean,
): Promise<void> {
  const targets = medicalTargets(actorId);
  const action = await new Promise<MedicalAction | null>((resolve) => {
    new Dialog({
      title: provider ? "Provide Therapy" : "Start Therapy",
      content:
        '<form><div class="form-group"><label>Therapy</label><select name="therapy">' +
        THERAPIES.map(
          (t) =>
            '<option value="' +
            t.id +
            '">' +
            t.name +
            " — " +
            (provider ? t.materials : t.cost) +
            " eb" +
            (provider ? " materials · DV " + t.dv : "") +
            "</option>",
        ).join("") +
        "</select></div>" +
        (provider
          ? '<div class="form-group"><label>Patient</label><select name="patient">' +
            targets
              .map(
                (a) =>
                  '<option value="' +
                  a.id +
                  '">' +
                  escape(a.name) +
                  "</option>",
              )
              .join("") +
            "</select></div>"
          : '<label><input type="checkbox" name="pc"> I’m getting therapy from a PC (no charge)</label>') +
        '<div class="form-group"><label>Addiction (if applicable)</label><input name="addiction" type="text" maxlength="200"></div><p>' +
        (requiresFullDowntimeWeek()
          ? "Seven downtime days and the cost are spent now."
          : "Cost is paid now. Allocate seven downtime days before completing this course.") +
        "</p></form>",
      buttons: {
        cancel: { label: "Cancel", callback: () => resolve(null) },
        start: {
          label: requiresFullDowntimeWeek()
            ? "Start Therapy · 7 days"
            : "Start Therapy",
          callback: (html) => {
            const root = html[0];
            resolve({
              kind: provider ? "providerStart" : "patientStart",
              type: root?.querySelector<HTMLSelectElement>('[name="therapy"]')
                ?.value,
              targetId:
                root?.querySelector<HTMLSelectElement>('[name="patient"]')
                  ?.value,
              pc: root?.querySelector<HTMLInputElement>('[name="pc"]')?.checked,
              addiction:
                root?.querySelector<HTMLInputElement>('[name="addiction"]')
                  ?.value,
            });
          },
        },
      },
      default: "cancel",
      close: () => resolve(null),
    }).render(true);
  });
  if (action) {
    await requestMedicalAction(actorId, action);
  }
}

export class DowntimeForm extends CrewToolsForm {
  selectedActorId: string | undefined;
  selectedHustleRoleId: string | undefined;
  private patientChoice = "standard";
  private patientPC = false;
  private patientAddiction = "";
  private dashboardWidth = 640;
  // Foundry handles vertical resizing; horizontal drags cannot change the column width.
  override setPosition(position: ApplicationPosition = {}) {
    return super.setPosition({ ...position, width: this.dashboardWidth });
  }
  healingOptions = defaultHealingOptions();
  #submitting = false;
  #rendering: Promise<void> | undefined;
  #pendingRender:
    { force: boolean; options: Record<string, unknown> } | undefined;
  // Keep only one trailing refresh while Foundry renders the current state.
  protected override _render(
    force: boolean,
    options: Record<string, unknown> = {},
  ): Promise<void> {
    if (this.#rendering) {
      this.#pendingRender = {
        force: force || !!this.#pendingRender?.force,
        options,
      };
      return this.#rendering;
    }
    this.#rendering = (async () => {
      let next:
        { force: boolean; options: Record<string, unknown> } | undefined = {
        force,
        options,
      };
      while (next) {
        const actors = accessibleCrewActors();
        const actor =
          actors.find((a) => a.id === this.selectedActorId) ??
          actors.find((a) => a.id === game.user?.character?.id) ??
          actors[0];
        if (actor && medtechRole(actor)) await loadMedicalCatalog();
        await super._render(next.force, next.options);
        next = this.#pendingRender;
        this.#pendingRender = undefined;
      }
    })().finally(() => {
      this.#rendering = undefined;
    });
    return this.#rendering;
  }
  // Spending is a repeatable action, never a save-and-close form operation.
  protected override async _onSubmit(
    event: Event,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    const result = await super._onSubmit(event, {
      ...options,
      preventClose: true,
      preventRender: true,
    });
    this.render(false);
    return result;
  }
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      title: "Crew Tools — Downtime",
      classes: [...(super.defaultOptions.classes ?? []), MODULE_ID],
      template: `modules/${MODULE_ID}/templates/downtime.hbs`,
      id: MODULE_ID + "-downtime",
      width: 640,
      height: 640,
      resizable: true,
      // Preserve the actual scrolling panel across native Foundry redraws.
      scrollY: [".downtime-stack"],
      closeOnSubmit: false,
      submitOnChange: false,
    };
  }
  override getData(): object {
    const index = getIndex();
    const actors = Array.from(game.actors).filter(
      (a) =>
        !isActorExcluded(a.id) &&
        a.type === "character" &&
        game.user &&
        (game.user.isGM
          ? playerCharacter(a) ||
            index.accounts.some((account) => account.actorId === a.id)
          : a.testUserPermission(game.user, "OWNER")),
    );
    const actor =
      actors.find((a) => a.id === this.selectedActorId) ??
      actors.find((a) => a.id === game.user?.character?.id) ??
      actors[0];
    this.selectedActorId = actor?.id;
    const state = actor
      ? getDowntime(actor.id)
      : { ...index, accounts: [], events: [], activities: [] };
    const account = state.accounts[0];
    // All dashboard actions use the same available-day calculation.
    const balance = account ? storedDowntimeBalance(account.actorId) : 0;
    const medicalPage = actor ? activityPage(actor.id) : undefined;
    const available = balance - reservedMedicalDay(medicalPage);
    const fullWeek = requiresFullDowntimeWeek();
    const hustle = actor ? hustleDays(state, actor.id) : 0;
    const projects = actor ? techProjects(state, actor.id) : [];
    const slotLimit = currentTechSlots();
    let healing: HealingResult | undefined;
    let healingError = "";
    let medbayAvailable = false;
    try {
      const hqs = getHeadquarters(false);
      medbayAvailable = Boolean(findMedbay(hqs));
      if (!medbayAvailable) this.healingOptions.medbay = false;
      if (actor)
        healing = healingPreview(
          actor,
          this.healingOptions,
          hqs,
          game.settings.get(MODULE_ID, MULTIPLY_ANTIBIOTIC_SETTING) !== false,
        );
    } catch (error) {
      healingError =
        error instanceof Error ? error.message : "Healing unavailable.";
    }
    const roles = characterRoles(actor).filter((r) => r.rank <= 10);
    const canCraft = roles.some((r) => r.tech);
    const medical = medicalView(actor, medicalPage, balance);
    const hasRoleAreas = canCraft || medical.canMedtech;
    const canHustle = roles.some((r) => r.rank <= 10);
    return {
      patientChoices: THERAPIES.map((t) => ({
        id: t.id,
        label: t.name + " · " + (this.patientPC ? 0 : t.cost) + " eb",
        selected: t.id === this.patientChoice,
      })),
      patientPC: this.patientPC,
      patientAddiction: this.patientAddiction,
      patientNeedsAddiction: this.patientChoice === "addiction",
      healing,
      healingFormula: healing ? healingFormula(healing) : "",
      healingOptions: this.healingOptions,
      healingError,
      medbayAvailable,
      canHeal: Boolean(
        healing && healing.restored > 0 && account && available > 0,
      ),
      ...medical,
      hasRoleAreas,
      actorId: actor?.id ?? "",
      hasMultipleActors: actors.length > 1,
      actors: actors.map((a) => ({
        id: a.id,
        name: a.name,
        selected: a.id === actor?.id,
      })),
      roles: roles.map((r) => ({
        ...r,
        selected:
          r.id ===
          (roles.find((r) => r.id === this.selectedHustleRoleId) ?? roles[0])
            ?.id,
      })),
      canCraft,
      techSlots: canCraft
        ? Array.from({ length: 3 }, (_, slot) => {
            const project = actor
              ? projects.find((p) => p.active && p.slot === slot)
              : undefined;
            const enabled = slot < slotLimit;
            return {
              slot,
              number: slot + 1,
              enabled,
              project,
              canAdd:
                enabled &&
                project &&
                project.progress < project.required &&
                !!actor &&
                available > 0,
              canRoll: enabled && project?.canRoll,
              stored: !!project?.storageItemId,
              progressPercent: project
                ? Math.max(
                    0,
                    Math.min(100, (100 * project.progress) / project.required),
                  )
                : 0,
            };
          })
        : [],
      canHustle,
      fullWeek,
      hustleDays: hustle,
      hustleDaysNeeded: Math.max(0, 7 - hustle),
      canFillHustle:
        canHustle && !!account && hustle < 7 && available >= 7 - hustle,
      hustleProgress: actor
        ? Math.max(0, Math.min(100, (100 * hustle) / 7))
        : 0,
      canAddHustle: canHustle && !!account && available > 0,
      canRollHustle:
        canHustle && !!actor && (fullWeek ? available >= 7 : hustle >= 7),
      multipleRoles: roles.length > 1,
      period: state.period,
      isGM: game.user?.isGM,
      ready: Boolean(account && actorLedger(account.actorId)),
      balance: account ? balance : "—",
      hasActor: Boolean(actor),
    };
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    const root = html[0];
    const field = (name: string) =>
      root?.querySelector<HTMLInputElement | HTMLSelectElement>(
        '[name="' + name + '"]',
      )?.value ?? "";
    const perform = async (fn: () => Promise<void>) => {
      if (this.#submitting) return;
      this.#submitting = true;
      try {
        this.selectedActorId = field("actorId");
        await fn();
        this.render(false);
      } catch (error) {
        report(error);
      } finally {
        this.#submitting = false;
      }
    };
    root?.querySelectorAll<HTMLElement>("[data-tech-slot]").forEach((row) => {
      const slot = Number(row.dataset.techSlot);
      const mode = () =>
        row.querySelector<HTMLSelectElement>("[data-tech-mode]")
          ?.value as TechMode;
      row.querySelector("[data-tech-new]")?.addEventListener(
        "click",
        () =>
          void perform(() => {
            if (mode() !== "invention")
              throw new Error(
                "Drop an Item onto this slot to fabricate or upgrade it.",
              );
            return projectDialog(field("actorId"), slot, "invention");
          }),
      );
      const drop = row.querySelector<HTMLElement>("[data-tech-drop]");
      row.querySelector("[data-tech-mode]")?.addEventListener("change", () => {
        const invent = mode() === "invention";
        if (drop) drop.hidden = invent;
        const button = row.querySelector<HTMLButtonElement>("[data-tech-new]");
        if (button) button.hidden = !invent;
      });
      drop?.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      drop?.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void perform(async () => {
          if (mode() === "invention")
            throw new Error("Use Setup for an invention.");
          const data = JSON.parse(
            e.dataTransfer?.getData("text/plain") ?? "{}",
          );
          if (data.type !== "Item" || typeof data.uuid !== "string")
            throw new Error("Drop a native Item.");
          await projectDialog(field("actorId"), slot, mode(), data.uuid);
        });
      });
    });
    root
      ?.querySelectorAll<HTMLButtonElement>("[data-tech-action]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () =>
            void perform(async () => {
              const id = button.dataset.techProject!;
              if (button.dataset.techAction === "open") {
                const project = techProjects(
                  getDowntime(field("actorId")),
                  field("actorId"),
                ).find((p) => p.id === id);
                const container = Array.from(game.actors).find(
                  (a) => a.id === project?.storageActorId,
                );
                Array.from(container?.items ?? [])
                  .find((i) => i.id === project?.storageItemId)
                  ?.sheet?.render(true);
                return;
              }
              if (button.dataset.techAction === "techCancel") {
                const project = techProjects(
                  getDowntime(field("actorId")),
                  field("actorId"),
                ).find((p) => p.id === id && p.active);
                if (!project) throw new Error("Active project not found.");
                const confirmed = await new Promise<boolean>((resolve) => {
                  new Dialog({
                    title: "Cancel TECH Project?",
                    content:
                      "<p>Are you sure you want to cancel <strong>" +
                      escape(project.name) +
                      "</strong>?</p><p>You will lose the downtime days spent so far. The " +
                      project.allocated +
                      " allocated day(s) will not be refunded.</p>" +
                      (project.mode === "upgrade"
                        ? "<p>The held item will return to the character without the pending upgrade notes.</p>"
                        : ""),
                    buttons: {
                      keep: {
                        label: "Keep Project",
                        callback: () => resolve(false),
                      },
                      cancelProject: {
                        label: "Cancel Project",
                        callback: () => resolve(true),
                      },
                    },
                    default: "keep",
                    close: () => resolve(false),
                  }).render(true);
                });
                if (!confirmed) return;
              }
              await requestTechAction(
                button.dataset.techAction as
                  "techDay" | "techRoll" | "techCancel",
                field("actorId"),
                id,
              );
            }),
        );
      });
    root
      ?.querySelectorAll<HTMLButtonElement>("[data-medical-action]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () =>
            void perform(async () => {
              const kind = button.dataset.medicalAction!;
              if (kind === "clearRoll") {
                const confirmed = await new Promise<boolean>((resolve) => {
                  new Dialog({
                    title: "Clear interrupted medical roll?",
                    content:
                      "<p>This attempt stopped before money, Humanity or inventory changes. Clear it to retry? Any unsaved roll result will be discarded.</p>",
                    buttons: {
                      cancel: {
                        label: "Cancel",
                        callback: () => resolve(false),
                      },
                      clear: {
                        label: "Clear Roll",
                        callback: () => resolve(true),
                      },
                    },
                    default: "cancel",
                    close: () => resolve(false),
                  }).render(true);
                });
                if (!confirmed) return;
              }
              if (kind === "patientCancel" || kind === "providerCancel") {
                const confirmed = await new Promise<boolean>((resolve) => {
                  new Dialog({
                    title: "Cancel Therapy?",
                    content:
                      "<p>Cancel this therapy course? Allocated downtime days and money already spent will not be refunded.</p>",
                    buttons: {
                      keep: {
                        label: "Keep Therapy",
                        callback: () => resolve(false),
                      },
                      cancelTherapy: {
                        label: "Cancel Therapy",
                        callback: () => resolve(true),
                      },
                    },
                    default: "keep",
                    close: () => resolve(false),
                  }).render(true);
                });
                if (!confirmed) return;
              }
              if (kind === "providerStart")
                return startTherapyDialog(field("actorId"), true);
              if (kind === "patientStart")
                return requestMedicalAction(field("actorId"), {
                  kind: "patientStart",
                  type: this.patientChoice,
                  pc: this.patientPC,
                  addiction: this.patientAddiction,
                });
              if (kind === "patientComplete")
                return requestMedicalAction(field("actorId"), {
                  kind: "patientComplete",
                  pcSuccess:
                    root?.querySelector<HTMLInputElement>(
                      '[name="patientSuccess"]',
                    )?.checked === true,
                });
              if (kind === "taskAddSurgery" || kind === "taskAddPharma")
                return requestMedicalAction(field("actorId"), {
                  kind: "taskAdd",
                  taskKind: kind === "taskAddSurgery" ? "surgery" : "pharma",
                  uuid: field(
                    kind === "taskAddSurgery" ? "surgeryItem" : "pharmaItem",
                  ),
                });
              await requestMedicalAction(field("actorId"), {
                kind: kind as MedicalAction["kind"],
                taskId: button.dataset.taskId,
                fillWeek: button.dataset.therapyFill === "true",
              });
            }),
        );
      });
    root
      ?.querySelector<HTMLSelectElement>('[name="patientType"]')
      ?.addEventListener("change", (event) => {
        this.patientChoice = (event.target as HTMLSelectElement).value;
        this.render(false);
      });
    root
      ?.querySelector<HTMLInputElement>('[name="patientPC"]')
      ?.addEventListener("change", (event) => {
        this.patientPC = (event.target as HTMLInputElement).checked;
        this.render(false);
      });
    root
      ?.querySelector<HTMLInputElement>('[name="patientAddiction"]')
      ?.addEventListener("input", (event) => {
        this.patientAddiction = (event.target as HTMLInputElement).value;
      });
    root?.querySelector('[name="actorId"]')?.addEventListener("change", () => {
      this.selectedActorId = field("actorId");
      this.healingOptions = defaultHealingOptions();
      this.render(true);
    });
    root
      ?.querySelectorAll<HTMLInputElement>("[data-healing-option]")
      .forEach((input) => {
        input.addEventListener("change", () => {
          const key = input.dataset.healingOption as keyof HealingOptions;
          this.healingOptions[key] = input.checked;
          this.selectedActorId = field("actorId");
          this.render(true);
        });
      });
    root
      ?.querySelector('[name="hustleRoleItemId"]')
      ?.addEventListener("change", () => {
        this.selectedHustleRoleId = field("hustleRoleItemId");
      });
    root
      ?.querySelector("[data-hustle-day]")
      ?.addEventListener(
        "click",
        () =>
          void perform(() =>
            requestDowntimeUse(
              1,
              "hustle",
              "Allocate one hustle day",
              field("actorId"),
            ),
          ),
      );
    root?.querySelector("[data-hustle-fill]")?.addEventListener(
      "click",
      () =>
        void perform(async () => {
          const actorId = field("actorId");
          // Read the latest allocation instead of trusting a potentially stale button label.
          const days = Math.max(
            0,
            7 - hustleDays(getDowntime(actorId), actorId),
          );
          if (days)
            await requestDowntimeUse(
              days,
              "hustle",
              `Allocate ${days} hustle days`,
              actorId,
            );
        }),
    );
    root
      ?.querySelector("[data-hustle-roll]")
      ?.addEventListener(
        "click",
        () =>
          void perform(() =>
            requestHustleRoll(field("actorId"), field("hustleRoleItemId")),
          ),
      );
    root?.querySelector("[data-heal-day]")?.addEventListener(
      "click",
      () =>
        void perform(() =>
          requestDowntimeUse(1, "rest", "Rest to heal", field("actorId"), {
            healing: { ...this.healingOptions },
          }),
        ),
    );
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (this.#submitting) return;
    this.#submitting = true;
    try {
      await requestDowntimeUse(
        Number(data.days),
        "spend",
        String(data.reason ?? ""),
        String(data.actorId),
      );
    } catch (error) {
      report(error);
    } finally {
      this.#submitting = false;
    }
  }
}
