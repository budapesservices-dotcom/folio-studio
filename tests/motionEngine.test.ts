import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { AnimationClip, FolioProjectV2 } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { executeNativeCommand } from '../src/app/nativeCommandExecutor';
import { createInteractiveStarterProject } from '../src/app/workspace/nodeLogicGraphHelpers';
import {
  ANIMATION_EASINGS,
  addTrackToClip,
  applyAnimatedPosesToDocument,
  buildPresetClipForPage,
  compilePageAnimationsCss,
  createAnimationClip,
  createStarterHeroEntranceClip,
  deleteKeyframeFromClip,
  evaluateClipAtTime,
  evaluateEasing,
  evaluateTrackAtTime,
  interpolateHexColor,
  removeTrackFromClip,
  toCssTimingFunction,
  updateClipSettings,
  updateKeyframeInClip,
  upsertKeyframeInClip,
} from '../src/engines/animation';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import {
  createLogicGraph,
  createPrototypeRuntime,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';

describe('Stage 8 — Motion & Animation Engine', () => {
  it('evaluates easing curves accurately with strict [0,1] boundary invariants and CSS timing outputs', () => {
    for (const easing of ANIMATION_EASINGS) {
      expect(evaluateEasing(easing, 0)).toBe(0);
      expect(evaluateEasing(easing, 1)).toBe(1);
      expect(evaluateEasing(easing, -0.5)).toBe(0);
      expect(evaluateEasing(easing, 1.5)).toBe(1);
      expect(toCssTimingFunction(easing).length).toBeGreaterThan(0);
    }

    expect(evaluateEasing('linear', 0.25)).toBeCloseTo(0.25, 5);
    expect(evaluateEasing('ease-in', 0.5)).toBeLessThan(0.5);
    expect(evaluateEasing('ease-out', 0.5)).toBeGreaterThan(0.5);
    // Spring curve reaches near/above 1.0 before settling cleanly to 1.0
    const springSamples = [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => evaluateEasing('spring', t));
    expect(Math.max(...springSamples)).toBeGreaterThan(0.95);

    expect(interpolateHexColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(interpolateHexColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(interpolateHexColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('interpolates tracks, loops/clamps clips, and applies non-destructive poses to FolioDocument', () => {
    const project = createInitialProject('Motion Math');
    const page = getActivePage(project);
    const card = page.document.nodes.find((n) => n.name === 'Visual card') ?? page.document.nodes[0];
    const baseY = card.y;
    const baseWidth = card.width;
    const baseHeight = card.height;

    const clip: AnimationClip = {
      id: 'clip-pose-test',
      name: 'Pose Test',
      pageId: page.id,
      durationMs: 1000,
      loop: false,
      autoplay: false,
      tracks: [
        {
          id: 'tr-y',
          targetNodeId: card.id,
          property: 'y',
          keyframes: [
            { id: 'kf-1', timeMs: 0, value: baseY + 100, easing: 'linear' },
            { id: 'kf-2', timeMs: 1000, value: baseY, easing: 'linear' },
          ],
        },
        {
          id: 'tr-scale',
          targetNodeId: card.id,
          property: 'scale',
          keyframes: [
            { id: 'kf-s1', timeMs: 0, value: 1, easing: 'linear' },
            { id: 'kf-s2', timeMs: 1000, value: 2, easing: 'linear' },
          ],
        },
        {
          id: 'tr-fill',
          targetNodeId: card.id,
          property: 'fill',
          keyframes: [
            { id: 'kf-f1', timeMs: 0, value: '#000000', easing: 'linear' },
            { id: 'kf-f2', timeMs: 1000, value: '#ffffff', easing: 'linear' },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(evaluateTrackAtTime(clip.tracks[0], 500)).toBeCloseTo(baseY + 50, 2);
    const poses = evaluateClipAtTime(clip, 500);
    const cardPose = poses[card.id];
    expect(cardPose?.y).toBeCloseTo(baseY + 50, 2);
    expect(cardPose?.scale).toBeCloseTo(1.5, 2);
    expect(cardPose?.fill).toBe('#808080');

    // Non-destructive preview document must not mutate canonical document
    const previewDoc = applyAnimatedPosesToDocument(page.document, poses);
    const previewCard = previewDoc.nodes.find((n) => n.id === card.id)!;
    expect(previewCard.width).toBeCloseTo(baseWidth * 1.5, 1);
    expect(previewCard.height).toBeCloseTo(baseHeight * 1.5, 1);
    if ('style' in previewCard && 'fill' in previewCard.style) {
      expect(previewCard.style.fill).toBe('#808080');
    }
    expect(card.y).toBe(baseY);
    expect(card.width).toBe(baseWidth);

    // Looping clip wraps past durationMs
    const loopingClip: AnimationClip = { ...clip, loop: true };
    const wrapped = evaluateClipAtTime(loopingClip, 1500);
    expect(wrapped[card.id]?.y).toBeCloseTo(baseY + 50, 2);
  });

  it('validates .flop v2 animations schema and rejects malformed clips, out-of-range times, duplicates, and CSS injection', () => {
    const project = createInteractiveStarterProject('Motion Validation');
    expect(project.animations?.length).toBe(1);
    expect(validateProject(project).ok).toBe(true);

    const starterClip = project.animations![0];

    // Out-of-range keyframe timeMs
    const badTime: FolioProjectV2 = {
      ...project,
      animations: [{
        ...starterClip,
        tracks: [{
          ...starterClip.tracks[0],
          keyframes: [{ id: 'kf-bad', timeMs: 5000, value: 10, easing: 'linear' }],
        }],
      }],
    };
    expect(validateProject(badTime).ok).toBe(false);

    // Missing pageId
    const badPage: FolioProjectV2 = {
      ...project,
      animations: [{ ...starterClip, pageId: 'page-does-not-exist' }],
    };
    expect(validateProject(badPage).ok).toBe(false);

    // Duplicate (targetNodeId, property) track
    const dupTrack: FolioProjectV2 = {
      ...project,
      animations: [{
        ...starterClip,
        tracks: [
          starterClip.tracks[0],
          { ...starterClip.tracks[0], id: 'dup-track-id' },
        ],
      }],
    };
    expect(validateProject(dupTrack).ok).toBe(false);

    // CSS injection in fill keyframe value
    const cssInject: FolioProjectV2 = {
      ...project,
      animations: [{
        ...starterClip,
        tracks: [{
          id: 'tr-fill-inject',
          targetNodeId: starterClip.tracks[0].targetNodeId,
          property: 'fill',
          keyframes: [{ id: 'kf-inj', timeMs: 0, value: '#fff; background: url(javascript:alert(1))', easing: 'linear' }],
        }],
      }],
    };
    expect(validateProject(cssInject).ok).toBe(false);
  });

  it('routes animation.create-clip, update-clip, and delete-clip through Native Command Engine with permissions and Undo/Redo', () => {
    const project = createInitialProject('Motion Commands');
    const page = getActivePage(project);
    const store = createCanonicalEditorStore(createEditorState(project));
    const client = createMainCanvasCommandClient(store);

    // Permission check: omitting 'animation.update' must reject
    const unauthorizedClip = createAnimationClip({ pageId: page.id, name: 'Blocked Clip', durationMs: 1000 });
    const denied = executeNativeCommand(
      store,
      {
        protocol: 'folio.native-command',
        protocolVersion: 1,
        commandId: '11111111-1111-4111-8111-111111111111',
        type: 'animation.create-clip',
        commandVersion: 1,
        issuedAt: new Date().toISOString(),
        source: {
          actor: { kind: 'user', actorId: 'local-user' },
          workspace: 'main',
        },
        target: { kind: 'project', projectId: project.metadata.id },
        payload: { clip: unauthorizedClip },
      },
      {
        projectId: project.metadata.id,
        principal: { kind: 'user', id: 'local-user' },
        capabilities: ['node.update'],
        workspace: 'main',
      },
    );
    expect(denied.status).toBe('rejected');
    expect(denied.code).toBe('PERMISSION_DENIED');

    // Authorized CRUD lifecycle + Undo/Redo
    const heroClip = createStarterHeroEntranceClip(page);
    const created = client.createAnimationClip(heroClip, 'Create Hero Entrance');
    expect(created.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toHaveLength(1);

    const targetNode = page.document.nodes[0];
    const { clip: withTrack, trackId } = addTrackToClip(heroClip, targetNode, 'rotation');
    const { clip: withKf, keyframeId } = upsertKeyframeInClip(withTrack, trackId, 600, 12, 'spring');
    const updatedKf = updateKeyframeInClip(withKf, trackId, keyframeId, { value: 18 });
    const resized = updateClipSettings(updatedKf, { durationMs: 1800, loop: true });

    const updated = client.updateAnimationClip(resized, 'Update Hero Entrance');
    expect(updated.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations?.[0].durationMs).toBe(1800);
    expect(store.getSnapshot().editorState.project.animations?.[0].loop).toBe(true);

    const pruned = removeTrackFromClip(deleteKeyframeFromClip(resized, trackId, keyframeId), trackId);
    expect(client.updateAnimationClip(pruned).status).toBe('applied');

    const deleted = client.deleteAnimationClip(heroClip.id, 'Delete Hero Entrance');
    expect(deleted.status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toBeUndefined();

    // Undo restores deleted clip, redo removes it again
    expect(client.undo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toHaveLength(1);
    expect(client.redo().status).toBe('applied');
    expect(store.getSnapshot().editorState.project.animations).toBeUndefined();
  });

  it('compiles CSS @keyframes with prefers-reduced-motion and integrates action.play-animation into Node Logic & Live Preview', () => {
    const project = createInteractiveStarterProject('Motion Preview');
    const page = getActivePage(project);
    const orbitClip = buildPresetClipForPage(page, 'orbit-float');
    const projectWithClips: FolioProjectV2 = {
      ...project,
      animations: [...(project.animations ?? []), orbitClip],
    };

    const css = compilePageAnimationsCss(projectWithClips, page);
    expect(css).toContain('@keyframes folio-kf-');
    expect(css).toContain('[data-folio-id=');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none !important;');

    const compiledPage = compilePageHtmlCss(projectWithClips, page);
    expect(compiledPage.cssFile.content).toContain('@keyframes folio-kf-');

    // Node Logic integration: validate + run action.play-animation
    const triggerNode = page.document.nodes.find((n) => n.name === 'Visual card')!;
    const animGraph = createLogicGraph({
      id: 'graph-play-anim',
      name: 'Trigger Motion',
      scope: 'page',
      targetId: page.id,
      nodes: [
        { id: 'ev-1', type: 'event.on-click', x: 40, y: 80, data: { targetNodeId: triggerNode.id } },
        { id: 'act-1', type: 'action.play-animation', x: 300, y: 80, data: { clipId: orbitClip.id } },
      ],
      connections: [
        { id: 'e-1', sourceNodeId: 'ev-1', sourcePortId: 'exec', targetNodeId: 'act-1', targetPortId: 'exec' },
      ],
    });

    const projectWithLogic: FolioProjectV2 = {
      ...projectWithClips,
      logicGraphs: [animGraph],
    };

    expect(validateLogicGraphSemantics(animGraph, projectWithLogic).ok).toBe(true);

    // Missing clip ID must produce MISSING_ANIMATION_CLIP diagnostic
    const brokenAnimGraph = createLogicGraph({
      ...animGraph,
      id: 'graph-broken-anim',
      nodes: [
        animGraph.nodes[0],
        { id: 'act-missing', type: 'action.play-animation', x: 300, y: 80, data: { clipId: 'clip-missing' } },
      ],
      connections: [
        { id: 'e-broken', sourceNodeId: 'ev-1', sourcePortId: 'exec', targetNodeId: 'act-missing', targetPortId: 'exec' },
      ],
    });
    const diag = validateLogicGraphSemantics(brokenAnimGraph, projectWithLogic);
    expect(diag.ok).toBe(false);
    expect(diag.diagnostics.some((i) => i.code === 'MISSING_ANIMATION_CLIP')).toBe(true);

    // Headless PrototypeRuntime records playedAnimations
    const runtime = createPrototypeRuntime(projectWithLogic, { pageId: page.id });
    runtime.mount();
    const snap = runtime.dispatchNodeEvent(triggerNode.id, 'click');
    expect(snap.playedAnimations).toContain(orbitClip.id);
    expect(snap.trace.some((t) => t.nodeType === 'action.play-animation' && t.detail.includes(orbitClip.name))).toBe(true);

    // Live Preview HTML embeds both @keyframes CSS and animationClassById runtime config
    const liveHtml = buildLivePreviewHtml(projectWithLogic, { pageId: page.id });
    expect(liveHtml).toContain('@keyframes folio-kf-');
    expect(liveHtml).toContain('animationClassById');
    expect(liveHtml).toContain(orbitClip.id);
  });
});
