# Hustle RollTables

Crew Tools creates its ten native **Hustle - Role** tables in the CrewTools folder when the primary GM connects. It maintains the descriptions and role icons of its tagged Hustle tables. GM-created custom RollTables remain untouched. Each uses **1d6** with six equally likely, repeatable results. [The supplied tables](hustle-tables-source.md) retain all original activities and rank payouts.

## Spend Downtime

The separate Hustle section shows the selected Actor's allocated hustle days. **+** moves one available downtime day into that pool. At seven or more allocated days, **Roll Hustle · 7 days** rolls and applies payment immediately. Each accepted roll consumes seven allocated days, retaining any excess; allocated days survive session changes.

A character with several ranked roles chooses a role from a dropdown. A single role needs no dropdown. The acting character owner rechecks ownership through the character's bound request Journal, the allocated balance, session period and role Item. The chosen role's current rank selects earnings: ranks 1–4 use the first amount, 5–7 the second, and 8–10 the third. The corresponding tagged table is matched to the English role name.

The acting owner rolls the native RollTable and credits **system.wealth.value** on that same Actor. A result chat card is sent to the Actor's owners and GMs after payment. A zero-income result still consumes seven days. Manual rolls directly from the table remain reference-only and do not spend days or pay money.

## Visible data and safeguards

These remain ordinary readable RollTables without the module. The table flag **flags.pneuma-crewtools.hustleRole** identifies its role. Each result's **flags.pneuma-crewtools.hustle** contains **roll**, **activity**, and **earnings**, a three-number array in rank-band order. All those values also appear in the visible result.

The character’s Downtime Journal stores allocation events and zero-unallocated-day **hustleRoll** events. A roll event has the Actor ID, role Item ID, request ID and **hustleReward**: table ID, result ID, die roll, role name, rank, activity, amount, money before and after. The readable history includes the complete reward summary and linked Actor name/ID. No hustle bookkeeping is stored on Actors or Users.

Before money is updated, the character’s owner-editable ledger records **flags.pneuma-crewtools.hustleAttempt**, containing the request ID, Actor ID and reward, with an explanatory visible paragraph. Accepted request IDs prevent repeated payment. If the ledger save fails, money is rolled back and the attempt is marked **rolledBack**. A failed save, uncertain money update or failed rollback retains the attempt and stops automatic processing for GM review; Actor update hooks cannot reroll the failed request. Chat failure never retries a payment.

Missing module Hustle tables are recreated during GM initialization. Existing module tables are identified by their Crew Tools hustleRole flag, not by their name; their descriptions and icons are refreshed without replacing result data or permissions. Changing visible table text alone does not change the structured reward; edit the earnings flags too if intentionally customizing a table. Missing or ambiguous role tables and invalid reward data stop payment without consuming days.

Hustle income also appends a native money Journal row in **system.wealth.transactions**, recording amount, resulting balance, date and role/rank. The full activity description remains in the downtime Journal and chat. Balance and history are updated together; a failed downtime ledger save restores both. Existing history is retained. This applies to new rolls; old test payouts are not replayed.
