// Monthly receipts retain their rate; between-bill upgrades charge only the increase.
export interface RentRate {
  id: string;
  name: string;
  cost: number;
}
export interface RentChoice {
  residence: string;
  modifier: number;
  lifestyle: string;
  vehicleHasBed?: boolean;
}
export interface RentCharge {
  name: string;
  base: number;
  modifier: number;
  amount: number;
  paid: boolean;
}
export interface RentBill {
  period: string;
  date: string;
  rent?: RentCharge;
  lifestyle?: RentCharge;
  hqId?: string;
}
export interface RentContribution {
  id: string;
  hqId: string;
  hqName: string;
  period: string;
  amount: number;
  date: string;
  status: "pending" | "confirmed";
  applied?: number;
  refunded?: number;
}
export interface CharacterRent {
  choice: RentChoice;
  due: { period: string; date: string }[];
  bills: RentBill[];
  contributions: RentContribution[];
  changes?: {
    date: string;
    rent: number;
    lifestyle: number;
    amount: number;
    description: string;
  }[];
  attempt?: { reason: string; before: number; after: number };
}
export interface HqRentBill {
  period: string;
  date: string;
  charge: RentCharge;
  paid: number;
  contributions: {
    id: string;
    actorId: string;
    actorName: string;
    amount: number;
    refund: number;
  }[];
}
export interface HqRent {
  typeId: string;
  modifier: number;
  bills: HqRentBill[];
}
export const DEFAULT_RENT_MODIFIERS = [-50, -25, -10, 0, 10, 25, 50, 100];
export function parseRentModifiers(text: string): number[] {
  const values = text.split(",").map((part) => part.trim().replace(/%$/, ""));
  if (
    !values.length ||
    values.some((value) => !/^[+-]?\d+(?:\.\d+)?$/.test(value))
  )
    throw new Error("Enter percentages separated by commas.");
  const numbers = values.map(Number);
  if (numbers.some((value) => !Number.isFinite(value) || value < -100))
    throw new Error(
      "Rent modifiers must be finite percentages of at least -100%.",
    );
  return [...new Set(numbers)].sort((a, b) => a - b);
}
export function rentCharge(rate: RentRate, modifier = 0): RentCharge {
  if (
    !Number.isSafeInteger(rate.cost) ||
    rate.cost < 0 ||
    !Number.isFinite(modifier) ||
    modifier < -100
  )
    throw new Error("Invalid rent price or modifier.");
  const amount = Math.round(rate.cost * (1 + modifier / 100));
  if (!Number.isSafeInteger(amount))
    throw new Error("Rent amount is too large.");
  return {
    name: rate.name,
    base: rate.cost,
    modifier,
    amount,
    paid: amount === 0,
  };
}
export function modifierLabel(value: number): string {
  return (value > 0 ? "+" : "") + value + "%";
}
export function billOutstanding(bill: RentBill): boolean {
  return (
    (!bill.rent && !bill.hqId) ||
    !bill.lifestyle ||
    (!!bill.rent && !bill.rent.paid) ||
    (!!bill.lifestyle && !bill.lifestyle.paid)
  );
}
export const emptyCharacterRent = (): CharacterRent => ({
  choice: { residence: "", modifier: 0, lifestyle: "" },
  due: [],
  bills: [],
  contributions: [],
});

export const DEFAULT_HOUSING: RentRate[] = [
  { id: "street", name: "Living on The Street", cost: 0 },
  { id: "vehicle", name: "Living on The Street in a Vehicle", cost: 0 },
  { id: "cubeHotel", name: "Cube Hotel", cost: 500 },
  { id: "cargoContainer", name: "Cargo Container", cost: 1000 },
  { id: "studio", name: "Studio Apartment", cost: 1500 },
  { id: "twoBedroom", name: "Two-Bedroom Apartment", cost: 2500 },
  {
    id: "corporateConapt",
    name: "Corporate Conapt",
    cost: 0,
  },
  { id: "upscaleConapt", name: "Upscale Conapt", cost: 7500 },
  { id: "penthouse", name: "Luxury Penthouse", cost: 15000 },
  {
    id: "beavervilleHouse",
    name: "Corporate Beaverville House",
    cost: 0,
  },
  {
    id: "beavervilleMansion",
    name: "Corporate Beaverville McMansion",
    cost: 0,
  },
];
export const DEFAULT_LIFESTYLES: RentRate[] = [
  { id: "kibble", name: "Kibble", cost: 100 },
  { id: "genericPrepak", name: "Generic Prepak", cost: 300 },
  { id: "goodPrepak", name: "Good Prepak", cost: 600 },
  { id: "freshFood", name: "Fresh Food", cost: 1500 },
];

// A housing reminder only: it never rolls Endurance or applies fatigue to an Actor.
export function housingReminder(choice: RentChoice): string {
  if (choice.residence === "street")
    return "Street housing — nightly DV15 Endurance check required.";
  if (choice.residence === "vehicle" && choice.vehicleHasBed !== true)
    return "Vehicle housing without a bed — nightly DV15 Endurance check required.";
  return "";
}
