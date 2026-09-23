/** Public client-only shortcut slots. Contributors own their content and status styles. */
const shortcuts = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
let available = false;
export function refreshHudShortcuts(): void {
  const root = document.getElementById("pneuma-crewtools-calendar");
  for (const [id, content] of shortcuts) {
    let slot = root?.querySelector<HTMLElement>(
      '[data-shortcut-owner="' + CSS.escape(id) + '"]',
    );
    if (root && !slot) {
      slot = document.createElement("div");
      slot.className = "pneuma-external-shortcut";
      slot.dataset.shortcutOwner = id;
      root.append(slot);
    }
    if (slot && content.parentElement !== slot) slot.append(content);
  }
  root?.classList.toggle("has-external-shortcuts", shortcuts.size > 0);
  root?.style.setProperty("--pneuma-shortcut-count", String(shortcuts.size));
  const next = !!root;
  if (available !== next) {
    available = next;
    for (const listener of listeners) listener();
  }
}
export const hudShortcuts = Object.freeze({
  version: 1,
  isAvailable: () => available,
  getBounds: () =>
    document
      .getElementById("pneuma-crewtools-calendar")
      ?.getBoundingClientRect(),
  register(id: string, content: HTMLElement): void {
    const previous = shortcuts.get(id);
    if (previous && previous !== content) previous.remove();
    shortcuts.set(id, content);
    refreshHudShortcuts();
  },
  unregister(id: string): void {
    const content = shortcuts.get(id);
    const slot = content?.parentElement;
    if (slot?.dataset.shortcutOwner === id) slot.remove();
    shortcuts.delete(id);
    refreshHudShortcuts();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
});
