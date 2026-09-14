# Journal guide and specifications

Journal pages use Foundry’s page title and compact tables. Active activities are visible; completed activities are collapsed. A short About this page section explains purpose, storage and editing. Routine pages do not repeat raw field dumps; technical attempt details appear only when an interrupted action needs review. Structured flags and readable content live on the same native document. The readable content is a generated view; editing prose does not change stored bookkeeping or apply rewards. Keep personal notes on separate pages.

## Folders and ownership

- **CrewTools** contains shared references and private per-character Journals.
- **CrewTools / CrewTools-GM** contains private GM history and technical records.
- Shared references grant players Observer access and GMs Owner access.
- Character Journals grant the character's owners and GMs Owner access, and everyone else no access.
- Folder names do not grant permissions.

## Attendance / Attendance

A shared current summary of payout participation, keyed by Actor ID. Each applied payout increments each selected character once, regardless of multiple owners. Two payouts with the same session label count twice.

**Columns:** Character is a named Actor link; Sessions Played is the count; Last Session Name is the name entered on the latest payout. Excluded Actors are hidden from the summary but retained fields remain readable in the complete-fields section.

**Stored fields:** **actorId**, **actorName**, **sessions**, **lastSession**. The page's **recordKey** is **attendance** and its **data** flag contains the row array. GMs update through payouts or clear through Module Data. This page is authoritative; no settings copy exists.

## Factions / Factions

The GM manages factions through Settings > Faction Reputation > Manage Factions, or adds one directly from a payout dropdown. Each faction has a stable **id**, display **name**, and **active** flag. Inactive factions are hidden from new payouts; existing reputation remains. The table shows names and availability. Page **recordKey** is **factions**. This Journal is created only when the list is saved.

## Character Journal / Faction Reputation

Created on the first faction reputation award. Payouts set the selected faction's reputation, separately from native character-sheet Reputation. The compact table shows **Faction**, **Reputation**, and latest **Reason**. Owners and GMs can read this character Journal.

Page **recordKey** is **factionReputation**. Its **data** rows contain **actorId**, **actorName**, **factionId**, **faction** (name), **reputation**, and **reason**. IDs identify the Actor and faction. Renaming a faction updates the current summary without rewriting historical receipts. Editing visible Journal text does not change these structured records. Payout history remains in the Payout Ledger.

## CrewTools-GM / Payout Ledger

GM-only authoritative history with one page per payout. Each page's **recordKey** is the payout ID; **data** contains the payout record, with all fields rendered in readable labeled sections.

**Fields:**

- **schemaVersion**, **id**: format and stable payout identity.
- **createdAt**, **createdByUserId**, **createdByUserName**: recorded timestamp and GM author.
- **sessionLabel**, **inGameDate**, **notes**: session context and campaign date.
- **participants**: Actor IDs/names and recipient User IDs/names.
- **changes**: reward type, target type/ID/name, signed amount, previous/new values, description, source scope and reward-specific fields such as Item or faction details.
- **correctsRecordId**: reserved relationship; normally empty. No correction workflow is supplied.

Amounts describe recorded changes, not a second balance. Null before/after values mean no numeric native resource value was recorded for that change. Reading or editing the page cannot repeat payment. Clearing history removes ledger pages without changing Actors.

## Crew Tools — Character / Payout Receipts

Private to the character's owners and GMs. **recordKey** is **acknowledgments**; **data** holds the receipts.

**Fields:** **id**, **payoutRecordId**, **actorId**, **actorName**, **sessionLabel**, **inGameDate**, **userId**, **userName**, **createdAt**, **acknowledgedAt**, and **awards**. Each award has readable **text**, and may include **label**, **value**, **description**, **img**, or **icon** for display.

Actor ID identifies the character; User ID identifies the recipient. A blank **acknowledgedAt** means the recipient has not marked the receipt as seen. A timestamp means it has been acknowledged. This is never payment approval: rewards are applied before acknowledgment.

Acknowledgment preserves the Journal receipt and removes it from the active Hub/HUD list. Module Data can explicitly clear receipts. Reading or deleting receipts never pays or undoes an award.

## Crew Tools — Character / Humanity Rolls

Private to the character's owners and GMs. **recordKey** is **humanity**; **data** holds pending and completed payout Humanity actions.

**Fields:** **id**, **payoutRecordId**, **actorId**, **actorName**, **userId**, **reward** (humanityGain/humanityLoss), **formula**, **description**, **createdAt**. Completed entries additionally have **resolvedAt**, **rollTotal**, **previousHumanity**, and **newHumanity**.

An unresolved entry requires a roll. Completing it updates native Humanity and EMP, then retains the result here. Clearing pending rolls removes unresolved entries without changing Humanity; completed results remain. Chat cards reference Actor/roll IDs, and are not the authoritative pending-action store.

Players can process their prepared Journal actions without a connected GM. Journal ownership follows native character ownership; recipient User IDs still control the action's intended recipient.

## Downtime, projects and medical records

[Downtime](downtime.md) documents the shared Actor/session directory and each character's authoritative balance/events. [TECH projects](tech-projects.md) documents project fields and held upgrade inventory. [Medical records](medtech.md) documents therapy, hourly work and results. They share the same character Journal with payout receipts. **Downtime Log** stores day charges and resource changes; **Active Projects** stores active and completed TECH/medical records. A click does not create a new Journal page.

## Headquarters

[Headquarters](headquarters.md) documents the shared HQ registry, images, native container Actor links, improvements and HQ IP transactions.

## Editing, disabling and removal

All payout **recordKind**, **actorId**, **recordKey**, and **data** tags use the **flags.pneuma-crewtools** namespace. Human-readable fields are stored in standard page text. Direct text edits are replaced when that record refreshes; they do not change structured data. Removing records does not reverse native resources. Deleted reference pages may be recreated empty; history is not restored from another storage location.

The module uses settings for preferences and references, native Actors/Items for game resources, and Foundry world time for the calendar. Campaign bookkeeping is not stored in hidden settings, User flags or character flags. No development-data migration or hidden preservation copy is created.

[Rent & Lifestyle](rent.md) defines character residence/bill/contribution pages, shared rate/billing pages, and readable HQ rent summaries. Confirmed HQ rent totals are stored on the HQ Container Actor; pending payments are stored in the paying character’s Journal.

Existing character and payout ledger pages refresh their display when the GM loads the module. Presentation refreshes do not change structured records or native resources.

Displayed dates use **MM-DD-YYYY**. Structured dates retain ISO ordering for calculations. Payout Ledger uses Communal, Primary and Individual tables; before/after values remain in expandable details. There is no separate payout log.

On GM startup, the obsolete module-tagged Payout Log is removed. The Payout Ledger remains the sole history.
