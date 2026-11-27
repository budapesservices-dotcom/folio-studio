import { describe, expect, it } from 'vitest';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { buildComponentDefinitionFromNodes } from '../src/core/document/components';
import {
  createMorphPresetSnapshot,
  parsePathMorphSnapshot,
} from '../src/core/document/pathMorph';
import {
  applyAnimatedPosesToDocument,
  createAnimationClip,
  evaluateClipAtTime,
  extractMorphSequenceFromComponent,
  inspectComponentMorphSource,
  upsertKeyframeInClip,
} from '../src/engines/animation';
import { buildLivePreviewHtml } from '../src/engines/codegen/htmlCssCompiler';
import type {
  AnimationClip,
  ComponentDefinition,
  FolioProjectV2,
  PathNode,
  VectorAnchorPoint,
  VectorSubpath,
} from '../src/core/document/types';

function makePathNode(
  id: string,
  name: string,
  width: number,
  height: number,
  points: VectorAnchorPoint[],
  options: { closed: boolean; fill?: string; subpaths?: VectorSubpath[] },
): PathNode {
  return {
    id,
    type: 'path',
    name,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: options.fill ?? '#f59e0b',
      stroke: '#111827',
      strokeWidth: 0,
    },
    closed: options.closed,
    points,
    ...(options.subpaths ? { subpaths: options.subpaths } : {}),
  };
}

function makeStaticStarComponent(): ComponentDefinition {
  const starPath = makePathNode(
    'comp-star-path',
    'Star Shape',
    100,
    100,
    [
      { id: 'p0', x: 50, y: 0, pointType: 'corner' },
      { id: 'p1', x: 63, y: 36, pointType: 'corner' },
      { id: 'p2', x: 100, y: 38, pointType: 'corner' },
      { id: 'p3', x: 70, y: 62, pointType: 'corner' },
      { id: 'p4', x: 80, y: 100, pointType: 'corner' },
      { id: 'p5', x: 50, y: 78, pointType: 'corner' },
      { id: 'p6', x: 20, y: 100, pointType: 'corner' },
      { id: 'p7', x: 30, y: 62, pointType: 'corner' },
      { id: 'p8', x: 0, y: 38, pointType: 'corner' },
      { id: 'p9', x: 37, y: 36, pointType: 'corner' },
    ],
    { closed: true, fill: '#f59e0b' },
  );
  return {
    ...buildComponentDefinitionFromNodes([starPath], [starPath.id], 'Star Badge')!,
    name: 'Star Badge',
  };
}

function makeAnimatedMorphComponent(): ComponentDefinition {
  const baseCircle = {
    ...createEllipseNode(0),
    id: 'comp-morph-circle',
    name: 'Morph Orb',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fill: '#7c6ff7',
  };
  const base = {
    ...buildComponentDefinitionFromNodes([baseCircle], [baseCircle.id], 'Orb Morph')!,
    name: 'Orb Morph',
  };
  const localNode = base.document.nodes[0];
  const clip: AnimationClip = {
    id: 'clip-comp-morph',
    name: 'Orb Cycle',
    pageId: 'component-master',
    durationMs: 800,
    loop: true,
    autoplay: true,
    tracks: [
      {
        id: 'track-comp-morph',
        targetNodeId: localNode.id,
        property: 'pathMorph',
        keyframes: [
          {
            id: 'kf-0',
            timeMs: 0,
            value: createMorphPresetSnapshot('circle', 100, 100),
            easing: 'linear',
          },
          {
            id: 'kf-1',
            timeMs: 400,
            value: createMorphPresetSnapshot('triangle', 100, 100),
            easing: 'ease-in-out',
          },
          {
            id: 'kf-2',
            timeMs: 800,
            value: createMorphPresetSnapshot('arrow', 100, 100),
            easing: 'ease-out',
          },
        ],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, animations: [clip] };
}

function makeAnimatedSvgTransformComponent(): ComponentDefinition {
  const rect = {
    ...createRectNode(0),
    id: 'comp-pulse-rect',
    name: 'Pulse Tile',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    radius: 4,
    rotation: 0,
    fill: '#38bdf8',
  };
  const base = buildComponentDefinitionFromNodes([rect], [rect.id], 'Pulse Tile')!;
  const localNode = base.document.nodes[0];
  const clip: AnimationClip = {
    id: 'clip-comp-pulse',
    name: 'Pulse & Spin',
    pageId: 'component-master',
    durationMs: 1000,
    loop: true,
    autoplay: true,
    tracks: [
      {
        id: 'tr-radius',
        targetNodeId: localNode.id,
        property: 'radius',
        keyframes: [
          { id: 'k-r0', timeMs: 0, value: 4, easing: 'linear' },
          { id: 'k-r1', timeMs: 500, value: 48, easing: 'ease-in-out' },
          { id: 'k-r2', timeMs: 1000, value: 20, easing: 'ease-out' },
        ],
      },
      {
        id: 'tr-rot',
        targetNodeId: localNode.id,
        property: 'rotation',
        keyframes: [
          { id: 'k-rot0', timeMs: 0, value: 0, easing: 'linear' },
          { id: 'k-rot1', timeMs: 1000, value: 45, easing: 'ease-out' },
        ],
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, animations: [clip] };
}

describe('Native Shape Morph — Import From Component & Animated SVG', () => {
  it('extracts a static closed vector component scaled cleanly to the target object box', () => {
    const comp = makeStaticStarComponent();
    const info = inspectComponentMorphSource(comp);
    expect(info.supported).toBe(true);
    expect(info.isAnimated).toBe(false);
    expect(info.sourceKind).toBe('static');
    expect(info.keyframeCount).toBe(1);

    const imported = extractMorphSequenceFromComponent(comp, 240, 180);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.sourceKind).toBe('static');
    expect(imported.keyframes).toHaveLength(1);
    expect(imported.keyframes[0].offsetMs).toBe(0);

    const parsed = parsePathMorphSnapshot(imported.keyframes[0].value);
    expect(parsed).not.toBeNull();
    expect(parsed!.closed).toBe(true);
    expect(parsed!.points).toHaveLength(10);
    expect(parsed!.w).toBe(240);
    expect(parsed!.h).toBe(180);
    expect(parsed!.label).toBe('Star Badge');
    // Top point of star (50, 0) in 100x100 -> (120, 0) in 240x180
    expect(parsed!.points[0].x).toBeCloseTo(120, 1);
    expect(parsed!.points[0].y).toBeCloseTo(0, 1);
    // Right wing (100, 38) in 100x100 -> (240, 68.4) in 240x180
    expect(parsed!.points[2].x).toBeCloseTo(240, 1);
    expect(parsed!.points[2].y).toBeCloseTo(68.4, 1);
  });

  it('imports all animated SVG pathMorph keyframes from an animated morph component and compiles into Live Preview on one nodeId', () => {
    const comp = makeAnimatedMorphComponent();
    const info = inspectComponentMorphSource(comp);
    expect(info.supported).toBe(true);
    expect(info.isAnimated).toBe(true);
    expect(info.sourceKind).toBe('animated-morph');
    expect(info.keyframeCount).toBe(3);
    expect(info.durationMs).toBe(800);

    const targetNode = {
      ...createRectNode(0),
      id: 'hero-target-shape',
      name: 'Hero Shape',
      x: 40,
      y: 40,
      width: 200,
      height: 160,
      radius: 16,
      fill: '#22c55e',
    };

    const imported = extractMorphSequenceFromComponent(comp, targetNode.width, targetNode.height);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.sourceKind).toBe('animated-morph');
    expect(imported.keyframes).toHaveLength(3);
    expect(imported.keyframes.map((k) => k.offsetMs)).toEqual([0, 400, 800]);
    expect(imported.keyframes[1].easing).toBe('ease-in-out');
    expect(imported.keyframes[2].easing).toBe('ease-out');

    // Verify scaling to target 200x160 box
    const kf1Snap = parsePathMorphSnapshot(imported.keyframes[1].value);
    expect(kf1Snap?.w).toBe(200);
    expect(kf1Snap?.h).toBe(160);
    expect(kf1Snap?.label).toContain('Orb Morph');

    const baseProject = createInitialProject();
    const basePage = baseProject.pages[0];

    // Apply imported keyframes onto the single target node starting at 200ms
    let clip = createAnimationClip({
      pageId: basePage.id,
      name: 'Main Morph',
      durationMs: 1200,
      autoplay: true,
      loop: true,
    });
    clip = {
      ...clip,
      tracks: [
        {
          id: 'tr-target-morph',
          targetNodeId: targetNode.id,
          property: 'pathMorph',
          keyframes: [],
        },
      ],
    };
    for (const kf of imported.keyframes) {
      clip = upsertKeyframeInClip(clip, 'tr-target-morph', 200 + kf.offsetMs, kf.value, kf.easing).clip;
    }

    const page = {
      ...basePage,
      document: {
        ...basePage.document,
        nodes: [targetNode],
      },
    };

    // Mid-morph evaluation at 400ms (halfway between 200ms Circle and 600ms Triangle)
    const poses = evaluateClipAtTime(clip, 400);
    const evalDoc = applyAnimatedPosesToDocument(page.document, poses);
    expect(evalDoc.nodes).toHaveLength(1);
    expect(evalDoc.nodes[0].id).toBe('hero-target-shape');
    expect(evalDoc.nodes[0].type).toBe('path');
    if (evalDoc.nodes[0].type === 'path') {
      expect(evalDoc.nodes[0].closed).toBe(true);
      expect(evalDoc.nodes[0].points.length).toBeGreaterThanOrEqual(4);
    }

    // Live Preview compilation includes pathMorph runtime for the single target nodeId
    const project: FolioProjectV2 = {
      ...baseProject,
      pages: [page],
      activePageId: page.id,
      components: [comp],
      animations: [clip],
    };
    const html = buildLivePreviewHtml(project, { pageId: page.id });
    expect(html).toContain('hero-target-shape');
    expect(html).toContain('data-folio-morph-path');
    expect(html).toContain('buildPathD');
  });

  it('samples animated non-morph SVG components (radius + rotation) at exact timestamps without modulo wrapping the final keyframe', () => {
    const comp = makeAnimatedSvgTransformComponent();
    const info = inspectComponentMorphSource(comp);
    expect(info.supported).toBe(true);
    expect(info.isAnimated).toBe(true);
    expect(info.sourceKind).toBe('animated-svg');
    expect(info.keyframeCount).toBe(3);
    expect(info.durationMs).toBe(1000);

    const imported = extractMorphSequenceFromComponent(comp, 160, 160);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.sourceKind).toBe('animated-svg');
    expect(imported.keyframes).toHaveLength(3);
    expect(imported.keyframes.map((k) => k.offsetMs)).toEqual([0, 500, 1000]);

    const snap0 = parsePathMorphSnapshot(imported.keyframes[0].value)!;
    const snap500 = parsePathMorphSnapshot(imported.keyframes[1].value)!;
    const snap1000 = parsePathMorphSnapshot(imported.keyframes[2].value)!;

    // Keyframe 0 (0 deg) vs Keyframe 2 (45 deg at 1000ms) must differ (proving 1000ms was NOT wrapped to 0ms!)
    const firstDiffersFromLast = snap0.points.some((pt, i) => {
      const other = snap1000.points[i];
      return !other || Math.abs(pt.x - other.x) > 2 || Math.abs(pt.y - other.y) > 2;
    });
    expect(firstDiffersFromLast).toBe(true);

    // Keyframe 1 (radius 48) also differs from Keyframe 0 (radius 4)
    const firstDiffersFromMid = snap0.points.some((pt, i) => {
      const other = snap500.points[i];
      return !other || Math.abs(pt.x - other.x) > 2 || Math.abs(pt.y - other.y) > 2;
    });
    expect(firstDiffersFromMid).toBe(true);
  });

  it('supports closed compound multi-contour components and rejects text-only or open-path components cleanly', () => {
    const textNode = {
      ...createTextNode(0),
      id: 't1',
      name: 'Heading',
      x: 0,
      y: 0,
      width: 120,
      height: 32,
      text: 'Hello',
    };
    const textOnly = buildComponentDefinitionFromNodes([textNode], [textNode.id], 'Label Only')!;

    const openNode = makePathNode(
      'p-open',
      'Wave',
      100,
      40,
      [
        { id: 'a', x: 0, y: 20, pointType: 'corner' },
        { id: 'b', x: 50, y: 0, pointType: 'corner' },
        { id: 'c', x: 100, y: 20, pointType: 'corner' },
      ],
      { closed: false },
    );
    const openPath = buildComponentDefinitionFromNodes([openNode], [openNode.id], 'Open Stroke')!;

    const compoundNode = makePathNode(
      'p-donut',
      'Donut',
      100,
      100,
      [
        { id: 'o0', x: 0, y: 0, pointType: 'corner' },
        { id: 'o1', x: 100, y: 0, pointType: 'corner' },
        { id: 'o2', x: 100, y: 100, pointType: 'corner' },
        { id: 'o3', x: 0, y: 100, pointType: 'corner' },
      ],
      {
        closed: true,
        subpaths: [
          {
            closed: true,
            points: [
              { id: 'i0', x: 30, y: 30, pointType: 'corner' },
              { id: 'i1', x: 70, y: 30, pointType: 'corner' },
              { id: 'i2', x: 70, y: 70, pointType: 'corner' },
            ],
          },
        ],
      },
    );
    const compoundPath = buildComponentDefinitionFromNodes([compoundNode], [compoundNode.id], 'Donut Hole')!;

    expect(inspectComponentMorphSource(textOnly).supported).toBe(false);
    expect(extractMorphSequenceFromComponent(textOnly, 120, 120).ok).toBe(false);

    expect(inspectComponentMorphSource(openPath).supported).toBe(false);
    const openRes = extractMorphSequenceFromComponent(openPath, 120, 120);
    expect(openRes.ok).toBe(false);
    if (!openRes.ok) expect(openRes.message.toLowerCase()).toContain('open');

    // Phase 3: closed compound multi-contour shapes with holes are supported!
    expect(inspectComponentMorphSource(compoundPath).supported).toBe(true);
    const compoundRes = extractMorphSequenceFromComponent(compoundPath, 120, 120);
    expect(compoundRes.ok).toBe(true);
    if (compoundRes.ok) {
      expect(compoundRes.keyframes.length).toBeGreaterThanOrEqual(1);
      const parsed = parsePathMorphSnapshot(compoundRes.keyframes[0].value);
      expect(parsed?.subpaths?.length).toBe(1);
    }
  });
});
