# Manage Module Data

GMs open **Module Settings → Pneuma's Crew Tools → Module → View or Manage Module Data**.

## Inspect

Records are grouped into Payouts, Characters, Factions, Headquarters, and Configuration. Character Journals keep their associated faction scores, downtime, projects, receipts, rent, teammates, vehicles, and pharmaceutical records together. Shared faction definitions appear under Factions. Entries show counts and pending/completed totals where records have those states. Open Journal links provide the native editable record, including item transfers and interruption details. Missing Actor/User references and interrupted operations are flagged. Raw JSON is under Technical details.

Use the normal Downtime, Headquarters, Rent, and settings screens to manage active work and configuration. This screen does not edit native resources or offer a bulk configuration reset.

## Targeted cleanup

Choose a character or All characters, then one record type:

- Unacknowledged receipts or acknowledged receipt history.
- Pending Humanity obligations or completed Humanity history.
- Attendance or current faction reputation scores.
- Shared payout history (All characters only, because one payout can include several characters).

The preview lists affected Journal pages and records. Export selected cleanup records before confirming if desired. These exports are inspection snapshots. Full bookkeeping exports are available separately.

Cleanup preserves Journal containers and unrelated pages. Active projects, downtime, pending rent contributions and pharmaceutical transfers have no general clear operation. Clearing history never reverses awarded resources. Clearing faction reputation removes current module faction scores; clearing pending Humanity cancels those obligations without rolling them.

Only the primary active GM may apply changes. Other users must disconnect for destructive operations. Writes are serialized on that GM's client, with one update per affected page. Changed previews are rejected. Operations stop at the first failure and report completed, skipped, and failed records; they are not atomic transactions.

## Full backup

**Download full backup** produces JSON with the creation time, world ID, CrewTools version and backup schema version. It includes:

- Module-owned Journals, their pages, IDs, names, permissions and module flags.
- CrewTools flags on world Actors, embedded Actor Items and world Items.
- Native hustle RollTables and results.
- Registered CrewTools world settings.
- Ancestor folders needed to recreate Journal/table organization.

Other modules' flags, native Actor/Item resources and inventory, client preferences, world time, chat, compendiums and asset files are not included. Images and other media retain their paths; the files themselves require a Foundry world/data backup. Backups may contain private campaign information and should be stored accordingly.

## Recovery

CrewTools has no import or restore function. JSON exports are reference copies for inspection and manual recovery. Use a Foundry world backup to recover bookkeeping and native character resources together.

## Validation

Automated tests cover cleanup selection, shared receipt pages, stale previews, missing references, permissions, failure reporting and export scope. A headless browser check verifies cleanup previews, backup downloads, selected exports and the absence of import controls. Live Foundry world validation remains separate.
