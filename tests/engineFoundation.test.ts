import { describe, expect, it } from 'vitest';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createEditorState } from '../src/app/editorReducer';
import { createToolbarHintStore, DEFAULT_TOOLBAR_HINT } from '../src/app/ToolbarHintBar';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  detachComponentInstance,
  resolveComponentInstanceNodes,
} from '../src/core/document/components';
import { createInitialProject, createRectNode, createEllipseNode, createTextNode } from '../src/core/document/factory';
import {
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerClipMaskBaseIds,
} from '../src/core/document/layers';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { getActiveDocument } from '../src/core/document/project';
import {
  FOLIO_FORMAT,
  FOLIO_FORMAT_VERSION,
  type DesignNode,
  type FolioProject,
  type GroupNode,
} from '../src/core/document/types';
import { requireValidProject } from '../src/core/document/validation';

function buildComplexProject(): FolioProject {
  const base = createInitialProject('Native Foundation Complex');
  const now = '2026-01-15T10:00:00.000Z';

  const outerGroup: GroupNode = {
    id: 'group-outer',
    type: 'group',
    name: 'Hero Cluster',
    x: 100,
    y: 120,
    width: 600,
    height: 400,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    layerColor: '#6E7BF2',
  };

  const innerGroup: GroupNode = {
    id: 'group-inner',
    type: 'group',
    parentId: 'group-outer',
    name: 'Masked Artwork',
    x: 140,
    y: 150,
    width: 320,
    height: 240,
    rotation: 0,
    opacity: 0.95,
    visible: true,
    locked: false,
    onCanvas: true,
  };

  const maskBase: DesignNode = {
    ...createRectNode(0),
    id: 'mask-base',
    parentId: 'group-inner',
    name: 'Mask Base Card',
    x: 140,
    y: 150,
    width: 300,
    height: 220,
  };

  const maskMid: DesignNode = {
    ...createEllipseNode(1),
    id: 'mask-mid',
    parentId: 'group-inner',
    clipMaskBaseId: 'mask-base',
    name: 'Masked Orb',
    x: 180,
    y: 170,
    width: 180,
    height: 180,
  };

  const maskTop: DesignNode = {
    ...createTextNode(2),
    id: 'mask-top',
    parentId: 'group-inner',
    clipMaskBaseId: 'mask-mid',
    name: 'Chained Masked Label',
    text: 'Folio Engine',
    x: 200,
    y: 230,
    width: 140,
    height: 48,
    // Unknown extension metadata preserved across .flop serialization
    ...({ customMotionTrack: { easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', durationMs: 320 } } as Record<string, unknown>),
  };

  // Build a master component containing a group + clipping mask + text + shape
  const masterSourceNodes: DesignNode[] = [
    {
      id: 'src-grp',
      type: 'group',
      name: 'Badge Group',
      x: 0,
      y: 0,
      width: 240,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    },
    {
      ...createRectNode(0),
      id: 'src-bg',
      parentId: 'src-grp',
      name: 'Badge Pill',
      x: 0,
      y: 0,
      width: 240,
      height: 80,
    },
    {
      ...createEllipseNode(1),
      id: 'src-glow',
      parentId: 'src-grp',
      clipMaskBaseId: 'src-bg',
      name: 'Badge Glow',
      x: 150,
      y: -10,
      width: 90,
      height: 90,
    },
    {
      ...createTextNode(2),
      id: 'src-label',
      parentId: 'src-grp',
      name: 'Badge Title',
      text: 'Primary CTA',
      x: 24,
      y: 22,
      width: 192,
      height: 36,
    },
  ];

  const component = buildComponentDefinitionFromNodes(
    masterSourceNodes,
    ['src-grp'],
    'Action Badge',
    { id: 'comp-action-badge', now },
  );
  if (!component) throw new Error('Expected component definition to be created');

  const mainInstance = {
    ...createComponentInstance(component, 520, 420, 'inst-main-1'),
    parentId: 'group-outer',
    overrides: {
      'src-label': { text: 'Launch Studio', fill: '#FFFFFF' },
      'src-bg': { fill: '#2B3048' },
    },
  };

  const detailInstance = {
    ...createComponentInstance(component, 80, 90, 'inst-detail-1'),
    overrides: {
      'src-label': { text: 'Secondary Action' },
    },
  };

  const project: FolioProject = {
    ...base,
    format: FOLIO_FORMAT,
    formatVersion: FOLIO_FORMAT_VERSION,
    metadata: {
      ...base.metadata,
      createdAt: now,
      updatedAt: now,
    },
    activePageId: 'page-main',
    pages: [
      {
        id: 'page-main',
        name: 'Main Page',
        route: '/',
        document: {
          id: 'doc-main',
          name: 'Main Page',
          width: 1440,
          height: 900,
          background: '#F5F2EC',
          nodes: [outerGroup, innerGroup, maskBase, maskMid, maskTop, mainInstance],
          ...({ gridSnap: 8 } as Record<string, unknown>),
        },
        ...({ seoTitle: 'Folio Home' } as Record<string, unknown>),
      },
      {
        id: 'page-detail',
        name: 'Detail Page',
        route: '/detail',
        document: {
          id: 'doc-detail',
          name: 'Detail Page',
          width: 1280,
          height: 800,
          background: '#161822',
          nodes: [detailInstance],
        },
      },
    ],
    components: [component],
    logicGraphs: [{
      id: 'graph-1',
      name: 'CTA Click',
      scope: 'page',
      targetId: 'page-main',
      nodes: [],
      connections: [],
      createdAt: now,
      updatedAt: now,
    }],
    assets: [{
      id: 'asset-1',
      kind: 'image',
      name: 'hero.png',
      mimeType: 'image/png',
      source: '/assets/hero.png',
      createdAt: now,
    }],
    ...({ futureWorkspaceMeta: { version: 3, theme: 'obsidian' } } as Record<string, unknown>),
  };

  return project;
}

describe('Tahap A — Native Foundation Engine Hardening', () => {
  it('preserves full multi-page, nested Group, chained Clipping Mask, Component Master/Instance Overrides, and unknown extensions through .flop v2 round-trip', () => {
    const original = buildComplexProject();
    expect(requireValidProject(original)).toBeTruthy();

    const serialized = JSON.stringify(original, null, 2);
    const parsed = JSON.parse(serialized) as unknown;
    const roundTripped = migrateProjectToV2(parsed);

    // Exact lossless structural & extension field preservation
    expect(roundTripped).toEqual(original);
    expect((roundTripped as unknown as Record<string, unknown>).futureWorkspaceMeta).toEqual({
      version: 3,
      theme: 'obsidian',
    });
    expect((roundTripped.pages[0] as unknown as Record<string, unknown>).seoTitle).toBe('Folio Home');
    expect((roundTripped.pages[0].document as unknown as Record<string, unknown>).gridSnap).toBe(8);

    // Chained clipping mask integrity after round-trip
    const mainNodes = roundTripped.pages[0].document.nodes;
    const clipMap = buildLayerClipMaskMap(mainNodes);
    expect(clipMap.get('mask-base')).toEqual([]);
    expect(clipMap.get('mask-mid')).toEqual(['mask-base']);
    expect(clipMap.get('mask-top')).toEqual(['mask-base', 'mask-mid']);

    // Component instance resolution preserves overrides AND master group/mask links
    const component = roundTripped.components[0];
    const mainInstance = mainNodes.find((n) => n.id === 'inst-main-1');
    expect(mainInstance?.type).toBe('component-instance');
    if (mainInstance?.type === 'component-instance') {
      const resolved = resolveComponentInstanceNodes(mainInstance, component);
      const label = resolved.find((n) => n.id === 'src-label');
      const bg = resolved.find((n) => n.id === 'src-bg');
      const glow = resolved.find((n) => n.id === 'src-glow');
      expect(label?.type === 'text' && label.text).toBe('Launch Studio');
      expect(label?.type === 'text' && label.style.fill).toBe('#FFFFFF');
      expect(bg?.type === 'rect' && bg.style.fill).toBe('#2B3048');
      expect(glow?.clipMaskBaseId).toBe('src-bg');

      // Detaching remaps parentId and clipMaskBaseId cleanly without dangling references
      const detached = detachComponentInstance(mainInstance, component);
      const detachedIds = new Set(detached.map((n) => n.id));
      const detachedGlow = detached.find((n) => n.name === 'Badge Glow');
      const detachedBg = detached.find((n) => n.name === 'Badge Pill');
      const detachedGroup = detached.find((n) => n.name === 'Badge Group');
      expect(detachedGroup?.parentId).toBe('group-outer');
      expect(detachedBg?.parentId).toBe(detachedGroup?.id);
      expect(detachedGlow?.parentId).toBe(detachedGroup?.id);
      expect(detachedGlow?.clipMaskBaseId).toBe(detachedBg?.id);
      for (const node of detached) {
        if (node.clipMaskBaseId) {
          expect(detachedIds.has(node.clipMaskBaseId)).toBe(true);
        }
      }
    }
  });

  it('maintains exact structural invariants across execute -> undo -> redo for Group, Mask, Rename, Properties, and Transform operations', () => {
    const initialProject = createInitialProject('Undo Redo Matrix');
    const store = createCanonicalEditorStore(createEditorState(initialProject));

    const rectA = { ...createRectNode(0), id: 'node-a', name: 'Card Base' };
    const ellipseB = { ...createEllipseNode(1), id: 'node-b', name: 'Card Accent' };

    const historyProjects: FolioProject[] = [store.getSnapshot().editorState.project];
    const recordStep = (result: ReturnType<typeof store.dispatchLegacyAction>) => {
      expect(result.status).toBe('committed');
      expect(Object.isFrozen(result.snapshot.editorState)).toBe(true);
      expect(Object.isFrozen(result.snapshot.editorState.project)).toBe(true);
      historyProjects.push(result.snapshot.editorState.project);
    };

    recordStep(store.dispatchLegacyAction({ type: 'add-node', node: rectA }));
    recordStep(store.dispatchLegacyAction({ type: 'add-node', node: ellipseB }));
    recordStep(store.dispatchLegacyAction({
      type: 'transform-nodes',
      nodes: [{ ...ellipseB, x: ellipseB.x + 25, y: ellipseB.y - 10 }],
    }));
    recordStep(store.dispatchLegacyAction({ type: 'mask-layer', nodeId: 'node-b' }));
    recordStep(store.dispatchLegacyAction({ type: 'group-layers', nodeIds: ['node-a', 'node-b'] }));

    const groupedDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const createdGroup = groupedDoc.nodes.find((n) => n.type === 'group');
    expect(createdGroup).toBeTruthy();

    recordStep(store.dispatchLegacyAction({
      type: 'rename-nodes',
      updates: [{ nodeId: createdGroup!.id, name: 'Masked Card Group' }],
    }));
    recordStep(store.dispatchLegacyAction({
      type: 'set-nodes-properties',
      nodeIds: [createdGroup!.id],
      properties: { locked: true, layerColor: '#E8835B' },
    }));
    recordStep(store.dispatchLegacyAction({ type: 'unmask-layer', nodeId: 'node-b' }));
    recordStep(store.dispatchLegacyAction({ type: 'ungroup-layers', nodeIds: [createdGroup!.id] }));

    const totalSteps = historyProjects.length - 1;
    expect(totalSteps).toBe(9);

    const stripUpdatedAt = (project: FolioProject) => ({
      ...project,
      metadata: { ...project.metadata, updatedAt: '__normalized__' },
    });

    // Undo every single step and verify exact project structural equality at every frame
    for (let step = totalSteps - 1; step >= 0; step--) {
      const undoRes = store.dispatchLegacyAction({ type: 'undo' });
      expect(undoRes.status).toBe('committed');
      expect(stripUpdatedAt(undoRes.snapshot.editorState.project)).toEqual(
        stripUpdatedAt(historyProjects[step]),
      );
    }

    // Redo every single step and verify exact project structural equality at every frame
    for (let step = 1; step <= totalSteps; step++) {
      const redoRes = store.dispatchLegacyAction({ type: 'redo' });
      expect(redoRes.status).toBe('committed');
      expect(stripUpdatedAt(redoRes.snapshot.editorState.project)).toEqual(
        stripUpdatedAt(historyProjects[step]),
      );
    }
  });

  it('caches frozen project validation in editorStore while strictly rejecting tampered or invalid candidates and history entries', () => {
    const base = createInitialProject('Store Cache & Integrity');
    // Seed 200 nodes to ensure 60 commits exercise the O(1) frozen-history fast-path meaningfully
    const seededNodes: DesignNode[] = [...base.pages[0].document.nodes];
    for (let i = 0; i < 200; i++) {
      seededNodes.push({ ...createRectNode(i % 10), id: `seed-${i}`, name: `Seed ${i}` });
    }
    const largeProject: FolioProject = {
      ...base,
      pages: [{
        ...base.pages[0],
        document: { ...base.pages[0].document, nodes: seededNodes },
      }],
    };

    const store = createCanonicalEditorStore(createEditorState(largeProject));
    const startMs = performance.now();

    // Fill the full 200-entry delta history buffer via rapid commits
    for (let i = 0; i < 205; i++) {
      const res = store.dispatchLegacyAction({
        type: 'rename-project',
        name: `Revision ${i + 1}`,
      });
      expect(res.status).toBe('committed');
    }

    const elapsedMs = performance.now() - startMs;
    expect(store.getSnapshot().editorState.past.length).toBe(200);
    expect(store.getSnapshot().projectRevision).toBe(205);
    // 205 commits with 200 O(delta) historical entries of 200+ nodes should be comfortably fast
    expect(elapsedMs).toBeLessThan(2000);

    // No-op transition does not bump projectRevision
    const beforeNoop = store.getSnapshot();
    const noopResult = store.commitEditorTransition({
      expectedProjectRevision: beforeNoop.projectRevision,
      expectedEditorState: beforeNoop.editorState,
      candidateState: beforeNoop.editorState,
    });
    expect(noopResult.status).toBe('committed');
    expect(noopResult.snapshot.projectRevision).toBe(beforeNoop.projectRevision);

    // Tampered unfrozen candidate project MUST be rejected even with WeakSet caching enabled
    const tamperedCandidate = {
      ...beforeNoop.editorState,
      project: {
        ...beforeNoop.editorState.project,
        formatVersion: 999 as unknown as 2,
      },
    };
    const tamperedRes = store.commitEditorTransition({
      expectedProjectRevision: beforeNoop.projectRevision,
      expectedEditorState: beforeNoop.editorState,
      candidateState: tamperedCandidate,
    });
    expect(tamperedRes.status).toBe('failed');
    if (tamperedRes.status === 'failed') {
      expect(tamperedRes.errorCode).toBe('INVALID_EDITOR_STATE');
    }

    // Tampered historical delta entry inside `past` (smuggling reserved Component Canvas ID) MUST be rejected
    const badHistoryDelta = {
      id: 'delta-tampered',
      metadataBefore: {
        ...beforeNoop.editorState.project.metadata,
        id: 'folio-component-canvas',
      },
      pages: [],
      components: [],
    };
    const badHistoryRes = store.commitEditorTransition({
      expectedProjectRevision: beforeNoop.projectRevision,
      expectedEditorState: beforeNoop.editorState,
      candidateState: {
        ...beforeNoop.editorState,
        past: [...beforeNoop.editorState.past.slice(1), badHistoryDelta],
      },
    });
    expect(badHistoryRes.status).toBe('failed');
    if (badHistoryRes.status === 'failed') {
      expect(badHistoryRes.errorCode).toBe('INVALID_EDITOR_STATE');
    }
  });

  it('computes identical clip-mask chains in O(N) via buildLayerClipMaskMap and handles cyclic graphs safely in getEffectiveLayerStates', () => {
    const groupA: GroupNode = {
      id: 'g-a',
      type: 'group',
      name: 'Group A',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: false,
      locked: true,
      onCanvas: true,
      layerColor: '#4ECDC4',
    };
    const mask1: DesignNode = { ...createRectNode(0), id: 'm-1', parentId: 'g-a', name: 'Mask 1' };
    const mask2: DesignNode = { ...createEllipseNode(1), id: 'm-2', parentId: 'g-a', clipMaskBaseId: 'm-1', name: 'Mask 2' };
    const maskedGroup: GroupNode = {
      id: 'g-masked',
      type: 'group',
      parentId: 'g-a',
      clipMaskBaseId: 'm-2',
      name: 'Masked Group',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    };
    const leaf: DesignNode = { ...createTextNode(2), id: 'leaf', parentId: 'g-masked', name: 'Leaf Text' };

    // Deliberately cyclic pair to verify cycle protection
    const cyclicA: GroupNode = {
      id: 'cyc-a',
      type: 'group',
      parentId: 'cyc-b',
      clipMaskBaseId: 'cyc-b',
      name: 'Cycle A',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    };
    const cyclicB: GroupNode = {
      id: 'cyc-b',
      type: 'group',
      parentId: 'cyc-a',
      clipMaskBaseId: 'cyc-a',
      name: 'Cycle B',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      onCanvas: true,
    };

    const nodes: DesignNode[] = [groupA, mask1, mask2, maskedGroup, leaf, cyclicA, cyclicB];
    const batchMap = buildLayerClipMaskMap(nodes);

    for (const node of nodes) {
      expect(batchMap.get(node.id)).toEqual(getLayerClipMaskBaseIds(nodes, node.id));
    }
    expect(batchMap.get('leaf')).toEqual(['m-1', 'm-2']);

    const effective = getEffectiveLayerStates(nodes);
    expect(effective.get('leaf')).toEqual({
      visible: false,
      locked: true,
    });
    expect(effective.get('g-masked')).toEqual({
      visible: false,
      locked: true,
    });
    expect(effective.get('cyc-a')?.visible).toBe(true);
    expect(effective.get('cyc-b')?.visible).toBe(true);

    // Performance check on 1,000 nodes
    const largeNodes: DesignNode[] = [];
    for (let i = 0; i < 1000; i++) {
      const parentId = i > 0 && i % 10 !== 0 ? `n-${Math.floor(i / 10) * 10}` : undefined;
      const clipMaskBaseId = i % 10 === 2 ? `n-${i - 1}` : undefined;
      largeNodes.push({
        ...createRectNode(i % 5),
        id: `n-${i}`,
        name: `Node ${i}`,
        ...(parentId ? { parentId } : {}),
        ...(clipMaskBaseId ? { clipMaskBaseId } : {}),
      });
    }
    const t0 = performance.now();
    const largeMasks = buildLayerClipMaskMap(largeNodes);
    const largeStates = getEffectiveLayerStates(largeNodes);
    const dt = performance.now() - t0;
    expect(largeMasks.size).toBe(1000);
    expect(largeStates.size).toBe(1000);
    expect(dt).toBeLessThan(100);
  });

  it('isolates toolbar hint updates via ToolbarHintStore with value-equality deduplication and clean unsubscribe', () => {
    const store = createToolbarHintStore();
    expect(store.getHint()).toEqual(DEFAULT_TOOLBAR_HINT);

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    // Setting an identical hint must not fire subscribers
    expect(store.setHint({ ...DEFAULT_TOOLBAR_HINT })).toBe(false);
    expect(notifications).toBe(0);

    // Setting a new hint fires once
    expect(store.setHint({
      panel: 'Navigation',
      description: 'Pan and zoom the active canvas.',
      shortcuts: ['SPACE: PAN', 'WHEEL: ZOOM'],
    })).toBe(true);
    expect(notifications).toBe(1);
    expect(store.getHint().panel).toBe('Navigation');

    // Repeating the same values (new object + array reference) must not fire subscribers
    expect(store.setHint({
      panel: 'Navigation',
      description: 'Pan and zoom the active canvas.',
      shortcuts: ['SPACE: PAN', 'WHEEL: ZOOM'],
    })).toBe(false);
    expect(notifications).toBe(1);

    // Unsubscribing stops notifications
    unsubscribe();
    expect(store.setHint(DEFAULT_TOOLBAR_HINT)).toBe(true);
    expect(notifications).toBe(1);
    expect(store.getHint()).toEqual(DEFAULT_TOOLBAR_HINT);
  });
});
