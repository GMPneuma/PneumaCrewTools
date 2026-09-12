import { appendPayoutRecord, getPayoutLedger } from "./payout-ledger";
import { createPayoutRecord } from "./payout-record";
import { discoverPlayerAccounts } from "./player-discovery";
import { openPayoutWindow } from "./window-controls";

export const pneumaCrewToolsApi = Object.freeze({
  createPayoutRecord,
  getPayoutLedger,
  appendPayoutRecord,
  discoverPlayerAccounts,
  openPayoutWindow,
});

export type PneumaCrewToolsApi = typeof pneumaCrewToolsApi;
