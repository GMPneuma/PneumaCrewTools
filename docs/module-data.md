# Data & Cleanup

GMs open **Module Settings → Pneuma's Crew Tools → Advanced → Manage Data & Cleanup**. This replaces the separate Manage Module Data and Cleanup windows.

## Inspect and export

The inventory is a collapsible tree of Foundry objects: Journals and their folders/pages, Actors and embedded Items, world Items, RollTables and results, Chat Messages, Users, settings and saved compendium references. Each document appears once, even when several records reference it. Categories and objects retain their open/closed state while the window is used.

Each object shows its native name and type, with its exact UUID and sidebar location under **Location & stored fields**. Module data and references are distinguished, and **Referenced by** identifies the source locations. The tree follows saved Crew Tools flags, Journal UUID links and known document-ID fields; it does not enumerate every unrelated world document, load compendium packs, or reconstruct unmarked historical chat cards. Missing world references are marked; compendium availability is checked only when opened.

Cleanup controls sit inside the document or page that holds the history. Parent totals aggregate those records without recounting referenced Actors or Items. Static module Hustle tables are shown as module-maintained reference content, excluded from growing-record counts and sizes. Custom RollTables are reference-only. Client preferences are identified as local to this browser; world settings have their own static configuration branch. Existing missing-reference and interrupted-operation warnings remain beside the relevant records.

Export downloads one row. Export all records downloads module Journals, Crew Tools Actor/Item flags, module Hustle tables, world settings, and folder metadata. Files are reference snapshots for inspection and manual recovery. There is no import or restore function. The all-records export excludes native Actor resources and inventory, chat messages, client settings, world time, compendiums, and asset files. The Chat messages collection export contains the tracked offer/response and Humanity-prompt messages. Use Foundry world backups for full recovery.

## Completed-history cleanup

Choose Keep records for a row, then Purge. The confirmation identifies the location and number to remove. Defaults recommend 50 completed receipts, Humanity rolls, projects or pharmaceutical transfers, and 100 payout pages or roster changes. Keep 0 removes eligible completed history. Pending work, current roster slots, and balance/billing dependencies stay protected. Retention does not run automatically.

Pharmaceutical cleanup removes matching old chat cards before transfer receipts and preserves evidence on the counterpart's retained record. Other users must disconnect before destructive operations; changed confirmations are rejected. Failed operations report errors and can leave some earlier writes completed.

## Advanced cancellation and resets

The collapsed **Advanced: cancel or reset records** section is separate from retention. Select a character or All characters and an action:

- Dismiss unacknowledged payout receipts without reversing awards.
- Cancel pending Humanity rolls without applying them.
- Reset attendance records.
- Reset current faction reputation scores.

The preview lists affected record locations and counts, describes the consequence, and requires a separate confirmation. It does not offer duplicate completed-history clearing controls. Operation results show completed, skipped and failed locations.

## Deleted User accounts

Missing User nodes distinguish obsolete document permission entries from saved historical references. **Clean up permissions** previews the affected Crew Tools documents and pages, then removes only the deleted User's ownership keys after confirmation. Default permissions, existing Users, Actors, Journal pages, balances, pending obligations and historical attribution remain intact. A node disappears when no references remain; historical references can keep it visible until eligible history is purged at its source.

The action rejects existing accounts and stale previews, rechecks between writes, and reports completed, failed and skipped locations if interrupted. Ordinary documents outside the module's ownership scope are not changed.
