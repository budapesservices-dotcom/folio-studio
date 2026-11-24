import { useEffect, useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { activateModalDialog, trapModalDialogKeydown } from '../modalFocus';

export interface UseWorkspaceChromeEffectsOptions {
  notice: string;
  setNotice: (next: string) => void;
  openMenu: string | null;
  setOpenMenu: (next: null) => void;
  menuBarRef: RefObject<HTMLElement>;
  toolRackOpen: string | null;
  setToolRackOpen: (next: null) => void;
  toolRailRef: RefObject<HTMLElement>;
  recoverWindow: (windowId: 'main-canvas' | 'component-canvas' | 'node-logic') => void;
  clampCurrentPanelWidths: () => void;
  shortcutsModalOpen: boolean;
  shortcutsMountTick: number;
  componentDeletionDialogOpen: boolean;
  appShellRef: RefObject<HTMLDivElement>;
  shortcutsModalHostRef: RefObject<HTMLElement>;
  shortcutsDialogRef: RefObject<HTMLElement>;
  shortcutsFocusReturnRef: { current: HTMLElement | null };
  closeShortcutsModal: () => void;
}

/**
 * Encapsulates top-level workspace chrome lifecycle listeners:
 * - transient toast auto-dismissal
 * - outside-click / Escape dismissal for menu bar & tool-rack flyouts
 * - viewport resize recovery for floating windows & side panels
 * - Keyboard Shortcuts modal focus trapping
 */
export function useWorkspaceChromeEffects({
  notice,
  setNotice,
  openMenu,
  setOpenMenu,
  menuBarRef,
  toolRackOpen,
  setToolRackOpen,
  toolRailRef,
  recoverWindow,
  clampCurrentPanelWidths,
  shortcutsModalOpen,
  shortcutsMountTick,
  componentDeletionDialogOpen,
  appShellRef,
  shortcutsModalHostRef,
  shortcutsDialogRef,
  shortcutsFocusReturnRef,
  closeShortcutsModal,
}: UseWorkspaceChromeEffectsOptions): void {
  // Auto-dismiss transient status toast
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  // Dismiss menus on outside pointerdown or Escape
  useLayoutEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuBarRef.current?.contains(event.target)) return;
      setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenMenu(null);
      }
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, signal: controller.signal });
    window.addEventListener('keydown', handleKeyDown, { capture: true, signal: controller.signal });
    return () => controller.abort();
  }, [openMenu, menuBarRef, setOpenMenu]);

  // Dismiss tool rack flyouts on outside pointerdown or Escape
  useLayoutEffect(() => {
    if (!toolRackOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolRailRef.current?.contains(event.target)) return;
      setToolRackOpen(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (
          event.target instanceof HTMLInputElement
          && event.target.classList.contains('template-library-search')
          && event.target.value.trim().length > 0
        ) {
          return;
        }
        event.preventDefault();
        setToolRackOpen(null);
      }
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, signal: controller.signal });
    window.addEventListener('keydown', handleKeyDown, { capture: true, signal: controller.signal });
    return () => controller.abort();
  }, [toolRackOpen, toolRailRef, setToolRackOpen]);

  // Window viewport recovery on mount & resize
  useEffect(() => {
    const onResize = () => {
      recoverWindow('main-canvas');
      recoverWindow('component-canvas');
      recoverWindow('node-logic');
      clampCurrentPanelWidths();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recoverWindow, clampCurrentPanelWidths]);

  useEffect(() => {
    recoverWindow('main-canvas');
    recoverWindow('component-canvas');
    recoverWindow('node-logic');
  }, []);

  // Keyboard Shortcuts modal focus trap
  useEffect(() => {
    if (!shortcutsModalOpen || componentDeletionDialogOpen) return;
    const shell = appShellRef.current;
    const host = shortcutsModalHostRef.current;
    const dialog = shortcutsDialogRef.current;
    if (!shell || !host || !dialog) return;
    const restoreFocus = activateModalDialog(shell, host, dialog, shortcutsFocusReturnRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === '/') {
        event.preventDefault();
        event.stopPropagation();
        closeShortcutsModal();
        return;
      }
      trapModalDialogKeydown(dialog, event, closeShortcutsModal);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocus();
    };
  }, [
    shortcutsModalOpen,
    shortcutsMountTick,
    componentDeletionDialogOpen,
    appShellRef,
    shortcutsModalHostRef,
    shortcutsDialogRef,
    shortcutsFocusReturnRef,
    closeShortcutsModal,
  ]);
}
