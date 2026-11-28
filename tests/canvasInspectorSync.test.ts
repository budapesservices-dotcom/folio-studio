import { describe, expect, it } from 'vitest';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createWorkspaceCommandClient } from '../src/app/mainCanvasCommandClient';
import { createToolOperationExecutor } from '../src/app/toolOperationExecutor';
import { createInitialProject, createRectNode, createTextNode } from '../src/core/document/factory';
import { classifyNodeChange } from '../src/core/document/nodeChanges';
import { getActiveDocument } from '../src/core/document/project';
import {
  createDefaultLinearGradientFill,
  createDefaultVisualEffect,
} from '../src/core/document/styling';
import type {
  ComponentInstanceNode,
  DesignNode,
  FrameNode,
  ImageNode,
  PathNode,
  RectNode,
  TextNode,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  createToolOperation,
  DEFAULT_CANVAS_TOOL_OPTIONS,
  validateDesignNodePayload,
} from '../src/core/tools/operationContract';
import {
  computeProportionalDimensions,
  getBounds,
} from '../src/engines/canvas/geometry';
import {
  evaluateToolOperation,
  evaluateToolOperationBatch,
} from '../src/engines/canvas/geometryEngine';
import { selectTool } from '../src/engines/canvas/tools/select';
import type { CanvasToolContext, CanvasToolPointerInput } from '../src/engines/canvas/tools/types';

function makePointerInput(
  overrides: Partial<CanvasToolPointerInput> = {},
): CanvasToolPointerInput {
  return {
    pointerId: 1,
    button: 0,
    point: { x: 0, y: 0 },
    clientX: 0,
    clientY: 0,
    viewportAnchor: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    detail: 1,
    targetNodeId: null,
    resizeHandle: null,
    rotateHandle: false,
    smartHandleHit: null,
    anchorHit: null,
    ...overrides,
  };
}

function makeToolContext(
  nodes: DesignNode[],
  selectedIds: string[],
  session: CanvasToolContext['session'] = null,
): CanvasToolContext {
  return {
    document: {
      id: 'doc-1',
      name: 'Page 1',
      width: 1200,
      height: 800,
      background: '#111827',
      nodes,
    },
    canvasNodes: nodes,
    selectableNodes: nodes,
    otherNodes: nodes,
    selectedNodeIds: selectedIds,
    selectedNodes: nodes.filter((node) => selectedIds.includes(node.id)),
    selectionBounds: getBounds(nodes.filter((node) => selectedIds.includes(node.id))),
    zoom: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 1200,
    session,
    customPivot: null,
    activeAnchor: null,
    toolOptions: { ...DEFAULT_CANVAS_TOOL_OPTIONS },
  };
}

function makeRect(overrides: Partial<RectNode> = {}): RectNode {
  return {
    ...createRectNode(0),
    id: 'rect-1',
    name: 'Card',
    x: 100,
    y: 100,
    width: 200,
    height: 120,
    ...overrides,
  };
}

describe('Canvas <-> Inspector sync & aspect-ratio lock', () => {
  it('allows canvas resize and corner-radius edits after Inspector adds v2 fills, effects, blendMode, semantics, and tokens without snapping back', () => {
    const project = createInitialProject('Sync Test');
    const rect = makeRect();
    project.pages[0].document.nodes = [rect];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createWorkspaceCommandClient(store, 'main');
    const executor = createToolOperationExecutor({
      workspace: 'main',
      commandClient: client,
      shell: {
        onSelectionChange: () => {},
        onPanChange: () => {},
        onZoomChange: () => {},
      },
    });

    // Step 1: Initial canvas edit (move + round corners)
    const afterFirstCanvas: RectNode = {
      ...rect,
      x: 140,
      y: 130,
      style: { ...rect.style, radius: 16 },
    };
    const firstBatch = evaluateToolOperationBatch(
      [
        createToolOperation('select', 'main', {
          kind: 'transform-nodes',
          nodes: [afterFirstCanvas],
        }),
      ],
      { document: getActiveDocument(store.getSnapshot().editorState.project), selectedNodeIds: [rect.id] },
    );
    expect(firstBatch.status).toBe('ready');
    const firstReports = executor.executeBatch(firstBatch.ready);
    expect(firstReports.every((report) => report.status === 'applied')).toBe(true);

    // Step 2: Inspector edit adding modern v2 properties (multi-fill gradient, drop shadow, blendMode, semantics, tokenBindings)
    const currentAfterCanvas = getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode;
    const inspectorEdited: RectNode = {
      ...currentAfterCanvas,
      width: 240,
      height: 160,
      blendMode: 'multiply',
      effects: [createDefaultVisualEffect('drop-shadow', 'fx-1')],
      semanticTag: 'section',
      ariaLabel: 'Hero Card',
      tokenBindings: { fill: 'tok-color-violet-500' },
      style: {
        ...currentAfterCanvas.style,
        radius: 24,
        fills: [createDefaultLinearGradientFill('fill-grad-1')],
      },
    };
    const editResult = client.editNode(inspectorEdited, `inspector:${rect.id}`, 'Edit layer properties');
    expect(editResult.status).toBe('applied');
    expect(client.commitEdit().status).toBe('applied');

    // Step 3: Canvas resize & corner-radius edit AFTER Inspector edits — must NOT reject or snap back!
    const currentAfterInspector = getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode;
    const enlargedOnCanvas: RectNode = {
      ...currentAfterInspector,
      width: 380,
      height: 260,
      style: { ...currentAfterInspector.style, radius: 36 },
    };
    const secondBatch = evaluateToolOperationBatch(
      [
        createToolOperation('select', 'main', {
          kind: 'transform-nodes',
          nodes: [enlargedOnCanvas],
        }),
      ],
      { document: getActiveDocument(store.getSnapshot().editorState.project), selectedNodeIds: [rect.id] },
    );
    expect(secondBatch.status).toBe('ready');
    expect(secondBatch.rejected).toHaveLength(0);
    const secondReports = executor.executeBatch(secondBatch.ready);
    expect(secondReports.every((report) => report.status === 'applied')).toBe(true);

    const finalNode = getActiveDocument(store.getSnapshot().editorState.project).nodes[0] as RectNode;
    expect(finalNode.width).toBe(380);
    expect(finalNode.height).toBe(260);
    expect(finalNode.style.radius).toBe(36);
    expect(finalNode.blendMode).toBe('multiply');
    expect(finalNode.effects).toHaveLength(1);
    expect(finalNode.style.fills).toHaveLength(1);
    expect(finalNode.semanticTag).toBe('section');
    expect(finalNode.tokenBindings?.fill).toBe('tok-color-violet-500');
  });

  it('validates Image, styled Text, gradient Path, Auto-Layout Frame, and Variant ComponentInstance nodes in Tool Operation Contract', () => {
    const imageNode: ImageNode = {
      id: 'img-1',
      name: 'Hero Photo',
      type: 'image',
      x: 40,
      y: 40,
      width: 320,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      aspectRatioLocked: true,
      assetId: 'asset-hero-1',
      alt: 'Hero banner',
      naturalWidth: 1600,
      naturalHeight: 1000,
      style: { fit: 'cover', radius: 12, stroke: '#1E293B', strokeWidth: 1 },
    };

    const textNode: TextNode = {
      ...createTextNode(0),
      id: 'txt-1',
      name: 'Heading',
      x: 50,
      y: 60,
      text: 'Hello Folio',
      blendMode: 'screen',
      effects: [createDefaultVisualEffect('layer-blur', 'fx-blur-1')],
      style: {
        fill: '#F8FAFC',
        fontSize: 32,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 700,
        letterSpacing: -0.5,
        lineHeight: 1.2,
        textAlign: 'center',
        textWrap: 'wrap',
        textTransform: 'uppercase',
        textDecoration: 'underline',
      },
    };

    const pathNode: PathNode = {
      id: 'path-1',
      name: 'Vector Badge',
      type: 'path',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      closed: true,
      points: [
        { id: 'pt-1', x: 0, y: 0, pointType: 'corner' },
        { id: 'pt-2', x: 100, y: 0, pointType: 'corner' },
        { id: 'pt-3', x: 50, y: 100, pointType: 'corner' },
      ],
      style: {
        fill: '#6366F1',
        fills: [createDefaultLinearGradientFill('path-grad-1')],
        stroke: '#FFFFFF',
        strokeWidth: 2,
      },
    };

    const frameNode: FrameNode = {
      id: 'frame-1',
      name: 'Stack',
      type: 'frame',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      aspectRatioLocked: false,
      clipContent: true,
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        alignItems: 'stretch',
        justifyContent: 'start',
      },
      style: { fill: '#111827', stroke: '#334155', strokeWidth: 1, radius: 16 },
    };

    const instanceNode: ComponentInstanceNode = {
      id: 'inst-1',
      name: 'Primary Button',
      type: 'component-instance',
      x: 20,
      y: 20,
      width: 160,
      height: 44,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      componentId: 'comp-btn',
      overrides: {},
      variantSelection: { tone: 'primary' },
      slotAssignments: { label: { text: 'Get Started', visible: true } },
    };

    for (const node of [imageNode, textNode, pathNode, frameNode, instanceNode]) {
      expect(validateDesignNodePayload(node)).toBeNull();
    }

    const doc = {
      id: 'doc-types',
      name: 'Types',
      width: 1200,
      height: 800,
      background: '#0F172A',
      nodes: [imageNode],
    };
    const evalImg = evaluateToolOperation(
      createToolOperation('select', 'main', {
        kind: 'transform-nodes',
        nodes: [{ ...imageNode, width: 480, height: 300 }],
      }),
      { document: doc, selectedNodeIds: [imageNode.id] },
    );
    expect(evalImg.status).toBe('ready');
  });

  it('computes proportional W/H dimensions with anchorRatio zero-drift and independent unlocked edits', () => {
    // Locked 2:1 box — editing W scales H proportionally
    expect(
      computeProportionalDimensions({
        currentWidth: 200,
        currentHeight: 100,
        axis: 'width',
        nextValue: 300,
        lockAspectRatio: true,
      }),
    ).toEqual({ width: 300, height: 150 });

    // Locked 2:1 box — editing H scales W proportionally
    expect(
      computeProportionalDimensions({
        currentWidth: 200,
        currentHeight: 100,
        axis: 'height',
        nextValue: 250,
        lockAspectRatio: true,
      }),
    ).toEqual({ width: 500, height: 250 });

    // Anchor ratio prevents cumulative drift across intermediate keystrokes (e.g. typing 3 -> 320 on 16:9)
    const ratio16x9 = 320 / 180;
    const step1 = computeProportionalDimensions({
      currentWidth: 320,
      currentHeight: 180,
      axis: 'width',
      nextValue: 3,
      lockAspectRatio: true,
      anchorRatio: ratio16x9,
    });
    const step2 = computeProportionalDimensions({
      currentWidth: step1.width,
      currentHeight: step1.height,
      axis: 'width',
      nextValue: 320,
      lockAspectRatio: true,
      anchorRatio: ratio16x9,
    });
    expect(step2).toEqual({ width: 320, height: 180 });

    // Unlocked keeps opposite axis independent
    expect(
      computeProportionalDimensions({
        currentWidth: 200,
        currentHeight: 100,
        axis: 'width',
        nextValue: 360,
        lockAspectRatio: false,
      }),
    ).toEqual({ width: 360, height: 100 });
  });

  it('scales both W and H proportionally when dragging a side handle on canvas with aspectRatioLocked=true', () => {
    const lockedRect: RectNode = makeRect({
      id: 'rect-locked',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      aspectRatioLocked: true,
    });
    const unlockedRect: RectNode = makeRect({
      id: 'rect-free',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      aspectRatioLocked: false,
    });

    // Locked: dragging right edge ('e') by +100px should grow width 200 -> 300 AND height 100 -> 150
    const downLocked = selectTool.onPointerDown(
      makePointerInput({ point: { x: 300, y: 150 }, resizeHandle: 'e' }),
      makeToolContext([lockedRect], [lockedRect.id]),
    );
    const moveLocked = selectTool.onPointerMove(
      makePointerInput({ point: { x: 400, y: 150 }, ctrlKey: true }),
      makeToolContext([lockedRect], [lockedRect.id], downLocked.session ?? null),
    );
    expect(moveLocked.previewNodes?.[0].width).toBe(300);
    expect(moveLocked.previewNodes?.[0].height).toBe(150);

    // Unlocked: dragging right edge ('e') by +100px should grow width 200 -> 300 while height stays 100
    const downFree = selectTool.onPointerDown(
      makePointerInput({ point: { x: 300, y: 150 }, resizeHandle: 'e' }),
      makeToolContext([unlockedRect], [unlockedRect.id]),
    );
    const moveFree = selectTool.onPointerMove(
      makePointerInput({ point: { x: 400, y: 150 }, ctrlKey: true }),
      makeToolContext([unlockedRect], [unlockedRect.id], downFree.session ?? null),
    );
    expect(moveFree.previewNodes?.[0].width).toBe(300);
    expect(moveFree.previewNodes?.[0].height).toBe(100);
  });

  it('classifies aspectRatioLocked toggles as real persisted project changes', () => {
    const base = makeRect({ id: 'rect-toggle', x: 50, y: 50, width: 120, height: 80 });
    const locked: RectNode = { ...base, aspectRatioLocked: true };
    expect(classifyNodeChange(base, locked).hasExtendedChange).toBe(true);

    const project = createInitialProject('Aspect Lock Persistence');
    project.pages[0].document.nodes = [locked];
    expect(validateProject(project).ok).toBe(true);
  });
});
