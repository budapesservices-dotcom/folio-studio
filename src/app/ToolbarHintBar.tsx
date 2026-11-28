import { useEffect, useState } from 'preact/hooks';

export interface ToolbarHint {
  readonly panel: string;
  readonly description: string;
  readonly shortcuts: readonly string[];
}

export const DEFAULT_TOOLBAR_HINT: ToolbarHint = {
  panel: 'WORKSPACE',
  description: 'Click a parent to select its full hierarchy; click a nested layer to select only that object.',
  shortcuts: ['SHIFT + CLICK: EXACT LAYER', 'CTRL/CMD + CLICK: GROUP TOGGLE'],
};

export interface ToolbarHintStore {
  getHint(): ToolbarHint;
  setHint(next: ToolbarHint): boolean;
  subscribe(listener: () => void): () => void;
}

function areHintsEqual(a: ToolbarHint, b: ToolbarHint): boolean {
  if (a === b) return true;
  if (a.panel !== b.panel || a.description !== b.description) return false;
  if (a.shortcuts.length !== b.shortcuts.length) return false;
  for (let i = 0; i < a.shortcuts.length; i++) {
    if (a.shortcuts[i] !== b.shortcuts[i]) return false;
  }
  return true;
}

/**
 * Isolated external store for the global toolbar hint bar so high-frequency
 * hover transitions across panels and buttons update only `ToolbarHintBar`
 * without re-rendering the entire App shell, Canvas SVG, or Inspector.
 */
export function createToolbarHintStore(initialHint: ToolbarHint = DEFAULT_TOOLBAR_HINT): ToolbarHintStore {
  let current: ToolbarHint = initialHint;
  const listeners = new Set<() => void>();

  return {
    getHint: () => current,
    setHint(next: ToolbarHint): boolean {
      if (areHintsEqual(current, next)) return false;
      current = next;
      for (const listener of listeners) {
        listener();
      }
      return true;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function ToolbarHintBar({ store }: { store: ToolbarHintStore }) {
  const [hint, setHint] = useState<ToolbarHint>(() => store.getHint());

  useEffect(() => {
    setHint(store.getHint());
    return store.subscribe(() => {
      setHint(store.getHint());
    });
  }, [store]);

  return (
    <div class="global-hint-bar" role="status" aria-live="polite">
      <span class="hint-panel-label">{hint.panel}</span>
      <span class="hint-panel-description">{hint.description}</span>
      <span class="hint-shortcut-divider" aria-hidden="true">·</span>
      <div class="hint-shortcut-list">
        {hint.shortcuts.length > 0
          ? hint.shortcuts.map((shortcut) => <span class="hint-shortcut" key={shortcut}>{shortcut}</span>)
          : <span class="hint-no-shortcuts">SHORTCUTS NOT ASSIGNED</span>}
      </div>
    </div>
  );
}
