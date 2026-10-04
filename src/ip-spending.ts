import { numberAt, arrayAt } from "./system-resources";
import { withResourceLock } from "./resource-lock";

export interface IpUpgrade {
  id: string;
  name: string;
  kind: "skill" | "role";
  ability: string;
  from: number;
  to: number;
  rate: number;
  source?: Record<string, unknown>;
  blockedReason?: string;
  currentRank?: string;
}

export function upgradeCost(from: number, to: number, rate: number): number {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    (to > 10 && to !== from) ||
    ![20, 40, 60].includes(rate)
  )
    throw new Error("Invalid IP improvement.");
  return (rate * (to * (to + 1) - from * (from + 1))) / 2;
}

export function actorUpgrades(actor: FoundryActor): IpUpgrade[] {
  return Array.from(actor.items ?? [])
    .filter((i) => i.type === "skill" || i.type === "role")
    .map((i) => {
      const data = i.system as {
        level?: number;
        rank?: number;
        difficulty?: string;
        mainRoleAbility?: string;
      };
      const role = i.type === "role";
      const rawRank = role ? data.rank : data.level;
      const rank = Number(rawRank);
      const valid =
        rawRank !== null &&
        rawRank !== undefined &&
        String(rawRank).trim() !== "" &&
        Number.isSafeInteger(rank) &&
        rank >= 0;
      const from = valid ? rank : 0;
      return {
        id: i.id,
        name: i.name,
        kind: role ? ("role" as const) : ("skill" as const),
        ability: role ? (data.mainRoleAbility ?? "") : "",
        from,
        to: from,
        currentRank: valid ? String(rank) : "—",
        blockedReason: !valid
          ? "Invalid rank; correct this Item on the character sheet."
          : rank > 10
            ? "At or above the IP rank limit."
            : undefined,
        rate: role ? 60 : data.difficulty === "difficult" ? 40 : 20,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const spending = new Set<string>();
export async function applyIpUpgrades(
  actor: FoundryActor,
  drafts: IpUpgrade[],
  expectedIp: number,
): Promise<void> {
  return withResourceLock(() =>
    applyLockedIpUpgrades(actor, drafts, expectedIp),
  );
}
async function applyLockedIpUpgrades(
  actor: FoundryActor,
  drafts: IpUpgrade[],
  expectedIp: number,
): Promise<void> {
  if (spending.has(actor.id))
    throw new Error("An IP purchase is already processing for this character.");
  spending.add(actor.id);
  const created: string[] = [];
  try {
    if (!game.user || !actor.testUserPermission(game.user, "OWNER"))
      throw new Error("You must own this character to spend IP.");
    const ip = numberAt(actor.system, "improvementPoints.value");
    if (ip !== expectedIp)
      throw new Error("IP changed. Reopen Spend IP and review your purchase.");
    const current = actorUpgrades(actor);
    const selected = drafts.filter((d) => d.to !== d.from);
    if (!selected.length) throw new Error("Choose an improvement first.");
    if (new Set(selected.map((d) => d.id)).size !== selected.length)
      throw new Error("Duplicate improvement.");
    let total = 0;
    for (const d of selected) {
      const live = current.find((i) => i.id === d.id);
      if (d.source) {
        if (
          d.kind !== "role" ||
          d.from !== 0 ||
          d.rate !== 60 ||
          d.source.type !== "role" ||
          current.some(
            (i) =>
              i.kind === "role" &&
              i.name.toLowerCase() === d.name.toLowerCase(),
          )
        )
          throw new Error("This role cannot be added.");
        if (
          current.some(
            (i) =>
              i.kind === "role" &&
              (selected.find((s) => s.id === i.id)?.to ?? i.from) < 4,
          )
        )
          throw new Error(
            "Reach rank 4 in your current roles before adding another role.",
          );
      } else if (
        !live ||
        live.blockedReason ||
        live.from !== d.from ||
        live.rate !== d.rate ||
        live.kind !== d.kind ||
        live.name !== d.name
      )
        throw new Error("Character skills or roles changed. Reopen Spend IP.");
      total += upgradeCost(d.from, d.to, d.rate);
    }
    if (!Number.isSafeInteger(ip) || total > ip)
      throw new Error("Not enough IP.");
    if (selected.filter((d) => d.source).length > 1)
      throw new Error("Add one new role at a time.");
    for (const d of selected.filter((d) => d.source)) {
      const source = structuredClone(d.source!);
      delete source._id;
      const system = source.system as { abilities?: Record<string, unknown>[] };
      source.system = {
        ...system,
        rank: d.to,
        ...(system.abilities
          ? {
              abilities: system.abilities.map((a) => ({
                ...a,
                rank:
                  d.name.toLowerCase() === "fixer" &&
                  String(a.name).toLowerCase() === "haggle"
                    ? d.to
                    : 0,
              })),
            }
          : {}),
      };
      const docs = await actor.createEmbeddedDocuments("Item", [source]);
      created.push(...docs.map((i) => i.id));
      if (docs.length !== 1)
        throw new Error("The new role could not be created.");
    }
    // One Actor update persists existing embedded Item ranks, IP, and its native ledger together.
    if (numberAt(actor.system, "improvementPoints.value") !== ip)
      throw new Error("IP changed during role creation. Reopen Spend IP.");
    let remaining = ip;
    const transactions = structuredClone(
      arrayAt(actor.system, "improvementPoints.transactions"),
    );
    for (const d of selected) {
      const cost = upgradeCost(d.from, d.to, d.rate);
      remaining -= cost;
      transactions.push([
        `Decreased by ${cost} to ${remaining}`,
        `${d.name} ${d.from} -> ${d.to}`,
      ]);
    }
    await actor.update({
      items: selected
        .filter((d) => !d.source)
        .map((d) => ({
          _id: d.id,
          [d.kind === "skill" ? "system.level" : "system.rank"]: d.to,
        })),
      "system.improvementPoints.value": remaining,
      "system.improvementPoints.transactions": transactions,
    });
  } catch (error) {
    if (created.length) {
      try {
        await actor.deleteEmbeddedDocuments("Item", created);
      } catch {
        throw new Error(
          `${String(error)} New role cleanup failed; review the character before retrying.`,
        );
      }
    }
    throw error;
  } finally {
    spending.delete(actor.id);
  }
}
