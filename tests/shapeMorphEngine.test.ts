import { describe, expect, it } from 'vitest';
import {
  createEllipseNode,
  createEmptyDocument,
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
  createTriangleNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { serializeProjectToFlopJson } from '../src/core/persistence/projectFile';
import { migrateProjectToV2 } from '../src/core/document/migrations';
import { validateProject } from '../src/core/document/validation';
import { serializePathPointsToSvgD } from '../src/core/document/vector';
import type { ComponentDefinition, GroupNode, PathNode } from '../src/core/document/types';
import {
  MAX_MORPH_POINTS,
  MAX_PREPARED_MORPH_CACHE,
  checkMorphPairCompatibility,
  checkNodeMorphSupport,
  clearMorphPairCache,
  computeContourSignedArea,
  createMorphPresetSnapshot,
  extractMorphSnapshotFromNode,
  getMorphCacheStats,
  interpolatePathMorph,
  parsePathMorphSnapshot,
  prepareMorphPair,
  reverseMorphContour,
  rotateMorphContour,
  serializePathMorphSnapshot,
  updateMorphSnapshotOptions,
} from '../src/core/document/pathMorph';
import {
  applyAnimatedPosesToDocument,
  buildLivePreviewMorphScript,
  compilePageAnimationsCss,
  createAnimationClip,
  evaluateClipAtTime,
  evaluateComponentDocumentAtTime,
} from '../src/engines/animation';
import { buildMotionClipJson } from '../src/engines/animation/videoExport';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import { RUNTIME_FEATURE_PARITY_MATRIX } from '../src/engines/prototype';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';

describe('FOLIO Native Shape Morph Engine', () => {
  describe('1. Geometry Representation, Matching & Topology Diagnostics', () => {
    it('extracts canonical closed Bezier contours from Circle, Rounded Rect, Frame, and Path nodes without mutating source nodes', () => {
      const circle = { ...createEllipseNode(0), id: 'geo-circle', x: 10, y: 20, width: 120, height: 120 };
      const roundedRect = {
        ...createRectNode(0),
        id: 'geo-rect',
        width: 160,
        height: 100,
        style: { ...createRectNode(0).style, radius: 24 },
      };
      const frame = { ...createFrameNode(0), id: 'geo-frame', width: 200, height: 140 };
      const tri = { ...createTriangleNode(0, 0, 100, 100), id: 'geo-tri' };

      for (const node of [circle, roundedRect, frame, tri]) {
        const support = checkNodeMorphSupport(node);
        expect(support.supported, `${node.id} should be morph-supported`).toBe(true);
        const snapJson = extractMorphSnapshotFromNode(node);
        expect(snapJson).not.toBeNull();
        const parsed = parsePathMorphSnapshot(snapJson!);
        expect(parsed).not.toBeNull();
        expect(parsed!.closed).toBe(true);
        expect(parsed!.points.length).toBeGreaterThanOrEqual(3);
        // Verify local-space coordinate preservation [0..width, 0..height]
        for (const pt of parsed!.points) {
          expect(pt.x).toBeGreaterThanOrEqual(0);
          expect(pt.x).toBeLessThanOrEqual(node.width + 0.01);
          expect(pt.y).toBeGreaterThanOrEqual(0);
          expect(pt.y).toBeLessThanOrEqual(node.height + 0.01);
        }
      }
    });

    it('morphs Circle -> Rounded Square and Circle -> Sharp Square with zero rotational twist', () => {
      const circleSnap = createMorphPresetSnapshot('circle', 120, 120);
      const roundedSnap = createMorphPresetSnapshot('rounded-rect', 120, 120);
      const squareSnap = createMorphPresetSnapshot('square', 120, 120);

      // Circle (4pt) -> Rounded Square (12pt with cardinal midpoints)
      const pairRounded = prepareMorphPair(circleSnap, roundedSnap);
      expect(pairRounded?.compatible).toBe(true);
      expect(pairRounded!.pointCount).toBe(12);

      // Verify zero angular twist for Circle -> Rounded Square (all 12 anchors stay within ~5 deg radially)
      const cx = 60;
      const cy = 60;
      for (let i = 0; i < pairRounded!.pointCount; i += 1) {
        const ax = pairRounded!.fromBuf[i * 7] - cx;
        const ay = pairRounded!.fromBuf[i * 7 + 1] - cy;
        const bx = pairRounded!.toBuf[i * 7] - cx;
        const by = pairRounded!.toBuf[i * 7 + 1] - cy;
        const dot = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
        expect(dot).toBeGreaterThan(0.99);
      }

      // Circle (4pt at 0/90/180/270) -> Sharp Square (4pt at 45/135/225/315)
      // Automatically subdivides to 8 anchors so angular offset drops to 0 deg!
      const pairSquare = prepareMorphPair(circleSnap, squareSnap);
      expect(pairSquare?.compatible).toBe(true);
      expect(pairSquare!.pointCount).toBe(8);

      // Verify zero angular twist: every anchor moves nearly radially from centroid (60, 60)
      for (let i = 0; i < pairSquare!.pointCount; i += 1) {
        const ax = pairSquare!.fromBuf[i * 7] - cx;
        const ay = pairSquare!.fromBuf[i * 7 + 1] - cy;
        const bx = pairSquare!.toBuf[i * 7] - cx;
        const by = pairSquare!.toBuf[i * 7 + 1] - cy;
        const dot = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
        // cos(angle) > 0.99 means < 8 degrees deviation (pure radial expansion!)
        expect(dot).toBeGreaterThan(0.99);
      }

      const midJson = interpolatePathMorph(circleSnap, roundedSnap, 0.5);
      const mid = parsePathMorphSnapshot(midJson);
      expect(mid).not.toBeNull();
      expect(mid!.closed).toBe(true);
      expect(mid!.points.length).toBe(pairRounded!.pointCount);
      // Cardinal Top-Center anchor stays exactly centered at (60, 0) with 0 horizontal drift
      expect(mid!.points[0].x).toBeCloseTo(60, 1);
      expect(mid!.points[0].y).toBeCloseTo(0, 1);
    });

    it('normalizes reversed winding direction and rotated start anchors automatically without figure-8 twist', () => {
      const circleSnap = createMorphPresetSnapshot('circle', 100, 100);
      const triParsed = parsePathMorphSnapshot(createMorphPresetSnapshot('triangle', 100, 100))!;
      expect(computeContourSignedArea(triParsed.points)).toBeGreaterThan(0);

      // Reverse winding (CCW) AND rotate start index by 2
      const reversedRotatedPts = rotateMorphContour(reverseMorphContour(triParsed.points), 2);
      expect(computeContourSignedArea(reversedRotatedPts)).toBeLessThan(0);

      const ccwTriSnap = JSON.stringify({
        v: 1,
        closed: true,
        points: reversedRotatedPts,
        label: 'CCW Triangle',
      });

      const pair = prepareMorphPair(circleSnap, ccwTriSnap);
      expect(pair?.compatible).toBe(true);
      expect(pair!.reversed).toBe(true);

      // At t=0.5, the morphed contour must keep positive signed area (never collapses to 0 or inverts)
      const mid = parsePathMorphSnapshot(interpolatePathMorph(circleSnap, ccwTriSnap, 0.5))!;
      const areaMid = computeContourSignedArea(mid.points);
      expect(areaMid).toBeGreaterThan(2500);
    });

    it('supports Phase 2 manual correspondence overrides (matchMode, reverse, startOffset)', () => {
      const squareSnap = createMorphPresetSnapshot('square', 100, 100);
      const arrowSnap = createMorphPresetSnapshot('arrow', 100, 100);

      const autoPair = prepareMorphPair(squareSnap, arrowSnap)!;
      const shiftedSnap = updateMorphSnapshotOptions(arrowSnap, { startOffset: 2, reverse: true })!;
      const shiftedPair = prepareMorphPair(squareSnap, shiftedSnap)!;
      expect(shiftedPair.reversed).toBe(!autoPair.reversed);
      expect(shiftedPair.cyclicShift).not.toBe(autoPair.cyclicShift);

      const indexSnap = updateMorphSnapshotOptions(arrowSnap, { matchMode: 'index' })!;
      const indexPair = prepareMorphPair(squareSnap, indexSnap)!;
      expect(indexPair.cyclicShift).toBe(0);
      expect(indexPair.reversed).toBe(false);
    });

    it('explicitly classifies and rejects unsupported node types and incompatible topologies', () => {
      // Unsupported node types
      const textNode = createTextNode(0);
      expect(checkNodeMorphSupport(textNode).supported).toBe(false);
      expect(checkNodeMorphSupport(textNode).reason).toBe('unsupported-node-type');

      const groupNode: GroupNode = {
        id: 'grp-1',
        name: 'Group',
        type: 'group',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      };
      expect(checkNodeMorphSupport(groupNode).reason).toBe('unsupported-node-type');

      // Open path
      const openPath: PathNode = {
        ...createTriangleNode(0, 0, 100, 100),
        id: 'open-path',
        closed: false,
      };
      expect(checkNodeMorphSupport(openPath).supported).toBe(false);
      expect(checkNodeMorphSupport(openPath).reason).toBe('open-path');

      // Multi-contour / compound path with closed hole (Phase 3 supported)
      const compoundPath: PathNode = {
        ...createTriangleNode(0, 0, 100, 100),
        id: 'compound-path',
        subpaths: [
          {
            closed: true,
            points: [
              { id: 'h0', x: 30, y: 30, pointType: 'corner' },
              { id: 'h1', x: 70, y: 30, pointType: 'corner' },
              { id: 'h2', x: 50, y: 70, pointType: 'corner' },
            ],
          },
        ],
      };
      expect(checkNodeMorphSupport(compoundPath).supported).toBe(true);

      // Compound path with an OPEN hole subpath must still be rejected cleanly
      const openSubpathCompound: PathNode = {
        ...compoundPath,
        id: 'compound-open-subpath',
        subpaths: [
          {
            closed: false,
            points: compoundPath.subpaths![0].points,
          },
        ],
      };
      expect(checkNodeMorphSupport(openSubpathCompound).supported).toBe(false);
      expect(checkNodeMorphSupport(openSubpathCompound).reason).toBe('open-path');

      // Degenerate < 3 points
      const tooFewPath: PathNode = {
        ...createTriangleNode(0, 0, 100, 100),
        id: 'few-pts',
        points: [
          { id: 'p0', x: 0, y: 0, pointType: 'corner' },
          { id: 'p1', x: 50, y: 50, pointType: 'corner' },
        ],
      };
      expect(checkNodeMorphSupport(tooFewPath).reason).toBe('too-few-points');

      // Collapsed zero-perimeter contour
      const collapsedSnap = parsePathMorphSnapshot(
        JSON.stringify({
          v: 1,
          closed: true,
          points: [
            { x: 10, y: 10, pt: 'c' },
            { x: 10, y: 10, pt: 'c' },
            { x: 10, y: 10, pt: 'c' },
          ],
        }),
      );
      const validCircle = parsePathMorphSnapshot(createMorphPresetSnapshot('circle', 100, 100));
      expect(checkMorphPairCompatibility(validCircle, collapsedSnap).reason).toBe('degenerate-geometry');

      // Exceeds point budget
      const hugePoints = Array.from({ length: MAX_MORPH_POINTS + 10 }, (_, i) => ({
        x: Math.cos((i / (MAX_MORPH_POINTS + 10)) * Math.PI * 2) * 50 + 50,
        y: Math.sin((i / (MAX_MORPH_POINTS + 10)) * Math.PI * 2) * 50 + 50,
        pt: 'c' as const,
      }));
      const hugeSnap = parsePathMorphSnapshot(JSON.stringify({ v: 1, closed: true, points: hugePoints }));
      expect(checkMorphPairCompatibility(validCircle, hugeSnap).reason).toBe('exceeds-point-budget');

      // Non-finite JSON fails parsing cleanly
      expect(parsePathMorphSnapshot('{"v":1,"closed":true,"points":[{"x":NaN,"y":0,"pt":"c"}]}')).toBeNull();
    });
  });

  describe('2. Multi-Keyframe Motion Playback, Determinism & Transform Composition', () => {
    it('evaluates Circle -> Rounded Square -> Triangle -> Arrow -> Circle on ONE stable nodeId alongside transforms and color', () => {
      const project = createInitialProject('Shape Morph Motion');
      const page = getActivePage(project);
      const circle = {
        ...createEllipseNode(0),
        id: 'shape-001',
        name: 'Hero Shape',
        x: 100,
        y: 120,
        width: 140,
        height: 140,
      };
      page.document.nodes = [circle];

      const snapCircle = createMorphPresetSnapshot('circle', 140, 140);
      const snapRounded = createMorphPresetSnapshot('rounded-rect', 140, 140);
      const snapTriangle = createMorphPresetSnapshot('triangle', 140, 140);
      const snapArrow = createMorphPresetSnapshot('arrow', 140, 140);

      const clip = createAnimationClip({
        id: 'clip-morph-cycle',
        pageId: page.id,
        name: 'Shape Cycle',
        durationMs: 2000,
        loop: true,
        autoplay: true,
        tracks: [
          {
            id: 'trk-morph',
            targetNodeId: circle.id,
            property: 'pathMorph',
            keyframes: [
              { id: 'kf-0', timeMs: 0, value: snapCircle, easing: 'linear' },
              { id: 'kf-500', timeMs: 500, value: snapRounded, easing: 'ease-in-out' },
              { id: 'kf-1000', timeMs: 1000, value: snapTriangle, easing: 'ease-in-out' },
              { id: 'kf-1500', timeMs: 1500, value: snapArrow, easing: 'ease-in-out' },
              { id: 'kf-2000', timeMs: 2000, value: snapCircle, easing: 'ease-in-out' },
            ],
          },
          {
            id: 'trk-x',
            targetNodeId: circle.id,
            property: 'x',
            keyframes: [
              { id: 'kfx-0', timeMs: 0, value: 100, easing: 'linear' },
              { id: 'kfx-2000', timeMs: 2000, value: 300, easing: 'linear' },
            ],
          },
          {
            id: 'trk-rot',
            targetNodeId: circle.id,
            property: 'rotation',
            keyframes: [
              { id: 'kfr-0', timeMs: 0, value: 0, easing: 'linear' },
              { id: 'kfr-2000', timeMs: 2000, value: 180, easing: 'linear' },
            ],
          },
          {
            id: 'trk-fill',
            targetNodeId: circle.id,
            property: 'fill',
            keyframes: [
              { id: 'kff-0', timeMs: 0, value: '#3b82f6', easing: 'linear' },
              { id: 'kff-2000', timeMs: 2000, value: '#ec4899', easing: 'linear' },
            ],
          },
        ],
      });

      const sampleTimes = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000];
      const svgPaths: string[] = [];

      for (const t of sampleTimes) {
        const poses = evaluateClipAtTime(clip, t);
        const evalDoc = applyAnimatedPosesToDocument(page.document, poses);
        // Always ONE object, exact same nodeId, never duplicated!
        expect(evalDoc.nodes).toHaveLength(1);
        const evalNode = evalDoc.nodes[0];
        expect(evalNode.id).toBe('shape-001');
        expect(evalNode.type).toBe('path');
        if (evalNode.type === 'path') {
          expect(evalNode.closed).toBe(true);
          svgPaths.push(serializePathPointsToSvgD(evalNode.points, evalNode.closed));
        }
      }

      // Every transition midpoint must differ from both endpoints (actual geometry change!)
      expect(svgPaths[1]).not.toBe(svgPaths[0]);
      expect(svgPaths[1]).not.toBe(svgPaths[2]);
      expect(svgPaths[3]).not.toBe(svgPaths[2]);
      expect(svgPaths[3]).not.toBe(svgPaths[4]);
      expect(svgPaths[5]).not.toBe(svgPaths[4]);
      expect(svgPaths[5]).not.toBe(svgPaths[6]);
      // Exact loop closure: 0ms and 2000ms both return to Circle
      expect(svgPaths[0]).toBe(svgPaths[8]);

      // Midpoint at 1000ms combines morph + x + rotation + fill simultaneously
      const midDoc = applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 1000));
      const midNode = midDoc.nodes[0];
      expect(midNode.x).toBeCloseTo(200, 1);
      expect(midNode.rotation).toBeCloseTo(90, 1);
      expect(midNode.type === 'path' && midNode.style.fill).not.toBe('#3b82f6');

      // Scrubbing backward & determinism check
      const forward750 = applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 750)).nodes[0];
      const backward750 = applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 750)).nodes[0];
      expect(
        forward750.type === 'path' && backward750.type === 'path'
          ? serializePathPointsToSvgD(forward750.points, forward750.closed)
          : '',
      ).toBe(
        backward750.type === 'path'
          ? serializePathPointsToSvgD(backward750.points, backward750.closed)
          : 'mismatch',
      );

      // Canonical base document MUST remain untouched (still EllipseNode, x=100, rotation=0)
      expect(page.document.nodes).toHaveLength(1);
      expect(page.document.nodes[0].type).toBe('ellipse');
      expect(page.document.nodes[0].x).toBe(100);
      expect(page.document.nodes[0].rotation).toBe(0);
    });
  });

  describe('3. Project Integrity: Native Commands, Undo/Redo, .flop v2 Persistence & Component Sync', () => {
    it('commits Shape Morph via Native Command Engine with clean Undo/Redo and .flop v2 save/reopen round-trip', () => {
      const project = createInitialProject('Morph Persistence');
      const page = getActivePage(project);
      const circle = { ...createEllipseNode(0), id: 'persist-circle', x: 40, y: 40, width: 100, height: 100 };
      page.document.nodes = [circle];

      const store = createCanonicalEditorStore(createEditorState(project));
      const client = createMainCanvasCommandClient(store);

      const snap0 = extractMorphSnapshotFromNode(circle)!;
      const snap1 = createMorphPresetSnapshot('rounded-rect', 100, 100, { startOffset: 1 });
      const clip = createAnimationClip({
        id: 'clip-cmd-morph',
        pageId: page.id,
        name: 'Circle To Squircle',
        durationMs: 800,
        tracks: [
          {
            id: 'trk-m1',
            targetNodeId: circle.id,
            property: 'pathMorph',
            keyframes: [
              { id: 'kf-a', timeMs: 0, value: snap0, easing: 'linear' },
              { id: 'kf-b', timeMs: 800, value: snap1, easing: 'ease-out' },
            ],
          },
        ],
      });

      const res = client.createAnimationClip(clip, 'Enable Shape Morph');
      expect(res.status).toBe('applied');
      expect(store.getSnapshot().editorState.project.animations).toHaveLength(1);
      expect(getActivePage(store.getSnapshot().editorState.project).document.nodes).toHaveLength(1);
      expect(getActivePage(store.getSnapshot().editorState.project).document.nodes[0].id).toBe('persist-circle');

      // Validate & serialize .flop v2 round-trip
      const savedJson = serializeProjectToFlopJson(store.getSnapshot().editorState.project);
      const parsedRaw = JSON.parse(savedJson) as unknown;
      const reopened = migrateProjectToV2(parsedRaw);
      expect(validateProject(reopened).ok).toBe(true);
      const restoredClip = reopened.animations?.[0];
      expect(restoredClip?.tracks[0].property).toBe('pathMorph');
      expect(restoredClip?.tracks[0].targetNodeId).toBe('persist-circle');
      const restoredKf1 = parsePathMorphSnapshot(String(restoredClip?.tracks[0].keyframes[1].value));
      expect(restoredKf1?.label).toBe('Rounded Square');
      expect(restoredKf1?.morph?.startOffset).toBe(1);

      // Undo removes morph clip cleanly; Redo restores it cleanly
      client.undo();
      expect(store.getSnapshot().editorState.project.animations ?? []).toHaveLength(0);
      client.redo();
      expect(store.getSnapshot().editorState.project.animations).toHaveLength(1);
    });

    it('evaluates Shape Morph inside Component Master animations without changing component node identity', () => {
      const circle = { ...createEllipseNode(0), id: 'comp-morph-circle', x: 10, y: 10, width: 80, height: 80 };
      const doc = createEmptyDocument('Morph Icon', 100, 100);
      doc.nodes = [circle];

      const clip = createAnimationClip({
        id: 'comp-clip-morph',
        pageId: 'comp-page',
        name: 'Icon Morph',
        durationMs: 1000,
        tracks: [
          {
            id: 'comp-trk-morph',
            targetNodeId: circle.id,
            property: 'pathMorph',
            keyframes: [
              { id: 'c0', timeMs: 0, value: createMorphPresetSnapshot('circle', 80, 80), easing: 'linear' },
              { id: 'c1', timeMs: 1000, value: createMorphPresetSnapshot('star', 80, 80), easing: 'linear' },
            ],
          },
        ],
      });

      const now = new Date().toISOString();
      const master: ComponentDefinition = {
        id: 'comp-morph-master',
        name: 'Morph Icon',
        document: doc,
        animations: [clip],
        createdAt: now,
        updatedAt: now,
      };

      const eval0 = evaluateComponentDocumentAtTime(master.document, master.animations, 0);
      const eval500 = evaluateComponentDocumentAtTime(master.document, master.animations, 500);
      const eval1000 = evaluateComponentDocumentAtTime(master.document, master.animations, 1000);

      expect(eval0.nodes[0].id).toBe('comp-morph-circle');
      expect(eval500.nodes[0].id).toBe('comp-morph-circle');
      expect(eval1000.nodes[0].id).toBe('comp-morph-circle');
      const d0 = eval0.nodes[0].type === 'path' ? serializePathPointsToSvgD(eval0.nodes[0].points, true) : '';
      const d500 = eval500.nodes[0].type === 'path' ? serializePathPointsToSvgD(eval500.nodes[0].points, true) : '';
      const d1000 = eval1000.nodes[0].type === 'path' ? serializePathPointsToSvgD(eval1000.nodes[0].points, true) : '';
      expect(d0.length).toBeGreaterThan(10);
      expect(d500).not.toBe(d0);
      expect(d500).not.toBe(d1000);
    });
  });

  describe('4. Export & Runtime Parity (SVG/Video Frames, Live Preview HTML5, JSON, CSS, React, Parity Matrix)', () => {
    it('produces real interpolated frame SVGs, Live Preview/HTML5 morph runtime, JSON metadata, and honest CSS/React notes', () => {
      const project = createInitialProject('Morph Export Parity');
      const page = getActivePage(project);
      const circle = {
        ...createEllipseNode(0),
        id: 'export-circle',
        x: 50,
        y: 50,
        width: 120,
        height: 120,
      };
      page.document.nodes = [circle];

      const clip = createAnimationClip({
        id: 'clip-export-morph',
        pageId: page.id,
        name: 'Export Morph',
        durationMs: 1000,
        autoplay: true,
        loop: true,
        tracks: [
          {
            id: 'trk-export-morph',
            targetNodeId: circle.id,
            property: 'pathMorph',
            keyframes: [
              { id: 'em-0', timeMs: 0, value: createMorphPresetSnapshot('circle', 120, 120), easing: 'linear' },
              { id: 'em-1', timeMs: 1000, value: createMorphPresetSnapshot('rounded-rect', 120, 120), easing: 'ease-in-out' },
            ],
          },
        ],
      });
      project.animations = [clip];

      // 1. Frame rasterization pipeline (shared by MP4, MOV, WebM, GIF, PNG Sequence ZIP)
      const svg0 = serializeDocumentToSvgString(
        applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 0)),
        project.components,
      );
      const svgMid = serializeDocumentToSvgString(
        applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 500)),
        project.components,
      );
      const svgEnd = serializeDocumentToSvgString(
        applyAnimatedPosesToDocument(page.document, evaluateClipAtTime(clip, 1000)),
        project.components,
      );
      expect(svg0).toContain('<path ');
      expect(svgMid).toContain('<path ');
      expect(svgMid).not.toBe(svg0);
      expect(svgMid).not.toBe(svgEnd);

      // 2. Motion JSON export preserves morph keyframes + morphSummary
      const motionJson = JSON.parse(buildMotionClipJson(project, page, clip)) as {
        morphSummary: { trackCount: number; targetNodeIds: string[] };
        clip: { tracks: Array<{ property: string }> };
      };
      expect(motionJson.morphSummary.trackCount).toBe(1);
      expect(motionJson.morphSummary.targetNodeIds).toEqual(['export-circle']);
      expect(motionJson.clip.tracks[0].property).toBe('pathMorph');

      // 3. Live Preview & HTML5 standalone export renders SVG morph path + CSP-safe zero-eval morph script
      const morphScript = buildLivePreviewMorphScript(project, page);
      expect(morphScript).toContain('export-circle');
      expect(morphScript).toContain('prefers-reduced-motion');
      expect(morphScript).not.toContain('eval(');
      expect(morphScript).not.toContain('new Function');

      const previewHtml = buildLivePreviewHtml(project, { pageId: page.id });
      expect(previewHtml).toContain('data-folio-morph-path="true"');
      expect(previewHtml).toContain('data-folio-id="export-circle"');
      expect(previewHtml).toContain('prefers-reduced-motion');

      // 4. CSS export declares pure-CSS Shape Morph limitation honestly
      const css = compilePageAnimationsCss(project, page);
      expect(css).toContain('Shape Morph (`pathMorph`)');

      // 5. React TSX export emits full useFolioShapeMorph runtime hook + inline SVG morph target
      const reactFiles = compileReactProjectFiles(project);
      const morphHookFile = reactFiles.find((f) => f.path === 'src/motion/useFolioShapeMorph.ts');
      expect(morphHookFile).toBeDefined();
      expect(morphHookFile!.content).toContain('export function useFolioShapeMorph');
      expect(morphHookFile!.content).toContain('prefers-reduced-motion');
      expect(morphHookFile!.content).not.toContain('eval(');

      const pageTsx = reactFiles.find((f) => f.path.endsWith('.tsx') && f.path.startsWith('src/pages/'));
      expect(pageTsx).toBeDefined();
      expect(pageTsx!.content).toContain('useFolioShapeMorph(FOLIO_MORPH_CLIPS)');
      expect(pageTsx!.content).toContain('data-folio-morph-path="true"');

      // 6. Parity matrix declares full motion.shape-morph across all 3 runtimes
      const morphParity = RUNTIME_FEATURE_PARITY_MATRIX.find((e) => e.feature === 'motion.shape-morph');
      expect(morphParity).toBeDefined();
      expect(morphParity!.headless).toBe('full');
      expect(morphParity!.livePreview).toBe('full');
      expect(morphParity!.reactCodegen).toBe('full');
    });
  });

  describe('5. Performance & Caching Guarantees', () => {
    it('caches PreparedMorphPair across 200 playback frames with zero per-frame normalization and bounded cache size', () => {
      clearMorphPairCache();
      const project = createInitialProject('Morph Perf');
      const page = getActivePage(project);
      const circle = { ...createEllipseNode(0), id: 'perf-shape', x: 0, y: 0, width: 120, height: 120 };
      page.document.nodes = [circle];

      const clip = createAnimationClip({
        id: 'clip-perf',
        pageId: page.id,
        name: 'Perf Cycle',
        durationMs: 2000,
        tracks: [
          {
            id: 'trk-perf',
            targetNodeId: circle.id,
            property: 'pathMorph',
            keyframes: [
              { id: 'p0', timeMs: 0, value: createMorphPresetSnapshot('circle', 120, 120), easing: 'linear' },
              { id: 'p1', timeMs: 500, value: createMorphPresetSnapshot('rounded-rect', 120, 120), easing: 'ease-in-out' },
              { id: 'p2', timeMs: 1000, value: createMorphPresetSnapshot('triangle', 120, 120), easing: 'ease-in-out' },
              { id: 'p3', timeMs: 1500, value: createMorphPresetSnapshot('arrow', 120, 120), easing: 'ease-in-out' },
              { id: 'p4', timeMs: 2000, value: createMorphPresetSnapshot('circle', 120, 120), easing: 'ease-in-out' },
            ],
          },
        ],
      });

      const frames = 200;
      const start = performance.now();
      for (let f = 0; f < frames; f += 1) {
        const t = (f / frames) * 2000;
        const poses = evaluateClipAtTime(clip, t);
        const doc = applyAnimatedPosesToDocument(page.document, poses);
        expect(doc.nodes[0].id).toBe('perf-shape');
      }
      const elapsedMs = performance.now() - start;
      const stats = getMorphCacheStats();

      // Only 4 unique adjacent keyframe pairs exist -> at most 4 cache misses across all 200 frames!
      expect(stats.misses).toBeLessThanOrEqual(4);
      expect(stats.hits).toBeGreaterThanOrEqual(190);
      expect(elapsedMs / frames).toBeLessThan(2);

      // Verify bounded LRU eviction never exceeds MAX_PREPARED_MORPH_CACHE
      const base = createMorphPresetSnapshot('circle', 100, 100);
      for (let i = 0; i < MAX_PREPARED_MORPH_CACHE + 25; i += 1) {
        const custom = serializePathMorphSnapshot({
          closed: true,
          points: [
            { id: 'a', x: 50, y: i * 0.1, pointType: 'corner' },
            { id: 'b', x: 100, y: 100, pointType: 'corner' },
            { id: 'c', x: 0, y: 100, pointType: 'corner' },
          ],
        });
        prepareMorphPair(base, custom);
      }
      expect(getMorphCacheStats().size).toBeLessThanOrEqual(MAX_PREPARED_MORPH_CACHE);
    });
  });
});
