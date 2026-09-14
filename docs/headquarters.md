# Headquarters

Open **GM Dashboard → Headquarters** or **Player Hub → View Headquarters**.

## Management

- Multiple HQs with native Container name/image and Journal-backed description/location.
- Create a container or designate an existing one as an HQ. New containers live in Actors / CrewTools and retain native inventory sheets.
- The primary connected GM creates HQs and manages corrections and rent configuration. Players can buy improvements and pay rent without a connected GM.
- New containers have Observer access for players. Existing container permissions and inventory are preserved.
- HQ names and images are the native Actor names and images. HQ containers are not player-character payout recipients.
- The viewer is resizable and scrolls. Management panels are collapsible; transaction history stays in the Journal.

## Improvements and IP

HQs spend from one shared crew IP pool. Payouts credit it once per payout ID. GM Dashboard → Adjust Shared HQ IP accepts a signed adjustment with a reason. Balances cannot become negative.

Buy Improvement accepts a name, whole-number IP cost, notes, and an explicit effect:

| Effect     | Behavior                                                             |
| ---------- | -------------------------------------------------------------------- |
| Notes only | Descriptive improvement; no automatic mechanics.                     |
| Medbay     | Enables the downtime medbay checkbox: +2 effective BODY for healing. |
| Workshop   | Enables all three TECH project slots.                                |

Effects survive renaming. Improvements without an explicit effect still recognize Medbay/Workshop names. Explicit Notes only grants no automatic benefit.

A GM can edit name, notes, and effect after purchase; original cost/date remain. Removal requires confirmation, removes the benefit, and does not refund HQ IP. Use a separate IP adjustment for a deliberate correction. Existing projects are not deleted when Workshop access changes.

Costs are GM-defined; no unsupplied prices or additional mechanics are assumed. Zero-cost improvements support GM grants. Purchases and corrections use the local action queue. Failed Journal writes leave prior balances and improvements intact.

## Shared rent

The viewer shows configured monthly rent, unpaid bills, confirmed payment progress, and remaining balance. Configure Rent uses housing rates and percentage modifiers from Rent & Lifestyle settings. Changes affect future bills.

Rent & Contributions opens the existing payment screen. Eligible crew characters may contribute regardless of residence. Payments are recorded in character Journals and immediately applied to the editable HQ page. Excess is refunded. Interrupted payments remain recoverable; restricted HQ page access leaves them pending. Billed HQs cannot be relinked. See [Rent](rent.md).

## Storage

One **Headquarters** Journal contains the **Shared HQ IP** ledger and one page per HQ, named after its Container. Each HQ page has **Stats & Improvements** and **Rent & Payments** headings. The parent Journal is Observer; HQ pages and the shared IP page grant players Owner access. This deliberately allows full page editing, including stats.

HQ pages store the Container ID in flags.pneuma-crewtools.hqActorId, properties in flags.pneuma-crewtools.properties, and rent in flags.pneuma-crewtools.rent. The shared IP page stores its balance and transactions in flags.pneuma-crewtools.headquarters. Native Container names, images, inventory, permissions and Stash settings remain on Actors. Editing rendered Journal text does not change structured module records.

On GM initialization, previous Actor metadata and legacy HQ roster entries transfer to HQ pages before the old copies are removed. Failed page creation preserves the source records for retry. Missing Containers block conversion. Container ownership is unchanged.

## Validation

Tests cover management, effects, IP corrections/overspending, failed saves, ownership, billed-container links, and actual GM/player form data. Headless Edge checks use real templates and module CSS with mocked Foundry base styles. Live-world testing remains necessary.

## HQ properties and catalog

Properties are edited alongside the clickable Container image. Bedrooms and an optional maximum improvement count are stored with description/improvements on the HQ Journal page; rent type, modifier, and existing bills also live on that page. A blank capacity means no limit.

The built-in catalog uses the twelve No Place Like Home improvements (pages 3–6), with short summaries and 40 HQ IP costs. Buying the same catalog entry increases its recorded level. Capacity counts distinct improvements. No new benefit mechanics or upgrade eligibility rules are automated; existing Medbay and Workshop presence checks remain.

Settings → Headquarters → Manage Custom Improvements adds short named entries with any non-negative whole HQ IP cost, and permits editing custom costs or removing catalog options. Existing purchased entries remain intact. Custom definitions live in the HQ Improvements Journal, not on character Actors.
