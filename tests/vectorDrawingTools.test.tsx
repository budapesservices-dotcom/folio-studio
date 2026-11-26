import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';

vi.mock('preact/hooks', () => ({
  useState: (initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    vi.fn(),
  ],
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (fn: unknown) => fn,
}));

import { createInitialProject } from '../src/core/document/factory';
import { getActiveDocument } from '../src/core/document/project';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import { validateProject } from '../src/core/document/validation';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { serializeProjectToFlopJson, parseProjectJsonSafe } from '../src/core/persistence/projectFile';
import {
  applyPaintBucketOperation,
  applyVectorEraserOperation,
  buildVectorBrushPathNode,
  findTouchedEraserNodeIds,
  stabilizeBrushPolyline,
} from '../src/core/document/vectorDrawing';
import { buildSmoothSvgTrailPath } from '../src/engines/canvas/canvasHelpers';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  extractToolOperationsFromTransition,
  type CanvasToolOptions,
} from '../src/core/tools/operationContract';
import type { DesignNode, FolioDocument, PathNode, RectNode } from '../src/core/document/types';
import { evaluateToolOperation, evaluateToolOperationBatch } from '../src/engines/canvas/geometryEngine';
import {
  COMPONENT_CANVAS_TOOL_GROUPS,
  MAIN_CANVAS_TOOL_GROUPS,
  findStudioToolByShortcut,
  getStudioTool,
  isToolAvailableInWorkspace,
  studioToolRegistry,
} from '../src/engines/canvas/tools/studioRegistry';
import { extractSampledColor } from '../src/engines/canvas/tools/utility-tools';
import { preloadVectorDrawingEngine } from '../src/engines/canvas/tools/vectorDrawingLoader';
import type { CanvasToolContext, CanvasToolPointerInput } from '../src/engines/canvas/tools/types';
import { compileFolioProject } from '../src/engines/codegen/index';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';
import { STUDIO_TOOL_KEYBINDINGS } from '../src/app/keyboardShortcuts';
import { ToolOptionsBar } from '../src/app/ToolOptionsBar';

function makeRect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  overrides: Partial<RectNode> = {},
): RectNode {
  return {
    id,
    type: 'rect',
    name: `Rect ${id}`,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: '#38BDF8',
      stroke: '#0F172A',
      strokeWidth: 2,
      radius: 0,
      ...(overrides.style ?? {}),
    },
    ...overrides,
  };
}

function makeLinePath(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = '#E2E8F0',
  strokeWidth = 3,
): PathNode {
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const maxX = Math.max(x1, x2);
  const maxY = Math.max(y1, y2);
  return {
    id,
    type: 'path',
    name: `Line ${id}`,
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: false,
    points: [
      { id: `${id}-p0`, x: x1 - minX, y: y1 - minY, pointType: 'corner' },
      { id: `${id}-p1`, x: x2 - minX, y: y2 - minY, pointType: 'corner' },
    ],
    style: {
      fill: 'transparent',
      stroke,
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
  };
}

function makeDoc(nodes: DesignNode[]): FolioDocument {
  return {
    id: 'doc-vector-drawing-test',
    name: 'Component Master',
    width: 800,
    height: 600,
    background: '#111827',
    nodes,
  };
}

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
    rotateHandle: false,
    anchorHit: null,
    smartHandleHit: null,
    detail: 1,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

function makeContext(
  nodes: DesignNode[],
  selectedNodeIds: string[] = [],
  options: Partial<CanvasToolOptions> = {},
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const selectedSet = new Set(selectedNodeIds);
  const selectable = nodes.filter((node) => node.visible && !node.locked);
  const selectedNodes = selectable.filter((node) => selectedSet.has(node.id));
  return {
    document: makeDoc(nodes),
    canvasNodes: nodes,
    selectableNodes: selectable,
    otherNodes: selectable,
    selectedNodeIds,
    selectedNodes,
    selectionBounds: null,
    zoom: 1,
    canvasUnitsPerPixel: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 800,
    session: null,
    toolOptions: { ...DEFAULT_CANVAS_TOOL_OPTIONS, ...options },
    workspace: 'component',
    designTokens: createDefaultDesignTokens(),
    customPivot: null,
    activeAnchor: null,
    ...overrides,
  };
}

function createAtomicHarness(initialNodes: DesignNode[]) {
  const project = createInitialProject('Vector Drawing Test');
  project.pages[0].document.nodes = initialNodes;
  const store = createCanonicalEditorStore(createEditorState(project));
  const commandClient = createMainCanvasCommandClient(store);
  const sampledOptions: Array<{ color: string; target?: 'fill' | 'stroke' }> = [];
  const notices: string[] = [];

  const executor = createToolOperationExecutor({
    workspace: 'main',
    commandClient,
    shell: {
      onSelectionChange: (nodeIds) => store.dispatchLegacyAction({ type: 'select-nodes', nodeIds }),
      onPanChange: () => {},
      onZoomChange: () => {},
      onToolChange: () => {},
      onNotice: (msg) => notices.push(msg),
      onSampledColorOptionChange: (color, target) => sampledOptions.push({ color, target }),
    },
  });

  const runTransition = (
    toolId: 'brush' | 'eraser' | 'paint-bucket' | 'eyedropper',
    transition: ReturnType<ReturnType<typeof getStudioTool>['onPointerDown']>,
  ) => {
    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const selectedNodeIds = store.getSnapshot().editorState.selectedNodeIds;
    const ops = extractToolOperationsFromTransition(toolId, 'main', transition);
    const evaluated = evaluateToolOperationBatch(ops, {
      document: doc,
      selectedNodeIds,
    });
    expect(evaluated.rejected).toHaveLength(0);
    return executor.executeBatch(evaluated.ready);
  };

  return { store, commandClient, executor, sampledOptions, notices, runTransition };
}

function findVNodes(
  node: unknown,
  predicate: (vnode: VNode<Record<string, unknown>>) => boolean,
): Array<VNode<Record<string, unknown>>> {
  const results: Array<VNode<Record<string, unknown>>> = [];
  const visit = (current: unknown) => {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    const candidate = current as VNode<Record<string, unknown>>;
    if ('type' in candidate && 'props' in candidate) {
      if (typeof candidate.type === 'function') {
        const rendered = (candidate.type as (props: Record<string, unknown>) => unknown)(candidate.props);
        visit(rendered);
        return;
      }
      if (predicate(candidate)) results.push(candidate);
      const props = candidate.props;
      if (props && 'children' in props) visit(props.children);
    }
  };
  visit(node);
  return results;
}

function getTextContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as VNode<Record<string, unknown>>).props;
    return props && 'children' in props ? getTextContent(props.children) : '';
  }
  return '';
}

let seq = 1;
const nextId = (prefix = 'vec') => `${prefix}-${seq++}`;

describe('Vector-Native Drawing Tool Suite — Registry & Workspace Integration', () => {
  it('registers brush, eraser, paint-bucket, and eyedropper in Tool Registry for Component and Main Canvas', () => {
    const ids = studioToolRegistry.list().map((tool) => tool.id);
    expect(ids).toContain('brush');
    expect(ids).toContain('eraser');
    expect(ids).toContain('paint-bucket');
    expect(ids).toContain('eyedropper');

    for (const toolId of ['brush', 'eraser', 'paint-bucket', 'eyedropper'] as const) {
      expect(isToolAvailableInWorkspace(toolId, 'component')).toBe(true);
      expect(isToolAvailableInWorkspace(toolId, 'main')).toBe(true);
    }

    const compVectorTools = COMPONENT_CANVAS_TOOL_GROUPS.find((g) => g.id === 'vector')?.tools ?? [];
    const mainVectorTools = MAIN_CANVAS_TOOL_GROUPS.find((g) => g.id === 'vector')?.tools ?? [];
    expect(compVectorTools).toEqual(expect.arrayContaining(['brush', 'eraser', 'paint-bucket']));
    expect(mainVectorTools).toEqual(expect.arrayContaining(['brush', 'eraser', 'paint-bucket']));

    expect(findStudioToolByShortcut('b', false, 'component')).toBe('brush');
    expect(findStudioToolByShortcut('e', false, 'component')).toBe('eraser');
    expect(findStudioToolByShortcut('j', false, 'component')).toBe('paint-bucket');
    expect(findStudioToolByShortcut('i', false, 'component')).toBe('eyedropper');
    expect(STUDIO_TOOL_KEYBINDINGS.brush).toEqual(['B']);
    expect(STUDIO_TOOL_KEYBINDINGS.eraser).toEqual(['E']);
    expect(STUDIO_TOOL_KEYBINDINGS['paint-bucket']).toEqual(['J']);
    expect(STUDIO_TOOL_KEYBINDINGS.eyedropper).toEqual(['I']);
  });
});

describe('Vector Brush Tool (100% Vector-Native, Simplification, Presets, Draw Inside/Outside, Codegen)', () => {
  it('smooths jittery strokes with stabilizer and produces compact simplified PathNodes for all 4 presets', () => {
    const noisyStroke = Array.from({ length: 200 }, (_, i) => {
      const t = i / 199;
      const jitterY = (i % 2 === 0 ? 1 : -1) * 4.5;
      return {
        x: 40 + t * 320,
        y: 120 + Math.sin(t * Math.PI) * 70 + jitterY,
      };
    });

    const rawStabilized = stabilizeBrushPolyline(noisyStroke, 0);
    const strongStabilized = stabilizeBrushPolyline(noisyStroke, 85);
    const computeJitterEnergy = (pts: ReadonlyArray<{ x: number; y: number }>) => {
      let sum = 0;
      for (let i = 1; i < pts.length - 1; i += 1) {
        const dy1 = pts[i].y - pts[i - 1].y;
        const dy2 = pts[i + 1].y - pts[i].y;
        sum += Math.abs(dy2 - dy1);
      }
      return sum;
    };
    expect(computeJitterEnergy(strongStabilized)).toBeLessThan(computeJitterEnergy(rawStabilized) * 0.35);

    const presets = ['round', 'calligraphy', 'tapered', 'marker'] as const;
    for (const preset of presets) {
      const pathNode = buildVectorBrushPathNode(
        noisyStroke,
        {
          preset,
          size: 16,
          stabilizer: 65,
          color: 'rgba(139, 124, 246, 0.85)',
          cap: preset === 'round' ? 'square' : 'round',
        },
        () => nextId('brush'),
      );
      expect(pathNode).not.toBeNull();
      expect(pathNode!.type).toBe('path');
      expect(pathNode!.points.length).toBeGreaterThanOrEqual(4);
      expect(pathNode!.points.length).toBeLessThan(90);
      expect(JSON.stringify(pathNode)).not.toContain('data:image');
      if (preset === 'round') {
        expect(pathNode!.closed).toBe(false);
        expect(pathNode!.style.strokeWidth).toBe(16);
        expect(pathNode!.style.strokeLinecap).toBe('square');
      } else {
        expect(pathNode!.closed).toBe(true);
        expect(pathNode!.style.fill).toBe('rgba(139, 124, 246, 0.85)');
      }
    }
  });

  it('respects Draw Inside and Draw Outside modes and compiles cleanly to HTML/SVG and React TSX', async () => {
    await preloadVectorDrawingEngine();
    const brushTool = getStudioTool('brush');
    const hostInside = makeRect('host-inside', 80, 80, 260, 180, { drawMode: 'inside' });
    const hostOutside = makeRect('host-outside', 400, 80, 220, 180, { drawMode: 'outside' });
    const doc = makeDoc([hostInside, hostOutside]);

    const runBrushDrag = (selectedId: string, startX: number) => {
      const ctx = makeContext(doc.nodes, [selectedId], {
        brushPreset: 'tapered',
        brushSize: 14,
        brushStabilizer: 50,
        brushColor: '#F43F5E',
      });
      const down = brushTool.onPointerDown(makePointer({ point: { x: startX, y: 120 } }), ctx);
      const move1 = brushTool.onPointerMove(makePointer({ point: { x: startX + 60, y: 155 } }), {
        ...ctx,
        session: down.session ?? null,
      });
      const move2 = brushTool.onPointerMove(makePointer({ point: { x: startX + 130, y: 140 } }), {
        ...ctx,
        session: move1.session ?? down.session ?? null,
      });
      const up = brushTool.onPointerUp(makePointer({ point: { x: startX + 130, y: 140 } }), {
        ...ctx,
        session: move2.session ?? move1.session ?? null,
      });
      const ops = extractToolOperationsFromTransition('brush', 'component', up);
      expect(ops.length).toBeGreaterThan(0);
      const createOp = ops.find((op) => op.payload.kind === 'create-nodes');
      expect(createOp).toBeDefined();
      const evaluated = evaluateToolOperation(createOp!, {
        document: doc,
        selectedNodeIds: [selectedId],
      });
      expect(evaluated.status).toBe('ready');
      return evaluated.status === 'ready' && evaluated.operation.payload.kind === 'create-nodes'
        ? evaluated.operation.payload.nodes[0]
        : null;
    };

    const clippedInside = runBrushDrag('host-inside', 110);
    expect(clippedInside?.type).toBe('path');
    expect(clippedInside?.clipMaskBaseId).toBe('host-inside');
    expect(clippedInside?.clipMaskMode).toBe('inside');

    const clippedOutside = runBrushDrag('host-outside', 420);
    expect(clippedOutside?.type).toBe('path');
    expect(clippedOutside?.clipMaskBaseId).toBe('host-outside');
    expect(clippedOutside?.clipMaskMode).toBe('outside');

    const project = createInitialProject('Brush Codegen Test');
    project.pages[0].document.nodes = [hostInside, clippedInside!];
    const htmlOut = compileFolioProject(project, { target: 'html-css' });
    const htmlFile = htmlOut.files.find((f) => f.path.endsWith('.html'));
    expect(htmlFile?.content).toContain('<svg');
    expect(htmlFile?.content).toContain('<path');
    expect(htmlFile?.content).not.toContain('data:image');

    const reactOut = compileFolioProject(project, { target: 'react' });
    const tsxConcat = reactOut.files
      .filter((f) => f.path.endsWith('.tsx'))
      .map((f) => f.content)
      .join('\n');
    expect(tsxConcat).toContain('<svg');
    expect(tsxConcat).toContain('<path');
    expect(tsxConcat).not.toContain('data:image');
  });
});

describe('Vector Eraser Tool (Slice/Cut, Object Erase, Target Scoping, Atomic Undo/Redo)', () => {
  it('carves a closed shape via planar boolean subtraction in Slice/Cut mode and restores cleanly on Undo', async () => {
    await preloadVectorDrawingEngine();
    const targetRect = makeRect('rect-cut', 100, 100, 200, 140, {
      style: { fill: '#6366F1', stroke: '#FFFFFF', strokeWidth: 2, radius: 0 },
    });
    const lockedRect = makeRect('rect-locked', 100, 100, 200, 140, { locked: true });
    const hiddenRect = makeRect('rect-hidden', 100, 100, 200, 140, { visible: false });

    const { store, commandClient, runTransition } = createAtomicHarness([targetRect, lockedRect, hiddenRect]);
    store.dispatchLegacyAction({ type: 'select-nodes', nodeIds: ['rect-cut'] });

    const eraserTool = getStudioTool('eraser');
    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const ctx = makeContext(doc.nodes, ['rect-cut'], {
      eraserSize: 28,
      eraserMode: 'slice',
      eraserTarget: 'selected',
    });

    const down = eraserTool.onPointerDown(makePointer({ point: { x: 200, y: 70 } }), ctx);
    const move = eraserTool.onPointerMove(makePointer({ point: { x: 200, y: 270 } }), {
      ...ctx,
      session: down.session ?? null,
    });
    const up = eraserTool.onPointerUp(makePointer({ point: { x: 200, y: 270 } }), {
      ...ctx,
      session: move.session ?? down.session ?? null,
    });

    const reports = runTransition('eraser', up);
    expect(reports.some((r) => r.status === 'applied')).toBe(true);

    const afterCut = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    expect(afterCut.some((n) => n.id === 'rect-cut')).toBe(false);
    expect(afterCut.some((n) => n.id === 'rect-locked')).toBe(true);
    expect(afterCut.some((n) => n.id === 'rect-hidden')).toBe(true);
    const carvedPaths = afterCut.filter((n) => n.type === 'path') as PathNode[];
    expect(carvedPaths.length).toBeGreaterThanOrEqual(2);
    expect(carvedPaths.every((p) => p.closed && p.points.length >= 3)).toBe(true);

    commandClient.undo();
    const afterUndo = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    expect(afterUndo.map((n) => n.id)).toEqual(['rect-cut', 'rect-locked', 'rect-hidden']);

    commandClient.redo();
    const afterRedo = getActiveDocument(store.getSnapshot().editorState.project).nodes;
    expect(afterRedo.some((n) => n.id === 'rect-cut')).toBe(false);
    expect(afterRedo.filter((n) => n.type === 'path').length).toBe(carvedPaths.length);
  });

  it('splits open brush strokes in Slice/Cut mode and deletes whole touched objects in Object Erase mode', () => {
    const openStroke = makeLinePath('open-1', 60, 200, 340, 200, '#F59E0B', 6);
    const untouchedStroke = makeLinePath('open-2', 60, 420, 340, 420, '#22C55E', 6);

    const sliceResult = applyVectorEraserOperation(
      [openStroke, untouchedStroke],
      [],
      [{ x: 200, y: 150 }, { x: 200, y: 250 }],
      { size: 30, mode: 'slice', target: 'all' },
      () => nextId('cut'),
    );
    expect(sliceResult.removeIds).toEqual(['open-1']);
    expect(sliceResult.insertNodes).toHaveLength(2);
    expect(sliceResult.insertNodes.every((n) => n.type === 'path' && !n.closed)).toBe(true);

    const objectEraseSelected = applyVectorEraserOperation(
      [openStroke, untouchedStroke],
      ['open-2'],
      [{ x: 200, y: 150 }, { x: 200, y: 250 }],
      { size: 24, mode: 'object', target: 'selected' },
      () => nextId('cut'),
    );
    expect(objectEraseSelected.removeIds).toHaveLength(0);

    const objectEraseAll = applyVectorEraserOperation(
      [openStroke, untouchedStroke],
      [],
      [{ x: 200, y: 150 }, { x: 200, y: 250 }],
      { size: 24, mode: 'object', target: 'all' },
      () => nextId('cut'),
    );
    expect(objectEraseAll.removeIds).toEqual(['open-1']);
    expect(objectEraseAll.insertNodes).toHaveLength(0);
  });

  it('produces smooth Bezier curved cuts on flowing sweeps, round holes on single clicks, and handles self-overlapping scribbles cleanly', () => {
    const rect = makeRect('rect-curve', 100, 100, 260, 200, {
      style: { fill: '#6366F1', stroke: '#FFFFFF', strokeWidth: 2, radius: 0 },
    });

    // 1. Flowing curved sweep slicing cleanly across the rectangle
    const curveTrail = Array.from({ length: 18 }, (_, i) => {
      const t = i / 17;
      return {
        x: 230 + Math.sin(t * Math.PI) * 38,
        y: 70 + t * 260,
      };
    });
    const curvedCut = applyVectorEraserOperation(
      [rect],
      [],
      curveTrail,
      { size: 24, mode: 'slice', target: 'all' },
      () => nextId('curve-cut'),
    );
    expect(curvedCut.removeIds).toEqual(['rect-curve']);
    expect(curvedCut.insertNodes.length).toBeGreaterThanOrEqual(2);
    const curvedPaths = curvedCut.insertNodes as PathNode[];
    // Must contain smooth Bezier anchors along the carved curve while preserving sharp rectangle corners
    const allAnchors = curvedPaths.flatMap((p) => p.points);
    expect(allAnchors.some((a) => a.pointType === 'smooth' && (a.handleIn || a.handleOut))).toBe(true);
    expect(allAnchors.some((a) => a.pointType === 'corner')).toBe(true);

    // 2. Single-click circular dab inside rectangle carves a smooth round compound hole
    const dabResult = applyVectorEraserOperation(
      [rect],
      [],
      [{ x: 230, y: 200 }],
      { size: 40, mode: 'slice', target: 'all' },
      () => nextId('dab-cut'),
    );
    expect(dabResult.removeIds).toEqual(['rect-curve']);
    expect(dabResult.insertNodes).toHaveLength(1);
    const punched = dabResult.insertNodes[0] as PathNode;
    expect(punched.closed).toBe(true);
    expect(punched.subpaths && punched.subpaths.length).toBe(1);
    expect(punched.style.fillRule).toBe('evenodd');

    // 3. Self-overlapping figure-8 scribble falls back cleanly without breaking geometry
    const scribbleTrail = [
      { x: 180, y: 160 },
      { x: 260, y: 230 },
      { x: 260, y: 160 },
      { x: 180, y: 230 },
      { x: 210, y: 195 },
    ];
    const scribbleResult = applyVectorEraserOperation(
      [rect],
      [],
      scribbleTrail,
      { size: 26, mode: 'slice', target: 'all' },
      () => nextId('scribble-cut'),
    );
    expect(scribbleResult.removeIds).toEqual(['rect-curve']);
    expect(scribbleResult.insertNodes.length).toBeGreaterThanOrEqual(1);

    // 4. Live Object Erase preview hit-test helper & smooth SVG trail path builder
    const otherRect = makeRect('rect-far', 600, 600, 80, 80);
    const touched = findTouchedEraserNodeIds(
      [rect, otherRect],
      [],
      [{ x: 150, y: 150 }, { x: 190, y: 170 }],
      { size: 24, target: 'all' },
    );
    expect(touched).toEqual(['rect-curve']);

    expect(buildSmoothSvgTrailPath([{ x: 10, y: 20 }])).toContain('M 10 20');
    expect(buildSmoothSvgTrailPath([{ x: 10, y: 20 }, { x: 30, y: 40 }])).toBe('M 10 20 L 30 40');
    expect(buildSmoothSvgTrailPath([{ x: 10, y: 20 }, { x: 20, y: 35 }, { x: 40, y: 25 }])).toContain('Q 20 35');
  });
});

describe('Paint Bucket Tool (Existing Fill/Stroke, Transparent Clear, Closed Region & Gap Closing)', () => {
  it('fills existing objects, clears fill with transparent, and supports atomic Undo/Redo', async () => {
    await preloadVectorDrawingEngine();
    const box = makeRect('bucket-box', 120, 120, 180, 120, {
      style: { fill: '#38BDF8', stroke: '#1E293B', strokeWidth: 2, radius: 0 },
    });
    const { store, commandClient, runTransition } = createAtomicHarness([box]);
    const bucketTool = getStudioTool('paint-bucket');

    const doc1 = getActiveDocument(store.getSnapshot().editorState.project);
    const fillTransition = bucketTool.onPointerDown(
      makePointer({ point: { x: 200, y: 170 }, targetNodeId: 'bucket-box' }),
      makeContext(doc1.nodes, [], {
        paintBucketColor: 'rgba(244, 63, 94, 0.75)',
        paintBucketTarget: 'fill',
      }),
    );
    runTransition('paint-bucket', fillTransition);
    const filledBox = getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode;
    expect(filledBox.style.fill).toBe('rgba(244, 63, 94, 0.75)');

    const doc2 = getActiveDocument(store.getSnapshot().editorState.project);
    const clearTransition = bucketTool.onPointerDown(
      makePointer({ point: { x: 200, y: 170 }, targetNodeId: 'bucket-box' }),
      makeContext(doc2.nodes, [], {
        paintBucketColor: 'transparent',
        paintBucketTarget: 'fill',
      }),
    );
    runTransition('paint-bucket', clearTransition);
    const clearedBox = getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode;
    expect(clearedBox.style.fill).toBe('transparent');

    commandClient.undo();
    expect((getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode).style.fill).toBe(
      'rgba(244, 63, 94, 0.75)',
    );
    commandClient.undo();
    expect((getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode).style.fill).toBe('#38BDF8');
  });

  it('detects enclosed empty regions bounded by intersecting paths and honors Gap Closing tolerance', () => {
    const top = makeLinePath('l-top', 80, 100, 280, 100);
    const bottom = makeLinePath('l-bot', 80, 220, 280, 220);
    const left = makeLinePath('l-left', 100, 80, 100, 240);
    const right = makeLinePath('l-right', 260, 80, 260, 240);

    const closedResult = applyPaintBucketOperation(
      [top, bottom, left, right],
      { x: 180, y: 160 },
      { color: '#22C55E', target: 'smart-region', gapTolerance: 'tight' },
      () => nextId('fill'),
    );
    expect(closedResult.kind).toBe('create');
    if (closedResult.kind === 'create') {
      const region = closedResult.nodes[0];
      expect(region.type).toBe('path');
      expect(region.closed).toBe(true);
      expect(region.style.fill).toBe('#22C55E');
      expect(region.width).toBeCloseTo(160, 0);
      expect(region.height).toBeCloseTo(120, 0);
    }

    // Near-closed square with a 10px corner gap at top-right
    const gapTop = makeLinePath('g-top', 100, 100, 250, 100);
    const gapRight = makeLinePath('g-right', 260, 100, 260, 220);
    const gapBottom = makeLinePath('g-bot', 260, 220, 100, 220);
    const gapLeft = makeLinePath('g-left', 100, 220, 100, 100);

    const tightGap = applyPaintBucketOperation(
      [gapTop, gapRight, gapBottom, gapLeft],
      { x: 180, y: 160 },
      { color: '#F59E0B', target: 'smart-region', gapTolerance: 'tight' },
      () => nextId('fill'),
    );
    expect(tightGap.kind).toBe('none');

    const mediumGap = applyPaintBucketOperation(
      [gapTop, gapRight, gapBottom, gapLeft],
      { x: 180, y: 160 },
      { color: '#F59E0B', target: 'smart-region', gapTolerance: 'medium' },
      () => nextId('fill'),
    );
    expect(mediumGap.kind).toBe('create');
    if (mediumGap.kind === 'create') {
      const region = mediumGap.nodes[0];
      expect(region.type).toBe('path');
      expect(region.closed).toBe(true);
      expect(region.style.fill).toBe('#F59E0B');
    }
  });
});

describe('Eyedropper Tool (Accurate Color + Alpha Sampling & Pipeline Sync)', () => {
  it('samples solid, RGBA, node-opacity-combined, stroke, and transparent colors accurately', () => {
    const semiNode = makeRect('semi', 40, 40, 100, 80, {
      opacity: 0.5,
      style: { fill: '#38BDF8', stroke: 'rgba(244, 63, 94, 0.8)', strokeWidth: 4, radius: 0 },
    });
    const transparentNode = makeRect('clear', 180, 40, 100, 80, {
      style: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0, radius: 0 },
    });

    const fillSample = extractSampledColor(semiNode, '#111827', 'fill');
    expect(fillSample.isTransparent).toBe(false);
    expect(fillSample.hex).toBe('#38BDF8');
    expect(fillSample.alpha).toBeCloseTo(0.5, 2);
    expect(fillSample.color).toBe('rgba(56, 189, 248, 0.5)');

    const strokeSample = extractSampledColor(semiNode, '#111827', 'stroke');
    expect(strokeSample.isTransparent).toBe(false);
    expect(strokeSample.hex).toBe('#F43F5E');
    expect(strokeSample.alpha).toBeCloseTo(0.4, 2);
    expect(strokeSample.color).toBe('rgba(244, 63, 94, 0.4)');

    const emptySample = extractSampledColor(transparentNode, '#111827', 'fill');
    expect(emptySample.isTransparent).toBe(true);
    expect(emptySample.color).toBe('transparent');
    expect(emptySample.alpha).toBe(0);

    const targetNode = makeRect('target', 300, 40, 100, 80, {
      style: { fill: '#FFFFFF', stroke: '#000000', strokeWidth: 2, radius: 0 },
    });
    const { store, sampledOptions, runTransition } = createAtomicHarness([semiNode, targetNode]);
    store.dispatchLegacyAction({ type: 'select-nodes', nodeIds: ['target'] });

    const eyedropper = getStudioTool('eyedropper');
    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const transition = eyedropper.onPointerDown(
      makePointer({ point: { x: 80, y: 80 }, targetNodeId: 'semi' }),
      makeContext(doc.nodes, ['target']),
    );
    runTransition('eyedropper', transition);

    expect(sampledOptions.at(-1)?.color).toBe('rgba(56, 189, 248, 0.5)');
    const updatedTarget = getActiveDocument(store.getSnapshot().editorState.project).nodes.find(
      (n) => n.id === 'target',
    ) as RectNode;
    expect(updatedTarget.style.fill).toBe('rgba(56, 189, 248, 0.5)');
  });
});

describe('Zero-Typing Contextual ToolOptionsBar UI', () => {
  it('renders strictly Zero-Typing controls (no text/number inputs) for Brush, Eraser, Paint Bucket, and Eyedropper', () => {
    const tokens = createDefaultDesignTokens();
    const onChangeOptions = vi.fn();

    for (const activeTool of ['brush', 'eraser', 'paint-bucket', 'eyedropper'] as const) {
      const tree = ToolOptionsBar({
        workspace: 'component',
        toolId: activeTool,
        toolOptions: DEFAULT_CANVAS_TOOL_OPTIONS,
        selectedNodes: [],
        designTokens: tokens,
        onChangeOptions,
        onPathfinder: () => {},
        onConvertToPath: () => {},
        onFlip: () => {},
        onRotate90: () => {},
        onSimplifyPath: () => {},
        onTogglePathClosed: () => {},
      });

      const forbiddenInputs = findVNodes(
        tree,
        (vnode) => vnode.type === 'input' && (vnode.props.type === 'number' || vnode.props.type === 'text'),
      );
      expect(forbiddenInputs).toHaveLength(0);

      if (activeTool === 'brush') {
        const presetSelect = findVNodes(
          tree,
          (vnode) => vnode.type === 'select' && vnode.props['aria-label'] === 'Brush preset',
        )[0];
        expect(presetSelect).toBeDefined();
        (presetSelect.props.onChange as (event: unknown) => void)({ target: { value: 'calligraphy' } });
        expect(onChangeOptions).toHaveBeenCalledWith({ brushPreset: 'calligraphy' });
      }
      if (activeTool === 'eraser') {
        const modeSelect = findVNodes(
          tree,
          (vnode) => vnode.type === 'select' && vnode.props['aria-label'] === 'Eraser mode',
        )[0];
        expect(modeSelect).toBeDefined();
        (modeSelect.props.onChange as (event: unknown) => void)({ target: { value: 'object' } });
        expect(onChangeOptions).toHaveBeenCalledWith({ eraserMode: 'object' });
      }
      if (activeTool === 'paint-bucket') {
        const transparentBtn = findVNodes(
          tree,
          (vnode) => vnode.type === 'button' && getTextContent(vnode).includes('Transparent'),
        )[0];
        expect(transparentBtn).toBeDefined();
        (transparentBtn.props.onClick as () => void)();
        expect(onChangeOptions).toHaveBeenCalledWith({ paintBucketColor: 'transparent', paintBucketTokenId: undefined });
      }
      if (activeTool === 'eyedropper') {
        const eyedropperRow = findVNodes(
          tree,
          (vnode) => vnode.props['data-testid'] === 'eyedropper-options',
        );
        expect(eyedropperRow).toHaveLength(1);
      }
    }
  });
});

describe('.flop Round-Trip Portability & Size Budget for Full Vector Drawings', () => {
  it('round-trips multi-preset brush strokes, erased shapes, and live fills cleanly without raster bloat', () => {
    const project = createInitialProject('Full Vector Drawing Artwork');
    const nodes: DesignNode[] = [];

    const presets = ['round', 'calligraphy', 'tapered', 'marker'] as const;
    presets.forEach((preset, idx) => {
      const pts = Array.from({ length: 80 }, (_, i) => ({
        x: 60 + i * 6,
        y: 80 + idx * 70 + Math.sin(i * 0.25) * 24,
      }));
      const stroke = buildVectorBrushPathNode(
        pts,
        {
          preset,
          size: 10 + idx * 4,
          stabilizer: 60,
          color: '#8B7CF6',
          cap: 'round',
        },
        () => nextId('brush'),
      );
      expect(stroke).not.toBeNull();
      nodes.push(stroke!);
    });

    const baseRect = makeRect('base-rect', 420, 120, 180, 140);
    const erased = applyVectorEraserOperation(
      [baseRect],
      [],
      [{ x: 510, y: 90 }, { x: 510, y: 290 }],
      { size: 22, mode: 'slice', target: 'all' },
      () => nextId('cut'),
    );
    nodes.push(...erased.insertNodes);

    const frameLines = [
      makeLinePath('f1', 90, 380, 290, 380),
      makeLinePath('f2', 290, 380, 290, 520),
      makeLinePath('f3', 290, 520, 90, 520),
      makeLinePath('f4', 90, 520, 90, 380),
    ];
    const bucketFill = applyPaintBucketOperation(
      frameLines,
      { x: 190, y: 450 },
      { color: 'rgba(56, 189, 248, 0.7)', target: 'smart-region', gapTolerance: 'tight' },
      () => nextId('fill'),
    );
    expect(bucketFill.kind).toBe('create');
    nodes.push(...frameLines);
    if (bucketFill.kind === 'create') nodes.push(...bucketFill.nodes);

    project.pages[0].document.nodes = nodes;

    const flopJson = serializeProjectToFlopJson(project);
    const byteLength = new TextEncoder().encode(flopJson).byteLength;

    expect(flopJson).not.toContain('data:image');
    expect(byteLength).toBeLessThan(100 * 1024);

    const parsedRaw = parseProjectJsonSafe(flopJson);
    const migrated = migrateProjectToV2(parsedRaw);
    const validation = validateProject(migrated);
    expect(validation.ok).toBe(true);
    expect(migrated.pages[0].document.nodes).toHaveLength(nodes.length);
    expect(migrated.pages[0].document.nodes.every((n) => n.type === 'path')).toBe(true);
  });
});
