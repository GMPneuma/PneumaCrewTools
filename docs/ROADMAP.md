# Pneuma's Crew Tools — Roadmap

Updated: September 14, 2026

Player and crew bookkeeping for Cyberpunk RED on Foundry VTT v12. Foundry v13/v14 support remains pending compatible Cyberpunk RED releases and live verification.

**Status:** Implemented means present in the module, not verified in every live-world scenario. Deferred mechanics and live verification are tracked separately below.

## Project rules

- Compact, mostly native Foundry UI, with the payout forms as the styling reference. The corner date/HUD display is the deliberate styling exception.
- Track characters by Actor ID, with readable names. Shared owners use the same character records. One selected character per player is sufficient for payouts.
- Store character bookkeeping and shared HQ IP in standard Journals. Each HQ is a native Container Actor, with its properties, improvements and rent metadata on that Actor. Native money, HP, Humanity, Reputation and inventory remain authoritative on Actors/Items.
- Player-facing Journals belong in **CrewTools**; private/technical records belong in **CrewTools/CrewTools-GM**. Use matching Actor folders for module containers.
- Create character Journals when needed. Excluded Actors and upgrade-storage containers must not clutter character selectors.
- Keep Journal summaries compact and readable. Editing rendered text does not update structured records.
- Avoid unnecessary history panels, background refreshes and full-history calculations during play.
- No pre-release migration or preservation machinery unless requested. Do not add features solely to recover obsolete test data.

## Implemented

| Area | Current scope |
| --- | --- |
| Payouts | GM participant/reward/preview workflow; money, IP, items, Humanity, normal Reputation, faction reputation, HQ IP and downtime. Advance GameTime Days defaults primary downtime to days advanced minus one, minimum zero. Optional downtime for eligible nonparticipants defaults to days advanced; both awards remain editable. |
| Payout records | Detailed Payout Ledger, character receipts, acknowledgments and outstanding Humanity rolls. Attendance is a readable player-facing summary. Optional Discord text immediately after a payout. |
| Faction reputation | Known-faction dropdown with Add new; settings to add, rename or hide factions; stable faction IDs; current scores on each character's Faction Reputation Journal page. Normal Reputation still updates the sheet. |
| Player Hub | Current resources, native Money/IP/Reputation ledger buttons, residence and lifestyle, shared HQ IP, top two factions and days to next hustle. Resource actions sit below their respective boxes. Payout acknowledgments and inline Administer Pharma remain accessible here. |
| GM Hub | GM Action, Downtime and Headquarters sections. Initiate Payout, Modify GameTime Date, Mark Rent Due, Show Player Hub, expire/manage downtime, signed player downtime adjustments with reasons logged, Adjust Shared HQ IP and Manage Headquarters. Outstanding acknowledgments and rolls below the actions. |
| Calendar and HUD | Foundry game-time date with a two-line month/day and year display, configurable colors and a single attention icon. Icon opens the GM Hub for GMs and Player Hub for players. Date changes alone do not award downtime. Calendar controls are on the GM Hub, not in settings. |
| Downtime | Character Journal balances, payout awards, free-form spending, healing, activity allocation and GM expiration of unallocated days. Downtime Log and Active Projects pages. Owner actions work without a connected GM after required setup. |
| Healing | BODY-based healing, Enhanced Antibodies, available HQ medbay, antibiotics and cryotank options; HP updates; setting controlling antibiotic multiplication. |
| Hustle | Role RollTables with role icons, rank-based rewards, x/7 progress, Use 1 Day / Use X Days controls, role selection and native money-ledger payout. Optional whole-week spending. |
| TECH projects | Fabrication, notes-only upgrades and inventions; three project slots with Workshop/setting restrictions; downtime progress, native skill dialogs, failure costs and inventory delivery. Crafting month configurable from 28–31 days. |
| Medtech therapy | Patient and provider courses; therapy types, costs, material costs and DVs; PC treatment option; Humanity recovery; optional whole-week spending. Patient money is spent at therapy start; cancellation does not refund allocated downtime. |
| Medtech workday | Surgery and pharmaceutical task lists, native role checks with modifiers, sixteen-hour limit, pharmaceutical costs and dose delivery. Crafted pharmaceuticals increment the first matching inventory stack. Spend one day at any point while a day is available; unfinished tasks and unused hours are discarded. |
| Administer Pharma | Compact Medtech-only section with recipient selection, inventory quantities and one-dose Administer actions. Recipient chooses Use Now or Reject; Use Now adds the dose to inventory and invokes native consumption. No Keep option or selectable dose count. Journal-backed offers/responses work without a connected GM after required setup, with one Administer Pharma table per character. |
| Headquarters | Each HQ is its Container Actor, using its native name and image. Actor metadata stores description/location, bedrooms, maximum improvements, improvements and rent configuration. Clickable image opens the container; new HQs receive a default image. Shared HQ IP stays in a Journal. |
| HQ improvements | No Place Like Home catalog with short descriptions and 40 HQ IP default costs; settings support custom improvements with individual costs. Current improvements and levels appear beside purchasing controls. Existing Medbay/Workshop integration only; other effects remain deferred. |
| Rent and lifestyle | Supplied housing/lifestyle choices, character Journal selections and GM-customizable percentage modifiers. Mark Rent Due creates personal self-tasks and HQ rent bills. Players select and pay their current personal choices, while crew contributions settle shared HQ bills. Pending contributions and excess refunds reconcile through a GM; pending payment status appears in the Player Hub. |
| Settings | Grouped Module/Discord, Payout, Faction Reputation, HUD, Downtime, Crafting and Headquarters controls; Actor exclusions, appearance preferences and custom improvement management. Discord controls are GM-only. |
| Storage/performance | Consolidated character Journals, stored downtime balances, selective record access and module-specific refresh handling. Native resource changes retain relevant Journal records. |

See [Journal specifications](journals.md), [Data model](data-model.md), [Downtime](downtime.md), [TECH projects](tech-projects.md), [Medtech](medtech.md), [Headquarters](headquarters.md), [Rent & Lifestyle](rent.md) and [Calendar](calendar.md) for implementation details.

## Remaining feature work

### Discord output from historical payouts

- [ ] Select any recorded payout and generate Discord copy-and-paste text on demand.
- [ ] Use saved award details, recipients and context rather than current Actor balances.
- [ ] Allow repeated copying without reapplying rewards.

The current optional post-payout summary is already implemented.

## Deferred mechanics

These require a separate rules/design discussion before implementation.

### Headquarters

- [ ] Define and implement improvement requirements and effects beyond existing Workshop/Medbay integration.
- [ ] Extend project interactions for additional improvements where approved.

The catalog, costs, custom options, levels and Actor storage are implemented. The module uses a shared crew HQ IP pool; separate per-HQ pools are not assumed.

### TECH upgrades

- [ ] Add specific mechanical upgrade choices and effects; upgrades currently record notes.

Fabrication, invention, project progress, skill checks and inventory delivery are already implemented.

### Housing

- [ ] Consider Endurance-check and fatigue automation for applicable residence conditions, if requested.

Residence status is informational; automatic checks and penalties remain outside the implemented scope. Personal rent/lifestyle are self-tasks, not fixed bills. HQs generate outstanding bills when the GM marks rent due. No automatic monthly charges are implemented.

## Future Foundry versions

- [ ] Verify the calendar integration against supported native v13/v14 APIs.
- [ ] Verify application UI, Journal permissions, native rolls and inventory behavior with each compatible Cyberpunk RED release.
- [ ] Add version-specific changes only when those combinations can be tested.

## Verification and release

- [ ] Run an integrated live-world pass as both GM and player, including owner actions without a connected GM.
- [ ] Verify payouts, game-time advancement, acknowledgments, faction reputation, downtime, TECH, Medtech and HQ workflows together.
- [ ] Verify Pharma Use Now/Reject, native consumption, rejection returns and interruption/repeated-action behavior across player clients.
- [ ] Verify HQ Container ownership and player access in live Foundry.
- [ ] Verify personal rent/lifestyle tasks, HQ billing, pending contributions, GM reconciliation and excess refunds in a live world.
- [ ] Check cross-document inventory/resource operations for interruption and repeated-action behavior.
- [ ] Confirm Journals remain understandable with the module disabled, and routine use does not produce unnecessary records or background work.
- [ ] Align remaining documentation, changelog, manifest and package contents before the next requested release.

Live verification is a separate gate from implemented features. Deferred mechanics are not required to complete the currently agreed Pharma scope.
