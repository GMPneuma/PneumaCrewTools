import { displayDate } from "./date-format";

export const recordEscape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// Native HTML tables remain readable with the module disabled.
export function journalTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return "<p>None.</p>";
  return (
    "<table><thead><tr>" +
    headers.map((h) => "<th>" + recordEscape(h) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          row.map((cell) => "<td>" + cell + "</td>").join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}

export function storedDetails(
  _data: unknown,
  explanation = "Structured fields are stored on this Journal page. IDs link records; names are labels. Editing this text does not change resources.",
): string {
  return (
    "<details><summary>About this page</summary><p>" +
    recordEscape(explanation) +
    "</p></details>"
  );
}

// Full technical fields are available on demand instead of filling the main page.
export function readableRecord(value: unknown): string {
  if (Array.isArray(value))
    return value.length
      ? value
          .map(
            (v, i) =>
              "<details><summary>Record " +
              (i + 1) +
              "</summary>" +
              readableRecord(v) +
              "</details>",
          )
          .join("")
      : "None";
  if (value && typeof value === "object")
    return journalTable(
      ["Field", "Value"],
      Object.entries(value).map(([key, v]) => [
        recordEscape(key.replace(/([a-z])([A-Z])/g, "$1 $2")),
        key === "actorId" && typeof v === "string"
          ? "@UUID[Actor." +
            recordEscape(v) +
            "]{" +
            recordEscape(game.actors.get(v)?.name ?? v) +
            "}"
          : v && typeof v === "object"
            ? "<details><summary>View</summary>" +
              readableRecord(v) +
              "</details>"
            : readableRecord(v),
      ]),
    );
  return recordEscape(value === null ? "Not recorded" : displayDate(value));
}
