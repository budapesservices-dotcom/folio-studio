import { describe, expect, it } from 'vitest';
import { clampContextMenuPosition, formatContextShortcut } from '../src/app/workspace/StudioContextMenu';
import { getDefaultInspectorOpenSections } from '../src/app/InspectorPanel';
import { STUDIO_KEYBOARD_SHORTCUTS } from '../src/app/keyboardShortcuts';

describe('Studio UX Consistency — Context Menus, Inspector Progressive Disclosure & Unified Shortcuts', () => {
  it('clamps context menu coordinates safely inside viewport margins', () => {
    // Near bottom-right corner
    const clamped = clampContextMenuPosition(1420, 880, 240, 320, 1440, 900, 8);
    expect(clamped.x).toBe(1192);
    expect(clamped.y).toBe(572);

    // Negative / offscreen top-left
    const clampedTopLeft = clampContextMenuPosition(-30, -15, 220, 200, 1280, 720, 8);
    expect(clampedTopLeft.x).toBe(8);
    expect(clampedTopLeft.y).toBe(8);

    // Center coordinates stay untouched
    const center = clampContextMenuPosition(400, 300, 220, 260, 1440, 900, 8);
    expect(center).toEqual({ x: 400, y: 300 });
  });

  it('formats platform-aware shortcut hints for context menus', () => {
    expect(formatContextShortcut(['Mod', 'D'], 'standard')).toBe('Ctrl+D');
    expect(formatContextShortcut(['Mod', 'D'], 'mac')).toBe('⌘D');
    expect(formatContextShortcut(['Mod', 'Shift', 'H'], 'standard')).toBe('Ctrl+Shift+H');
    expect(formatContextShortcut(['Mod', 'Shift', 'L'], 'mac')).toBe('⌘⇧L');
    expect(formatContextShortcut([], 'standard')).toBeNull();
    expect(formatContextShortcut(undefined, 'standard')).toBeNull();
  });

  it('keeps Inspector sections calm and relevant by node type on first selection', () => {
    const rectDefaults = getDefaultInspectorOpenSections('rect');
    expect(rectDefaults['size-position']).toBe(true);
    expect(rectDefaults.appearance).toBe(true);
    expect(rectDefaults['layout-frame']).toBe(false);
    expect(rectDefaults['modern-effects']).toBe(false);

    const frameDefaults = getDefaultInspectorOpenSections('frame');
    expect(frameDefaults['layout-frame']).toBe(true);
    expect(frameDefaults['size-position']).toBe(true);

    const textDefaults = getDefaultInspectorOpenSections('text');
    expect(textDefaults.text).toBe(true);
    expect(textDefaults['layout-frame']).toBe(false);

    const componentDefaults = getDefaultInspectorOpenSections('component-instance');
    expect(componentDefaults['component-logic']).toBe(true);
  });

  it('documents all unified cross-tab shortcuts accurately in the shortcuts catalog', () => {
    const byId = new Map(STUDIO_KEYBOARD_SHORTCUTS.map((entry) => [entry.id, entry]));

    expect(byId.get('global-duplicate')?.keys).toEqual(['Mod', 'D']);
    expect(byId.get('global-deselect')?.keys).toEqual(['Mod', 'Shift', 'A']);
    expect(byId.get('global-zoom-in-out')?.keys).toEqual(['Mod', '=']);
    expect(byId.get('global-zoom-reset')?.keys).toEqual(['Mod', '0']);
    expect(byId.get('global-focus-canvas')?.keys).toEqual(['Mod', '\\']);
    expect(byId.get('global-panel-toggles')?.keys).toEqual(['Alt', '1']);
    expect(byId.get('layers-rename-f2')?.keys).toEqual(['F2']);
    expect(byId.get('layers-toggle-visibility')?.keys).toEqual(['Mod', 'Shift', 'H']);
    expect(byId.get('layers-toggle-lock')?.keys).toEqual(['Mod', 'Shift', 'L']);
    expect(byId.get('layers-arrange-step')?.keys).toEqual([']']);
    expect(byId.get('layers-arrange-extremes')?.keys).toEqual(['Mod', ']']);
    expect(byId.get('motion-play-pause')?.keys).toEqual(['Space']);
    expect(byId.get('motion-keyframe-step')?.keys).toEqual(['K']);
  });
});
