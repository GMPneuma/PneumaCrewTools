# Campaign calendar

## Using it

### Optional Simple Calendar integration

Enable **Use Simple Calendar** in Crew Tools settings and save. The checkbox defaults off. The status beneath it reports the source and whether Simple Calendar is available. When enabled, Crew Tools reads the active Simple Calendar date through its public `currentDateTime()` API and refreshes on its date-change/ready hooks. It does not write either clock while following Simple Calendar. Crew Tools date-setting and day-advance controls (including its API) are disabled; make changes in Simple Calendar.

Turning the checkbox off and saving opens **Switch to Crew Tools Calendar**. Select a valid date and choose **Set Date and Switch**. Cancel leaves Simple Calendar selected and does not change world time. The switch sets shared Foundry world time to midnight using Crew Tools' native-calendar/Gregorian conversion; other modules following world time may respond. If saving the source setting fails, Crew Tools attempts to restore the previous world time.

If Simple Calendar is later disabled, uninstalled, or not ready, Crew Tools reports it as unavailable instead of silently using a different starting year. The checkbox can still be turned off to choose a new date. The integration supports Gregorian Cyberpunk dates; arbitrary fantasy calendar dates remain outside this module's date format. Integration tests use a mocked Simple Calendar API; live Foundry verification remains pending.

### Crew Tools calendar mode

The aqua city-clock display replaces the Foundry logo in the upper-left corner and shows the current world
date to players and GMs. It does not change the clock merely to initialize the UI.
On v12, a world time of zero displays 1970-01-01 under the Gregorian shim.

The aqua date reads, for example, **Jan 1, 2078**. The date itself is passive and
does not respond to clicks. Its transparent face has a subtle metal frame,
and subtle scan lines. It occupies the logo slot above the scene controls;
if no logo exists, it falls back to the upper-left corner.

To edit the date, open **Module Settings > Pneuma's Crew Tools > Campaign
Calendar**. Enter the year, select the month, and enter the day, then click
**Set date**. This supports jumps forward or backward, including between 2045
and 2077. Invalid dates are rejected. The form also advances a positive whole
number of days.

Players see the date without editing controls. When multiple GMs are connected,
the active GM with the lowest Foundry User ID handles writes. Controls update
when GMs connect or disconnect. Date changes are queued to avoid conflicting
operations within that GM's client.

New payout forms default to the campaign date. If the calendar is unavailable,
they fall back to the existing last-payout-date preference. Existing payout
records and dates already entered in a form are not changed.

Calendar changes do not award downtime, charge rent, or renew lifestyles.

## Compact Crew Tools HUD

The docked HUD shows the month and day on the left (for example, **Nov 21**) with the four-digit year underneath. Month/day text is 26px; the year is 12px. A single 23px Player Hub icon sits to the right. It uses the attention color when payout acknowledgments or unspent downtime need attention; its tooltip shows the counts.

Players see their own payout status and unspent days across owned characters; GMs see crew totals. Only module Journal changes refresh status. An unreadable downtime ledger is shown as unavailable, while known waiting payouts still light the icon.

The HUD retains its 132px by 70px metal/glass frame and 10px gap to scene controls. An extra 8px of top padding moves the date and icon down together. The date remains passive and the icon opens the Player Hub. No additional HUD data is stored.

Appearance settings now include HUD Icon Color and HUD Attention Color, using the same native client color-picker framework as the date text.

## Native world time is authoritative

The date is derived directly from `game.time.worldTime`. There is no calendar
Journal, date ledger, or separate stored current date. Calendar reads and writes
never access Journals or module data settings. External world-time changes update
the display through
Foundry's time hook; reconnecting reads the current clock.

- **v12:** a Gregorian shim converts the clock's seconds to dates using UTC,
  with 1970-01-01 as time zero. It writes through `game.time.advance(delta)`.
- **Native calendar available:** `game.time.calendar.timeToComponents` and
  `componentsToTime` perform conversion, accounting for `years.yearZero` and
  zero-based month/day components. Writes use `game.time.set` when available.
  Dates must round-trip through the configured native calendar; this feature
  targets Gregorian Cyberpunk dates, not arbitrary fantasy calendars.

Setting a date sets midnight. Advancing days preserves the existing time within
that day, although the UI displays only the date. UTC arithmetic avoids changes
caused by the client's timezone or daylight-saving time.

The adapter targets the documented v13/v14 APIs. The complete module's manifest
remains restricted to v12 until compatible Cyberpunk RED releases and live-world
verification support expanding it. The inherited UI still uses FormApplication.

## Module API

```js
const calendar = game.modules.get("pneuma-crewtools").api.calendar;
calendar.getDate(); // YYYY-MM-DD derived from world time
calendar.open(); // GM form
await calendar.setDate("2077-06-15"); // active GM only
await calendar.advanceDays(3); // active GM only
```

## Validation

`pnpm test` covers date boundaries, invalid dates, UTC arithmetic, the native
component contract, and existing payout execution/rollback behavior.
`pnpm check` type-checks the project and builds `dist`.

The optional `node scripts/test-calendar-browser.mjs` suite uses Playwright with
headless Microsoft Edge and real DOM parsing. Playwright must be resolvable
through Node, for example through NODE_PATH. Mock Foundry services cover clock
reads/writes with Journal access disabled, permissions, queued advances, failures,
native calendar reads/writes, and date controls.

Live Foundry verification remains pending: check GM/player synchronization,
form rendering and toolbar placement in an actual v12 Cyberpunk RED
world; verify v13/v14 when compatible system releases are available.

## API references

- [v12 GameTime](https://foundryvtt.com/api/v12/classes/client.GameTime.html)
- [v13 GameTime](https://foundryvtt.com/api/v13/classes/foundry.helpers.GameTime.html)
- [v14 GameTime](https://foundryvtt.com/api/v14/classes/foundry.helpers.GameTime.html)
- [CalendarData](https://foundryvtt.com/api/v13/classes/foundry.data.CalendarData.html)
- [TimeComponents](https://foundryvtt.com/api/v13/interfaces/foundry.data.types.TimeComponents.html)

## Appearance settings

Module Settings > Pneuma's Crew Tools > Appearance: Calendar Font Color provides a native color picker. The default is aqua (#7fffea). Saving applies immediately. This client setting affects only this device; it does not change campaign data or create Journals.

Future UI color options belong in the UI_COLORS registry in src/ui-appearance.ts. Each entry defines its setting key, label, hint, default six-digit hex color, and CSS custom property. Registration, color pickers, validation fallback, and immediate application are shared. Calendar styles consume --pneuma-calendar-font-color.
