import { describe, expect, it } from 'vitest';
import type { ComponentDefinition, DesignNode, GroupNode, PathNode, RectNode } from '../src/core/document/types';
import { createEmptyDocument } from '../src/core/document/factory';
import {
  cloneNodesSubtree,
  createClipboardPayload,
  prepareNodesForPaste,
  wouldCreateComponentCycle,
} from '../src/app/nodeClipboard';

function makeRect(id: string, overrides: Partial<RectNode> = {}): RectNode {
  return {
    id,
    type: 'rect',
    name: `Rect ${id}`,
    x: 40,
    y: 50,
    width: 120,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: { fill: '#8B7CF6', stroke: '#20212A', strokeWidth: 2, radius: 8 },
    ...overrides,
  };
}

function makeGroup(id: string, overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id,
    type: 'group',
    name: `Group ${id}`,
    x: 40,
    y: 50,
    width: 200,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    ...overrides,
  };
}

describe('nodeClipboard — hierarchy-safe duplication and cross-canvas clipboard', () => {
  it('remaps parentId and clipMaskBaseId when duplicating a Group subtree (Ctrl+D)', () => {
    const group = makeGroup('grp-1');
    const base = makeRect('child-base', { parentId: 'grp-1', x: 50, y: 60 });
    const clipped = makeRect('child-clipped', {
      parentId: 'grp-1',
      clipMaskBaseId: 'child-base',
      x: 70,
      y: 80,
    });
    const allNodes: DesignNode[] = [group, base, clipped];

    const { clonedNodes, rootIds, idMap } = cloneNodesSubtree(allNodes, ['grp-1'], {
      offsetX: 24,
      offsetY: 24,
      nameSuffix: ' copy',
      preserveExternalParent: true,
      idFactory: (index, src) => `dup-${index}-${src.id}`,
    });

    expect(clonedNodes).toHaveLength(3);
    expect(rootIds).toEqual(['dup-0-grp-1']);

    const clonedGroup = clonedNodes[0];
    const clonedBase = clonedNodes[1];
    const clonedClipped = clonedNodes[2];

    expect(clonedGroup.name).toBe('Group grp-1 copy');
    expect(clonedBase.name).toBe('Rect child-base');
    expect(clonedBase.parentId).toBe(clonedGroup.id);
    expect(clonedClipped.parentId).toBe(clonedGroup.id);
    expect(clonedClipped.clipMaskBaseId).toBe(clonedBase.id);
    expect(clonedClipped.x).toBe(94);
    expect(clonedClipped.y).toBe(104);
    expect(idMap.get('grp-1')).toBe(clonedGroup.id);
  });

  it('deep-clones PathNode anchors and handles without aliasing shared references', () => {
    const pathNode: PathNode = {
      id: 'path-1',
      type: 'path',
      name: 'Curve',
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: false,
      points: [
        { id: 'a1', x: 0, y: 0, pointType: 'smooth', handleOut: { x: 30, y: 10 } },
        { id: 'a2', x: 100, y: 100, pointType: 'corner', handleIn: { x: 70, y: 90 } },
      ],
      style: { fill: 'none', stroke: '#FFFFFF', strokeWidth: 3 },
    };

    const { clonedNodes } = cloneNodesSubtree([pathNode], ['path-1'], {
      offsetX: 12,
      offsetY: 12,
      idFactory: () => 'path-clone',
    });

    const clone = clonedNodes[0] as PathNode;
    clone.points[0].handleOut!.x = 999;
    clone.style.stroke = '#FF0000';

    expect(pathNode.points[0].handleOut!.x).toBe(30);
    expect(pathNode.style.stroke).toBe('#FFFFFF');
  });

  it('cascades paste offset on same page and resets to exact origin when pasting onto another page', () => {
    const rect = makeRect('r1', { x: 100, y: 120, parentId: 'external-group' });
    const clipboard = createClipboardPayload([rect], ['r1'], {
      target: 'main',
      pageId: 'page-home',
      componentId: null,
    });
    expect(clipboard).not.toBeNull();

    // Paste on same page -> +24px cascade
    const samePage = prepareNodesForPaste(
      clipboard!,
      { target: 'main', pageId: 'page-home', componentId: null, components: [] },
      () => 'pasted-same',
    );
    expect(samePage.nodes[0].x).toBe(124);
    expect(samePage.nodes[0].y).toBe(144);
    expect(samePage.nodes[0].parentId).toBeNull();

    // Paste onto a different page -> exact (0, 0) offset on first paste
    const otherPage = prepareNodesForPaste(
      clipboard!,
      { target: 'main', pageId: 'page-about', componentId: null, components: [] },
      () => 'pasted-other',
    );
    expect(otherPage.nodes[0].x).toBe(100);
    expect(otherPage.nodes[0].y).toBe(120);
  });

  it('automatically detaches circular ComponentInstance nodes when pasted into their own Component Canvas', () => {
    const masterDoc = createEmptyDocument('Card Master', 200, 120);
    masterDoc.id = 'comp-card-doc';
    masterDoc.nodes = [makeRect('card-bg', { x: 0, y: 0, width: 200, height: 120 })];

    const cardComponent: ComponentDefinition = {
      id: 'comp-card',
      name: 'Card',
      document: masterDoc,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const instanceNode: DesignNode = {
      id: 'inst-1',
      type: 'component-instance',
      name: 'Card Instance',
      componentId: 'comp-card',
      x: 80,
      y: 90,
      width: 200,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
      overrides: { 'card-bg': { fill: '#22C55E' } },
    };

    expect(wouldCreateComponentCycle([cardComponent], 'comp-card', 'comp-card')).toBe(true);

    const clipboard = createClipboardPayload([instanceNode], ['inst-1'], {
      target: 'main',
      pageId: 'page-home',
      componentId: null,
    })!;

    const pasted = prepareNodesForPaste(clipboard, {
      target: 'component',
      pageId: null,
      componentId: 'comp-card',
      components: [cardComponent],
    });

    expect(pasted.detachedCircularCount).toBe(1);
    expect(pasted.nodes.every((node) => node.type !== 'component-instance')).toBe(true);
    const detachedRect = pasted.nodes[0] as RectNode;
    expect(detachedRect.type).toBe('rect');
    expect(detachedRect.style.fill).toBe('#22C55E');
    expect(detachedRect.x).toBe(80);
    expect(detachedRect.y).toBe(90);
  });
});
