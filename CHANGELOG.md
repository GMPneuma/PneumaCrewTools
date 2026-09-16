# Changelog

## 0.8.2 - 2026-09-16

- Fixed the Modify GameTime Date window stretching its status text and pushing date controls below the visible area.
- Adjust Player Downtime and Adjust Shared HQ IP now stay open after validation or save errors, preserving entered values for correction. They close after a successful adjustment or cancellation.
- Prevented repeated Apply clicks from submitting an adjustment twice while a save is in progress.

## 0.8.1 - 2026-09-16

- Added custom downtime activities with optional day requirements and completion RollTables, managed with compact Add/Delete controls.
- Added optional Money, Humanity, Hitpoints and Reputation payout tags. Humanity and Hitpoints support positive Xd6 and negative Xd6 or Xd5. Results show a boxed description and separate payout list; dice payouts have individual Roll buttons and saved progress through Continue Result.
- Renamed Heal to Rest. Installed Skin Weave, Subdermal Armor and Heavy Subdermal Plating now repair one lost SP on both locations of their matching armor Items per rest day. FleshWeave / Sycust Fleshweave restores full SP. Repairs also work at full HP and appear in the Rest preview and Downtime Log.
- Moved standalone settings above grouped settings and standardized custom activity, armor repair and faction forms with compact layouts and purple accents.
- Reworked custom HQ improvements into an Add/Delete list with optional level 2 descriptions. HQ Everyone access clears explicit player overrides so players inherit default access.
- Added an optional Use Simple Calendar setting with visible status. Disabling it prompts for an explicit Crew Tools date; unavailable Simple Calendar does not silently change the calendar source.
- Preserved automatic creation and maintenance of module Hustle tables while leaving GM-created custom RollTables unchanged.

Foundry compatibility remains v12. Automated tests and browser fixtures validate the changes; integrated live Foundry verification remains pending.

## 0.7.5 - 2026-09-15

- Added a personal Hide Crew Tools HUD setting that restores the original Foundry logo.
- Added role heading icons and simplified the Tech and Netrunner project headings and locked-slot requirement.
- Fixed rent payment markers persisting after successful payments or rollbacks. Added Resolve Payment Issue for existing interrupted records, with confirmation and no changes to money or receipts.
- Added GM-only Delete HQ: marks the HQ inactive, hides its container and Journal page from players, and removes its facility benefits and active rent choices. Records and contents remain for manual GM cleanup.

## 0.7.0 - 2026-09-15

- Added Netrunner cyberdecks to the Player Hub with native equipment, program and upgrade controls. Cyberdecks appear three across with additional rows, black action icons, and orange Netrunner accents in Hub and Downtime.
- Added one independent Netrunner crafting slot for Fabricate, Upgrade, Invention and Repair, requiring HQ Server Room II and Electronics/Security Tech.

- Replaced the payout-only data manager with grouped record inspection, Journal links, targeted cleanup and downloadable reports.
- Separated pending and completed receipt/Humanity cleanup and prevented shared-page receipt writes from overwriting each other.
- Added versioned CrewTools backup exports and missing-reference checks. Import and restore are not included; use Foundry world backups for full recovery.

## 0.6.1 - 2026-09-15

- Added Icon credits in module settings, available to players and GMs.
- Credited the original hustle role glyph artists and sources, including license links and a modification notice.
- Included the credits in the README and distributed module package.

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
