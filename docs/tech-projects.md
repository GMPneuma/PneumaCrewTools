# TECH crafting projects

Spend Downtime shows three project slots only for characters with a ranked **Tech / Maker** role. Slot one is always enabled. An HQ improvement named **Workshop** (or **Workshop add-on**) enables all three, as does the world setting **Allow multiple projects even without Workshop**. Losing access disables progress and rolls in slots two and three; cancellation remains available.

The character selector and available downtime balance share one compact header row.

## Creating a project

- **Fabricate Item:** choose the mode and drop a readable compendium Item. Completion copies the current compendium specification; the template stays where it is.
- **Upgrade Item:** drop an owned Item from the selected character’s inventory. The original stays in place as **Name (being upgraded)**. A reference Item appears in **Actors → CrewTools → Upgrade Projects — Character Name**. Ordinary stacks split into one marked original and an unmarked remainder. Installed stacks or stacks with installed contents must be split using the native character sheet first.
- **Invention:** choose the mode and click **Create**. Enter a name, description, cost category and TECH skill. Completion creates a normal **Gear** Item in that character's inventory.

The setup dialog requires an explicit Item Skill selection: Basic Tech, Cybertech, Air Vehicle Tech, Land Vehicle Tech, Sea Vehicle Tech, Weaponstech, or Electronics/Security Tech. The selected character skill is retained with the project. Fabrication, Upgrade, and Invention add their matching Expertise and exclude native Field Expertise; repairs retain native Field Expertise without adding it twice. Upgrade notes are recorded in the Journal and appended to the original item's current description on completion. No specific mechanical upgrades are applied yet. Fabrication and upgrades use the source item's native **system.price.market** value to determine category and duration; changing a request's price cannot make a source item cheaper.

Upgrade and repair never transfer, uninstall or recreate the original Item or its installed contents. Original and child UUIDs stay intact. The container reference is plain Gear with the original’s name/image and a UUID link; it has no installed-item links, equipment statistics or market value. Its **flags.pneuma-crewtools.techProjectReference** identifies the project and source UUID. The container is an ordinary Cyberpunk RED container Actor with the character’s current owners; permissions and its name are synchronized during GM setup and ownership changes.

## Timing and checks

| Category       |      Value |                                       Days |  DV |
| -------------- | ---------: | -----------------------------------------: | --: |
| Premium        |     100 eb |                                          1 |  17 |
| Expensive      |     500 eb |                                          7 |  21 |
| Very Expensive |   1,000 eb |                                         14 |  24 |
| Luxury         |   5,000 eb |                       One configured month |  29 |
| Super Luxury   | 10,000+ eb | Configured month × ceiling(value / 10,000) |  29 |

**TECH crafting days per month** is a world setting, default **28**, accepting whole numbers from 28–31. Each new project stores the setting and calculated duration at creation. Existing schedules do not shift if the setting changes. Below-Premium work must use free-form downtime.

**+** spends one of that Actor's available downtime days and adds it to the project. Calendar movement does not add progress. Allocated project days survive session boundaries.

**Roll skill** becomes available after floor(required days / 2) days of progress. The acting character owner executes the selected native TECH skill roll, including the system's modifiers and critical dice, and adds the matching Maker specialty: Fabrication Expertise, Upgrade Expertise or Invention Expertise. Success requires a total greater than the DV.

- Success is stored. The item completes once all required days have been allocated, whether those days were added before or after the successful check.
- Failure burns floor(required days / 2) from project progress. The Actor must allocate that many **new** days before another check, even if enough older progress remains.
- Premium's halfway threshold and failure loss are both zero under the requested rounding rule. It can be checked immediately, but still needs one allocated day to complete.
- Fabrication and invention completion add one Item to the character’s inventory. Upgrade and repair completion update the original, restore its name and delete the container reference. All completions clear the active slot. A deliberate rename during work is preserved.
- Cancel closes the project without refunding spent days. Upgrade and repair restore the original’s name and delete the reference without applying pending changes. Cancellation stays available after losing the role or facility.

No material costs are charged automatically. Inventions produce inventory Items as requested, rather than a separate blueprint-only step.

## Journal format and purpose

Each **CrewTools / Crew Tools — Character Name / Active Projects** page stores active and completed projects. All fields are rendered as readable text, including source references and project descriptions.

Every project uses the common activity format: **id, actorId, name, kind: tech, status, startedAt, completedAt, progress, details, events**. Progress gives value, required days and unit. Details identify mode and slot. Each event retains ID, date, action and explanation. Its **data.event** holds the typed TECH event:

- **techStart** event data contains **tech**: mode, slot, source UUID, name, description, category, price, skill ID, required days, DV, month days, Item metadata, original name and reference Actor/Item IDs.
- **techDay** links to a one-day Resource Transaction using the same event ID.
- **techRoll** data contains **techCheck**: total, DV, success, burned days, skill and Maker specialty.
- **techDelivery** data identifies the destination Actor and Item.
- **techCancel** closes the activity without refunding spent days.

The Downtime Log page holds charges and linking IDs, without another copy of project specifications/checks/deliveries. Project progress is calculated directly from Active Projects; resource events are never joined into or split out of project records. Names are labels; Actor and Item IDs determine identity. Completed and cancelled projects keep their structured events.

Character Actors receive native inventory Items, not project flags. The holding container's **flags.pneuma-crewtools.upgradeProjectsFor** links it to its character. Actor folders follow **CrewTools / CrewTools-GM**. Setup commands are processed directly without permanent request pages.

Before marking, updating or delivering an Item, the acting owner records **flags.pneuma-crewtools.techAttempt** on the ledger: request/project IDs, action, source UUID and predetermined reference/destination Actor/Item IDs. Stack starts also record the original quantity and remainder Item ID. The page displays these details and reconciliation instructions. A failed or uncertain Item change retains this guard and stops automatic TECH processing until the GM reviews the listed Items. Accepted request IDs prevent repeating a delivery. These are transaction records, not migration or hidden backup artifacts.

### Clearing an interrupted TECH blocker

The **GM Dashboard → Downtime** section also has an always-visible **Review / Clear TECH Blocker** button. It is disabled when no eligible character has a blocker. With one affected character it opens their review directly; with several it prompts for the character.

In GM **Downtime**, select the affected character and click **Review / Clear TECH Blocker** below the character selector. The button is always visible to GMs and greyed out when the selected character has no saved TECH blocker. Review the saved details, linked original/source Item, project reference or destination Item, any stack remainder, and **Active Projects**. Correct partial changes before enabling another attempt. **Open Downtime Log** opens the character's ledger.

Enter a review note, confirm that the Items and project records were reconciled, then click **Clear TECH Blocker**. The first active GM can clear it. Clearing removes only the blocker; it does not undo Item changes, refund days, complete a project, or fix the original failure. The exact attempt, GM identity, timestamp and note remain in **TECH recovery history** on the Downtime Log. Existing blockers are supported. Competing TECH work is serialized with recovery; a changed blocker requires a new review.

## Validation and compatibility

Tests cover category durations, month settings, locked slots, progress/retry rules, completion, single-item copying and stack splitting, upgrade notes, cancellation, permissions, failed delivery guards, and immediate owner processing without a connected GM. Browser previews use actual templates/CSS with mocked Foundry services. Live Foundry testing remains required.

The native adapter was checked against the official Cyberpunk RED Core v0.92.4 [skill Item implementation](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/modules/item/types/cpr-skill.js), [roll implementation](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/modules/rolls/cpr-rolls.js), and [Item export/transfer implementation](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/modules/item/cpr-item.js). System-specific calls are isolated in tech-projects.ts for future adapters.

A connected GM automatically prepares reference containers for eligible player-owned characters with a ranked TECH/Maker or Netrunner role, or an eligible repair skill. Role and skill changes trigger preparation. Other Actors receive no container. Holding containers are automatically excluded from all Crew Tools player selectors and the Hide Player Actors list. Subsequent player upgrades and repairs use that existing container and native ownership permissions without requiring a GM connection. Source Items still require the appropriate permission. No old shared-ledger balances are imported; see [the downtime storage specification](downtime.md).

The project Cancel button asks for confirmation, warns that allocated days will not be refunded, and defaults to **Keep Project**. Closing the confirmation also keeps the project. Upgrade and repair cancellation restore the original name and remove the reference without applying pending changes.

Skill checks open the native roll dialog for modifiers. Cancelling leaves the activity unchanged and does not roll or charge resources.

## Repairs and Workshop allocation

Non-TECH characters have one Repair Gear slot. TECHs select Repair in their project slots. Premium and higher items use fabrication schedules and the same progress/check workflow; hourly repairs remain in Other Activity. Repair operates on the original owned inventory Item, named **Name (being repaired)** during work, with a reference in the project container. Armor completion clears native body/head ablation or restores shield HP. Other gear receives a completion record; no generic damage flags are invented. Repairs use the native skill dialog and native role modifiers, including Field Expertise where configured by the system.

Settings → Crafting → Configure Armor Repair Times provides optional whole-day overrides by actual item price category, with a TECH-only switch. Defaults are disabled and blank; durations are fixed when the project starts. Super Luxury overrides are flat days for that category.

Workshop I supports two slots; Workshop II or above supports three. Without a Workshop the existing multiple-project setting still permits three independently funded slots. With a Workshop, Apply 1 day to all projects replaces individual day buttons and advances each enabled active project that still needs time for a single downtime-day charge. This Journal update is atomic at the character-state service boundary. A passed project reaching full progress this way exposes Complete Project for its Item update; completion costs no additional day.

The shared techWorkshop transaction carries the single day charge; per-project techDay activity entries carry the credited progress. techFinish records completion without another charge.

## Netrunner projects

A ranked Netrunner / Interface role adds **Craft Cyberdecks, Programs and Hardware**, with one independent project slot. An HQ Server Room at level II or above enables it. All four actions use the TECH schedules, progress, retry and delivery workflow, but always roll the character’s native Electronics/Security Tech skill without adding Maker expertise or Interface. Workshop batching and the multiple-project setting do not affect this slot.

Fabricate, Upgrade and Repair accept native Cyberdeck, Program and cyberdeck Item Upgrade documents (hardware). Invention creates the same descriptive blueprint Item as TECH invention; the GM defines the resulting cyberdeck, program or hardware. Repair keeps the original Item and records completion; system-specific repairs remain manual. Premium minimum prices and the existing crafting month setting still apply.

The Server Room and skill are checked when starting or advancing work. Cancellation remains available after losing the room or role, restoring original names and removing references without refunding days. GM setup also prepares Upgrade Projects containers for Netrunners.

Active Projects retains the existing tech lifecycle with optional **track: netrunner** on its starting specification. Older projects with no track remain ordinary TECH/repair projects. The track separates slot occupancy and Workshop progress without duplicating Journal records.

The Player Hub reads all embedded Cyberdeck Items and opens their native sheets. Equipment clicks call the native character sheet equipment handler, preserving the one-equipped-deck restriction and installed-item propagation. Program and upgrade buttons call the native Item sheet managers with their stock icons.
