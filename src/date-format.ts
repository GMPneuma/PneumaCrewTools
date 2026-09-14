// Display dates without timezone conversion; ISO remains the storage/API format.
export function displayDate(value: unknown): string {
  return String(value ?? "").replace(
    /^(\d{4})-(\d{2})-(\d{2})(?=$|T|\s)/,
    "$2-$3-$1",
  );
}
export function storageDate(value: string): string {
  return value.trim().replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$1-$2");
}
