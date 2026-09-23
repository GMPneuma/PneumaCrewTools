# Pneuma's Crew Tools — Roadmap

The current roadmap is maintained in [docs/ROADMAP.md](docs/ROADMAP.md).

## Optional Crew Tools / Biomon HUD integration

Crew Tools exposes a client-only `api.hudShortcuts` v1 content-slot registration API with availability subscriptions. Combat Tools offers opt-in per-user integration when Crew Tools is active: its minimized alert button uses that slot, with original status colors and a standalone fallback when hidden/unavailable. Expanded Biomon can dock top right or top left below navigation and beside canvas controls. Defaults are unchanged. Automated checks do not replace live Foundry testing.

### Crew HUD shortcut correction

Enabling integration now immediately adds a persistent Combat Tools Biomon button below the Crew icon, without widening the calendar. It opens/minimizes Biomon and retains health/alert colors while expanded, minimized, or disabled. Hidden/unavailable Crew HUD still uses the standalone fallback.
