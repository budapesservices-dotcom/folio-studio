import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';

const hookMocks = vi.hoisted(() => ({
  useState: vi.fn((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    vi.fn(),
  ]),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
  useMemo: vi.fn((factory: () => unknown) => factory()),
  useCallback: vi.fn((fn: unknown) => fn),
}));

vi.mock('preact/hooks', () => hookMocks);

import { createEmptyDocument } from '../src/core/document/factory';
import type { ComponentDefinition } from '../src/core/document/types';
import { ComponentRackPanel } from '../src/app/workspace/ComponentRackPanel';

interface VNodeLike {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

function findNodes(tree: unknown, predicate: (node: VNodeLike) => boolean, out: VNodeLike[] = []): VNodeLike[] {
  if (!tree || typeof tree !== 'object') return out;
  if (Array.isArray(tree)) {
    for (const item of tree) findNodes(item, predicate, out);
    return out;
  }
  const node = tree as VNodeLike;
  if (predicate(node)) out.push(node);
  if (node.props && 'children' in node.props) {
    findNodes(node.props.children, predicate, out);
  }
  return out;
}

function collectText(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  if (Array.isArray(tree)) return tree.map(collectText).join('');
  const node = tree as VNodeLike;
  return node.props && 'children' in node.props ? collectText(node.props.children) : '';
}

describe('ComponentRackPanel card semantics regression', () => {
  it('keeps .component-rack-card-name text strictly equal to component.name with .component-scope-badge as a sibling', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const components: ComponentDefinition[] = [
      {
        id: 'comp-global',
        name: 'Component 1',
        scope: 'global',
        document: createEmptyDocument('Component 1', 320, 180),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'comp-local',
        name: 'Nav Header',
        scope: 'local',
        applicationId: 'app-main',
        document: createEmptyDocument('Nav Header', 320, 80),
        createdAt: now,
        updatedAt: now,
      },
    ];

    const vnode = ComponentRackPanel({
      panelRef: createRef<HTMLElement>(),
      open: true,
      components,
      searchQuery: '',
      canSaveSelection: false,
      renamingComponentId: null,
      componentNameDraft: '',
      activeApplicationId: 'app-main',
      activeApplicationName: 'Main App',
      onSearchChange: vi.fn(),
      onCreateNewMaster: vi.fn(),
      onSaveSelection: vi.fn(),
      onClose: vi.fn(),
      onInsertComponent: vi.fn(),
      onEditMaster: vi.fn(),
      onStartRename: vi.fn(),
      onRenameDraftChange: vi.fn(),
      onCommitRename: vi.fn(),
      onCancelRename: vi.fn(),
      onDuplicateComponent: vi.fn(),
      onDeleteComponent: vi.fn(),
      onSetComponentScope: vi.fn(),
    });

    const cards = findNodes(vnode, (n) => n.props?.class === 'component-rack-card');
    expect(cards.length).toBe(2);

    const names = cards.map((card) => {
      const nameEl = findNodes(card, (n) => n.props?.class === 'component-rack-card-name')[0];
      expect(nameEl).toBeDefined();
      return collectText(nameEl).trim();
    });
    expect(names).toEqual(['Component 1', 'Nav Header']);

    const badges = cards.map((card) => {
      const badgeEl = findNodes(card, (n) => typeof n.props?.class === 'string' && n.props.class.includes('component-scope-badge'))[0];
      expect(badgeEl).toBeDefined();
      // Badge must NOT be nested inside .component-rack-card-name
      const nameEl = findNodes(card, (n) => n.props?.class === 'component-rack-card-name')[0];
      const nestedBadges = findNodes(nameEl, (n) => typeof n.props?.class === 'string' && n.props.class.includes('component-scope-badge'));
      expect(nestedBadges.length).toBe(0);
      return collectText(badgeEl).trim();
    });
    expect(badges).toEqual(['Global', 'Local']);

    // Rename & delete buttons match the exact component name read from .component-rack-card-name
    for (const expectedName of names) {
      const renameBtns = findNodes(vnode, (n) => n.props?.title === `Rename ${expectedName}`);
      const deleteBtns = findNodes(vnode, (n) => n.props?.title === `Delete ${expectedName}`);
      expect(renameBtns.length).toBe(1);
      expect(deleteBtns.length).toBe(1);
    }
  });
});
