# CrewTools backlog

Updated: 2026-09-29

Edit each **Status** directly. Priorities are initial suggestions, not an agreed work order.

**Priority:** High = address next; Medium = useful, can wait; Low = optional improvement.  
**Status:** Idea = needs discussion; Ready = defined and available to pick up; In progress = work started; Blocked = cannot proceed; Done = completion criteria met; Dropped = no longer planned.

Keep IDs permanent. Add new items by copying an entry. Move finished or dropped items to the bottom and record a date and outcome. Listing work does not authorize implementation. Live verification means checking the actual Foundry world; automated checks alone do not satisfy it.

This is the editable work list. [Detailed roadmap](docs/ROADMAP.md) and [integration history](ROADMAP.md) preserve prior decisions. The package is 0.9.4; older roadmap version labels and release targets are historical. Open payment items below require reconfirmation against current code before treating them as defects.

## Open items

### BL-001 — Recheck HQ payment permission failures

**Priority:** High  
**Status:** Ready

**Problem:** The older roadmap lists deductions that may not be settleable because of Journal permissions.

**Desired result:** Establish whether this still occurs, then fix any reproduced failure.

**Done when:**

- [ ] Reproduce with player ownership and HQ Journal permissions explicitly recorded.
- [ ] If confirmed, prevent an unrecoverable deduction and verify normal contributions still settle.

**Notes:** docs/ROADMAP.md: Payment recovery. Current rent docs describe automatic settlement and reconciliation; do not assume those solve every permission case.

### BL-002 — Recheck interrupted HQ payments

**Priority:** High  
**Status:** Ready

**Problem:** The roadmap lists missing HQ/bill references and interrupted money/Journal writes as incomplete recovery cases.

**Desired result:** Resolve confirmed cases without duplicate charges, credits or refunds.

**Done when:**

- [ ] Inspect money and saved receipts before retrying.
- [ ] Test missing references and interruptions around each write.
- [ ] For any confirmed failure, verify recovery or a clear manual resolution without replaying payment.

**Notes:** docs/ROADMAP.md: Payment recovery; docs/rent.md. Resolve Payment Issue currently clears a block without changing balances.

### BL-003 — Verify shared workflows in a live world

**Priority:** High  
**Status:** Ready

**Problem:** Automated checks do not cover actual multi-user Foundry operation.

**Desired result:** Record a GM/player integration pass.

**Done when:**

- [ ] Verify payouts, time advancement, acknowledgments, factions, downtime, TECH, Medtech and HQ workflows together.
- [ ] Verify owner actions without a connected GM after setup and HQ Container access.
- [ ] Verify personal rent, contributions, reconciliation and excess refunds.
- [ ] Verify Pharma Use Now/Reject, consumption, returns and repeated/interrupted actions.
- [ ] Check interrupted inventory/resource operations and readable Journals with the module disabled.
- [ ] Check the optional Combat Tools HUD shortcut and standalone fallback.

**Notes:** Both roadmap files retain live verification as an open gate.

### BL-004 — Compact protected history safely

**Priority:** Low  
**Status:** Idea

**Problem:** Some downtime, HQ IP and billing history cannot be purged without changing balances or retry protection.

**Desired result:** Define compaction only if broader retention is needed.

**Done when:**

- [ ] Agree which history needs compaction.
- [ ] Preserve balances, pending work and duplicate-action protection in an approved design.

**Notes:** docs/ROADMAP.md: Cleanup limitations and proposals.

### BL-005 — Allow cleanup while players are connected

**Priority:** Low  
**Status:** Idea

**Problem:** Current cleanup requires the GM to be the only connected user.

**Desired result:** Decide whether safe coordination with ordinary saves is worth adding.

**Done when:**

- [ ] Define how cleanup and player saves avoid overwriting each other.
- [ ] If approved, verify concurrent saves and cleanup preserve records.

**Notes:** docs/ROADMAP.md; no replacement coordination design approved.

### BL-006 — Decide whether unfinished handoffs expire

**Priority:** Low  
**Status:** Idea

**Problem:** Retention deliberately keeps pending work indefinitely.

**Desired result:** Agree whether pending handoffs should expire and how resources are returned.

**Done when:**

- [ ] Define age/quantity rules or record the decision to keep pending work.
- [ ] Account for withdrawn doses and incomplete refunds before any cancellation.

**Notes:** docs/ROADMAP.md: Cleanup limitations and proposals.

### BL-007 — Define additional HQ improvement effects

**Priority:** Medium  
**Status:** Idea

**Problem:** The catalog exists, but effects beyond Workshop, Medbay, Garage and Server Room II remain deferred.

**Desired result:** Specify additional requirements, effects and project interactions.

**Done when:**

- [ ] Choose the improvements to support and write their exact behavior.
- [ ] If implementation is approved, verify each effect and interaction.

**Notes:** docs/ROADMAP.md: Headquarters. Preserve the shared crew HQ IP pool.

### BL-008 — Define mechanical TECH upgrades

**Priority:** Medium  
**Status:** Idea

**Problem:** Upgrades currently record notes rather than applying specific mechanical choices.

**Desired result:** Agree supported upgrade choices and their effects.

**Done when:**

- [ ] Define upgrade options, restrictions and resulting changes.
- [ ] If approved, verify native item changes and existing project progress/delivery.

**Notes:** docs/ROADMAP.md: TECH upgrades; fabrication and invention already exist.

### BL-009 — Decide housing fatigue automation

**Priority:** Low  
**Status:** Idea

**Problem:** Automatic residence Endurance checks and fatigue penalties remain deferred.

**Desired result:** Decide whether to add automation beyond the native Endurance shortcut.

**Done when:**

- [ ] Agree applicable conditions, checks and penalties, or record a decision to keep them manual.

**Notes:** docs/ROADMAP.md: Housing. No automatic monthly charges are implied.

### BL-010 — Evaluate later Foundry versions

**Priority:** Low  
**Status:** Blocked

**Problem:** The project targets Foundry v12; later-version compatibility is not verified.

**Desired result:** Support additional versions only after testing compatible Cyberpunk RED combinations.

**Done when:**

- [ ] Identify a compatible system/version combination and test calendar APIs.
- [ ] Verify UI, Journal permissions, native rolls and inventory behavior.
- [ ] Make necessary compatibility changes and document tested versions.

**Notes:** docs/ROADMAP.md: Future Foundry versions. Blocked until compatible test environments are available.

### BL-011 — Decide the low-EMP visual Easter egg

**Priority:** Low  
**Status:** Idea

**Problem:** The roadmap defers dramatic Hub effects to a possible 1.0 Easter egg.

**Desired result:** Decide whether and how to add the optional visual behavior.

**Done when:**

- [ ] Define the visual behavior and when it appears, or mark the idea Dropped.

**Notes:** docs/ROADMAP.md: Included in 0.8.5. The low-EMP status button already exists.

## Done or dropped

Implemented features and completed fixes remain in [docs/ROADMAP.md](docs/ROADMAP.md). Older release targets there are historical, not new backlog tasks.

