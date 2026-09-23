import { MODULE_ID } from "./constants";
import { getHeadquarters } from "./headquarters";
import { improvementLevel, moraleBenefits } from "./hq-benefits";
import { recordEscape as esc } from "./journal-format";
export function openMoraleBoost(): void {
  const entries = getHeadquarters(false).headquarters.filter(
    (h) => improvementLevel(h, "moraleBoost") > 0,
  );
  if (!entries.length) return;
  new Dialog(
    {
      title: "Morale Boost",
      content: entries
        .map(
          (h) =>
            "<h2>" +
            esc(h.name) +
            "</h2><ul>" +
            moraleBenefits(improvementLevel(h, "moraleBoost"))
              .map(
                (b) =>
                  "<li>" +
                  esc(b.text) +
                  " <small>(" +
                  (b.automated ? "Applied by Crew Tools" : "Reference only") +
                  ")</small></li>",
              )
              .join("") +
            "</ul>",
        )
        .join(""),
      buttons: { close: { label: "Close" } },
    },
    { classes: [MODULE_ID], width: 560, height: "auto", resizable: true },
  ).render(true);
}
