import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  AnimatableProperty,
  AnimationClip,
  DesignNode,
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
  type MotionPresetDefinition,
} from '../../engines/animation';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';

export interface UseMotionPlaybackOptions {
  project: FolioProjectV2;
  activePage: FolioPage;
  selectedNodeIds: readonly string[];
  mainCommandClient: MainCanvasCommandClient;
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
  togglePlay: () => void;
  stop: () => void;
  seek: (ms: number) => void;
  createNewClip: () => void;
  applyPreset: (presetId: MotionPresetDefinition['id']) => void;
  deleteActiveClip: () => void;
  updateClip: (nextClip: AnimationClip, description?: string) => void;
  keyframeSelectedLayers: (properties?: readonly AnimatableProperty[]) => void;
  recordAutoKeyNodes: (afterNodes: readonly DesignNode[], description?: string) => AutoKeyCaptureResult;
}

export function useMotionPlayback({
  project,
  activePage,
  selectedNodeIds,
  mainCommandClient,
  onNotice,
}: UseMotionPlaybackOptions): MotionPlaybackController {
  const [motionOpen, setMotionOpen] = useState(false);
  const [autoKeyEnabled, setAutoKeyEnabled] = useState(true);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);

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

  // Keep activeClipId aligned with page clips & reset playback cleanly on page switch.
  const prevPageIdRef = useRef(activePage.id);
  useEffect(() => {
    if (prevPageIdRef.current !== activePage.id) {
      prevPageIdRef.current = activePage.id;
      setIsPlaying(false);
      setPreviewActive(false);
      setPlayheadMs(0);
    }
  }, [activePage.id]);

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
    let lastTs: number | null = null;
    const duration = Math.max(100, activeClip.durationMs);
    const loop = activeClip.loop;

    const tick = (ts: number) => {
      if (lastTs === null) {
        lastTs = ts;
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      const delta = Math.max(0, Math.min(100, ts - lastTs));
      lastTs = ts;

      let shouldContinue = true;
      setPlayheadMs((prev) => {
        const next = prev + delta;
        if (next >= duration) {
          if (loop) return Math.round(next % duration);
          shouldContinue = false;
          return duration;
        }
        return Math.round(next);
      });

      if (shouldContinue) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
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
    setPlayheadMs(0);
    setPreviewActive(false);
  }, []);

  const play = useCallback(() => {
    if (!activeClip) return;
    setPreviewActive(true);
    setPlayheadMs((current) => (current >= activeClip.durationMs ? 0 : current));
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
    setPlayheadMs(0);
    setPreviewActive(false);
  }, []);

  const seek = useCallback((ms: number) => {
    const duration = activeClip?.durationMs ?? 1200;
    const clamped = Math.max(0, Math.min(duration, Math.round(ms)));
    setIsPlaying(false);
    setPlayheadMs(clamped);
    setPreviewActive(true);
  }, [activeClip?.durationMs]);

  const createNewClip = useCallback(() => {
    const name = `Clip ${pageClips.length + 1}`;
    const clip = createAnimationClip({ pageId: activePage.id, name, durationMs: 1200, autoplay: true });
    const result = mainCommandClient.createAnimationClip(clip, `Create animation clip "${name}"`);
    if (result.status === 'applied') {
      setActiveClipId(clip.id);
      setPlayheadMs(0);
      setIsPlaying(false);
      setPreviewActive(false);
      onNotice(`Created animation clip "${name}".`);
    }
  }, [activePage.id, pageClips.length, mainCommandClient, onNotice]);

  const applyPreset = useCallback((presetId: MotionPresetDefinition['id']) => {
    const presetClip = { ...buildPresetClipForPage(activePage, presetId, selectedNodeIds), autoplay: true };
    const existingCount = pageClips.filter((c) => c.name.startsWith(presetClip.name)).length;
    const namedClip: AnimationClip = existingCount > 0
      ? { ...presetClip, name: `${presetClip.name} ${existingCount + 1}` }
      : presetClip;

    const result = mainCommandClient.createAnimationClip(namedClip, `Apply ${namedClip.name} preset`);
    if (result.status === 'applied') {
      setActiveClipId(namedClip.id);
      setPlayheadMs(0);
      setPreviewActive(true);
      setIsPlaying(true);
      onNotice(`Applied "${namedClip.name}" motion preset.`);
    }
  }, [activePage, selectedNodeIds, pageClips, mainCommandClient, onNotice]);

  const deleteActiveClip = useCallback(() => {
    if (!activeClip) return;
    const removedName = activeClip.name;
    const result = mainCommandClient.deleteAnimationClip(activeClip.id, `Delete animation clip "${removedName}"`);
    if (result.status === 'applied') {
      setIsPlaying(false);
      setPlayheadMs(0);
      setPreviewActive(false);
      onNotice(`Deleted animation clip "${removedName}".`);
    }
  }, [activeClip, mainCommandClient, onNotice]);

  const updateClip = useCallback((nextClip: AnimationClip, description = 'Update animation clip') => {
    mainCommandClient.updateAnimationClip(nextClip, description);
  }, [mainCommandClient]);

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
      clip = createAnimationClip({ pageId: activePage.id, name: `Clip ${pageClips.length + 1}`, durationMs: 1200, autoplay: true });
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
      ? mainCommandClient.createAnimationClip(nextClip, 'Create clip & keyframe selection')
      : mainCommandClient.updateAnimationClip(nextClip, 'Keyframe all properties for selection');

    if (result.status === 'applied') {
      if (isNewClip) setActiveClipId(nextClip.id);
      setPreviewActive(true);
      onNotice(
        `Keyframed ${targetNodes.length} layer${targetNodes.length === 1 ? '' : 's'} (${totalCaptured} properties) at ${(playheadMs / 1000).toFixed(2)}s.`,
      );
    }
  }, [selectedNodeIds, animatedMainDocument.nodes, activePage, activeClip, pageClips.length, playheadMs, mainCommandClient, onNotice]);

  const recordAutoKeyNodes = useCallback((
    afterNodes: readonly DesignNode[],
    description = 'Auto-keyframe layer change',
  ): AutoKeyCaptureResult => {
    if (!motionOpen || !autoKeyEnabled || isPlaying || afterNodes.length === 0) {
      return { captured: false, keepCanonicalUnchanged: false };
    }

    const animatedById = new Map(animatedMainDocument.nodes.map((node) => [node.id, node]));
    const canonicalById = new Map(activePage.document.nodes.map((node) => [node.id, node]));

    // At 0ms: keep normal editing friction-free; only sync 0ms keyframes for layers that already have tracks.
    if (playheadMs <= 0) {
      if (!activeClip) return { captured: false, keepCanonicalUnchanged: false };
      let nextClip = activeClip;
      let anyUpdated = false;
      for (const afterNode of afterNodes) {
        const hasTracks = nextClip.tracks.some((track) => track.targetNodeId === afterNode.id);
        if (!hasTracks) continue;
        const beforeNode = animatedById.get(afterNode.id) ?? canonicalById.get(afterNode.id);
        if (!beforeNode) continue;
        const auto = applyAutoKeyFromNodeChange(nextClip, beforeNode, afterNode, 0, {
          baselineNode: canonicalById.get(afterNode.id) ?? beforeNode,
          easing: 'linear',
        });
        if (auto.recorded) {
          nextClip = auto.clip;
          anyUpdated = true;
        }
      }
      if (anyUpdated) {
        mainCommandClient.updateAnimationClip(nextClip, `${description} (0.00s)`);
      }
      return { captured: anyUpdated, keepCanonicalUnchanged: false };
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
      ? mainCommandClient.createAnimationClip(nextClip, description)
      : mainCommandClient.updateAnimationClip(nextClip, description);

    if (result.status === 'applied') {
      if (isNewClip) setActiveClipId(nextClip.id);
      setPreviewActive(true);
      onNotice(
        `Auto-keyed at ${(playheadMs / 1000).toFixed(2)}s (${lastChangedCount} changed · full object state saved).`,
      );
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
    mainCommandClient,
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
    togglePlay,
    stop,
    seek,
    createNewClip,
    applyPreset,
    deleteActiveClip,
    updateClip,
    keyframeSelectedLayers,
    recordAutoKeyNodes,
  };
}
