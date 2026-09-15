# Data model

Crew Tools campaign bookkeeping lives in ordinary Foundry Journals. Native character resources remain authoritative on Actors/Items; campaign time remains Foundry world time. Settings hold configuration and form preferences, not payout history or character obligations.

## Storage inventory

| Record                                      | Authoritative location                                        | Audience                |
| ------------------------------------------- | ------------------------------------------------------------- | ----------------------- |
| Detailed payout history                     | CrewTools / CrewTools-GM / Payout Ledger; one page per payout | GM                      |
| Attendance                                  | CrewTools / Attendance / Attendance                           | Crew read, GM write     |
| Faction list                                | CrewTools / Factions / Factions                               | Crew read, GM write     |
| Faction reputation                          | CrewTools / Character Journal / Faction Reputation            | Character owners and GM |
| Payout receipts and acknowledgment dates    | CrewTools / Crew Tools — Character / Payout Receipts          | Character owners and GM |
| Pending and completed payout Humanity rolls | CrewTools / Crew Tools — Character / Humanity Rolls           | Character owners and GM |
| Downtime, TECH and medical work             | CrewTools / Crew Tools — Character                            | Character owners and GM |
| HQs and improvements                        | Container Actor flags.pneuma-crewtools.hq                     | Crew read, GM write     |
| Shared HQ IP                                | CrewTools / Shared HQ IP                                      | Crew read, GM write     |

Payout Ledger is the sole payout history, displaying Communal, Primary and Individual sections from applied changes.

The technical **Downtime Directory** lives under **CrewTools / CrewTools-GM** and stores the session period and Actor-to-Journal links. Players retain read access for offline actions.

## Journal format

Payout Journals identify themselves with **flags.pneuma-crewtools.recordKind**:
**payoutReference**, **payoutLedger**, **character**.
Character Journals additionally carry **actorId**. Names are display labels; discovery uses these tags, not Journal names or hidden ID settings.

Authoritative pages carry **flags.pneuma-crewtools.recordKey** and **flags.pneuma-crewtools.data**. Keys are **attendance**, **factions**, **factionReputation**, **acknowledgments**, **humanity**, or the payout ID for a ledger entry. Each page renders its fields into ordinary readable text alongside a formatting/storage explanation. See [Journal specifications](journals.md) for the fields and editing rules.

## Native resources and references

Money and its native transaction list, IP, standard Reputation, HP, Humanity, EMP, and delivered Items stay on Cyberpunk RED Actors. Communal resources stay on the selected Container Actor. Journals record changes and obligations without duplicating authoritative current balances.

Actor IDs identify characters; Item UUIDs identify source Items; User IDs identify the applying GM, receipt recipient or roll authorization. User IDs never own resource balances. Chat Humanity buttons carry only an Actor ID and roll ID; they resolve the authoritative Journal record.

Hustle RollTables remain native reference data. Upgrade holding Actors remain native inventory containers; their module tag only links them to a character, while project state stays in Journals.

## Configuration

World/client settings retain appearance, rule options, exclusions, Discord mappings, feature toggles, default container and the last-entered payout date as a form preference. That preference is not the campaign clock or a history record.

No payout history, attendance, faction scores, acknowledgments or pending Humanity obligations are read from or written to world settings, User flags or character Actor flags.

## Updates and lifecycle

Payout execution updates native rewards, reference pages, character action pages, the payout ledger. Existing rollback callbacks now restore Journal records for pending actions as well as native rewards.

Players can acknowledge receipts and resolve Humanity through their prepared owner-editable Journal without an online GM. Acknowledgment marks a receipt as seen and preserves it; it does not approve or delay payment. Completed Humanity records retain their timestamp, roll and before/after values.

GM setup and Actor ownership changes refresh existing character Journal permissions. Folder names are organization only; Journal permissions control access.

Deleting a Journal record never reverses a payout. Text remains readable with Crew Tools disabled; direct text edits do not update structured fields or character resources. No development-data migration, legacy fallback or hidden backup storage is included.

## Code boundaries

- **downtime.ts** wires hooks and window lifecycle; **downtime-form.ts** renders and handles form interaction.
- **downtime-service.ts** coordinates commands and activity rules.
- **downtime-store.ts** discovers and prepares character accounts; **downtime-records.ts** reads and writes their pages.
- **activity-records.ts** defines the shared TECH/medical lifecycle format.
- **actor-resources.ts** centralizes native money transactions, Humanity updates and Item delivery.
- **action-coordinator.ts** provides local serialization independently of the UI and HQ services.

Each character has one Journal tagged **recordKind: character** and **actorId**. Downtime Log owns day charges; Active Projects owns TECH and medical details; Payout Receipts and Humanity Rolls retain their existing responsibilities. Successful action clicks append structured records, not new Journal pages.

Journal page updates and native Actor updates are separate operations, not an atomic Foundry transaction. Existing interruption records remain visible.

Character Journals are created on first payout use, not merely because an Actor is created or shared with players. Startup and ownership changes maintain already-provisioned records. Excluded Actors are not provisioned. The first payout requires a GM; subsequent owner actions remain available offline.

### Structural cleanup

- **payout-plan.ts** turns a form draft into rewards, attendance, faction changes and Humanity prompts. Primary faction rewards retain their group scope.
- **payout-execution.ts** coordinates native updates and Journal writes. Payout acknowledgments remain owner-editable Journal receipts.
- **journal-format.ts**, **payout-journal-view.ts** and **downtime-journal-view.ts** render readable HTML separately from Journal persistence.
- **tech-project-model.ts** reads TECH events directly from Active Projects. Downtime Log contain only charges and references. **downtime-records.ts** saves changed Active Projects separately; ordinary day spending does not rewrite them.
- **payout-system.ts**, **system-resources.ts**, **actor-resources.ts**, **tech-system.ts** and **medtech-system.ts** isolate native system values, updates, rolls and item operations. **upgrade-storage.ts** owns native holding-container setup.
- **foundry-form.ts** is the common native application boundary. It preserves v12 FormApplication behavior; this does not claim completed v13/v14 UI compatibility.
- Downtime actions execute directly through the local action coordinator. There is no request-page scanner, fake request document, or GM approval queue.
- Actor name, ownership and role changes schedule a coalesced, targeted maintenance pass. Money/HP changes never trigger setup. Ordinary Journal pages do not refresh Crew Tools windows. Full maintenance is reserved for startup, connection changes and exclusion-setting changes.

The directory binding is **characterJournalId**. Active Projects and Downtime Log remain distinct authoritative records in the same character Journal. No development-data migrations or backups were added.

### Stored downtime balance

Each character’s Downtime Log page stores current available days in `flags.pneuma-crewtools.downtimeBalance`. New pages start at zero. Transaction history and the updated balance are written in the same page update, including payouts, allocations, spending, expiration and rollback. The HUD and Player Hub read the stored number without loading activity history. History remains readable and can reconstruct the balance; routine GM page maintenance refreshes it alongside the Journal display. The detailed downtime form still reads activity history for projects and hustle progress.

## Rent & Lifestyle

Character Journals own residence choices, monthly due tasks, payment-time receipts, payment status and pending HQ contributions. HQ Journal pages own confirmed shared rent totals and unique contribution receipts; authorized player or GM reconciliation refunds overpayments through native money ledgers. Shared Journals expose rates and readable HQ totals. See [Rent & Lifestyle](rent.md) for keys, permissions and payment behavior.

### Lightweight status reads

Downtime Log pages also store current allocated hustle days in `flags.pneuma-crewtools.hustleDays`, updated atomically with the transaction history and available-day balance. The Player Hub reads this scalar. Existing pages calculate it once per loaded record until normal maintenance or a transaction stores it.

The shared HQ IP ledger stores its current `balance` alongside transactions. Status reads use that balance; HQ, rent, workshop, and medbay reads omit the IP ledger entirely. Older IP ledgers calculate their balance once per loaded record until saved.

Administer Pharma keeps Item snapshots while withdrawals, deliveries, or refunds are pending or interrupted. Completed received/rejected, consumed, and returned rows keep only compact receipt fields on subsequent writes. Reconciliation indexes valid recipient responses once per pass.

The calendar listens to world-time changes and only rewrites its date when the displayed day changes. HQ Actor refreshes are restricted to relevant HQ metadata, rent, appearance, and ownership changes.

HQ rent contributions settle immediately when the current player owns the paying character and the HQ Journal page. One Headquarters Journal holds one editable page per HQ (Stats & Improvements and Rent & Payments headings) plus an editable shared IP ledger. Container ownership remains unchanged during normal use. GM deletion sets `flags.pneuma-crewtools.inactive` on the HQ page and removes player visibility from that page and container. Inactive HQs are excluded from active discovery; records, contents and shared IP remain intact for manual cleanup. Receipt IDs prevent duplicate confirmation/refunds on retry. The queue serializes actions on one client only; cross-client simultaneous-payment coordination is intentionally not implemented.

## Module data maintenance

The Module Data manager reads native module documents directly. Versioned JSON backups contain CrewTools Journals, module Actor/Item flags, hustle tables, world settings and required folders. Exports support inspection and manual recovery; no import or restore operation is provided. Destructive operations use the primary GM queue, reject changed previews and report partial failures. See [Module Data maintenance](module-data.md).
