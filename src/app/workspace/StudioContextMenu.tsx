import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { detectShortcutPlatform, formatKeyComboForPlatform, type ShortcutPlatform } from '../keyboardShortcuts';

export type StudioContextMenuItem =
  | {
      readonly kind: 'item';
      readonly id: string;
      readonly label: string;
      readonly shortcut?: readonly string[];
      readonly disabled?: boolean;
      readonly active?: boolean;
      readonly danger?: boolean;
      readonly accent?: boolean;
      readonly tone?: 'default' | 'accent' | 'danger';
      readonly badge?: string;
      readonly title?: string;
      readonly testId?: string;
      readonly icon?: JSX.Element;
      readonly onSelect: () => void;
    }
  | {
      readonly kind: 'header';
      readonly id: string;
      readonly label: string;
      readonly meta?: string;
    }
  | {
      readonly kind: 'divider';
      readonly id: string;
    };

export type StudioContextMenuEntry = StudioContextMenuItem;

export interface StudioContextMenuPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Pure viewport-clamping helper so context menus never clip outside screen bounds.
 */
export function clampContextMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): StudioContextMenuPosition {
  const safeW = Math.max(120, viewportWidth);
  const safeH = Math.max(120, viewportHeight);
  const maxX = Math.max(margin, safeW - menuWidth - margin);
  const maxY = Math.max(margin, safeH - menuHeight - margin);
  return {
    x: Math.round(Math.min(Math.max(margin, x), maxX)),
    y: Math.round(Math.min(Math.max(margin, y), maxY)),
  };
}

export function formatContextShortcut(
  tokens: readonly string[] | undefined,
  platform?: ShortcutPlatform,
): string | null {
  if (!tokens || tokens.length === 0) return null;
  const resolved = platform ?? detectShortcutPlatform();
  return formatKeyComboForPlatform(tokens, resolved).join(resolved === 'mac' ? '' : '+');
}

export interface StudioContextMenuProps {
  open?: boolean;
  x?: number;
  y?: number;
  position?: StudioContextMenuPosition | null;
  ariaLabel: string;
  items?: readonly StudioContextMenuItem[];
  entries?: readonly StudioContextMenuItem[];
  onClose: () => void;
  testId?: string;
}

export function StudioContextMenu({
  open,
  x,
  y,
  position,
  ariaLabel,
  items,
  entries,
  onClose,
  testId = 'studio-context-menu',
}: StudioContextMenuProps) {
  const resolvedOpen = position !== undefined ? position !== null : Boolean(open);
  const rawX = position ? position.x : (x ?? 0);
  const rawY = position ? position.y : (y ?? 0);
  const resolvedItems = items ?? entries ?? [];

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<StudioContextMenuPosition>({ x: rawX, y: rawY });
  const platform = detectShortcutPlatform();

  useLayoutEffect(() => {
    if (!resolvedOpen) return;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const el = menuRef.current;
    const width = el ? el.offsetWidth || 228 : 228;
    const height = el ? el.offsetHeight || 260 : 260;
    setCoords(clampContextMenuPosition(rawX, rawY, width, height, vw, vh));
  }, [resolvedOpen, rawX, rawY, resolvedItems.length]);

  useEffect(() => {
    if (!resolvedOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const container = menuRef.current;
        if (!container) return;
        const buttons = Array.from(
          container.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)'),
        );
        if (buttons.length === 0) return;
        event.preventDefault();
        const activeIdx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIdx = activeIdx < 0
          ? (delta > 0 ? 0 : buttons.length - 1)
          : (activeIdx + delta + buttons.length) % buttons.length;
        buttons[nextIdx]?.focus();
      }
    };
    const handleScrollOrResize = () => onClose();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('blur', handleScrollOrResize);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('blur', handleScrollOrResize);
    };
  }, [resolvedOpen, onClose]);

  if (!resolvedOpen || resolvedItems.length === 0) return null;

  const menuNode = (
    <div
      ref={menuRef}
      class="studio-context-menu"
      role="menu"
      aria-label={ariaLabel}
      data-testid={testId}
      style={{ position: 'fixed', left: `${coords.x}px`, top: `${coords.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {resolvedItems.map((entry) => {
        if (entry.kind === 'divider') {
          return <div key={entry.id} class="studio-context-menu-divider" role="separator" />;
        }
        if (entry.kind === 'header') {
          return (
            <div key={entry.id} class="studio-context-menu-header">
              <span>{entry.label}</span>
              {entry.meta && <span class="studio-context-menu-meta">{entry.meta}</span>}
            </div>
          );
        }
        const shortcutText = formatContextShortcut(entry.shortcut, platform);
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            data-testid={entry.testId}
            class={
              'studio-context-menu-item' +
              (entry.active ? ' is-active' : '') +
              (entry.accent || entry.tone === 'accent' ? ' is-accent' : '') +
              (entry.danger || entry.tone === 'danger' ? ' is-danger' : '')
            }
            disabled={entry.disabled}
            title={entry.title}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
              entry.onSelect();
            }}
          >
            <span class="studio-context-menu-item-main">
              {entry.icon && <span class="studio-context-menu-icon">{entry.icon}</span>}
              <span class="studio-context-menu-label">{entry.label}</span>
              {entry.badge && <span class="studio-context-menu-badge">{entry.badge}</span>}
            </span>
            {entry.active && !shortcutText && (
              <span class="studio-context-menu-check" aria-hidden="true">✓</span>
            )}
            {shortcutText && <kbd class="studio-context-menu-kbd">{shortcutText}</kbd>}
          </button>
        );
      })}
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(menuNode, document.body);
  }
  return menuNode;
}
