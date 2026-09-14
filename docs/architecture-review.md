# Structural review follow-up

Implemented the six approved changes:

1. Removed the obsolete downtime request-page processor. Action buttons execute immediately for the owning client, including without a connected GM. Payout acknowledgment settings, receipts, the Player Hub button and GM controls remain.
2. TECH and medical activities own their progress in Active Projects. Downtime Log own day charges and native-resource audit values. Reads and saves no longer reconstruct TECH events by joining two page schemas.
3. Coalesced Actor maintenance and targeted it to changed characters. Native money/HP changes skip setup, unused character Journals remain lazy, and unrelated Journal pages no longer trigger Crew Tools display updates.
4. Extracted payout planning from DOM handling. Fixed primary faction rewards being recorded with individual scope.
5. Separated Journal HTML rendering from persistence, including payout sections, activity tables.
6. Centralized native application, resource, TECH roll/item and upgrade-container boundaries. Foundry v12 behavior is retained; v13/v14 validation remains future work.

No migration, historical-data conversion, therapy linking or HQ rule overhaul was added. Journal document updates and Actor updates remain separate native operations.

Validation includes offline acknowledgment and Humanity actions, downtime charges, healing, hustle payments, TECH delivery, medical work, Actor exclusions, lazy Journal creation, targeted maintenance, separate activity persistence and payout scope calculations. Browser checks use real templates/CSS with mocked Foundry services, not a live world.

## Refresh and reliability follow-up

- Downtime refreshes for its selected character, character-list changes, relevant module settings and relevant Journal pages. Overlapping renders share one trailing refresh. HQ background updates preserve focus.
- Medical catalogs load only when a Medtech is displayed. Concurrent loads share a promise; compendium documents are reused until relevant compendium updates. Item changes invalidate catalog choices.
- Payout receipt reads scan character Journals once rather than repeating Actor and Journal scans for every user. HUD counts do not clone award details.
- Payout rollback attempts every restoration and reports incomplete recovery explicitly. The payout UI no longer claims that every failed payout was fully rolled back.
