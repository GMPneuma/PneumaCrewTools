# Campaign calendar

## Using it

The small toolbar at the top center of the screen shows Foundry's current world
date to players and GMs. It does not change the clock merely to initialize the UI.
On v12, a world time of zero displays 1970-01-01 under the Gregorian shim.

Click the date as GM, or open **Module Settings > PneumaCrewTools > Campaign
Calendar**. Enter the year, select the month, and enter the day, then click
**Set date**. This supports jumps forward or backward, including between 2045
and 2077. Invalid dates are rejected. The form also advances a positive whole
number of days, and the toolbar offers **+1 day**.

Players see the date without editing controls. When multiple GMs are connected,
the active GM with the lowest Foundry User ID handles writes. Controls update
when GMs connect or disconnect. Date changes are queued to avoid conflicting
operations within that GM's client.

New payout forms default to the campaign date. If the calendar is unavailable,
they fall back to the existing last-payout-date preference. Existing payout
records and dates already entered in a form are not changed.

Calendar changes do not award downtime, charge rent, or renew lifestyles.

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
