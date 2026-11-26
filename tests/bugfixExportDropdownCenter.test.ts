import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { createMorphPresetSnapshot } from '../src/core/document/pathMorph';
import type {
  AnimationClip,
  ComponentDefinition,
  ComponentInstanceNode,
  EllipseNode,
  RectNode,
} from '../src/core/document/types';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import {
  buildNodeSvgSmilAnimations,
  buildSvgPathMorphSmil,
  documentHasAnyAnimations,
  getEffectivePageAnimationDurationMs,
} from '../src/engines/animation/svgExport';
import { MOTION_EXPORT_FORMATS, exportMotionAnimation } from '../src/engines/animation/videoExport';
import { computeCenteredComponentView } from '../src/app/workspace/canvasViewState';
import { clampContextMenuPosition } from '../src/app/workspace/StudioContextMenu';

function createAnimatedMorphComponent(): ComponentDefinition {
  const shape: EllipseNode = {
    id: 'comp-circle-1',
    type: 'ellipse',
    name: 'Morph Ball',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: '#38BDF8',
      stroke: '#0284C7',
      strokeWidth: 2,
    },
  };
  const circleSnap = createMorphPresetSnapshot('circle', 100, 100);
  const starSnap = createMorphPresetSnapshot('star', 100, 100);
  const clip: AnimationClip = {
    id: 'clip-comp-morph',
    name: 'Pulse Morph',
    pageId: 'page-component-master',
    durationMs: 1400,
    loop: true,
    autoplay: true,
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    tracks: [
      {
        id: 'trk-morph',
        targetNodeId: shape.id,
        property: 'pathMorph',
        keyframes: [
          { id: 'kf-m0', timeMs: 0, value: circleSnap, easing: 'ease-in-out' },
          { id: 'kf-m1', timeMs: 700, value: starSnap, easing: 'ease-in-out' },
          { id: 'kf-m2', timeMs: 1400, value: circleSnap, easing: 'linear' },
        ],
      },
      {
        id: 'trk-rot',
        targetNodeId: shape.id,
        property: 'rotation',
        keyframes: [
          { id: 'kf-r0', timeMs: 0, value: 0, easing: 'linear' },
          { id: 'kf-r1', timeMs: 1400, value: 360, easing: 'linear' },
        ],
      },
    ],
  };

  return {
    id: 'comp-anim-morph',
    name: 'Animated Morph Badge',
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    document: {
      id: 'doc-comp-anim-morph',
      name: 'Animated Morph Badge',
      width: 120,
      height: 120,
      background: '#00000000',
      nodes: [shape],
    },
    animations: [clip],
  };
}

describe('Animated Component Export (SVG + Video Frame Evaluation)', () => {
  it('evaluates animated component instances at distinct timestamps for video/GIF frame export', () => {
    const comp = createAnimatedMorphComponent();
    const project = createInitialProject();
    const page = project.pages[0];
    const instance: ComponentInstanceNode = {
      id: 'inst-main-1',
      type: 'component-instance',
      name: 'Animated Morph Badge',
      componentId: comp.id,
      x: 80,
      y: 60,
      width: 120,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      overrides: {},
    };
    const doc = { ...page.document, nodes: [instance] };

    const svgAt0 = serializeDocumentToSvgString(doc, [comp], {
      rasterizeSafe: true,
      animationTimeMs: 0,
    });
    const svgAt700 = serializeDocumentToSvgString(doc, [comp], {
      rasterizeSafe: true,
      animationTimeMs: 700,
    });

    // At t=0 vs t=700, both the morphed path geometry AND rotation transform must differ!
    expect(svgAt0).not.toEqual(svgAt700);
    expect(svgAt700).toContain('rotate(180');
    expect(svgAt700).toContain('<path d="M');
  });

  it('embeds native SMIL <animate> and <animateTransform> when exporting animated components on Main Canvas to SVG', () => {
    const comp = createAnimatedMorphComponent();
    const project = createInitialProject();
    const page = project.pages[0];
    const instance: ComponentInstanceNode = {
      id: 'inst-main-2',
      type: 'component-instance',
      name: 'Animated Morph Badge',
      componentId: comp.id,
      x: 40,
      y: 40,
      width: 120,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      overrides: {},
    };
    const doc = { ...page.document, nodes: [instance] };

    const animatedSvg = serializeDocumentToSvgString(doc, [comp], {
      embedAnimations: true,
      activeClip: null,
    });

    expect(animatedSvg).toContain('<animate attributeName="d"');
    expect(animatedSvg).toContain('dur="1.4s"');
    expect(animatedSvg).toContain('repeatCount="indefinite"');
    expect(animatedSvg).toContain('<animateTransform attributeName="transform" type="rotate"');
  });

  it('auto-detects animated component duration even when the Main Page has zero page-level clips', async () => {
    const comp = createAnimatedMorphComponent();
    const base = createInitialProject();
    const instance: ComponentInstanceNode = {
      id: 'inst-main-3',
      type: 'component-instance',
      name: 'Animated Morph Badge',
      componentId: comp.id,
      x: 20,
      y: 20,
      width: 120,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      overrides: {},
    };
    const page = {
      ...base.pages[0],
      document: {
        ...base.pages[0].document,
        nodes: [instance],
      },
    };
    const project = {
      ...base,
      components: [comp],
      pages: [page],
      animations: [],
    };

    expect(documentHasAnyAnimations(page.document.nodes, project.components, null)).toBe(true);
    expect(getEffectivePageAnimationDurationMs(project, page, null)).toBe(1400);

    // Motion Export also includes Animated SVG format and produces real SMIL output
    expect(MOTION_EXPORT_FORMATS.some((f) => f.id === 'svg')).toBe(true);
    const result = await exportMotionAnimation(project, page, null, {
      format: 'svg',
      resolution: 'canvas',
      fps: 30,
      quality: 'high',
      startMs: 0,
      endMs: 1400,
      loopCount: 1,
      transparentBackground: false,
    });
    expect(result.format).toBe('svg');
    expect(result.filename.endsWith('.svg')).toBe(true);
    const text = await result.blob.text();
    expect(text).toContain('<animate attributeName="d"');
    expect(text).toContain('<animateTransform');
  });

  it('generates valid SMIL markup for non-morph animated primitive tracks too', () => {
    const rect: RectNode = {
      id: 'rect-slide',
      type: 'rect',
      name: 'Slide Box',
      x: 20,
      y: 30,
      width: 80,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#22C55E', stroke: '#15803D', strokeWidth: 2, radius: 8 },
    };
    const clip: AnimationClip = {
      id: 'clip-rect',
      name: 'Slide & Fade',
      pageId: 'page-1',
      durationMs: 1000,
      loop: false,
      autoplay: true,
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      tracks: [
        {
          id: 't-x',
          targetNodeId: rect.id,
          property: 'x',
          keyframes: [
            { id: 'k0', timeMs: 0, value: 20, easing: 'ease-out' },
            { id: 'k1', timeMs: 1000, value: 220, easing: 'linear' },
          ],
        },
        {
          id: 't-op',
          targetNodeId: rect.id,
          property: 'opacity',
          keyframes: [
            { id: 'ko0', timeMs: 0, value: 0.2, easing: 'linear' },
            { id: 'ko1', timeMs: 1000, value: 1, easing: 'linear' },
          ],
        },
      ],
    };

    const smil = buildNodeSvgSmilAnimations(rect, clip);
    expect(smil).not.toBeNull();
    expect(smil!.wrapperSmilMarkup).toContain('type="translate"');
    expect(smil!.wrapperSmilMarkup).toContain('attributeName="opacity"');
    expect(smil!.wrapperSmilMarkup).toContain('repeatCount="1"');
    expect(smil!.wrapperSmilMarkup).toContain('fill="freeze"');
  });

  it('produces uniform cubic-bezier path topology across multi-keyframe morph SMIL', () => {
    const comp = createAnimatedMorphComponent();
    const morphTrack = comp.animations![0].tracks[0];
    const smil = buildSvgPathMorphSmil(morphTrack, comp.animations![0], 10, 10);
    expect(smil).not.toBeNull();
    expect(smil!.initialD.startsWith('M ')).toBe(true);
    expect(smil!.animateMarkup).toContain('attributeName="d"');
    expect(smil!.animateMarkup).toContain('values="');
    expect(smil!.animateMarkup).toMatch(/keyTimes="0;[^"]+?;1"/);
    const valuesMatch = /values="([^"]+)"/.exec(smil!.animateMarkup);
    expect(valuesMatch).not.toBeNull();
    const frames = valuesMatch![1].split(';');
    expect(frames.length).toBeGreaterThanOrEqual(3);
    const cubicCounts = frames.map((d) => (d.match(/ C /g) ?? []).length);
    expect(new Set(cubicCounts).size).toBe(1);
    expect(cubicCounts[0]).toBeGreaterThanOrEqual(4);
  });
});

describe('Component Master Centering & Dropdown Viewport Clamping', () => {
  it('always centers Component Master with pan (0, 0) and fits square, tall, and wide components inside the viewport', () => {
    const cases: Array<[number, number, number, number]> = [
      [120, 120, 860, 520], // square badge
      [200, 480, 860, 520], // tall mobile card
      [640, 180, 860, 520], // wide banner
      [420, 280, 860, 520], // default master
    ];

    for (const [docW, docH, vpW, vpH] of cases) {
      const view = computeCenteredComponentView(docW, docH, vpW, vpH);
      expect(view.pan).toEqual({ x: 0, y: 0 });
      const availW = vpW - 64;
      const availH = vpH - 116;
      const stageW = view.zoom * availW;
      const stageH = stageW * (docH / docW);
      expect(stageW).toBeLessThanOrEqual(availW * 0.8 + 1);
      expect(stageH).toBeLessThanOrEqual(availH * 0.8 + 1);
    }
  });

  it('clamps portaled dropdown coordinates safely within viewport edges', () => {
    const pos = clampContextMenuPosition(1400, 880, 240, 220, 1440, 900);
    expect(pos.x + 240).toBeLessThanOrEqual(1440 - 8);
    expect(pos.y + 220).toBeLessThanOrEqual(900 - 8);
    expect(pos.x).toBeGreaterThanOrEqual(8);
    expect(pos.y).toBeGreaterThanOrEqual(8);
  });
});
