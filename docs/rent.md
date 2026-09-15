# Rent & Lifestyle

The GM configures housing and lifestyle charts in **Settings → Rent & Lifestyle → Manage Rates & Modifiers**. The supplied Cyberpunk RED charts are included by default (11 residences and four lifestyles). Street/vehicle living and corporate-provided housing cost 0 personal rent. An empty rate list restores that category’s defaults. Rent modifiers default to −50%, −25%, −10%, 0%, +10%, +25%, +50%, +100%. The settings form accepts a custom comma-separated list. Modifiers apply to personal and HQ rent, not lifestyle. Charges round to the nearest whole eb.

**Rent Is Due** marks a Rent & Lifestyle self-task for the current campaign month. It does not create personal charges or deduct money. Repeating it in the same month does not duplicate completed tasks. It does not advance game time. Only assigned player characters or characters already used by Crew Tools receive records.

Players choose their residence, rent percentage modifier, and lifestyle when paying. Dropdown changes immediately update the preview. Save Choices only stores preferences; it is not required before paying. Rent and lifestyle are separate payments, and only the selected payment is recorded at that time. Already-paid receipts keep their original choices and prices. Free housing still requires confirmation through Pay 0 eb; HQ residence uses Confirm HQ Residence without a second rent charge. The personal task clears when rent/residence and lifestyle are both handled.

HQ configuration appears to GMs in the same form. Choose a rent type and percentage for each HQ, then issue rent. HQ rent remains a shared crew obligation regardless of who lives there.

## Pending HQ payments

A player contribution immediately deducts money through the native character wealth ledger and records a pending payment in their character Journal. It does not require a connected GM or give players ownership of HQ Actors. The Player Hub displays **Rent Payment Processing** and the amount directly below Money.

HQ contributions settle automatically on the player client when the HQ page permits editing. No GM approval is required. Automatic reconciliation on reconnect recovers unfinished contributions. Completed payments reduce outstanding rent on the HQ Journal page. If pending contributions exceed the remaining bill, only the outstanding amount is applied and the rest is refunded to the contributor's native money ledger. Reprocessing a confirmed receipt cannot credit the HQ twice. An interrupted native money operation is recorded visibly for GM review before another payment is attempted.

## Storage

- **CrewTools / Rent & Lifestyle / Rates & Billing**: GM-managed, player-readable rates and billing periods; `recordKind: rent`, `recordKey: rentConfig`, payload `flags.pneuma-crewtools.data`.
- **Crew Tools — Character / Rent & Lifestyle**: residence, rent modifier, lifestyle, due tasks (due array), payment receipts (bills array), paid status and pending/confirmed HQ contributions; `recordKey: rent`, payload `flags.pneuma-crewtools.data`. The character's owners can update their prepared Journal without a GM. Actor references use stable IDs and readable names.
- **Headquarters / HQ name**: properties, improvements, rent selection, modifier, bills and payment receipts on one player-editable page. Container ownership remains unchanged.
- HQ bills and contributions are rendered under the HQ page's **Rent & Payments** heading. Pending amounts remain recoverable in the donor's Journal.
- **World setting `rentModifiers`**: dropdown preferences only; campaign prices and payments stay in documents.

Journal text is a readable view, not a second editable database. Editing prose does not change bills, balances or payments. No migration or automatic deletion code is added.

## Housing status reminder

Street housing shows a nightly DV15 Endurance reminder in the Player Hub and Rent & Lifestyle Journal. Vehicle housing shows it only when Vehicle has a bed is unchecked. The choice and bed exemption live in the character Journal; no Actor status effect, automatic roll, fatigue penalty, or calendar trigger is added. Save Choices or pay rent to persist the selection.
