import { describe, expect, it, vi } from 'vitest';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import {
  createComponentCanvasCommandClient,
  createMainCanvasCommandClient,
} from '../src/app/mainCanvasCommandClient';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';
import { createMotionAutoKeyBridge } from '../src/app/workspace/motionAutoKeyBridge';
import type { MotionPlaybackController } from '../src/app/workspace/useMotionPlayback';
import { validateDocumentSetSizePayload } from '../src/core/commands/validation';
import { areDocumentsStructurallyEqual } from '../src/core/document/equality';
import {
  createEmptyDocument,
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import type { DesignNode, ImageNode, RectNode, TextNode } from '../src/core/document/types';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  TOOL_OPERATION_PROTOCOL,
  TOOL_OPERATION_VERSION,
  validateToolOperationEnvelope,
  type ToolOperation,
} from '../src/core/tools/operationContract';
import { applyAnimatedPosesToDocument } from '../src/engines/animation/evaluator';
import { evaluateToolOperation } from '../src/engines/canvas/geometryEngine';
import { getBounds } from '../src/engines/canvas/geometry';
import { getStudioTool } from '../src/engines/canvas/tools/studioRegistry';
import type { CanvasToolContext, CanvasToolPointerInput } from '../src/engines/canvas/tools/types';
import { buildLivePreviewHtml, compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';

function makePointerInput(
  x: number,
  y: number,
  overrides: Partial<CanvasToolPointerInput> = {},
): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point: { x, y },
    clientX: x,
    clientY: y,
    viewportAnchor: { x, y },
    targetNodeId: null,
    resizeHandle: null,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    detail: 1,
    ...overrides,
  };
}

function makeToolContext(
  nodes: DesignNode[],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const doc = { ...createEmptyDocument('Test Doc', 1440, 900), nodes };
  const selectedNodeIds = overrides.selectedNodeIds ?? [];
  const selectedNodes = overrides.selectedNodes ?? nodes.filter((n) => selectedNodeIds.includes(n.id));
  const selectionBounds =
    overrides.selectionBounds !== undefined
      ? overrides.selectionBounds
      : selectedNodes.length > 0
        ? getBounds(selectedNodes)
        : null;

  return {
    document: doc,
    canvasNodes: nodes,
    selectableNodes: nodes.filter((n) => n.visible && !n.locked),
    otherNodes: nodes,
    selectedNodeIds,
    selectedNodes,
    selectionBounds,
    zoom: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 1440,
    session: null,
    toolOptions: DEFAULT_CANVAS_TOOL_OPTIONS,
    ...overrides,
  };
}

function makeTransformOperation(nodes: DesignNode[], id = 'op-transform-1'): ToolOperation {
  return {
    protocol: TOOL_OPERATION_PROTOCOL,
    version: TOOL_OPERATION_VERSION,
    operationId: id,
    toolId: 'select',
    workspace: 'main',
    category: 'document-mutation',
    payload: {
      kind: 'transform-nodes',
      nodes,
    },
    metadata: {
      atomicHistoryStep: true,
      description: 'Transform nodes on canvas',
    },
  };
}

describe('P1 Two-Way Canvas Editing, Resizable Component Canvas, Device-Fit Preview & Zero-Stroke Defaults', () => {
  it('accepts Inspector-authored modern CSS/unit/state fields in Canvas tool operation validation (prevents edit bounce-back)', () => {
    const editedRect: RectNode = {
      ...createRectNode(0),
      id: 'rect-modern',
      x: 240,
      y: 160,
      width: 300,
      height: 180,
      htmlId: 'hero-card',
      className: 'card elevated',
      linkTarget: '_blank',
      cursor: 'pointer',
      pointerEvents: 'auto',
      userSelect: 'none',
      cssFilters: { brightness: 105, contrast: 110, saturate: 115, grayscale: 0 },
      transition: { preset: 'smooth', durationMs: 220, durationUnit: 'ms' },
      stateOverrides: {
        hover: { fill: '#6D28D9', opacity: 0.95, scale: 1.03 },
      },
      style: {
        fill: '#8B7CF6',
        stroke: '#1E293B',
        strokeWidth: 2,
        strokeWidthUnit: 'px',
        strokeStyle: 'dashed',
        borderSides: {
          top: { width: 2, widthUnit: 'px', color: '#1E293B', style: 'solid' },
          bottom: { width: 1, widthUnit: 'px', color: '#475569', style: 'dashed' },
        },
        radius: 18,
        radiusUnit: 'px',
      },
    };

    const editedText: TextNode = {
      ...createTextNode(1),
      id: 'text-modern',
      x: 100,
      y: 100,
      style: {
        fill: '#111827',
        fontSize: 1.5,
        fontSizeUnit: 'rem',
        fontFamily: 'Inter',
        fontWeight: 600,
        letterSpacing: 0.02,
        letterSpacingUnit: 'em',
        lineHeight: 140,
        lineHeightUnit: '%',
      },
    };

    const editedImage: ImageNode = {
      id: 'img-modern',
      type: 'image',
      name: 'Hero Photo',
      x: 420,
      y: 120,
      width: 240,
      height: 160,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: 'asset-1',
      alt: 'Hero preview',
      naturalWidth: 800,
      naturalHeight: 600,
      style: {
        fit: 'cover',
        radius: 12,
        radiusUnit: 'px',
        stroke: '#334155',
        strokeWidth: 2,
        strokeWidthUnit: 'px',
        strokeStyle: 'solid',
        borderSides: {
          top: { width: 2, color: '#334155', style: 'solid' },
          bottom: { width: 2, color: '#334155', style: 'solid' },
        },
      },
    };

    const envelope = makeTransformOperation([editedRect, editedText, editedImage]);
    const validation = validateToolOperationEnvelope(envelope);
    expect(validation.ok, validation.error).toBe(true);
  });

  it('clears stale non-fixed layoutChild axis sizing when resizing on Canvas so edits stay 2-way synced', () => {
    const rect: RectNode = {
      ...createRectNode(0),
      id: 'rect-fluid',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      layoutChild: {
        widthMode: 'relative',
        widthValue: { value: 50, unit: '%' },
        heightMode: 'fill',
        heightValue: { value: 40, unit: 'vh' },
      },
    };
    const selectTool = getStudioTool('select');
    const ctx = makeToolContext([rect], { selectedNodeIds: [rect.id] });

    // Start resize on East handle (right middle at x=300, y=160)
    const down = selectTool.onPointerDown(
      makePointerInput(300, 160, { targetNodeId: rect.id, resizeHandle: 'e' }),
      ctx,
    );
    expect(down.session).toBeTruthy();

    const move = selectTool.onPointerMove(
      makePointerInput(380, 160),
      { ...ctx, session: down.session ?? null },
    );
    const resized = move.previewNodes?.[0];
    expect(resized).toBeDefined();
    expect(resized!.width).toBeGreaterThan(200);
    // Width axis was resized -> cleared widthValue and switched to fixed
    expect(resized!.layoutChild?.widthMode).toBe('fixed');
    expect(resized!.layoutChild?.widthValue).toBeUndefined();
    // Height axis was NOT touched by east handle -> preserved
    expect(resized!.layoutChild?.heightMode).toBe('fill');
    expect(resized!.layoutChild?.heightValue).toEqual({ value: 40, unit: 'vh' });
  });

  it('exits stale Motion Timeline preview when editing with Auto-Key OFF and syncs 0.00s keyframes even on no-op', () => {
    const project = createInitialProject('Motion 2-Way');
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient: client,
      shell: {
        onSelectionChange: vi.fn(),
        onPanChange: vi.fn(),
        onZoomChange: vi.fn(),
        onToolChange: vi.fn(),
        onNotice: vi.fn(),
      },
    });
    const doc = getActiveDocument(store.getSnapshot().editorState.project);
    const targetNode = doc.nodes[0];

    const exitPreview = vi.fn();
    const recordAutoKeyNodes = vi.fn(() => ({ captured: true, keepCanonicalUnchanged: false }));

    const baseMotion: MotionPlaybackController = {
      motionOpen: true,
      autoKeyEnabled: false,
      pageClips: [],
      activeClip: null,
      playheadMs: 600,
      isPlaying: false,
      previewActive: true,
      animatedMainDocument: doc,
      toggleMotionOpen: vi.fn(),
      toggleAutoKey: vi.fn(),
      closeMotion: vi.fn(),
      selectClip: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      exitPreview,
      togglePlay: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      createNewClip: vi.fn(),
      applyPreset: vi.fn(),
      deleteActiveClip: vi.fn(),
      updateClip: vi.fn(),
      updateCustomEasings: vi.fn(),
      keyframeSelectedLayers: vi.fn(),
      keyframeShapeMorph: vi.fn(),
      importShapeMorphFromComponent: vi.fn(),
      togglePropertyKeyframe: vi.fn(),
      isPropertyKeyedAtPlayhead: vi.fn(() => false),
      recordAutoKeyNodes,
    };

    const movedNode: DesignNode = { ...targetNode, x: targetNode.x + 40 };
    const bridgeOff = createMotionAutoKeyBridge({
      activeEditorId: 'main',
      motion: baseMotion,
      inspectorSelectedNode: targetNode,
      mainToolOperationExecutor: executor,
      componentToolOperationExecutor: executor,
      onUpdateSelectedFallback: vi.fn(),
      onUpdateSelectedStyleFallback: vi.fn(),
      onSampledColorOption: vi.fn(),
      onCanvasInteraction: vi.fn(),
    });

    const evaluatedMove = evaluateToolOperation(makeTransformOperation([movedNode], 'op-move-1'), {
      document: doc,
      selectedNodeIds: [targetNode.id],
    });
    expect(evaluatedMove.status).toBe('ready');
    if (evaluatedMove.status !== 'ready') return;

    // Auto-Key OFF + previewActive true -> exits preview so canonical edit stays visible
    bridgeOff.executeMainToolOperations([evaluatedMove.operation]);
    expect(exitPreview).toHaveBeenCalledTimes(1);
    expect(getActiveDocument(store.getSnapshot().editorState.project).nodes[0].x).toBe(movedNode.x);

    // Auto-Key ON at 0.00s + canonical already at movedNode.x -> still syncs 0.00s keyframe on no-op!
    const bridgeAtZero = createMotionAutoKeyBridge({
      activeEditorId: 'main',
      motion: { ...baseMotion, autoKeyEnabled: true, playheadMs: 0 },
      inspectorSelectedNode: movedNode,
      mainToolOperationExecutor: executor,
      componentToolOperationExecutor: executor,
      onUpdateSelectedFallback: vi.fn(),
      onUpdateSelectedStyleFallback: vi.fn(),
      onSampledColorOption: vi.fn(),
      onCanvasInteraction: vi.fn(),
    });
    const reports = bridgeAtZero.executeMainToolOperations([evaluatedMove.operation]);
    expect(reports[0]?.status).toBe('no-op');
    expect(recordAutoKeyNodes).toHaveBeenCalledTimes(1);
  });

  it('clears stale cornerRadii when applying an animated uniform radius pose', () => {
    const rect: RectNode = {
      ...createRectNode(0),
      id: 'r-anim',
      style: {
        fill: '#8B7CF6',
        stroke: '#00000000',
        strokeWidth: 0,
        radius: 8,
        cornerRadii: { topLeft: 4, topRight: 16, bottomRight: 4, bottomLeft: 16 },
      },
    };
    const doc = { ...createEmptyDocument('Anim', 800, 600), nodes: [rect] };
    const evaluated = applyAnimatedPosesToDocument(doc, { 'r-anim': { radius: 32 } });
    const nextRect = evaluated.nodes[0] as RectNode;
    expect(nextRect.style.radius).toBe(32);
    expect(nextRect.style.cornerRadii).toBeUndefined();
  });

  it('resizes Component Canvas document via document.set-size Native Command with validation, structural sync detection, and Undo/Redo', () => {
    expect(validateDocumentSetSizePayload({ width: 800, height: 600 }).ok).toBe(true);
    expect(validateDocumentSetSizePayload({ width: 20, height: 600 }).ok).toBe(false);
    expect(validateDocumentSetSizePayload({ width: 9000, height: 600 }).ok).toBe(false);

    const project = createInitialProject('Comp Resize');
    const masterDoc = createEmptyDocument('Button Master', 420, 280);
    const compProject = {
      ...project,
      pages: [{ id: 'comp-page', name: 'Master', route: '/', document: masterDoc }],
      activePageId: 'comp-page',
    };
    const store = createCanonicalEditorStore(createEditorState(compProject), { workspace: 'component' });
    const client = createComponentCanvasCommandClient(store);

    const res = client.setDocumentSize(760, 520, 'Resize component canvas');
    expect(res.status).toBe('applied');
    const resizedDoc = getActiveDocument(store.getSnapshot().editorState.project);
    expect(resizedDoc.width).toBe(760);
    expect(resizedDoc.height).toBe(520);
    expect(areDocumentsStructurallyEqual(masterDoc, resizedDoc)).toBe(false);

    // Undo restores 420 x 280, Redo restores 760 x 520
    expect(client.undo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).width).toBe(420);
    expect(getActiveDocument(store.getSnapshot().editorState.project).height).toBe(280);

    expect(client.redo().status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).width).toBe(760);
    expect(getActiveDocument(store.getSnapshot().editorState.project).height).toBe(520);
  });

  it('compiles device-fitting section CSS for both narrow and wide viewports as well as fluid responsive layouts', () => {
    const freeformProject = createInitialProject('Freeform Section');
    const freeformPage = getActivePage(freeformProject);
    freeformPage.document.nodes = [
      { ...createRectNode(0), id: 'card', x: 100, y: 100, width: 400, height: 240 },
    ];

    const freeformCompiled = compilePageHtmlCss(freeformProject, freeformPage);
    expect(freeformCompiled.cssFile.content).toContain('@media (max-width: 1439px)');
    expect(freeformCompiled.cssFile.content).toContain('@media (min-width: 1441px)');
    const previewHtml = buildLivePreviewHtml(freeformProject);
    expect(previewHtml).toContain('min-height: 100dvh;');
    expect(previewHtml).toContain('overflow-x: hidden;');

    const responsiveProject = createInitialProject('Responsive Sections');
    const responsivePage = getActivePage(responsiveProject);
    responsivePage.document.nodes = [
      {
        ...createFrameNode(0, 0, 1440, 600, { name: 'Hero Section', isSection: true }),
        layout: {
          mode: 'flex',
          direction: 'column',
          wrap: 'nowrap',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 16,
          padding: { top: 48, right: 24, bottom: 48, left: 24 },
        },
      },
    ];
    const responsiveCompiled = compilePageHtmlCss(responsiveProject, responsivePage);
    expect(responsiveCompiled.cssFile.content).toContain('width: 100%;');
    expect(responsiveCompiled.cssFile.content).toContain('max-width: none;');
    expect(responsiveCompiled.cssFile.content).toContain('min-height: 100dvh;');
  });

  it('defaults newly drawn closed shapes to strokeWidth 0 while keeping lines and arrows visibly stroked', () => {
    expect(DEFAULT_CANVAS_TOOL_OPTIONS.strokeWidth).toBe(0);

    for (const toolId of ['draw-rect', 'draw-ellipse', 'draw-triangle', 'draw-polygon', 'draw-star'] as const) {
      const tool = getStudioTool(toolId);
      const ctx = makeToolContext([]);
      const down = tool.onPointerDown(makePointerInput(100, 100), ctx);
      const move = tool.onPointerMove(makePointerInput(260, 220), { ...ctx, session: down.session ?? null });
      const up = tool.onPointerUp(makePointerInput(260, 220), { ...ctx, session: move.session ?? null });
      const created = up.createNodes?.[0];
      expect(created, `Expected ${toolId} to create a node`).toBeDefined();
      expect('style' in created! && 'strokeWidth' in created.style ? created.style.strokeWidth : -1).toBe(0);
      expect('style' in created! && 'stroke' in created.style ? created.style.stroke : '').toBe('#00000000');
    }

    for (const toolId of ['draw-line', 'draw-arrow'] as const) {
      const tool = getStudioTool(toolId);
      const ctx = makeToolContext([]);
      const down = tool.onPointerDown(makePointerInput(100, 100), ctx);
      const move = tool.onPointerMove(makePointerInput(280, 100), { ...ctx, session: down.session ?? null });
      const up = tool.onPointerUp(makePointerInput(280, 100), { ...ctx, session: move.session ?? null });
      const created = up.createNodes?.[0];
      expect(created).toBeDefined();
      expect('style' in created! && 'strokeWidth' in created.style ? created.style.strokeWidth : 0).toBeGreaterThanOrEqual(2);
    }
  });
});
