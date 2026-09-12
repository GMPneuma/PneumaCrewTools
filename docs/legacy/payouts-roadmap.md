# Pneuma's Payouts Roadmap

## Goal

Give a GM one window for selecting session participants, distributing Cyberpunk
RED rewards, and retaining a useful record of each payout.

## Recommended execution order

The order below accounts for both difficulty and dependencies. A later item may
be mechanically easy but appears later because it relies on the shared payout
and persistence layers.

Status key: `[x]` complete, `[~]` usable but incomplete, `[ ]` not implemented,
`[-]` intentionally not planned.

### Milestone 1: Foundation

- [x] **1. Define payout records and module storage** — Easy
  - Establish one data shape for a payout event.
  - Record timestamp, GM, session label, notes, selected players/Actors, and all
    applied changes.
  - Decide which data belongs in world settings, Actor flags, or a journal.
- [x] **2. Discover player accounts and associated Actors** — Easy
  - Read non-GM users, their assigned Actor, and all owned character Actors.
  - Handle players with no assigned Actor and Actors shared by multiple users.
  - Present active/inactive status without excluding offline players.
- [x] **3. Build the GM payout window and participant selector** — Easy–Medium
  - Open from an appropriate Foundry control or settings button.
  - Select attendees and default sensibly from active users.
  - Restrict payout execution to GMs.
- [x] **4. Add validation, preview, and transactional execution** — Medium
  - Show exactly what will change before applying a payout.
  - Reject invalid amounts and missing/unsupported Actors.
  - Avoid partial payouts when an update fails.
  - Prevent accidental double submission.

### Milestone 2: Core character payouts

- [x] **5. Primary Money and IP payouts** — Medium
  - Give every selected character the same Money and/or IP adjustment.
  - Support positive, zero, and intentionally negative adjustments where valid.
- [x] **6. Primary Humanity Gain and Humanity Loss** — Medium
  - Expose gain and loss as clear, separate inputs.
  - Apply the Cyberpunk RED system's Humanity rules and limits correctly.
- [x] **7. Additional individual payouts in the same window** — Medium–Hard
  - Add per-character overrides or bonuses alongside group values.
  - Support Money, IP, Humanity Gain, Humanity Loss, and Reputation.
  - Preview the combined group and individual result for each character.
- [x] **8. Standard Reputation payouts** — Medium
  - Apply character Reputation changes through the individual payout section.
  - Include the old value, adjustment, and new value in the payout record.

### Milestone 3: Shared and persistent rewards

- [x] **9. Communal Money payout to a Container Actor** — Medium
  - Configure a Default Payout Container in module settings without
    automatically creating an Actor.
  - Override the Payout Container for an individual payout.
  - Require a valid Cyberpunk RED Container Actor when Communal Money or Items
    are present.
  - Apply and record Communal Money with Preview, Discord, ledger, Payout Log,
    and transactional rollback support.
- [x] **10. Attendance and sessions-played tally** — Medium–Hard
  - Derive attendance from the selected payout participants.
  - Maintain an ongoing per-player sessions-played total.
  - Record the most recent session name for each player.
  - Store attendance by Foundry player account rather than Actor.
- [x] **11. HQ IP pool** — Medium–Hard
  - Maintain HQ IP at the world/group level instead of on a character.
  - Record gains from Communal Payouts in the editable HQ journal.
  - Allow GM-entered negative spending adjustments.
  - Display a recalculated Current HQ IP total on the HQ journal page.
  - Manual journal rows remain the intended spending workflow because HQ IP
    spending is infrequent.
- [x] **12. Faction-specific Reputation journal** — Hard
  - Track faction Reputation separately from normal Actor Reputation.
  - Write structured Actor, Reputation, Faction, and Reason rows to the Payouts
    journal.
  - Replace the current value when the same Actor and faction receive another
    Specific Reputation payout.
  - Factions intentionally remain free-text because a campaign may use dozens
    or hundreds of them; managed faction definitions are not planned.

### Milestone 4: Completion and safety

- [x] **13. Payout history log** — Medium
  - Every completed payout receives a permanent page in the GM-only Payout Log
    journal.
  - The internal versioned payout ledger retains structured records.
  - The journal is intentionally a reference-only log; a separate history
    browser, filtering UI, and payout-history editor are not required.
- [-] **14. Automated Foundry integration tests** — Hard
  - Stored payout records are versioned and legacy journal markup has targeted
    migration handling.
  - Type checking, production builds, formatting, and package validation remain
    part of the release process.
  - A containerized Foundry v12 browser-test environment is intentionally not
    planned because it would require maintaining a licensed Foundry installation,
    Docker, and test-world data outside the normal hosted game environment.

### Milestone 5: Player communication and external summaries

- [x] **15. Persistent player Payout Inbox** — Medium
  - Show each player all Primary and individual rewards that apply to them.
  - Track acknowledgment separately for each payout and remove acknowledged
    items from the active Inbox.
  - Keep multiple Humanity rolls independently identifiable and actionable.
  - Allow GMs to review pending actions while requiring an explicit opt-in
    before rolling or acknowledging on a player's behalf.
- [x] **16. Player-controlled Humanity rolls** — Medium–Hard
  - Create targeted chat prompts and persistent Inbox actions for fixed payout
    roll formulas from 1d6 through 4d6.
  - Apply the result to Humanity and EMP exactly once.
- [x] **17. Discord-compatible payout summary** — Medium
  - Put Communal and Primary awards first and individual rewards afterward.
  - Support Discord User IDs, per-player Role IDs, and a whole-crew Role ID.
  - Allow the Discord output dialog to be disabled in module settings.
- [x] **18. Self-maintaining Foundry journals** — Medium
  - Create module-owned Payouts and Payout Log journals without adopting
    unrelated journals that share those names.
  - Give GMs ownership of both journals, players read-only access to Payouts,
    and no player access to Payout Log.

### Milestone 6: Inventory payouts

- [x] **19. Item document payouts** — Medium–Hard
  - Accept any Foundry Item document in Communal and individual payouts only,
    including compendium, world-directory, custom, and embedded Items.
  - Deliver individual Items to the selected Actor with transactional rollback.
    Stackable Cyberpunk RED Items use one correctly sized `system.amount` stack;
    non-stackable Items use separate copies when quantity is greater than one.
  - Include item names, quantities, descriptions, and source UUIDs in
    Preview, Inbox, Discord output, the structured ledger, and Payout Log.
  - Deliver Communal Items to the selected Payout Container.
  - New stacks remain distinct rather than merging into matching owned Items.
    Additional exhaustive Item-type edge-case testing is not planned.
- [x] **20. Display-only Primary Downtime payouts** — Easy
  - Keep Downtime visible alongside Primary Money and IP with a day count and
    description.
  - Include Downtime in Preview, recipient acknowledgments, Discord Markdown,
    the structured ledger, and Payout Log without modifying Actors or the
    Payouts journal.

## Current release state

Version `1.0.0` provides the complete intended payout workflow: character and
communal rewards, attendance, HQ IP, faction Reputation, Item delivery, player
acknowledgment and Humanity rolls, Discord summaries, and audit journals.
It also supports the Cyberpunk RED system's light and dark themes and remains
compatible with Foundry installations served without a secure browser context.
The version 1.0 compatibility baseline is Foundry v12, the Cyberpunk RED Core
system, and payout record schema version 1. Optional No Place Like Home
integration is guarded by version and data validation.
Correction/reversal workflows, managed faction definitions, exhaustive Item
edge-case testing, and containerized Foundry integration tests are intentionally
out of scope for this friendly-game module.

## Next recommended work

1. Maintain the stable version 1.0 payout workflow and address defects found
   during normal campaign use.
2. Plan larger features as backward-compatible 1.x additions where possible.
3. Revisit Foundry compatibility when Cyberpunk RED supports a newer core
   version; reserve 2.0 for changes that break stored data or the public API.

## Decisions to make while implementing

- Whether negative Money/IP values are permitted or must use a separate spending
  workflow.
- Whether future Foundry versions provide useful native calendar integration.

## Resolved design decisions

- Each selected player can have only one Actor in a payout; shared Actor IDs are
  deduplicated.
- Attendance is keyed by Foundry player account, not Actor.
- Session Name is required; In-Game Date and Notes are retained with the payout.
- The most recently entered In-Game Date becomes the next payout's default.
- Humanity dice are rolled by the owning player rather than by the GM by default.
- Module journals are identified by stored IDs and are never adopted by name.
- HQ spending remains a manually entered journal adjustment.
- Factions remain free-text and payout corrections are handled pragmatically by
  the GM rather than through a dedicated reversal workflow.
- A local/containerized Foundry integration-test environment is not maintained.
- Foundry v12 remains the supported target while Cyberpunk RED requires it. A
  future v13 migration may use Foundry's world calendar APIs when available; the
  module will not build a custom calendar UI.
