# PneumaCrewTools Roadmap

## Purpose and compatibility

Player and crew resource bookkeeping for Cyberpunk RED, starting with the
existing GM payout workflow on Foundry VTT v12.

Design for upgrades to Foundry v13 and v14 when the Cyberpunk RED system supports
them. Keep version-dependent calendar, document, and UI integration separate from
bookkeeping logic. Compatibility must be verified on each supported combination;
this roadmap does not claim future-version support is already implemented.

This is a planning document. Unchecked items are proposed work, not implemented
features. Phase order reflects dependencies, not release dates.

The project is not in use yet. Until the owner says otherwise, do not implement
migration, backward-compatibility data handling, or preservation of pre-release
world data. Migration requirements below are deferred until that changes.

## Project-wide UI direction

All features should use a mostly native Foundry UI: familiar windows, forms,
buttons, tables, and standard interactions. This is a functional bookkeeping
tool, not an immersion interface.

- Prefer native Foundry components and behavior throughout the module.
- Use the existing payout forms as the reference for modest polish: clear
  labels, consistent spacing, compact grouping, and readable summaries.
- Prioritize usability, legibility, and efficient entry and review of data.
- Do not introduce decorative cyberpunk styling, fictional terminals, neon
  effects, or other themed presentation intended to create immersion.
- Keep custom styling restrained and consistent with the surrounding Foundry UI.

## Existing foundation

Version 0.1.0 retains the copied Payouts workflow: the GM fills out a form and
applies money, Items, and other rewards to players, with payout history, readable
Journals, a player inbox, and Discord copy-and-paste output.

The inherited implementation includes HQ IP and improvement records. These will
be extended into management of multiple headquarters. Existing downtime awards
will be extended into balances and spending.

The current ledger and Journal reference data still depend on hidden world
settings. See [the current data model](docs/data-model.md). The
[original Payouts roadmap](docs/legacy/payouts-roadmap.md) is historical context.

## 1. Journal-first records and data ownership

Every Journal specification must explain its purpose, format, audience, updates,
editing rules, storage, and removal behavior in plain language. Generated pages
must carry an About this page explanation. See [Journal specifications](docs/journals.md).

- [ ] Place player-facing Journals in **CrewTools** and private GM/technical
      Journals in its **CrewTools-GM** subfolder, with explicit Journal permissions.

- [ ] Store all significant module bookkeeping data in standard Foundry Journals:
      payout history, pending obligations, downtime, TECH projects, headquarters,
      improvements, HQ IP transactions, housing, rent, lifestyle purchases and renewals,
      with native Foundry data remaining authoritative where it already exists.
- [ ] Make records readable and usable through native Foundry Journal sheets with
      the module disabled or removed. No essential information may exist only in
      hidden settings, module flags, or custom UI.
- [ ] Retain native Actor and Item data as the authority for resources already
      managed by the game system; record their payout changes in Journals without
      creating competing current balances.
- [ ] Define how native Journal edits update bookkeeping records, including
      validation and recovery, without silently overwriting user edits.
- [ ] Limit settings and flags to preferences, references, and rebuildable support
      data; document their purpose and cleanup behavior.
- [ ] Migrate existing ledger, reference data, and significant pending actions
      into Journals. Verify completeness before retiring old storage, and make
      interrupted or repeated migration safe without duplicate payouts.
- [ ] Preserve readable names and historical values when linked Users, Actors,
      Items, or headquarters are renamed or deleted.
- [ ] Define deletion, archive, and recovery behavior. Never leave inaccessible
      module-dependent artifacts or silently recreate deliberately deleted records.
      Retained Journals must remain useful campaign records without the module.
- [ ] Apply native Journal permissions so players can see the appropriate records
      while GM-only payout information remains private.

Acceptance: disabling the module leaves complete, understandable campaign
records; re-enabling it does not duplicate records or reapply resource changes.

## 2. Date-only calendar shim

Implementation is available for v12 with a native-calendar adapter and automated
checks. Live Foundry acceptance remains pending. See [calendar details](docs/calendar.md).

- [x] Provide a simple campaign date with no time-of-day controls required.
- [x] Show a tiny date display near the top of the screen for both players and GMs.
- [x] Let the GM set the starting date and advance time; synchronize the display
      for connected players and restore it correctly for users who join later.
- [x] Derive the calendar date from native world time without a Journal dependency.
- [ ] Allow payouts and project
      activity to reference the campaign date. Use the same date for rent due dates
      and lifestyle renewal dates.
- [ ] Isolate the v12 calendar shim behind a small integration layer. Verify the
      native calendar APIs and migration options for v13/v14 before implementing
      those adapters; preserve dates and history when moving to native support.
- [ ] Define whether advancing the calendar awards downtime. Keep date advancement
      and downtime awards distinct until that policy is agreed.

Acceptance: only the GM can advance the shared date; all users see the same date,
and the underlying records remain readable without the display.

## 3. Discord copy-and-paste on demand

- [ ] Add an action to generate Discord text from any recorded payout, including
      historical payouts, whenever the GM needs it.
- [ ] Generate output from saved payout details rather than the current form or
      current Actor balances. Preserve awarded amounts, recipients, and context.
- [ ] Carry forward available historical data during migration; clearly identify
      any missing detail rather than inventing it.
- [ ] Allow repeated copying without applying the payout again.
- [ ] Decide whether the existing automatic post-payout dialog remains optional.

Acceptance: a previous payout can be selected and copied after a reload, without
changing resources or creating another payout record.

## 4. Downtime balances and spending

- [ ] Track days awarded, days spent, adjustments, and remaining days per player
      or character, with a readable transaction history.
- [ ] Connect downtime awarded through Payouts to these balances.
- [ ] Let players use available days and record the activity and days consumed.
- [ ] Give the GM oversight and a recorded correction/cancellation workflow.
- [ ] Prevent overspending and duplicate spending, including simultaneous actions.
- [ ] Link project-related spending to the relevant TECH project.

Acceptance: every balance can be explained from its Journal history; players can
use only resources they are authorized to manage.

## 5. TECH crafting projects

- [ ] Track project owner, intended output, requirements, required work, completed
      work, remaining work, and status.
- [ ] Apply downtime spending to a project and record both changes together,
      without charging the same days twice.
- [ ] Record relevant costs, materials, checks, and outcomes using agreed rules.
- [ ] Support work across multiple sessions, with pause, completion, and
      cancellation behavior defined before implementation.
- [ ] Decide whether completion records an outcome only or also delivers an Item.
      Any Item delivery must be explicit and protected against duplication.

Acceptance: project progress and downtime spending reconcile, and project details
remain understandable without the module.

## 6. Multiple crew headquarters and improvements

- [ ] Track multiple named headquarters with their own details and improvements.
- [ ] Record HQ IP earned through payouts and its allocation to the appropriate
      headquarters or crew pool, according to the agreed allocation policy.
- [ ] Let the authorized user spend HQ IP on improvements, recording the cost,
      destination headquarters, improvement, date, and remaining balance.
- [ ] Prevent overspending and duplicate purchases where applicable.
- [ ] Preserve the existing HQ IP and improvement records during migration;
      explicitly resolve their destination when introducing multiple headquarters.
- [ ] Keep purchase, adjustment, and removal history readable in Journals.

Acceptance: each headquarters has an understandable improvement list, and all
available HQ IP reconciles with payout awards and recorded spending.

## 7. Player housing and rent

- [ ] Track each player's housing, its rent cost, and the next rent due date.
- [ ] Support modifications to standard housing pricing, retaining both the
      standard price and the agreed actual rent with any adjustment notes.
- [ ] Record rent payments, the period covered, and the next due date in Journals.
- [ ] Use the campaign calendar to show when rent is due or overdue, including
      when the GM advances across multiple due dates.
- [ ] Preserve housing and rent history when a player moves or their rent changes.

Acceptance: the player and GM can identify the current housing, actual rent,
payment coverage, and next due date from readable Journal records.

## 8. Player lifestyle purchases and renewal

- [ ] Track the lifestyle each player has purchased, its cost, purchase date,
      coverage period, and the date another purchase is required.
- [ ] Use the campaign calendar to show current coverage and when renewal is due.
- [ ] Record subsequent purchases and lifestyle changes in Journals while
      preserving previous purchases and their coverage periods.

Acceptance: the player and GM can identify the purchased lifestyle and when it
must be purchased again, including after a calendar advance or module removal.

## Decisions to settle before the relevant feature is implemented

- Downtime ownership: per Foundry User, per character, or another arrangement?
- Downtime spending: immediate player use or GM approval? Whole days only?
- Calendar: starting date, date format, and relationship to downtime accrual?
- TECH projects: which crafting rules/sources, supported project types, checks,
  material costs, and cancellation/refund behavior?
- Headquarters: one shared crew IP pool or separate balances? Who may spend it?
  Which improvement rules/catalog and purchase restrictions apply?
- Housing and lifestyle: per player or character? Who records purchases and
  changes pricing? What billing periods and renewal rules apply? Should payments
  be recorded only, or also deduct money? No automatic charges or penalties are
  assumed by this roadmap.
- Journals: organization, player visibility, and native editing/reconciliation?

## Verification and release gates

- [ ] Review every feature against the project-wide native UI direction, using
      the payout forms as the reference for the level of polish.

- [ ] Verify the renamed baseline module in a Foundry VTT v12 Cyberpunk RED world.
- [ ] Verify migration, native Journal readability, permissions, and behavior with
      the module disabled and re-enabled.
- [ ] Check interrupted writes, concurrent spending, and recovery for operations
      that affect multiple records or native resources.
- [ ] Verify historical Discord output and the complete payout-to-downtime,
      crafting, and HQ IP workflows as those features are delivered.
- [ ] Verify housing price adjustments, rent payment coverage, and lifestyle
      renewals across calendar advances, including advances over multiple periods.
- [ ] Prepare the first installable release when the selected scope is ready.
- [ ] Add v13/v14 support only after testing against compatible Cyberpunk RED
      system releases, including calendar migration and UI behavior.
