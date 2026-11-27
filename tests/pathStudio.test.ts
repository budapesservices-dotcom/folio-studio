import { describe, expect, it } from 'vitest';
import { createEllipseNode, createInitialProject, createRectNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { MotionPathBinding, PathNode, VectorAnchorPoint } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { cleanupDeletedNodeReferences } from '../src/core/document/nodeReferenceCleanup';
import {
  applyMotionPathEditAtTime,
  buildPathArcLengthTable,
  computeContourTrimIntervals,
  createDefaultMotionPathForNode,
  createMotionPathFromPathNode,
  evaluateMotionPathAtProgress,
  evaluateMotionPathBindingAtTime,
  getNodeContourLengths,
  hasMotionPathShapeKeyframeAtTime,
  insertMotionPathPointOnSegment,
  intervalsToSvgStrokeDash,
  moveMotionPathAnchor,
  moveMotionPathHandle,
  normalizeTrimIntervals,
  projectPointOntoMotionPath,
  removeMotionPathPoint,
  removeMotionPathShapeKeyframe,
  resolveMotionPathLoopProgress,
  reverseMotionPathPoints,
  serializeMotionPathToSvgD,
  setMotionPathPointType,
  upsertMotionPathShapeKeyframe,
} from '../src/core/document/pathStudio';
import {
  checkNodeMorphSupport,
  createMorphPresetSnapshot,
  extractMorphSnapshotFromNode,
  interpolatePathMorph,
  parsePathMorphSnapshot,
} from '../src/core/document/pathMorph';
import {
  addTrackToClip,
  applyAnimatedPosesToDocument,
  applyAutoKeyFromNodeChange,
  applyStaggeredMotionPathInClip,
  applyStaggeredTrimPathInClip,
  buildNodeSvgSmilAnimations,
  buildPresetClipForPage,
  captureNodeKeyframeSnapshot,
  compilePageAnimationsCss,
  createAnimationClip,
  enableTrimPathInClip,
  evaluateClipAtTime,
  evaluateEasing,
  hasActiveMotionPathForNode,
  isPropertyLockedByMotionPath,
  setNodeTrimModeInClip,
  togglePropertyKeyframeInClip,
  upsertKeyframeInClip,
  upsertMotionPathInClip,
} from '../src/engines/animation';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';

function makePathNode(
  id: string,
  points: VectorAnchorPoint[],
  opts?: { closed?: boolean; subpaths?: PathNode['subpaths']; x?: number; y?: number; width?: number; height?: number },
): PathNode {
  return {
    id,
    name: `Path ${id}`,
    type: 'path',
    x: opts?.x ?? 100,
    y: opts?.y ?? 100,
    width: opts?.width ?? 200,
    height: opts?.height ?? 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    points,
    closed: opts?.closed ?? true,
    subpaths: opts?.subpaths,
    style: {
      fill: 'none',
      stroke: '#2563eb',
      strokeWidth: 4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
  };
}

describe('FOLIO Path Studio — Pillar 1: Motion Path Engine', () => {
  it('evaluates constant-speed arc-length parameterization vs parametric speed accurately', () => {
    const binding: MotionPathBinding = {
      id: 'mp-const',
      targetNodeId: 'n1',
      points: [
        { id: 'p0', x: 0, y: 0, handleOut: { x: 10, y: 0 }, pointType: 'corner' },
        { id: 'p1', x: 400, y: 0, handleIn: { x: 390, y: 0 }, pointType: 'corner' },
        { id: 'p2', x: 500, y: 0, pointType: 'corner' },
      ],
      closed: false,
      autoOrient: true,
      orientOffsetDeg: 0,
      reverse: false,
      startPct: 0,
      endPct: 100,
      offsetPx: 0,
      constantSpeed: true,
      loopMode: 'none',
    };

    const lut = buildPathArcLengthTable(binding.points, false);
    expect(lut.totalLength).toBeCloseTo(500, 1);

    // At progress 50% with Constant Speed, x should be exactly halfway along 500px -> 250px
    const midConst = evaluateMotionPathAtProgress(binding, 50);
    expect(midConst).not.toBeNull();
    expect(midConst!.x).toBeCloseTo(250, 1);
    expect(midConst!.y).toBeCloseTo(0, 1);
    expect(midConst!.tangentAngleDeg).toBeCloseTo(0, 1);

    // With parametric speed (constantSpeed: false), 2 segments => progress 50% lands at anchor p1 (x=400)
    const midParam = evaluateMotionPathAtProgress({ ...binding, constantSpeed: false }, 50);
    expect(midParam).not.toBeNull();
    expect(midParam!.x).toBeCloseTo(400, 1);
  });

  it('supports Auto Orient, orientOffsetDeg, Reverse, Start/End range, perpendicular Offset, and Loop / Ping-Pong', () => {
    const binding: MotionPathBinding = {
      id: 'mp-opts',
      targetNodeId: 'n1',
      points: [
        { id: 'p0', x: 0, y: 0, pointType: 'corner' },
        { id: 'p1', x: 200, y: 0, pointType: 'corner' },
      ],
      closed: false,
      autoOrient: true,
      orientOffsetDeg: 90,
      reverse: false,
      startPct: 25,
      endPct: 75,
      offsetPx: 20,
      constantSpeed: true,
      loopMode: 'ping-pong',
    };

    // Ping-pong mapping: 0 -> 0, 0.5 -> 1, 1.0 -> 0
    expect(resolveMotionPathLoopProgress(0, 'ping-pong').progress01).toBeCloseTo(0, 5);
    expect(resolveMotionPathLoopProgress(0.5, 'ping-pong').progress01).toBeCloseTo(1, 5);
    expect(resolveMotionPathLoopProgress(1, 'ping-pong').progress01).toBeCloseTo(0, 5);
    expect(resolveMotionPathLoopProgress(1.25, 'loop').progress01).toBeCloseTo(0.25, 5);

    // At progress=0% -> Start 25% of 200px = x:50; normal to +X is (0, +1) -> y=+20; tangent 0deg (orientOffsetDeg applied by evaluator)
    const s0 = evaluateMotionPathAtProgress(binding, 0)!;
    expect(s0.x).toBeCloseTo(50, 1);
    expect(s0.y).toBeCloseTo(20, 1);
    expect(s0.tangentAngleDeg).toBeCloseTo(0, 1);

    // At progress=50% (ping-pong peak -> 1.0 of active range -> 75% of 200px = 150px)
    const sPeak = evaluateMotionPathAtProgress(binding, 50)!;
    expect(sPeak.x).toBeCloseTo(150, 1);
    expect(sPeak.y).toBeCloseTo(20, 1);

    // Reverse path flips travel direction
    const revStart = evaluateMotionPathAtProgress({ ...binding, reverse: true, loopMode: 'none' }, 0)!;
    expect(revStart.x).toBeCloseTo(150, 1);
    const revEnd = evaluateMotionPathAtProgress({ ...binding, reverse: true, loopMode: 'none' }, 100)!;
    expect(revEnd.x).toBeCloseTo(50, 1);
  });

  it('performs direct path editing: anchor drag, Corner/Smooth/Symmetric handles, exact de Casteljau insert, remove, and reverse', () => {
    const rect = createRectNode(0);
    const binding = createDefaultMotionPathForNode(rect);
    expect(binding.points.length).toBe(3);

    // Sample curve before inserting point at segment 0, t=0.5 (25% across 2 segments)
    const beforeSample = evaluateMotionPathAtProgress(
      { ...binding, constantSpeed: false, autoOrient: false, offsetPx: 0 },
      25,
    )!;

    // Insert point via exact de Casteljau subdivision
    const insertedRes = insertMotionPathPointOnSegment(binding, 0, 0.5);
    expect(insertedRes.insertedIndex).toBe(1);
    const inserted = insertedRes.binding;
    expect(inserted.points.length).toBe(4);
    expect(inserted.points[1].x).toBeCloseTo(beforeSample.x, 1);
    expect(inserted.points[1].y).toBeCloseTo(beforeSample.y, 1);

    // Move anchor shifts its handles together
    const origAnchor = inserted.points[1];
    const origOutDx = (origAnchor.handleOut?.x ?? origAnchor.x) - origAnchor.x;
    const moved = moveMotionPathAnchor(inserted, 1, origAnchor.x + 30, origAnchor.y - 20);
    expect(moved.points[1].x).toBeCloseTo(origAnchor.x + 30, 1);
    expect((moved.points[1].handleOut?.x ?? 0) - moved.points[1].x).toBeCloseTo(origOutDx, 1);

    // Symmetric handle mirrors opposite handle with equal length
    const sym = setMotionPathPointType(moved, 1, 'symmetric');
    const draggedSym = moveMotionPathHandle(sym, 1, 'out', sym.points[1].x + 40, sym.points[1].y + 30, false);
    expect(draggedSym.points[1].handleIn?.x).toBeCloseTo(sym.points[1].x - 40, 1);
    expect(draggedSym.points[1].handleIn?.y).toBeCloseTo(sym.points[1].y - 30, 1);

    // Corner breaks handle coupling
    const corner = setMotionPathPointType(draggedSym, 1, 'corner');
    expect(corner.points[1].pointType).toBe('corner');

    // Remove point shrinks back to 3 points
    const removed = removeMotionPathPoint(corner, 1);
    expect(removed.points.length).toBe(3);

    // Reverse points swaps endpoints
    const reversed = reverseMotionPathPoints(removed);
    expect(reversed.points[0].x).toBeCloseTo(removed.points[2].x, 1);
    expect(reversed.points[2].x).toBeCloseTo(removed.points[0].x, 1);

    // Project point onto curve & serialize SVG d
    const proj = projectPointOntoMotionPath(removed, { x: removed.points[1].x, y: removed.points[1].y });
    expect(proj).not.toBeNull();
    expect(serializeMotionPathToSvgD(removed.points, false)).toContain('C ');

    // Create Motion Path from an existing PathNode
    const sourcePath = makePathNode(
      'src-path',
      [
        { id: 'a', x: 0, y: 0, pointType: 'corner' },
        { id: 'b', x: 120, y: 60, pointType: 'smooth' },
        { id: 'c', x: 240, y: 0, pointType: 'corner' },
      ],
      { closed: false, x: 50, y: 80, width: 240, height: 60 },
    );
    const fromLayer = createMotionPathFromPathNode(rect.id, sourcePath);
    expect(fromLayer.points.length).toBe(3);
    expect(fromLayer.points[0].x).toBeCloseTo(50, 1);
    expect(fromLayer.points[0].y).toBeCloseTo(80, 1);
  });
});

describe('FOLIO Path Studio — Pillar 2: Open & Open ↔ Closed Shape Morphing', () => {
  it('supports open ↔ open path morphing with differing point counts and preserves open topology', () => {
    const openA = makePathNode(
      'open-a',
      [
        { id: 'a0', x: 0, y: 50, pointType: 'corner' },
        { id: 'a1', x: 200, y: 50, pointType: 'corner' },
      ],
      { closed: false },
    );
    const openB = makePathNode(
      'open-b',
      [
        { id: 'b0', x: 0, y: 80, pointType: 'smooth', handleOut: { x: 40, y: 10 } },
        { id: 'b1', x: 100, y: 10, pointType: 'smooth', handleIn: { x: 60, y: 10 }, handleOut: { x: 140, y: 10 } },
        { id: 'b2', x: 200, y: 80, pointType: 'smooth', handleIn: { x: 160, y: 10 } },
      ],
      { closed: false },
    );

    expect(checkNodeMorphSupport(openA).supported).toBe(true);
    expect(checkNodeMorphSupport(openB).supported).toBe(true);

    const rawA = extractMorphSnapshotFromNode(openA)!;
    const rawB = extractMorphSnapshotFromNode(openB)!;
    expect(parsePathMorphSnapshot(rawA)?.closed).toBe(false);
    expect(parsePathMorphSnapshot(rawB)?.closed).toBe(false);

    const midJson = interpolatePathMorph(rawA, rawB, 0.5);
    const mid = parsePathMorphSnapshot(midJson);
    expect(mid).not.toBeNull();
    expect(mid!.closed).toBe(false);
    expect(mid!.points.length).toBeGreaterThanOrEqual(3);
  });

  it('morphs deterministically between open path and closed path with exact endpoint topology', () => {
    const openNode = makePathNode(
      'open-1',
      [
        { id: 'o0', x: 0, y: 50, pointType: 'corner' },
        { id: 'o1', x: 100, y: 0, pointType: 'corner' },
        { id: 'o2', x: 200, y: 50, pointType: 'corner' },
      ],
      { closed: false },
    );
    const closedNode = createEllipseNode(0);

    const openRaw = extractMorphSnapshotFromNode(openNode)!;
    const closedRaw = extractMorphSnapshotFromNode(closedNode)!;

    const at0 = parsePathMorphSnapshot(interpolatePathMorph(openRaw, closedRaw, 0))!;
    const atHalf = parsePathMorphSnapshot(interpolatePathMorph(openRaw, closedRaw, 0.5))!;
    const at1 = parsePathMorphSnapshot(interpolatePathMorph(openRaw, closedRaw, 1))!;

    expect(at0.closed).toBe(false);
    expect(atHalf.closed).toBe(true); // Deterministic bridged closure during mid-transition
    expect(at1.closed).toBe(true);
  });
});

describe('FOLIO Path Studio — Pillar 3: Trim Path Engine', () => {
  it('normalizes Trim Start/End/Offset intervals including swapped endpoints and wrap-around', () => {
    // Full range
    expect(normalizeTrimIntervals(0, 100, 0)).toEqual([{ start: 0, end: 1 }]);
    // Empty range
    expect(normalizeTrimIntervals(40, 40, 0)).toEqual([]);
    // Swapped Start > End behaves identically to [End, Start]
    const swapped = normalizeTrimIntervals(80, 20, 0);
    expect(swapped.length).toBe(1);
    expect(swapped[0].start).toBeCloseTo(0.2, 5);
    expect(swapped[0].end).toBeCloseTo(0.8, 5);
    // Offset wrapping across 100% splits into 2 clean sorted intervals: [0, 0.15] & [0.85, 1.0]
    const wrapped = normalizeTrimIntervals(0, 30, 85);
    expect(wrapped.length).toBe(2);
    expect(wrapped[0].start).toBeCloseTo(0, 5);
    expect(wrapped[0].end).toBeCloseTo(0.15, 5);
    expect(wrapped[1].start).toBeCloseTo(0.85, 5);
    expect(wrapped[1].end).toBeCloseTo(1.0, 5);

    const dash = intervalsToSvgStrokeDash(100, wrapped);
    expect(dash.visible).toBe(true);
    expect(dash.dasharray).toBeTruthy();
  });

  it('distributes Simultaneous vs Sequential trim across multi-contour compound paths proportionally', () => {
    const lengths = [100, 100];

    // Simultaneous at 0..50%: BOTH contours are 50% drawn
    const sim = computeContourTrimIntervals(lengths, 0, 50, 0, 'simultaneous');
    expect(sim[0]).toEqual([{ start: 0, end: 0.5 }]);
    expect(sim[1]).toEqual([{ start: 0, end: 0.5 }]);

    // Sequential at 0..50%: First contour is 100% drawn, second contour is 0% drawn
    const seqHalf = computeContourTrimIntervals(lengths, 0, 50, 0, 'sequential');
    expect(seqHalf[0]).toEqual([{ start: 0, end: 1 }]);
    expect(seqHalf[1]).toEqual([]);

    // Sequential at 0..75%: First contour is 100%, second contour is 50%
    const seq75 = computeContourTrimIntervals(lengths, 0, 75, 0, 'sequential');
    expect(seq75[0]).toEqual([{ start: 0, end: 1 }]);
    expect(seq75[1].length).toBe(1);
    expect(seq75[1][0].start).toBeCloseTo(0, 5);
    expect(seq75[1][0].end).toBeCloseTo(0.5, 5);

    const rect = createRectNode(0);
    const rectLens = getNodeContourLengths(rect);
    expect(rectLens.length).toBe(1);
    expect(rectLens[0]).toBeGreaterThan(0);
  });
});

describe('FOLIO Path Studio — Unified Engine Integration, Export Parity, Validation & Undo/Redo', () => {
  it('composes Motion Path + Shape Morph + Trim Path on a single node and propagates Motion Path to children', () => {
    const project = createInitialProject('Path Studio Composed');
    const page = getActivePage(project);

    const parentPath = makePathNode(
      'hero-path',
      [
        { id: 'p0', x: 0, y: 0, pointType: 'corner' },
        { id: 'p1', x: 100, y: 0, pointType: 'corner' },
        { id: 'p2', x: 100, y: 100, pointType: 'corner' },
        { id: 'p3', x: 0, y: 100, pointType: 'corner' },
      ],
      { closed: true, x: 50, y: 50, width: 100, height: 100 },
    );
    const childBadge = {
      ...createRectNode(0),
      id: 'child-badge',
      parentId: 'hero-path',
      x: 75,
      y: 75,
      width: 24,
      height: 24,
    };
    page.document.nodes = [parentPath, childBadge];

    let clip = createAnimationClip({ pageId: page.id, name: 'Unified Path Clip', durationMs: 1000, autoplay: true });
    const mp = createDefaultMotionPathForNode(parentPath);
    clip = upsertMotionPathInClip(clip, { ...mp, autoOrient: true }, { ensureProgressTrack: true });
    clip = enableTrimPathInClip(clip, parentPath, 'draw-in', 'sequential');
    clip = setNodeTrimModeInClip(clip, parentPath.id, 'sequential');

    // Add Shape Morph track
    const morphAdded = addTrackToClip(clip, parentPath, 'pathMorph');
    clip = morphAdded.clip;
    const snap0 = extractMorphSnapshotFromNode(parentPath)!;
    const circleSnap = extractMorphSnapshotFromNode(createEllipseNode(0))!;
    clip = upsertKeyframeInClip(clip, morphAdded.trackId, 0, snap0, 'linear').clip;
    clip = upsertKeyframeInClip(clip, morphAdded.trackId, 1000, circleSnap, 'linear').clip;

    project.animations = [clip];

    // Schema validation passes on .flop v2 project
    const validation = validateProject(project);
    expect(validation.ok).toBe(true);

    // Evaluate at midpoint (500ms)
    const poses = evaluateClipAtTime(clip, 500);
    const pose = poses['hero-path'];
    expect(pose).toBeDefined();
    expect(pose.motionPathCenterX).toBeDefined();
    expect(pose.motionPathAutoOrient).toBe(true);
    expect(pose.trimEnd).toBeCloseTo(50, 1);
    expect(pose.trimMode).toBe('sequential');
    expect(pose.pathMorphGeometry ?? pose.pathMorph).toBeTruthy();

    // Apply poses to document: parent moves + rotates + morphs + preserves trim style; child inherits displacement
    const animatedDoc = applyAnimatedPosesToDocument(page.document, poses);
    const animParent = animatedDoc.nodes.find((n) => n.id === 'hero-path') as PathNode;
    const animChild = animatedDoc.nodes.find((n) => n.id === 'child-badge')!;
    expect(animParent.style.trimEnd).toBeCloseTo(50, 1);
    expect(animParent.style.trimMode).toBe('sequential');
    expect(animParent.x).not.toBeCloseTo(parentPath.x, 0);
    expect(animChild.x).not.toBeCloseTo(childBadge.x, 0);

    // CSS Animation Codegen compiles Motion Path & Trim Path keyframes cleanly
    const cssOut = compilePageAnimationsCss(project, page);
    expect(cssOut).toContain('@keyframes');
    expect(cssOut).toContain('data-folio-trim-contour="0"');

    // HTML/CSS Compiler emits data-folio-trim-contour markup
    const htmlCss = compilePageHtmlCss(project, page);
    expect(htmlCss.bodyInnerHtml).toContain('data-folio-trim-contour="0"');

    // React TSX Compiler compiles with trim contour & morph runtime cleanly
    const reactOut = compileReactProjectFiles(project);
    const pageTsx = reactOut.find((f) => f.path.endsWith('.tsx') && f.content.includes('data-folio-trim-contour'));
    expect(pageTsx).toBeDefined();

    // SVG SMIL Export emits Motion Path transform and Trim Path stroke-dasharray SMIL tags
    const smil = buildNodeSvgSmilAnimations(parentPath, clip, page.document.nodes);
    expect(smil).not.toBeNull();
    expect(smil!.wrapperSmilMarkup).toContain('animateTransform');
    expect(smil!.shapeSmilMarkup).toContain('stroke-dasharray');

    // Node deletion cleans up clip.motionPaths deterministically
    const cleaned = cleanupDeletedNodeReferences(project, new Set(['hero-path']), page.id);
    expect(cleaned.project.animations?.[0]?.motionPaths?.length ?? 0).toBe(0);
  });

  it('builds Motion Path Cruise and Trim Logo Reveal presets and round-trips through Native Command Engine Undo/Redo', () => {
    const project = createInitialProject('Path Studio Presets');
    const page = getActivePage(project);
    const shape = createRectNode(0);
    shape.id = 'card-1';
    page.document.nodes = [shape];

    const cruiseClip = buildPresetClipForPage(page, 'motion-path-cruise', [shape.id]);
    expect(cruiseClip.motionPaths?.length).toBe(1);
    expect(cruiseClip.tracks.some((t) => t.property === 'motionPathProgress')).toBe(true);

    const trimClip = buildPresetClipForPage(page, 'trim-logo-reveal', [shape.id]);
    expect(trimClip.tracks.some((t) => t.property === 'trimEnd')).toBe(true);

    // Native Command Engine undo/redo round-trip
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const createRes = client.createAnimationClip(cruiseClip, 'Add Motion Path Cruise');
    expect(createRes.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations?.length).toBe(1);

    const updatedMp = moveMotionPathAnchor(cruiseClip.motionPaths![0], 1, 420, 180);
    const updatedClip = upsertMotionPathInClip(cruiseClip, updatedMp);
    const updateRes = client.updateAnimationClip(updatedClip, 'Drag motion path point');
    expect(updateRes.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations?.[0].motionPaths?.[0].points[1].x).toBeCloseTo(420, 1);

    // Undo restores previous anchor position
    client.undo();
    expect(store.getSnapshot().editorState.project.animations?.[0].motionPaths?.[0].points[1].x).toBeCloseTo(
      cruiseClip.motionPaths![0].points[1].x,
      1,
    );

    // Redo reapplies dragged anchor position
    client.redo();
    expect(store.getSnapshot().editorState.project.animations?.[0].motionPaths?.[0].points[1].x).toBeCloseTo(420, 1);
  });
});

describe('FOLIO Path Studio — Pro Upgrade (Morphing Paths, Channels, Stagger, Master Export Parity)', () => {
  it('keyframes Motion Path curve geometry over time including mismatched point counts and validates cleanly', () => {
    const project = createInitialProject('Morphing Motion Path');
    const page = getActivePage(project);
    const dot = createEllipseNode(0);
    dot.id = 'mover-1';
    dot.x = 50;
    dot.y = 50;
    dot.width = 40;
    dot.height = 40;
    page.document.nodes = [dot];

    let mp = createDefaultMotionPathForNode(dot);
    // Add shape keyframe at t=1000ms with an extra point & shifted y coordinates
    const editedAt1000: VectorAnchorPoint[] = [
      { id: 'pt-a', x: 70, y: 200, pointType: 'corner' },
      { id: 'pt-b', x: 200, y: 320, pointType: 'smooth' },
      { id: 'pt-c', x: 350, y: 180, pointType: 'smooth' },
      { id: 'pt-d', x: 460, y: 260, pointType: 'corner' },
    ];
    mp = upsertMotionPathShapeKeyframe(mp, 1000, editedAt1000, 'linear', evaluateEasing).binding;
    expect(mp.pathKeyframes?.length).toBe(2); // auto-seeded t=0 + t=1000
    expect(hasMotionPathShapeKeyframeAtTime(mp, 0)).toBe(true);
    expect(hasMotionPathShapeKeyframeAtTime(mp, 1000)).toBe(true);

    // Midpoint at t=500ms interpolates smoothly even though t=0 has 3 pts and t=1000 has 4 pts
    const mid = evaluateMotionPathBindingAtTime(mp, 500, evaluateEasing);
    expect(mid.points.length).toBe(4);
    expect(mid.points[0].y).toBeGreaterThan(70);
    expect(mid.points[0].y).toBeLessThan(200);

    // Direct canvas edit at t=500ms creates a 3rd shape keyframe
    const editedMid = mid.points.map((pt, idx) => (idx === 0 ? { ...pt, y: 150 } : pt));
    const afterEdit = applyMotionPathEditAtTime(mp, 500, editedMid, evaluateEasing);
    expect(afterEdit.pathKeyframes?.length).toBe(3);
    expect(evaluateMotionPathBindingAtTime(afterEdit, 500, evaluateEasing).points[0].y).toBeCloseTo(150, 1);

    // Remove midpoint shape key restores 2 keys
    const midKf = afterEdit.pathKeyframes!.find((kf) => Math.abs(kf.timeMs - 500) <= 15)!;
    const afterRemove = removeMotionPathShapeKeyframe(afterEdit, midKf.id);
    expect(afterRemove.pathKeyframes?.length).toBe(2);

    // Reverse also reverses keyframed shapes
    const reversed = reverseMotionPathPoints(afterRemove);
    expect(reversed.pathKeyframes?.[1].points[0].x).toBeCloseTo(460, 1);

    // Validate project with pathKeyframes
    let clip = createAnimationClip({ pageId: page.id, name: 'Morphing Path', durationMs: 1000 });
    clip = upsertMotionPathInClip(clip, afterRemove, { ensureProgressTrack: true });
    project.animations = [clip];
    const validation = validateProject(project);
    expect(validation.ok).toBe(true);
  });

  it('animates independent motionPathStart, motionPathEnd, and motionPathOffset channels across evaluator, CSS, and SVG SMIL', () => {
    const project = createInitialProject('Animated MP Channels');
    const page = getActivePage(project);
    const box = createRectNode(0);
    box.id = 'channel-box';
    box.x = 0;
    box.y = 0;
    box.width = 40;
    box.height = 40;
    page.document.nodes = [box];

    // Straight horizontal path from (0, 100) to (400, 100)
    const mp: MotionPathBinding = {
      id: 'mp-ch',
      targetNodeId: box.id,
      points: [
        { id: 'ch-p0', x: 0, y: 100, pointType: 'corner' },
        { id: 'ch-p1', x: 400, y: 100, pointType: 'corner' },
      ],
      closed: false,
      autoOrient: false,
      orientOffsetDeg: 0,
      reverse: false,
      constantSpeed: true,
      startPct: 0,
      endPct: 100,
      offsetPx: 0,
      loopMode: 'none',
      visible: true,
    };

    let clip = createAnimationClip({ pageId: page.id, name: 'Channels', durationMs: 1000 });
    clip = upsertMotionPathInClip(clip, mp, { ensureProgressTrack: false });
    // Keep progress fixed at 50%, animate startPct 0->50, endPct 100->100, offsetPx 0->40
    const pTrack = addTrackToClip(clip, box, 'motionPathProgress');
    clip = upsertKeyframeInClip(pTrack.clip, pTrack.trackId, 0, 50, 'linear').clip;
    clip = upsertKeyframeInClip(clip, pTrack.trackId, 1000, 50, 'linear').clip;

    const sTrack = addTrackToClip(clip, box, 'motionPathStart');
    clip = upsertKeyframeInClip(sTrack.clip, sTrack.trackId, 0, 0, 'linear').clip;
    clip = upsertKeyframeInClip(clip, sTrack.trackId, 1000, 50, 'linear').clip;

    const oTrack = addTrackToClip(clip, box, 'motionPathOffset');
    clip = upsertKeyframeInClip(oTrack.clip, oTrack.trackId, 0, 0, 'linear').clip;
    clip = upsertKeyframeInClip(clip, oTrack.trackId, 1000, 40, 'linear').clip;

    project.animations = [clip];
    expect(validateProject(project).ok).toBe(true);

    // At t=0: start=0, end=100, progress=50% => center (200, 100) => node.x=180, node.y=80
    const doc0 = applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 0));
    const n0 = doc0.nodes.find((n) => n.id === box.id)!;
    expect(n0.x).toBeCloseTo(180, 1);
    expect(n0.y).toBeCloseTo(80, 1);

    // At t=1000: start=50, end=100, progress=50% => 75% along [0..400] => center (300, 140) => node.x=280, node.y=120
    const doc1 = applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 1000));
    const n1 = doc1.nodes.find((n) => n.id === box.id)!;
    expect(n1.x).toBeCloseTo(280, 1);
    expect(n1.y).toBeCloseTo(120, 1);

    // CSS & SVG SMIL export include the animated translation delta
    const css = compilePageAnimationsCss(project, page);
    expect(css).toContain('translate(180px, 80px)');
    expect(css).toContain('280');
    expect(css).toContain('120px');

    const smil = buildNodeSvgSmilAnimations(box, clip, page.document.nodes);
    expect(smil).not.toBeNull();
    expect(smil!.wrapperSmilMarkup).toContain('animateTransform');
  });

  it('staggers multiple selected objects sequentially for both Motion Path and Trim Path (forward & reverse)', () => {
    const project = createInitialProject('Multi-Object Stagger');
    const page = getActivePage(project);
    const n1 = createRectNode(0); n1.id = 'item-1'; n1.x = 40; n1.y = 40;
    const n2 = createRectNode(1); n2.id = 'item-2'; n2.x = 40; n2.y = 120;
    const n3 = createRectNode(2); n3.id = 'item-3'; n3.x = 40; n3.y = 200;
    page.document.nodes = [n1, n2, n3];

    let clip = createAnimationClip({ pageId: page.id, name: 'Stagger', durationMs: 1000 });
    clip = applyStaggeredMotionPathInClip(clip, [n1, n2, n3], {
      staggerMs: 150,
      travelDurationMs: 1000,
      order: 'selection',
    });

    expect(clip.motionPaths?.length).toBe(3);
    expect(clip.durationMs).toBeGreaterThanOrEqual(1300);
    const t1 = clip.tracks.find((t) => t.targetNodeId === 'item-1' && t.property === 'motionPathProgress');
    const t2 = clip.tracks.find((t) => t.targetNodeId === 'item-2' && t.property === 'motionPathProgress');
    const t3 = clip.tracks.find((t) => t.targetNodeId === 'item-3' && t.property === 'motionPathProgress');
    // item-1 runs 0 -> 1000; item-2 holds at 0 until 150 -> 1150; item-3 holds at 0 until 300 -> 1300
    expect(t1?.keyframes[0].timeMs).toBe(0);
    expect(t2?.keyframes.some((kf) => kf.timeMs === 150 && kf.value === 0)).toBe(true);
    expect(t2?.keyframes[t2.keyframes.length - 1].timeMs).toBe(1150);
    expect(t3?.keyframes.some((kf) => kf.timeMs === 300 && kf.value === 0)).toBe(true);
    expect(t3?.keyframes[t3.keyframes.length - 1].timeMs).toBe(1300);

    // Reverse stagger on Trim Path
    const trimClip = applyStaggeredTrimPathInClip(
      createAnimationClip({ pageId: page.id, name: 'Trim Stagger', durationMs: 800 }),
      [n1, n2, n3],
      'draw-in',
      'sequential',
      { staggerMs: 200, strokeDurationMs: 800, order: 'reverse' },
    );
    const tr1 = trimClip.tracks.find((t) => t.targetNodeId === 'item-1' && t.property === 'trimEnd');
    const tr3 = trimClip.tracks.find((t) => t.targetNodeId === 'item-3' && t.property === 'trimEnd');
    // Reverse order => item-3 starts at 0ms -> 800ms, item-1 holds until 400ms -> 1200ms
    expect(tr3?.keyframes[0].timeMs).toBe(0);
    expect(tr3?.keyframes[tr3.keyframes.length - 1].timeMs).toBe(800);
    expect(tr1?.keyframes.some((kf) => kf.timeMs === 400 && kf.value === 0)).toBe(true);
    expect(tr1?.keyframes[tr1.keyframes.length - 1].timeMs).toBe(1200);
    expect(tr1?.trimMode).toBe('sequential');
  });

  it('maintains React TSX export parity for animated Master Components with combined Shape Morph + Trim Path + Motion Path', () => {
    const project = createInitialProject('Master Parity');
    const page = getActivePage(project);

    const masterShape = createRectNode(0);
    masterShape.id = 'master-icon';
    masterShape.name = 'Master Icon';
    masterShape.x = 20;
    masterShape.y = 20;
    masterShape.width = 80;
    masterShape.height = 80;
    masterShape.style = { ...masterShape.style, fill: '#3b82f6', stroke: '#ffffff', strokeWidth: 3 };

    const masterMp = createDefaultMotionPathForNode(masterShape);
    let compClip = createAnimationClip({ pageId: 'comp-page', name: 'Icon Anim', durationMs: 1200, autoplay: true, loop: true });
    compClip = upsertMotionPathInClip(compClip, masterMp, { ensureProgressTrack: true });
    compClip = enableTrimPathInClip(compClip, masterShape, 'draw-in', 'simultaneous');
    const mTrack = addTrackToClip(compClip, masterShape, 'pathMorph');
    compClip = upsertKeyframeInClip(mTrack.clip, mTrack.trackId, 0, extractMorphSnapshotFromNode(masterShape)!, 'ease-in-out').clip;
    compClip = upsertKeyframeInClip(compClip, mTrack.trackId, 1200, createMorphPresetSnapshot('star', 80, 80), 'ease-in-out').clip;

    const now = new Date().toISOString();
    project.components = [
      {
        id: 'comp-animated-badge',
        name: 'Animated Badge',
        scope: 'global',
        createdAt: now,
        updatedAt: now,
        document: {
          id: 'doc-comp-badge',
          name: 'Animated Badge',
          width: 160,
          height: 160,
          background: 'transparent',
          nodes: [masterShape],
        },
        animations: [compClip],
      },
    ];

    page.document.nodes = [
      {
        id: 'inst-1',
        type: 'component-instance',
        name: 'Animated Badge Instance',
        componentId: 'comp-animated-badge',
        x: 100,
        y: 100,
        width: 160,
        height: 160,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        overrides: {},
      },
    ];

    const reactFiles = compileReactProjectFiles(project);
    const compFile = reactFiles.find((f) => f.path.includes('AnimatedBadge') && f.path.endsWith('.tsx'));
    const pageFile = reactFiles.find((f) => f.path.includes('src/pages/') && f.path.endsWith('.tsx'));
    const morphHookFile = reactFiles.find((f) => f.path === 'src/motion/useFolioShapeMorph.ts');
    const pageAnimCss = compilePageAnimationsCss(project, page);
    expect(compFile).toBeDefined();
    expect(pageFile).toBeDefined();
    expect(morphHookFile).toBeDefined();

    // Master Component JSX emits scoped IDs, morph target attribute, AND trim contour attribute!
    expect(compFile!.content).toContain('scopedId');
    expect(compFile!.content).toContain('data-folio-morph-path="true"');
    expect(compFile!.content).toContain('data-folio-trim-contour="0"');
    // Page JSX passes instanceId="inst-1" so scoped CSS matches 1:1
    expect(pageFile!.content).toContain('instanceId="inst-1"');
    // Compiled CSS includes the component's scoped keyframes
    expect(pageAnimCss).toContain('inst-1__master-icon');
  });

  it('prevents X/Y position keyframe conflicts when Motion Path is active while keeping rotation, size, color, and opacity animatable', () => {
    const project = createInitialProject('Motion Path Position Ownership');
    const page = getActivePage(project);
    const box = createRectNode(0);
    box.id = 'path-owned-box';
    box.x = 100;
    box.y = 100;
    box.width = 60;
    box.height = 60;
    box.rotation = 0;
    box.opacity = 1;
    box.style = { ...box.style, fill: '#3B82F6' };
    page.document.nodes = [box];

    // 1. Pre-populate conflicting X/Y tracks alongside rotation & opacity
    let clip = createAnimationClip({ pageId: page.id, name: 'No Collision', durationMs: 1000 });
    clip = addTrackToClip(clip, box, 'x').clip;
    clip = addTrackToClip(clip, box, 'y').clip;
    clip = addTrackToClip(clip, box, 'rotation').clip;
    clip = addTrackToClip(clip, box, 'opacity').clip;
    expect(clip.tracks.some((t) => t.property === 'x')).toBe(true);
    expect(clip.tracks.some((t) => t.property === 'y')).toBe(true);

    // 2. Attach Motion Path -> conflicting X/Y tracks MUST be stripped, rotation & opacity preserved
    const mp: MotionPathBinding = {
      id: 'mp-no-collision',
      targetNodeId: box.id,
      points: [
        { id: 'nc-0', x: 50, y: 200, pointType: 'corner' },
        { id: 'nc-1', x: 450, y: 200, pointType: 'corner' },
      ],
      closed: false,
      autoOrient: false,
      orientOffsetDeg: 0,
      reverse: false,
      constantSpeed: true,
      startPct: 0,
      endPct: 100,
      offsetPx: 0,
      loopMode: 'none',
      visible: true,
    };
    clip = upsertMotionPathInClip(clip, mp, { ensureProgressTrack: true });

    expect(hasActiveMotionPathForNode(clip, box.id)).toBe(true);
    expect(isPropertyLockedByMotionPath(clip, box.id, 'x')).toBe(true);
    expect(isPropertyLockedByMotionPath(clip, box.id, 'y')).toBe(true);
    expect(isPropertyLockedByMotionPath(clip, box.id, 'rotation')).toBe(false);
    expect(isPropertyLockedByMotionPath(clip, box.id, 'width')).toBe(false);
    expect(isPropertyLockedByMotionPath(clip, box.id, 'fill')).toBe(false);
    expect(clip.tracks.some((t) => t.property === 'x' || t.property === 'y')).toBe(false);
    expect(clip.tracks.some((t) => t.property === 'rotation')).toBe(true);
    expect(clip.tracks.some((t) => t.property === 'opacity')).toBe(true);
    expect(clip.tracks.some((t) => t.property === 'motionPathProgress')).toBe(true);

    // 3. Direct addTrackToClip & togglePropertyKeyframeInClip block X/Y but allow fill/width/rotation
    const blockedX = addTrackToClip(clip, box, 'x');
    const blockedY = addTrackToClip(clip, box, 'y');
    expect(blockedX.trackId).toBe('');
    expect(blockedY.trackId).toBe('');
    expect(blockedX.clip).toBe(clip);

    const toggledX = togglePropertyKeyframeInClip(clip, box, 'x', 500, { baselineNode: box });
    expect(toggledX.clip.tracks.some((t) => t.property === 'x')).toBe(false);

    const addedFill = addTrackToClip(clip, box, 'fill');
    expect(addedFill.trackId).not.toBe('');
    clip = addedFill.clip;

    // 4. captureNodeKeyframeSnapshot (+ Key) captures rotation/size/color/opacity, NEVER x/y
    const snapRes = captureNodeKeyframeSnapshot(clip, box, 500, { baselineNode: box });
    expect(snapRes.capturedProperties).not.toContain('x');
    expect(snapRes.capturedProperties).not.toContain('y');
    expect(snapRes.capturedProperties).toContain('rotation');
    expect(snapRes.capturedProperties).toContain('width');
    expect(snapRes.capturedProperties).toContain('fill');
    clip = snapRes.clip;
    expect(clip.tracks.some((t) => t.property === 'x' || t.property === 'y')).toBe(false);

    // 5. Auto-Key ignores pure X/Y drag, and when resizing/rotating + shifting X/Y only records non-position props
    const onlyMoved = { ...box, x: 320, y: 420 };
    const autoMoved = applyAutoKeyFromNodeChange(clip, box, onlyMoved, 500, { baselineNode: box });
    expect(autoMoved.recorded).toBe(false);
    expect(autoMoved.changedProperties).toEqual([]);

    const resizedAndRotated = {
      ...box,
      x: 240,
      y: 260,
      width: 110,
      rotation: 90,
      style: { ...box.style, fill: '#EF4444' },
    };
    const autoMixed = applyAutoKeyFromNodeChange(clip, box, resizedAndRotated, 500, { baselineNode: box });
    expect(autoMixed.recorded).toBe(true);
    expect(autoMixed.changedProperties).toContain('width');
    expect(autoMixed.changedProperties).toContain('rotation');
    expect(autoMixed.changedProperties).toContain('fill');
    expect(autoMixed.changedProperties).not.toContain('x');
    expect(autoMixed.changedProperties).not.toContain('y');
    expect(autoMixed.clip.tracks.some((t) => t.property === 'x' || t.property === 'y')).toBe(false);
    clip = autoMixed.clip;

    // 6. Defense-in-depth: even if a legacy .flop file manually injects X/Y tracks alongside Motion Path,
    //    evaluator, CSS codegen, and SVG SMIL all honor Motion Path exclusively!
    const legacyConflictClip = {
      ...clip,
      tracks: [
        ...clip.tracks,
        {
          id: 'legacy-x',
          targetNodeId: box.id,
          property: 'x' as const,
          keyframes: [
            { id: 'lx0', timeMs: 0, value: 999, easing: 'linear' as const },
            { id: 'lx1', timeMs: 1000, value: 1999, easing: 'linear' as const },
          ],
        },
        {
          id: 'legacy-y',
          targetNodeId: box.id,
          property: 'y' as const,
          keyframes: [
            { id: 'ly0', timeMs: 0, value: 888, easing: 'linear' as const },
            { id: 'ly1', timeMs: 1000, value: 1888, easing: 'linear' as const },
          ],
        },
      ],
    };

    const poseMid = evaluateClipAtTime(legacyConflictClip, 500)[box.id];
    expect(poseMid.x).toBeUndefined();
    expect(poseMid.y).toBeUndefined();
    expect(poseMid.motionPathCenterX).toBeCloseTo(250, 1);
    expect(poseMid.motionPathCenterY).toBeCloseTo(200, 1);
    expect(poseMid.rotation).toBeCloseTo(90, 1);
    expect(poseMid.width).toBeCloseTo(110, 1);

    project.animations = [legacyConflictClip];
    const css = compilePageAnimationsCss(project, page);
    expect(css).not.toContain('899px');
    expect(css).not.toContain('1899px');
    expect(css).toContain('rotate(90deg)');

    const smil = buildNodeSvgSmilAnimations(box, legacyConflictClip, page.document.nodes);
    expect(smil).not.toBeNull();
    expect(smil!.wrapperSmilMarkup).not.toContain('899');
  });
});


