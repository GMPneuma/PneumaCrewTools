# PneumaCrewTools

Crew management tools for Foundry VTT v12 and the Cyberpunk RED Core system.
Version 0.1.0 starts from the copied Pneuma's Payouts codebase, retaining its
payout workflow, journals, and player inbox.

## Campaign calendar

A small shared date display provides GM controls to set the campaign date and
advance days. The date comes directly from Foundry world time; no calendar
Journal is required or created.
See [calendar usage, compatibility, and validation](docs/calendar.md).

## Development

Requirements: Node.js 20.19+ (or 22.12+) and pnpm.

```sh
pnpm install
pnpm check
pnpm test
pnpm dev
```

- `pnpm build` creates the installable module in `dist`.
- `pnpm typecheck` checks TypeScript.
- `pnpm check` checks TypeScript and creates a production build.
- `pnpm test` runs the payout execution and rollback tests.
- `pnpm dev` rebuilds when source files change.

For local Foundry development, copy or link `dist` to
`Data/modules/pneuma-crewtools`. The folder name must match the module ID.
Release downloads are available from [GitHub Releases](https://github.com/GMPneuma/PneumaCrewTools/releases).
The Foundry manifest URL is
[module.json](https://github.com/GMPneuma/PneumaCrewTools/releases/latest/download/module.json).

## Module identity and data

PneumaCrewTools uses the `pneuma-crewtools` module ID, settings, and flags.
Existing Pneuma's Payouts world data is not migrated or adopted automatically.
The module API is available at `game.modules.get("pneuma-crewtools").api`.

See [the Journal guide and specifications](docs/journals.md),
[the data model](docs/data-model.md),
[player discovery](docs/player-discovery.md), and [the roadmap](ROADMAP.md).
The inherited project history is preserved under [docs/legacy](docs/legacy).

## Downtime

Payouts now award player downtime balances. Players can spend or allocate whole days through Crew Tools Player Hub → Spend Downtime. See [Downtime implementation notes](docs/downtime.md) for the workflow, Journal format, and current limitations.

The inbox-shaped token control opens the Crew Tools Player Hub: payout acknowledgements, current resources, downtime spending, and the multi-HQ viewer. Rent & Lifestyle now supports GM-issued monthly bills, percentage modifiers, personal payments and pending HQ contributions. Campaign price charts are awaiting the supplied tables; see [Rent & Lifestyle](docs/rent.md).

## Headquarters

Manage multiple HQs with images, container Actors and improvements through the Player Hub. Shared HQ IP comes from payouts. See [Headquarters notes](docs/headquarters.md) for folders, permissions and Journal formats.

See [Actor identity and exclusions](docs/actor-tracking.md) for the module-wide Actor tracking audit and the Never list these Actors setting.

## Hustle tables

Native role tables are created under Rollable Tables → CrewTools. See [Hustle table format and planned integration](docs/hustle-tables.md).

See [TECH project workflow and Journal format](docs/tech-projects.md) for crafting, upgrades, inventions and configurable crafting months.

Medtech workdays and therapy: see [the medical feature and Journal specification](docs/medtech.md).

## Campaign record storage

Payout history, attendance, faction reputation, receipts and pending/completed Humanity actions are now stored in ordinary Journals alongside downtime and HQ data. Character receipts retain acknowledgment dates. Native character resources and Foundry world time remain authoritative; settings hold preferences. See [the data model](docs/data-model.md) and [Journal guide](docs/journals.md).

Character bookkeeping is organized in one **Crew Tools — Character** Journal, with Downtime Log, Active Projects and payout action pages. Active and completed TECH/medical records share a structured lifecycle. See [the data model](docs/data-model.md).

HQ management includes editable improvements, explicit Medbay/Workshop effects, shared IP corrections, and rent setup/payment progress. See [Headquarters](docs/headquarters.md).
