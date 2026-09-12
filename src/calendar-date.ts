/** Date-only Gregorian adapter. Native components count months/days from zero. */
export interface CalendarComponents {
  year: number;
  month: number;
  dayOfMonth: number;
}
export interface NativeCalendar {
  years: { yearZero?: number };
  timeToComponents(time: number): CalendarComponents;
  componentsToTime(components: { year: number; day: number }): number;
}
export const DAY_SECONDS = 86400;

export function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Enter a date as YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Enter a valid calendar date.");
  if (date.getUTCFullYear() < 1)
    throw new Error("The year must be between 0001 and 9999.");
  return date;
}

export function shiftDate(value: string, days: number): string {
  if (!Number.isSafeInteger(days))
    throw new Error("Enter a whole number of days.");
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  parseDate(result);
  return result;
}

export function shimDate(time: number): string {
  const value = new Date(time * 1000).toISOString().slice(0, 10);
  parseDate(value);
  return value;
}
export function nativeDate(calendar: NativeCalendar, time: number): string {
  const parts = calendar.timeToComponents(time);
  const year = parts.year + (calendar.years.yearZero ?? 0);
  const result = `${String(year).padStart(4, "0")}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.dayOfMonth + 1).padStart(2, "0")}`;
  parseDate(result);
  return result;
}

export function nativeTime(calendar: NativeCalendar, value: string): number {
  const date = parseDate(value);
  const start = parseDate(`${value.slice(0, 4)}-01-01`);
  const result = calendar.componentsToTime({
    year: date.getUTCFullYear() - (calendar.years.yearZero ?? 0),
    day: (date.getTime() - start.getTime()) / (DAY_SECONDS * 1000),
  });
  if (!Number.isFinite(result) || nativeDate(calendar, result) !== value)
    throw new Error(
      "The native calendar does not match this Gregorian date. Check the world's calendar configuration.",
    );
  return result;
}
