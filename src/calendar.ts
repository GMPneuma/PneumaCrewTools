import { isPrimaryGM as primaryGM } from "./action-coordinator";
import { CrewToolsForm } from "./foundry-form";
import { MODULE_ID } from "./constants";
import {
  DAY_SECONDS,
  nativeDate,
  nativeTime,
  parseDate,
  shiftDate,
  shimDate,
} from "./calendar-date";
let queue: Promise<unknown> = Promise.resolve();
let ready = false;
let calendarWindow: FormApplication | undefined;
export const SIMPLE_CALENDAR_SETTING = "useSimpleCalendar";
let switchingCalendar = false;
let confirmedSwitch = false;
export function usesSimpleCalendar(): boolean {
  return game.settings.get(MODULE_ID, SIMPLE_CALENDAR_SETTING) === true;
}
function simpleCalendarDate(): string {
  const api = (
    globalThis as typeof globalThis & {
      SimpleCalendar?: {
        api?: {
          currentDateTime(): {
            year: number;
            month: number;
            day: number;
          } | null;
        };
      };
    }
  ).SimpleCalendar?.api;
  if (
    !game.modules?.get("foundryvtt-simple-calendar")?.active ||
    !api?.currentDateTime
  )
    throw new Error(
      "Simple Calendar is unavailable. Enable it or turn off Use Simple Calendar in Crew Tools settings and set a new date.",
    );
  const parts = api.currentDateTime();
  if (
    !parts ||
    ![parts.year, parts.month, parts.day].every(Number.isSafeInteger)
  )
    throw new Error("Waiting for Simple Calendar to provide a date.");
  const value = `${String(parts.year).padStart(4, "0")}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day + 1).padStart(2, "0")}`;
  parseDate(value);
  return value;
}
export function calendarStatus(): string {
  if (!usesSimpleCalendar()) return "Using Crew Tools calendar.";
  try {
    return (
      "Using Simple Calendar: " +
      simpleCalendarDate() +
      ". Change dates in Simple Calendar."
    );
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Simple Calendar unavailable.";
  }
}
function requireLocalCalendar(): void {
  if (usesSimpleCalendar() || switchingCalendar)
    throw new Error(
      "Change the campaign date in Simple Calendar, or turn off Use Simple Calendar in settings.",
    );
}
function refreshCalendarSource(): void {
  renderCalendar();
  if (calendarWindow?.rendered) calendarWindow.render(false);
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-crew-calendar-status]",
  ))
    element.textContent = calendarStatus();
}
// Called before the setting is written: cancel leaves the source and clock untouched.
function promptCalendarSwitch(): void {
  if (switchingCalendar) return;
  try {
    requireGM();
  } catch (error) {
    report(error);
    return;
  }
  switchingCalendar = true;
  let current = "";
  try {
    current = simpleCalendarDate();
  } catch {
    /* Require an explicit date if the module was removed. */
  }
  new Dialog({
    title: "Switch to Crew Tools Calendar",
    content: `<form><p>Set the campaign date Crew Tools should use.</p><div class="form-group"><label>New date</label><input type="date" name="campaignDate" min="0001-01-01" max="9999-12-31" value="${current}" required></div><p>This sets shared Foundry world time to midnight. Other time-based modules, including Simple Calendar if still active, may also respond.</p></form>`,
    buttons: {
      cancel: { label: "Cancel" },
      switch: {
        label: "Set Date and Switch",
        callback: (html) => {
          const value =
            html[0]?.querySelector<HTMLInputElement>('[name="campaignDate"]')
              ?.value ?? "";
          void serial(async () => {
            requireGM();
            parseDate(value);
            if (!usesSimpleCalendar()) return;
            const before = game.time.worldTime;
            try {
              await changeDate(value);
              confirmedSwitch = true;
              await game.settings.set(
                MODULE_ID,
                SIMPLE_CALENDAR_SETTING,
                false,
              );
            } catch (error) {
              if (game.time.worldTime !== before)
                await game.time.advance(before - game.time.worldTime);
              throw error;
            } finally {
              confirmedSwitch = false;
              refreshCalendarSource();
            }
          }).catch(report);
        },
      },
    },
    default: "cancel",
    close: () => {
      switchingCalendar = false;
    },
  }).render(true);
}
function requireGM(): void {
  if (!game.user?.isGM)
    throw new Error("Only a GM can change the campaign date.");
  if (!primaryGM())
    throw new Error(
      "The first active GM manages the calendar. Ask that GM to change the date.",
    );
}
function serial<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action);
  queue = next.catch(() => undefined);
  return next;
}
function report(error: unknown): void {
  console.error(`${MODULE_ID} | Calendar`, error);
  ui.notifications.error(
    error instanceof Error
      ? error.message
      : "The calendar could not be updated.",
  );
}
export function getCampaignDate(): string {
  if (usesSimpleCalendar()) return simpleCalendarDate();
  return game.time.calendar
    ? nativeDate(game.time.calendar, game.time.worldTime)
    : shimDate(game.time.worldTime);
}
export function setCampaignDate(value: string): Promise<void> {
  return serial(async () => {
    requireGM();
    requireLocalCalendar();
    parseDate(value);
    await changeDate(value);
  });
}
async function changeDate(value: string, remainder = 0): Promise<void> {
  const target =
    (game.time.calendar
      ? nativeTime(game.time.calendar, value)
      : parseDate(value).getTime() / 1000) + remainder;
  try {
    if (game.time.calendar && game.time.set) await game.time.set(target);
    else await game.time.advance(target - game.time.worldTime);
  } finally {
    renderCalendar();
  }
}
export function advanceCampaignDays(days: number): Promise<void> {
  if (!Number.isSafeInteger(days) || days < 1)
    return Promise.reject(new Error("Enter a positive whole number of days."));
  return serial(async () => {
    requireGM();
    requireLocalCalendar();
    const remainder =
      ((game.time.worldTime % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
    await changeDate(shiftDate(getCampaignDate(), days), remainder);
  });
}
export class CampaignCalendarForm extends CrewToolsForm {
  #busy = false;
  async #perform(action: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await action();
      this.render(true);
    } catch (error) {
      report(error);
    } finally {
      this.#busy = false;
    }
  }
  static override get defaultOptions(): ApplicationOptions {
    return {
      ...super.defaultOptions,
      id: "pneuma-crewtools-calendar-form",
      title: "Modify GameTime Date",
      classes: [MODULE_ID],
      template: `modules/${MODULE_ID}/templates/calendar.hbs`,
      width: 420,
      height: "auto",
      closeOnSubmit: false,
    };
  }
  override getData(): object {
    let current = "";
    try {
      current = getCampaignDate();
    } catch {
      /* Show source status instead of a false fallback date. */
    }
    const selected = parseDate(current || "2045-01-01");
    return {
      currentDate: current
        ? `${selected.getUTCMonth() + 1}-${selected.getUTCDate()}-${selected.getUTCFullYear()}`
        : "Unavailable",
      calendarStatus: calendarStatus(),
      year: selected.getUTCFullYear(),
      day: selected.getUTCDate(),
      months: [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ].map((name, index) => ({
        value: index + 1,
        name,
        selected: index === selected.getUTCMonth(),
      })),
      initialized: Boolean(current),
      canEdit: primaryGM(),
      readOnly: !primaryGM() || usesSimpleCalendar(),
    };
  }
  override activateListeners(html: FoundryHtml): void {
    super.activateListeners(html);
    html[0]
      ?.querySelector("[data-calendar-advance]")
      ?.addEventListener("click", () => {
        const days = Number(
          html[0]?.querySelector<HTMLInputElement>('[name="days"]')?.value,
        );
        void this.#perform(() => advanceCampaignDays(days));
      });
  }
  protected override async _updateObject(
    _event: Event,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.#perform(async () => {
      const year = Number(data.year);
      const month = Number(data.month);
      const day = Number(data.day);
      if (
        !Number.isInteger(year) ||
        year < 1 ||
        year > 9999 ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12 ||
        !Number.isInteger(day) ||
        day < 1 ||
        day > 31
      )
        throw new Error("Enter a valid year, month, and day.");
      await setCampaignDate(
        `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    });
  }
}
export function openCampaignCalendar(): void {
  if (!game.user?.isGM) return;
  try {
    calendarWindow ??= new CampaignCalendarForm();
    calendarWindow.render(true);
  } catch (error) {
    report(error);
  }
}
// Retain the native node, including handlers and attributes, for exact restoration.
let displacedLogo: HTMLElement | null = null;
export const HIDE_HUD_SETTING = "hideCrewHud";
function hudHidden(): boolean {
  try {
    return game.settings.get(MODULE_ID, HIDE_HUD_SETTING) === true;
  } catch {
    return false;
  }
}
function renderCalendar(): void {
  if (!ready) return;
  let root = document.getElementById("pneuma-crewtools-calendar");
  if (hudHidden()) {
    if (root) {
      if (displacedLogo && !document.getElementById("logo"))
        root.replaceWith(displacedLogo);
      else root.remove();
    }
    displacedLogo = null;
    return;
  }
  if (!root) {
    root = document.createElement("div");
    root.id = "pneuma-crewtools-calendar";
    root.className = "pneuma-calendar";
    root.setAttribute("aria-label", "Crew Tools HUD");
    const logo = document.getElementById("logo");
    if (logo) {
      root.classList.add("pneuma-calendar--logo-slot");
      displacedLogo = logo;
      logo.replaceWith(root);
    } else {
      document.body.append(root);
    }
  }
  let monthDay = "Calendar",
    year = "unavailable";
  try {
    const current = getCampaignDate();
    if (
      root.dataset.date === current &&
      root.querySelector(".pneuma-calendar-date")
    )
      return;
    root.dataset.date = current;
    const date = parseDate(current);
    monthDay = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    year = String(date.getUTCFullYear()).padStart(4, "0");
  } catch {
    /* Keep the HUD usable when the date cannot be read. */
    delete root.dataset.date;
  }
  let label = root.querySelector<HTMLSpanElement>(".pneuma-calendar-date");
  if (!label) {
    label = document.createElement("span");
    label.className = "pneuma-calendar-date";
    const dayLine = document.createElement("span"),
      yearLine = document.createElement("span");
    dayLine.className = "pneuma-calendar-month-day";
    yearLine.className = "pneuma-calendar-year";
    label.append(dayLine, yearLine);
    root.prepend(label);
  }
  label.querySelector(".pneuma-calendar-month-day")!.textContent = monthDay;
  label.querySelector(".pneuma-calendar-year")!.textContent = year;
  label.setAttribute("aria-label", monthDay + ", " + year);
}
export function registerCampaignCalendar(
  refreshHud: () => void = () => {},
): void {
  game.settings.register(MODULE_ID, SIMPLE_CALENDAR_SETTING, {
    name: "Use Simple Calendar",
    hint: "Use Simple Calendar's date and manage date changes there. Turning this off prompts for a new Crew Tools date.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshCalendarSource(),
  });
  Hooks.on("preUpdateSetting", (setting, changes) => {
    if (
      setting.key !== MODULE_ID + "." + SIMPLE_CALENDAR_SETTING ||
      confirmedSwitch
    )
      return;
    if (
      (changes.value === false || changes.value === "false") &&
      usesSimpleCalendar()
    ) {
      promptCalendarSwitch();
      return false;
    }
  });
  Hooks.on("renderSettingsConfig", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    const row = root
      ?.querySelector(
        '[name="' + MODULE_ID + "." + SIMPLE_CALENDAR_SETTING + '"]',
      )
      ?.closest(".form-group");
    if (!row) return;
    let status = row.querySelector<HTMLElement>("[data-crew-calendar-status]");
    if (!status) {
      status = document.createElement("p");
      status.className = "notes";
      status.dataset.crewCalendarStatus = "";
      status.setAttribute("role", "status");
      row.append(status);
    }
    status.textContent = calendarStatus();
  });
  Hooks.on("simple-calendar-date-time-change", () => {
    if (usesSimpleCalendar()) refreshCalendarSource();
  });
  Hooks.on("simple-calendar-ready", () => {
    if (usesSimpleCalendar()) refreshCalendarSource();
  });
  // Client preference applies immediately and never changes the campaign clock.
  game.settings.register(MODULE_ID, HIDE_HUD_SETTING, {
    name: "Hide Crew Tools HUD",
    hint: "Hide the entire calendar and Hub HUD on this device and restore the original Foundry logo. Token Controls shortcuts remain available according to your shortcut setting.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      renderCalendar();
      refreshHud();
    },
  });
  Hooks.on("updateWorldTime", () => renderCalendar());
}
export function readyCampaignCalendar(): void {
  ready = true;
  renderCalendar();
}
