# Exec Teammates

Exec characters with a ranked Exec/Teamwork role see three teammate slots in the Player Hub. Add Teammate links an existing visible Character or Mook Actor and requires manually entered initial Loyalty. Assigned player characters and already-linked teammates cannot be selected. Linking never changes Actor permissions or creates an Actor.

Players can add teammates and see only Actors for which they have Observer or higher permission, both in the picker and linked roster. The GM sees all eligible Actors. Each linked teammate displays its current Actor portrait and name. Click the portrait/name to open its native sheet. Click Loyalty to set a whole-number value with a reason. Negative values are permitted; there is no automatic Loyalty adjustment, rank-based slot restriction, assignment resolution, dismissal, or behavior automation. Removing a link preserves its Actor and change history.

Roll Loyalty Check rolls 1d6 by default. The GM can select 1d10 under Module Settings → Teammates → Loyalty check die. Either die must roll strictly below current Loyalty; ties fail. The chat card shows the selected die. The result uses the shared chat-card style and Private activity rolls setting, defaulting to public. The Exec's owner or GM may invoke the check. Checks do not spend downtime or change Loyalty.

The Exec's existing character Journal contains one Teammates page (recordKey: teammates). Its data flag holds three slots and a manual change history; readable tables display both. First-time Journal provisioning requires a GM, as with other character records; owners can subsequently manage teammates without a connected GM. Roster Actors are automatically excluded from player payouts, downtime selectors, and manual Hide Player Actors controls while linked. Actor ID is the stable link; native names appear in the Hub.

Unit/integration coverage includes three slots, ownership, duplicate/self links, manual history and failed writes, negative Loyalty, strict roll boundaries and privacy, missing Actors, roster exclusions, and template rendering. No gain/loss chart mechanics are implemented.
