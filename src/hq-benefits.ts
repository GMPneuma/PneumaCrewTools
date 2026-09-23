import type { HeadquartersRecord, HeadquartersState } from "./headquarters";
import type { RentRate } from "./rent-model";
export function improvementLevel(
  hq: Pick<HeadquartersRecord, "improvements">,
  id: string,
): number {
  const normalized = id.toLowerCase();
  return Math.max(
    0,
    ...hq.improvements
      .filter(
        (i) =>
          i.catalogId === id ||
          (!i.catalogId &&
            i.name.toLowerCase().replace(/[^a-z]/g, "") === normalized),
      )
      .map((i) => i.level ?? 1),
  );
}
export function crewImprovementLevel(
  state: HeadquartersState,
  id: string,
): number {
  return Math.max(0, ...state.headquarters.map((h) => improvementLevel(h, id)));
}
export function moraleBenefits(
  level: number,
): { text: string; automated: boolean }[] {
  if (level < 1) return [];
  const benefits = [
    { text: "Monthly Lifestyle costs are reduced by 50 eb.", automated: false },
  ];
  if (level >= 2)
    benefits.push({
      text:
        level >= 10
          ? "Once per month, regain Humanity equal to the higher of two d6 rolls, up to maximum."
          : level >= 5
            ? "Once per month, regain 1d6 Humanity, up to maximum."
            : "Once per month, regain 1d6 / 2 Humanity, up to maximum.",
      automated: false,
    });
  if (level >= 3)
    benefits.push({
      text: "Natural healing uses BODY +1. Stacks with Medbay.",
      automated: true,
    });
  if (level >= 4)
    benefits.push({
      text:
        "Increase LUCK by " +
        (level >= 8 ? "2" : "1") +
        ". Includes Exec Improved Team Members.",
      automated: false,
    });
  if (level >= 6)
    benefits.push({
      text: "Fixers gain +2 Trading when negotiating pay per person per job. Other crew members may haggle for 20% more pay as an Operator 5 Fixer, without the Trading bonus.",
      automated: false,
    });
  if (level >= 7)
    benefits.push({
      text:
        level >= 9
          ? "Hustle: roll twice and receive both incomes for one week."
          : "Hustle: roll twice and keep the better-paying result for one week.",
      automated: true,
    });
  if (level >= 11)
    benefits.push({
      text: "A unique benefit chosen with the GM.",
      automated: false,
    });
  return benefits;
}
export function reducedHqRate(
  rate: RentRate,
  rates: RentRate[],
  hq: Pick<HeadquartersRecord, "improvements">,
): RentRate {
  if (rate.cost <= 0 || improvementLevel(hq, "rentReduction") < 1) return rate;
  if (rate.id === "cubeHotel")
    return { ...rate, cost: 100, name: rate.name + " (Rent Reduction)" };
  const index = rates.findIndex((r) => r.id === rate.id);
  const lower = rates
    .slice(0, index)
    .filter((r) => r.cost > 0 && r.cost < rate.cost)
    .at(-1);
  return lower
    ? { ...rate, cost: lower.cost, name: rate.name + " (Rent Reduction)" }
    : rate;
}
