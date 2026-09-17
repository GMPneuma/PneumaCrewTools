# Pneuma's Crew Tools — Roadmap

Updated: September 17, 2026

Player and crew bookkeeping for Cyberpunk RED on Foundry VTT v12. Foundry v13/v14 support remains pending compatible Cyberpunk RED releases and live verification.

**Status:** Package and manifest version **0.8.5**. Implemented features and automated checks are listed below; live-world verification remains pending where noted.

## Project rules

- Compact, mostly native Foundry UI, with the payout forms as the styling reference. The corner date/HUD display is the deliberate styling exception.
- Track characters by Actor ID, with readable names. Shared owners use the same character records. One selected character per player is sufficient for payouts.
- Store character bookkeeping and shared HQ IP in standard Journals. Each HQ is a native Container Actor for name, image and inventory, with properties, improvements and rent bookkeeping on its linked Headquarters Journal page. Native money, HP, Humanity, Reputation and inventory remain authoritative on Actors/Items.
- Player-facing Journals belong in **CrewTools**; private/technical records belong in **CrewTools/CrewTools-GM**. Use matching Actor folders for module containers.
- Create character Journals when needed. Excluded Actors and upgrade-storage containers must not clutter character selectors.
- Keep Journal summaries compact and readable. Editing rendered text does not update structured records.
- Avoid unnecessary history panels, background refreshes and full-history calculations during play.
- No pre-release migration or preservation machinery unless requested. Do not add features solely to recover obsolete test data.

## Implemented

| Area                | Current scope                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payouts             | GM participant/reward/preview workflow; money, IP, items, Humanity, normal Reputation, faction reputation, HQ IP and downtime. Advance GameTime Days defaults primary downtime to days advanced minus one, minimum zero. Optional downtime for eligible nonparticipants defaults to days advanced; both awards remain editable.                                                                                                  |
| Payout records      | Detailed Payout Ledger, character receipts, acknowledgments and outstanding Humanity rolls. Attendance is a readable player-facing summary. Optional Discord text immediately after a payout.                                                                                                                                                                                                                                    |
| Faction reputation  | Known-faction dropdown with Add new; settings to add, rename or hide factions; stable faction IDs; current scores on each character's Faction Reputation Journal page. Normal Reputation still updates the sheet.                                                                                                                                                                                                                |
| Player Hub          | Current resources, native Money/IP/Reputation ledger buttons, residence and lifestyle, shared HQ IP, top two factions and days to next hustle. Resource actions sit below their respective boxes. Payout acknowledgments and inline Administer Pharma remain accessible here.                                                                                                                                                    |
| GM Hub              | GM Action, Downtime and Headquarters sections. Initiate Payout, Modify GameTime Date, Mark Rent Due, Show Player Hub, expire/manage downtime, signed player downtime adjustments with reasons logged, Adjust Shared HQ IP and Manage Headquarters. Outstanding acknowledgments and rolls below the actions.                                                                                                                      |
| Calendar and HUD    | Foundry game-time date with configurable HUD, personal visibility/Token Controls choices and attention icon. Optional Simple Calendar integration with status and an explicit replacement date prompt when disabled. Date changes alone do not award downtime.                                                                                                                                                                   |
| Downtime            | Character Journal balances, payout awards, spending, Rest, custom activities, activity allocation and GM expiration of unallocated days. Separate Downtime Log and Active Projects pages. Owner actions work without a connected GM after setup.                                                                                                                                                                                 |
| Healing             | Rest restores HP using BODY, Enhanced Antibodies, available HQ medbay, antibiotics and cryotank options. Installed Skin Weave, Subdermal Armor and Heavy Subdermal Plating repair one lost SP per location on matching armor Items; FleshWeave restores full SP. Armor repair can use a rest day at full HP, with preview and log details.                                                                                       |
| Hustle              | Role RollTables with role icons, rank-based rewards, x/7 progress, Use 1 Day / Use X Days controls, role selection and native money-ledger payout. Optional whole-week spending.                                                                                                                                                                                                                                                 |
| TECH projects       | Fabrication, notes-only upgrades and inventions; three project slots with Workshop/setting restrictions; downtime progress, native skill dialogs, failure costs and inventory delivery. Crafting month configurable from 28–31 days.                                                                                                                                                                                             |
| Medtech therapy     | Patient and provider courses; therapy types, costs, material costs and DVs; PC treatment option; Humanity recovery; optional whole-week spending. Patient money is spent at therapy start; cancellation does not refund allocated downtime.                                                                                                                                                                                      |
| Medtech workday     | Surgery and pharmaceutical task lists, native role checks with modifiers, sixteen-hour limit, pharmaceutical costs and dose delivery. Crafted pharmaceuticals increment the first matching inventory stack. Spend one day at any point while a day is available; unfinished tasks and unused hours are discarded.                                                                                                                |
| Administer Pharma   | Compact Medtech-only section with recipient selection, inventory quantities and one-dose Administer actions. Recipient chooses Use Now or Reject; Use Now adds the dose to inventory and invokes native consumption. No Keep option or selectable dose count. Journal-backed offers/responses work without a connected GM after required setup, with one Administer Pharma table per character.                                  |
| Headquarters        | Native Container Actors provide names, images and inventory. Headquarters Journal pages store properties, improvements and rent; shared HQ IP has its own Journal ledger. Everyone access clears explicit player overrides. GM deletion deactivates the HQ and hides player access while preserving records and contents.                                                                                                        |
| HQ improvements     | No Place Like Home catalog and custom Add/Delete list, individual costs and optional level 2 descriptions. Workshop, Medbay, Garage and Server Room II gates are implemented; additional mechanical effects remain deferred.                                                                                                                                                                                                     |
| Rent and lifestyle  | Supplied housing/lifestyle choices, character Journal selections and GM-customizable percentage modifiers. Mark Rent Due creates personal self-tasks and HQ rent bills. Players select and pay their current personal choices, while crew contributions settle shared HQ bills. Contributions settle automatically without GM approval; unfinished processing and excess refunds reconcile automatically for authorized clients. |
| Settings            | Hide Player Actors first; Payout with acknowledgment first and Factions included; Lifestyle for rent and HQ improvements; Role Tweaks for Loyalty die; HUD, Downtime and Crafting groups. Advanced is last and contains Simple Calendar, Data & Cleanup, credits and GM-only Discord tools.                                                                                                                                      |
| Storage/performance | Character Journals, stored downtime/Hustle/HQ IP status values, selective access and targeted refresh handling. Version 0.8.5 fixes preserve unrelated directory accounts and cache pharma chat responses across renders.                                                                                                                                                                                                        |
| Netrunner           | Native cyberdeck controls on Player Hub and one independent crafting slot for Fabricate, Upgrade, Invention and Repair, gated by Server Room II and Electronics/Security Tech.                                                                                                                                                                                                                                                   |
| Data & Cleanup      | One GM window with a Foundry-object tree, nested folders/documents, counts, size estimates, document links, diagnostics and reference exports. Settings have a static branch; static Hustle tables are shown but excluded from history totals. Manual Keep X retention for supported completed histories; separate advanced cancellation/reset actions. No import/restore.                                                       |

See [Journal specifications](journals.md), [Data model](data-model.md), [Downtime](downtime.md), [TECH projects](tech-projects.md), [Medtech](medtech.md), [Headquarters](headquarters.md), [Rent & Lifestyle](rent.md) and [Calendar](calendar.md) for implementation details.

## Recent additions

- Exec teammates, configurable Loyalty die, and permission-filtered Actor portraits.
- Nomad vehicles on the Player Hub; shared seven-day respec task gated by an HQ Garage.
- Personal HUD/Token Controls preference, improved forms, and Mark Rent Due confirmation.
- Explicit TECH item skills and corrected Expertise modifiers.

## Included in 0.8.5

- [x] Preserve other characters in the shared downtime directory when a GM adjusts one character.
- [x] Cache pharmaceutical chat response lookups and invalidate them when relevant messages or ownership change.
- [x] Replace automatic pharmaceutical purging with explicit GM retention controls. Keep pending/interrupted transfers; prune settled transfers and associated old cards only after confirmation.
- [x] Consolidate Manage Module Data and Cleanup into Data & Cleanup, with Journal links, exports, improved diagnostics and separate cancellation/reset tools.
- [x] Organize data by Foundry object with nested pages/Items, references and per-document cleanup; keep static Hustle tables outside history totals.
- [x] Apply the latest settings order and groups, including first-position Hide Player Actors and last-position Advanced.

- [x] Allow explicit absent-player downtime when primary downtime is zero or absent, including the one-day GameTime default. Preserve opt-in, recipient validation, Journal balances and rollback.
- [x] Refresh and pass all four previously outdated browser fixtures, including additional stale Hub selectors reached after the original failures.

- [x] Endurance shortcut for characters Living on The Street; removed the awaiting-GM-setup downtime notice.
- [x] Low-EMP status button with current EMP, roleplaying summary and all nine Hare traits. Dramatic Hub effects are deferred for a 1.0 Easter egg.

## September 16 review fixes (0.8.5)

- [x] Store Humanity attempts before resource changes; preserve the roll, roll back a failed completion receipt, and block replay after uncertain writes. Local competing requests are serialized.
- [x] Limit shared HQ rent settlement to the primary connected GM, or a sole connected player with permission. Other clients keep pending contributions for automatic later settlement.
- [x] Reject stale resource previews before payout writes.
- [x] Reject partial item delivery and remove created Items; report remaining IDs if cleanup fails.

These fixes have automated failure and concurrency coverage. Live Foundry verification remains pending. They do not provide a server-side transaction across native documents or protect against every connection change during an in-flight write.

## Cleanup limitations and proposals

- [ ] Add safe compaction for balance-dependent downtime/HQ IP and billing history if broader retention is required. These records are currently protected; ordinary deletion would break calculations or retry protection.
- [ ] Evaluate coordination between cleanup and ordinary saves so users would not need to disconnect. Current cleanup deliberately requires the GM to be the only connected user; no cross-client replacement has been implemented or approved yet.
- [ ] Decide whether and how unfinished handoffs should expire. Current retention keeps pending work. Neither age-based nor quantity-based expiration is implemented; cancellation must account for withdrawn doses and incomplete refunds.

These are limitations and design decisions, not claims that the current manual purge already handles them.

## Completed feature detail

### Armor repair during downtime rest

- [x] When a character rests using downtime, repair armor items whose own rules specifically say they repair while resting. Apply each item's stated repair conditions and amount; do not repair other armor automatically.

### Custom Downtime Activities

Implemented in Other Activity, with GM management under Downtime settings.

- [x] Allow custom downtime activities with these properties:
  - **Name**.
  - **Days required (optional)**:
    - When specified, create a tracked activity entry that players can add downtime to until it is finished.
    - When omitted, assume one day and provide a simple activity button.
  - **RollTable (optional)**:
    - Offer a list of available RollTables to choose from.
    - When the activity is completed, provide a button to roll on the selected table.
- [x] Support optional payout specifications at the end of a RollTable result, using `[type](amount)`:

| Type                   | Supported amount                                                         |
| ---------------------- | ------------------------------------------------------------------------ |
| `[Money](amount)`      | Raw positive or negative amount.                                         |
| `[Humanity](amount)`   | Positive or negative amount, positive `Xd6`, or negative `Xd6` or `Xd5`. |
| `[Hitpoints](amount)`  | Positive or negative amount, positive `Xd6`, or negative `Xd6` or `Xd5`. |
| `[Reputation](amount)` | Raw positive or negative amount.                                         |

Examples: `[Money](100)`, `[Money](-50)`, `[Humanity](2d6)`, `[Humanity](-2d5)`, `[Hitpoints](-3)`, `[Reputation](1)`.

Negative dice payouts accept both `Xd6` and `Xd5`.

### Discord output from historical payouts

- [x] Select any recorded payout and generate Discord copy-and-paste text on demand.
- [x] Use saved award details, recipients and context rather than current Actor balances.
- [x] Allow repeated copying without reapplying rewards.

The current optional post-payout summary is already implemented.

### Netrunner

- [x] Show the Netrunner's cyberdecks on the Player Hub (released in 0.7.0).
- [x] Add Netrunner crafting tracking, available when the HQ has a Server Room at level 2 (released in 0.7.0).

## Deferred mechanics

These require a separate rules/design discussion before implementation.

### Headquarters

- [ ] Define and implement improvement requirements and effects beyond existing Workshop, Medbay, Garage and Server Room II integration.
- [ ] Extend project interactions for additional improvements where approved.

The catalog, costs, custom options, levels and Journal storage are implemented. The module uses a shared crew HQ IP pool; separate per-HQ pools are not assumed.

### TECH upgrades

- [ ] Add specific mechanical upgrade choices and effects; upgrades currently record notes.

Fabrication, invention, project progress, skill checks and inventory delivery are already implemented.

### Housing

- [ ] Consider Endurance-check and fatigue automation for applicable residence conditions, if requested.

Characters Living on The Street have an Endurance shortcut below Rent & Lifestyle that opens their native skill roll. Automatic checks and penalties remain outside the implemented scope. Personal rent/lifestyle are self-tasks, not fixed bills. HQs generate outstanding bills when the GM marks rent due. No automatic monthly charges are implemented.

## Future Foundry versions

- [ ] Verify the calendar integration against supported native v13/v14 APIs.
- [ ] Verify application UI, Journal permissions, native rolls and inventory behavior with each compatible Cyberpunk RED release.
- [ ] Add version-specific changes only when those combinations can be tested.

## Payment recovery

- [ ] Prevent HQ contributions from being deducted when the player cannot settle them because of missing Journal permissions.
- [ ] Complete recovery for missing HQ/bill references and interrupted money/Journal writes without duplicate charges. Payment-marker clearing and Resolve Payment Issue already exist; they do not solve lost shared receipts or every missing-reference case. Normal payments do not require GM approval.

## Verification and release

Version 0.8.5 validation: all 351 unit tests passed. Both Data & Cleanup browser fixtures have passed. The Player Hub, Headquarters, rent and nonparticipant downtime fixtures also passed after the absent-player fix. TypeScript checking passed. Browser fixtures mock Foundry services; they do not replace a live multi-user world pass.

- [x] Updated and passed all four browser fixtures previously flagged in the project review. The nonparticipant test now covers independent opt-in and one-day advancement defaults.

- [ ] Run an integrated live-world pass as both GM and player, including owner actions without a connected GM.
- [ ] Verify payouts, game-time advancement, acknowledgments, faction reputation, downtime, TECH, Medtech and HQ workflows together.
- [ ] Verify Pharma Use Now/Reject, native consumption, rejection returns and interruption/repeated-action behavior across player clients.
- [ ] Verify HQ Container ownership and player access in live Foundry.
- [ ] Verify personal rent/lifestyle tasks, HQ billing, pending contributions, GM reconciliation and excess refunds in a live world.
- [ ] Check cross-document inventory/resource operations for interruption and repeated-action behavior.
- [ ] Confirm Journals remain understandable with the module disabled, and routine use does not produce unnecessary records or background work.
- [x] Update the 0.8.5 changelog and package documentation.
- Release target: 0.8.5, with matching package/manifest versions and runtime assets.

Live verification is a separate gate from implemented features. Deferred mechanics are not required to complete the currently agreed Pharma scope.

## 0.7.5 maintenance

- [x] Personal option to hide the full HUD and restore native Foundry elements.
- [x] Clearer role headings and icons.
- [x] Explicit rent payment-marker clearing and owner-accessible issue resolution.
- [x] HQ soft deletion with retained records and contents for GM cleanup.
