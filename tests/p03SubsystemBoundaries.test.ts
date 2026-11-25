import { describe, expect, it, vi } from 'vitest';
import { createInitialProject, createNodeForDocument } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import type { DesignNode, PathNode, RectNode, TextNode } from '../src/core/document/types';
import {
  CANVAS_TOOL_IDS,
  createToolOperation,
  extractToolOperationsFromTransition,
  isDocumentMutationOperation,
  isToolOperation,
  TOOL_OPERATION_PROTOCOL,
  TOOL_OPERATION_VERSION,
  validateToolOperationEnvelope,
  validateToolOperationPayload,
  type ToolOperation,
} from '../src/core/tools/operationContract';
import {
  evaluateToolOperation,
  evaluateToolOperationBatch,
  isValidatedToolOperation,
  type ValidatedToolOperation,
} from '../src/engines/canvas/geometryEngine';
import { getBounds } from '../src/engines/canvas/geometry';
import { getStudioTool } from '../src/engines/canvas/tools/studioRegistry';
import type { CanvasToolContext, CanvasToolPointerInput, CanvasToolTransition } from '../src/engines/canvas/tools/types';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import {
  createToolOperationExecutor,
  isValidatedToolOperationEnvelope,
  ToolOperationEnvelopeError,
  validateToolOperationEnvelope as validateExecutorEnvelope,
} from '../src/app/toolOperationExecutor';

const RAW_SRC_FILES = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function makePointer(overrides: Partial<CanvasToolPointerInput> = {}): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point: { x: 100, y: 100 },
    clientX: 100,
    clientY: 100,
    viewportAnchor: { x: 0, y: 0 },
    targetNodeId: null,
    resizeHandle: null,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

function makeToolContext(
  projectNodes: DesignNode[],
  selectedNodeIds: string[] = [],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const project = createInitialProject('P0.3 Test');
  const doc = { ...getActiveDocument(project), nodes: projectNodes };
  const selectedNodes = projectNodes.filter((n) => selectedNodeIds.includes(n.id));
  return {
    document: doc,
    canvasNodes: projectNodes,
    selectableNodes: projectNodes.filter((n) => n.visible && !n.locked),
    otherNodes: projectNodes.filter((n) => n.visible && !n.locked),
    selectedNodeIds,
    selectedNodes,
    selectionBounds: getBounds(selectedNodes),
    zoom: 1,
    canvasUnitsPerPixel: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 1200,
    session: null,
    workspace: 'main',
    ...overrides,
  };
}

function extractImportSpecifiers(source: string): string[] {
  const matches = [...source.matchAll(/^\s*import\s+(?:type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/gm)];
  const sideEffects = [...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)];
  return [...matches.map((m) => m[1]), ...sideEffects.map((m) => m[1])];
}

function readImportsForSrc(relativeFromSrc: string): string[] {
  const key = `../src/${relativeFromSrc}`;
  const source = RAW_SRC_FILES[key];
  expect(source, `Expected source file ${key} to exist`).toBeTypeOf('string');
  return extractImportSpecifiers(source);
}

describe('P0.3 Subsystem Boundaries — Tool Operation Contract', () => {
  it('defines strict versioned envelopes for all studio tool categories', () => {
    expect(CANVAS_TOOL_IDS).toHaveLength(29);

    const project = createInitialProject('Contract Test');
    const doc = getActiveDocument(project);
    const rect = createNodeForDocument('rect', doc);

    const op = createToolOperation('draw-rect', 'main', {
      kind: 'create-nodes',
      nodes: [rect],
    });

    expect(op.protocol).toBe(TOOL_OPERATION_PROTOCOL);
    expect(op.version).toBe(TOOL_OPERATION_VERSION);
    expect(op.category).toBe('document-mutation');
    expect(op.metadata.atomicHistoryStep).toBe(true);
    expect(isDocumentMutationOperation(op)).toBe(true);
    expect(validateToolOperationEnvelope(op)).toEqual({ ok: true });
  });

  it('rejects malformed or mismatched envelopes', () => {
    expect(validateToolOperationEnvelope(null).ok).toBe(false);
    expect(
      validateToolOperationEnvelope({
        protocol: 'wrong.protocol',
        version: 1,
        operationId: 'op-1',
        toolId: 'select',
        workspace: 'main',
        category: 'selection',
        payload: { kind: 'select-nodes', nodeIds: [] },
        metadata: { atomicHistoryStep: false },
      }).ok,
    ).toBe(false);

    expect(
      validateToolOperationEnvelope({
        protocol: TOOL_OPERATION_PROTOCOL,
        version: TOOL_OPERATION_VERSION,
        operationId: 'op-2',
        toolId: 'select',
        workspace: 'main',
        category: 'viewport',
        payload: { kind: 'select-nodes', nodeIds: [] },
        metadata: { atomicHistoryStep: false },
      }).ok,
    ).toBe(false);
  });

  it('extracts deterministic ToolOperations from Studio Tool transitions without leaking preview state', () => {
    const project = createInitialProject('Transition Extraction');
    const doc = getActiveDocument(project);
    const rect = createNodeForDocument('rect', doc);

    const transition: CanvasToolTransition = {
      session: null,
      previewNodes: [rect],
      previewCreateNodes: [rect],
      createNodes: [rect],
      selection: [rect.id],
      nextToolId: 'select',
      notice: 'Created rectangle',
      guides: [],
    };
    const operations = extractToolOperationsFromTransition('draw-rect', 'main', transition);

    expect(operations.map((o) => o.payload.kind)).toEqual([
      'create-nodes',
      'select-nodes',
      'switch-tool',
      'notify',
    ]);
    expect(operations.every((o) => validateToolOperationEnvelope(o).ok)).toBe(true);
  });

  it('validates all 10 ToolOperation payload kinds thoroughly and rejects malformed per-kind payloads', () => {
    const project = createInitialProject('Payload Validation');
    const doc = getActiveDocument(project);
    const rect = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'rect-valid-1' };
    const textNode = { ...(createNodeForDocument('text', doc) as TextNode), id: 'text-valid-1', text: 'Hello' };
    const pathNode: PathNode = {
      id: 'path-valid-1',
      type: 'path',
      name: 'Curve',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: true,
      points: [
        { id: 'pt-1', x: 0, y: 0, pointType: 'corner' },
        { id: 'pt-2', x: 100, y: 0, pointType: 'smooth', handleIn: { x: 80, y: 0 }, handleOut: { x: 100, y: 20 } },
        { id: 'pt-3', x: 50, y: 80, pointType: 'symmetric' },
      ],
      style: { fill: '#4f46e5', stroke: '#111827', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      pathKind: 'pen',
    };

    // Valid envelopes for every single ToolOperationPayload kind
    const validOps: ToolOperation[] = [
      createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [rect] }),
      createToolOperation('draw-text', 'main', {
        kind: 'create-nodes',
        nodes: [textNode],
        openInlineTextForNodeId: textNode.id,
      }),
      createToolOperation('select', 'main', { kind: 'transform-nodes', nodes: [rect, pathNode] }),
      createToolOperation('scissors', 'component', {
        kind: 'replace-node-with-nodes',
        nodeId: pathNode.id,
        nodes: [pathNode],
      }),
      createToolOperation('shape-builder', 'main', {
        kind: 'replace-nodes',
        removeIds: ['old-1', 'old-2'],
        insertNodes: [pathNode],
        selectIds: [pathNode.id],
      }),
      createToolOperation('shape-builder', 'main', {
        kind: 'replace-nodes',
        removeIds: ['old-1'],
        insertNodes: [],
      }),
      createToolOperation('eyedropper', 'main', {
        kind: 'sample-color',
        color: '#8B7CF6',
        sourceName: 'Hero Card',
        target: 'stroke',
      }),
      createToolOperation('draw-text', 'main', {
        kind: 'commit-inline-text',
        nodeId: textNode.id,
        text: '',
      }),
      createToolOperation('select', 'main', { kind: 'select-nodes', nodeIds: [] }),
      createToolOperation('select', 'main', { kind: 'select-nodes', nodeIds: [rect.id] }),
      createToolOperation('hand', 'main', { kind: 'viewport-update', pan: { x: -40, y: 120 } }),
      createToolOperation('scrubby-zoom', 'main', { kind: 'viewport-update', zoom: 1.5, pan: { x: 0, y: 0 } }),
      createToolOperation('draw-rect', 'main', { kind: 'switch-tool', nextToolId: 'select' }),
      createToolOperation('measure', 'main', { kind: 'notify', message: 'Distance measured' }),
    ];

    for (const op of validOps) {
      expect(validateToolOperationEnvelope(op), `Expected ${op.payload.kind} to pass`).toEqual({ ok: true });
      expect(isToolOperation(op)).toBe(true);
    }

    // 1. create-nodes invalid cases
    expect(validateToolOperationPayload({ kind: 'create-nodes', nodes: [] }).code).toBe('EMPTY_OPERATION');
    expect(validateToolOperationPayload({ kind: 'create-nodes', nodes: 'not-array' }).code).toBe('INVALID_PAYLOAD');
    expect(validateToolOperationPayload({ kind: 'create-nodes', nodes: [rect, rect] }).code).toBe('DUPLICATE_NODE_ID');
    expect(
      validateToolOperationPayload({
        kind: 'create-nodes',
        nodes: [rect],
        openInlineTextForNodeId: rect.id,
      }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({
        kind: 'create-nodes',
        nodes: [textNode],
        openInlineTextForNodeId: 'missing-id',
      }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({ kind: 'create-nodes', nodes: [rect], extraKey: true }).code,
    ).toBe('INVALID_PAYLOAD');

    // 2. transform-nodes invalid cases
    expect(validateToolOperationPayload({ kind: 'transform-nodes', nodes: [] }).code).toBe('EMPTY_OPERATION');
    expect(
      validateToolOperationPayload({
        kind: 'transform-nodes',
        nodes: [{ ...rect, opacity: 1.5 }],
      }).code,
    ).toBe('INVALID_GEOMETRY');
    expect(
      validateToolOperationPayload({
        kind: 'transform-nodes',
        nodes: [{ ...pathNode, points: [] }],
      }).code,
    ).toBe('INVALID_GEOMETRY');
    expect(
      validateToolOperationPayload({
        kind: 'transform-nodes',
        nodes: [{ ...pathNode, points: [{ id: 'p1', x: 0, y: 0, pointType: 'invalid-type' }] }],
      }).code,
    ).toBe('INVALID_NODE');

    // 3. replace-node-with-nodes invalid cases
    expect(
      validateToolOperationPayload({ kind: 'replace-node-with-nodes', nodeId: '   ', nodes: [pathNode] }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({ kind: 'replace-node-with-nodes', nodeId: 'p1', nodes: [] }).code,
    ).toBe('EMPTY_OPERATION');

    // 4. replace-nodes invalid cases
    expect(
      validateToolOperationPayload({ kind: 'replace-nodes', removeIds: [], insertNodes: [rect] }).code,
    ).toBe('EMPTY_OPERATION');
    expect(
      validateToolOperationPayload({ kind: 'replace-nodes', removeIds: [''], insertNodes: [] }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({ kind: 'replace-nodes', removeIds: ['r1'], insertNodes: 'bad' }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({ kind: 'replace-nodes', removeIds: ['r1'], insertNodes: [], selectIds: [123] }).code,
    ).toBe('INVALID_PAYLOAD');

    // 5. sample-color invalid cases
    expect(
      validateToolOperationPayload({ kind: 'sample-color', color: '   ', sourceName: 'Card', target: 'fill' }).code,
    ).toBe('INVALID_COLOR');
    expect(
      validateToolOperationPayload({ kind: 'sample-color', color: '#fff', sourceName: 42, target: 'fill' }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({ kind: 'sample-color', color: '#fff', sourceName: 'Card', target: 'border' }).code,
    ).toBe('INVALID_PAYLOAD');

    // 6. commit-inline-text invalid cases
    expect(
      validateToolOperationPayload({ kind: 'commit-inline-text', nodeId: '', text: 'Hi' }).code,
    ).toBe('INVALID_PAYLOAD');
    expect(
      validateToolOperationPayload({ kind: 'commit-inline-text', nodeId: 'text-1', text: 999 }).code,
    ).toBe('INVALID_PAYLOAD');

    // 7. select-nodes invalid cases
    expect(validateToolOperationPayload({ kind: 'select-nodes', nodeIds: 'n1' }).code).toBe('INVALID_PAYLOAD');
    expect(validateToolOperationPayload({ kind: 'select-nodes', nodeIds: ['n1', ''] }).code).toBe('INVALID_PAYLOAD');
    expect(validateToolOperationPayload({ kind: 'select-nodes', nodeIds: [42] }).code).toBe('INVALID_PAYLOAD');

    // 8. viewport-update invalid cases
    expect(validateToolOperationPayload({ kind: 'viewport-update' }).code).toBe('EMPTY_OPERATION');
    expect(
      validateToolOperationPayload({ kind: 'viewport-update', pan: { x: Number.NaN, y: 0 } }).code,
    ).toBe('INVALID_VIEWPORT');
    expect(
      validateToolOperationPayload({ kind: 'viewport-update', pan: { x: 0, y: 0, z: 1 } }).code,
    ).toBe('INVALID_VIEWPORT');
    expect(validateToolOperationPayload({ kind: 'viewport-update', zoom: 0 }).code).toBe('INVALID_VIEWPORT');
    expect(validateToolOperationPayload({ kind: 'viewport-update', zoom: -2 }).code).toBe('INVALID_VIEWPORT');
    expect(
      validateToolOperationPayload({ kind: 'viewport-update', zoom: Number.POSITIVE_INFINITY }).code,
    ).toBe('INVALID_VIEWPORT');

    // 9. switch-tool invalid cases
    expect(
      validateToolOperationPayload({ kind: 'switch-tool', nextToolId: 'non-existent-tool' }).code,
    ).toBe('INVALID_TOOL');

    // 10. notify invalid cases
    expect(validateToolOperationPayload({ kind: 'notify', message: '   ' }).code).toBe('EMPTY_OPERATION');
    expect(validateToolOperationPayload({ kind: 'notify', message: 123 }).code).toBe('INVALID_PAYLOAD');
  });

  it('rejects malformed envelope metadata, unexpected envelope fields, non-plain prototypes, and getter payloads', () => {
    const base = createToolOperation('select', 'main', { kind: 'select-nodes', nodeIds: [] });

    // Unexpected top-level envelope key
    expect(validateToolOperationEnvelope({ ...base, injected: true }).code).toBe('INVALID_ENVELOPE');

    // Invalid metadata.description (non-string or whitespace-only) and extra metadata key
    expect(
      validateToolOperationEnvelope({ ...base, metadata: { atomicHistoryStep: false, description: '' } }).code,
    ).toBe('INVALID_METADATA');
    expect(
      validateToolOperationEnvelope({ ...base, metadata: { atomicHistoryStep: false, description: 123 } }).code,
    ).toBe('INVALID_METADATA');
    expect(
      validateToolOperationEnvelope({ ...base, metadata: { atomicHistoryStep: false, rogue: true } }).code,
    ).toBe('INVALID_METADATA');

    // Getter-based payload rejected as non-plain own data
    const getterPayload = { kind: 'notify' };
    Object.defineProperty(getterPayload, 'message', {
      enumerable: true,
      get: () => 'Sneaky getter',
    });
    const getterEnvelope = {
      ...base,
      category: 'tool-state',
      payload: getterPayload,
    };
    expect(validateToolOperationEnvelope(getterEnvelope).ok).toBe(false);
    expect(isToolOperation(getterEnvelope)).toBe(false);

    // Sparse array rejected
    const sparseIds: unknown[] = [];
    sparseIds.length = 2;
    expect(validateToolOperationPayload({ kind: 'select-nodes', nodeIds: sparseIds }).code).toBe('INVALID_PAYLOAD');
  });
});

describe('P0.3 Subsystem Boundaries — Geometry Engine Validation Gate', () => {
  it('rejects non-finite coordinates, negative dimensions, duplicate IDs, missing targets, and locked targets', () => {
    const project = createInitialProject('Geometry Gate');
    const doc = getActiveDocument(project);
    const unlockedRect: RectNode = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'rect-1' };
    const lockedRect: RectNode = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'rect-locked', locked: true };
    const docWithNodes = { ...doc, nodes: [unlockedRect, lockedRect] };
    const ctx = { document: docWithNodes, selectedNodeIds: [unlockedRect.id] };

    const nanOp = createToolOperation('select', 'main', {
      kind: 'transform-nodes',
      nodes: [{ ...unlockedRect, x: Number.NaN }],
    });
    const nanResult = evaluateToolOperation(nanOp, ctx);
    expect(nanResult.status).toBe('rejected');
    if (nanResult.status === 'rejected') expect(nanResult.code).toBe('INVALID_GEOMETRY');

    const negOp = createToolOperation('draw-rect', 'main', {
      kind: 'create-nodes',
      nodes: [{ ...unlockedRect, id: 'rect-new', width: -10 }],
    });
    const negResult = evaluateToolOperation(negOp, ctx);
    expect(negResult.status).toBe('rejected');
    if (negResult.status === 'rejected') expect(negResult.code).toBe('INVALID_GEOMETRY');

    const dupOp = createToolOperation('draw-rect', 'main', {
      kind: 'create-nodes',
      nodes: [unlockedRect],
    });
    const dupResult = evaluateToolOperation(dupOp, ctx);
    expect(dupResult.status).toBe('rejected');
    if (dupResult.status === 'rejected') expect(dupResult.code).toBe('DUPLICATE_NODE_ID');

    const lockedOp = createToolOperation('select', 'main', {
      kind: 'transform-nodes',
      nodes: [{ ...lockedRect, x: lockedRect.x + 25 }],
    });
    const lockedResult = evaluateToolOperation(lockedOp, ctx);
    expect(lockedResult.status).toBe('rejected');
    if (lockedResult.status === 'rejected') expect(lockedResult.code).toBe('LOCKED_TARGET');

    const missingOp = createToolOperation('select', 'main', {
      kind: 'transform-nodes',
      nodes: [{ ...unlockedRect, id: 'does-not-exist', x: 500 }],
    });
    const missingResult = evaluateToolOperation(missingOp, ctx);
    expect(missingResult.status).toBe('rejected');
    if (missingResult.status === 'rejected') expect(missingResult.code).toBe('TARGET_NOT_FOUND');
  });

  it('detects zero-delta transforms as no-op while allowing style and vector-point updates', () => {
    const project = createInitialProject('Zero Delta Gate');
    const doc = getActiveDocument(project);
    const rect: RectNode = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'rect-1' };
    const path: PathNode = {
      id: 'path-1',
      type: 'path',
      name: 'Vector Path',
      x: 100,
      y: 100,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: false,
      points: [
        { id: 'p1', x: 0, y: 0, pointType: 'corner' },
        { id: 'p2', x: 100, y: 50, pointType: 'corner' },
      ],
      style: { fill: 'none', stroke: '#111111', strokeWidth: 2 },
    };
    const ctx = { document: { ...doc, nodes: [rect, path] }, selectedNodeIds: [rect.id] };

    const noOpResult = evaluateToolOperation(
      createToolOperation('select', 'main', { kind: 'transform-nodes', nodes: [{ ...rect }] }),
      ctx,
    );
    expect(noOpResult.status).toBe('no-op');
    if (noOpResult.status === 'no-op') expect(noOpResult.code).toBe('ZERO_DELTA_NO_OP');

    const radiusResult = evaluateToolOperation(
      createToolOperation('select', 'main', {
        kind: 'transform-nodes',
        nodes: [{ ...rect, style: { ...rect.style, radius: 24 } }],
      }),
      ctx,
    );
    expect(radiusResult.status).toBe('ready');

    const anchorResult = evaluateToolOperation(
      createToolOperation('direct-selection', 'main', {
        kind: 'transform-nodes',
        nodes: [
          {
            ...path,
            points: [
              { id: 'p1', x: 12, y: 8, pointType: 'smooth', handleOut: { x: 24, y: 8 } },
              { id: 'p2', x: 100, y: 50, pointType: 'corner' },
            ],
          },
        ],
      }),
      ctx,
    );
    expect(anchorResult.status).toBe('ready');
  });

  it('projects newly created nodes within a batch so follow-up select-nodes validates cleanly', () => {
    const project = createInitialProject('Batch Projection');
    const doc = getActiveDocument(project);
    const created = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'created-rect-1' };

    const batch = evaluateToolOperationBatch(
      [
        createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [created] }),
        createToolOperation('draw-rect', 'main', { kind: 'select-nodes', nodeIds: [created.id, 'ghost-id'] }),
      ],
      { document: doc, selectedNodeIds: [] },
    );

    expect(batch.rejected).toHaveLength(0);
    expect(batch.ready).toHaveLength(2);
    expect(batch.ready[0].payload.kind).toBe('create-nodes');
    expect(batch.ready[1].payload.kind).toBe('select-nodes');
    if (batch.ready[1].payload.kind === 'select-nodes') {
      expect(batch.ready[1].payload.nodeIds).toEqual([created.id]);
    }
  });

  it('computes eyedropper color updates inside Geometry Engine while skipping locked layers', () => {
    const project = createInitialProject('Eyedropper Calculation');
    const doc = getActiveDocument(project);
    const unlockedRect: RectNode = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'r1' };
    const lockedRect: RectNode = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'r2', locked: true };

    const result = evaluateToolOperation(
      createToolOperation('eyedropper', 'main', {
        kind: 'sample-color',
        color: '#ff5500',
        sourceName: 'Hero Card',
        target: 'fill',
      }),
      {
        document: { ...doc, nodes: [unlockedRect, lockedRect] },
        selectedNodeIds: [unlockedRect.id, lockedRect.id],
      },
    );

    expect(result.status).toBe('ready');
    if (result.status === 'ready' && result.operation.payload.kind === 'sample-color') {
      expect(result.operation.payload.resolvedNodesToUpdate).toHaveLength(1);
      expect(result.operation.payload.resolvedNodesToUpdate[0].id).toBe('r1');
      expect((result.operation.payload.resolvedNodesToUpdate[0] as RectNode).style.fill).toBe('#ff5500');
      expect(result.operation.payload.noticeMessage).toContain('#FF5500');
    }
  });
});

describe('P0.3 Subsystem Boundaries — End-to-End Unidirectional Pipeline', () => {
  it('executes Studio Tool -> Tool Operation Contract -> Geometry Engine -> Native Command Engine with atomic Undo/Redo', () => {
    const project = createInitialProject('Pipeline E2E');
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const changeEvents: Array<{ added: string[]; updated: string[] }> = [];
    store.subscribeChanges((evt) => {
      const docChange = evt.change.documents[0];
      changeEvents.push({
        added: docChange?.nodeIds.added ?? [],
        updated: docChange?.nodeIds.updated ?? [],
      });
    });

    const selectionSpy = vi.fn();
    const panSpy = vi.fn();
    const zoomSpy = vi.fn();
    const toolSpy = vi.fn();
    const noticeSpy = vi.fn();
    const colorOptionSpy = vi.fn();

    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: (ids) => {
          selectionSpy(ids);
          store.dispatchLegacyAction({ type: 'select-nodes', nodeIds: ids });
        },
        onPanChange: panSpy,
        onZoomChange: zoomSpy,
        onToolChange: toolSpy,
        onNotice: noticeSpy,
        onSampledColorOptionChange: colorOptionSpy,
      },
    });

    // 1. Draw a rectangle using draw-rect Studio Tool
    const drawTool = getStudioTool('draw-rect');
    const initialDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const ctx1 = makeToolContext(initialDoc.nodes, []);
    const down = drawTool.onPointerDown(makePointer({ point: { x: 120, y: 120 } }), ctx1);
    const move = drawTool.onPointerMove(makePointer({ point: { x: 260, y: 220 } }), {
      ...ctx1,
      session: down.session ?? null,
    });
    const up = drawTool.onPointerUp(makePointer({ point: { x: 260, y: 220 } }), {
      ...ctx1,
      session: move.session ?? down.session ?? null,
    });

    const revBeforeCreate = store.getSnapshot().projectRevision;
    const ops1 = extractToolOperationsFromTransition('draw-rect', 'main', up);
    const eval1 = evaluateToolOperationBatch(ops1, {
      document: initialDoc,
      selectedNodeIds: [],
    });
    expect(eval1.rejected).toHaveLength(0);
    const reports1 = executor.executeBatch(eval1.ready);
    expect(reports1.some((r) => r.status === 'applied')).toBe(true);
    expect(store.getSnapshot().projectRevision).toBe(revBeforeCreate + 1);
    expect(changeEvents.at(-1)?.added).toHaveLength(1);

    const createdDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const createdNode = createdDoc.nodes[createdDoc.nodes.length - 1];
    expect(createdNode.type).toBe('rect');
    expect(toolSpy).toHaveBeenCalledWith('select');

    // 2. Move the created rectangle using Select tool -> atomic transform
    const selectTool = getStudioTool('select');
    const ctx2 = makeToolContext(createdDoc.nodes, [createdNode.id], { otherNodes: [] });
    const sDown = selectTool.onPointerDown(
      makePointer({ point: { x: createdNode.x + 20, y: createdNode.y + 20 }, targetNodeId: createdNode.id }),
      ctx2,
    );
    const sMove = selectTool.onPointerMove(
      makePointer({ point: { x: createdNode.x + 80, y: createdNode.y + 50 }, targetNodeId: createdNode.id }),
      { ...ctx2, session: sDown.session ?? null },
    );
    const sUp = selectTool.onPointerUp(
      makePointer({ point: { x: createdNode.x + 80, y: createdNode.y + 50 }, targetNodeId: createdNode.id }),
      { ...ctx2, session: sMove.session ?? sDown.session ?? null },
    );

    const revBeforeMove = store.getSnapshot().projectRevision;
    const ops2 = extractToolOperationsFromTransition('select', 'main', sUp);
    const eval2 = evaluateToolOperationBatch(ops2, {
      document: createdDoc,
      selectedNodeIds: [createdNode.id],
    });
    expect(eval2.rejected).toHaveLength(0);
    executor.executeBatch(eval2.ready);

    expect(store.getSnapshot().projectRevision).toBe(revBeforeMove + 1);
    expect(changeEvents.at(-1)?.updated).toContain(createdNode.id);
    const movedNode = getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === createdNode.id)!;
    expect(movedNode.x).toBe(createdNode.x + 60);
    expect(movedNode.y).toBe(createdNode.y + 30);

    // 3. Single Undo reverts the entire drag atomically
    store.dispatchLegacyAction({ type: 'undo' });
    const undoneNode = getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === createdNode.id)!;
    expect(undoneNode.x).toBe(createdNode.x);
    expect(undoneNode.y).toBe(createdNode.y);
  });

  it('commits inline text edits via Native Command Engine and ignores unchanged text', () => {
    const project = createInitialProject('Inline Text Pipeline');
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const textNode = { ...(createNodeForDocument('text', doc) as TextNode), id: 'text-1', text: 'Original' };
    commandClient.createNodes([textNode], 'Seed text');

    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: () => {},
        onPanChange: () => {},
        onZoomChange: () => {},
      },
    });

    const revBefore = store.getSnapshot().projectRevision;
    const unchangedEval = evaluateToolOperation(
      createToolOperation('draw-text', 'main', { kind: 'commit-inline-text', nodeId: 'text-1', text: 'Original' }),
      { document: getActiveDocument(store.getSnapshot().editorState.project), selectedNodeIds: ['text-1'] },
    );
    expect(unchangedEval.status).toBe('no-op');
    expect(store.getSnapshot().projectRevision).toBe(revBefore);

    const changedEval = evaluateToolOperation(
      createToolOperation('draw-text', 'main', { kind: 'commit-inline-text', nodeId: 'text-1', text: 'Updated Title' }),
      { document: getActiveDocument(store.getSnapshot().editorState.project), selectedNodeIds: ['text-1'] },
    );
    expect(changedEval.status).toBe('ready');
    if (changedEval.status === 'ready') {
      const report = executor.execute(changedEval.operation);
      expect(report.status).toBe('applied');
      expect(store.getSnapshot().projectRevision).toBe(revBefore + 1);
      const saved = getActiveDocument(store.getSnapshot().editorState.project).nodes.find((n) => n.id === 'text-1') as TextNode;
      expect(saved.text).toBe('Updated Title');
    }
  });

  it('refuses unvalidated raw operations and workspace mismatches at the Native Command Engine boundary', () => {
    const project = createInitialProject('Boundary Guard');
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: () => {},
        onPanChange: () => {},
        onZoomChange: () => {},
      },
    });

    const rawUnvalidated: ToolOperation = createToolOperation('select', 'main', {
      kind: 'select-nodes',
      nodeIds: [],
    });
    expect(isValidatedToolOperation(rawUnvalidated)).toBe(false);

    const forgedReport = executor.execute(rawUnvalidated as unknown as ValidatedToolOperation);
    expect(forgedReport.status).toBe('rejected');

    const compOp = createToolOperation('select', 'component', { kind: 'select-nodes', nodeIds: [] });
    const compEval = evaluateToolOperation(compOp, {
      document: getActiveDocument(store.getSnapshot().editorState.project),
      selectedNodeIds: [],
    });
    expect(compEval.status).toBe('ready');
    if (compEval.status === 'ready') {
      const mismatch = executor.execute(compEval.operation);
      expect(mismatch.status).toBe('rejected');
      expect(mismatch.reason).toContain('Workspace mismatch');
    }
  });
});

describe('P0.3 Subsystem Boundaries — Executor Envelope Type-Guard Chain', () => {
  function sealOrThrow(
    op: ToolOperation,
    doc: ReturnType<typeof getActiveDocument>,
    selectedNodeIds: string[] = [],
  ): ValidatedToolOperation {
    const res = evaluateToolOperation(op, { document: doc, selectedNodeIds });
    if (res.status !== 'ready') {
      throw new Error(`Expected operation "${op.payload.kind}" to evaluate as ready, got ${res.status}`);
    }
    return res.operation;
  }

  it('validates all 10 Geometry-Engine-sealed operation types cleanly through the strict type-guard chain', () => {
    const project = createInitialProject('Executor Envelope All Kinds');
    const baseDoc = getActiveDocument(project);
    const existingRect: RectNode = { ...(createNodeForDocument('rect', baseDoc) as RectNode), id: 'rect-existing' };
    const newRect: RectNode = { ...(createNodeForDocument('rect', baseDoc) as RectNode), id: 'rect-new' };
    const existingText: TextNode = {
      ...(createNodeForDocument('text', baseDoc) as TextNode),
      id: 'text-existing',
      text: 'Before',
    };
    const existingPath: PathNode = {
      id: 'path-existing',
      type: 'path',
      name: 'Existing Path',
      x: 40,
      y: 40,
      width: 100,
      height: 60,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: true,
      points: [
        { id: 'pt-a', x: 0, y: 0, pointType: 'corner' },
        { id: 'pt-b', x: 100, y: 0, pointType: 'corner' },
        { id: 'pt-c', x: 50, y: 60, pointType: 'corner' },
      ],
      style: { fill: '#6366f1', stroke: '#111827', strokeWidth: 2 },
    };
    const splitPath: PathNode = { ...existingPath, id: 'path-split-1' };
    const mergedPath: PathNode = { ...existingPath, id: 'path-merged-1' };
    const doc = { ...baseDoc, nodes: [existingRect, existingText, existingPath] };

    const sealedOps: ValidatedToolOperation[] = [
      sealOrThrow(createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [newRect] }), doc),
      sealOrThrow(
        createToolOperation('select', 'main', {
          kind: 'transform-nodes',
          nodes: [{ ...existingRect, x: existingRect.x + 24 }],
        }),
        doc,
        [existingRect.id],
      ),
      sealOrThrow(
        createToolOperation('scissors', 'main', {
          kind: 'replace-node-with-nodes',
          nodeId: existingPath.id,
          nodes: [splitPath],
        }),
        doc,
      ),
      sealOrThrow(
        createToolOperation('shape-builder', 'main', {
          kind: 'replace-nodes',
          removeIds: [existingRect.id, existingPath.id],
          insertNodes: [mergedPath],
          selectIds: [mergedPath.id],
        }),
        doc,
      ),
      sealOrThrow(
        createToolOperation('eyedropper', 'main', {
          kind: 'sample-color',
          color: '#10b981',
          sourceName: 'Accent Card',
          target: 'fill',
        }),
        doc,
        [existingRect.id],
      ),
      sealOrThrow(
        createToolOperation('draw-text', 'main', {
          kind: 'commit-inline-text',
          nodeId: existingText.id,
          text: 'After',
        }),
        doc,
        [existingText.id],
      ),
      sealOrThrow(
        createToolOperation('select', 'main', {
          kind: 'select-nodes',
          nodeIds: [existingRect.id],
        }),
        doc,
      ),
      sealOrThrow(
        createToolOperation('scrubby-zoom', 'main', {
          kind: 'viewport-update',
          zoom: 1.5,
          pan: { x: 12, y: -8 },
        }),
        doc,
      ),
      sealOrThrow(
        createToolOperation('draw-rect', 'main', {
          kind: 'switch-tool',
          nextToolId: 'select',
        }),
        doc,
      ),
      sealOrThrow(
        createToolOperation('measure', 'main', {
          kind: 'notify',
          message: 'Measured 120 × 80 px',
        }),
        doc,
      ),
    ];

    expect(sealedOps).toHaveLength(10);
    for (const op of sealedOps) {
      expect(validateExecutorEnvelope(op)).toBe(op);
      expect(isValidatedToolOperationEnvelope(op)).toBe(true);
    }
  });

  it('throws descriptive ToolOperationEnvelopeError for unsealed, malformed, or mismatched envelopes', () => {
    const project = createInitialProject('Executor Envelope Errors');
    const doc = getActiveDocument(project);
    const rawOp = createToolOperation('select', 'main', { kind: 'select-nodes', nodeIds: [] });
    const sealedSelect = sealOrThrow(rawOp, doc);

    const expectEnvelopeError = (
      input: unknown,
      expectedCode: ToolOperationEnvelopeError['code'],
      messageSubstring?: string,
    ) => {
      let caught: unknown;
      try {
        validateExecutorEnvelope(input);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ToolOperationEnvelopeError);
      const envelopeErr = caught as ToolOperationEnvelopeError;
      expect(envelopeErr.code).toBe(expectedCode);
      if (messageSubstring) {
        expect(envelopeErr.message).toContain(messageSubstring);
      }
      expect(isValidatedToolOperationEnvelope(input)).toBe(false);
    };

    // Non-object & unsealed envelopes
    expectEnvelopeError(null, 'INVALID_ENVELOPE', 'plain non-null object');
    expectEnvelopeError('not-an-object', 'INVALID_ENVELOPE');
    expectEnvelopeError(rawOp, 'UNSEALED_OPERATION', 'Geometry Engine');

    // Top-level envelope invariants on a sealed object
    expectEnvelopeError({ ...sealedSelect, rogue: 1 }, 'INVALID_ENVELOPE', 'Unexpected property "rogue"');
    expectEnvelopeError({ ...sealedSelect, protocol: 'bad.proto' }, 'UNSUPPORTED_PROTOCOL', 'protocol');
    expectEnvelopeError({ ...sealedSelect, version: 99 }, 'UNSUPPORTED_VERSION', 'version');
    expectEnvelopeError({ ...sealedSelect, operationId: '   ' }, 'INVALID_ENVELOPE', 'operationId');
    expectEnvelopeError({ ...sealedSelect, toolId: 'unknown-tool' }, 'INVALID_TOOL', 'unknown-tool');
    expectEnvelopeError({ ...sealedSelect, workspace: 'devtools' }, 'INVALID_ENVELOPE', 'workspace');
    expectEnvelopeError(
      { ...sealedSelect, metadata: { atomicHistoryStep: 'yes' } },
      'INVALID_METADATA',
      'atomicHistoryStep',
    );
    expectEnvelopeError(
      { ...sealedSelect, metadata: { atomicHistoryStep: false, extra: true } },
      'INVALID_METADATA',
      'Unexpected property "extra"',
    );

    // Unsupported operation type & category/type mismatch
    expectEnvelopeError(
      { ...sealedSelect, payload: { kind: 'delete-world' } },
      'INVALID_PAYLOAD',
      'Unsupported tool operation type',
    );
    expectEnvelopeError(
      { ...sealedSelect, category: 'viewport' },
      'INVALID_CATEGORY',
      'does not match operation type "select-nodes"',
    );
  });

  it('throws descriptive errors for tampered internal payloads across supported operation types and rejects via executor', () => {
    const project = createInitialProject('Executor Payload Tamper');
    const baseDoc = getActiveDocument(project);
    const rect: RectNode = { ...(createNodeForDocument('rect', baseDoc) as RectNode), id: 'rect-1' };
    const textNode: TextNode = {
      ...(createNodeForDocument('text', baseDoc) as TextNode),
      id: 'text-1',
      text: 'Hello',
    };
    const doc = { ...baseDoc, nodes: [rect, textNode] };

    const sealedSample = sealOrThrow(
      createToolOperation('eyedropper', 'main', {
        kind: 'sample-color',
        color: '#22c55e',
        sourceName: 'Card',
        target: 'fill',
      }),
      doc,
      [rect.id],
    );
    const sealedText = sealOrThrow(
      createToolOperation('draw-text', 'main', {
        kind: 'commit-inline-text',
        nodeId: textNode.id,
        text: 'Updated',
      }),
      doc,
      [textNode.id],
    );
    const sealedViewport = sealOrThrow(
      createToolOperation('scrubby-zoom', 'main', {
        kind: 'viewport-update',
        zoom: 2,
      }),
      doc,
    );
    const sealedCreate = sealOrThrow(
      createToolOperation('draw-rect', 'main', {
        kind: 'create-nodes',
        nodes: [{ ...rect, id: 'rect-created' }],
      }),
      doc,
    );
    const sealedSwitch = sealOrThrow(
      createToolOperation('draw-rect', 'main', {
        kind: 'switch-tool',
        nextToolId: 'select',
      }),
      doc,
    );
    const sealedNotify = sealOrThrow(
      createToolOperation('measure', 'main', {
        kind: 'notify',
        message: 'Done',
      }),
      doc,
    );

    // Tampered sample-color payloads
    expect(() =>
      validateExecutorEnvelope({
        ...sealedSample,
        payload: { ...sealedSample.payload, noticeMessage: '   ' },
      }),
    ).toThrow(ToolOperationEnvelopeError);

    expect(() =>
      validateExecutorEnvelope({
        ...sealedSample,
        payload: { ...sealedSample.payload, resolvedNodesToUpdate: [rect, rect] },
      }),
    ).toThrow(/Duplicate node id/);

    expect(() =>
      validateExecutorEnvelope({
        ...sealedSample,
        payload: { ...sealedSample.payload, resolvedNodesToUpdate: 'invalid' },
      }),
    ).toThrow(/resolvedNodesToUpdate array/);

    // Tampered commit-inline-text payloads
    expect(() =>
      validateExecutorEnvelope({
        ...sealedText,
        payload: { ...sealedText.payload, resolvedNode: rect },
      }),
    ).toThrow(/must have type "text"/);

    expect(() =>
      validateExecutorEnvelope({
        ...sealedText,
        payload: { ...sealedText.payload, resolvedNode: { ...textNode, id: 'other-id', text: 'Updated' } },
      }),
    ).toThrow(/does not match payload\.nodeId/);

    expect(() =>
      validateExecutorEnvelope({
        ...sealedText,
        payload: { ...sealedText.payload, resolvedNode: { ...textNode, text: 'Different' } },
      }),
    ).toThrow(/resolvedNode\.text must match payload\.text/);

    // Tampered viewport-update (out-of-range zoom)
    expect(() =>
      validateExecutorEnvelope({
        ...sealedViewport,
        payload: { kind: 'viewport-update', zoom: 99 },
      }),
    ).toThrow(/must be within/);

    // Tampered create-nodes, switch-tool, notify
    const tamperedCreate = {
      ...sealedCreate,
      payload: { kind: 'create-nodes', nodes: [{ ...rect, id: 'bad-node', width: -5 }] },
    };
    expect(() => validateExecutorEnvelope(tamperedCreate)).toThrow(ToolOperationEnvelopeError);
    expect(() =>
      validateExecutorEnvelope({
        ...sealedSwitch,
        payload: { kind: 'switch-tool', nextToolId: 'ghost-tool' },
      }),
    ).toThrow(ToolOperationEnvelopeError);
    expect(() =>
      validateExecutorEnvelope({
        ...sealedNotify,
        payload: { kind: 'notify', message: '' },
      }),
    ).toThrow(ToolOperationEnvelopeError);

    // Executor catches thrown ToolOperationEnvelopeError and returns rejected report without mutating store
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: () => {},
        onPanChange: () => {},
        onZoomChange: () => {},
      },
    });
    const revBefore = store.getSnapshot().projectRevision;
    const report = executor.execute(tamperedCreate as unknown as ValidatedToolOperation);
    expect(report.status).toBe('rejected');
    expect(report.reason).toBeTruthy();
    expect(store.getSnapshot().projectRevision).toBe(revBefore);
  });
});

describe('P0.3 Subsystem Boundaries — Atomic Batch Execution & Fail-Closed Batch Validation', () => {
  it('commits a multi-mutation gesture batch in ONE transaction, ONE revision, ONE NativeChangeEvent, and ONE atomic Undo/Redo', () => {
    const project = createInitialProject('Atomic Gesture Batch');
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const events: Array<{ transactionId?: string; commandIds: string[]; projectRevision: number }> = [];
    store.subscribeChanges((evt) => {
      events.push({
        transactionId: evt.transactionId,
        commandIds: [...evt.change.commandIds],
        projectRevision: evt.projectRevision,
      });
    });

    const selectionSpy = vi.fn();
    const toolSpy = vi.fn();
    const noticeSpy = vi.fn();
    const colorSpy = vi.fn();
    const commitSpy = vi.fn();

    const executor = createToolOperationExecutor({
      workspace: 'main',
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
        onSampledColorOptionChange: colorSpy,
        onCanvasMutationCommitted: commitSpy,
      },
    });

    const initialDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const initialNodeCount = initialDoc.nodes.length;
    const newRect: RectNode = {
      ...(createNodeForDocument('rect', initialDoc) as RectNode),
      id: 'gesture-rect-1',
      x: 80,
      y: 90,
      width: 140,
      height: 100,
    };
    const shiftedAndRoundedRect: RectNode = {
      ...newRect,
      x: 160,
      y: 130,
      style: { ...newRect.style, radius: 16 },
    };

    // Multi-mutation gesture batch: create -> transform/style -> select -> sample-color -> switch-tool -> notify
    const rawBatch: ToolOperation[] = [
      createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [newRect] }),
      createToolOperation('select', 'main', { kind: 'transform-nodes', nodes: [shiftedAndRoundedRect] }),
      createToolOperation('select', 'main', { kind: 'select-nodes', nodeIds: [newRect.id] }),
      createToolOperation('eyedropper', 'main', {
        kind: 'sample-color',
        color: '#ef4444',
        sourceName: 'Accent Swatch',
        target: 'fill',
      }),
      createToolOperation('draw-rect', 'main', { kind: 'switch-tool', nextToolId: 'select' }),
      createToolOperation('draw-rect', 'main', { kind: 'notify', message: 'Gesture committed' }),
    ];

    const evalBatch = evaluateToolOperationBatch(rawBatch, {
      document: initialDoc,
      selectedNodeIds: [],
    });

    expect(evalBatch.status).toBe('ready');
    expect(evalBatch.aborted).toBe(false);
    expect(evalBatch.rejected).toHaveLength(0);
    expect(evalBatch.ready).toHaveLength(6);

    const revBefore = store.getSnapshot().projectRevision;
    const pastBefore = store.getSnapshot().editorState.past.length;
    const reports = executor.executeBatch(evalBatch.ready);

    // Every operation applied, all 3 document mutations share ONE transactionId
    expect(reports).toHaveLength(6);
    expect(reports.every((r) => r.status === 'applied')).toBe(true);
    const txId = reports[0].transactionId;
    expect(txId).toBeTruthy();
    expect(reports[1].transactionId).toBe(txId);
    expect(reports[3].transactionId).toBe(txId);

    // ONE revision increment, ONE NativeChangeEvent with 3 commandIds, ONE Undo step
    expect(store.getSnapshot().projectRevision).toBe(revBefore + 1);
    expect(store.getSnapshot().editorState.past).toHaveLength(pastBefore + 1);
    expect(events).toHaveLength(1);
    expect(events[0].transactionId).toBe(txId);
    expect(events[0].commandIds).toHaveLength(3);

    // Final committed node reflects ALL 3 chained mutations
    const committedDoc = getActiveDocument(store.getSnapshot().editorState.project);
    expect(committedDoc.nodes).toHaveLength(initialNodeCount + 1);
    const finalNode = committedDoc.nodes.find((n) => n.id === newRect.id) as RectNode;
    expect(finalNode.x).toBe(160);
    expect(finalNode.y).toBe(130);
    expect(finalNode.style.radius).toBe(16);
    expect(finalNode.style.fill).toBe('#ef4444');

    // Shell callbacks fired strictly after commit
    expect(selectionSpy).toHaveBeenCalledWith([newRect.id]);
    expect(colorSpy).toHaveBeenCalledWith('#ef4444', 'fill');
    expect(toolSpy).toHaveBeenCalledWith('select');
    expect(noticeSpy).toHaveBeenCalledWith('Gesture committed');
    expect(commitSpy).toHaveBeenCalledTimes(3);

    // SINGLE Undo reverts ALL 3 mutations in the gesture atomically
    expect(commandClient.undo('Undo gesture').status).toBe('applied');
    const afterUndo = getActiveDocument(store.getSnapshot().editorState.project);
    expect(afterUndo.nodes).toHaveLength(initialNodeCount);
    expect(afterUndo.nodes.some((n) => n.id === newRect.id)).toBe(false);

    // SINGLE Redo restores ALL 3 mutations together
    expect(commandClient.redo('Redo gesture').status).toBe('applied');
    const afterRedo = getActiveDocument(store.getSnapshot().editorState.project);
    const redoneNode = afterRedo.nodes.find((n) => n.id === newRect.id) as RectNode;
    expect(redoneNode.x).toBe(160);
    expect(redoneNode.style.radius).toBe(16);
    expect(redoneNode.style.fill).toBe('#ef4444');
  });

  it('aborts fail-closed in evaluateToolOperationBatch when ANY operation is rejected so zero operations escape', () => {
    const project = createInitialProject('Fail-Closed Geometry Batch');
    const baseDoc = getActiveDocument(project);
    const lockedRect: RectNode = {
      ...(createNodeForDocument('rect', baseDoc) as RectNode),
      id: 'locked-rect-1',
      locked: true,
    };
    const newRect: RectNode = {
      ...(createNodeForDocument('rect', baseDoc) as RectNode),
      id: 'valid-new-rect',
    };
    const doc = { ...baseDoc, nodes: [...baseDoc.nodes, lockedRect] };

    // Valid op #0 + Rejected op #1 (locked target) + Valid op #2
    const evaluated = evaluateToolOperationBatch(
      [
        createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [newRect] }),
        createToolOperation('select', 'main', {
          kind: 'transform-nodes',
          nodes: [{ ...lockedRect, x: lockedRect.x + 40 }],
        }),
        createToolOperation('draw-rect', 'main', { kind: 'switch-tool', nextToolId: 'select' }),
      ],
      { document: doc, selectedNodeIds: [lockedRect.id] },
    );

    expect(evaluated.status).toBe('rejected');
    expect(evaluated.aborted).toBe(true);
    expect(evaluated.failedIndex).toBe(1);
    expect(evaluated.ready).toHaveLength(0);
    expect(evaluated.noOps).toHaveLength(0);
    expect(evaluated.rejected).toHaveLength(1);
    expect(evaluated.rejected[0].code).toBe('LOCKED_TARGET');
  });

  it('aborts fail-closed in executeBatch when ANY operation fails envelope validation or workspace check (zero store changes, zero shell callbacks)', () => {
    const project = createInitialProject('Fail-Closed Executor Pre-Validation');
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);
    const changeSpy = vi.fn();
    store.subscribeChanges(changeSpy);

    const selectionSpy = vi.fn();
    const panSpy = vi.fn();
    const zoomSpy = vi.fn();
    const toolSpy = vi.fn();
    const noticeSpy = vi.fn();
    const commitSpy = vi.fn();

    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: selectionSpy,
        onPanChange: panSpy,
        onZoomChange: zoomSpy,
        onToolChange: toolSpy,
        onNotice: noticeSpy,
        onCanvasMutationCommitted: commitSpy,
      },
    });

    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const newRect: RectNode = { ...(createNodeForDocument('rect', doc) as RectNode), id: 'never-created-1' };
    const evalCreate = evaluateToolOperation(
      createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [newRect] }),
      { document: doc, selectedNodeIds: [] },
    );
    const evalSwitch = evaluateToolOperation(
      createToolOperation('draw-rect', 'main', { kind: 'switch-tool', nextToolId: 'select' }),
      { document: doc, selectedNodeIds: [] },
    );
    const evalWrongWorkspace = evaluateToolOperation(
      createToolOperation('measure', 'component', { kind: 'notify', message: 'Wrong workspace' }),
      { document: doc, selectedNodeIds: [] },
    );
    expect(evalCreate.status).toBe('ready');
    expect(evalSwitch.status).toBe('ready');
    expect(evalWrongWorkspace.status).toBe('ready');
    if (evalCreate.status !== 'ready' || evalSwitch.status !== 'ready' || evalWrongWorkspace.status !== 'ready') return;

    const revBefore = store.getSnapshot().projectRevision;
    const pastBefore = store.getSnapshot().editorState.past.length;
    const nodeCountBefore = doc.nodes.length;

    // 1. Valid ops followed by an unsealed raw operation
    const rawUnsealed = createToolOperation('measure', 'main', { kind: 'notify', message: 'Unsealed' });
    const reportsUnsealed = executor.executeBatch([
      evalCreate.operation,
      evalSwitch.operation,
      rawUnsealed as unknown as ValidatedToolOperation,
    ]);

    expect(reportsUnsealed).toHaveLength(3);
    expect(reportsUnsealed.every((r) => r.status === 'rejected')).toBe(true);
    expect(reportsUnsealed[0].reason).toContain('Batch aborted (fail-closed)');
    expect(reportsUnsealed[2].reason).toContain('Geometry Engine');

    // 2. Valid ops followed by a workspace-mismatched operation
    const reportsWorkspace = executor.executeBatch([evalCreate.operation, evalWrongWorkspace.operation]);
    expect(reportsWorkspace).toHaveLength(2);
    expect(reportsWorkspace.every((r) => r.status === 'rejected')).toBe(true);
    expect(reportsWorkspace[1].reason).toContain('Workspace mismatch');

    // Store & shell are 100% untouched
    expect(store.getSnapshot().projectRevision).toBe(revBefore);
    expect(store.getSnapshot().editorState.past).toHaveLength(pastBefore);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes).toHaveLength(nodeCountBefore);
    expect(changeSpy).not.toHaveBeenCalled();
    expect(selectionSpy).not.toHaveBeenCalled();
    expect(panSpy).not.toHaveBeenCalled();
    expect(zoomSpy).not.toHaveBeenCalled();
    expect(toolSpy).not.toHaveBeenCalled();
    expect(noticeSpy).not.toHaveBeenCalled();
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('rolls back the entire batch fail-closed when the Native Command Engine rejects a later command in the transaction', () => {
    const project = createInitialProject('Fail-Closed Transaction Rollback');
    const store = createCanonicalEditorStore(createEditorState(project));
    const commandClient = createMainCanvasCommandClient(store);

    const selectionSpy = vi.fn();
    const toolSpy = vi.fn();
    const noticeSpy = vi.fn();
    const commitSpy = vi.fn();
    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient,
      shell: {
        onSelectionChange: selectionSpy,
        onPanChange: () => {},
        onZoomChange: () => {},
        onToolChange: toolSpy,
        onNotice: noticeSpy,
        onCanvasMutationCommitted: commitSpy,
      },
    });

    const initialDoc = getActiveDocument(store.getSnapshot().editorState.project);
    const existingTarget = initialDoc.nodes[0] as RectNode;
    const newRect: RectNode = { ...(createNodeForDocument('rect', initialDoc) as RectNode), id: 'rollback-rect-1' };

    // Seal a batch while existingTarget is unlocked
    const evalBatch = evaluateToolOperationBatch(
      [
        createToolOperation('draw-rect', 'main', { kind: 'create-nodes', nodes: [newRect] }),
        createToolOperation('select', 'main', {
          kind: 'transform-nodes',
          nodes: [{ ...existingTarget, x: existingTarget.x + 50 }],
        }),
        createToolOperation('select', 'main', { kind: 'select-nodes', nodeIds: [newRect.id] }),
        createToolOperation('draw-rect', 'main', { kind: 'switch-tool', nextToolId: 'select' }),
        createToolOperation('measure', 'main', { kind: 'notify', message: 'Should not fire' }),
      ],
      { document: initialDoc, selectedNodeIds: [existingTarget.id] },
    );
    expect(evalBatch.status).toBe('ready');
    expect(evalBatch.ready).toHaveLength(5);

    // Concurrent mutation locks existingTarget in the canonical store before commit
    expect(commandClient.setNodesProperties([existingTarget.id], { locked: true }, 'Lock target').status).toBe('applied');

    const revBefore = store.getSnapshot().projectRevision;
    const pastBefore = store.getSnapshot().editorState.past.length;
    const changeSpy = vi.fn();
    store.subscribeChanges(changeSpy);

    const reports = executor.executeBatch(evalBatch.ready);

    // Entire batch rolled back: every report rejected, newRect NOT created, zero events, zero shell callbacks
    expect(reports).toHaveLength(5);
    expect(reports.every((r) => r.status === 'rejected')).toBe(true);
    expect(reports[1].commandResult?.code).toBe('LOCKED_TARGET');
    expect(store.getSnapshot().projectRevision).toBe(revBefore);
    expect(store.getSnapshot().editorState.past).toHaveLength(pastBefore);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes.some((n) => n.id === newRect.id)).toBe(false);
    expect(changeSpy).not.toHaveBeenCalled();
    expect(selectionSpy).not.toHaveBeenCalled();
    expect(toolSpy).not.toHaveBeenCalled();
    expect(noticeSpy).not.toHaveBeenCalled();
    expect(commitSpy).not.toHaveBeenCalled();
  });
});

describe('P0.3 Subsystem Boundaries — Static Dependency Enforcement', () => {
  const FORBIDDEN_IN_TOOLS_AND_GEOMETRY = [
    '/app/',
    'editorReducer',
    'editorStore',
    'nativeCommandExecutor',
    'nativeCommandRegistry',
    'mainCanvasCommandClient',
    'toolOperationExecutor',
    'ToolOptionsBar',
    'InspectorPanel',
    'ToolbarHintBar',
    'FloatingWindow',
    'preact',
  ];

  it('guarantees zero direct dependencies from Studio Tools to UI panels, legacy reducer, or Native Engine internals', () => {
    const toolEntries = Object.entries(RAW_SRC_FILES).filter(([path]) =>
      path.startsWith('../src/engines/canvas/tools/'),
    );
    expect(toolEntries.length).toBeGreaterThanOrEqual(10);

    for (const [filePath, source] of toolEntries) {
      const imports = extractImportSpecifiers(source);
      for (const specifier of imports) {
        for (const forbidden of FORBIDDEN_IN_TOOLS_AND_GEOMETRY) {
          expect(
            specifier.includes(forbidden),
            `Studio tool "${filePath}" must not import "${specifier}" (forbidden: ${forbidden})`,
          ).toBe(false);
        }
      }
    }
  });

  it('guarantees Tool Operation Contract and Geometry Engine are pure and decoupled from app/UI/Native Engine', () => {
    const contractImports = readImportsForSrc('core/tools/operationContract.ts');
    for (const specifier of contractImports) {
      expect(specifier.includes('/engines/')).toBe(false);
      for (const forbidden of FORBIDDEN_IN_TOOLS_AND_GEOMETRY) {
        expect(specifier.includes(forbidden)).toBe(false);
      }
    }

    const geometryEngineImports = readImportsForSrc('engines/canvas/geometryEngine.ts');
    for (const specifier of geometryEngineImports) {
      for (const forbidden of FORBIDDEN_IN_TOOLS_AND_GEOMETRY) {
        expect(specifier.includes(forbidden)).toBe(false);
      }
    }
  });

  it('guarantees Canvas host has zero imports from app/UI panels/reducer/Native Engine internals', () => {
    const canvasImports = readImportsForSrc('engines/canvas/Canvas.tsx');
    const forbiddenForCanvas = FORBIDDEN_IN_TOOLS_AND_GEOMETRY.filter((entry) => entry !== 'preact');
    for (const specifier of canvasImports) {
      for (const forbidden of forbiddenForCanvas) {
        expect(
          specifier.includes(forbidden),
          `Canvas.tsx must not import "${specifier}" (forbidden: ${forbidden})`,
        ).toBe(false);
      }
    }
  });

  it('guarantees UI panels do not import Studio Tools implementation modules directly', () => {
    const panelFiles = [
      'app/ToolOptionsBar.tsx',
      'app/InspectorPanel.tsx',
      'app/ToolbarHintBar.tsx',
      'app/FloatingWindow.tsx',
    ];
    for (const panel of panelFiles) {
      const imports = readImportsForSrc(panel);
      for (const specifier of imports) {
        expect(
          specifier.includes('engines/canvas/tools'),
          `UI panel "${panel}" must not directly import Studio Tools module "${specifier}"`,
        ).toBe(false);
        expect(
          specifier.includes('engines/canvas/Canvas'),
          `UI panel "${panel}" must not directly import Canvas host "${specifier}"`,
        ).toBe(false);
      }
    }
  });
});
