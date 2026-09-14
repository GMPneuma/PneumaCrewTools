import { MODULE_ID } from "./constants";
import { openDashboard } from "./gm-dashboard";
import { PayoutWindow } from "./payout-window";
import { hasInboxItemsForCurrentUser, openPlayerHub } from "./payout-inbox";

let payoutWindow: PayoutWindow | null = null;

export function openGMDashboard(): void {
  openDashboard(openPayoutWindow);
}

export function openPayoutWindow(): void {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only a GM can open PneumaCrewTools.");
    return;
  }

  if (!payoutWindow?.rendered) payoutWindow = new PayoutWindow();
  payoutWindow.render(true);
}

export function registerPayoutWindowControl(): void {
  Hooks.on("getSceneControlButtons", (controls: SceneControl[]) => {
    const tokenControls = controls.find(({ name }) => name === "token");
    if (!tokenControls) return;
    tokenControls.tools.push({
      name: `${MODULE_ID}-inbox`,
      title: "Open Crew Tools Player Hub",
      icon: `fas fa-inbox${hasInboxItemsForCurrentUser() ? " pneuma-crewtools-inbox-pending" : ""}`,
      button: true,
      visible: true,
      onClick: openPlayerHub,
    });
    if (!game.user?.isGM) return;
    tokenControls.tools.push({
      name: MODULE_ID,
      title: "Crew Tools GM Dashboard",
      icon: "fas fa-gauge-high",
      button: true,
      visible: true,
      onClick: openGMDashboard,
    });
  });
}
