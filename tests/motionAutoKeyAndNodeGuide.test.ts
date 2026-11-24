import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { EllipseNode, FolioProjectV2, RectNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import {
  applyAnimatedPosesToDocument,
  applyAutoKeyFromNodeChange,
  captureNodeKeyframeSnapshot,
  compilePageAnimationsCss,
  createAnimationClip,
  deleteLayerKeyframesAtTimeInClip,
  evaluateClipAtTime,
  getAnimatablePropertiesForNode,
  groupClipTracksByNode,
  moveLayerKeyframesInClip,
  updateLayerKeyframesEasingInClip,
} from '../src/engines/animation';
import { BUILT_IN_LOGIC_NODE_TYPES, getLogicNodeGuide } from '../src/engines/prototype';

describe('Full-Snapshot Motion Auto-Key & Node Logic Connection Guide', () => {
  it('captures all animatable properties for an ellipse/rect and interpolates position, size, radius, fill, and stroke cleanly', () => {
    const project = createInitialProject('Auto-Key Snapshot Test');
    const page = getActivePage(project);
    const sun = page.document.nodes.find((n): n is EllipseNode => n.type === 'ellipse')!;
    const card = page.document.nodes.find((n): n is RectNode => n.type === 'rect')!;

    expect(getAnimatablePropertiesForNode(sun)).toEqual([
      'x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth',
    ]);
    expect(getAnimatablePropertiesForNode(card)).toEqual([
      'x', 'y', 'width', 'height', 'rotation', 'opacity', 'radius', 'fill', 'stroke', 'strokeWidth',
    ]);

    const emptyClip = createAnimationClip({ pageId: page.id, name: 'Circle Motion', durationMs: 1000 });
    const editedSun: EllipseNode = {
      ...sun,
      x: sun.x + 200,
      y: sun.y + 80,
      width: sun.width + 60,
      height: sun.height + 60,
      rotation: 90,
      opacity: 0.4,
      style: {
        ...sun.style,
        fill: '#0000ff',
        stroke: '#ff0000',
        strokeWidth: 6,
      },
    };

    // Moving/recoloring at 600ms automatically seeds 0ms baseline AND 600ms target for ALL properties
    const autoResult = applyAutoKeyFromNodeChange(emptyClip, sun, editedSun, 600, {
      baselineNode: sun,
      easing: 'linear',
    });

    expect(autoResult.recorded).toBe(true);
    expect(autoResult.changedProperties).toContain('x');
    expect(autoResult.changedProperties).toContain('width');
    expect(autoResult.changedProperties).toContain('fill');
    expect(autoResult.changedProperties).toContain('stroke');
    expect(autoResult.changedProperties).toContain('strokeWidth');
    expect(autoResult.clip.tracks).toHaveLength(9);

    // Project schema validation accepts all expanded AnimatableProperty values
    const validatedProject: FolioProjectV2 = {
      ...project,
      animations: [autoResult.clip],
    };
    expect(validateProject(validatedProject).ok).toBe(true);

    // Halfway (300ms) interpolates every property smoothly
    const midPoses = evaluateClipAtTime(autoResult.clip, 300);
    const midSun = midPoses[sun.id];
    expect(midSun?.x).toBeCloseTo(sun.x + 100, 1);
    expect(midSun?.y).toBeCloseTo(sun.y + 40, 1);
    expect(midSun?.width).toBeCloseTo(sun.width + 30, 1);
    expect(midSun?.height).toBeCloseTo(sun.height + 30, 1);
    expect(midSun?.rotation).toBeCloseTo(45, 1);
    expect(midSun?.opacity).toBeCloseTo((sun.opacity + 0.4) / 2, 2);
    expect(midSun?.strokeWidth).toBeCloseTo((sun.style.strokeWidth + 6) / 2, 1);

    // Non-destructive document overlay updates geometry + fill/stroke without mutating canonical node
    const previewDoc = applyAnimatedPosesToDocument(page.document, midPoses);
    const previewSun = previewDoc.nodes.find((n) => n.id === sun.id) as EllipseNode;
    expect(previewSun.x).toBeCloseTo(sun.x + 100, 1);
    expect(previewSun.width).toBeCloseTo(sun.width + 30, 1);
    expect(previewSun.style.strokeWidth).toBeCloseTo((sun.style.strokeWidth + 6) / 2, 1);
    expect(sun.x).not.toBe(previewSun.x);

    // CSS @keyframes compiler emits width, height, border-radius, border-color, border-width
    const cardSnap = captureNodeKeyframeSnapshot(
      autoResult.clip,
      { ...card, style: { ...card.style, radius: 48 } },
      1000,
      { baselineNode: card, easing: 'ease-out' },
    ).clip;
    const css = compilePageAnimationsCss({ ...project, animations: [cardSnap] }, page);
    expect(css).toContain('width:');
    expect(css).toContain('height:');
    expect(css).toContain('border-radius: 48px;');
    expect(css).toContain('border-color:');
    expect(css).toContain('border-width:');
  });

  it('ignores non-animatable changes during Auto-Key and supports grouped layer keyframe move/easing/delete', () => {
    const project = createInitialProject('Grouped Layer Timeline Test');
    const page = getActivePage(project);
    const card = page.document.nodes.find((n): n is RectNode => n.type === 'rect')!;
    const clip = createAnimationClip({ pageId: page.id, name: 'Card Clip', durationMs: 1200 });

    // Non-animatable edit (name or aspectRatioLocked) must NOT record spurious keyframes
    const noOp = applyAutoKeyFromNodeChange(
      clip,
      card,
      { ...card, name: 'Renamed Card', aspectRatioLocked: true },
      500,
    );
    expect(noOp.recorded).toBe(false);
    expect(noOp.clip.tracks).toHaveLength(0);

    // Real edit records full pose at 0ms & 500ms, grouped into 1 master layer row
    const recorded = applyAutoKeyFromNodeChange(
      clip,
      card,
      { ...card, x: card.x + 120, style: { ...card.style, radius: 32 } },
      500,
      { baselineNode: card },
    );
    expect(recorded.recorded).toBe(true);

    const groups = groupClipTracksByNode(recorded.clip);
    expect(groups).toHaveLength(1);
    expect(groups[0].targetNodeId).toBe(card.id);
    expect(groups[0].keyframeTimes).toEqual([0, 500]);

    // Move entire layer pose from 500ms -> 800ms
    const moved = moveLayerKeyframesInClip(recorded.clip, card.id, 500, 800);
    expect(groupClipTracksByNode(moved)[0].keyframeTimes).toEqual([0, 800]);

    // Update easing across all tracks at 800ms
    const eased = updateLayerKeyframesEasingInClip(moved, card.id, 800, 'spring');
    for (const track of eased.tracks) {
      const kf = track.keyframes.find((k) => k.timeMs === 800);
      expect(kf?.easing).toBe('spring');
    }

    // Delete layer pose at 800ms removes it from every track of that layer
    const deleted = deleteLayerKeyframesAtTimeInClip(eased, card.id, 800);
    expect(groupClipTracksByNode(deleted)[0].keyframeTimes).toEqual([0]);
  });

  it('generates accurate IN/OUT connection guides and example flows for every built-in Node Logic node type', () => {
    expect(BUILT_IN_LOGIC_NODE_TYPES.length).toBeGreaterThanOrEqual(20);

    for (const nodeType of BUILT_IN_LOGIC_NODE_TYPES) {
      const guide = getLogicNodeGuide(nodeType);
      expect(guide.nodeType).toBe(nodeType);
      expect(guide.label.length).toBeGreaterThan(0);
      expect(guide.roleSummary.length).toBeGreaterThan(0);
      expect(guide.exampleFlow.length).toBeGreaterThan(0);
    }

    // Source / Event start nodes have no incoming ports, and list valid outgoing targets
    const contextGuide = getLogicNodeGuide('source.context');
    expect(contextGuide.inHints).toHaveLength(0);
    expect(contextGuide.outHints.length).toBeGreaterThan(0);
    const contextOnLoadOut = contextGuide.outHints.find((h) => h.portId === 'onLoad');
    expect(contextOnLoadOut?.compatibleNodeTypes).toContain('action.media-animation');
    expect(contextOnLoadOut?.compatibleNodeTypes).toContain('action.navigate');

    const elementGuide = getLogicNodeGuide('source.element');
    expect(elementGuide.inHints).toHaveLength(0);
    expect(elementGuide.outHints.map((h) => h.portId)).toEqual(['onClick', 'onHover', 'value', 'target']);

    // Action nodes explain both incoming triggers/data and outgoing chainable actions
    const setLayerGuide = getLogicNodeGuide('action.set-layer');
    const execIn = setLayerGuide.inHints.find((h) => h.portId === 'exec');
    const valueIn = setLayerGuide.inHints.find((h) => h.portId === 'value');
    expect(execIn?.compatibleNodeTypes).toContain('source.element');
    expect(execIn?.compatibleNodeTypes).toContain('event.on-click');
    expect(valueIn?.compatibleNodeTypes).toContain('state.get');

    // Logic branch explains condition boolean input + true/elseIf/false outputs
    const branchGuide = getLogicNodeGuide('logic.branch');
    const condIn = branchGuide.inHints.find((h) => h.portId === 'condition');
    expect(condIn?.compatibleNodeTypes).toContain('logic.condition');
    expect(condIn?.compatibleNodeTypes).toContain('state.toggle');
    expect(branchGuide.outHints.map((h) => h.portId)).toEqual(['true', 'elseIf', 'false']);
  });
});
