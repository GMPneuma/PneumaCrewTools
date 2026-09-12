# Player and Actor discovery

`discoverPlayerAccounts()` returns every non-GM Foundry user, including users
who are currently offline. Results are sorted by user name and contain:

- the User ID, name, and active status;
- the assigned Actor's ID, name, and type when present;
- every Cyberpunk RED `character` Actor the user owns;
- whether each Actor is the user's assigned/default character;
- whether the player has at least one Actor eligible for a payout;
- discovery issues that the UI should show to the GM; and
- other User IDs that own each listed Actor.

The assigned `character` Actor is sorted first so the participant UI can select
it by default. The GM may instead select another owned character or select
multiple characters for the same player.

A user without an assigned Actor remains visible. If that user owns eligible
characters, those Actors can still be selected. A user with no eligible Actors
is marked ineligible. Shared Actors remain selectable but receive a
`sharedActor` warning; payout execution must deduplicate by Actor ID so the same
Actor is never paid twice.

The discovery service is available to the future UI and to macros through:

```js
game.modules.get("pneuma-crewtools").api.discoverPlayerAccounts();
```
