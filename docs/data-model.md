# Data model

## Payout ledger

Completed payouts are retained in the hidden, world-scoped Foundry setting
`pneuma-crewtools.payoutLedger`. Records use schema version 1 so later releases
can migrate stored history.

Each payout record captures:

- a stable ID and creation timestamp;
- the GM who created it;
- the required session name and optional in-game date and notes;
- snapshots of the selected Foundry users and their associated Actors; and
- every applied change, including its target, amount, previous value, new
  value, description, and reward-specific details.

Names are stored with Foundry IDs so history remains readable after a User,
Actor, or Item is renamed or deleted. IDs remain the canonical references.

The `correctsRecordId` field is reserved for possible future use. Version 1.0
does not provide a correction or reversal workflow, and normal records leave it
empty.

## Journal reference data

The hidden world setting `pneuma-crewtools.payoutJournalData` is the structured
source used to recreate the module-owned **Payouts** journal. It stores:

- faction-specific Reputation by Actor and faction;
- attendance totals and each player's last session;
- HQ improvements entered through the journal; and
- HQ IP transactions and their descriptions.

The journal is a readable and partly editable view of that data. Relevant HQ
table edits are synchronized back to the setting. Deleting the module-owned
journal does not discard the reference data; the settings data can recreate it.
The Module Data settings menu provides explicit controls to inspect and clear
each major section.

The module-owned **Payout Log** journal is a GM-only, append-only readable log
of completed payouts. Its stored journal ID is retained in world settings so an
unrelated journal with the same name is never adopted.

## Pending player actions

- Unacknowledged payout summaries are stored on Foundry User flags at
  `pneuma-crewtools.payoutAcknowledgments`.
- Unresolved Humanity rolls are stored on the affected Actor at
  `pneuma-crewtools.pendingHumanityRolls`.
- Humanity chat-message flags identify the corresponding pending roll and are
  updated when it is resolved or cancelled.

These records remain until the player or an explicitly enabled GM completes or
cancels the action. The Module Data settings menu can clear them manually.

## Authoritative game data

- Money, IP, Humanity, EMP, standard Reputation, and delivered Items are stored
  on Cyberpunk RED Actors and remain authoritative there.
- Communal Money and Items are stored on the selected Container Actor.
- The payout ledger records before-and-after snapshots; it does not duplicate
  current Actor balances.
- Attendance is keyed by Foundry User rather than Actor.
- Faction Reputation and the journal-based HQ IP pool are world-level module
  data.
- The last entered in-game date, Discord mappings, journal IDs, default
  container, and feature preferences are world settings.

## Optional No Place Like Home integration

When enabled, HQ IP is written directly to the selected No Place Like Home HQ
journal flags and its activity log. A linked stash may supply the communal
Container Actor. PneumaCrewTools retains its own payout-history record but does
not duplicate that external HQ's current balance.

## Transaction behavior

Payout execution records rollback operations for Actor changes, communal
Items, journal updates, acknowledgments, pending Humanity prompts, the Payout
Log, and optional HQ integration. If a later operation fails, completed changes
are reversed where possible. Rollback refuses to overwrite newer external HQ
activity.
