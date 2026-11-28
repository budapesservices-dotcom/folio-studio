import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { ComponentDefinition, DesignNode, FolioProject } from '../src/core/document/types';
import {
  DEFAULT_DELTA_HISTORY_LIMIT,
  applyProjectDelta,
  commitDeltaCoalesceGroup,
  computeProjectDelta,
  countDeltaTouchedNodes,
  createDeltaHistoryTimeline,
  isProjectDeltaEmpty,
  pushProjectDelta,
  redoProjectDelta,
  undoProjectDelta,
} from '../src/engines/history';

function buildLargeProject(nodeCount: number): FolioProject {
  const base = createInitialProject('Delta History Perf');
  const nodes: DesignNode[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    nodes.push({
      ...createRectNode(i),
      id: `node-${i}`,
      name: `Rect ${i}`,
      x: (i % 30) * 44,
      y: Math.floor(i / 30) * 44,
      width: 36,
      height: 36,
    });
  }
  return {
    ...base,
    pages: [
      {
        ...base.pages[0],
        document: {
          ...base.pages[0].document,
          nodes,
        },
      },
    ],
  };
}

function moveNode(project: FolioProject, nodeId: string, dx: number, dy: number): FolioProject {
  const activePage = getActivePage(project);
  return {
    ...project,
    pages: project.pages.map((page) =>
      page.id !== activePage.id
        ? page
        : {
            ...page,
            document: {
              ...page.document,
              nodes: page.document.nodes.map((node) =>
                node.id === nodeId ? { ...node, x: node.x + dx, y: node.y + dy } : node,
              ),
            },
          },
    ),
  };
}

describe('Delta History Engine', () => {
  it('stores O(changed nodes) structural deltas on a 1,500-node project and round-trips losslessly', () => {
    const before = buildLargeProject(1500);
    const after = moveNode(before, 'node-42', 120, 80);

    const delta = computeProjectDelta(before, after);
    expect(isProjectDeltaEmpty(delta)).toBe(false);
    // 1 modified node stores its before + after reference (2 entries vs 1,500 total nodes).
    expect(countDeltaTouchedNodes(delta)).toBe(2);

    const undone = applyProjectDelta(after, delta, 'backward');
    expect(undone).toEqual(before);

    const redone = applyProjectDelta(undone, delta, 'forward');
    expect(redone).toEqual(after);
  });

  it('supports deep 200-step Undo/Redo history without losing fidelity', () => {
    const initialSnapshot = buildLargeProject(60);
    let timeline = createDeltaHistoryTimeline(initialSnapshot);
    expect(timeline.maxEntries).toBe(DEFAULT_DELTA_HISTORY_LIMIT);
    expect(timeline.maxEntries).toBe(200);

    for (let step = 0; step < 200; step += 1) {
      const next = moveNode(timeline.current, `node-${step % 60}`, 5, 3);
      timeline = pushProjectDelta(timeline, next);
    }

    expect(timeline.past.length).toBe(200);
    expect(timeline.future.length).toBe(0);
    const finalSnapshot = timeline.current;

    // Undo all 200 steps
    for (let step = 0; step < 200; step += 1) {
      timeline = undoProjectDelta(timeline);
    }
    expect(timeline.past.length).toBe(0);
    expect(timeline.future.length).toBe(200);
    expect(timeline.current).toEqual(initialSnapshot);

    // Redo all 200 steps
    for (let step = 0; step < 200; step += 1) {
      timeline = redoProjectDelta(timeline);
    }
    expect(timeline.past.length).toBe(200);
    expect(timeline.future.length).toBe(0);
    expect(timeline.current).toEqual(finalSnapshot);
  });

  it('coalesces consecutive edits within the same coalesceKey and commits cleanly', () => {
    const p0 = buildLargeProject(10);
    const p1 = moveNode(p0, 'node-0', 10, 0);
    const p2 = moveNode(p1, 'node-0', 15, 5);
    const p3 = moveNode(p2, 'node-0', 20, 10);

    let timeline = createDeltaHistoryTimeline(p0);
    timeline = pushProjectDelta(timeline, p1, { coalesceKey: 'drag:node-0' });
    timeline = pushProjectDelta(timeline, p2, { coalesceKey: 'drag:node-0' });
    timeline = pushProjectDelta(timeline, p3, { coalesceKey: 'drag:node-0' });

    expect(timeline.past.length).toBe(1);
    timeline = commitDeltaCoalesceGroup(timeline);
    expect(timeline.activeCoalesceKey).toBeNull();

    timeline = undoProjectDelta(timeline);
    expect(timeline.current).toEqual(p0);

    timeline = redoProjectDelta(timeline);
    expect(timeline.current).toEqual(p3);
  });

  it('round-trips page additions, node reorders, component mutations, and metadata changes', () => {
    const p0 = createInitialProject('Original');
    const masterDoc = createEmptyDocument('Button', 180, 56);
    masterDoc.nodes = [
      { ...createRectNode(0), id: 'btn-bg', name: 'BG' },
      { ...createTextNode(1), id: 'btn-txt', name: 'Label', text: 'Click' },
    ];
    const master: ComponentDefinition = {
      id: 'comp-button',
      name: 'Button',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      document: masterDoc,
    };
    const page2 = {
      id: 'page-about',
      name: 'About',
      route: '/about',
      document: createEmptyDocument('About', 1440, 900),
    };
    const p1: FolioProject = {
      ...p0,
      metadata: { ...p0.metadata, name: 'Renamed Studio' },
      activePageId: page2.id,
      pages: [
        {
          ...p0.pages[0],
          document: {
            ...p0.pages[0].document,
            nodes: [...p0.pages[0].document.nodes].reverse(),
          },
        },
        page2,
      ],
      components: [master],
    };

    const delta = computeProjectDelta(p0, p1);
    expect(isProjectDeltaEmpty(delta)).toBe(false);

    const undone = applyProjectDelta(p1, delta, 'backward');
    expect(undone).toEqual(p0);

    const redone = applyProjectDelta(undone, delta, 'forward');
    expect(redone).toEqual(p1);
  });
});
