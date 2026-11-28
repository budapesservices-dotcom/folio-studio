import { useCallback, useMemo, useState } from 'preact/hooks';
import type { DesignNode, MotionPathBinding } from '../../core/document/types';
import {
  applyMotionPathEditAtTime,
  evaluateMotionPathBindingAtTime,
  sampleMotionPathVelocityDots,
  type MotionPathSpacingDot,
} from '../../core/document/pathStudio';
import { parsePathMorphSnapshot, updateMorphSnapshotOptions } from '../../core/document/pathMorph';
import type { MorphCorrespondenceMeta, MotionPathPointSelection } from '../../engines/canvas/MotionPathOverlay';
import {
  evaluateEasing,
  evaluateTrackAtTime,
  hasActiveMotionPathForNode,
  updateKeyframeInClip,
  upsertMotionPathInClip,
} from '../../engines/animation';
import type { MotionPlaybackController } from './useMotionPlayback';

export interface UseCanvasPathStudioBridgeOptions {
  motion: MotionPlaybackController;
  inspectorSelectedNode: DesignNode | null;
  setNotice: (message: string) => void;
}

export function useCanvasPathStudioBridge({
  motion,
  inspectorSelectedNode,
  setNotice,
}: UseCanvasPathStudioBridgeOptions) {
  const [selectedMotionPathPoint, setSelectedMotionPathPoint] = useState<MotionPathPointSelection | null>(null);
  const [showMorphCorrespondence, setShowMorphCorrespondence] = useState(false);

  const toggleMorphCorrespondence = useCallback(() => {
    setShowMorphCorrespondence((v) => !v);
  }, []);

  const activeCanvasMotionPaths = useMemo(
    () =>
      motion.motionOpen && motion.activeClip?.motionPaths && motion.activeClip.motionPaths.length > 0
        ? motion.activeClip.motionPaths.map((mp) =>
            evaluateMotionPathBindingAtTime(mp, motion.playheadMs, evaluateEasing),
          )
        : undefined,
    [motion.motionOpen, motion.activeClip?.motionPaths, motion.playheadMs],
  );

  const motionPathSpacingDotsByNodeId = useMemo<
    Readonly<Record<string, readonly MotionPathSpacingDot[]>> | undefined
  >(() => {
    if (!motion.motionOpen || !motion.activeClip || !activeCanvasMotionPaths || activeCanvasMotionPaths.length === 0) {
      return undefined;
    }
    const clip = motion.activeClip;
    const durationMs = Math.max(100, clip.durationMs);
    const result: Record<string, readonly MotionPathSpacingDot[]> = {};
    for (const binding of activeCanvasMotionPaths) {
      if (binding.visible === false || binding.points.length < 2) continue;
      const progressTrack = clip.tracks.find(
        (t) => t.targetNodeId === binding.targetNodeId && t.property === 'motionPathProgress',
      );
      result[binding.targetNodeId] = sampleMotionPathVelocityDots(binding, {
        durationMs,
        sampleCount: 22,
        evaluateProgressAtTime: progressTrack
          ? (timeMs) => {
              const val = evaluateTrackAtTime(progressTrack, timeMs);
              return typeof val === 'number' && Number.isFinite(val) ? val : (timeMs / durationMs) * 100;
            }
          : undefined,
      });
    }
    return result;
  }, [motion.motionOpen, motion.activeClip, activeCanvasMotionPaths]);

  const morphCorrespondenceMetaByNodeId = useMemo<
    Readonly<Record<string, MorphCorrespondenceMeta>> | undefined
  >(() => {
    if (!motion.motionOpen || !showMorphCorrespondence || !motion.activeClip) return undefined;
    const result: Record<string, MorphCorrespondenceMeta> = {};
    for (const track of motion.activeClip.tracks) {
      if (track.property !== 'pathMorph' || track.keyframes.length === 0) continue;
      const exact = track.keyframes.find((kf) => Math.abs(kf.timeMs - motion.playheadMs) <= 25);
      let activeKf = exact ?? track.keyframes[0];
      if (!exact) {
        for (const kf of track.keyframes) {
          if (kf.timeMs <= motion.playheadMs) activeKf = kf;
        }
      }
      if (typeof activeKf.value !== 'string') continue;
      const parsed = parsePathMorphSnapshot(activeKf.value);
      if (parsed?.morph) {
        result[track.targetNodeId] = {
          startOffset: parsed.morph.startOffset ?? 0,
          reverse: Boolean(parsed.morph.reverse),
        };
      }
    }
    return result;
  }, [motion.motionOpen, showMorphCorrespondence, motion.activeClip, motion.playheadMs]);

  const handlePickMorphStartVertex = useCallback(
    (nodeId: string, shiftDelta: number, vertexCount: number) => {
      if (!motion.activeClip || vertexCount <= 0) return;
      const track = motion.activeClip.tracks.find(
        (t) => t.targetNodeId === nodeId && t.property === 'pathMorph' && t.keyframes.length > 0,
      );
      if (!track) {
        setNotice('Add a Shape Morph keyframe first to pick a custom start vertex (#1).');
        return;
      }
      if (shiftDelta === 0) {
        setNotice('Vertex #1 is already the active Morph start point.');
        return;
      }
      const exact = track.keyframes.find((kf) => Math.abs(kf.timeMs - motion.playheadMs) <= 25);
      let activeKf = exact ?? track.keyframes[0];
      if (!exact) {
        for (const kf of track.keyframes) {
          if (kf.timeMs <= motion.playheadMs) activeKf = kf;
        }
      }
      if (typeof activeKf.value !== 'string') return;
      const parsed = parsePathMorphSnapshot(activeKf.value);
      if (!parsed) return;
      const currentOffset = parsed.morph?.startOffset ?? 0;
      const nextOffset = (((currentOffset + shiftDelta) % vertexCount) + vertexCount) % vertexCount;
      const updatedValue = updateMorphSnapshotOptions(activeKf.value, { startOffset: nextOffset });
      if (!updatedValue) return;
      const nextClip = updateKeyframeInClip(motion.activeClip, track.id, activeKf.id, {
        value: updatedValue,
      });
      motion.updateClip(nextClip, 'Pick Shape Morph start vertex on Canvas');
      setNotice(`Morph start point (#1) shifted by ${nextOffset === 0 ? '0 (reset)' : `+${nextOffset}`}.`);
    },
    [motion.activeClip, motion.playheadMs, motion.updateClip, setNotice],
  );

  const handleUpdateCanvasMotionPath = useCallback(
    (binding: MotionPathBinding, options?: { coalesceKey?: string; description?: string }) => {
      if (!motion.activeClip) return;
      const existing = motion.activeClip.motionPaths?.find(
        (mp) => mp.targetNodeId === binding.targetNodeId,
      );
      const nextBinding =
        existing && existing.pathKeyframes && existing.pathKeyframes.length > 0
          ? applyMotionPathEditAtTime(
              { ...existing, ...binding, pathKeyframes: existing.pathKeyframes },
              motion.playheadMs,
              binding.points,
              evaluateEasing,
            )
          : binding;
      const nextClip = upsertMotionPathInClip(motion.activeClip, nextBinding, {
        ensureProgressTrack: true,
      });
      motion.updateClip(nextClip, options?.description ?? 'Edit Motion Path', options?.coalesceKey);
    },
    [motion.activeClip, motion.playheadMs, motion.updateClip],
  );

  const positionLockedByMotionPath = Boolean(
    motion.motionOpen &&
      inspectorSelectedNode &&
      hasActiveMotionPathForNode(motion.activeClip, inspectorSelectedNode.id),
  );

  const autoOrientByMotionPath = Boolean(
    motion.motionOpen &&
      inspectorSelectedNode &&
      motion.activeClip?.motionPaths?.some(
        (mp) =>
          mp.targetNodeId === inspectorSelectedNode.id &&
          mp.points.length >= 2 &&
          mp.autoOrient,
      ),
  );

  return {
    selectedMotionPathPoint,
    setSelectedMotionPathPoint,
    showMorphCorrespondence,
    toggleMorphCorrespondence,
    activeCanvasMotionPaths,
    motionPathSpacingDotsByNodeId,
    morphCorrespondenceMetaByNodeId,
    handlePickMorphStartVertex,
    handleUpdateCanvasMotionPath,
    positionLockedByMotionPath,
    autoOrientByMotionPath,
  };
}

export type CanvasPathStudioBridge = ReturnType<typeof useCanvasPathStudioBridge>;
