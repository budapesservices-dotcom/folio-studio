import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, createInitialProject, createNodeForDocument } from '../src/core/document/factory';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import { createComponentInstance } from '../src/core/document/components';
import { classifyNodeChange, hasExtendedNodeChange } from '../src/core/document/nodeChanges';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  EllipseNode,
  FrameNode,
  GroupNode,
  PathNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import type { NativeChangeEvent } from '../src/core/commands/types';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import {
  createComponentCanvasCommandClient,
  createMainCanvasCommandClient,
} from '../src/app/mainCanvasCommandClient';
import { createToolOperation } from '../src/core/tools/operationContract';
import {
  evaluateToolOperation,
  evaluateToolOperationBatch,
} from '../src/engines/canvas/geometryEngine';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';
import {
  advanceComponentCanvasSyncSession,
  createComponentCanvasBufferProject,
  createComponentCanvasSyncAction,
  createComponentCanvasSyncSession,
  reconcileComponentCanvasSyncSession,
  shouldProtectComponentCanvasBuffer,
} from '../src/app/componentCanvasSync';

function createRichTestProject() {
  const project = createInitialProject('Stabilization Suite');
  const page = getActivePage(project);
  const baseDoc = page.document;

  const group: GroupNode = {
    id: 'node-group-1',
    type: 'group',
    name: 'Container Group',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  const frame: FrameNode = {
    id: 'node-frame-1',
    type: 'frame',
    name: 'Card Frame',
    x: 20,
    y: 20,
    width: 300,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    clipContent: false,
    isSection: false,
    style: { fill: '#1e293b', stroke: '#334155', strokeWidth: 1, radius: 8 },
  };

  const rect: RectNode = {
    id: 'node-rect-1',
    type: 'rect',
    name: 'Hero Rect',
    x: 40,
    y: 40,
    width: 120,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: { fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 2, radius: 4 },
  };

  const ellipse: EllipseNode = {
    id: 'node-ellipse-1',
    type: 'ellipse',
    name: 'Badge Ellipse',
    x: 200,
    y: 40,
    width: 64,
    height: 64,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: { fill: '#10b981', stroke: '#047857', strokeWidth: 2 },
  };

  const text: TextNode = {
    id: 'node-text-1',
    type: 'text',
    name: 'Headline',
    x: 40,
    y: 140,
    width: 240,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: 'Initial Title',
    style: {
      fill: '#f8fafc',
      fontSize: 20,
      fontFamily: 'Inter',
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.4,
    },
  };

  const path: PathNode = {
    id: 'node-path-1',
    type: 'path',
    name: 'Vector Shape',
    x: 320,
    y: 40,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: true,
    pathKind: 'polygon',
    shapeMeta: { kind: 'polygon', sides: 6 },
    points: [
      { id: 'pt-1', x: 50, y: 0, pointType: 'corner' },
      { id: 'pt-2', x: 100, y: 50, pointType: 'corner' },
      { id: 'pt-3', x: 50, y: 100, pointType: 'corner' },
      { id: 'pt-4', x: 0, y: 50, pointType: 'corner' },
    ],
    style: {
      fill: '#f59e0b',
      stroke: '#b45309',
      strokeWidth: 2,
      strokeLinecap: 'butt',
      strokeLinejoin: 'miter',
      fillRule: 'nonzero',
      arrowStart: false,
      arrowEnd: false,
    },
  };

  const horizontalLine: PathNode = {
    id: 'node-line-h',
    type: 'path',
    name: 'Horizontal Divider',
    x: 40,
    y: 260,
    width: 200,
    height: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: false,
    pathKind: 'line',
    points: [
      { id: 'lh-1', x: 0, y: 0, pointType: 'corner' },
      { id: 'lh-2', x: 200, y: 0, pointType: 'corner' },
    ],
    style: {
      fill: 'none',
      stroke: '#94a3b8',
      strokeWidth: 2,
      strokeLinecap: 'round',
    },
  };

  const compDoc = createEmptyDocument('Button Master', 160, 48);
  const compBg: RectNode = {
    ...(createNodeForDocument('rect', compDoc) as RectNode),
    id: 'comp-bg',
    name: 'Button Background',
  };
  const compLabel: TextNode = {
    ...(createNodeForDocument('text', compDoc) as TextNode),
    id: 'comp-label',
    name: 'Button Label',
    text: 'Click',
  };
  const compDef: ComponentDefinition = {
    id: 'comp-btn',
    name: 'Button Master',
    document: { ...compDoc, nodes: [compBg, compLabel] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const instance: ComponentInstanceNode = {
    ...createComponentInstance(compDef, 40, 300),
    id: 'node-inst-1',
  };

  project.components = [compDef];
  page.document = {
    ...baseDoc,
    nodes: [group, frame, rect, ellipse, text, path, horizontalLine, instance],
  };

  return {
    project,
    nodes: { group, frame, rect, ellipse, text, path, horizontalLine, instance },
    compDef,
  };
}

function createWorkspaceHarness(workspace: 'main' | 'component', project: ReturnType<typeof createInitialProject>) {
  const store = createCanonicalEditorStore(createEditorState(project), { workspace });
  const commandClient = workspace === 'main'
    ? createMainCanvasCommandClient(store)
    : createComponentCanvasCommandClient(store);
  const events: NativeChangeEvent[] = [];
  store.subscribeChanges((event) => events.push(event));

  const selectionSpy = vi.fn();
  const toolSpy = vi.fn();
  const noticeSpy = vi.fn();
  const commitSpy = vi.fn();

  const executor = createToolOperationExecutor({
    workspace,
    commandClient,
    shell: {
      onSelectionChange: (ids) => {
        selectionSpy(ids);
        commandClient.selectNodes(ids);
      },
      onPanChange: () => {},
      onZoomChange: () => {},
      onToolChange: toolSpy,
      onNotice: noticeSpy,
      onCanvasMutationCommitted: commitSpy,
    },
  });

  return { store, commandClient, executor, events, selectionSpy, toolSpy, noticeSpy, commitSpy };
}

describe('Native Engine Stabilization — Unified Node Change Classification & Zero Silent Loss', () => {
  it('accepts null and undefined safely in classifyNodeChange and hasExtendedNodeChange', () => {
    const { nodes } = createRichTestProject();
    expect(classifyNodeChange(null, nodes.rect)).toEqual({
      kind: 'none',
      hasTransformChange: false,
      hasExtendedChange: false,
      hasAnyChange: false,
    });
    expect(classifyNodeChange(undefined, nodes.rect).hasAnyChange).toBe(false);
    expect(hasExtendedNodeChange(null, nodes.rect)).toBe(false);
    expect(hasExtendedNodeChange(undefined, nodes.rect)).toBe(false);
  });

  it('delivers every valid single-node change category (transform, structure, name, opacity, text, frame, shape, path, component-instance) from Geometry Engine to canonical state without loss', () => {
    const { project, nodes } = createRichTestProject();
    const { store, commandClient, executor, events } = createWorkspaceHarness('main', project);

    const applyAndAssert = (
      label: string,
      updatedNode: DesignNode,
      assertCommitted: (committed: DesignNode) => void,
    ) => {
      const docBefore = getActiveDocument(store.getSnapshot().editorState.project);
      const revBefore = store.getSnapshot().projectRevision;
      const eventsBefore = events.length;

      const evaluated = evaluateToolOperation(
        createToolOperation('select', 'main', {
          kind: 'transform-nodes',
          nodes: [updatedNode],
        }, { description: label }),
        { document: docBefore, selectedNodeIds: [updatedNode.id] },
      );

      expect(evaluated.status, `${label}: Geometry Engine must accept change`).toBe('ready');
      if (evaluated.status !== 'ready') return;

      const report = executor.execute(evaluated.operation);
      expect(report.status, `${label}: Native Command Engine must apply change`).toBe('applied');
      expect(store.getSnapshot().projectRevision, `${label}: single revision bump`).toBe(revBefore + 1);
      expect(events.length, `${label}: single NativeChangeEvent`).toBe(eventsBefore + 1);

      const committed = commandClient.getActiveAstView().getNode(updatedNode.id);
      expect(committed, `${label}: node must exist`).not.toBeNull();
      if (committed) assertCommitted(committed);

      // Verify clean Undo & Redo round-trip
      expect(commandClient.undo().status).toBe('applied');
      expect(commandClient.redo().status).toBe('applied');
      const afterRedo = commandClient.getActiveAstView().getNode(updatedNode.id);
      expect(afterRedo).not.toBeNull();
      if (afterRedo) assertCommitted(afterRedo);
    };

    // 1. Affine transform (x, y, width, height, rotation)
    applyAndAssert('affine transform', { ...nodes.rect, x: 95, y: 110, width: 150, height: 95, rotation: 15 }, (n) => {
      expect(n.x).toBe(95);
      expect(n.y).toBe(110);
      expect(n.width).toBe(150);
      expect(n.height).toBe(95);
      expect(n.rotation).toBe(15);
    });

    // 2. Zero-height horizontal line translation (must NOT fail positive-dimension validation in node.transform)
    applyAndAssert('horizontal line drag', { ...nodes.horizontalLine, x: 80, y: 290 }, (n) => {
      expect(n.x).toBe(80);
      expect(n.y).toBe(290);
      expect(n.height).toBe(0);
    });

    // 3. Name-only change
    const currentRect1 = commandClient.getActiveAstView().getNode(nodes.rect.id) as RectNode;
    applyAndAssert('name change', { ...currentRect1, name: 'Primary CTA Card' }, (n) => {
      expect(n.name).toBe('Primary CTA Card');
    });

    // 4. Opacity-only change
    const currentRect2 = commandClient.getActiveAstView().getNode(nodes.rect.id) as RectNode;
    applyAndAssert('opacity change', { ...currentRect2, opacity: 0.45 }, (n) => {
      expect(n.opacity).toBe(0.45);
    });

    // 5. Structure changes: parentId, clipMaskBaseId, onCanvas false -> undefined
    const currentRect3 = commandClient.getActiveAstView().getNode(nodes.rect.id) as RectNode;
    applyAndAssert('structure parentId + clipMaskBaseId', {
      ...currentRect3,
      parentId: nodes.group.id,
      clipMaskBaseId: nodes.frame.id,
      layerColor: '#ec4899',
    }, (n) => {
      expect(n.parentId).toBe(nodes.group.id);
      expect(n.clipMaskBaseId).toBe(nodes.frame.id);
      expect(n.layerColor).toBe('#ec4899');
    });

    const currentRect4 = commandClient.getActiveAstView().getNode(nodes.rect.id) as RectNode;
    applyAndAssert('onCanvas set false', { ...currentRect4, onCanvas: false }, (n) => {
      expect(n.onCanvas).toBe(false);
    });

    const currentRect5 = commandClient.getActiveAstView().getNode(nodes.rect.id) as RectNode;
    applyAndAssert('onCanvas unset undefined', { ...currentRect5, onCanvas: undefined }, (n) => {
      expect(n.onCanvas).toBeUndefined();
    });

    // 6. Text content + typography styles
    applyAndAssert('text content & typography', {
      ...nodes.text,
      text: 'Updated Headline Copy',
      style: {
        fill: '#38bdf8',
        fontSize: 32,
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        letterSpacing: 1.5,
        lineHeight: 1.25,
      },
    }, (n) => {
      expect(n.type).toBe('text');
      if (n.type !== 'text') return;
      expect(n.text).toBe('Updated Headline Copy');
      expect(n.style).toEqual({
        fill: '#38bdf8',
        fontSize: 32,
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        letterSpacing: 1.5,
        lineHeight: 1.25,
      });
    });

    // 7. Frame clipContent + isSection + style
    applyAndAssert('frame clipContent & isSection', {
      ...nodes.frame,
      clipContent: true,
      isSection: true,
      style: { ...nodes.frame.style, fill: '#0f172a', radius: 20 },
    }, (n) => {
      expect(n.type).toBe('frame');
      if (n.type !== 'frame') return;
      expect(n.clipContent).toBe(true);
      expect(n.isSection).toBe(true);
      expect(n.style.fill).toBe('#0f172a');
      expect(n.style.radius).toBe(20);
    });

    // 8. Shape (ellipse) style change
    applyAndAssert('ellipse style', {
      ...nodes.ellipse,
      style: { fill: '#22c55e', stroke: '#15803d', strokeWidth: 4 },
    }, (n) => {
      expect(n.type).toBe('ellipse');
      if (n.type !== 'ellipse') return;
      expect(n.style).toEqual({ fill: '#22c55e', stroke: '#15803d', strokeWidth: 4 });
    });

    // 9. Path: subpaths, pathKind, shapeMeta, strokeLinecap/Linejoin/Dasharray/fillRule/arrows, closed
    applyAndAssert('path subpaths & vector attributes', {
      ...nodes.path,
      closed: false,
      pathKind: 'boolean',
      shapeMeta: { kind: 'star', spikes: 5, innerRatio: 0.45 },
      subpaths: [
        {
          closed: true,
          points: [
            { id: 'hole-1', x: 35, y: 35, pointType: 'corner' },
            { id: 'hole-2', x: 65, y: 35, pointType: 'corner' },
            { id: 'hole-3', x: 50, y: 65, pointType: 'corner' },
          ],
        },
      ],
      style: {
        ...nodes.path.style,
        strokeLinecap: 'round',
        strokeLinejoin: 'bevel',
        strokeDasharray: '6 4',
        fillRule: 'evenodd',
        arrowStart: true,
        arrowEnd: true,
      },
    }, (n) => {
      expect(n.type).toBe('path');
      if (n.type !== 'path') return;
      expect(n.closed).toBe(false);
      expect(n.pathKind).toBe('boolean');
      expect(n.shapeMeta).toEqual({ kind: 'star', spikes: 5, innerRatio: 0.45 });
      expect(n.subpaths).toHaveLength(1);
      expect(n.style.strokeLinecap).toBe('round');
      expect(n.style.strokeLinejoin).toBe('bevel');
      expect(n.style.strokeDasharray).toBe('6 4');
      expect(n.style.fillRule).toBe('evenodd');
      expect(n.style.arrowStart).toBe(true);
      expect(n.style.arrowEnd).toBe(true);
    });

    // 10. Component instance overrides
    applyAndAssert('component-instance overrides', {
      ...nodes.instance,
      overrides: {
        'comp-bg': { fill: '#ef4444' },
        'comp-label': { text: 'Submit' },
      },
    }, (n) => {
      expect(n.type).toBe('component-instance');
      if (n.type !== 'component-instance') return;
      expect(n.overrides).toEqual({
        'comp-bg': { fill: '#ef4444' },
        'comp-label': { text: 'Submit' },
      });
    });
  });

  it('persists multi-node extended updates (name, parentId, pathKind, subpaths, overrides) via node.update-many without editorReducer dropping them', () => {
    const { project, nodes } = createRichTestProject();
    const { store, commandClient, executor, events } = createWorkspaceHarness('main', project);

    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const updatedRect: RectNode = { ...nodes.rect, name: 'Batch Renamed Rect', parentId: nodes.group.id };
    const updatedPath: PathNode = {
      ...nodes.path,
      pathKind: 'outline',
      subpaths: [{ closed: true, points: [{ id: 'sp1', x: 10, y: 10, pointType: 'corner' }, { id: 'sp2', x: 20, y: 20, pointType: 'corner' }] }],
    };
    const updatedInstance: ComponentInstanceNode = {
      ...nodes.instance,
      overrides: { 'comp-label': { text: 'Batch Label' } },
    };

    const evaluated = evaluateToolOperation(
      createToolOperation('select', 'main', {
        kind: 'transform-nodes',
        nodes: [updatedRect, updatedPath, updatedInstance],
      }),
      { document: doc, selectedNodeIds: [updatedRect.id, updatedPath.id, updatedInstance.id] },
    );

    expect(evaluated.status).toBe('ready');
    if (evaluated.status !== 'ready') return;

    const revBefore = store.getSnapshot().projectRevision;
    const report = executor.execute(evaluated.operation);

    expect(report.status).toBe('applied');
    expect(store.getSnapshot().projectRevision).toBe(revBefore + 1);
    expect(events).toHaveLength(1);

    const ast = commandClient.getActiveAstView();
    expect(ast.getNode(nodes.rect.id)?.name).toBe('Batch Renamed Rect');
    expect(ast.getNode(nodes.rect.id)?.parentId).toBe(nodes.group.id);
    const committedPath = ast.getNode(nodes.path.id);
    expect(committedPath?.type === 'path' ? committedPath.pathKind : null).toBe('outline');
    expect(committedPath?.type === 'path' ? committedPath.subpaths?.length : 0).toBe(1);
    const committedInst = ast.getNode(nodes.instance.id);
    expect(committedInst?.type === 'component-instance' ? committedInst.overrides['comp-label']?.text : null).toBe('Batch Label');

    // Single Undo reverts all 3 nodes atomically
    expect(commandClient.undo().status).toBe('applied');
    expect(commandClient.getActiveAstView().getNode(nodes.rect.id)?.name).toBe('Hero Rect');
    expect(commandClient.getActiveAstView().getNode(nodes.rect.id)?.parentId).toBeUndefined();
    const undoneInst = commandClient.getActiveAstView().getNode(nodes.instance.id);
    expect(undoneInst?.type === 'component-instance' ? undoneInst.overrides : null).toEqual({});
  });

  it('rejects node type mutation and duplicate node IDs consistently in Geometry Engine and Native Command Engine', () => {
    const { project, nodes } = createRichTestProject();
    const { store, commandClient } = createWorkspaceHarness('main', project);
    const doc = getActiveDocument(store.getSnapshot().editorState.project);

    // Geometry Engine rejects type mutation in transform-nodes
    const forgedTypeNode: EllipseNode = {
      ...nodes.ellipse,
      id: nodes.rect.id,
    };
    const geoTypeCheck = evaluateToolOperation(
      createToolOperation('select', 'main', {
        kind: 'transform-nodes',
        nodes: [forgedTypeNode],
      }),
      { document: doc, selectedNodeIds: [nodes.rect.id] },
    );
    expect(geoTypeCheck.status).toBe('rejected');
    if (geoTypeCheck.status === 'rejected') {
      expect(geoTypeCheck.code).toBe('UNSUPPORTED_TARGET_TYPE');
    }

    // Geometry Engine rejects duplicate target IDs in transform-nodes
    const geoDupCheck = evaluateToolOperation(
      createToolOperation('select', 'main', {
        kind: 'transform-nodes',
        nodes: [{ ...nodes.rect, x: 10 }, { ...nodes.rect, x: 20 }],
      }),
      { document: doc, selectedNodeIds: [nodes.rect.id] },
    );
    expect(geoDupCheck.status).toBe('rejected');
    if (geoDupCheck.status === 'rejected') {
      expect(geoDupCheck.code).toBe('DUPLICATE_NODE_ID');
    }

    // Native Command Engine rejects type mutation in node.update-many as well
    const revBefore = store.getSnapshot().projectRevision;
    const directRes = commandClient.transformNodes([
      forgedTypeNode,
      { ...nodes.frame, clipContent: true },
    ]);
    expect(directRes.status).toBe('rejected');
    expect(directRes.code).toBe('INVALID_PAYLOAD');
    expect(store.getSnapshot().projectRevision).toBe(revBefore);
  });
});

describe('Native Engine Stabilization — Atomic Batch Transactions on Main & Component Canvas', () => {
  it('commits multi-operation batches atomically on Component Canvas with single revision, single event, single Undo/Redo, and fail-closed rollback', () => {
    const { compDef } = createRichTestProject();
    const bufferProject = createComponentCanvasBufferProject(compDef);
    const { store, commandClient, executor, events, selectionSpy, toolSpy, noticeSpy, commitSpy } =
      createWorkspaceHarness('component', bufferProject);

    const initialDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const initialCount = initialDoc.nodes.length;
    const newFrame: FrameNode = {
      id: 'comp-frame-new',
      type: 'frame',
      name: 'Icon Slot',
      x: 10,
      y: 10,
      width: 48,
      height: 48,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      clipContent: false,
      style: { fill: '#334155', stroke: '#64748b', strokeWidth: 1, radius: 6 },
    };
    const refinedFrame: FrameNode = {
      ...newFrame,
      name: 'Icon Slot Clipped',
      x: 16,
      clipContent: true,
      opacity: 0.9,
    };

    const evaluated = evaluateToolOperationBatch(
      [
        createToolOperation('frame', 'component', { kind: 'create-nodes', nodes: [newFrame] }),
        createToolOperation('select', 'component', { kind: 'transform-nodes', nodes: [refinedFrame] }),
        createToolOperation('select', 'component', { kind: 'select-nodes', nodeIds: [newFrame.id] }),
        createToolOperation('frame', 'component', { kind: 'switch-tool', nextToolId: 'select' }),
        createToolOperation('frame', 'component', { kind: 'notify', message: 'Component slot added' }),
      ],
      { document: initialDoc, selectedNodeIds: [] },
    );

    expect(evaluated.status).toBe('ready');
    expect(evaluated.ready).toHaveLength(5);

    const revBefore = store.getSnapshot().projectRevision;
    const pastBefore = store.getSnapshot().editorState.past.length;
    const reports = executor.executeBatch(evaluated.ready);

    expect(reports.every((r) => r.status === 'applied')).toBe(true);
    expect(reports[0].transactionId).toBeTruthy();
    expect(reports[1].transactionId).toBe(reports[0].transactionId);

    // Strictly ONE revision bump, ONE NativeChangeEvent with workspace 'component', ONE Undo entry
    expect(store.getSnapshot().projectRevision).toBe(revBefore + 1);
    expect(store.getSnapshot().editorState.past).toHaveLength(pastBefore + 1);
    expect(events).toHaveLength(1);
    expect(events[0].source.workspace).toBe('component');
    expect(events[0].transactionId).toBe(reports[0].transactionId);
    expect(events[0].change.commandIds).toHaveLength(2);

    const committed = commandClient.getActiveAstView().getNode(newFrame.id);
    expect(committed?.type).toBe('frame');
    if (committed?.type === 'frame') {
      expect(committed.name).toBe('Icon Slot Clipped');
      expect(committed.x).toBe(16);
      expect(committed.clipContent).toBe(true);
      expect(committed.opacity).toBe(0.9);
    }

    expect(selectionSpy).toHaveBeenCalledWith([newFrame.id]);
    expect(toolSpy).toHaveBeenCalledWith('select');
    expect(noticeSpy).toHaveBeenCalledWith('Component slot added');
    expect(commitSpy).toHaveBeenCalledTimes(2);

    // Single Undo reverts BOTH create + refined transform atomically
    expect(commandClient.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes).toHaveLength(initialCount);
    expect(commandClient.getActiveAstView().getNode(newFrame.id)).toBeNull();

    // Single Redo restores BOTH mutations atomically
    expect(commandClient.redo().status).toBe('applied');
    const redone = commandClient.getActiveAstView().getNode(newFrame.id);
    expect(redone?.type === 'frame' ? redone.clipContent : false).toBe(true);

    // Fail-closed rollback on Component Canvas when a later target becomes locked before commit
    const existingBg = commandClient.getActiveAstView().getNode('comp-bg') as RectNode;
    const tempNode: RectNode = {
      ...(createNodeForDocument('rect', getActiveDocument(store.getSnapshot().editorState.project)) as RectNode),
      id: 'comp-rollback-rect',
    };
    const rollbackBatch = evaluateToolOperationBatch(
      [
        createToolOperation('draw-rect', 'component', { kind: 'create-nodes', nodes: [tempNode] }),
        createToolOperation('select', 'component', {
          kind: 'transform-nodes',
          nodes: [{ ...existingBg, name: 'Should Not Commit', x: existingBg.x + 25 }],
        }),
        createToolOperation('measure', 'component', { kind: 'notify', message: 'Must not fire' }),
      ],
      { document: getActiveDocument(store.getSnapshot().editorState.project), selectedNodeIds: [existingBg.id] },
    );
    expect(rollbackBatch.status).toBe('ready');

    // Lock existingBg concurrently before executeBatch runs
    expect(commandClient.setNodesProperties([existingBg.id], { locked: true }).status).toBe('applied');

    const revBeforeFail = store.getSnapshot().projectRevision;
    const pastBeforeFail = store.getSnapshot().editorState.past.length;
    const eventsBeforeFail = events.length;
    noticeSpy.mockClear();

    const failedReports = executor.executeBatch(rollbackBatch.ready);
    expect(failedReports.every((r) => r.status === 'rejected')).toBe(true);
    expect(failedReports[1].commandResult?.code).toBe('LOCKED_TARGET');
    expect(store.getSnapshot().projectRevision).toBe(revBeforeFail);
    expect(store.getSnapshot().editorState.past).toHaveLength(pastBeforeFail);
    expect(events).toHaveLength(eventsBeforeFail);
    expect(commandClient.getActiveAstView().getNode('comp-rollback-rect')).toBeNull();
    expect(commandClient.getActiveAstView().getNode(existingBg.id)?.name).toBe(existingBg.name);
    expect(noticeSpy).not.toHaveBeenCalled();
  });

  it('preserves component buffer isolation, CAS sync, and conflict protection alongside atomic Component Canvas edits', () => {
    const { project, compDef } = createRichTestProject();
    const mainHarness = createWorkspaceHarness('main', project);
    const liveMaster = mainHarness.store.getSnapshot().editorState.project.components.find((c) => c.id === compDef.id)!;
    const bufferProject = createComponentCanvasBufferProject(liveMaster);
    const compHarness = createWorkspaceHarness('component', bufferProject);

    let session = createComponentCanvasSyncSession(liveMaster);
    expect(shouldProtectComponentCanvasBuffer(session, getActiveDocument(compHarness.store.getSnapshot().editorState.project))).toBe(false);

    // Edit buffer via atomic transaction on Component Canvas
    const bufferDoc0 = getActiveDocument(compHarness.store.getSnapshot().editorState.project);
    const bgNode = bufferDoc0.nodes.find((n) => n.id === 'comp-bg') as RectNode;
    const editBatch = evaluateToolOperationBatch(
      [
        createToolOperation('select', 'component', {
          kind: 'transform-nodes',
          nodes: [{ ...bgNode, name: 'Primary Fill', style: { ...bgNode.style, fill: '#6366f1' } }],
        }),
      ],
      { document: bufferDoc0, selectedNodeIds: [bgNode.id] },
    );
    expect(editBatch.status).toBe('ready');
    expect(compHarness.executor.executeBatch(editBatch.ready).every((r) => r.status === 'applied')).toBe(true);

    const editedBufferDoc = getActiveDocument(compHarness.store.getSnapshot().editorState.project);
    // Main Canvas canonical master is strictly isolated until explicit CAS sync
    const canonicalBeforeSync = mainHarness.store.getSnapshot().editorState.project.components.find((c) => c.id === compDef.id)!;
    expect(canonicalBeforeSync.document.nodes.find((n) => n.id === 'comp-bg')?.name).toBe('Button Background');
    expect(shouldProtectComponentCanvasBuffer(session, editedBufferDoc)).toBe(true);

    // Valid CAS sync commits cleanly to Main Canvas and advances sync session
    const syncAction = createComponentCanvasSyncAction(canonicalBeforeSync, editedBufferDoc, session);
    expect(syncAction).not.toBeNull();
    const syncResult = mainHarness.commandClient.syncComponentDocument({
      componentId: syncAction!.componentId,
      document: syncAction!.document,
      updatedAt: syncAction!.updatedAt,
      expectedUpdatedAt: syncAction!.expectedUpdatedAt,
      expectedMasterDocument: syncAction!.expectedMasterDocument,
    });
    expect(syncResult.status).toBe('applied');

    const canonicalAfterSync = mainHarness.store.getSnapshot().editorState.project.components.find((c) => c.id === compDef.id)!;
    expect(canonicalAfterSync.document.nodes.find((n) => n.id === 'comp-bg')?.name).toBe('Primary Fill');
    session = advanceComponentCanvasSyncSession(session, canonicalAfterSync);
    expect(shouldProtectComponentCanvasBuffer(session, editedBufferDoc)).toBe(false);

    // Local dirty edit + concurrent canonical rename => conflict detected, buffer protected, stale sync rejected
    const labelNode = getActiveDocument(compHarness.store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'comp-label') as TextNode;
    expect(compHarness.commandClient.transformNodes([{ ...labelNode, text: 'Local Draft' }]).status).toBe('applied');
    const dirtyBufferDoc = getActiveDocument(compHarness.store.getSnapshot().editorState.project);

    expect(mainHarness.commandClient.renameComponent({
      componentId: canonicalAfterSync.id,
      name: 'Primary Button v2',
      expectedUpdatedAt: canonicalAfterSync.updatedAt,
      expectedMasterDocument: canonicalAfterSync.document,
    }).status).toBe('applied');

    const concurrentlyChangedMaster = mainHarness.store.getSnapshot().editorState.project.components.find((c) => c.id === compDef.id)!;
    const reconciled = reconcileComponentCanvasSyncSession(session, concurrentlyChangedMaster, dirtyBufferDoc);
    expect(reconciled.status).toBe('conflict');
    expect(reconciled.session.conflicted).toBe(true);
    expect(shouldProtectComponentCanvasBuffer(reconciled.session, dirtyBufferDoc)).toBe(true);
    expect(createComponentCanvasSyncAction(concurrentlyChangedMaster, dirtyBufferDoc, reconciled.session)).toBeNull();

    // Even a direct stale sync attempt fails closed with COMPONENT_CONFLICT
    const revBeforeConflict = mainHarness.store.getSnapshot().projectRevision;
    const staleAttempt = mainHarness.commandClient.syncComponentDocument({
      componentId: compDef.id,
      document: dirtyBufferDoc,
      updatedAt: '2026-01-05T00:00:00.000Z',
      expectedUpdatedAt: session.baseUpdatedAt,
      expectedMasterDocument: session.baseDocument,
    });
    expect(staleAttempt.status).toBe('rejected');
    expect(staleAttempt.code).toBe('COMPONENT_CONFLICT');
    expect(mainHarness.store.getSnapshot().projectRevision).toBe(revBeforeConflict);
  });
});
