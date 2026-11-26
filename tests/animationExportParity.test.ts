import { describe, expect, it } from 'vitest';
import {
  applyAnimatedPosesToDocument,
  createAnimationClip,
  evaluateClipAtTime,
} from '../src/engines/animation/evaluator';
import { evaluateEasing } from '../src/engines/animation/easing';
import {
  buildNodeSvgSmilAnimations,
  buildSvgPathMorphSmil,
} from '../src/engines/animation/svgExport';
import {
  buildLivePreviewMorphScript,
  compilePageAnimationsCss,
} from '../src/engines/animation/codegen';
import { exportMotionAnimation } from '../src/engines/animation/videoExport';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { buildLivePreviewHtml } from '../src/engines/codegen/htmlCssCompiler';
import { getActivePage } from '../src/core/document/project';
import { createInitialProject } from '../src/core/document/factory';
import {
  createMorphPresetSnapshot,
  extractMorphSnapshotFromNode,
} from '../src/core/document/pathMorph';
import { createDefaultLinearGradientFill, createDefaultVisualEffect } from '../src/core/document/styling';
import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  EllipseNode,
  FolioProject,
  FrameNode,
  GroupNode,
  PathNode,
  RectNode,
} from '../src/core/document/types';

function makeRect(overrides: Partial<RectNode> & { id: string; x: number; y: number; width: number; height: number }): RectNode {
  return {
    name: 'Rect',
    type: 'rect',
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: { fill: '#6366F1', stroke: 'none', strokeWidth: 0, radius: 0 },
    ...overrides,
  };
}

function makeEllipse(overrides: Partial<EllipseNode> & { id: string; x: number; y: number; width: number; height: number }): EllipseNode {
  return {
    name: 'Ellipse',
    type: 'ellipse',
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    style: { fill: '#6366F1', stroke: 'none', strokeWidth: 0 },
    ...overrides,
  };
}

function makeFrame(overrides: Partial<FrameNode> & { id: string; x: number; y: number; width: number; height: number }): FrameNode {
  return {
    name: 'Frame',
    type: 'frame',
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    clipContent: false,
    style: { fill: '#ffffff', stroke: 'none', strokeWidth: 0, radius: 0 },
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupNode> & { id: string; x: number; y: number; width: number; height: number }): GroupNode {
  return {
    name: 'Group',
    type: 'group',
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    ...overrides,
  };
}

function makePath(overrides: Partial<PathNode> & { id: string; x: number; y: number; width: number; height: number; points: PathNode['points'] }): PathNode {
  return {
    name: 'Path',
    type: 'path',
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    closed: true,
    pathKind: 'pen',
    style: {
      fill: '#ef4444',
      stroke: 'none',
      strokeWidth: 0,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fillRule: 'nonzero',
    },
    ...overrides,
  };
}

function addKf(
  clip: AnimationClip,
  targetNodeId: string,
  property: AnimatableProperty,
  timeMs: number,
  value: number | string,
  easing: AnimationEasing = 'ease-out',
): AnimationClip {
  const existing = clip.tracks.find((t) => t.targetNodeId === targetNodeId && t.property === property);
  const kf = { id: `kf-${targetNodeId}-${property}-${timeMs}`, timeMs, value, easing };
  if (existing) {
    return {
      ...clip,
      tracks: clip.tracks.map((t) =>
        t.id === existing.id
          ? { ...t, keyframes: [...t.keyframes, kf].sort((a, b) => a.timeMs - b.timeMs) }
          : t,
      ),
    };
  }
  return {
    ...clip,
    tracks: [
      ...clip.tracks,
      {
        id: `tr-${targetNodeId}-${property}`,
        targetNodeId,
        property,
        keyframes: [kf],
      },
    ],
  };
}

function parseCubicCommands(d: string): Array<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}> {
  const out: Array<{ x1: number; y1: number; x2: number; y2: number; x: number; y: number }> = [];
  const regex = /C\s*([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(d)) !== null) {
    out.push({
      x1: Number(match[1]),
      y1: Number(match[2]),
      x2: Number(match[3]),
      y2: Number(match[4]),
      x: Number(match[5]),
      y: Number(match[6]),
    });
  }
  return out;
}

function getPathBounds(d: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const moveMatch = /M\s*([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)/.exec(d);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (moveMatch) {
    const mx = Number(moveMatch[1]);
    const my = Number(moveMatch[2]);
    minX = Math.min(minX, mx);
    maxX = Math.max(maxX, mx);
    minY = Math.min(minY, my);
    maxY = Math.max(maxY, my);
  }
  for (const cmd of parseCubicCommands(d)) {
    for (const [px, py] of [
      [cmd.x1, cmd.y1],
      [cmd.x2, cmd.y2],
      [cmd.x, cmd.y],
    ]) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  return { minX, maxX, minY, maxY };
}

describe('Animation Parity across Canvas, Video, Live Preview, HTML5, and Animated SVG', () => {
  it('SVG SMIL morph never collapses straight-segment handles to node top-left (0, 0)', () => {
    const node = makeEllipse({
      id: 'morph-shape-1',
      name: 'Morph Shape',
      x: 180,
      y: 120,
      width: 160,
      height: 160,
    });

    const circleSnap = createMorphPresetSnapshot('circle', 160, 160);
    const squareSnap = createMorphPresetSnapshot('square', 160, 160);
    const triangleSnap = createMorphPresetSnapshot('triangle', 160, 160);

    let clip = createAnimationClip({
      id: 'clip-straight-morph',
      name: 'Straight Segment Morph',
      pageId: 'page-1',
      durationMs: 1200,
      loop: true,
      autoplay: true,
    });
    clip = addKf(clip, node.id, 'pathMorph', 0, circleSnap, 'linear');
    clip = addKf(clip, node.id, 'pathMorph', 600, squareSnap, 'ease-in-out');
    clip = addKf(clip, node.id, 'pathMorph', 1200, triangleSnap, 'ease-out');

    const morphTrack = clip.tracks.find((t) => t.property === 'pathMorph')!;
    const smil = buildSvgPathMorphSmil(morphTrack, clip, node.x, node.y);
    expect(smil).not.toBeNull();

    const valuesMatch = /values="([^"]+)"/.exec(smil!.animateMarkup);
    expect(valuesMatch).not.toBeNull();
    const frames = valuesMatch![1].split(';');
    expect(frames.length).toBeGreaterThanOrEqual(4);

    // Every frame must have identical cubic segment count and ZERO collapsed handles
    const expectedSegCount = parseCubicCommands(frames[0]).length;
    expect(expectedSegCount).toBeGreaterThanOrEqual(4);

    for (const frameD of frames) {
      const cmds = parseCubicCommands(frameD);
      expect(cmds.length).toBe(expectedSegCount);

      const bounds = getPathBounds(frameD);
      expect(bounds.minX).toBeGreaterThanOrEqual(node.x - 1);
      expect(bounds.maxX).toBeLessThanOrEqual(node.x + node.width + 1);
      expect(bounds.minY).toBeGreaterThanOrEqual(node.y - 1);
      expect(bounds.maxY).toBeLessThanOrEqual(node.y + node.height + 1);

      // Specifically verify on the Triangle frame (bottom edge at y=280, apex at x=260,y=120)
      // NO control point snaps to (node.x, node.y) = (180, 120)!
      const isTriangleFrame = frameD === frames[frames.length - 1];
      if (isTriangleFrame) {
        const collapsedToOrigin = cmds.filter(
          (c) =>
            (Math.abs(c.x1 - node.x) < 0.5 && Math.abs(c.y1 - node.y) < 0.5) ||
            (Math.abs(c.x2 - node.x) < 0.5 && Math.abs(c.y2 - node.y) < 0.5),
        );
        expect(collapsedToOrigin.length).toBe(0);
      }
    }
  });

  it('SVG SMIL multi-keyframe (4+ shapes) morph keeps coupled segment alignment and monotonic keyTimes', () => {
    const node = makeEllipse({
      id: 'morph-multi',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });

    const snaps = [
      createMorphPresetSnapshot('circle', 200, 200),
      createMorphPresetSnapshot('square', 200, 200),
      createMorphPresetSnapshot('triangle', 200, 200),
      createMorphPresetSnapshot('star', 200, 200),
      createMorphPresetSnapshot('circle', 200, 200),
    ];

    let clip = createAnimationClip({
      id: 'clip-multi-morph',
      name: 'Multi Morph',
      pageId: 'page-1',
      durationMs: 2000,
      loop: true,
      autoplay: true,
    });
    snaps.forEach((snap, idx) => {
      clip = addKf(clip, node.id, 'pathMorph', idx * 500, snap, 'ease-in-out');
    });

    const morphTrack = clip.tracks.find((t) => t.property === 'pathMorph')!;
    const smil = buildSvgPathMorphSmil(morphTrack, clip, node.x, node.y);
    expect(smil).not.toBeNull();

    const values = /values="([^"]+)"/.exec(smil!.animateMarkup)![1].split(';');
    const keyTimes = /keyTimes="([^"]+)"/.exec(smil!.animateMarkup)![1].split(';').map(Number);

    expect(values.length).toBe(keyTimes.length);
    expect(keyTimes[0]).toBe(0);
    expect(keyTimes[keyTimes.length - 1]).toBe(1);
    for (let i = 1; i < keyTimes.length; i += 1) {
      expect(keyTimes[i]).toBeGreaterThanOrEqual(keyTimes[i - 1]);
    }

    const segCount = parseCubicCommands(values[0]).length;
    expect(segCount).toBeGreaterThanOrEqual(10); // Star has 10 vertices
    for (const d of values) {
      expect(parseCubicCommands(d).length).toBe(segCount);
      const b = getPathBounds(d);
      expect(b.maxX - b.minX).toBeGreaterThan(100);
      expect(b.maxY - b.minY).toBeGreaterThan(100);
    }
  });

  it('SVG SMIL clamps keySplines to [0, 1] and samples overshoot/spring/bounce/elastic/multi-point easings faithfully', () => {
    const project = createInitialProject('SMIL Easing Parity');
    const page = getActivePage(project);
    const box = makeRect({ id: 'spring-box', x: 100, y: 100, width: 120, height: 120 });
    const morphShape = makeEllipse({ id: 'bounce-morph', x: 300, y: 100, width: 140, height: 140 });
    page.document.nodes = [box, morphShape];

    const multiPointEasing: AnimationEasing = {
      type: 'multi-point',
      points: [
        { x: 0, y: 0 },
        { x: 0.4, y: 1.25 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ],
    };

    let clip = createAnimationClip({
      id: 'clip-overshoot',
      name: 'Overshoot Easings',
      pageId: page.id,
      durationMs: 1000,
      loop: true,
      autoplay: true,
    });
    clip = addKf(clip, box.id, 'x', 0, 100, 'linear');
    clip = addKf(clip, box.id, 'x', 1000, 300, 'spring');
    clip = addKf(clip, box.id, 'scale', 0, 1, 'linear');
    clip = addKf(clip, box.id, 'scale', 1000, 1.5, multiPointEasing);
    clip = addKf(
      clip,
      morphShape.id,
      'pathMorph',
      0,
      createMorphPresetSnapshot('circle', 140, 140),
      'linear',
    );
    clip = addKf(
      clip,
      morphShape.id,
      'pathMorph',
      1000,
      createMorphPresetSnapshot('star', 140, 140),
      'elastic-out',
    );

    const svg = serializeDocumentToSvgString(page.document, [], {
      embedAnimations: true,
      activeClip: clip,
    });

    // Assert ZERO out-of-range keySplines coordinates in the entire SVG!
    const splineRegex = /keySplines="([^"]+)"/g;
    let splineMatch: RegExpExecArray | null;
    while ((splineMatch = splineRegex.exec(svg)) !== null) {
      const segments = splineMatch[1].split(';');
      for (const seg of segments) {
        const nums = seg.trim().split(/\s+/).map(Number);
        expect(nums.length).toBe(4);
        for (const n of nums) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(1);
        }
      }
    }

    // Spring translate must actually overshoot past dx = 200 before settling!
    const translateMatch = /<animateTransform[^>]*type="translate"[^>]*values="([^"]+)"/.exec(svg);
    expect(translateMatch).not.toBeNull();
    const dxValues = translateMatch![1].split(';').map((pair) => Number(pair.trim().split(/\s+/)[0]));
    expect(dxValues.length).toBeGreaterThan(10);
    expect(Math.max(...dxValues)).toBeGreaterThan(202);
    expect(Math.abs(dxValues[dxValues.length - 1] - 200)).toBeLessThan(0.5);
  });

  it('SVG SMIL handles static rotation + translate, non-rect resize, and animated parent group inheritance', () => {
    const project = createInitialProject('SVG Transform & Parent Parity');
    const page = getActivePage(project);

    const rotatedRect = makeRect({
      id: 'rot-rect',
      x: 100,
      y: 100,
      width: 100,
      height: 60,
      rotation: 45,
    });
    const growingEllipse = makeEllipse({
      id: 'grow-ellipse',
      x: 300,
      y: 100,
      width: 100,
      height: 100,
    });
    const parentGroup = makeGroup({
      id: 'anim-group',
      x: 50,
      y: 260,
      width: 160,
      height: 100,
    });
    const unkeyedChild = makeRect({
      id: 'child-in-group',
      parentId: parentGroup.id,
      x: 70,
      y: 280,
      width: 120,
      height: 60,
    });

    page.document.nodes = [rotatedRect, growingEllipse, parentGroup, unkeyedChild];

    let clip = createAnimationClip({
      id: 'clip-transforms',
      name: 'Transforms',
      pageId: page.id,
      durationMs: 1000,
      loop: true,
      autoplay: true,
    });
    clip = addKf(clip, rotatedRect.id, 'x', 0, 100, 'linear');
    clip = addKf(clip, rotatedRect.id, 'x', 1000, 250, 'ease-out');
    clip = addKf(clip, growingEllipse.id, 'width', 0, 100, 'linear');
    clip = addKf(clip, growingEllipse.id, 'width', 1000, 200, 'ease-in-out');
    clip = addKf(clip, parentGroup.id, 'x', 0, 50, 'linear');
    clip = addKf(clip, parentGroup.id, 'x', 1000, 200, 'ease-out');
    clip = addKf(clip, parentGroup.id, 'opacity', 0, 1, 'linear');
    clip = addKf(clip, parentGroup.id, 'opacity', 1000, 0.3, 'linear');

    const rotSmil = buildNodeSvgSmilAnimations(rotatedRect, clip, page.document.nodes);
    expect(rotSmil).not.toBeNull();
    expect(rotSmil!.replacesStaticTransform).toBe(true);
    expect(rotSmil!.wrapperSmilMarkup).toContain('type="translate"');
    expect(rotSmil!.wrapperSmilMarkup).toContain('type="rotate"');

    const ellipseSmil = buildNodeSvgSmilAnimations(growingEllipse, clip, page.document.nodes);
    expect(ellipseSmil).not.toBeNull();
    expect(ellipseSmil!.wrapperSmilMarkup).toContain('type="scale"');
    expect(ellipseSmil!.shapeSmilMarkup).not.toContain('attributeName="width"');

    const childSmil = buildNodeSvgSmilAnimations(unkeyedChild, clip, page.document.nodes);
    expect(childSmil).not.toBeNull();
    expect(childSmil!.wrapperSmilMarkup.length).toBeGreaterThan(0);
    expect(childSmil!.wrapperSmilMarkup).toContain('type="translate"');
    expect(childSmil!.wrapperSmilMarkup).toContain('attributeName="opacity"');

    const svg = serializeDocumentToSvgString(page.document, [], {
      embedAnimations: true,
      activeClip: clip,
    });
    expect(svg).toContain('<rect x="70" y="280" width="120" height="60"');
    // Static transform must not collide on the same <g> when replacesStaticTransform is true
    expect(svg).not.toMatch(/<g transform="rotate\(45[^"]*"><animateTransform[^>]*type="translate"/);
  });

  it('Live Preview CSS eliminates multi-track double-easing and uses solved Auto-Layout baselines', () => {
    const project = createInitialProject('CSS Multi-track & Auto-Layout Parity');
    const page = getActivePage(project);

    const autoFrame = makeFrame({
      id: 'al-frame',
      x: 40,
      y: 40,
      width: 400,
      height: 160,
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 20,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        justifyContent: 'start',
        alignItems: 'start',
      },
    });
    // Raw AST x=0 is stale; Auto-Layout solves it to x = 40 + 24 = 64
    const childBox = makeRect({
      id: 'al-child',
      parentId: autoFrame.id,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
    page.document.nodes = [autoFrame, childBox];

    let clip: AnimationClip = createAnimationClip({
      id: 'clip-staggered',
      name: 'Staggered Multi-Track',
      pageId: page.id,
      durationMs: 1000,
      loop: false,
      autoplay: true,
    });
    // Track 1: x animates from solved x=64 to 164 with spring over 0..1000ms
    clip = addKf(clip, childBox.id, 'x', 0, 64, 'linear');
    clip = addKf(clip, childBox.id, 'x', 1000, 164, 'spring');
    // Track 2: opacity animates 0 -> 1 with ease-in over 0..300ms (staggered!)
    clip = addKf(clip, childBox.id, 'opacity', 0, 0, 'linear');
    clip = addKf(clip, childBox.id, 'opacity', 300, 1, 'ease-in');
    project.animations = [clip];

    const css = compilePageAnimationsCss(project, page);

    // Must switch to dense linear sampling so spring x and ease-in opacity do not double-ease!
    expect(css).toContain('1000ms linear 1 both');
    // Baseline dx at 0% must be 0 (not +64px from stale AST x=0!)
    expect(css).toMatch(/0%\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*none;/);
    // At 30% (300ms), opacity must already be 1 while x reflects spring(0.3)
    const expectedSpringDx = Math.round(evaluateEasing('spring', 0.3) * 100 * 100) / 100;
    const stop30Match = /30%\s*\{([^}]+)\}/.exec(css);
    expect(stop30Match).not.toBeNull();
    expect(stop30Match![1]).toContain('opacity: 1;');
    const txMatch = /translate\(([+-]?\d*\.?\d+)px,\s*0px\)/.exec(stop30Match![1]);
    expect(txMatch).not.toBeNull();
    expect(Math.abs(Number(txMatch![1]) - expectedSpringDx)).toBeLessThan(1.5);
  });

  it('Live Preview & HTML5 Export render gradient fills, vector drop-shadows, t=0 morph snapshot, exact easings, and autoplay for exported clips', async () => {
    const project = createInitialProject('Morph & HTML5 Parity');
    const page = getActivePage(project);

    const morphNode = makeEllipse({
      id: 'grad-morph',
      x: 120,
      y: 100,
      width: 160,
      height: 160,
      style: {
        fill: '#6366F1',
        fills: [createDefaultLinearGradientFill('grad-1')],
        stroke: '#ffffff',
        strokeWidth: 2,
      },
      effects: [createDefaultVisualEffect('drop-shadow', 'ds-1')],
    });
    page.document.nodes = [morphNode];

    const starSnap = createMorphPresetSnapshot('star', 160, 160);
    const circleSnap = extractMorphSnapshotFromNode(morphNode)!;

    let clip = createAnimationClip({
      id: 'clip-html5-morph',
      name: 'HTML5 Morph',
      pageId: page.id,
      durationMs: 1200,
      loop: false,
      autoplay: false, // Intentionally false to test HTML5 export forces playback of exported clip
    });
    clip = addKf(clip, morphNode.id, 'pathMorph', 0, starSnap, 'linear');
    clip = addKf(clip, morphNode.id, 'pathMorph', 1200, circleSnap, 'spring');
    clip = addKf(clip, morphNode.id, 'x', 0, 120, 'linear');
    clip = addKf(clip, morphNode.id, 'x', 1200, 260, 'spring');
    project.animations = [clip];

    // 1) Live Preview HTML when autoplay is enabled
    const autoplayProject: FolioProject = {
      ...project,
      animations: [{ ...clip, autoplay: true }],
    };
    const previewHtml = buildLivePreviewHtml(autoplayProject, { pageId: page.id });
    expect(previewHtml).toContain('<linearGradient');
    expect(previewHtml).toContain('fill="url(#');
    expect(previewHtml).toContain('filter: drop-shadow(');
    expect(previewHtml).not.toContain('box-shadow:');
    expect(previewHtml).toContain('getAnimations'); // CSS clock sync!

    const morphScript = buildLivePreviewMorphScript(autoplayProject, page);
    expect(morphScript).toContain('"spring"');
    expect(morphScript).toContain('bounce-out');
    expect(morphScript).toContain('elastic-out');

    // 2) Standalone HTML5 export via exportMotionAnimation activates non-autoplay clip & transparent bg
    const exported = await exportMotionAnimation(project, page, clip, {
      format: 'html5',
      resolution: 'canvas',
      fps: 60,
      quality: 'high',
      startMs: 0,
      endMs: 1200,
      loopCount: 0,
      transparentBackground: true,
    });
    expect(exported.format).toBe('html5');
    const exportedHtml = await exported.blob.text();
    expect(exportedHtml).toContain('"autoplay":true');
    expect(exportedHtml).toContain('"loop":true');
    expect(exportedHtml).toContain('background: transparent;');

    // Verify evaluator sanity at t=600ms matches Canvas/Video baseline
    const poses = evaluateClipAtTime(clip, 600);
    const evalDoc = applyAnimatedPosesToDocument(page.document, poses);
    const evalNode = evalDoc.nodes.find((n) => n.id === morphNode.id)!;
    expect(evalNode.type).toBe('path');
    expect(evalNode.x).toBeGreaterThan(200);
  });

  it('SVG export preserves animated solid fill on gradient-filled path nodes', () => {
    const project = createInitialProject('Gradient To Solid Fill SMIL');
    const page = getActivePage(project);
    const pathNode = makePath({
      id: 'grad-path',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      points: [
        { id: 'p0', x: 0, y: 0, pointType: 'corner' },
        { id: 'p1', x: 100, y: 0, pointType: 'corner' },
        { id: 'p2', x: 100, y: 100, pointType: 'corner' },
        { id: 'p3', x: 0, y: 100, pointType: 'corner' },
      ],
      style: {
        fill: '#ef4444',
        fills: [createDefaultLinearGradientFill('grad-fill')],
        stroke: 'none',
        strokeWidth: 0,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        fillRule: 'nonzero',
      },
    });
    page.document.nodes = [pathNode];

    let clip = createAnimationClip({
      id: 'clip-fill-anim',
      name: 'Fill Anim',
      pageId: page.id,
      durationMs: 1000,
      loop: true,
      autoplay: true,
    });
    clip = addKf(clip, pathNode.id, 'fill', 0, '#ef4444', 'linear');
    clip = addKf(clip, pathNode.id, 'fill', 1000, '#3b82f6', 'linear');

    const smil = buildNodeSvgSmilAnimations(pathNode, clip, page.document.nodes);
    expect(smil).not.toBeNull();
    expect(smil!.overridesStaticFill).toBe(true);
    expect(smil!.initialSolidFill).toBe('#ef4444');
    expect(smil!.shapeSmilMarkup).toContain('attributeName="fill"');

    const svg = serializeDocumentToSvgString(page.document, [], {
      embedAnimations: true,
      activeClip: clip,
    });
    expect(svg).toContain('fill="#ef4444"');
    expect(svg).toContain('attributeName="fill"');
  });
});
