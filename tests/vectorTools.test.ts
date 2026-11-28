import { describe, expect, it } from 'vitest';
import {
  createFrameNode,
  createInitialProject,
  createLineNode,
  createPolygonNode,
  createStarNode,
  createVectorPathNode,
} from '../src/core/document/factory';
import {
  applyPathfinderOperation,
  convertShapeToPathNode,
  createPolygonPathPoints,
  createStarPathPoints,
  flipPathNode,
  insertAnchorOnPathSegment,
  normalizePathNode,
  scalePathNodeGeometry,
  serializePathPointsToSvgD,
  simplifyFreehandToPathPoints,
  simplifyPathNode,
  smoothPathAnchors,
  splitPathAtLocalPoint,
  toggleAnchorPointType,
} from '../src/core/document/vector';
import { validateProject } from '../src/core/document/validation';
import type { DesignNode, FolioDocument, PathNode } from '../src/core/document/types';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { canvasToolRegistry } from '../src/engines/canvas/tools/registry';
import {
  COMPONENT_CANVAS_TOOL_GROUPS,
  MAIN_CANVAS_TOOL_GROUPS,
  findStudioToolByShortcut,
  getStudioTool,
  isToolAvailableInWorkspace,
  studioToolRegistry,
} from '../src/engines/canvas/tools/studioRegistry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolPointerInput,
} from '../src/engines/canvas/tools/types';
import { getBounds } from '../src/engines/canvas/geometry';

function makeDoc(nodes: DesignNode[]): FolioDocument {
  return {
    id: 'doc-vector-test',
    name: 'Vector Test Artboard',
    width: 800,
    height: 600,
    background: '#ffffff',
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
  selectedIds: string[] = [],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  const doc = makeDoc(nodes);
  const selectedNodes = nodes.filter((node) => selectedIds.includes(node.id));
  return {
    document: doc,
    canvasNodes: nodes,
    selectableNodes: nodes,
    otherNodes: nodes,
    selectedNodeIds: selectedIds,
    selectedNodes,
    selectionBounds: getBounds(selectedNodes),
    zoom: 1,
    pan: { x: 0, y: 0 },
    viewportWidth: 800,
    session: null,
    toolOptions: DEFAULT_CANVAS_TOOL_OPTIONS,
    workspace: 'component',
    ...overrides,
  };
}

describe('Core Vector Math & Illustrator Pathfinder Engine', () => {
  it('serializes straight, cubic Bezier, and compound subpaths into valid SVG d strings', () => {
    const d = serializePathPointsToSvgD(
      [
        { id: 'a', x: 0, y: 0, pointType: 'corner', handleOut: { x: 30, y: 0 } },
        { id: 'b', x: 100, y: 50, pointType: 'smooth', handleIn: { x: 70, y: 50 } },
      ],
      false,
    );
    expect(d).toBe('M 0 0 C 30 0 70 50 100 50');

    const closedD = serializePathPointsToSvgD(createPolygonPathPoints(100, 100, 4), true);
    expect(closedD.startsWith('M ')).toBe(true);
    expect(closedD.endsWith(' Z')).toBe(true);
  });

  it('generates polygon and star path nodes with normalized bounding geometry', () => {
    const poly = createPolygonNode(20, 30, 120, 120, 6);
    expect(poly.type).toBe('path');
    expect(poly.closed).toBe(true);
    expect(poly.points).toHaveLength(6);
    expect(poly.width).toBeGreaterThan(0);

    const star = createStarNode(40, 50, 140, 140, 5, 0.45);
    expect(star.type).toBe('path');
    expect(star.points).toHaveLength(10);
    expect(star.closed).toBe(true);

    const pts = createStarPathPoints(100, 100, 7, 0.4);
    expect(pts).toHaveLength(14);
  });

  it('scales PathNode anchors and handles cleanly without drift', () => {
    const original = createPolygonNode(10, 20, 100, 100, 5);
    const scaled = scalePathNodeGeometry(original, 50, 60, 200, 150);
    expect(scaled.x).toBe(50);
    expect(scaled.y).toBe(60);
    expect(scaled.width).toBe(200);
    expect(scaled.height).toBe(150);
    expect(Math.max(...scaled.points.map((p) => p.x))).toBeCloseTo(200, 1);
  });

  it('converts rectangles, rounded rectangles, and ellipses into cubic Bezier paths', () => {
    const rectNode: DesignNode = {
      id: 'r1',
      type: 'rect',
      name: 'Card',
      x: 50,
      y: 60,
      width: 160,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#8B7CF6', stroke: '#20212A', strokeWidth: 2, radius: 16 },
    };
    const fromRect = convertShapeToPathNode(rectNode);
    expect(fromRect).not.toBeNull();
    expect(fromRect!.type).toBe('path');
    expect(fromRect!.closed).toBe(true);
    expect(fromRect!.points.length).toBeGreaterThanOrEqual(8);
    expect(fromRect!.points.some((p) => p.handleIn || p.handleOut)).toBe(true);

    const ellipseNode: DesignNode = {
      id: 'e1',
      type: 'ellipse',
      name: 'Badge',
      x: 10,
      y: 10,
      width: 80,
      height: 80,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#4E9AF1', stroke: '#00000000', strokeWidth: 0 },
    };
    const fromEllipse = convertShapeToPathNode(ellipseNode);
    expect(fromEllipse).not.toBeNull();
    expect(fromEllipse!.points).toHaveLength(4);
    expect(fromEllipse!.points.every((p) => p.pointType === 'symmetric')).toBe(true);
  });

  it('supports anchor insertion, corner/smooth toggling, smoothing, simplifying, flipping, and scissors splitting', () => {
    const line = createLineNode(0, 0, 200, 0);
    const inserted = insertAnchorOnPathSegment(line, 0, 0.5);
    expect(inserted.node.points).toHaveLength(3);

    const smoothedCorner = toggleAnchorPointType(inserted.node, 1);
    expect(smoothedCorner.points[1].pointType).toBe('symmetric');
    expect(smoothedCorner.points[1].handleIn).toBeDefined();
    expect(smoothedCorner.points[1].handleOut).toBeDefined();

    let splitSeq = 0;
    const nextSplitId = () => `split-${++splitSeq}`;
    const splitOpen = splitPathAtLocalPoint(inserted.node, { x: 100, y: 0 }, nextSplitId);
    expect(splitOpen).not.toBeNull();
    expect(splitOpen!.length).toBe(2);

    const poly = createPolygonNode(0, 0, 100, 100, 4);
    const splitClosed = splitPathAtLocalPoint(poly, { x: 50, y: 0 }, nextSplitId);
    expect(splitClosed).not.toBeNull();
    expect(splitClosed!.length).toBe(1);
    expect(splitClosed![0].closed).toBe(false);

    const densePoints = Array.from({ length: 24 }, (_, idx) => ({
      x: idx * 8,
      y: Math.sin(idx * 0.25) * 28 + (idx % 2 === 0 ? 1 : -1),
    }));
    const freehand = simplifyFreehandToPathPoints(densePoints, 3.5);
    expect(freehand.points.length).toBeLessThan(densePoints.length);
    const freehandNode = createVectorPathNode(freehand.points, { closed: false });
    const brushed = smoothPathAnchors(freehandNode, [{ x: 60, y: 0 }, { x: 120, y: 0 }], 60);
    expect(brushed.points.length).toBe(freehandNode.points.length);
    const simplified = simplifyPathNode(freehandNode, 4);
    expect(simplified.points.length).toBeLessThanOrEqual(freehandNode.points.length);

    const flipped = flipPathNode(poly, 'horizontal');
    expect(flipped.width).toBeCloseTo(poly.width, 1);
  });

  it('executes Adobe Illustrator Pathfinder boolean operations (Unite, Subtract, Intersect, Exclude)', () => {
    const rectA: DesignNode = {
      id: 'a',
      type: 'rect',
      name: 'Base',
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#8B7CF6', stroke: '#00000000', strokeWidth: 0, radius: 0 },
    };
    const rectB: DesignNode = {
      id: 'b',
      type: 'rect',
      name: 'Cut',
      x: 160,
      y: 140,
      width: 120,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#E59A4C', stroke: '#00000000', strokeWidth: 0, radius: 0 },
    };

    const united = applyPathfinderOperation([rectA, rectB], 'unite', 'pf-unite');
    expect(united).not.toBeNull();
    expect(united!.type).toBe('path');
    expect(united!.width).toBeCloseTo(180, 0);
    expect(united!.height).toBeCloseTo(160, 0);

    const subtracted = applyPathfinderOperation([rectA, rectB], 'subtract', 'pf-subtract');
    expect(subtracted).not.toBeNull();
    expect(subtracted!.points.length).toBeGreaterThanOrEqual(4);

    const intersected = applyPathfinderOperation([rectA, rectB], 'intersect', 'pf-intersect');
    expect(intersected).not.toBeNull();
    expect(intersected!.x).toBeCloseTo(160, 0);
    expect(intersected!.y).toBeCloseTo(140, 0);
    expect(intersected!.width).toBeCloseTo(60, 0);
    expect(intersected!.height).toBeCloseTo(80, 0);

    const excluded = applyPathfinderOperation([rectA, rectB], 'exclude', 'pf-exclude');
    expect(excluded).not.toBeNull();
    expect(excluded!.style.fillRule).toBe('evenodd');
  });
});

describe('Studio Tool Registry & Workspace Scoping', () => {
  it('preserves Wave 1 canvasToolRegistry intact while exposing full 30-tool studioToolRegistry', () => {
    expect(canvasToolRegistry.list().map((t) => t.id)).toEqual([
      'select',
      'direct-selection',
      'lasso-selection',
      'magic-wand',
      'hand',
      'scrubby-zoom',
    ]);
    const studioTools = studioToolRegistry.list();
    expect(studioTools.length).toBe(30);
    expect(new Set(studioTools.map((t) => t.id)).size).toBe(30);
  });

  it('scopes Figma layout tools to Main Canvas and Adobe Illustrator vector craft tools to Component Canvas', () => {
    expect(MAIN_CANVAS_TOOL_GROUPS.map((g) => g.id)).toEqual([
      'selection',
      'layout',
      'shapes',
      'vector',
      'type',
      'inspect',
      'navigation',
    ]);
    expect(COMPONENT_CANVAS_TOOL_GROUPS.map((g) => g.id)).toEqual([
      'selection',
      'vector',
      'shapes',
      'transform',
      'type',
      'inspect',
      'navigation',
    ]);

    expect(isToolAvailableInWorkspace('section', 'main')).toBe(true);
    expect(isToolAvailableInWorkspace('section', 'component')).toBe(false);
    expect(isToolAvailableInWorkspace('curvature', 'component')).toBe(true);
    expect(isToolAvailableInWorkspace('curvature', 'main')).toBe(false);
    expect(isToolAvailableInWorkspace('scissors', 'component')).toBe(true);
    expect(isToolAvailableInWorkspace('smooth', 'component')).toBe(true);
    expect(isToolAvailableInWorkspace('anchor-point', 'component')).toBe(true);
    expect(isToolAvailableInWorkspace('rotate', 'component')).toBe(true);
    expect(isToolAvailableInWorkspace('shape-builder', 'main')).toBe(true);
    expect(isToolAvailableInWorkspace('shape-builder', 'component')).toBe(true);

    expect(findStudioToolByShortcut('f', false, 'main')).toBe('frame');
    expect(findStudioToolByShortcut('s', true, 'main')).toBe('section');
    expect(findStudioToolByShortcut('m', true, 'main')).toBe('shape-builder');
    expect(findStudioToolByShortcut('m', true, 'component')).toBe('shape-builder');
    expect(findStudioToolByShortcut('u', false, 'component')).toBe('curvature');
    expect(findStudioToolByShortcut('c', false, 'component')).toBe('scissors');
    expect(findStudioToolByShortcut('c', true, 'component')).toBe('anchor-point');
    expect(findStudioToolByShortcut('r', true, 'component')).toBe('rotate');
  });
});

describe('Interactive Figma & Illustrator Tool Handlers', () => {
  it('draws Frame, Star, and Arrow nodes with live previews', () => {
    const frameTool = getStudioTool('frame');
    const down = frameTool.onPointerDown(makePointer({ point: { x: 40, y: 50 } }), makeContext([]));
    const move = frameTool.onPointerMove(
      makePointer({ point: { x: 340, y: 250 } }),
      makeContext([], [], { session: down.session ?? null }),
    );
    const preview = frameTool.renderOverlay(makeContext([], [], { session: move.session ?? null }));
    expect(preview?.kind).toBe('draw-preview');
    const up = frameTool.onPointerUp(
      makePointer({ point: { x: 340, y: 250 } }),
      makeContext([], [], { session: move.session ?? null }),
    );
    expect(up.createNodes).toHaveLength(1);
    expect(up.createNodes![0].type).toBe('frame');
    expect(up.createNodes![0].width).toBe(300);
    expect(up.createNodes![0].height).toBe(200);

    const arrowTool = getStudioTool('draw-arrow');
    const aDown = arrowTool.onPointerDown(makePointer({ point: { x: 10, y: 20 } }), makeContext([]));
    const aUp = arrowTool.onPointerUp(
      makePointer({ point: { x: 150, y: 20 } }),
      makeContext([], [], { session: aDown.session ?? null }),
    );
    expect(aUp.createNodes![0].type).toBe('path');
    expect((aUp.createNodes![0] as PathNode).style.arrowEnd).toBe(true);
  });

  it('draws closed and open cubic Bezier vector paths with Pen (P) and Curvature (U)', () => {
    const pen = getStudioTool('pen');
    let session = pen.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([])).session ?? null;
    session = pen.onPointerUp(makePointer({ point: { x: 100, y: 100 } }), makeContext([], [], { session })).session ?? null;
    session = pen.onPointerDown(makePointer({ point: { x: 220, y: 100 } }), makeContext([], [], { session })).session ?? null;
    session = pen.onPointerMove(makePointer({ point: { x: 250, y: 120 } }), makeContext([], [], { session })).session ?? null;
    session = pen.onPointerUp(makePointer({ point: { x: 250, y: 120 } }), makeContext([], [], { session })).session ?? null;
    session = pen.onPointerDown(makePointer({ point: { x: 160, y: 220 } }), makeContext([], [], { session })).session ?? null;
    session = pen.onPointerUp(makePointer({ point: { x: 160, y: 220 } }), makeContext([], [], { session })).session ?? null;

    // Click origin anchor to close
    const closedResult = pen.onPointerDown(makePointer({ point: { x: 102, y: 102 } }), makeContext([], [], { session }));
    expect(closedResult.createNodes).toHaveLength(1);
    const path = closedResult.createNodes![0] as PathNode;
    expect(path.type).toBe('path');
    expect(path.closed).toBe(true);
    expect(path.points).toHaveLength(3);

    // Curvature tool creates smooth auto-curved path on Enter
    const curvature = getStudioTool('curvature');
    let cSess = curvature.onPointerDown(makePointer({ point: { x: 40, y: 40 } }), makeContext([])).session ?? null;
    cSess = curvature.onPointerDown(makePointer({ point: { x: 120, y: 20 } }), makeContext([], [], { session: cSess })).session ?? null;
    cSess = curvature.onPointerDown(makePointer({ point: { x: 200, y: 80 } }), makeContext([], [], { session: cSess })).session ?? null;
    const finished = curvature.onKeyDown(
      { key: 'Enter', code: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
      makeContext([], [], { session: cSess }),
    );
    expect(finished.createNodes).toHaveLength(1);
    expect((finished.createNodes![0] as PathNode).points.some((p) => p.handleIn || p.handleOut)).toBe(true);
  });

  it('edits vector anchor points directly with Direct Selection (A) and scales proportionally with Scale (K)', () => {
    const poly = createPolygonNode(50, 50, 100, 100, 4);
    const direct = getStudioTool('direct-selection');
    const down = direct.onPointerDown(
      makePointer({
        point: { x: poly.x + poly.points[0].x, y: poly.y + poly.points[0].y },
        anchorHit: { nodeId: poly.id, pointIndex: 0, part: 'anchor' },
      }),
      makeContext([poly], [poly.id]),
    );
    const move = direct.onPointerMove(
      makePointer({ point: { x: poly.x + poly.points[0].x + 25, y: poly.y + poly.points[0].y - 10 } }),
      makeContext([poly], [poly.id], { session: down.session ?? null }),
    );
    const up = direct.onPointerUp(
      makePointer({ point: { x: poly.x + poly.points[0].x + 25, y: poly.y + poly.points[0].y - 10 } }),
      makeContext([poly], [poly.id], { session: move.session ?? null }),
    );
    expect(up.commitNodes).toHaveLength(1);
    expect(up.commitNodes![0].type).toBe('path');

    const scale = getStudioTool('scale');
    const sDown = scale.onPointerDown(
      makePointer({ point: { x: 150, y: 150 }, resizeHandle: 'se' }),
      makeContext([poly], [poly.id]),
    );
    const sMove = scale.onPointerMove(
      makePointer({ point: { x: 250, y: 250 } }),
      makeContext([poly], [poly.id], { session: sDown.session ?? null }),
    );
    const sUp = scale.onPointerUp(
      makePointer({ point: { x: 250, y: 250 } }),
      makeContext([poly], [poly.id], { session: sMove.session ?? null }),
    );
    expect(sUp.commitNodes).toHaveLength(1);
    expect(sUp.commitNodes![0].width).toBeGreaterThan(poly.width);
  });

  it('samples colors with Eyedropper (I), measures with Measure (M), and rotates with Rotate (Shift+R)', () => {
    const frame = createFrameNode(100, 100, 200, 150);
    const eyedropper = getStudioTool('eyedropper');
    const sampled = eyedropper.onPointerDown(
      makePointer({ targetNodeId: frame.id, point: { x: 120, y: 120 } }),
      makeContext([frame]),
    );
    expect(sampled.sampledColor?.color).toBe(frame.style.fill);

    const measure = getStudioTool('measure');
    const mDown = measure.onPointerDown(makePointer({ point: { x: 100, y: 100 } }), makeContext([frame]));
    const mMove = measure.onPointerMove(
      makePointer({ point: { x: 200, y: 100 } }),
      makeContext([frame], [], { session: mDown.session ?? null }),
    );
    const mOverlay = measure.renderOverlay(makeContext([frame], [], { session: mMove.session ?? null }));
    expect(mOverlay?.kind).toBe('measure');
    if (mOverlay?.kind === 'measure') {
      expect(mOverlay.distance).toBe(100);
      expect(mOverlay.dx).toBe(100);
    }

    const rotate = getStudioTool('rotate');
    const rDown = rotate.onPointerDown(makePointer({ point: { x: 300, y: 175 } }), makeContext([frame], [frame.id]));
    const rMove = rotate.onPointerMove(
      makePointer({ point: { x: 200, y: 275 }, shiftKey: true }),
      makeContext([frame], [frame.id], { session: rDown.session ?? null }),
    );
    const rUp = rotate.onPointerUp(
      makePointer({ point: { x: 200, y: 275 }, shiftKey: true }),
      makeContext([frame], [frame.id], { session: rMove.session ?? null }),
    );
    expect(rUp.commitNodes).toHaveLength(1);
    expect(rUp.commitNodes![0].rotation % 15).toBe(0);
  });
});

describe('Document Validation & Native Command v1 Compatibility for Frame & Path Nodes', () => {
  it('validates FrameNode and PathNode in .flop v2 project schemas and executes cleanly through MainCanvasCommandClient', () => {
    const project = createInitialProject();
    const frame = createFrameNode(40, 40, 320, 220);
    const star = normalizePathNode(createStarNode(80, 80, 120, 120, 5, 0.44));

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const createResult = client.createNodes([frame, star], 'Create Frame and Star');
    expect(createResult.status).toBe('applied');

    const snapshotProject = store.getSnapshot().editorState.project;
    expect(validateProject(snapshotProject).ok).toBe(true);

    const scaledStar = scalePathNodeGeometry(star, 90, 90, 180, 180);
    const transformResult = client.transformNodes([scaledStar], 'Scale star path');
    expect(transformResult.status).toBe('applied');

    const activeNodes = store.getSnapshot().editorState.project.pages[0].document.nodes;
    const savedStar = activeNodes.find((n) => n.id === star.id) as PathNode | undefined;
    expect(savedStar?.width).toBe(180);
  });
});
