import { describe, expect, it } from 'vitest';
import {
  createComponentInstance,
  detachComponentInstance,
} from '../src/core/document/components';
import {
  createEllipseNode,
  createEmptyDocument,
  createInitialProject,
  createRectNode,
  createTriangleNode,
} from '../src/core/document/factory';
import { getEffectiveLayerStates } from '../src/core/document/layers';
import {
  applyPathMorphSnapshotToNode,
  interpolatePathMorph,
  parsePathMorphSnapshot,
  serializePathMorphSnapshot,
} from '../src/core/document/pathMorph';
import { getActiveDocument, getActivePage } from '../src/core/document/project';
import { isTransparentColor } from '../src/core/document/styling';
import type { ComponentDefinition } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createToolOperation, validateToolOperationEnvelope } from '../src/core/tools/operationContract';
import {
  applyCornerRoundingToAnchors,
  buildRoundedRectSvgPath,
  serializePathPointsToSvgD,
  setAllPathCornerRadii,
  setAnchorCornerRadius,
} from '../src/core/document/vector';
import { createComponentCanvasBufferProject } from '../src/app/componentCanvasSync';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import {
  applyAnimatedPosesToDocument,
  createAnimationClip,
  evaluateClipAtTime,
  evaluateComponentDocumentAtTime,
} from '../src/engines/animation';
import { hitTestNodesAtPoint } from '../src/engines/canvas/hitTest';

describe('Studio Creation, Hit-Testing, Background, Rounding & Animated Component Features', () => {
  it('1. creates Triangle shape and supports per-corner point rounding for paths and boxes', () => {
    const tri = createTriangleNode(40, 50, 120, 100);
    expect(tri.type).toBe('path');
    expect(tri.pathKind).toBe('triangle');
    expect(tri.shapeMeta?.kind).toBe('triangle');
    expect(tri.closed).toBe(true);
    expect(tri.points).toHaveLength(3);

    // Round a single corner point (P1 = top vertex)
    const roundedOne = setAnchorCornerRadius(tri, 0, 18);
    expect(roundedOne.points[0].cornerRadius).toBe(18);
    expect(roundedOne.points[1].cornerRadius ?? 0).toBe(0);
    expect(roundedOne.points[2].cornerRadius ?? 0).toBe(0);

    const roundedAnchors = applyCornerRoundingToAnchors(roundedOne.points, true);
    expect(roundedAnchors.length).toBeGreaterThan(3);
    const svgPath = serializePathPointsToSvgD(roundedOne.points, roundedOne.closed);
    expect(svgPath).toContain('C ');

    // Round all corner points at once
    const roundedAll = setAllPathCornerRadii(tri, 12);
    expect(roundedAll.points.every((pt) => pt.cornerRadius === 12)).toBe(true);

    // Per-corner rounded rect SVG path
    const rectPath = buildRoundedRectSvgPath(0, 0, 200, 100, {
      topLeft: 24,
      topRight: 0,
      bottomRight: 16,
      bottomLeft: 4,
    });
    expect(rectPath).toContain('A 24 24');
    expect(rectPath).toContain('A 16 16');
    expect(rectPath).toContain('A 4 4');
  });

  it('2. defaults Main & Component canvases to transparent checkerboard and supports background changes with Undo/Redo', () => {
    const emptyDoc = createEmptyDocument('Component Canvas', 480, 320);
    expect(isTransparentColor(emptyDoc.background)).toBe(true);

    const project = createInitialProject('Canvas BG Test');
    const mainDoc = getActiveDocument(project);
    expect(isTransparentColor(mainDoc.background)).toBe(true);

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const setSolid = client.setDocumentBackground('#1E293B');
    expect(setSolid.status).toBe('applied');
    expect(getActiveDocument(store.getSnapshot().editorState.project).background).toBe('#1E293B');

    const setTransparent = client.setDocumentBackground('#00000000');
    expect(setTransparent.status).toBe('applied');
    expect(isTransparentColor(getActiveDocument(store.getSnapshot().editorState.project).background)).toBe(true);

    // Undo restores solid color
    client.undo();
    expect(getActiveDocument(store.getSnapshot().editorState.project).background).toBe('#1E293B');

    // Redo restores transparent background
    client.redo();
    expect(isTransparentColor(getActiveDocument(store.getSnapshot().editorState.project).background)).toBe(true);
  });

  it('3. picks canvas shapes by visual stroke and visible contour area ignoring z-index (Ibis Paint style)', () => {
    // Small colored circle BEHIND a large colored rectangle and a hollow-stroked top frame (higher z-index)
    const smallCircle = {
      ...createEllipseNode(0),
      id: 'circle-small',
      x: 100,
      y: 100,
      width: 60,
      height: 60,
      style: { fill: '#EF4444', stroke: '#991B1B', strokeWidth: 2 },
    };
    const largeOverlay = {
      ...createRectNode(0),
      id: 'rect-large-overlay',
      x: 20,
      y: 20,
      width: 300,
      height: 300,
      style: { fill: '#3B82F6', stroke: '#1D4ED8', strokeWidth: 3, radius: 0 },
    };
    const transparentFrame = {
      ...createRectNode(1),
      id: 'rect-hollow',
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      style: { fill: '#00000000', stroke: '#111827', strokeWidth: 4, radius: 0 },
    };

    // Order in array = z-index: smallCircle (bottom), largeOverlay (middle), transparentFrame (top)
    const nodes = [smallCircle, largeOverlay, transparentFrame];
    const layerStates = getEffectiveLayerStates(nodes);

    // Clicking inside the small circle picks smallCircle (smaller visible contour area), ignoring z-index!
    const hitCenter = hitTestNodesAtPoint(nodes, { x: 130, y: 130 }, layerStates);
    expect(hitCenter).toBe('circle-small');

    // Clicking on the stroke line of the hollow top frame picks the stroke directly!
    const hitStroke = hitTestNodesAtPoint(nodes, { x: 2, y: 150 }, layerStates);
    expect(hitStroke).toBe('rect-hollow');

    // Clicking inside the hollow interior where only largeOverlay is visible passes through transparentFrame and picks largeOverlay
    const hitLarge = hitTestNodesAtPoint(nodes, { x: 250, y: 250 }, layerStates);
    expect(hitLarge).toBe('rect-large-overlay');
  });

  it('4. animates vector vertices, Bezier curve handles, and corner radii via pathMorph keyframes', () => {
    const startTri = {
      ...createTriangleNode(50, 50, 100, 100),
      id: 'morph-tri',
    };
    const curvedTri = {
      ...startTri,
      points: startTri.points.map((pt, idx) =>
        idx === 0
          ? {
              ...pt,
              y: pt.y - 30,
              handleOut: { x: pt.x + 28, y: pt.y - 30 },
              handleIn: { x: pt.x - 28, y: pt.y - 30 },
              cornerRadius: 16,
            }
          : pt,
      ),
    };

    const snap0 = serializePathMorphSnapshot(startTri);
    const snap1 = serializePathMorphSnapshot(curvedTri);
    expect(parsePathMorphSnapshot(snap0)?.points).toHaveLength(3);

    const midSnap = interpolatePathMorph(snap0, snap1, 0.5);
    const midParsed = parsePathMorphSnapshot(midSnap);
    expect(midParsed).not.toBeNull();
    expect(midParsed!.points[0].y).toBeCloseTo(startTri.points[0].y - 15, 2);
    expect(midParsed!.points[0].cr).toBeCloseTo(8, 2);
    expect(midParsed!.points[0].ho).toBeDefined();

    const morphedNode = applyPathMorphSnapshotToNode(startTri, midSnap);
    expect(morphedNode.points[0].y).toBeCloseTo(startTri.points[0].y - 15, 2);

    // Full clip evaluation & project schema validation
    const project = createInitialProject('PathMorph Test');
    const page = getActivePage(project);
    page.document.nodes = [startTri];

    const baseClip = createAnimationClip({
      pageId: page.id,
      name: 'Morph Clip',
      durationMs: 1000,
      tracks: [
        {
          id: 'track-morph',
          targetNodeId: startTri.id,
          property: 'pathMorph',
          keyframes: [
            { id: 'kf-0', timeMs: 0, value: snap0, easing: 'linear' },
            { id: 'kf-1', timeMs: 1000, value: snap1, easing: 'linear' },
          ],
        },
      ],
    });
    const clip = baseClip;
    project.animations = [clip];

    const validation = validateProject(project);
    expect(validation.ok).toBe(true);

    const poses = evaluateClipAtTime(clip, 500);
    const animatedDoc = applyAnimatedPosesToDocument(page.document, poses);
    const animatedTri = animatedDoc.nodes[0];
    expect(animatedTri.type).toBe('path');
    if (animatedTri.type === 'path') {
      expect(animatedTri.points[0].y).toBeCloseTo(startTri.points[0].y - 15, 1);
    }
  });

  it('5. saves Component Canvas animations inside ComponentDefinition, evaluates live instance frames, and unpacks back to layers', () => {
    const tri = { ...createTriangleNode(10, 10, 80, 80), id: 'comp-tri' };
    const badge = { ...createRectNode(0), id: 'comp-bg', x: 0, y: 0, width: 100, height: 100 };
    const doc = createEmptyDocument('Animated Badge', 100, 100);
    doc.nodes = [badge, tri];

    const compClip = createAnimationClip({
      pageId: 'comp-page',
      name: 'Spin & Morph',
      durationMs: 1000,
      loop: true,
      tracks: [
        {
          id: 'track-rot',
          targetNodeId: tri.id,
          property: 'rotation',
          keyframes: [
            { id: 'kf-rot-0', timeMs: 0, value: 0, easing: 'linear' },
            { id: 'kf-rot-1', timeMs: 1000, value: 180, easing: 'linear' },
          ],
        },
      ],
    });

    const now = new Date().toISOString();
    const master: ComponentDefinition = {
      id: 'comp-animated-1',
      name: 'Animated Badge',
      document: doc,
      animations: [compClip],
      createdAt: now,
      updatedAt: now,
    };

    // Verify component buffer round-trip restores animations
    const bufferProject = createComponentCanvasBufferProject(master);
    expect(bufferProject.animations).toHaveLength(1);
    expect(bufferProject.animations?.[0].tracks).toHaveLength(1);
    expect(bufferProject.animations?.[0].pageId).toBe(bufferProject.activePageId);

    // Evaluate component at t = 500ms -> triangle rotation should be 90 deg
    const evalDoc = evaluateComponentDocumentAtTime(master.document, master.animations, 500);
    const evalTri = evalDoc.nodes.find((n) => n.id === tri.id);
    expect(evalTri?.rotation).toBeCloseTo(90, 1);

    // Validate project containing animated component + instance
    const project = createInitialProject('Animated Component Host');
    project.components = [master];
    const instance = createComponentInstance(master, 120, 140);
    project.pages[0].document.nodes = [instance];

    const validation = validateProject(project);
    expect(validation.ok).toBe(true);

    // Unpack/detach component instance back into editable layers
    const unpacked = detachComponentInstance(instance, master, project.designTokens);
    expect(unpacked).toHaveLength(2);
    expect(unpacked.some((n) => n.type === 'rect')).toBe(true);
    expect(unpacked.some((n) => n.type === 'path' && n.pathKind === 'triangle')).toBe(true);
  });

  it('6. validates tool operations for creating Triangle shapes and updating per-corner radii', () => {
    const tri = createTriangleNode(40, 40, 120, 110);
    const createOp = createToolOperation(
      'draw-triangle',
      'main',
      {
        kind: 'create-nodes',
        nodes: [tri],
      },
      { description: 'Draw triangle' },
    );
    expect(validateToolOperationEnvelope(createOp)).toEqual({ ok: true });

    const roundedTri = setAnchorCornerRadius(tri, 0, 22);
    const roundPathOp = createToolOperation(
      'select',
      'main',
      {
        kind: 'transform-nodes',
        nodes: [roundedTri],
      },
      { description: 'Round triangle corner' },
    );
    expect(validateToolOperationEnvelope(roundPathOp)).toEqual({ ok: true });

    const rect = createRectNode(0);
    const roundedRect = {
      ...rect,
      style: {
        ...rect.style,
        cornerRadii: { topLeft: 20, topRight: 0, bottomRight: 16, bottomLeft: 4 },
      },
    };
    const roundRectOp = createToolOperation(
      'select',
      'main',
      {
        kind: 'transform-nodes',
        nodes: [roundedRect],
      },
      { description: 'Round rectangle corners' },
    );
    expect(validateToolOperationEnvelope(roundRectOp)).toEqual({ ok: true });
  });
});
