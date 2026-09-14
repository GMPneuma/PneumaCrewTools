import type { HeadquartersState } from "./headquarters";

export const MULTIPLY_ANTIBIOTIC_SETTING = "multiplyAntibioticBonus";
export interface HealingOptions {
  medbay: boolean;
  antibiotic: boolean;
  cryotank: boolean;
}
export interface HealingResult extends HealingOptions {
  body: number;
  enhancedAntibodies: boolean;
  multiplyAntibiotic: boolean;
  rate: number;
  before: number;
  after: number;
  maximum: number;
  restored: number;
  medbayHqId?: string;
  medbayImprovementId?: string;
}
export const defaultHealingOptions = (): HealingOptions => ({
  medbay: false,
  antibiotic: false,
  cryotank: false,
});

// Explicit effects survive renaming; named improvements also work without an explicit effect.
export function findMedbay(state: HeadquartersState) {
  for (const hq of state.headquarters) {
    const improvement = hq.improvements.find(
      (i) =>
        i.effect === "medbay" ||
        (i.effect === undefined &&
          i.name
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "") === "medbay"),
    );
    if (improvement)
      return { hqId: hq.id, improvementId: improvement.id, name: hq.name };
  }
  return undefined;
}
export function healingPreview(
  actor: FoundryActor,
  options: HealingOptions,
  hqs: HeadquartersState,
  multiplyAntibiotic: boolean,
  days = 1,
): HealingResult {
  for (const key of ["medbay", "antibiotic", "cryotank"] as const)
    if (typeof options[key] !== "boolean")
      throw new Error("Invalid healing option.");
  if (!Number.isSafeInteger(days) || days < 1)
    throw new Error("Choose whole rest days.");
  const system = actor.system as {
    stats?: { body?: { value?: number; total?: number } };
    derivedStats?: { hp?: { value?: number; max?: number; total?: number } };
  };
  const body = system.stats?.body?.total ?? system.stats?.body?.value;
  const before = system.derivedStats?.hp?.value;
  const maximum =
    system.derivedStats?.hp?.total ?? system.derivedStats?.hp?.max;
  if (
    typeof body !== "number" ||
    !Number.isSafeInteger(body) ||
    body < 1 ||
    typeof before !== "number" ||
    !Number.isSafeInteger(before) ||
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    before > maximum
  )
    throw new Error("Character BODY or HP is unavailable or invalid.");
  const medbay = findMedbay(hqs);
  if (options.medbay && !medbay)
    throw new Error("No headquarters has a Medbay improvement.");
  // CPR exposes installed status as a getter; inventory cyberware alone does not qualify.
  const enhancedAntibodies = Array.from(actor.items ?? []).some((item) => {
    const data = item.system as { isInstalled?: boolean };
    return (
      item.type === "cyberware" &&
      item.name.trim().toLowerCase() === "enhanced antibodies" &&
      data.isInstalled === true
    );
  });
  const bonus = options.antibiotic ? 2 : 0;
  const rate =
    (body + (options.medbay ? 2 : 0) + (multiplyAntibiotic ? bonus : 0)) *
      (enhancedAntibodies ? 2 : 1) *
      (options.cryotank ? 2 : 1) +
    (multiplyAntibiotic ? 0 : bonus);
  const after = Math.min(maximum, before + rate * days);
  if (!Number.isSafeInteger(rate * days) || !Number.isSafeInteger(after))
    throw new Error("Healing amount is too large.");
  return {
    ...options,
    body,
    enhancedAntibodies,
    multiplyAntibiotic,
    rate,
    before,
    after,
    maximum,
    restored: after - before,
    ...(options.medbay && medbay
      ? { medbayHqId: medbay.hqId, medbayImprovementId: medbay.improvementId }
      : {}),
  };
}
export function healingSummary(result: HealingResult): string {
  return `Healed ${result.restored} HP (${result.before} → ${result.after}/${result.maximum}); ${result.rate} HP/day. BODY ${result.body}; medbay ${result.medbay ? "+2 BODY" : "no"}; Enhanced Antibodies ${result.enhancedAntibodies ? "×2" : "no"}; antibiotics ${result.antibiotic ? "+2 HP" : "no"} (${result.multiplyAntibiotic ? "multiplied" : "added last"}); cryotank ${result.cryotank ? "×2" : "no"}.`;
}

export function validateHealingResult(
  result: HealingResult,
  days: number,
): void {
  if (!result || typeof result !== "object")
    throw new Error("Invalid healing record.");
  for (const key of [
    "medbay",
    "antibiotic",
    "cryotank",
    "enhancedAntibodies",
    "multiplyAntibiotic",
  ] as const)
    if (typeof result[key] !== "boolean")
      throw new Error("Invalid healing record options.");
  for (const key of [
    "body",
    "rate",
    "before",
    "after",
    "maximum",
    "restored",
  ] as const)
    if (!Number.isSafeInteger(result[key]))
      throw new Error("Invalid healing record amount.");
  const bonus = result.antibiotic ? 2 : 0;
  const rate =
    (result.body +
      (result.medbay ? 2 : 0) +
      (result.multiplyAntibiotic ? bonus : 0)) *
      (result.enhancedAntibodies ? 2 : 1) *
      (result.cryotank ? 2 : 1) +
    (result.multiplyAntibiotic ? 0 : bonus);
  if (
    result.body < 1 ||
    result.maximum < 1 ||
    result.before >= result.maximum ||
    result.rate !== rate ||
    result.after !== Math.min(result.maximum, result.before + rate * days) ||
    result.restored !== result.after - result.before ||
    result.restored < 1 ||
    (result.medbay && (!result.medbayHqId || !result.medbayImprovementId))
  )
    throw new Error("Invalid healing record calculation.");
}
