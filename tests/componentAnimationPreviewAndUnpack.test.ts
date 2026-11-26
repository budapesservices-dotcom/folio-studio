import { describe, expect, it } from 'vitest';
import { createEllipseNode, createInitialProject } from '../src/core/document/factory';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  detachComponentInstanceWithAnimations,
  extractComponentAnimationsFromClips,
} from '../src/core/document/components';
import {
  createMorphPresetSnapshot,
  extractMorphSnapshotFromNode,
  parsePathMorphSnapshot,
} from '../src/core/document/pathMorph';
import { createAnimationClip } from '../src/engines/animation/evaluator';
import {
  buildLivePreviewMorphScript,
  collectPageMorphNodeIds,
  compilePageAnimationsCss,
} from '../src/engines/animation/codegen';
import { buildLivePreviewHtml } from '../src/engines/codegen/htmlCssCompiler';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import type { ComponentDefinition } from '../src/core/document/types';

function createAnimatedMorphComponent(): ComponentDefinition {
  const circle = {
    ...createEllipseNode(0),
    id: 'comp-shape-1',
    name: 'Morph Orb',
    x: 20,
    y: 30,
    width: 100,
    height: 100,
  };
  const baseComp = buildComponentDefinitionFromNodes([circle], [circle.id], 'Animated Orb')!;
  const localNode = baseComp.document.nodes[0];

  const circleSnap = extractMorphSnapshotFromNode(localNode)!;
  const triSnap = createMorphPresetSnapshot('triangle', localNode.width, localNode.height);
  const clip = createAnimationClip({
    id: 'clip-orb-motion',
    name: 'Orb Pulse & Morph',
    pageId: 'component-master',
    durationMs: 1000,
    loop: false,
    autoplay: false,
    tracks: [
      {
        id: 'tr-morph',
        targetNodeId: localNode.id,
        property: 'pathMorph',
        keyframes: [
          { id: 'kf-m0', timeMs: 0, value: circleSnap, easing: 'linear' },
          { id: 'kf-m1', timeMs: 1000, value: triSnap, easing: 'ease-out' },
        ],
      },
      {
        id: 'tr-x',
        targetNodeId: localNode.id,
        property: 'x',
        keyframes: [
          { id: 'kf-x0', timeMs: 0, value: localNode.x, easing: 'linear' },
          { id: 'kf-x1', timeMs: 1000, value: localNode.x + 60, easing: 'ease-out' },
        ],
      },
      {
        id: 'tr-op',
        targetNodeId: localNode.id,
        property: 'opacity',
        keyframes: [
          { id: 'kf-o0', timeMs: 0, value: 0.5, easing: 'linear' },
          { id: 'kf-o1', timeMs: 1000, value: 1, easing: 'ease-out' },
        ],
      },
    ],
  });

  return {
    ...baseComp,
    animations: [clip],
  };
}

describe('Animated Component Live Preview & Unpack (Pugar) Preservation', () => {
  it('compiles CSS @keyframes AND Shape Morph JS runtime for animated component instances in Live Preview', () => {
    const project = createInitialProject('Animated Component Preview');
    const component = createAnimatedMorphComponent();
    const instance1 = createComponentInstance(component, 120, 80, 'inst-orb-1');
    const instance2 = createComponentInstance(component, 360, 140, 'inst-orb-2');

    project.components = [component];
    project.pages[0].document.nodes = [instance1, instance2];

    const page = project.pages[0];
    const scopedId1 = `${instance1.id}__${component.document.nodes[0].id}`;
    const scopedId2 = `${instance2.id}__${component.document.nodes[0].id}`;

    // 1. Both instances are recognized as morph targets
    const morphIds = collectPageMorphNodeIds(project, page);
    expect(morphIds.has(scopedId1)).toBe(true);
    expect(morphIds.has(scopedId2)).toBe(true);

    // 2. CSS @keyframes + autoplay + infinite loop emitted for BOTH component instances
    const css = compilePageAnimationsCss(project, page);
    expect(css).toContain(`[data-folio-id="${scopedId1}"]`);
    expect(css).toContain(`[data-folio-id="${scopedId2}"]`);
    expect(css).toContain('translate(60px, 0px)');
    expect(css).toContain('infinite');

    // 3. Shape Morph JS runtime emitted for BOTH component instances
    const morphJs = buildLivePreviewMorphScript(project, page);
    expect(morphJs).toContain(`"nodeId":"${scopedId1}"`);
    expect(morphJs).toContain(`"nodeId":"${scopedId2}"`);
    expect(morphJs).toContain('"autoplay":true');
    expect(morphJs).toContain('"loop":true');

    // 4. Live Preview HTML renders morphed child inside instance as inline <svg><path data-folio-morph-path="true">
    const html = buildLivePreviewHtml(project, { pageId: page.id });
    expect(html).toContain(`data-folio-id="${scopedId1}"`);
    expect(html).toContain(`data-folio-id="${scopedId2}"`);
    expect(html).toContain('data-folio-morph-path="true"');
    expect(html).toContain('requestAnimationFrame');
  });

  it('preserves and remaps component animations (transform + scaled Shape Morph) when unpacking an instance, with atomic Undo/Redo', () => {
    const project = createInitialProject('Unpack Animated Component');
    const component = createAnimatedMorphComponent();
    // Place instance at (200, 150) scaled 2x wide and 1.5x tall!
    const instance = {
      ...createComponentInstance(component, 200, 150, 'inst-orb-unpack'),
      width: component.document.width * 2,
      height: component.document.height * 1.5,
      opacity: 0.8,
    };

    project.components = [component];
    project.pages[0].document.nodes = [instance];

    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);
    const activePageId = project.activePageId;

    const { nodes: detachedNodes, animations: detachedAnimations } = detachComponentInstanceWithAnimations(
      instance,
      component,
      activePageId,
      project.designTokens,
    );

    expect(detachedNodes).toHaveLength(1);
    expect(detachedAnimations).toHaveLength(1);

    const unpackedNode = detachedNodes[0];
    const unpackedClip = detachedAnimations[0];
    expect(unpackedClip.pageId).toBe(activePageId);

    // Track targets exact unpacked node ID
    const xTrack = unpackedClip.tracks.find((t) => t.property === 'x')!;
    const opTrack = unpackedClip.tracks.find((t) => t.property === 'opacity')!;
    const morphTrack = unpackedClip.tracks.find((t) => t.property === 'pathMorph')!;
    expect(xTrack.targetNodeId).toBe(unpackedNode.id);
    expect(morphTrack.targetNodeId).toBe(unpackedNode.id);

    // X keyframes transformed into page space (instance.x=200, scaleX=2: 0 -> 200, 60 -> 320)
    expect(xTrack.keyframes[0].value).toBeCloseTo(200, 1);
    expect(xTrack.keyframes[1].value).toBeCloseTo(320, 1);

    // Opacity multiplied by instance.opacity (0.8)
    expect(opTrack.keyframes[0].value).toBeCloseTo(0.4, 2);
    expect(opTrack.keyframes[1].value).toBeCloseTo(0.8, 2);

    // Shape Morph geometry scaled by (scaleX=2, scaleY=1.5) -> w=200, h=150
    const morphEnd = parsePathMorphSnapshot(String(morphTrack.keyframes[1].value))!;
    expect(morphEnd.w).toBeCloseTo(200, 1);
    expect(morphEnd.h).toBeCloseTo(150, 1);

    // Commit unpack atomically via Native Command Engine
    const result = client.replaceNodeWithNodes(
      instance.id,
      detachedNodes,
      'Unpack animated component',
      detachedAnimations,
    );
    expect(result.status).toBe('applied');

    const afterUnpack = store.getSnapshot().editorState.project;
    expect(afterUnpack.pages[0].document.nodes.map((n) => n.id)).toEqual([unpackedNode.id]);
    expect(afterUnpack.animations?.length).toBe(1);
    expect(afterUnpack.animations?.[0].tracks.some((t) => t.targetNodeId === unpackedNode.id && t.property === 'pathMorph')).toBe(true);

    // Live Preview STILL animates the unpacked node cleanly!
    const htmlAfterUnpack = buildLivePreviewHtml(afterUnpack, { pageId: activePageId });
    expect(htmlAfterUnpack).toContain(`data-folio-id="${unpackedNode.id}"`);
    expect(htmlAfterUnpack).toContain(`"nodeId":"${unpackedNode.id}"`);
    expect(htmlAfterUnpack).toContain('data-folio-morph-path="true"');

    // ONE atomic Undo restores original instance AND removes unpacked animation clip!
    client.undo();
    const afterUndo = store.getSnapshot().editorState.project;
    expect(afterUndo.pages[0].document.nodes.map((n) => n.id)).toEqual([instance.id]);
    expect(afterUndo.animations ?? []).toHaveLength(0);
  });

  it('extracts localized animations when saving Main Canvas selection as a Component', () => {
    const circle = {
      ...createEllipseNode(0),
      id: 'main-shape-1',
      name: 'Hero Orb',
      x: 300,
      y: 250,
      width: 120,
      height: 120,
    };
    const comp = buildComponentDefinitionFromNodes([circle], [circle.id], 'Hero Orb')!;
    const clip = createAnimationClip({
      id: 'main-clip-1',
      name: 'Slide & Morph',
      pageId: 'page-1',
      durationMs: 800,
      autoplay: true,
      loop: true,
      tracks: [
        {
          id: 'tr-main-x',
          targetNodeId: circle.id,
          property: 'x',
          keyframes: [
            { id: 'kf-mx0', timeMs: 0, value: 300, easing: 'linear' },
            { id: 'kf-mx1', timeMs: 800, value: 420, easing: 'ease-out' },
          ],
        },
        {
          id: 'tr-main-y',
          targetNodeId: circle.id,
          property: 'y',
          keyframes: [
            { id: 'kf-my0', timeMs: 0, value: 250, easing: 'linear' },
            { id: 'kf-my1', timeMs: 800, value: 200, easing: 'ease-out' },
          ],
        },
      ],
    });

    const extracted = extractComponentAnimationsFromClips(
      [clip],
      'page-1',
      [circle],
      new Set(comp.document.nodes.map((n) => n.id)),
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0].pageId).toBe('component-master');
    const xTrack = extracted[0].tracks.find((t) => t.property === 'x')!;
    const yTrack = extracted[0].tracks.find((t) => t.property === 'y')!;
    // Normalized relative to (minX=300, minY=250) -> x: 0..120, y: 0..-50
    expect(xTrack.keyframes[0].value).toBe(0);
    expect(xTrack.keyframes[1].value).toBe(120);
    expect(yTrack.keyframes[0].value).toBe(0);
    expect(yTrack.keyframes[1].value).toBe(-50);
  });
});
