// Display dates without timezone conversion; ISO remains the storage/API format.
export function displayDate(value: unknown): string {
  return String(value ?? "")
    .replace(
      /^(\d{4})-(\d{2})-(\d{2})(?=$|T|\s)/,
      (_match, year, month, day) => `${Number(month)}-${Number(day)}-${year}`,
    )
    .replace(
      /^(\d{1,2})-(\d{1,2})-(\d{4})(?=$|T|\s)/,
      (_match, month, day, year) => `${Number(month)}-${Number(day)}-${year}`,
    );
}
export function storageDate(value: string): string {
  return value
    .trim()
    .replace(
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
      (_match, month, day, year) =>
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    );
}
