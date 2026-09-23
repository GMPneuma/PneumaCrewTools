# Client HUD shortcut API (v1)

`game.modules.get("pneuma-crewtools").api.hudShortcuts` is available after init. Consumers should connect at ready and check module activation and `version === 1`.

- `register(id, content: HTMLElement)`: mount module-owned content in a stable shortcut slot. Use your module ID; repeat calls replace/update that registration without duplicate slots.
- `unregister(id)`: remove the slot and registration. The contributor can reattach its content elsewhere.
- `isAvailable()`: whether the Crew Tools HUD currently exists.
- `subscribe(callback)`: receive availability transitions; returns an unsubscribe function. Read initial availability yourself.

Content, click handling, accessible labels, status colors and animation belong to the contributor. Slots are 34px wide; compact buttons should fit this width. Crew Tools preserves registered content when recreating the calendar. Its own shortcut-display preference does not hide external shortcuts. Hiding the entire Crew HUD makes slots unavailable: contributors should provide their own fallback and reconnect when available. No registration is persisted or broadcast to other clients.

`getBounds()` returns the current HUD rectangle for positioning companion panels without querying private markup.
