# Downtime and Player Hub

## Player entry point

Open **Crew Tools Player Hub**, then **Spend Downtime**. Payouts and acknowledgements remain the hub’s main content; the compact dashboard shows downtime, native money, IP and reputation. The downtime form puts available days on the left and a character selector on the right only when more than one eligible character is available. Global Actor exclusions apply. There is no player selector or history panel.

## Processing without a GM

After initial world setup, players use downtime immediately through their Actor ownership and character Journal permissions. No GM needs to be connected and there is no approval queue. This includes free-form spending, healing, hustle allocations and rewards, and TECH project setup, progress, checks and inventory delivery.

A GM loads the updated module once to prepare the character Journals, their owner permissions, and the shared directory. Hustle tables are also created during GM setup. Players do not need permission to create world Journals or Actors. Existing source Items must still be readable for fabrication and owned for upgrades. Upgrade holding containers are automatically prepared by a connected GM only for eligible TECH characters, and are hidden from Crew Tools player lists. This does not create character Journals.

**CrewTools / CrewTools-GM / Downtime Directory** is a technical directory of Actor IDs, names, character Journal IDs and the current session period. Each **Crew Tools — Character Name** Journal owns that Actor’s balances, projects and activity records. Its current character owners have OWNER permission; other players have no access. GMs retain access. Owners can edit their records as they can their character sheet; this is transparent bookkeeping, not an anti-cheating database.

## Awards and sessions

Individual actions and the downtime form read only the selected character's records. Whole-crew operations, such as payouts and starting the next session, still load crew records. Actions validate in their handlers; invalid requests return an error without writing rejected-request records. Recovery records remain for changes that also affect native HP, money or inventory.

Payouts award whole days through the GM, independently for each selected Actor. Multiple owners share one Actor balance. Duplicate Actor recipients in a payout are rejected. The payout downtime field starts at zero; the GM enters the days to award. Calendar changes do not award or expire days.

**Start Next Session** is an explicit GM action. It expires unallocated days and increments the session counter. Allocated hustle and project days remain. It does not process old activity receipts.

## Activities

- **Free form:** spend whole days with a description.
- **Heal:** a compact box has the formula, actual HP preview and **1 day** button on the left; three options on the right.
- **Hustle:** **+** allocates one day; **Roll Hustle · 7 days** consumes seven allocated days and pays the selected role’s current-rank reward. Excess days remain. A role selector appears only for multiclass characters. The progress bar fills at seven days.
- **TECH projects:** shown only for ranked TECH characters. Three slots are displayed; one is enabled without a Workshop or the multiple-project setting. Each project’s progress bar fills against its required days. See [TECH projects](tech-projects.md) for setup, schedules, checks and inventory transfers.

Repeated actions keep the form open. The client serializes local submissions and rechecks the latest balance before each action. Actor ownership, global exclusions, current role, session, project identity and eligibility are checked before changes.

## Healing

Base daily healing is BODY. Installed Enhanced Antibodies double it. Medbay adds two effective BODY and is enabled only with a recorded HQ Medbay improvement. Antibiotics add two HP. Cryotank doubles the rate. These checkboxes do not consume inventory Items.

**Multiply antibiotic bonus**, a world setting enabled by default, selects:

- Enabled: **(BODY + Medbay + antibiotic) × antibodies × cryotank**
- Disabled: **(BODY + Medbay) × antibodies × cryotank + antibiotic**

The calculation uses current Actor and HQ data when the action runs. HP is capped at the current maximum; full HP or no available days prevents spending. Only native **system.derivedStats.hp.value** is changed. Stabilization, critical injuries and other treatment rules are not automated.

## Journals and formatting

Every generated Journal includes a readable purpose and field explanation. Character links show the name and stable **Actor.ID**. Renaming never transfers a balance.

Players retain read-only access because offline downtime actions need the directory; the folder location does not make it private.

The directory’s **flags.pneuma-crewtools.downtime** holds version 1, period, accounts and an empty events array. Each account contains **actorId**, **name**, and **characterJournalId**; the latter identifies the character’s Journal, retaining the existing field name.

Each character Journal contains:

- **Downtime Log:** authoritative day accounting under **flags.pneuma-crewtools.downtime**, tagged **kind: actorLedger**. One account and only that Actor's events.
- **Active Projects:** TECH and medical lifecycle records under **flags.pneuma-crewtools.activities**.
- **Payout Receipts / Humanity Rolls:** payout acknowledgments and pending/completed Humanity rolls, created when needed.

Resource events contain **id, actorId, kind, days, period, date, reason** and optional payout/request/project/activity IDs, healing, hustle reward and resource changes. A **resource** event records a money/Humanity change without spending a day. Each resource change stores **resource, amount, before, after, reason**; these are historical changes, not duplicate native balances.

TECH specifications, checks and deliveries live only in Active Projects. Matching event IDs let the service assemble a temporary calculation model. Completed records remain readable. Commands are transient; repeated clicks append records without adding Journal pages.

Healing records BODY, options, antibody detection, multiplication setting, daily rate, HP before/after/maximum/restored, and optional Medbay HQ/improvement IDs. Hustle records table/result IDs, die roll, role ID/name/rank, activity, amount and native money before/after.

Visible text is generated from flags on the same page. Editing text alone does not alter the balance and the next update replaces it. Keep notes on separate pages. Disabling the module leaves ordinary readable Journals and native Items.

## Interrupted actions

Before HP, money or inventory is changed, a visible attempt record is saved. **healingAttempt** lives on Downtime Log; **hustleAttempt** and **techAttempt** live on that character’s ledger. They record the intended before/after values or source/destination Item IDs. Unknown outcomes stop repeat application until the recorded values and actual Actor are reconciled. Confirmed healing/money rollback restores the native resource; failed hustle payments retain their guard to avoid rerolling.

Committed request IDs identify completed actions. Chat is informational and cannot trigger another payment. Character actions never write another character’s ledger or the GM-controlled directory.

Local actions are serialized; simultaneous edits to the same Actor from separate clients should be avoided. Foundry Journal writes are not a cross-client transaction service.

## Development data policy

No migration or preservation is provided. Previous shared-ledger development balances are not imported into the new character ledgers. Re-award test days through a payout after setup. No hidden backups or Actor bookkeeping flags are created.

Hustle income also appends a native money Journal row in **system.wealth.transactions**, recording amount, resulting balance, date and role/rank. The full activity description remains in the downtime Journal and chat. Balance and history are updated together; a failed downtime ledger save restores both. Existing history is retained. This applies to new rolls; old test payouts are not replayed.

## Medtech and patient therapy

See [Medtech downtime and therapy](medtech.md) for seven-day courses, pricing, role checks, Humanity recovery, hourly medical work and the medical Journal fields. Pharmaceutical doses enter inventory immediately on success. End-of-day spending clears the work list and unused hours.

Character Journals are created on first payout use, not merely because an Actor is created or shared with players. Startup and ownership changes maintain already-provisioned records. Excluded Actors are not provisioned. The first payout requires a GM; subsequent owner actions remain available offline.

## Whole-week hustle and therapy option

The world setting **Must have 7 downtime days available for hustle and therapy** is in the Downtime settings group and defaults to off.

When enabled, rolling a hustle spends seven available days and applies its reward in one action. Individual hustle allocations are disabled. Starting patient or provider therapy spends seven days immediately, together with its normal fee/material cost. Receiving therapy from a PC still costs no money, but requires seven days. Therapy result rolls remain separate; a failed provider check does not refund the spent week or materials.

The dashboard removes the hustle allocation bar and plus button, and removes therapy allocation bars/plus buttons. Actions that require a week are disabled with fewer than seven available days. A day reserved for Medtech work is unavailable for these actions. TECH projects, healing and free-form activities retain their existing controls.

The rule is enforced in the command handlers as well as the UI. Both the days and activity outcomes stay in character Journals. If enabled during a partially allocated therapy course, **Use 7 days** commits a full new week; prior days are not refunded. Existing hustle allocations remain recorded while this mode uses newly available weeks.

## Downtime for characters not in a payout

The **Grant downtime to players not in payout** checkbox and day field sit directly below Primary Downtime. The checkbox starts unchecked and is enabled only when Primary Downtime is a positive whole number. Check it to enable the day field, which starts at zero. Unchecked or disabled awards are ignored; the description remains beside the primary downtime amount.

The payout preview separately lists absent characters and the days each will receive. Selection uses the same eligible character list and selected/default character as the participant picker, respects excluded Actors, skips participating players, and deduplicates shared Actors. Each missing player receives an award for at most one character.

These awards go to character Downtime Log with the same payout ID and rollback as regular downtime. They do not add attendance, money, IP, Humanity rolls or items. The Payout Ledger and optional Discord copy show a separate section; enabled payout acknowledgments include downtime-only receipts.

## Project implementation

TECH fabrication, upgrades and inventions use the TECH project records on the character Active Projects page. Workshop access or the multiple-project setting controls the three slots. Hustle uses the character’s shared seven-day pool. The earlier generic project engine and its startProject, closeProject and setHqCraftingSlots API methods have been removed.

### Stored downtime balance

Each character’s Downtime Log page stores current available days in `flags.pneuma-crewtools.downtimeBalance`. New pages start at zero. Transaction history and the updated balance are written in the same page update, including payouts, allocations, spending, expiration and rollback. The HUD and Player Hub read the stored number without loading activity history. History remains readable and can reconstruct the balance; routine GM page maintenance refreshes it alongside the Journal display. The detailed downtime form still reads activity history for projects and hustle progress.

The downtime dashboard uses one fixed-width column with vertical resizing and scrolling. TECH sections use blue accents and a light blue tint; Medtech sections use red accents and a pale red tint. Single-day actions share the **Use 1 Day** button. Other Activity accepts 1–99 days and a description in one row.

New TECH, hustle and Medtech roll messages use the native CPR chat frame, outcome badges, check totals and compact result panels. Cards appear only after the underlying action is saved, and retain GM/character-owner visibility.

Patient therapy setup and completion are inline: choose a course, optionally select a free PC therapist, and enter an addiction only for addiction treatment. Completing seven days enables the Humanity roll or completion button without opening another window. PC patients confirm therapist success or record failure in the same panel.

The scene-control **Crew Tools GM Dashboard** opens GM actions above outstanding payout acknowledgements and Humanity rolls. It includes payouts, calendar, downtime, headquarters and confirmed expiration of unspent days into the next downtime session. Rent remains disabled until rent tracking is implemented. Existing player-action safeguards apply to the pending records.

## Collapsible activities

Healing and the available-day header are always expanded. Hustle, patient therapy, Other Activity, projects/repair, provider therapy and the medical workday use native collapsible sections. Their open/closed state survives redraws while the downtime window remains open.
