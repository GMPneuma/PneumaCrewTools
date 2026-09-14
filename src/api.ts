import {
  openHeadquarters,
  getHeadquarters,
  saveHeadquarters,
  buyHqImprovement,
  editHqImprovement,
  removeHqImprovement,
  adjustHeadquartersIp,
} from "./headquarters";
import { openPlayerHub } from "./payout-inbox";
import {
  getDowntime,
  openDowntime,
  requestDowntimeUse,
  startNextDowntimeSession,
} from "./downtime";
import {
  getCampaignDate,
  setCampaignDate,
  advanceCampaignDays,
  openCampaignCalendar,
} from "./calendar";
import { appendPayoutRecord, getPayoutLedger } from "./payout-ledger";
import { createPayoutRecord } from "./payout-record";
import { discoverPlayerAccounts } from "./player-discovery";
import { openPayoutWindow, openGMDashboard } from "./window-controls";

export const pneumaCrewToolsApi = Object.freeze({
  openGMDashboard,
  openPlayerHub,
  headquarters: Object.freeze({
    open: openHeadquarters,
    getState: getHeadquarters,
    save: saveHeadquarters,
    buyImprovement: buyHqImprovement,
    editImprovement: editHqImprovement,
    removeImprovement: removeHqImprovement,
    adjustIp: adjustHeadquartersIp,
  }),
  downtime: Object.freeze({
    getState: getDowntime,
    open: openDowntime,
    use: requestDowntimeUse,
    startNextSession: startNextDowntimeSession,
  }),
  calendar: Object.freeze({
    getDate: getCampaignDate,
    setDate: setCampaignDate,
    advanceDays: advanceCampaignDays,
    open: openCampaignCalendar,
  }),
  createPayoutRecord,
  getPayoutLedger,
  appendPayoutRecord,
  discoverPlayerAccounts,
  openPayoutWindow,
});

export type PneumaCrewToolsApi = typeof pneumaCrewToolsApi;
