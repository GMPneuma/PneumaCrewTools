# Changelog

## 0.6.0 - 2026-09-14

- Added Exec teammates with permission-filtered Actor selection, portraits, Loyalty controls, and configurable 1d6/1d10 checks.
- Added Nomad vehicle portraits and HP to the Player Hub, with three slots expanding to six. Added one seven-day vehicle respec task in Downtime, requiring an HQ Garage; vehicle changes remain manual.
- Added explicit TECH item-skill selection, corrected Expertise modifiers, and configurable armor repair settings.
- Added personal HUD / Token Controls / Both shortcut preferences.
- Added historical Discord payout export from saved records, without reapplying rewards.
- Improved downtime resizing and collapsed defaults, keeping Hustle always open. Cleaned up Headquarters and downtime adjustment forms, and added Mark Rent Due confirmation.
- Optimized actor discovery, refresh handling, Nomad record reads, and downtime validation.
- Clarified automatic rent settlement labels. Known limitation: HQ permission or missing-record problems can leave contributions pending; interrupted money/Journal writes can still require manual review.
- Tracked Netrunner cyberdecks and Server Room level 2 crafting as future work.
- Foundry compatibility remains v12. Integrated live GM/player verification remains pending.

## 0.1.1 - 2026-09-12

- Added a shared date-only campaign calendar with GM date and day-advance controls.
- Made Foundry world time authoritative for the calendar, with no Journal
  dependency, module data settings, or ongoing date history.
- Added a v12 Gregorian shim and an adapter for the v13/v14 native calendar APIs.
- Defaulted new payout forms to the campaign date when configured.
- Added plain-language Journal specifications and About this page explanations.
- Added calendar boundary and browser integration checks. Live Foundry verification
  remains pending; the module compatibility range is still v12.

- Removed the inherited external HQ adapter, its settings and destination picker.
- Retained standalone HQ IP journal tracking and manual payout-container selection.

## 0.1.0 - 2026-09-11

- Established PneumaCrewTools from the copied Pneuma's Payouts codebase.
- Renamed the module identity, asset paths, API export, and interface branding.
- Retained the existing payout features with separate settings and flags.
- Preserved the original changelog and roadmap in docs/legacy.
