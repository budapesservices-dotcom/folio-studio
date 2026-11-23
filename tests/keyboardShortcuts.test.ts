import { describe, expect, it } from 'vitest';
import {
  COMPONENT_CANVAS_TOOL_GROUPS,
  MAIN_CANVAS_TOOL_GROUPS,
  findStudioToolByShortcut,
} from '../src/engines/canvas/tools/studioRegistry';
import {
  SHORTCUT_ACTION_CATEGORIES,
  SHORTCUT_WORKSPACES,
  STUDIO_KEYBOARD_SHORTCUTS,
  STUDIO_TOOL_KEYBINDINGS,
  countShortcutsByCategory,
  countShortcutsByWorkspace,
  detectShortcutPlatform,
  filterKeyboardShortcuts,
  formatKeyComboForPlatform,
  groupShortcutsByWorkspaceAndAction,
  isShortcutHelpTrigger,
} from '../src/app/keyboardShortcuts';

describe('keyboardShortcuts catalog and logic', () => {
  it('assigns unique IDs, valid workspaces, valid categories, and non-empty key sequences to every entry', () => {
    const workspaceIds = new Set(SHORTCUT_WORKSPACES.map((w) => w.id));
    const categoryIds = new Set(SHORTCUT_ACTION_CATEGORIES.map((c) => c.id));
    const seenIds = new Set<string>();

    expect(STUDIO_KEYBOARD_SHORTCUTS.length).toBeGreaterThan(40);

    for (const entry of STUDIO_KEYBOARD_SHORTCUTS) {
      expect(seenIds.has(entry.id), `Duplicate shortcut id: ${entry.id}`).toBe(false);
      seenIds.add(entry.id);
      expect(workspaceIds.has(entry.workspace)).toBe(true);
      expect(categoryIds.has(entry.category)).toBe(true);
      expect(entry.action.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
      expect(entry.keys.length).toBeGreaterThan(0);
    }
  });

  it('stays in exact parity with studioRegistry tool shortcuts for both Main Canvas and Component Canvas', () => {
    const workspaceConfigs = [
      { workspace: 'main' as const, groups: MAIN_CANVAS_TOOL_GROUPS },
      { workspace: 'component' as const, groups: COMPONENT_CANVAS_TOOL_GROUPS },
    ];

    for (const { workspace, groups } of workspaceConfigs) {
      const toolIds = groups.flatMap((group) => group.tools);
      for (const toolId of toolIds) {
        const entry = STUDIO_KEYBOARD_SHORTCUTS.find(
          (item) => item.workspace === workspace && item.toolId === toolId,
        );
        expect(entry, `Missing cheat-sheet entry for ${workspace} tool ${toolId}`).toBeDefined();

        const binding = STUDIO_TOOL_KEYBINDINGS[toolId];
        const shiftKey = binding.includes('Shift');
        const key = binding[binding.length - 1];
        expect(findStudioToolByShortcut(key, shiftKey, workspace)).toBe(toolId);
        expect(entry?.keys).toEqual(binding);
      }
    }
  });

  it('marks workspace-exclusive tools accurately between Main Canvas and Component Canvas', () => {
    const section = STUDIO_KEYBOARD_SHORTCUTS.find((s) => s.workspace === 'main' && s.toolId === 'section');
    expect(section?.scopeNote).toBe('Page studio only');

    const curvature = STUDIO_KEYBOARD_SHORTCUTS.find((s) => s.workspace === 'component' && s.toolId === 'curvature');
    expect(curvature?.scopeNote).toBe('Vector studio only');

    const penMain = STUDIO_KEYBOARD_SHORTCUTS.find((s) => s.workspace === 'main' && s.toolId === 'pen');
    expect(penMain?.scopeNote).toBeUndefined();
  });

  it('formats modifier and arrow tokens cleanly for macOS vs Windows/Linux', () => {
    expect(formatKeyComboForPlatform(['Mod', 'Shift', 'G'], 'standard')).toEqual(['Ctrl', 'Shift', 'G']);
    expect(formatKeyComboForPlatform(['Mod', 'Shift', 'G'], 'mac')).toEqual(['⌘', '⇧', 'G']);
    expect(formatKeyComboForPlatform(['Alt', 'ArrowUp'], 'standard')).toEqual(['Alt', '↑']);
    expect(formatKeyComboForPlatform(['Alt', 'ArrowUp'], 'mac')).toEqual(['⌥', '↑']);
  });

  it('detects platform notation from navigator-like metadata', () => {
    expect(detectShortcutPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 Macintosh' })).toBe('mac');
    expect(detectShortcutPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 X11 Linux' })).toBe('standard');
    expect(detectShortcutPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 Windows NT 10.0' })).toBe('standard');
  });

  it('filters shortcuts by workspace, action category, and multi-token search queries', () => {
    const masking = filterKeyboardShortcuts(STUDIO_KEYBOARD_SHORTCUTS, {
      workspace: 'all',
      category: 'all',
      query: 'clipping mask',
    });
    expect(masking.map((s) => s.id)).toEqual(['layers-create-mask', 'layers-release-mask']);

    const byKey = filterKeyboardShortcuts(STUDIO_KEYBOARD_SHORTCUTS, {
      workspace: 'component',
      category: 'all',
      query: 'Shift+C',
    });
    expect(byKey.some((s) => s.toolId === 'anchor-point')).toBe(true);

    const byCategory = filterKeyboardShortcuts(STUDIO_KEYBOARD_SHORTCUTS, {
      workspace: 'main',
      category: 'arrange-transform',
      query: '',
    });
    expect(byCategory.length).toBeGreaterThan(0);
    expect(byCategory.every((s) => s.workspace === 'main' && s.category === 'arrange-transform')).toBe(true);

    const empty = filterKeyboardShortcuts(STUDIO_KEYBOARD_SHORTCUTS, {
      workspace: 'all',
      category: 'all',
      query: 'nonexistent-xyz-shortcut',
    });
    expect(empty).toEqual([]);
  });

  it('computes accurate workspace and action category counts and hierarchical groups', () => {
    const wsCounts = countShortcutsByWorkspace(STUDIO_KEYBOARD_SHORTCUTS, '');
    expect(wsCounts.all).toBe(STUDIO_KEYBOARD_SHORTCUTS.length);
    expect(wsCounts.global + wsCounts.main + wsCounts.component + wsCounts['layers-panels']).toBe(wsCounts.all);

    const catCounts = countShortcutsByCategory(STUDIO_KEYBOARD_SHORTCUTS, '', 'global');
    expect(catCounts.all).toBe(wsCounts.global);

    const groupsForComponent = groupShortcutsByWorkspaceAndAction(STUDIO_KEYBOARD_SHORTCUTS, 'component');
    expect(groupsForComponent.map((g) => g.workspace.id)).toEqual([
      'global',
      'component',
      'main',
      'layers-panels',
    ]);
    const componentGroup = groupsForComponent.find((g) => g.workspace.id === 'component');
    expect(componentGroup?.categories[0]?.category.id).toBe('vector-craft');
    for (const group of groupsForComponent) {
      const sum = group.categories.reduce((acc, cat) => acc + cat.shortcuts.length, 0);
      expect(sum).toBe(group.totalCount);
    }
  });

  it('recognizes ? and Ctrl/Cmd+/ as shortcut cheat-sheet triggers', () => {
    expect(isShortcutHelpTrigger({ key: '?', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true })).toBe(true);
    expect(isShortcutHelpTrigger({ key: '/', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isShortcutHelpTrigger({ key: '/', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isShortcutHelpTrigger({ key: '/', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
    expect(isShortcutHelpTrigger({ key: '?', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(false);
    expect(isShortcutHelpTrigger({ key: '?', ctrlKey: false, metaKey: false, altKey: true, shiftKey: true })).toBe(false);
  });
});
