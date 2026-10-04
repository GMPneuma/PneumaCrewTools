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
| Workshop   | Enables two TECH project slots; the upgrade enables three.           |

Effects survive renaming. Improvements without an explicit effect still recognize Medbay/Workshop names. The effect selector controls optional Medbay/Workshop effects. Stock benefits such as Morale Boost and Training Area are identified by their catalog entry independently.

A GM can edit name, notes, and effect after purchase; original cost/date remain. Removal requires confirmation, removes the benefit, and does not refund HQ IP. Use a separate IP adjustment for a deliberate correction. Existing projects are not deleted when Workshop access changes.

Costs are GM-defined; no unsupplied prices or additional mechanics are assumed. Zero-cost improvements support GM grants. Purchases and corrections use the local action queue. Failed Journal writes leave prior balances and improvements intact.

## Shared rent

The viewer shows configured monthly rent, unpaid bills, payment progress, and remaining balance. Configure Rent uses housing rates and percentage modifiers from Rent & Lifestyle settings. Changes affect future bills.

Rent & Contributions opens the existing payment screen. Eligible crew characters may contribute regardless of residence. Payments are recorded in character Journals and immediately applied to the editable HQ page. Excess is refunded. Interrupted payments remain recoverable; restricted HQ page access leaves them pending. Billed HQs cannot be relinked. See [Rent](rent.md).

## Storage

One **Headquarters** Journal contains the **Shared HQ IP** ledger and one page per HQ, named after its Container. Each HQ page has **Stats & Improvements** and **Rent & Payments** headings. The parent Journal is Observer; HQ pages and the shared IP page grant players Owner access. This deliberately allows full page editing, including stats.

HQ pages store the Container ID in flags.pneuma-crewtools.hqActorId, properties in flags.pneuma-crewtools.properties, and rent in flags.pneuma-crewtools.rent. The shared IP page stores its balance and transactions in flags.pneuma-crewtools.headquarters. Native Container names, images, inventory, permissions and Stash settings remain on Actors. Editing rendered Journal text does not change structured module records.

On GM initialization, previous Actor metadata and legacy HQ roster entries transfer to HQ pages before the old copies are removed. Failed page creation preserves the source records for retry. Missing Containers block conversion. Container ownership is unchanged.

## Validation

Tests cover management, effects, IP corrections/overspending, failed saves, ownership, billed-container links, and actual GM/player form data. Headless Edge checks use real templates and module CSS with mocked Foundry base styles. Live-world testing remains necessary.

## HQ properties and catalog

Properties are edited alongside the clickable Container image. Bedrooms and an optional maximum improvement count are stored with description/improvements on the HQ Journal page; rent type, modifier, and existing bills also live on that page. A blank capacity means no limit.

The built-in catalog uses the twelve No Place Like Home improvements (pages 3–6), with short summaries and 40 HQ IP costs. Buying the same catalog entry increases its recorded level. Capacity counts distinct improvements. Stock improvements permit a base purchase and one upgrade, except Morale Boost (ten upgrades) and Rent Reduction (one extra bed per upgrade, capped at the original bed count). Custom improvement limits remain configurable.

Settings → Headquarters → Manage Custom Improvements adds short named entries with any non-negative whole HQ IP cost, and permits editing custom costs or removing catalog options. Existing purchased entries remain intact. Custom definitions live in the HQ Improvements Journal, not on character Actors.

## Removing an HQ

The primary GM can select **Delete HQ** and confirm **Mark Inactive**. This hides the HQ's container and Journal page from players and removes it from HQ choices, new rent billing and facility benefits. Contents, payment history and shared HQ IP are preserved; no IP is refunded.

Inactive HQs remain listed for the GM. To finish removal, manually delete that HQ's page from the shared Headquarters Journal and its container Actor. Keep the Headquarters Journal itself and its Shared HQ IP page. Residents should choose a new active residence. Existing payment records are retained.

## Player visibility and facility access

Players need Observer or Owner access to both the HQ container and its HQ Journal page. Removing access to either hides that HQ from their Crew Tools lists and excludes its Garage, Workshop, Server Room and Medbay benefits. Native inherited and per-user permissions apply. GMs can still see active HQs regardless of player permissions; inactive HQs remain excluded.

**Player Access** grants selected players Observer access to the container and Owner access to its HQ Journal page, allowing improvement purchases and rent contributions. **Everyone** applies these levels as defaults. The shared HQ IP page also requires Owner access for purchases. GM setup repairs older HQ page Observer grants once, preserving excluded players; subsequent manual native permission changes remain in effect.

## Automated stock benefits

- **Morale Boost:** Player Hub adds **Moral Boost** below View HQ. The screen lists active benefits from accessible HQs. Upgrade 2 adds +1 effective BODY to natural healing, stacking with Medbay. Upgrade 6 rolls Hustle twice and keeps the higher income (ties keep the first); upgrade 8 pays both incomes. Both outcomes are recorded, but only one week is consumed. Lifestyle, monthly Humanity, LUCK, negotiation and the GM-designed benefit are references only. Base purchase is level 1, so upgrade 2 is level 3.
- **Rent Reduction:** New HQ bills use the next cheaper paid housing category; Cube Hotel becomes 100 eb. Free housing remains free. Existing bills keep their amounts. Each upgrade adds a bed without raising rent, up to twice the original capacity. Removing the improvement removes its added beds. Legacy upgrades gain their bed benefits when read; the original capacity is preserved on the next save.
- **Training Area:** Spend seven days in Spend Downtime to gain a native +1 Active Effect for one eligible skill. Upgraded Training Areas allow Solos two distinct skills. Training replaces the previous bonus; a positive Group IP award through Crew Tools disables it. Individual IP and downtime-session changes do not expire it. For Group IP awarded outside Crew Tools, disable the HQ Training effect on the actor manually. Both native skill and weapon rolls consume the modifier.
- **Garage:** Respec requires the upgrade. All linked Nomad vehicles must be accessible with full HP. Link every vehicle in the Player Hub and resolve any faults not represented by HP before respec. Vehicle choices and untracked operational faults remain manual.
- **Server Room:** The primary GM creates one native NET Architecture Item under the CrewTools Item folder. Both HQ views link to it. Architecture design remains editable in its native sheet. Player read access follows HQ access; removing the improvement or deactivating the HQ revokes generated player access without deleting the Item. If no GM is online, creation waits until a GM connects. Existing architecture contents are preserved.

Studio, Workstation, Evidence Wall, Lounge and Lockup remain catalog references. Medbay keeps its existing healing support; no extra medical automation was added. Workshop behavior remains unchanged.
