import {
  MODULE_ID,
  PAYOUT_LEDGER_SETTING,
  PAYOUT_SCHEMA_VERSION,
} from "./constants";
import type { PayoutRecord } from "./payout-record";

export interface PayoutLedger {
  schemaVersion: typeof PAYOUT_SCHEMA_VERSION;
  records: PayoutRecord[];
}

const EMPTY_LEDGER: PayoutLedger = {
  schemaVersion: PAYOUT_SCHEMA_VERSION,
  records: [],
};

export function registerPayoutLedger(): void {
  game.settings.register(MODULE_ID, PAYOUT_LEDGER_SETTING, {
    name: "Payout Ledger",
    hint: "Internal versioned history for PneumaCrewTools.",
    scope: "world",
    config: false,
    type: Object,
    default: EMPTY_LEDGER,
  });
}

export function getPayoutLedger(): PayoutLedger {
  const stored = game.settings.get(MODULE_ID, PAYOUT_LEDGER_SETTING);

  if (!isPayoutLedger(stored)) {
    console.warn(
      `${MODULE_ID} | Invalid payout ledger; using an empty ledger.`,
    );
    return structuredClone(EMPTY_LEDGER);
  }

  return structuredClone(stored);
}

export async function clearPayoutLedger(): Promise<void> {
  if (!game.user?.isGM) throw new Error("Only a GM can clear payout history.");
  await game.settings.set(
    MODULE_ID,
    PAYOUT_LEDGER_SETTING,
    structuredClone(EMPTY_LEDGER),
  );
}

export async function appendPayoutRecord(
  record: PayoutRecord,
): Promise<PayoutLedger> {
  if (!game.user?.isGM) {
    throw new Error("Only a GM can add a payout record.");
  }

  if (!isPayoutRecord(record)) {
    throw new Error("Cannot store an invalid payout record.");
  }

  const ledger = getPayoutLedger();

  if (ledger.records.some(({ id }) => id === record.id)) {
    throw new Error(`Payout record ${record.id} has already been stored.`);
  }

  const updated: PayoutLedger = {
    schemaVersion: PAYOUT_SCHEMA_VERSION,
    records: [...ledger.records, structuredClone(record)],
  };

  await game.settings.set(MODULE_ID, PAYOUT_LEDGER_SETTING, updated);
  return structuredClone(updated);
}

function isPayoutLedger(value: unknown): value is PayoutLedger {
  if (!isObject(value)) return false;

  return (
    value.schemaVersion === PAYOUT_SCHEMA_VERSION &&
    Array.isArray(value.records) &&
    value.records.every(isPayoutRecord)
  );
}

function isPayoutRecord(value: unknown): value is PayoutRecord {
  if (!isObject(value)) return false;

  return (
    value.schemaVersion === PAYOUT_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.createdByUserId === "string" &&
    typeof value.createdByUserName === "string" &&
    typeof value.sessionLabel === "string" &&
    (value.inGameDate === undefined || typeof value.inGameDate === "string") &&
    typeof value.notes === "string" &&
    Array.isArray(value.participants) &&
    Array.isArray(value.changes) &&
    (value.correctsRecordId === null ||
      typeof value.correctsRecordId === "string")
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
