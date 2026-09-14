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
  return game.time.calendar
    ? nativeDate(game.time.calendar, game.time.worldTime)
    : shimDate(game.time.worldTime);
}
export function setCampaignDate(value: string): Promise<void> {
  return serial(async () => {
    requireGM();
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
    const current = getCampaignDate();
    const selected = parseDate(current || "2045-01-01");
    return {
      currentDate: `${String(selected.getUTCMonth() + 1).padStart(2, "0")}-${String(selected.getUTCDate()).padStart(2, "0")}-${selected.getUTCFullYear()}`,
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
      readOnly: !primaryGM(),
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
function renderCalendar(): void {
  if (!ready) return;
  let root = document.getElementById("pneuma-crewtools-calendar");
  if (!root) {
    root = document.createElement("div");
    root.id = "pneuma-crewtools-calendar";
    root.className = "pneuma-calendar";
    root.setAttribute("aria-label", "Crew Tools HUD");
    const logo = document.getElementById("logo");
    if (logo) {
      root.classList.add("pneuma-calendar--logo-slot");
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
export function registerCampaignCalendar(): void {
  Hooks.on("updateWorldTime", () => renderCalendar());
}
export function readyCampaignCalendar(): void {
  ready = true;
  renderCalendar();
}
