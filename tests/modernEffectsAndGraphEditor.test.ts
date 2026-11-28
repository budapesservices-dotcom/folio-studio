import { describe, expect, it } from 'vitest';
import appearanceSrc from '../src/app/workspace/InspectorAppearanceSection.tsx?raw';
import zeroTypingSrc from '../src/app/workspace/InspectorZeroTypingControls.tsx?raw';
import effectsSrc from '../src/app/workspace/InspectorModernEffectsSection.tsx?raw';
import { createInitialProject } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import {
  computeNodeFilterBleedMargins,
  computeSvgFilterRegion,
  formatColorWithAlpha,
  serializeNodeSvgStyleDefs,
} from '../src/core/document/styling';
import type {
  AnimationClip,
  AnimationEasing,
  CustomEasingPreset,
  DesignNode,
  FolioProjectV2,
  RectNode,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import {
  ANIMATABLE_PROPERTIES,
  EASING_PRESET_CATALOG,
  applyAnimatedPosesToDocument,
  applyAutoKeyFromNodeChange,
  compilePageAnimationsCss,
  createAnimationClip,
  evaluateClipAtTime,
  evaluateEasing,
  formatEasingLabel,
  hasKeyframeAtTime,
  interpolateColor,
  solveCubicBezier,
  toCssTimingFunction,
  togglePropertyKeyframeInClip,
} from '../src/engines/animation';
import {
  computeTileBleedMargin,
  computeTileSignature,
  filterNodesForTile,
  getNodeExpandedBounds,
  isGpuInstancedPrimitive,
} from '../src/engines/canvas/gpu/scenePacker';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileFolioProject } from '../src/engines/codegen';

function makeStyledRect(overrides?: Partial<RectNode>): RectNode {
  return {
    id: 'rect-fx-1',
    type: 'rect',
    name: 'FX Card',
    x: 200,
    y: 160,
    width: 180,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style: {
      fill: '#00E5FF',
      stroke: '#4A5568',
      strokeWidth: 2,
      radius: 16,
    },
    ...overrides,
  };
}

describe('TUGAS 1 — Blur Clipping & Bleed Margin Parity (SVG, GPU Tile Cache, HTML/CSS & React)', () => {
  it('computes dynamic userSpaceOnUse SVG filter regions >= 3*blurRadius + shadow spread/offset', () => {
    const node = makeStyledRect({
      effects: [
        { id: 'fx-blur', type: 'layer-blur', radius: 40, visible: true },
        { id: 'fx-shadow', type: 'drop-shadow', x: 18, y: 24, blur: 30, spread: 8, color: 'rgba(0, 229, 255, 0.4)', visible: true },
      ],
    });

    const bleed = computeNodeFilterBleedMargins(node);
    // Layer blur 40 -> 3 * 40 = 120px bleed minimum on every side
    expect(bleed.left).toBeGreaterThanOrEqual(120);
    expect(bleed.top).toBeGreaterThanOrEqual(120);
    // Drop shadow (+18x, +24y, 30 blur, 8 spread) expands right/bottom beyond 120px
    expect(bleed.right).toBeGreaterThanOrEqual(120);
    expect(bleed.bottom).toBeGreaterThanOrEqual(122);

    const region = computeSvgFilterRegion(node);
    expect(region.x).toBe(node.x - bleed.left);
    expect(region.y).toBe(node.y - bleed.top);
    expect(region.width).toBe(node.width + bleed.left + bleed.right);
    expect(region.height).toBe(node.height + bleed.top + bleed.bottom);

    const defsMarkup = serializeNodeSvgStyleDefs(node, 'test');
    expect(defsMarkup).toContain('filterUnits="userSpaceOnUse"');
    expect(defsMarkup).not.toContain('x="-50%"');
    expect(defsMarkup).toContain(`x="${region.x}"`);
    expect(defsMarkup).toContain(`width="${region.width}"`);
    expect(defsMarkup).toContain('feMorphology');
  });

  it('expands GPU tile bounds & bleed margin for blurred/shadowed nodes and hashes cssFilters', () => {
    const blurredNode = makeStyledRect({
      x: 490,
      y: 100,
      width: 100,
      height: 100,
      effects: [{ id: 'fx-b', type: 'layer-blur', radius: 32, visible: true }],
      cssFilters: { brightness: 130, saturate: 140 },
    });

    // Nodes with cssFilters must use the rich tile path instead of flat GPU instancing
    expect(isGpuInstancedPrimitive(makeStyledRect({ cssFilters: { contrast: 150 } }))).toBe(false);

    const expanded = getNodeExpandedBounds(blurredNode);
    // 32 * 3 = 96px bleed on each side
    expect(expanded.minX).toBeLessThanOrEqual(blurredNode.x - 96);
    expect(expanded.maxX).toBeGreaterThanOrEqual(blurredNode.x + blurredNode.width + 96);

    const leftTile = {
      col: 0,
      row: 0,
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      key: '0:0:512x512',
    };

    // Adjacent tile [0..512] must include this node even if node moved past x=512 within bleed distance
    const rightTileNode = makeStyledRect({
      id: 'rect-spill',
      x: 540,
      y: 100,
      width: 100,
      height: 100,
      effects: [{ id: 'fx-b2', type: 'layer-blur', radius: 24, visible: true }],
    });
    const inLeftTile = filterNodesForTile([rightTileNode], leftTile);
    expect(inLeftTile.map((n) => n.id)).toContain('rect-spill');
    expect(computeTileBleedMargin([rightTileNode])).toBeGreaterThanOrEqual(72);

    const sigA = computeTileSignature([blurredNode], leftTile, 1);
    const sigB = computeTileSignature(
      [{ ...blurredNode, cssFilters: { brightness: 160, saturate: 140 } }],
      leftTile,
      1,
    );
    expect(sigA).not.toBe(sigB);
  });

  it('does not force overflow:hidden on frames unless clipContent is true, and emits backdrop-filter parity', () => {
    const project = createInitialProject('Glass Parity');
    const page = getActivePage(project);
    const glassCard = makeStyledRect({
      id: 'glass-card',
      effects: [{ id: 'fx-glass', type: 'backdrop-blur', radius: 18, visible: true }],
    });
    const unclippedFrame: DesignNode = {
      id: 'frame-open',
      type: 'frame',
      name: 'Open Frame',
      x: 40,
      y: 40,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#12161A', stroke: 'none', strokeWidth: 0, radius: 16 },
    };
    const nextProject: FolioProjectV2 = {
      ...project,
      pages: project.pages.map((p) =>
        p.id === page.id ? { ...p, document: { ...p.document, nodes: [unclippedFrame, glassCard] } } : p,
      ),
    };
    const updatedPage = getActivePage(nextProject);

    const compiled = compilePageHtmlCss(nextProject, updatedPage);
    // Open frame without clipContent must NOT emit overflow: hidden
    const frameBlock = compiled.pageCssContent.split('.node-frame-open')[1]?.split('}')[0] ?? '';
    expect(frameBlock).not.toContain('overflow: hidden');
    // Glassmorphism emits standard + webkit backdrop-filter
    expect(compiled.pageCssContent).toContain('backdrop-filter: blur(18px);');
    expect(compiled.pageCssContent).toContain('-webkit-backdrop-filter: blur(18px);');

    const reactOutput = compileFolioProject(nextProject, { target: 'react', pageId: updatedPage.id });
    const reactCss = reactOutput.files
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => f.content)
      .join('\n');
    expect(reactCss).toContain('backdrop-filter: blur(18px);');
    expect(reactCss).toContain('-webkit-backdrop-filter: blur(18px);');
  });
});

describe('TUGAS 2 — All 11 Modern Effects Keyframeable, Auto-Key Coalescing & Codegen Parity', () => {
  const MODERN_EFFECT_PROPS = [
    'layerBlur',
    'backdropBlur',
    'shadowOffsetX',
    'shadowOffsetY',
    'shadowBlur',
    'shadowSpread',
    'shadowOpacity',
    'brightness',
    'contrast',
    'saturate',
    'grayscale',
  ] as const;

  it('supports all 11 Modern Effects properties in schema, evaluation, pose application, and CSS/React @keyframes', () => {
    for (const prop of MODERN_EFFECT_PROPS) {
      expect(ANIMATABLE_PROPERTIES).toContain(prop);
    }

    const project = createInitialProject('Modern Effects Motion');
    const page = getActivePage(project);
    const card = makeStyledRect({
      id: 'fx-anim-card',
      effects: [
        { id: 'fx-sh', type: 'drop-shadow', x: 0, y: 4, blur: 10, spread: 0, color: 'rgba(0, 229, 255, 0.2)', visible: true },
      ],
    });

    const clip: AnimationClip = {
      id: 'clip-modern-fx',
      name: 'Modern FX Sweep',
      pageId: page.id,
      durationMs: 1000,
      loop: false,
      autoplay: true,
      tracks: [
        {
          id: 'tr-lblur',
          targetNodeId: card.id,
          property: 'layerBlur',
          keyframes: [
            { id: 'k1', timeMs: 0, value: 0, easing: 'linear' },
            { id: 'k2', timeMs: 1000, value: 20, easing: 'linear' },
          ],
        },
        {
          id: 'tr-bblur',
          targetNodeId: card.id,
          property: 'backdropBlur',
          keyframes: [
            { id: 'k3', timeMs: 0, value: 0, easing: 'linear' },
            { id: 'k4', timeMs: 1000, value: 16, easing: 'linear' },
          ],
        },
        {
          id: 'tr-sx',
          targetNodeId: card.id,
          property: 'shadowOffsetX',
          keyframes: [
            { id: 'k5', timeMs: 0, value: 0, easing: 'linear' },
            { id: 'k6', timeMs: 1000, value: 20, easing: 'linear' },
          ],
        },
        {
          id: 'tr-sy',
          targetNodeId: card.id,
          property: 'shadowOffsetY',
          keyframes: [
            { id: 'k7', timeMs: 0, value: 4, easing: 'linear' },
            { id: 'k8', timeMs: 1000, value: 24, easing: 'linear' },
          ],
        },
        {
          id: 'tr-sb',
          targetNodeId: card.id,
          property: 'shadowBlur',
          keyframes: [
            { id: 'k9', timeMs: 0, value: 10, easing: 'linear' },
            { id: 'k10', timeMs: 1000, value: 40, easing: 'linear' },
          ],
        },
        {
          id: 'tr-ss',
          targetNodeId: card.id,
          property: 'shadowSpread',
          keyframes: [
            { id: 'k11', timeMs: 0, value: 0, easing: 'linear' },
            { id: 'k12', timeMs: 1000, value: 10, easing: 'linear' },
          ],
        },
        {
          id: 'tr-so',
          targetNodeId: card.id,
          property: 'shadowOpacity',
          keyframes: [
            { id: 'k13', timeMs: 0, value: 0.2, easing: 'linear' },
            { id: 'k14', timeMs: 1000, value: 0.8, easing: 'linear' },
          ],
        },
        {
          id: 'tr-bri',
          targetNodeId: card.id,
          property: 'brightness',
          keyframes: [
            { id: 'k15', timeMs: 0, value: 100, easing: 'linear' },
            { id: 'k16', timeMs: 1000, value: 160, easing: 'linear' },
          ],
        },
        {
          id: 'tr-con',
          targetNodeId: card.id,
          property: 'contrast',
          keyframes: [
            { id: 'k17', timeMs: 0, value: 100, easing: 'linear' },
            { id: 'k18', timeMs: 1000, value: 140, easing: 'linear' },
          ],
        },
        {
          id: 'tr-sat',
          targetNodeId: card.id,
          property: 'saturate',
          keyframes: [
            { id: 'k19', timeMs: 0, value: 100, easing: 'linear' },
            { id: 'k20', timeMs: 1000, value: 180, easing: 'linear' },
          ],
        },
        {
          id: 'tr-gray',
          targetNodeId: card.id,
          property: 'grayscale',
          keyframes: [
            { id: 'k21', timeMs: 0, value: 0, easing: 'linear' },
            { id: 'k22', timeMs: 1000, value: 100, easing: 'linear' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const animatedProject: FolioProjectV2 = {
      ...project,
      pages: project.pages.map((p) =>
        p.id === page.id ? { ...p, document: { ...p.document, nodes: [card] } } : p,
      ),
      animations: [clip],
    };
    const animatedPage = getActivePage(animatedProject);

    expect(validateProject(animatedProject).ok).toBe(true);

    // Midpoint (500ms) interpolation check
    const poses = evaluateClipAtTime(clip, 500);
    const pose = poses[card.id];
    expect(pose?.layerBlur).toBeCloseTo(10, 2);
    expect(pose?.backdropBlur).toBeCloseTo(8, 2);
    expect(pose?.shadowOffsetX).toBeCloseTo(10, 2);
    expect(pose?.shadowOffsetY).toBeCloseTo(14, 2);
    expect(pose?.shadowBlur).toBeCloseTo(25, 2);
    expect(pose?.shadowSpread).toBeCloseTo(5, 2);
    expect(pose?.shadowOpacity).toBeCloseTo(0.5, 2);
    expect(pose?.brightness).toBeCloseTo(130, 2);
    expect(pose?.contrast).toBeCloseTo(120, 2);
    expect(pose?.saturate).toBeCloseTo(140, 2);
    expect(pose?.grayscale).toBeCloseTo(50, 2);

    // Pose application updates node effects & cssFilters non-destructively
    const previewDoc = applyAnimatedPosesToDocument(animatedPage.document, poses);
    const previewNode = previewDoc.nodes[0];
    expect(previewNode.cssFilters?.brightness).toBeCloseTo(130, 1);
    expect(previewNode.cssFilters?.grayscale).toBeCloseTo(50, 1);
    const previewBlur = previewNode.effects?.find((fx) => fx.type === 'layer-blur');
    expect(previewBlur && previewBlur.type === 'layer-blur' ? previewBlur.radius : 0).toBeCloseTo(10, 1);

    // CSS @keyframes compilation emits filter, backdrop-filter, -webkit-backdrop-filter, box-shadow
    const motionCss = compilePageAnimationsCss(animatedProject, animatedPage);
    expect(motionCss).toContain('filter: blur(20px)');
    expect(motionCss).toContain('brightness(160%)');
    expect(motionCss).toContain('grayscale(100%)');
    expect(motionCss).toContain('backdrop-filter: blur(16px);');
    expect(motionCss).toContain('-webkit-backdrop-filter: blur(16px);');
    expect(motionCss).toContain('box-shadow: 20px 24px 40px 10px rgba(0, 229, 255, 0.8);');

    // React TSX parity (full compiled React target includes page stylesheet + @keyframes)
    const reactOutput = compileFolioProject(animatedProject, { target: 'react', pageId: animatedPage.id });
    const reactCss = reactOutput.files
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => f.content)
      .join('\n');
    expect(reactCss).toContain('@keyframes folio-kf-');
    expect(reactCss).toContain('backdrop-filter: blur(16px);');
    expect(reactCss).toContain('box-shadow: 20px 24px 40px 10px rgba(0, 229, 255, 0.8);');
  });

  it('toggles diamond keyframes, auto-keys Modern Effects, and coalesces slider drags into 1 Undo step', () => {
    const project = createInitialProject('Coalesce FX');
    const page = getActivePage(project);
    const card = page.document.nodes[0];
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    const clip = createAnimationClip({ pageId: page.id, name: 'FX Clip', durationMs: 1000, autoplay: true });
    expect(client.createAnimationClip(clip).status).toBe('applied');

    // Diamond toggle add -> hasKeyframeAtTime true -> toggle remove -> false
    const added = togglePropertyKeyframeInClip(clip, card, 'layerBlur', 400);
    expect(added.action).toBe('added');
    expect(hasKeyframeAtTime(added.clip, card.id, 'layerBlur', 400)).toBe(true);
    const removed = togglePropertyKeyframeInClip(added.clip, card, 'layerBlur', 400);
    expect(removed.action).toBe('removed');
    expect(hasKeyframeAtTime(removed.clip, card.id, 'layerBlur', 400)).toBe(false);

    // Auto-key detects layerBlur change without creating unrelated cssFilter tracks
    const afterBlur: DesignNode = {
      ...card,
      effects: [{ id: 'fx-layer-blur', type: 'layer-blur', radius: 18, visible: true }],
    };
    const auto1 = applyAutoKeyFromNodeChange(clip, card, afterBlur, 500, { baselineNode: card });
    expect(auto1.recorded).toBe(true);
    expect(auto1.changedProperties).toContain('layerBlur');
    expect(auto1.changedProperties).not.toContain('grayscale');

    // Coalesced slider drag (3 sequential updates with same coalesceKey = 1 undo step!)
    const historyBefore = store.getSnapshot().editorState.past.length;
    const afterBlur2: DesignNode = {
      ...card,
      effects: [{ id: 'fx-layer-blur', type: 'layer-blur', radius: 24, visible: true }],
    };
    const afterBlur3: DesignNode = {
      ...card,
      effects: [{ id: 'fx-layer-blur', type: 'layer-blur', radius: 36, visible: true }],
    };
    const c1 = applyAutoKeyFromNodeChange(clip, card, afterBlur, 500, { baselineNode: card }).clip;
    const c2 = applyAutoKeyFromNodeChange(c1, afterBlur, afterBlur2, 500, { baselineNode: card }).clip;
    const c3 = applyAutoKeyFromNodeChange(c2, afterBlur2, afterBlur3, 500, { baselineNode: card }).clip;

    client.updateAnimationClip(c1, 'Auto-key blur', 'autokey:layerBlur');
    client.updateAnimationClip(c2, 'Auto-key blur', 'autokey:layerBlur');
    client.updateAnimationClip(c3, 'Auto-key blur', 'autokey:layerBlur');
    client.commitEdit();

    expect(store.getSnapshot().editorState.past.length).toBe(historyBefore + 1);
    expect(client.undo().status).toBe('applied');
    // Single undo reverts all 3 coalesced drag frames back to the clip before the drag
    expect(store.getSnapshot().editorState.project.animations?.[0].tracks.length).toBe(0);
  });
});

describe('TUGAS 3 — Opacity / Alpha Keyframe Smoothness & Removal of Transparent/None Buttons', () => {
  it('preserves RGB in rgba(r, g, b, 0) at 0% alpha and smoothly interpolates legacy transparent without darkening', () => {
    expect(formatColorWithAlpha('#00E5FF', 0)).toBe('rgba(0, 229, 255, 0)');
    expect(formatColorWithAlpha('#FF3366', 0)).toBe('rgba(255, 51, 102, 0)');
    expect(formatColorWithAlpha('#00E5FF', 0.5)).toBe('rgba(0, 229, 255, 0.5)');
    expect(formatColorWithAlpha('#00E5FF', 1)).toBe('#00E5FF');

    // RGBA -> Hex interpolation keeps exact RGB and linearly interpolates alpha
    expect(interpolateColor('rgba(0, 229, 255, 0)', '#00E5FF', 0.5)).toBe('rgba(0, 229, 255, 0.5)');
    expect(interpolateColor('rgba(0, 229, 255, 0)', '#00E5FF', 0)).toBe('rgba(0, 229, 255, 0)');
    expect(interpolateColor('rgba(0, 229, 255, 0)', '#00E5FF', 1)).toBe('#00e5ff');

    // Legacy 'transparent' adopts partner RGB (255, 51, 102) with alpha 0 -> NO dark/muddy midpoint!
    expect(interpolateColor('transparent', '#FF3366', 0.5)).toBe('rgba(255, 51, 102, 0.5)');
    expect(interpolateColor('#FF3366', 'transparent', 0.5)).toBe('rgba(255, 51, 102, 0.5)');
    expect(interpolateColor('transparent', '#FF3366', 0)).toBe('rgba(255, 51, 102, 0)');
  });

  it('removes Transparent/None quick buttons from Right Sidebar color pickers', () => {
    expect(appearanceSrc).not.toContain('>Transparent<');
    expect(appearanceSrc).not.toContain('>None<');
    expect(zeroTypingSrc).not.toContain('zt-none-btn');
    expect(zeroTypingSrc).not.toContain("onChangeColor('transparent')");
    expect(effectsSrc).not.toContain('>Transparent<');
  });
});

describe('TUGAS 4 — CapCut-Style Easing Engine, Graph Editor Curves, .flop v2 & Custom Easing Persistence', () => {
  it('evaluates Cubic Bezier (including overshoot), Multi-Point, Bounce, Elastic, Spring and compiles CSS timing functions', () => {
    // Overshoot cubic-bezier exceeds 1.0 cleanly in the middle
    const overshoot: AnimationEasing = { type: 'cubic-bezier', p1: [0.34, 1.56], p2: [0.64, 1] };
    expect(evaluateEasing(overshoot, 0)).toBe(0);
    expect(evaluateEasing(overshoot, 1)).toBe(1);
    expect(evaluateEasing(overshoot, 0.5)).toBeGreaterThan(1);
    expect(toCssTimingFunction(overshoot)).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(solveCubicBezier(0.5, 0.25, 0.1, 0.25, 1)).toBeGreaterThan(0.7);

    // Multi-Point curve passes through interior stops & compiles to CSS linear(...)
    const multi: AnimationEasing = {
      type: 'multi-point',
      points: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.85 },
        { x: 0.75, y: 0.15 },
        { x: 1, y: 1 },
      ],
    };
    expect(evaluateEasing(multi, 0)).toBe(0);
    expect(evaluateEasing(multi, 0.25)).toBeCloseTo(0.85, 2);
    expect(evaluateEasing(multi, 0.75)).toBeCloseTo(0.15, 2);
    expect(evaluateEasing(multi, 1)).toBe(1);
    const multiCss = toCssTimingFunction(multi);
    expect(multiCss.startsWith('linear(0,')).toBe(true);
    expect(multiCss.endsWith(', 1)')).toBe(true);

    // Expressive presets compile to valid CSS linear(...) and have exact 0/1 endpoints
    for (const preset of ['spring', 'bounce-out', 'elastic-out'] as const) {
      expect(evaluateEasing(preset, 0)).toBe(0);
      expect(evaluateEasing(preset, 1)).toBe(1);
      expect(toCssTimingFunction(preset).startsWith('linear(0,')).toBe(true);
    }

    // All catalog presets have human-readable labels
    for (const item of EASING_PRESET_CATALOG) {
      expect(formatEasingLabel(item.id).length).toBeGreaterThan(0);
    }
  });

  it('maintains .flop v2 backward compatibility and persists project.customEasings via Native Command Engine with Undo/Redo', () => {
    const project = createInitialProject('Graph Editor Persistence');
    const page = getActivePage(project);
    const card = page.document.nodes[0];

    // Clip mixing legacy string easing, new CapCut preset, custom cubic-bezier, and multi-point
    const mixedClip: AnimationClip = {
      id: 'clip-mixed-easing',
      name: 'Mixed Easing',
      pageId: page.id,
      durationMs: 1200,
      loop: false,
      autoplay: true,
      tracks: [
        {
          id: 'tr-x',
          targetNodeId: card.id,
          property: 'x',
          keyframes: [
            { id: 'k1', timeMs: 0, value: 100, easing: 'ease-in-out' },
            { id: 'k2', timeMs: 400, value: 200, easing: 'overshoot-out' },
            { id: 'k3', timeMs: 800, value: 300, easing: { type: 'cubic-bezier', p1: [0.16, 1.35], p2: [0.3, 1] } },
            {
              id: 'k4',
              timeMs: 1200,
              value: 400,
              easing: {
                type: 'multi-point',
                points: [
                  { x: 0, y: 0 },
                  { x: 0.5, y: 0.9 },
                  { x: 1, y: 1 },
                ],
              },
            },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    expect(client.createAnimationClip(mixedClip).status).toBe('applied');

    const customCurve: CustomEasingPreset = {
      id: 'custom-snappy',
      name: 'Snappy Pop',
      easing: { type: 'cubic-bezier', p1: [0.22, 1.4], p2: [0.36, 1] },
    };

    const saved = client.updateCustomEasings([customCurve], 'Save Snappy Pop');
    expect(saved.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.customEasings).toHaveLength(1);
    expect(store.getSnapshot().editorState.project.customEasings?.[0].name).toBe('Snappy Pop');
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // Undo / Redo for customEasings
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.customEasings).toBeUndefined();
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.customEasings).toHaveLength(1);

    // CSS @keyframes emits per-segment animation-timing-function for cubic-bezier & linear()
    const currentProject = store.getSnapshot().editorState.project;
    const css = compilePageAnimationsCss(currentProject, getActivePage(currentProject));
    expect(css).toContain('animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);');
    expect(css).toContain('animation-timing-function: cubic-bezier(0.16, 1.35, 0.3, 1);');
    expect(css).toContain('animation-timing-function: linear(0,');
  });
});
