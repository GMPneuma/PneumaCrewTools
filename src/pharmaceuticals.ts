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
  return (
    item.type === "drug" &&
    PHARMACEUTICALS.some(
      (name) => name.toLowerCase() === item.name.trim().toLowerCase(),
    )
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
