# PneumaCrewTools

Crew management tools for Foundry VTT v12 and the Cyberpunk RED Core system.
Version 0.1.0 starts from the copied Pneuma's Payouts codebase, retaining its
payout workflow, journals, and player inbox.

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
This initial source repository has no published installable release.

## Module identity and data

PneumaCrewTools uses the `pneuma-crewtools` module ID, settings, and flags.
Existing Pneuma's Payouts world data is not migrated or adopted automatically.
The module API is available at `game.modules.get("pneuma-crewtools").api`.

See [the data model](docs/data-model.md),
[player discovery](docs/player-discovery.md), and [the roadmap](ROADMAP.md).
The inherited project history is preserved under [docs/legacy](docs/legacy).
