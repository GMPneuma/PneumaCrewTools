# Journal guide and specifications

## What every Journal must explain

Each Journal specification must have a plain-language explanation, and each
module-generated page must include a short **About this page** section. Readers
should not need code knowledge to understand their world's records.

For every Journal or page, explain:

- **Purpose:** what it records and why it exists.
- **Visibility:** who can read it and who can change it.
- **Format:** what each section, row, column, symbol, unit, and identifier means.
- **Updates:** which action creates or changes it, what is calculated, and whether
  it holds current values or historical entries.
- **Editing:** which parts are safe to edit, which are regenerated, and whether
  saving an edit changes another resource.
- **Storage:** whether this is the authoritative record or a readable copy, and
  where any related settings, flags, Actor values, or Item data live.
- **Removal:** what disabling the module, deleting a page, or clearing data does.
  Explain whether the module recreates anything. Never imply that deleting a log
  reverses a payment unless that behavior is actually implemented.

Use ordinary headings, paragraphs, and labeled tables. Explain abbreviations on
first use, put units in column labels, distinguish blank values from zero, and
show dates consistently. Explain any machine-readable section next to the data:
list its fields, explain its links to other records, and say which parts the
module maintains. Never use an unexplained block of IDs or JSON as the only
explanation. Do not claim the module has no hidden storage while it still does.

## Folder specification

The required organization is:

- **CrewTools:** player-facing references.
- **CrewTools / CrewTools-GM:** private GM records and technical/database records.

These are the agreed folder specifications; automatic folder placement is not
implemented yet. Current code creates Payouts and Payout Log without a folder.
Permissions must be applied to the Journals themselves, not assumed from folder
names. Player-specific records need an explicit audience; do not assume they are
shared with the whole crew.

## Journals currently implemented

### Payouts / HQ

**Purpose and audience:** a shared headquarters reference. Current permissions
allow every player to read it and GMs to edit it. Intended folder: CrewTools.

**Format:**

| Section                | Meaning                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Current HQ IP          | Sum of the signed adjustments below. IP means Improvement Points.                                                      |
| Purchased Improvements | Improvement name and recorded IP cost.                                                                                 |
| HQ IP Journal          | Date, signed Adjustment, and Reason for each entry. A positive amount adds IP; a negative amount spends or removes it. |

**Updates and edits:** applying a payout appends its HQ IP entries. Saving GM
edits recalculates the displayed total from the adjustment table. Entering an
improvement does **not** automatically subtract its cost; a matching negative
adjustment must be recorded separately. The current implementation does not
validate improvement eligibility or prevent overspending through manual edits.
Keep the HQ page name, headings, column order, and the table immediately after
its heading intact: the module uses those to find the data. Edit adjustments,
not the calculated total.

**Storage:** manually edited HQ text remains on the page. The inherited world
setting also retains payout-generated HQ entries and improvement seed data;
manual edits do not synchronize those tables back into that setting. This is an
existing implementation limitation, not the intended final Journal-first design.

**Removal:** clearing HQ data replaces the HQ tables. Deleting the registered
Payouts Journal causes it to be recreated when next needed and resets its stored
reference data. Deleting only the HQ page recreates it from the stored data;
manual-only edits on the deleted page are lost. Neither action reverses Actor
rewards. Saved text can be read with the module disabled; recalculation stops.

### Payouts / Player Reputation

**Purpose and audience:** a shared view of reputation with specific factions.
Every player can read it. Intended folder: CrewTools.

| Column     | Meaning                                                |
| ---------- | ------------------------------------------------------ |
| Actor      | Character name.                                        |
| Reputation | Current recorded score for this character and faction. |
| Faction    | The group this reputation applies to.                  |
| Reason     | Reason attached to the latest recorded update.         |

**Updates and edits:** faction-reputation payouts replace the matching character
and faction row. This is a current summary, not a transaction history, and is
separate from standard Reputation on the character sheet. Direct edits are
replaced when the generated page refreshes and do not change the underlying data.

**Storage and removal:** world settings currently hold the source records. An
empty table says No entries yet. Clearing this section clears its source data
and regenerates the page. Deleting a page is not the same as clearing its source
records. The Journal-wide deletion behavior is described under HQ above.

### Payouts / Attendance

**Purpose and audience:** a shared summary of payout participation by Foundry
player account. Intended folder: CrewTools.

| Column          | Meaning                                                      |
| --------------- | ------------------------------------------------------------ |
| Player          | Foundry account name, independent of the assigned character. |
| Sessions Played | Number of applied payouts in which the account was selected. |
| Last Session    | Most recent payout session label; a dash means no label.     |

**Updates:** each applied payout increments selected players once. Two payouts
with the same session label count twice. Rows sort by count, then name. This is
not connection monitoring or time-online tracking.

**Editing, storage, and removal:** source values currently live in world settings.
The page is generated and direct edits are replaced on refresh. Clearing
attendance clears the source counters. Deleting just the page does not clear
those counters; the module recreates it. With the module disabled the last
written summary remains readable.

### Payout Log / one page per payout

**Purpose and audience:** a GM-only written payout summary. Intended folder:
CrewTools / CrewTools-GM. The current default permissions deny players access.

**Format:** the page name contains the session label and any supplied game date.
The opening fields show In-Game Date, Recipients, and Notes. Communal Payout
contains shared rewards. Primary Payout contains group-scoped awards intended
for each selected character. Individual Payouts adds an Actor column for targeted
awards. Rows identify the reward Type, Amount, and Description. Amounts may be
signed adjustments, item quantities marked with ×, downtime days, or a dice
formula. None means no entries in that section.

**Updates and limits:** a page is added during payout execution and normally
retained afterward. Its amounts/formulas describe the payout plan; it is not a
complete record of final roll results or before-and-after balances. The separate
world-setting ledger holds more detailed changes. A failed payout may remove
the newly created page as part of rollback.

**Editing and removal:** reading or editing this page does not apply or undo
rewards and does not modify the separate ledger, Actors, Items, pending rolls, or
acknowledgments. Deleting a page removes only that summary. The Module Data
history-clear action clears both written pages and the separate ledger. Deleting
the whole Payout Log leaves the separate ledger intact; a new empty log is created
when next needed. Text already written remains readable without the module.

## Planned Journal specifications

These are proposed readable formats, not implemented automation. Each feature
must complete the explanation checklist above before its Journal is introduced.
Undecided rules must stay explicitly undecided.

| Record                          | Purpose and proposed readable format                                                                                                                                                   | Audience and behavior to specify                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Player payout reference         | Session/date, recipient, reward, amount or quantity, and explanation; clearly distinguish pending rolls from final outcomes.                                                           | CrewTools; decide what is crew-wide versus recipient-only. Reading must not repeat a payout.                                    |
| Downtime                        | Balance followed by dated rows for days awarded, used, adjusted, activity, and linked project. Label units as days.                                                                    | CrewTools; decide ownership and approval. Explain exactly when days are deducted.                                               |
| TECH projects                   | Project title, owner, intended output, status, requirements, costs/materials, work required/completed/remaining, and dated work entries.                                               | CrewTools; decide visibility and crafting rules. Explain whether an update spends days or delivers an Item.                     |
| Headquarters                    | One clearly named HQ record, its improvements, and HQ IP awards/spending with costs and reasons.                                                                                       | CrewTools; decide separate versus shared IP pools and spending permissions. Explain how balances are calculated.                |
| Housing and rent                | Housing description, standard rent, actual rent, pricing adjustment/reason, billing period, payment coverage, and next due date.                                                       | CrewTools with an explicitly chosen audience. Specify whether recording payment deducts money.                                  |
| Lifestyle                       | Purchased lifestyle, cost, purchase date, covered period, and next purchase date, followed by purchase history.                                                                        | CrewTools with an explicitly chosen audience. Specify renewal behavior and any money deduction.                                 |
| GM transaction/database records | Plain-language summary followed by labeled fields for record identity, related records, action, status, and relevant before/after values. Explain every technical field and its units. | CrewTools-GM. State which records are authoritative and which are copies. Define edit and delete effects before implementation. |
| Pending player actions          | Action required, affected player/character, source payout, status, and what completing or canceling it changes.                                                                        | Separate player instructions from private GM detail. The planned Journal storage does not exist yet; current actions use flags. |

## What is not a Journal

The calendar reads Foundry's native world time. It has no calendar Journal,
ledger, or module data setting. Actor money, standard IP, Humanity, EMP, standard
Reputation, and delivered Items remain native system data. The current module
still uses settings for the detailed payout ledger and some reference data, and
flags for pending player actions. See [the data model](data-model.md) for the
current inventory. These exceptions must remain disclosed until their designs
change.

This project is not in use. Do not add migration or preservation machinery for
pre-release world data unless the owner changes that instruction.
