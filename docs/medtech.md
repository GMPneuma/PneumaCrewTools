# Medtech downtime and therapy

All records live on the acting character’s owner-editable **Crew Tools — Character Name / Active Projects** Journal page. Actions work without a connected GM after ordinary module setup. Character identity uses Actor IDs with displayed names. No medical bookkeeping is written to character flags.

## Therapy

Every character, including Medtechs, has a **Therapy · Patient** bar. Medtechs also have a separate **Medtech · Therapy** provider bar. Each course needs seven allocated downtime days; each plus button spends one available day immediately. Patient and provider allocate their own days independently.

| Therapy                | Patient price | Medtech material cost | Medical Tech DV | Recovery            |
| ---------------------- | ------------: | --------------------: | --------------: | ------------------- |
| Addiction              |      1,000 eb |                500 eb |              15 | One named addiction |
| Standard Humanity Loss |        500 eb |                100 eb |              15 | 2d6 Humanity        |
| Extreme Humanity Loss  |      1,000 eb |                500 eb |              17 | 4d6 Humanity        |

At the start, choose a type. A patient may select **I’m getting therapy from a PC** to pay nothing. A Medtech selects another player-owned, non-excluded Actor and pays the material cost. Costs are deducted immediately and recorded in the native money Journal.

After seven provider days, **Roll Medical Tech** uses the role’s **Medical Tech Skill**. Success must exceed the listed DV. The course ends on either result. A failure loses the paid materials and the seven spent days.

After seven patient days, the recovery dialog opens; closing it leaves an enabled recovery button. Standard and extreme therapy roll the stated dice, update native Humanity and EMP, and cap recovery at the Actor’s native maximum Humanity. PC-treated patients confirm that the provider succeeded. **Therapy Failed** instead consumes the completed patient week without recovery. This is patient confirmation, not automatic verification against another character’s private Journal.

Addiction therapy requires the addiction’s name and records successful treatment with the one-year automatic secondary-effect failure rule. It does not roll Humanity or automatically delete a drug/Active Effect: those native sheet details must be adjusted manually.

## Hourly work list

Only ranked Medtechs see this section. It contains two task types:

- **Surgery:** choose a native Critical Injury with a Surgery treatment DV. Every attempt takes four hours. Use the role’s **Surgery Skill**, not the rank-allocation entry named Surgery and not a normal skill Item. A success is recorded; the module does not automatically remove another Actor’s injury.
- **Pharmaceuticals:** choose a core pharmaceutical. The first attempt costs 200 eb, recorded in native money transactions. Each attempt takes one hour and uses **Medical Tech Skill** against DV13. Failure requires another hour but no second material payment. On success, doses equal to that derived role-skill rank are immediately created in the Medtech’s inventory. The source Item is unchanged.

The menu uses native compendium/world data for surgical injuries and these pharmaceuticals: Antibiotic, Rapiddetox, Speedheal, Stim, Surge, Radaway, Sedative and Veritas. No separate copies of the rule Items are created for these menus.

The list cannot use more than 16 hours. Failed attempts count. Unattempted tasks may be removed; attempted tasks cannot be removed to erase spent hours. Starting the first attempt reserves one downtime day, preventing that last day from being spent on other activities.

**Spend 1 Downtime Day** is available whenever the Medtech has a downtime day available, even with failed or unrolled tasks, one task, or an empty list. It spends one day and clears the entire list, including unfinished work. Unused hours are forfeited. Doses already delivered are not created again. Failed/unfinished batches do not refund materials. Active reserved workdays must be finished before the GM starts the next session.

## Journal fields and transparency

**Active Projects** stores **flags.pneuma-crewtools.activities**, using the same lifecycle format as TECH:

- **id, actorId, name, kind** identify a patient course, provider course or medical workday.
- **status, startedAt, completedAt, progress** describe active/completed/failed/cancelled work and days or hours.
- **details** retains the course type, days, PC-treatment choice, target Actor ID/name and addiction; or the workday hours and full task list.
- Task fields retain ID, type, source UUID, name, DV, hours per attempt, attempts, success, payment status, doses and native Item specification.
- **events** retain IDs, dates, action, readable explanation and structured input, day charges, money/Humanity changes, checks, outcomes and delivered Actor/Item IDs.

Completed or failed records remain in this array. Active patient/provider/day views are derived from it, not separately stored copies. Provider and patient courses remain independent; there is no cross-character therapy link or online-GM requirement.

**Downtime Log** records day charges and native resource changes, linked by activity ID. Native money, Humanity and inventory remain on Actors. The two Journal pages are separate writes, not an atomic transaction.

**medicalAttempt** is a visible interruption record on Active Projects, saved before medical rolls or native changes. Successful completion clears it. An interrupted action retains its recorded intent for reconciliation with native resources. No migration or hidden backup artifacts are added.

## Native implementation references

The adapter follows the system’s [Medtech role definition](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/packs/core/roles/role.medtech.yaml) and [native role-roll implementation](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/modules/item/types/cpr-role.js). Surgical DVs use each native Critical Injury’s **system.treatment.dvSurgery**, as in [Broken Arm](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/packs/core/critical-injuries-body/criticalinjury.broken.arm.yaml). The costs and therapy outcomes follow the user-supplied table.

Medtech checks use the native `roleAbility` roll type. Roll construction happens before an interruption marker is written. If a roll-only attempt is interrupted, **Clear Interrupted Medical Roll** offers a confirmation to discard the unsaved roll and retry. This control cannot clear attempts that reached money, Humanity or inventory changes.

Skill checks open the native roll dialog for modifiers. Cancelling leaves the activity unchanged and does not roll or charge resources.

The pharmaceutical menu always includes Antibiotic, Rapiddetox, Speedheal, Stim, Surge, Radaway, Sedative and Veritas. It prefers matching readable native Items; a missing entry produces a basic named drug Item with the dose quantity and no invented effects. The catalog refreshes when Downtime opens. Surgery Add requires at least one Surgery Skill rank; zero ranks show an explicitly disabled button and explanatory note.

## Administer Pharma

The Player Hub shows a red-accented Administer Pharma section immediately below Current Status for the selected character with a ranked Medtech role. The controls are inline; no separate popup is opened. It lists the eight pharmaceutical types already in that Actor's inventory, available dose counts and other player-controlled character recipients. Global exclusions and holding containers are excluded. It does not list street drugs.

Each Administer click sends exactly one dose. Sending removes that dose and records an offer on the sender's **Administer Pharma** Journal page. The recipient gets a whispered chat card with **Use Now** and **Reject**. Use Now delivers the dose and calls the Cyberpunk RED Item's native `snort()` drug-use action once, including native confirmation and effects. Any remaining doses stay in inventory. Cancelling native drug use removes the unused delivery and processes a rejection, returning it through the normal sender-owned return flow. Reject returns the doses when a sender-owner next connects or receives the response. No GM is needed for transfers after both character Journals have been prepared.

Each character has one Administer Pharma page containing sent and received transfers in one table. Transfer IDs identify rows; a receiving row is saved before delivery and updated with the final result. Repeated responses check that row before changing inventory. Delivery and return use native Item documents without Crew Tools Actor flags. Interrupted withdrawals/deliveries are retained for review instead of automatically repeated. Chat carries authenticated owner responses; Journal pages retain readable records and the item data. Unanswered offers can be shown again from this section without withdrawing more doses.

Native consumption adapter: [Cyberpunk RED drug Item](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/blob/v0.92.4/src/modules/item/types/cpr-drug.js).
