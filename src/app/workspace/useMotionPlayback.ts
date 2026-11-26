import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  AnimatableProperty,
  AnimationClip,
  ComponentDefinition,
  CustomEasingPreset,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  FolioPage,
  FolioProjectV2,
} from '../../core/document/types';
import {
  applyAnimatedPosesToDocument,
  applyAutoKeyFromNodeChange,
  buildPresetClipForPage,
  captureNodeKeyframeSnapshot,
  createAnimationClip,
  evaluateClipAtTime,
  extractMorphSequenceFromComponent,
  hasKeyframeAtTime,
  togglePropertyKeyframeInClip,
  upsertKeyframeInClip,
  type MotionPresetDefinition,
} from '../../engines/animation';
import {
  checkNodeMorphSupport,
  createMorphPresetSnapshot,
  extractMorphSnapshotFromNode,
  type MorphShapePresetId,
} from '../../core/document/pathMorph';
import type { WorkspaceCommandClient } from '../mainCanvasCommandClient';

export interface UseMotionPlaybackOptions {
  workspaceScope?: 'main' | 'component';
  project: FolioProjectV2;
  activePage: FolioPage;
  selectedNodeIds: readonly string[];
  commandClient?: WorkspaceCommandClient;
  /** @deprecated Use `commandClient`. Kept for backward compatibility with older call sites. */
  mainCommandClient?: WorkspaceCommandClient;
  onNotice: (message: string) => void;
}

export interface AutoKeyCaptureResult {
  readonly captured: boolean;
  readonly keepCanonicalUnchanged: boolean;
}

export interface MotionPlaybackController {
  motionOpen: boolean;
  autoKeyEnabled: boolean;
  pageClips: readonly AnimationClip[];
  activeClip: AnimationClip | null;
  playheadMs: number;
  isPlaying: boolean;
  previewActive: boolean;
  animatedMainDocument: FolioDocument;
  toggleMotionOpen: () => void;
  toggleAutoKey: () => void;
  closeMotion: () => void;
  selectClip: (clipId: string) => void;
  play: () => void;
  pause: () => void;
  exitPreview: () => void;
  togglePlay: () => void;
  stop: () => void;
  seek: (ms: number) => void;
  createNewClip: () => void;
  applyPreset: (presetId: MotionPresetDefinition['id']) => void;
  deleteActiveClip: () => void;
  updateClip: (nextClip: AnimationClip, description?: string, coalesceKey?: string) => void;
  updateCustomEasings: (customEasings: readonly CustomEasingPreset[], description?: string) => void;
  keyframeSelectedLayers: (properties?: readonly AnimatableProperty[]) => void;
  keyframeShapeMorph: (presetId?: MorphShapePresetId) => void;
  importShapeMorphFromComponent: (
    component: ComponentDefinition,
    designTokens?: DesignTokenCollection,
    options?: { targetNodeId?: string; atTimeMs?: number },
  ) => void;
  togglePropertyKeyframe: (nodeId: string, property: AnimatableProperty) => void;
  isPropertyKeyedAtPlayhead: (nodeId: string, property: AnimatableProperty) => boolean;
  recordAutoKeyNodes: (
    afterNodes: readonly DesignNode[],
    description?: string,
    coalesceKey?: string,
  ) => AutoKeyCaptureResult;
}

export function useMotionPlayback({
  workspaceScope = 'main',
  project,
  activePage,
  selectedNodeIds,
  commandClient: explicitCommandClient,
  mainCommandClient,
  onNotice,
}: UseMotionPlaybackOptions): MotionPlaybackController {
  const commandClient = explicitCommandClient ?? mainCommandClient!;
  const [motionOpen, setMotionOpen] = useState(false);
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(true);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const playheadRef = useRef(0);
  playheadRef.current = playheadMs;

  const pageClips = useMemo(
    () => (project.animations ?? []).filter((clip) => clip.pageId === activePage.id),
    [project.animations, activePage.id],
  );

  const activeClip = useMemo(() => {
    if (pageClips.length === 0) return null;
    if (activeClipId) {
      const matched = pageClips.find((clip) => clip.id === activeClipId);
      if (matched) return matched;
    }
    return pageClips[0];
  }, [pageClips, activeClipId]);

  // Keep activeClipId aligned with page clips & reset playback cleanly on page, component master, or workspace switch.
  const prevScopePageRef = useRef(`${workspaceScope}:${activePage.id}:${activePage.document.id}`);
  useEffect(() => {
    const key = `${workspaceScope}:${activePage.id}:${activePage.document.id}`;
    if (prevScopePageRef.current !== key) {
      prevScopePageRef.current = key;
      setIsPlaying(false);
      setPreviewActive(false);
      setPlayheadMs(0);
      playheadRef.current = 0;
    }
  }, [workspaceScope, activePage.id, activePage.document.id]);

  useEffect(() => {
    if (!activeClip) {
      if (activeClipId !== null) setActiveClipId(null);
      setIsPlaying(false);
      setPreviewActive(false);
      return;
    }
    if (activeClipId !== activeClip.id) {
      setActiveClipId(activeClip.id);
    }
    setPlayheadMs((current) => Math.min(current, activeClip.durationMs));
  }, [activeClip, activeClipId]);

  // Frame-accurate requestAnimationFrame playback loop
  useEffect(() => {
    if (!motionOpen || !isPlaying || !activeClip) return;
    let rafId = 0;
    let cancelled = false;
    let lastTs: number | null = null;
    const duration = Math.max(100, activeClip.durationMs);
    const loop = activeClip.loop;
    let currentMs = playheadRef.current >= duration ? 0 : playheadRef.current;
    if (currentMs !== playheadRef.current) {
      playheadRef.current = currentMs;
      setPlayheadMs(currentMs);
    }

    const tick = (ts: number) => {
      if (cancelled) return;
      if (lastTs === null) {
        lastTs = ts;
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      const delta = Math.max(0, Math.min(100, ts - lastTs));
      lastTs = ts;

      const next = currentMs + delta;
      if (next >= duration) {
        if (loop) {
          currentMs = Math.round(next % duration);
          playheadRef.current = currentMs;
          setPlayheadMs(currentMs);
          rafId = window.requestAnimationFrame(tick);
        } else {
          currentMs = duration;
          playheadRef.current = duration;
          setPlayheadMs(duration);
          setIsPlaying(false);
        }
        return;
      }

      currentMs = Math.round(next);
      playheadRef.current = currentMs;
      setPlayheadMs(currentMs);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [motionOpen, isPlaying, activeClip?.id, activeClip?.durationMs, activeClip?.loop]);

  const animatedMainDocument = useMemo(() => {
    if (!motionOpen || !activeClip || (!isPlaying && !previewActive)) {
      return activePage.document;
    }
    const poses = evaluateClipAtTime(activeClip, playheadMs);
    if (Object.keys(poses).length === 0) return activePage.document;
    return applyAnimatedPosesToDocument(activePage.document, poses);
  }, [motionOpen, activeClip, isPlaying, previewActive, playheadMs, activePage.document]);

  const toggleMotionOpen = useCallback(() => {
    setMotionOpen((open) => {
      if (open) {
        setIsPlaying(false);
        setPreviewActive(false);
        return false;
      }
      return true;
    });
  }, []);

  const toggleAutoKey = useCallback(() => {
    setAutoKeyEnabled((enabled) => !enabled);
  }, []);

  const closeMotion = useCallback(() => {
    setIsPlaying(false);
    setPreviewActive(false);
    setMotionOpen(false);
  }, []);

  const selectClip = useCallback((clipId: string) => {
    setActiveClipId(clipId);
    setIsPlaying(false);
    playheadRef.current = 0;
    setPlayheadMs(0);
    setPreviewActive(false);
  }, []);

  const play = useCallback(() => {
    if (!activeClip) return;
    setPreviewActive(true);
    if (playheadRef.current >= activeClip.durationMs) {
      playheadRef.current = 0;
      setPlayheadMs(0);
    }
    setIsPlaying(true);
  }, [activeClip]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const stop = useCallback(() => {
    setIsPlaying(false);
    playheadRef.current = 0;
    setPlayheadMs(0);
    setPreviewActive(false);
  }, []);

  const exitPreview = useCallback(() => {
    setIsPlaying(false);
    setPreviewActive(false);
  }, []);

  const seek = useCallback((ms: number) => {
    const duration = activeClip?.durationMs ?? 1200;
    const clamped = Math.max(0, Math.min(duration, Math.round(ms)));
    setIsPlaying(false);
    playheadRef.current = clamped;
    setPlayheadMs(clamped);
    setPreviewActive(true);
  }, [activeClip?.durationMs]);

  const createNewClip = useCallback(() => {
    const name = `Clip ${pageClips.length + 1}`;
    const clip = createAnimationClip({
      pageId: activePage.id,
      name,
      durationMs: 1200,
      autoplay: true,
      loop: workspaceScope === 'component',
    });
    const result = commandClient.createAnimationClip(clip, `Create animation clip "${name}"`);
    if (result.status === 'applied') {
      setActiveClipId(clip.id);
      setPlayheadMs(0);
      setIsPlaying(false);
      setPreviewActive(false);
      onNotice(`Created animation clip "${name}".`);
    }
  }, [activePage.id, pageClips.length, workspaceScope, commandClient, onNotice]);

  const applyPreset = useCallback((presetId: MotionPresetDefinition['id']) => {
    const presetClip = { ...buildPresetClipForPage(activePage, presetId, selectedNodeIds), autoplay: true };
    const existingCount = pageClips.filter((c) => c.name.startsWith(presetClip.name)).length;
    const namedClip: AnimationClip = existingCount > 0
      ? { ...presetClip, name: `${presetClip.name} ${existingCount + 1}` }
      : presetClip;

    const result = commandClient.createAnimationClip(namedClip, `Apply ${namedClip.name} preset`);
    if (result.status === 'applied') {
      setActiveClipId(namedClip.id);
      setPlayheadMs(0);
      setPreviewActive(true);
      setIsPlaying(true);
      onNotice(`Applied "${namedClip.name}" motion preset.`);
    }
  }, [activePage, selectedNodeIds, pageClips, commandClient, onNotice]);

  const deleteActiveClip = useCallback(() => {
    if (!activeClip) return;
    const removedName = activeClip.name;
    const result = commandClient.deleteAnimationClip(activeClip.id, `Delete animation clip "${removedName}"`);
    if (result.status === 'applied') {
      setIsPlaying(false);
      setPlayheadMs(0);
      setPreviewActive(false);
      onNotice(`Deleted animation clip "${removedName}".`);
    }
  }, [activeClip, commandClient, onNotice]);

  const updateClip = useCallback(
    (nextClip: AnimationClip, description = 'Update animation clip', coalesceKey?: string) => {
      commandClient.updateAnimationClip(nextClip, description, coalesceKey);
    },
    [commandClient],
  );

  const updateCustomEasings = useCallback(
    (customEasings: readonly CustomEasingPreset[], description = 'Update custom easing presets') => {
      commandClient.updateCustomEasings(customEasings, description);
    },
    [commandClient],
  );

  const isPropertyKeyedAtPlayhead = useCallback(
    (nodeId: string, property: AnimatableProperty): boolean => {
      if (!activeClip) return false;
      return hasKeyframeAtTime(activeClip, nodeId, property, playheadMs);
    },
    [activeClip, playheadMs],
  );

  const togglePropertyKeyframe = useCallback(
    (nodeId: string, property: AnimatableProperty) => {
      const animatedNode = animatedMainDocument.nodes.find((n) => n.id === nodeId);
      const canonicalNode = activePage.document.nodes.find((n) => n.id === nodeId);
      const targetNode = animatedNode ?? canonicalNode;
      if (!targetNode) return;

      let clip = activeClip;
      let isNewClip = false;
      if (!clip) {
        clip = createAnimationClip({
          pageId: activePage.id,
          name: `Clip ${pageClips.length + 1}`,
          durationMs: Math.max(1200, playheadMs),
          autoplay: true,
          loop: workspaceScope === 'component',
        });
        isNewClip = true;
      }

      const toggled = togglePropertyKeyframeInClip(clip, targetNode, property, playheadMs, {
        baselineNode: canonicalNode ?? targetNode,
        easing: 'ease-out',
      });

      const actionLabel = toggled.action === 'added'
        ? `Add ${property} keyframe at ${(playheadMs / 1000).toFixed(2)}s`
        : `Remove ${property} keyframe at ${(playheadMs / 1000).toFixed(2)}s`;

      const result = isNewClip
        ? commandClient.createAnimationClip(toggled.clip, actionLabel)
        : commandClient.updateAnimationClip(toggled.clip, actionLabel);

      if (result.status === 'applied') {
        if (isNewClip) setActiveClipId(toggled.clip.id);
        setMotionOpen(true);
        setPreviewActive(true);
        onNotice(`${toggled.action === 'added' ? 'Keyframed' : 'Removed keyframe for'} ${property} at ${(playheadMs / 1000).toFixed(2)}s.`);
      }
    },
    [animatedMainDocument.nodes, activePage, activeClip, pageClips.length, playheadMs, commandClient, onNotice],
  );

  const keyframeSelectedLayers = useCallback((properties?: readonly AnimatableProperty[]) => {
    const animatedById = new Map(animatedMainDocument.nodes.map((node) => [node.id, node]));
    const canonicalById = new Map(activePage.document.nodes.map((node) => [node.id, node]));
    const targetNodes = selectedNodeIds
      .map((id) => animatedById.get(id) ?? canonicalById.get(id))
      .filter((n): n is DesignNode => Boolean(n));

    if (targetNodes.length === 0) {
      onNotice('Select one or more layers on the canvas to insert keyframes.');
      return;
    }

    let clip = activeClip;
    let isNewClip = false;
    if (!clip) {
      clip = createAnimationClip({
        pageId: activePage.id,
        name: `Clip ${pageClips.length + 1}`,
        durationMs: 1200,
        autoplay: true,
        loop: workspaceScope === 'component',
      });
      isNewClip = true;
    }

    let nextClip = clip;
    let totalCaptured = 0;
    for (const node of targetNodes) {
      const canonicalNode = canonicalById.get(node.id) ?? node;
      const snap = captureNodeKeyframeSnapshot(nextClip, node, playheadMs, {
        baselineNode: canonicalNode,
        properties,
        easing: 'ease-out',
      });
      nextClip = snap.clip;
      totalCaptured += snap.capturedProperties.length;
    }

    const result = isNewClip
      ? commandClient.createAnimationClip(nextClip, 'Create clip & keyframe selection')
      : commandClient.updateAnimationClip(nextClip, 'Keyframe all properties for selection');

    if (result.status === 'applied') {
      if (isNewClip) setActiveClipId(nextClip.id);
      setPreviewActive(true);
      onNotice(
        `Keyframed ${targetNodes.length} layer${targetNodes.length === 1 ? '' : 's'} (${totalCaptured} properties) at ${(playheadMs / 1000).toFixed(2)}s.`,
      );
    }
  }, [selectedNodeIds, animatedMainDocument.nodes, activePage, activeClip, pageClips.length, playheadMs, commandClient, onNotice]);

  const keyframeShapeMorph = useCallback((presetId?: MorphShapePresetId) => {
    const animatedById = new Map(animatedMainDocument.nodes.map((node) => [node.id, node]));
    const canonicalById = new Map(activePage.document.nodes.map((node) => [node.id, node]));
    const selectedNodes = selectedNodeIds
      .map((id) => animatedById.get(id) ?? canonicalById.get(id))
      .filter((node): node is DesignNode => Boolean(node));

    if (selectedNodes.length === 0) {
      onNotice('Select a closed vector shape (Circle, Rectangle, Frame, or closed Path) to enable Shape Morph.');
      return;
    }

    const supportedNodes: DesignNode[] = [];
    let firstUnsupportedReason: string | null = null;
    for (const node of selectedNodes) {
      const check = checkNodeMorphSupport(node);
      if (check.supported) {
        supportedNodes.push(node);
      } else if (!firstUnsupportedReason) {
        firstUnsupportedReason = check.message;
      }
    }

    if (supportedNodes.length === 0) {
      onNotice(firstUnsupportedReason ?? 'Selected layer does not support Shape Morph.');
      return;
    }

    let clip = activeClip;
    let isNewClip = false;
    if (!clip) {
      clip = createAnimationClip({
        pageId: activePage.id,
        name: `Clip ${pageClips.length + 1}`,
        durationMs: Math.max(1200, playheadMs),
        autoplay: true,
        loop: workspaceScope === 'component',
      });
      isNewClip = true;
    }

    let nextClip = clip;
    for (const node of supportedNodes) {
      const canonicalNode = canonicalById.get(node.id) ?? node;
      const snapshotValue = presetId
        ? createMorphPresetSnapshot(presetId, node.width, node.height)
        : extractMorphSnapshotFromNode(node);
      if (!snapshotValue) continue;

      const existingTrack = nextClip.tracks.find(
        (track) => track.targetNodeId === node.id && track.property === 'pathMorph',
      );
      if (!existingTrack) {
        const baselineSnap = extractMorphSnapshotFromNode(canonicalNode) ?? snapshotValue;
        const seeded = captureNodeKeyframeSnapshot(nextClip, node, playheadMs, {
          baselineNode: canonicalNode,
          properties: ['pathMorph'],
          easing: 'ease-out',
        });
        nextClip = seeded.clip;
        const createdTrack = nextClip.tracks.find(
          (track) => track.targetNodeId === node.id && track.property === 'pathMorph',
        );
        if (createdTrack && presetId) {
          nextClip = upsertKeyframeInClip(
            nextClip,
            createdTrack.id,
            playheadMs,
            snapshotValue,
            playheadMs === 0 ? 'linear' : 'ease-out',
          ).clip;
          if (playheadMs > 0) {
            nextClip = upsertKeyframeInClip(
              nextClip,
              createdTrack.id,
              0,
              baselineSnap,
              'linear',
            ).clip;
          }
        }
      } else {
        nextClip = upsertKeyframeInClip(
          nextClip,
          existingTrack.id,
          playheadMs,
          snapshotValue,
          playheadMs === 0 ? 'linear' : 'ease-out',
        ).clip;
      }
    }

    const description = presetId
      ? `Morph shape to ${presetId} at ${(playheadMs / 1000).toFixed(2)}s`
      : `Add Shape Morph keyframe at ${(playheadMs / 1000).toFixed(2)}s`;

    const result = isNewClip
      ? commandClient.createAnimationClip(nextClip, description)
      : commandClient.updateAnimationClip(nextClip, description);

    if (result.status === 'applied') {
      if (isNewClip) setActiveClipId(nextClip.id);
      setPreviewActive(true);
      onNotice(
        `Shape Morph keyframed on ${supportedNodes.length} shape${supportedNodes.length === 1 ? '' : 's'} at ${(playheadMs / 1000).toFixed(2)}s (same node ID preserved).`,
      );
    }
  }, [
    selectedNodeIds,
    animatedMainDocument.nodes,
    activePage,
    activeClip,
    pageClips.length,
    playheadMs,
    commandClient,
    onNotice,
  ]);

  const importShapeMorphFromComponent = useCallback((
    component: ComponentDefinition,
    designTokens?: DesignTokenCollection,
    options?: { targetNodeId?: string; atTimeMs?: number },
  ) => {
    const animatedById = new Map(animatedMainDocument.nodes.map((node) => [node.id, node]));
    const canonicalById = new Map(activePage.document.nodes.map((node) => [node.id, node]));
    const targetIds = options?.targetNodeId ? [options.targetNodeId] : selectedNodeIds;
    const candidateNodes = targetIds
      .map((id) => animatedById.get(id) ?? canonicalById.get(id))
      .filter((node): node is DesignNode => Boolean(node));

    if (candidateNodes.length === 0) {
      onNotice('Select a closed vector shape (Circle, Rectangle, Frame, or closed Path) to morph from a component.');
      return;
    }

    const supportedNodes: DesignNode[] = [];
    let firstUnsupportedReason: string | null = null;
    for (const node of candidateNodes) {
      const check = checkNodeMorphSupport(node);
      if (check.supported) {
        supportedNodes.push(node);
      } else if (!firstUnsupportedReason) {
        firstUnsupportedReason = check.message;
      }
    }

    if (supportedNodes.length === 0) {
      onNotice(firstUnsupportedReason ?? 'Selected layer does not support Shape Morph.');
      return;
    }

    const startTimeMs = Math.max(0, Math.round(options?.atTimeMs ?? playheadMs));
    const extractions = supportedNodes.map((node) => ({
      node,
      canonicalNode: canonicalById.get(node.id) ?? node,
      result: extractMorphSequenceFromComponent(component, node.width, node.height, designTokens),
    }));

    const firstSuccess = extractions.find((entry) => entry.result.ok);
    if (!firstSuccess || !firstSuccess.result.ok) {
      const firstError = extractions.find((entry) => !entry.result.ok);
      onNotice(
        firstError && !firstError.result.ok
          ? firstError.result.message
          : `Component “${component.name}” has no supported closed vector shape to morph into.`,
      );
      return;
    }

    const importedSpanMs = firstSuccess.result.durationMs;
    const requiredDurationMs = Math.min(60000, Math.max(1200, startTimeMs + importedSpanMs));

    let clip = activeClip;
    let isNewClip = false;
    if (!clip) {
      clip = createAnimationClip({
        pageId: activePage.id,
        name: `Clip ${pageClips.length + 1}`,
        durationMs: requiredDurationMs,
        autoplay: true,
        loop: workspaceScope === 'component',
      });
      isNewClip = true;
    }

    let nextClip: AnimationClip =
      requiredDurationMs > clip.durationMs
        ? { ...clip, durationMs: requiredDurationMs, updatedAt: new Date().toISOString() }
        : clip;

    let importedKeyframeCount = 0;
    let importedKind = firstSuccess.result.sourceKind;
    let appliedNodeCount = 0;

    for (const { node, canonicalNode, result } of extractions) {
      if (!result.ok || result.keyframes.length === 0) continue;
      appliedNodeCount += 1;
      importedKeyframeCount = result.keyframes.length;
      importedKind = result.sourceKind;

      let track = nextClip.tracks.find(
        (candidate) => candidate.targetNodeId === node.id && candidate.property === 'pathMorph',
      );
      if (!track) {
        const baselineSnap = extractMorphSnapshotFromNode(canonicalNode) ?? result.keyframes[0].value;
        const seeded = captureNodeKeyframeSnapshot(nextClip, node, startTimeMs, {
          baselineNode: canonicalNode,
          properties: ['pathMorph'],
          easing: 'ease-out',
        });
        nextClip = seeded.clip;
        track = nextClip.tracks.find(
          (candidate) => candidate.targetNodeId === node.id && candidate.property === 'pathMorph',
        );
        if (track && startTimeMs > 0) {
          nextClip = upsertKeyframeInClip(nextClip, track.id, 0, baselineSnap, 'linear').clip;
        }
      }
      if (!track) continue;

      for (let idx = 0; idx < result.keyframes.length; idx += 1) {
        const kf = result.keyframes[idx];
        const targetTime = Math.min(nextClip.durationMs, startTimeMs + kf.offsetMs);
        const easing =
          idx === 0 && startTimeMs > 0
            ? 'ease-out'
            : targetTime === 0
              ? 'linear'
              : kf.easing;
        nextClip = upsertKeyframeInClip(nextClip, track.id, targetTime, kf.value, easing).clip;
      }
    }

    if (appliedNodeCount === 0) return;

    const isAnimatedImport = importedKind !== 'static' && importedKeyframeCount > 1;
    const description = isAnimatedImport
      ? `Import animated SVG morph from component “${component.name}” (${importedKeyframeCount} keyframes)`
      : `Morph shape from component “${component.name}” at ${(startTimeMs / 1000).toFixed(2)}s`;

    const commitResult = isNewClip
      ? commandClient.createAnimationClip(nextClip, description)
      : commandClient.updateAnimationClip(nextClip, description);

    if (commitResult.status === 'applied') {
      if (isNewClip) setActiveClipId(nextClip.id);
      setPreviewActive(true);
      onNotice(
        isAnimatedImport
          ? `Imported animated SVG morph from “${component.name}” (${importedKeyframeCount} keyframes) at ${(startTimeMs / 1000).toFixed(2)}s (same node ID preserved).`
          : `Imported shape from component “${component.name}” at ${(startTimeMs / 1000).toFixed(2)}s (same node ID preserved).`,
      );
    }
  }, [
    selectedNodeIds,
    animatedMainDocument.nodes,
    activePage,
    activeClip,
    pageClips.length,
    playheadMs,
    workspaceScope,
    commandClient,
    onNotice,
  ]);

  const recordAutoKeyNodes = useCallback((
    afterNodes: readonly DesignNode[],
    description = 'Auto-keyframe layer change',
    coalesceKey?: string,
  ): AutoKeyCaptureResult => {
    if (!motionOpen || !autoKeyEnabled || afterNodes.length === 0) {
      return { captured: false, keepCanonicalUnchanged: false };
    }
    if (isPlaying) {
      setIsPlaying(false);
    }

    const animatedById = new Map(animatedMainDocument.nodes.map((node) => [node.id, node]));
    const canonicalById = new Map(activePage.document.nodes.map((node) => [node.id, node]));

    // At 0ms: keep normal editing friction-free; only sync 0ms keyframes for layers that already have tracks.
    // Protect canonical primitive nodes (ellipse/rect/frame) from being overwritten by transient projected PathNodes.
    if (playheadMs <= 0) {
      if (!activeClip) return { captured: false, keepCanonicalUnchanged: false };
      let nextClip = activeClip;
      let anyUpdated = false;
      let protectCanonicalType = false;
      for (const afterNode of afterNodes) {
        const hasTracks = nextClip.tracks.some((track) => track.targetNodeId === afterNode.id);
        if (!hasTracks) continue;
        const canonicalNode = canonicalById.get(afterNode.id);
        const beforeNode = animatedById.get(afterNode.id) ?? canonicalNode;
        if (!beforeNode) continue;
        if (canonicalNode && canonicalNode.type !== afterNode.type) {
          protectCanonicalType = true;
        }
        const auto = applyAutoKeyFromNodeChange(nextClip, beforeNode, afterNode, 0, {
          baselineNode: canonicalNode ?? beforeNode,
          easing: 'linear',
        });
        if (auto.recorded) {
          nextClip = auto.clip;
          anyUpdated = true;
        }
      }
      if (anyUpdated) {
        commandClient.updateAnimationClip(nextClip, `${description} (0.00s)`, coalesceKey);
      }
      return { captured: anyUpdated, keepCanonicalUnchanged: anyUpdated && protectCanonicalType };
    }

    // At playheadMs > 0: Auto-Key captures full object state at playheadMs and preserves 0ms canonical pose!
    let clip = activeClip;
    let isNewClip = false;
    if (!clip) {
      clip = createAnimationClip({
        pageId: activePage.id,
        name: `Clip ${pageClips.length + 1}`,
        durationMs: Math.max(1200, playheadMs),
        autoplay: true,
        loop: workspaceScope === 'component',
      });
      isNewClip = true;
    }

    let nextClip = clip;
    let anyRecorded = false;
    let lastChangedCount = 0;

    for (const afterNode of afterNodes) {
      const beforeNode = animatedById.get(afterNode.id) ?? canonicalById.get(afterNode.id);
      const baselineNode = canonicalById.get(afterNode.id) ?? beforeNode;
      if (!beforeNode || !baselineNode) continue;
      const auto = applyAutoKeyFromNodeChange(nextClip, beforeNode, afterNode, playheadMs, {
        baselineNode,
        easing: 'ease-out',
      });
      if (auto.recorded) {
        nextClip = auto.clip;
        anyRecorded = true;
        lastChangedCount += auto.changedProperties.length;
      }
    }

    if (!anyRecorded) {
      return { captured: false, keepCanonicalUnchanged: false };
    }

    const result = isNewClip
      ? commandClient.createAnimationClip(nextClip, description)
      : commandClient.updateAnimationClip(nextClip, description, coalesceKey);

    if (result.status === 'applied') {
      if (isNewClip) setActiveClipId(nextClip.id);
      setPreviewActive(true);
      if (!coalesceKey) {
        onNotice(
          `Auto-keyed at ${(playheadMs / 1000).toFixed(2)}s (${lastChangedCount} changed · full object state saved).`,
        );
      }
      return { captured: true, keepCanonicalUnchanged: true };
    }

    return { captured: false, keepCanonicalUnchanged: false };
  }, [
    motionOpen,
    autoKeyEnabled,
    isPlaying,
    playheadMs,
    animatedMainDocument.nodes,
    activePage.document.nodes,
    activePage.id,
    activeClip,
    pageClips.length,
    commandClient,
    onNotice,
  ]);

  return {
    motionOpen,
    autoKeyEnabled,
    pageClips,
    activeClip,
    playheadMs,
    isPlaying,
    previewActive,
    animatedMainDocument,
    toggleMotionOpen,
    toggleAutoKey,
    closeMotion,
    selectClip,
    play,
    pause,
    exitPreview,
    togglePlay,
    stop,
    seek,
    createNewClip,
    applyPreset,
    deleteActiveClip,
    updateClip,
    updateCustomEasings,
    keyframeSelectedLayers,
    keyframeShapeMorph,
    importShapeMorphFromComponent,
    togglePropertyKeyframe,
    isPropertyKeyedAtPlayhead,
    recordAutoKeyNodes,
  };
}
