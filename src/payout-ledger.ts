import { displayDate } from "./date-format";
import { MODULE_ID, PAYOUT_SCHEMA_VERSION } from "./constants";
import type { PayoutRecord } from "./payout-record";
import {
  findRecordJournal,
  ensureRecordJournal,
  readRecord,
  writeRecord,
  clearRecords,
} from "./journal-records";
export interface PayoutLedger {
  schemaVersion: typeof PAYOUT_SCHEMA_VERSION;
  records: PayoutRecord[];
}
// Each payout is a separate ordinary Journal page, containing both structured and readable details.
export function getPayoutLedger(): PayoutLedger {
  const journal = findRecordJournal("payoutLedger");
  return {
    schemaVersion: PAYOUT_SCHEMA_VERSION,
    records: Array.from(journal?.pages ?? [])
      .flatMap((p) => {
        const key = p.getFlag?.(MODULE_ID, "recordKey");
        return typeof key === "string"
          ? [readRecord<PayoutRecord>(journal, key, null!)]
          : [];
      })
      .filter(Boolean),
  };
}
export async function clearPayoutLedger(): Promise<void> {
  if (!game.user?.isGM) throw new Error("Only a GM can clear payout history.");
  await clearRecords(findRecordJournal("payoutLedger"));
}
export async function appendPayoutRecord(
  record: PayoutRecord,
): Promise<PayoutLedger> {
  if (!game.user?.isGM) throw new Error("Only a GM can add payout history.");
  const journal = await ensureRecordJournal(
    "payoutLedger",
    "Payout Ledger",
    "gm",
  );
  await writeRecord(
    journal,
    record.id,
    record.sessionLabel +
      (record.inGameDate ? " — " + displayDate(record.inGameDate) : ""),
    record,
    "A record of rewards already applied, grouped by communal, primary and individual payouts. Reading this page never repeats a payment.",
  );
  return getPayoutLedger();
}
