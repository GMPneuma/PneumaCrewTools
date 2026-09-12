import { MODULE_ID } from "./constants";
import { PayoutWindow } from "./payout-window";
import { hasInboxItemsForCurrentUser, openPayoutInbox } from "./payout-inbox";

let payoutWindow: PayoutWindow | null = null;

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
      title: "Open Payout Inbox",
      icon: `fas fa-inbox${hasInboxItemsForCurrentUser() ? " pneuma-crewtools-inbox-pending" : ""}`,
      button: true,
      visible: true,
      onClick: openPayoutInbox,
    });
    if (!game.user?.isGM) return;
    tokenControls.tools.push({
      name: MODULE_ID,
      title: "Open PneumaCrewTools",
      icon: "fas fa-coins",
      button: true,
      visible: true,
      onClick: openPayoutWindow,
    });
  });
}
