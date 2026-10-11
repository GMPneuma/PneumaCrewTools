export const PHARMACEUTICALS = [
  "Antibiotic",
  "Rapiddetox",
  "Speedheal",
  "Stim",
  "Surge",
  "Radaway",
  "Sedative",
  "Veritas",
];

// The system uses drug Items for both street drugs and pharmaceuticals.
export function isPharmaceutical(item: FoundryItem): boolean {
  if (item.type !== "drug") return false;
  const name = item.name.trim().toLowerCase();
  // Preserve named variants and split stacks without accepting partial words.
  return (
    name.startsWith("pharma ") ||
    [...PHARMACEUTICALS, "Rapidetox"].some((base) => {
      const prefix = base.toLowerCase();
      return (
        name.startsWith(prefix) &&
        (name.length === prefix.length ||
          /^[\s\p{P}\p{S}]/u.test(name.slice(prefix.length)))
      );
    })
  );
}
export function pharmaceuticalInventory(actor: FoundryActor) {
  return Array.from(actor.items ?? [])
    .filter(isPharmaceutical)
    .map((item) => {
      const amount = (item.system as { amount?: number })?.amount;
      return {
        id: item.id,
        name: item.name,
        img: item.img,
        amount: Number.isSafeInteger(amount) && amount! > 0 ? amount! : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
