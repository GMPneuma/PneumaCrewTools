# Actor identity and exclusion audit

## Never list these Actors

Open **Module Settings → Pneuma's Crew Tools → Never list these Actors → Choose Actors**.
Check the Actors to exclude and save. This is a GM-only world setting,
**excludedActorIds**, containing world Actor IDs. The chooser shows names, types and
IDs, including already excluded Actors so the GM can restore them. No Actor flags
or sheet data are changed.

Exclusions apply to payout recipients, payout container selection, current attendance
and faction-reputation summaries, Player Hub characters and waiting items, downtime
and healing selectors/requests, project actions, HUD totals, Discord mapping choices,
and HQ container choices. Execution rechecks exclusions; an already-open payout
cannot bypass the setting. Historical payout records, audit exports and historical
Journal rows remain readable. Headquarters records retain their own HQ identity;
excluding a container prevents selecting/linking/opening that Actor, not deleting an HQ.

The payout screen may still group choices under the User who should receive
notifications. Each selected User has one selected character per payout. A shared Actor
cannot receive duplicate rewards or attendance counts through multiple owners.

## Findings and changes

| Feature                                       | Identity and storage                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payout recipients and reward changes          | Actor ID and readable name; User fields record delivery recipient and GM author. Execution normalizes recipient Actor identity from the actual Actor.                                          |
| Attendance                                    | Changed from User ID to Actor ID. One increment per selected Actor per applied payout. Journal names link to Actor UUIDs.                                                                      |
| Money, IP, reputation, Humanity and inventory | Native Actor/Item data; no User resource balance. Faction reputation uses Actor ID plus faction.                                                                                               |
| Downtime, healing and projects                | Actor ID in Journals; shared owners use the same balance. Healing alone updates current Actor HP. Excluded Actors cannot submit or process new requests.                                       |
| Player Hub                                    | Changed from a User selector to a character selector for both GMs and players. Metrics belong to the selected Actor.                                                                           |
| Discord links                                 | Changed from User-keyed mappings to Actor-keyed mappings. Each character can have a distinct Discord User/Role mention. Whole-crew mention is world-wide.                                      |
| Payout acknowledgments                        | Receipts are stored in the character payout Journal and identify Actor/payout IDs. Cards group by payout + Actor. User IDs route the recipient; acknowledgment timestamps stay in the Journal. |
| Pending Humanity rolls                        | Stored in the affected character's payout Journal; Actor/roll IDs identify the action. User ID controls delivery and authorization. Completed results remain in the Journal.                   |
| Headquarters                                  | HQ record IDs and linked container Actor IDs; improvements belong to the HQ. HQ IP remains the agreed shared crew pool.                                                                        |
| Calendar                                      | Foundry world time; no character or User account is appropriate.                                                                                                                               |
| Settings and audit authorship                 | World/client preferences and GM User IDs intentionally remain User/world metadata, not character progression.                                                                                  |

The source pass covered all User-ID references and Actor collection reads in src,
plus payout templates, preview generation, Journal renderers and execution paths.

## Prototype resets

No migrations or preservation copies were added. Reset old **Attendance** using
**Data & Cleanup** before applying new payouts; old User-based rows produce a specific
reset message. Re-enter **Discord Links** against character Actors.
The earlier downtime User-to-Actor reset remains as documented in downtime.md.

Legacy documents under docs/legacy describe the inherited module and are not current
specifications. Current implementation details are in this document and docs/downtime.md.

## Checks

Regression coverage includes same-name Actors, renaming, shared owners, independent
attendance/Discord mappings when a player uses different characters, excluded/stale
payouts, duplicate Actors, and the existing Journal/HP rollback tests.
Browser previews use real templates/CSS with mocked Foundry services; live-world
verification remains pending.
