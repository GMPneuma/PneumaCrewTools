import type { HeadquartersState } from "./headquarters";

export const MULTIPLY_ANTIBIOTIC_SETTING = "multiplyAntibioticBonus";
export interface HealingOptions {
  medbay: boolean;
  antibiotic: boolean;
  cryotank: boolean;
}
export interface HealingResult extends HealingOptions {
  armorRepairs?: NaturalArmorRepair[];
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
interface NaturalArmorRepair {
  itemId: string;
  name: string;
  location: "headLocation" | "bodyLocation";
  before: number;
  after: number;
}
function naturalArmorName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (["fleshweave", "fleshweave (armor)"].includes(normalized))
    return "sycust fleshweave";
  return normalized;
}
function naturalArmorMode(name: string): "daily" | "full" | undefined {
  const normalized = naturalArmorName(name);
  if (normalized === "sycust fleshweave") return "full";
  if (
    ["skin weave", "subdermal armor", "heavy subdermal plating"].includes(
      normalized,
    )
  )
    return "daily";
  return undefined;
}
function naturalArmorRepairs(
  actor: FoundryActor,
  days: number,
): NaturalArmorRepair[] {
  const repairs: NaturalArmorRepair[] = [];
  const items = Array.from(actor.items ?? []);
  const installed = new Set(
    items
      .filter(
        (item) =>
          item.type === "cyberware" &&
          (item.system as { isInstalled?: boolean }).isInstalled === true,
      )
      .map((item) => naturalArmorName(item.name)),
  );
  // Cyberware establishes eligibility; its separate armor Item owns SP/ablation.
  for (const item of items) {
    const mode = naturalArmorMode(item.name);
    const data = item.system as {
      headLocation?: { ablation?: number };
      bodyLocation?: { ablation?: number };
    };
    if (
      item.type !== "armor" ||
      !installed.has(naturalArmorName(item.name)) ||
      !mode
    )
      continue;
    for (const location of ["headLocation", "bodyLocation"] as const) {
      const before = data[location]?.ablation;
      if (before === undefined) continue;
      if (!Number.isSafeInteger(before) || before < 0)
        throw new Error("Invalid armor ablation for " + item.name + ".");
      repairs.push({
        itemId: item.id,
        name: item.name,
        location,
        before,
        after: mode === "full" ? 0 : Math.max(0, before - days),
      });
    }
  }
  return repairs;
}
export function hasHealingBenefit(result: HealingResult): boolean {
  return (
    result.restored > 0 ||
    (result.armorRepairs ?? []).some((r) => r.before > r.after)
  );
}
export function armorHealingNote(result: HealingResult): string {
  const names = [...new Set((result.armorRepairs ?? []).map((r) => r.name))];
  return names
    .map(
      (name) =>
        name +
        (naturalArmorMode(name) === "full"
          ? ": Rest restores body and head armor to full SP."
          : ": Rest restores 1 lost SP to both body and head per day."),
    )
    .join(" ");
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
    armorRepairs: naturalArmorRepairs(actor, days),
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
  const armor = (result.armorRepairs ?? [])
    .filter((r) => r.before > r.after)
    .map(
      (r) =>
        `${r.name} (${r.location === "headLocation" ? "head" : "body"}): restored ${r.before - r.after} SP; ablation ${r.before} → ${r.after}.`,
    );
  return (
    `Healed ${result.restored} HP (${result.before} → ${result.after}/${result.maximum}); ${result.rate} HP/day. BODY ${result.body}; medbay ${result.medbay ? "+2 BODY" : "no"}; Enhanced Antibodies ${result.enhancedAntibodies ? "×2" : "no"}; antibiotics ${result.antibiotic ? "+2 HP" : "no"} (${result.multiplyAntibiotic ? "multiplied" : "added last"}); cryotank ${result.cryotank ? "×2" : "no"}.` +
    (armor.length ? " " + armor.join(" ") : "")
  );
}

export function validateHealingResult(
  result: HealingResult,
  days: number,
): void {
  if (!result || typeof result !== "object")
    throw new Error("Invalid healing record.");
  if (result.armorRepairs !== undefined) {
    if (!Array.isArray(result.armorRepairs))
      throw new Error("Invalid healing armor record.");
    const seen = new Set<string>();
    for (const repair of result.armorRepairs) {
      if (
        !repair ||
        typeof repair.itemId !== "string" ||
        !repair.itemId ||
        typeof repair.name !== "string" ||
        !naturalArmorMode(repair.name) ||
        !["headLocation", "bodyLocation"].includes(repair.location) ||
        !Number.isSafeInteger(repair.before) ||
        repair.before < 0 ||
        !Number.isSafeInteger(repair.after) ||
        repair.after !==
          (naturalArmorMode(repair.name) === "full"
            ? 0
            : Math.max(0, repair.before - days)) ||
        seen.has(repair.itemId + ":" + repair.location)
      )
        throw new Error("Invalid healing armor record.");
      seen.add(repair.itemId + ":" + repair.location);
    }
  }
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
    result.before > result.maximum ||
    result.rate !== rate ||
    result.after !== Math.min(result.maximum, result.before + rate * days) ||
    result.restored !== result.after - result.before ||
    result.restored < 0 ||
    !hasHealingBenefit(result) ||
    (result.medbay && (!result.medbayHqId || !result.medbayImprovementId))
  )
    throw new Error("Invalid healing record calculation.");
}
