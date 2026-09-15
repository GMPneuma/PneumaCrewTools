import { CrewToolsForm } from "./foundry-form";
import { MODULE_ID } from "./constants";
import { createUniqueId } from "./id";
import { accessibleCrewActors } from "./actor-policy";
import { getHeadquarters } from "./headquarters";
import { displayDate } from "./date-format";
import { coalesceRefresh } from "./ui-refresh";
import {
  DEFAULT_RENT_MODIFIERS,
  parseRentModifiers,
  modifierLabel,
  type RentRate,
  type RentChoice,
  housingReminder,
} from "./rent-model";
import {
  RENT_MODIFIERS_SETTING,
  rentConfig,
  previewRentBill,
  previewChoiceChange,
  characterRent,
  rentModifiers,
  hqRent,
  rentFormula,
  saveResidence,
  payPersonalRent,
  contributeRent,
  setHqRent,
  saveRentRates,
  reconcileRent,
  clearRentPaymentMarker,
} from "./rent";
let rentWindow: RentForm | undefined;
const report = (error: unknown) =>
  ui.notifications.error(
    error instanceof Error ? error.message : String(error),
  );
export function openRent(actorId?: string): void {
  rentWindow ??= new RentForm();
  rentWindow.actorId = actorId;
  rentWindow.render(true);
}
class RentForm extends CrewToolsForm {
  actorId?: string;
  private busy = false;
  private draft?: { actorId: string; choice: RentChoice };
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-rent",
      title: "Rent & Lifestyle",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/rent.hbs`,
      width: 600,
      height: "auto",
      resizable: true,
      closeOnSubmit: false,
      scrollY: [".window-content"],
    };
  }
  override getData() {
    const actors = accessibleCrewActors(),
      actor =
        actors.find((a) => a.id === this.actorId) ??
        actors.find((a) => a.id === game.user?.character?.id) ??
        actors[0];
    this.actorId = actor?.id;
    const config = rentConfig(),
      data = characterRent(actor?.id ?? "");
    const hqs = getHeadquarters(false).headquarters;
    const choice =
      this.draft && this.draft.actorId === actor?.id
        ? this.draft.choice
        : data.choice;
    return {
      hasActor: !!actor,
      isGM: !!game.user?.isGM,
      busy: this.busy,
      multipleActors: actors.length > 1,
      actors: actors.map((a) => ({
        id: a.id,
        name: a.name,
        selected: a.id === actor?.id,
      })),
      choiceIncrease: previewChoiceChange(data, choice).amount,
      vehicleResidence: choice.residence === "vehicle",
      vehicleHasBed: choice.vehicleHasBed === true,
      housingReminder: housingReminder(choice),
      ready: config.housing.length > 0 && config.lifestyles.length > 0,
      residences: config.housing.map((r) => ({
        id: r.id,
        name: r.name + " · " + r.cost.toLocaleString("en-US") + " eb",
        selected: r.id === choice.residence,
      })),
      hqResidences: hqs.map((hq) => ({
        id: "hq:" + hq.actorId,
        name: "[HQ] " + hq.name + " — shared rent",
        selected: "hq:" + hq.actorId === choice.residence,
      })),
      modifiers: rentModifiers().map((value) => ({
        value,
        label: modifierLabel(value),
        selected: value === choice.modifier,
      })),
      lifestyles: config.lifestyles.map((r) => ({
        ...r,
        selected: r.id === choice.lifestyle,
      })),
      bills: [
        ...(data.due ?? []).map((due) => previewRentBill(data, due, choice)),
        ...data.bills.filter(
          (b) =>
            b.period === config.periods.at(-1)?.id &&
            !(data.due ?? []).some((d) => d.period === b.period),
        ),
      ]
        .reverse()
        .map((bill) => ({
          date: displayDate(bill.date),
          period: bill.period,
          hq: !!bill.hqId || choice.residence.startsWith("hq:"),
          rent: bill.rent && {
            ...bill.rent,
            paymentAmount:
              bill.rent.amount + previewChoiceChange(data, choice).amount,
            formula: rentFormula(bill.rent),
          },
          lifestyle: bill.lifestyle && {
            ...bill.lifestyle,
            paymentAmount:
              bill.lifestyle.amount + previewChoiceChange(data, choice).amount,
            formula: rentFormula(bill.lifestyle),
          },
        })),
      pending: data.contributions.filter((c) => c.status === "pending"),
      interrupted: !!data.attempt,
      headquarters: hqs.map((hq) => {
        const actor = game.actors.get(hq.actorId),
          state = actor && hqRent(actor);
        return {
          id: hq.actorId,
          isGM: !!game.user?.isGM,
          name: hq.name,
          rates: config.housing.map((r) => ({
            ...r,
            selected: r.id === state?.typeId,
          })),
          modifiers: rentModifiers().map((value) => ({
            value,
            label: modifierLabel(value),
            selected: value === (state?.modifier ?? 0),
          })),
          bills: (state?.bills ?? [])
            .filter((b) => b.paid < b.charge.amount)
            .map((b) => ({
              period: b.period,
              hqId: hq.actorId,
              date: displayDate(b.date),
              formula: rentFormula(b.charge),
              paid: b.paid,
              remaining: b.charge.amount - b.paid,
            })),
        };
      }),
    };
  }
  override activateListeners(html: FoundryHtml) {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    const field = (name: string) =>
      root.querySelector<HTMLInputElement | HTMLSelectElement>(
        '[name="' + name + '"]',
      )?.value ?? "";
    const selectedChoice = (): RentChoice => ({
      residence: field("residence"),
      modifier: Number(field("modifier")),
      lifestyle: field("lifestyle"),
      vehicleHasBed:
        root.querySelector<HTMLInputElement>("[name=vehicleHasBed]")
          ?.checked === true,
    });
    root
      .querySelectorAll(
        "[name=residence], [name=modifier], [name=lifestyle], [name=vehicleHasBed]",
      )
      .forEach((input) =>
        input.addEventListener("change", () => {
          if (this.actorId)
            this.draft = { actorId: this.actorId, choice: selectedChoice() };
          this.render(false);
        }),
      );
    root.querySelector('[name="rentActor"]')?.addEventListener("change", () => {
      this.actorId = field("rentActor");
      this.render(false);
    });
    root
      .querySelectorAll<HTMLButtonElement>("[data-rent-action]")
      .forEach((button) => {
        button.disabled ||= this.busy;
        button.addEventListener("click", () => {
          if (
            this.busy ||
            (!this.actorId && button.dataset.rentAction !== "hqSetup")
          )
            return;
          this.busy = true;
          root
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((b) => (b.disabled = true));
          void (async () => {
            const action = button.dataset.rentAction;
            if (action === "clearMarker")
              await clearRentPaymentMarker(this.actorId!);
            if (action === "residence")
              await saveResidence(this.actorId!, selectedChoice());
            if (action === "rent" || action === "lifestyle")
              await payPersonalRent(
                this.actorId!,
                button.dataset.period!,
                action,
                selectedChoice(),
              );
            if (action === "contribute")
              await contributeRent(
                this.actorId!,
                button.dataset.hq!,
                button.dataset.period!,
                Number(
                  button
                    .closest(".rent-charge")
                    ?.querySelector<HTMLInputElement>("input")?.value,
                ),
              );
            if (action === "hqSetup") {
              const row = button.closest("[data-hq-rent]")!;
              await setHqRent(
                button.dataset.hq!,
                row.querySelector<HTMLSelectElement>("[data-hq-type]")!.value,
                Number(
                  row.querySelector<HTMLSelectElement>("[data-hq-modifier]")!
                    .value,
                ),
              );
            }
          })()
            .catch(report)
            .finally(() => {
              this.busy = false;
              this.render(false);
              void reconcileRent().catch(report);
            });
        });
      });
  }
  protected override async _updateObject() {}
}
class RentSettings extends CrewToolsForm {
  private housing?: RentRate[];
  private lifestyles?: RentRate[];
  private modifiers?: string;
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: MODULE_ID + "-rent-settings",
      title: "Rent & Lifestyle Settings",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/rent-settings.hbs`,
      width: 560,
      height: "auto",
      closeOnSubmit: false,
    };
  }
  override getData() {
    if (!game.user?.isGM)
      throw new Error("Only a GM can manage rent settings.");
    const config = rentConfig();
    this.housing ??= config.housing;
    this.lifestyles ??= config.lifestyles;
    this.modifiers ??= rentModifiers().join(", ");
    return {
      housing: this.housing,
      lifestyles: this.lifestyles,
      modifiers: this.modifiers,
    };
  }
  override activateListeners(html: FoundryHtml) {
    super.activateListeners(html);
    const root = html[0];
    if (!root) return;
    const capture = () => {
      for (const kind of ["housing", "lifestyles"] as const)
        this[kind] = Array.from(
          root.querySelectorAll<HTMLElement>('[data-rate-kind="' + kind + '"]'),
          (row) => ({
            id: row.dataset.rateId!,
            name: row
              .querySelector<HTMLInputElement>("[data-rate-name]")!
              .value.trim(),
            cost: Number(
              row.querySelector<HTMLInputElement>("[data-rate-cost]")!.value,
            ),
          }),
        );
      this.modifiers =
        root.querySelector<HTMLInputElement>('[name="modifiers"]')!.value;
    };
    root
      .querySelectorAll<HTMLButtonElement>("[data-add-rate]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          capture();
          this[button.dataset.addRate as "housing" | "lifestyles"]!.push({
            id: createUniqueId(),
            name: "",
            cost: 0,
          });
          this.render(false);
        }),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-remove-rate]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          button.closest("[data-rate-kind]")?.remove();
          capture();
        }),
      );
    root
      .querySelector<HTMLButtonElement>("[data-save-rent-settings]")
      ?.addEventListener("click", (event) => {
        capture();
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        void (async () => {
          const modifiers = parseRentModifiers(this.modifiers!);
          await saveRentRates(this.housing!, this.lifestyles!);
          await game.settings.set(
            MODULE_ID,
            RENT_MODIFIERS_SETTING,
            modifiers.join(", "),
          );
          ui.notifications.info("Rent settings saved.");
        })()
          .catch(report)
          .finally(() => {
            button.disabled = false;
          });
      });
  }
  protected override async _updateObject() {}
}
export function registerRentSettings() {
  game.settings.register(MODULE_ID, RENT_MODIFIERS_SETTING, {
    name: "Rent percentage modifiers",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_RENT_MODIFIERS.join(", "),
  });
  game.settings.registerMenu(MODULE_ID, "rentSettings", {
    name: "Rent & Lifestyle",
    label: "Manage Rates & Modifiers",
    hint: "Set monthly housing and lifestyle rates and customize rent percentage choices.",
    icon: "fas fa-house",
    type: RentSettings,
    restricted: true,
  });
  const refresh = coalesceRefresh(() => {
    if (rentWindow?.rendered) rentWindow.render(false, { focus: false });
  });
  const refreshPage = (page: FoundryJournalPage) => {
    const key = page.getFlag?.(MODULE_ID, "recordKey");
    if (
      key === "rentConfig" ||
      key === "hq" ||
      (key === "rent" &&
        page.parent?.getFlag?.(MODULE_ID, "actorId") === rentWindow?.actorId)
    )
      refresh();
  };
  Hooks.on("updateJournalEntryPage", refreshPage);
  Hooks.on("createJournalEntryPage", refreshPage);
  Hooks.on("updateSetting", (setting?: { key?: string }) => {
    if (setting?.key === MODULE_ID + "." + RENT_MODIFIERS_SETTING) refresh();
  });
  Hooks.on("updateActor", (actor, changes) => {
    const keys = Object.keys(changes);
    if (
      keys.some((key) => /^(name|ownership|type)(\.|$)/.test(key)) ||
      (getHeadquarters(false).headquarters.some(
        (h) => h.actorId === actor.id,
      ) &&
        keys.some(
          (key) => key === "flags" || key.startsWith("flags." + MODULE_ID),
        ))
    )
      refresh();
  });
}
