import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AnimatableProperty,
  AnimationClip,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  MotionPathBinding,
  MotionPathLoopMode,
  PathNode,
  TrimPathMode,
  VectorPointType,
} from '../../core/document/types';
import {
  applyMotionPathEditAtTime,
  createDefaultMotionPathForNode,
  createMotionPathFromPathNode,
  evaluateMotionPathBindingAtTime,
  hasMotionPathShapeKeyframeAtTime,
  insertMotionPathPointOnSegment,
  removeMotionPathPoint,
  removeMotionPathShapeKeyframe,
  setMotionPathPointType,
  upsertMotionPathShapeKeyframe,
} from '../../core/document/pathStudio';
import {
  MORPH_SHAPE_PRESETS,
  checkNodeMorphSupport,
  extractMorphSnapshotFromNode,
  parsePathMorphSnapshot,
  updateMorphSnapshotOptions,
  type MorphShapePresetId,
} from '../../core/document/pathMorph';
import {
  applyMorphPresetInClip,
  applyStaggeredMotionPathInClip,
  applyStaggeredTrimPathInClip,
  canConvertXYTracksToMotionPath,
  createAnimationClip,
  createMotionPathFromXYTracks,
  enableTrimPathInClip,
  evaluateEasing,
  evaluateTrackAtTime,
  getDefaultNodePropertyValue,
  hasKeyframeAtTime,
  inspectComponentMorphSource,
  removeMotionPathFromClip,
  setNodeTrimModeInClip,
  setSingleChannelKeyframeInClip,
  togglePropertyKeyframeInClip,
  updateKeyframeInClip,
  upsertKeyframeInClip,
  upsertMotionPathInClip,
} from '../../engines/animation';
import type { MotionPathPointSelection } from '../../engines/canvas/MotionPathOverlay';

export type PathStudioTab = 'motion-path' | 'shape-morph' | 'trim-path';

export interface PathStudioControlsProps {
  workspaceScope: 'main' | 'component';
  activePage: FolioPage;
  activeClip: AnimationClip | null;
  pageClipsCount: number;
  selectedNodeIds: readonly string[];
  playheadMs: number;
  components?: readonly ComponentDefinition[];
  designTokens?: DesignTokenCollection;
  selectedMotionPathPoint: MotionPathPointSelection | null;
  onSelectMotionPathPoint?: (selection: MotionPathPointSelection | null) => void;
  onUpdateClip: (nextClip: AnimationClip, description?: string, coalesceKey?: string) => void;
  onKeyframePathMorph?: () => void;
  onImportMorphFromComponent?: (
    component: ComponentDefinition,
    options?: { targetNodeId?: string; atTimeMs?: number },
  ) => void;
  onEditMorphPoints?: (nodeId: string) => void;
  onOpenSpeedCurve?: (
    nodeId: string,
    preferredProp?: AnimatableProperty,
    preferredView?: 'easing' | 'value' | 'speed',
  ) => void;
  showMorphCorrespondence?: boolean;
  onToggleMorphCorrespondence?: () => void;
  onPathShapeKeyAdded?: (nodeId: string) => void;
  onSeek?: (ms: number) => void;
}

function supportsTrimPathNode(node: DesignNode | null | undefined): boolean {
  if (!node) return false;
  return node.type === 'path' || node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse';
}

export function PathStudioControls({
  workspaceScope,
  activePage,
  activeClip,
  pageClipsCount,
  selectedNodeIds,
  playheadMs,
  components = [],
  designTokens,
  selectedMotionPathPoint,
  onSelectMotionPathPoint,
  onUpdateClip,
  onKeyframePathMorph,
  onImportMorphFromComponent,
  onEditMorphPoints,
  onOpenSpeedCurve,
  showMorphCorrespondence = false,
  onToggleMorphCorrespondence,
  onPathShapeKeyAdded,
}: PathStudioControlsProps) {
  const [activeTab, setActiveTab] = useState<PathStudioTab>('motion-path');
  const [staggerMs, setStaggerMs] = useState<number>(120);
  const [staggerOrder, setStaggerOrder] = useState<'selection' | 'reverse'>('selection');
  const prevTargetNodeIdRef = useRef<string | null>(null);

  const startLabelScrub = (
    event: JSX.TargetedPointerEvent<HTMLSpanElement>,
    options: {
      value: number;
      min: number;
      max: number;
      step: number;
      pixelsPerStep?: number;
      onValue: (nextVal: number) => void;
    },
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startVal = options.value;
    const pxPerStep = options.pixelsPerStep ?? 6;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'ew-resize';

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const precisionScale = moveEvent.shiftKey ? 0.2 : 1;
      const steps = Math.round((dx * precisionScale) / pxPerStep);
      const raw = startVal + steps * options.step;
      const clamped = Math.max(options.min, Math.min(options.max, raw));
      const rounded = Math.round(clamped * 10) / 10;
      options.onValue(rounded);
    };

    const handleUp = () => {
      document.body.style.cursor = prevCursor;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const nodes = activePage.document.nodes;
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const selectedDesignNodes = useMemo(
    () =>
      selectedNodeIds
        .map((id) => nodeById.get(id))
        .filter((n): n is DesignNode => Boolean(n)),
    [selectedNodeIds, nodeById],
  );

  const trimCapableSelection = useMemo(
    () => selectedDesignNodes.filter((n) => supportsTrimPathNode(n)),
    [selectedDesignNodes],
  );

  const targetNode: DesignNode | null = useMemo(() => {
    if (selectedDesignNodes.length > 0) return selectedDesignNodes[0];
    if (activeClip?.motionPaths?.[0]) {
      return nodeById.get(activeClip.motionPaths[0].targetNodeId) ?? null;
    }
    return null;
  }, [selectedDesignNodes, nodeById, activeClip]);

  const pathLayerSources = useMemo(
    () =>
      nodes.filter(
        (n): n is PathNode =>
          n.type === 'path' && n.points.length >= 2 && n.id !== targetNode?.id,
      ),
    [nodes, targetNode],
  );

  const componentMorphOptions = useMemo(
    () =>
      components.map((component) => ({
        component,
        info: inspectComponentMorphSource(component, designTokens),
      })),
    [components, designTokens],
  );

  const ensureClip = (): AnimationClip => {
    if (activeClip) return activeClip;
    return createAnimationClip({
      pageId: activePage.id,
      name: `Clip ${pageClipsCount + 1}`,
      durationMs: Math.max(1600, playheadMs),
      autoplay: true,
      loop: workspaceScope === 'component',
    });
  };

  // --- Motion Path state ---
  const motionBinding: MotionPathBinding | null = useMemo(() => {
    if (!activeClip || !targetNode) return null;
    return activeClip.motionPaths?.find((mp) => mp.targetNodeId === targetNode.id) ?? null;
  }, [activeClip, targetNode]);

  const canConvertFromXY = useMemo(
    () => !motionBinding && canConvertXYTracksToMotionPath(activeClip, targetNode),
    [motionBinding, activeClip, targetNode],
  );

  // Smart auto-switch tab ONLY when the selected layer changes (never overrides manual tab switches)
  useEffect(() => {
    const nextId = targetNode?.id ?? null;
    if (nextId === prevTargetNodeIdRef.current) return;
    prevTargetNodeIdRef.current = nextId;
    if (!nextId || !activeClip) return;
    const hasMp = Boolean(activeClip.motionPaths?.some((mp) => mp.targetNodeId === nextId && mp.points.length >= 2));
    if (hasMp) {
      setActiveTab('motion-path');
      return;
    }
    const hasMorph = activeClip.tracks.some((t) => t.targetNodeId === nextId && t.property === 'pathMorph' && t.keyframes.length > 0);
    if (hasMorph) {
      setActiveTab('shape-morph');
      return;
    }
    const hasTrim = activeClip.tracks.some(
      (t) =>
        t.targetNodeId === nextId &&
        (t.property === 'trimStart' || t.property === 'trimEnd' || t.property === 'trimOffset'),
    );
    if (hasTrim) {
      setActiveTab('trim-path');
    }
  }, [targetNode?.id, activeClip]);

  const evaluatedMotionBinding: MotionPathBinding | null = useMemo(() => {
    if (!motionBinding) return null;
    return evaluateMotionPathBindingAtTime(motionBinding, playheadMs, evaluateEasing);
  }, [motionBinding, playheadMs]);

  const motionPathShapeKeyCount = motionBinding?.pathKeyframes?.length ?? 0;
  const activeShapeKeyframe = useMemo(() => {
    if (!motionBinding?.pathKeyframes || motionBinding.pathKeyframes.length === 0) return null;
    return motionBinding.pathKeyframes.find((kf) => Math.abs(kf.timeMs - playheadMs) <= 15) ?? null;
  }, [motionBinding?.pathKeyframes, playheadMs]);
  const hasShapeKeyAtPlayhead = motionBinding
    ? hasMotionPathShapeKeyframeAtTime(motionBinding, playheadMs)
    : false;

  const mpChannelTracks = useMemo(() => {
    if (!activeClip || !targetNode) return { start: null, end: null, offset: null };
    return {
      start: activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'motionPathStart') ?? null,
      end: activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'motionPathEnd') ?? null,
      offset: activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'motionPathOffset') ?? null,
    };
  }, [activeClip, targetNode]);

  const liveMpStartVal = useMemo(() => {
    if (mpChannelTracks.start) {
      const v = evaluateTrackAtTime(mpChannelTracks.start, playheadMs);
      if (typeof v === 'number') return Math.round(v * 10) / 10;
    }
    return Math.round((motionBinding?.startPct ?? 0) * 10) / 10;
  }, [mpChannelTracks.start, playheadMs, motionBinding?.startPct]);

  const liveMpEndVal = useMemo(() => {
    if (mpChannelTracks.end) {
      const v = evaluateTrackAtTime(mpChannelTracks.end, playheadMs);
      if (typeof v === 'number') return Math.round(v * 10) / 10;
    }
    return Math.round((motionBinding?.endPct ?? 100) * 10) / 10;
  }, [mpChannelTracks.end, playheadMs, motionBinding?.endPct]);

  const liveMpOffsetVal = useMemo(() => {
    if (mpChannelTracks.offset) {
      const v = evaluateTrackAtTime(mpChannelTracks.offset, playheadMs);
      if (typeof v === 'number') return Math.round(v * 10) / 10;
    }
    return Math.round((motionBinding?.offsetPx ?? 0) * 10) / 10;
  }, [mpChannelTracks.offset, playheadMs, motionBinding?.offsetPx]);

  const activePointIndex = useMemo(() => {
    const pts = evaluatedMotionBinding?.points ?? [];
    if (pts.length === 0) return 0;
    if (
      selectedMotionPathPoint &&
      evaluatedMotionBinding &&
      selectedMotionPathPoint.nodeId === evaluatedMotionBinding.targetNodeId &&
      selectedMotionPathPoint.pointIndex >= 0 &&
      selectedMotionPathPoint.pointIndex < pts.length
    ) {
      return selectedMotionPathPoint.pointIndex;
    }
    return 0;
  }, [evaluatedMotionBinding, selectedMotionPathPoint]);

  const activePoint = evaluatedMotionBinding?.points[activePointIndex] ?? null;

  const commitMotionBinding = (
    nextBinding: MotionPathBinding,
    description: string,
    coalesceKey?: string,
  ) => {
    const baseClip = ensureClip();
    const nextClip = upsertMotionPathInClip(baseClip, nextBinding, {
      ensureProgressTrack: true,
    });
    onUpdateClip(nextClip, description, coalesceKey);
  };

  const handleAddMotionPath = () => {
    if (!targetNode) return;
    if (canConvertFromXY && activeClip) {
      const converted = createMotionPathFromXYTracks(activeClip, targetNode);
      if (converted) {
        const nextClip = upsertMotionPathInClip(activeClip, converted.binding, {
          ensureProgressTrack: true,
          initialProgressKeyframes: converted.progressKeyframes,
        });
        onUpdateClip(nextClip, `Convert X/Y keyframes to Motion Path on ${targetNode.name}`);
        onSelectMotionPathPoint?.({ nodeId: targetNode.id, pointIndex: 0 });
        return;
      }
    }
    const binding = createDefaultMotionPathForNode(targetNode);
    commitMotionBinding(binding, `Add Motion Path to ${targetNode.name}`);
    onSelectMotionPathPoint?.({ nodeId: targetNode.id, pointIndex: 0 });
  };

  const handleUsePathLayer = (sourcePathId: string) => {
    if (!targetNode || !sourcePathId) return;
    const sourceNode = pathLayerSources.find((p) => p.id === sourcePathId);
    if (!sourceNode) return;
    const binding = createMotionPathFromPathNode(targetNode.id, sourceNode);
    commitMotionBinding(binding, `Set Motion Path from ${sourceNode.name}`);
    onSelectMotionPathPoint?.({ nodeId: targetNode.id, pointIndex: 0 });
  };

  const handleRemoveMotionPath = () => {
    if (!activeClip || !targetNode) return;
    const nextClip = removeMotionPathFromClip(activeClip, targetNode.id);
    onUpdateClip(nextClip, `Remove Motion Path from ${targetNode.name}`);
    if (selectedMotionPathPoint?.nodeId === targetNode.id) {
      onSelectMotionPathPoint?.(null);
    }
  };

  const handleAddOrUpdatePathShapeKey = () => {
    if (!motionBinding || !evaluatedMotionBinding) return;
    const { binding: next } = upsertMotionPathShapeKeyframe(
      motionBinding,
      playheadMs,
      evaluatedMotionBinding.points,
      'ease-in-out',
      evaluateEasing,
    );
    commitMotionBinding(
      next,
      hasShapeKeyAtPlayhead
        ? `Update Motion Path shape key at ${Math.round(playheadMs)}ms`
        : `Add Motion Path shape key at ${Math.round(playheadMs)}ms`,
    );
    onPathShapeKeyAdded?.(motionBinding.targetNodeId);
  };

  const handleRemovePathShapeKey = () => {
    if (!motionBinding || !activeShapeKeyframe) return;
    const next = removeMotionPathShapeKeyframe(motionBinding, activeShapeKeyframe.id);
    commitMotionBinding(next, `Remove Motion Path shape key at ${Math.round(playheadMs)}ms`);
  };

  const handleSetMotionPathChannelValue = (
    property: 'motionPathStart' | 'motionPathEnd' | 'motionPathOffset',
    rawValue: number,
    coalesceKey: string,
  ) => {
    if (!motionBinding || !targetNode || !Number.isFinite(rawValue)) return;
    const clamped =
      property === 'motionPathOffset'
        ? Math.max(-4000, Math.min(4000, rawValue))
        : Math.max(0, Math.min(100, rawValue));

    const existingTrack =
      property === 'motionPathStart'
        ? mpChannelTracks.start
        : property === 'motionPathEnd'
          ? mpChannelTracks.end
          : mpChannelTracks.offset;

    if (existingTrack) {
      const baseClip = ensureClip();
      const nextClip = upsertKeyframeInClip(baseClip, existingTrack.id, playheadMs, clamped, 'ease-in-out').clip;
      onUpdateClip(nextClip, `Update ${property} on ${targetNode.name}`, coalesceKey);
      return;
    }

    const patch: Partial<MotionPathBinding> =
      property === 'motionPathStart'
        ? { startPct: clamped }
        : property === 'motionPathEnd'
          ? { endPct: clamped }
          : { offsetPx: clamped };
    commitMotionBinding({ ...motionBinding, ...patch }, `Update Motion Path ${property}`, coalesceKey);
  };

  const handleToggleMotionPathChannelKey = (
    property: 'motionPathStart' | 'motionPathEnd' | 'motionPathOffset',
  ) => {
    if (!motionBinding || !targetNode) return;
    const clip = ensureClip();
    const liveVal =
      property === 'motionPathStart'
        ? liveMpStartVal
        : property === 'motionPathEnd'
          ? liveMpEndVal
          : liveMpOffsetVal;
    const baseVal =
      property === 'motionPathStart'
        ? motionBinding.startPct
        : property === 'motionPathEnd'
          ? motionBinding.endPct
          : motionBinding.offsetPx;

    const toggled = togglePropertyKeyframeInClip(clip, targetNode, property, playheadMs, {
      baselineNode: targetNode,
      easing: 'ease-in-out',
      valueOverride: liveVal,
      baselineValueOverride: baseVal,
    });
    if (toggled.action === 'blocked') return;
    onUpdateClip(toggled.clip, `Toggle ${property} keyframe on ${targetNode.name}`);
  };

  const handleSetPointType = (pointType: VectorPointType) => {
    if (!motionBinding || !evaluatedMotionBinding) return;
    const edited = setMotionPathPointType(evaluatedMotionBinding, activePointIndex, pointType);
    const next =
      motionPathShapeKeyCount > 0
        ? applyMotionPathEditAtTime(motionBinding, playheadMs, edited.points, evaluateEasing)
        : edited;
    commitMotionBinding(next, `Set Motion Path point to ${pointType}`);
  };

  const handleInsertPoint = () => {
    if (!motionBinding || !evaluatedMotionBinding) return;
    const maxSeg = evaluatedMotionBinding.closed
      ? evaluatedMotionBinding.points.length - 1
      : Math.max(0, evaluatedMotionBinding.points.length - 2);
    const segIdx = Math.min(activePointIndex, maxSeg);
    const inserted = insertMotionPathPointOnSegment(evaluatedMotionBinding, segIdx, 0.5);
    if (inserted.insertedIndex < 0) return;
    const next =
      motionPathShapeKeyCount > 0
        ? applyMotionPathEditAtTime(motionBinding, playheadMs, inserted.binding.points, evaluateEasing)
        : inserted.binding;
    commitMotionBinding(next, 'Insert Motion Path point');
    onSelectMotionPathPoint?.({ nodeId: motionBinding.targetNodeId, pointIndex: inserted.insertedIndex });
  };

  const handleRemovePoint = () => {
    if (!motionBinding || !evaluatedMotionBinding || evaluatedMotionBinding.points.length <= 2) return;
    const edited = removeMotionPathPoint(evaluatedMotionBinding, activePointIndex);
    const next =
      motionPathShapeKeyCount > 0
        ? applyMotionPathEditAtTime(motionBinding, playheadMs, edited.points, evaluateEasing)
        : edited;
    commitMotionBinding(next, 'Remove Motion Path point');
    onSelectMotionPathPoint?.({
      nodeId: motionBinding.targetNodeId,
      pointIndex: Math.max(0, Math.min(activePointIndex - 1, edited.points.length - 1)),
    });
  };

  const handleApplyMotionPathStagger = () => {
    if (selectedDesignNodes.length < 2) return;
    const baseClip = ensureClip();
    const nextClip = applyStaggeredMotionPathInClip(baseClip, selectedDesignNodes, {
      staggerMs: Math.max(0, staggerMs),
      order: staggerOrder,
      sourceBinding: motionBinding ?? undefined,
    });
    onUpdateClip(
      nextClip,
      `Apply Staggered Motion Path (${selectedDesignNodes.length} layers, ${staggerMs}ms)`,
    );
  };

  // --- Shape Morph state ---
  const morphSupport = useMemo(
    () => (targetNode ? checkNodeMorphSupport(targetNode) : { supported: false, message: 'Select a vector shape.' }),
    [targetNode],
  );

  const morphTrack = useMemo(() => {
    if (!activeClip || !targetNode) return null;
    return activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'pathMorph') ?? null;
  }, [activeClip, targetNode]);

  const activeMorphKeyframe = useMemo(() => {
    if (!morphTrack || morphTrack.keyframes.length === 0) return null;
    const exact = morphTrack.keyframes.find((kf) => Math.abs(kf.timeMs - playheadMs) <= 25);
    if (exact) return exact;
    let best = morphTrack.keyframes[0];
    for (const kf of morphTrack.keyframes) {
      if (kf.timeMs <= playheadMs) best = kf;
    }
    return best;
  }, [morphTrack, playheadMs]);

  const activeMorphSnap = useMemo(
    () =>
      activeMorphKeyframe && typeof activeMorphKeyframe.value === 'string'
        ? parsePathMorphSnapshot(activeMorphKeyframe.value)
        : null,
    [activeMorphKeyframe],
  );

  const morphVertexCount = useMemo(() => {
    if (activeMorphSnap) return activeMorphSnap.points.length;
    if (targetNode) {
      const raw = extractMorphSnapshotFromNode(targetNode);
      const parsed = raw ? parsePathMorphSnapshot(raw) : null;
      if (parsed) return parsed.points.length;
    }
    return 0;
  }, [activeMorphSnap, targetNode]);

  const morphTopologyBadge = useMemo(() => {
    const ptSuffix = morphVertexCount > 0 ? ` · ${morphVertexCount} pts` : '';
    if (morphTrack && morphTrack.keyframes.length >= 2) {
      const snaps = morphTrack.keyframes
        .map((kf) => (typeof kf.value === 'string' ? parsePathMorphSnapshot(kf.value) : null))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const hasOpen = snaps.some((s) => s.closed === false);
      const hasClosed = snaps.some((s) => s.closed !== false);
      const maxContours = snaps.reduce((acc, s) => Math.max(acc, 1 + (s.subpaths?.length ?? 0)), 1);
      if (hasOpen && hasClosed) return `Open ↔ Closed${ptSuffix}`;
      if (maxContours > 1) return `Multi-Contour (${maxContours})${ptSuffix}`;
      if (hasOpen) return `Open Path${ptSuffix}`;
      return `Closed Path${ptSuffix}`;
    }
    if (targetNode?.type === 'path') {
      const contours = 1 + (targetNode.subpaths?.length ?? 0);
      if (contours > 1) return `Multi-Contour (${contours})${ptSuffix}`;
      return `${targetNode.closed === false ? 'Open Path' : 'Closed Path'}${ptSuffix}`;
    }
    return morphSupport.supported ? `Closed Vector${ptSuffix}` : 'Unsupported';
  }, [morphTrack, targetNode, morphSupport.supported, morphVertexCount]);

  const handleApplyMorphPreset = (presetId: MorphShapePresetId) => {
    if (!targetNode || !morphSupport.supported) return;
    const baseClip = ensureClip();
    const applied = applyMorphPresetInClip(baseClip, targetNode, presetId, playheadMs, 'ease-in-out');
    onUpdateClip(applied.clip, `Morph ${targetNode.name} to ${presetId}`);
  };

  const handleUpdateMorphOptions = (patch: {
    reverse?: boolean;
    startOffsetDelta?: number;
    matchMode?: 'auto' | 'index';
  }) => {
    if (!activeClip || !morphTrack || !activeMorphKeyframe || typeof activeMorphKeyframe.value !== 'string') return;
    const currentSnap = parsePathMorphSnapshot(activeMorphKeyframe.value);
    if (!currentSnap) return;
    const nextStartOffset =
      patch.startOffsetDelta !== undefined
        ? (currentSnap.morph?.startOffset ?? 0) + patch.startOffsetDelta
        : undefined;
    const updatedValue = updateMorphSnapshotOptions(activeMorphKeyframe.value, {
      reverse: patch.reverse,
      startOffset: nextStartOffset,
      matchMode: patch.matchMode,
    });
    if (!updatedValue) return;
    const nextClip = updateKeyframeInClip(activeClip, morphTrack.id, activeMorphKeyframe.id, {
      value: updatedValue,
    });
    onUpdateClip(nextClip, 'Update Shape Morph alignment');
  };

  // --- Trim Path state ---
  const trimSupported = supportsTrimPathNode(targetNode);
  const trimTracks = useMemo(() => {
    if (!activeClip || !targetNode) return { start: null, end: null, offset: null };
    return {
      start: activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'trimStart') ?? null,
      end: activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'trimEnd') ?? null,
      offset: activeClip.tracks.find((t) => t.targetNodeId === targetNode.id && t.property === 'trimOffset') ?? null,
    };
  }, [activeClip, targetNode]);

  const trimStartVal = useMemo(() => {
    if (!targetNode) return 0;
    const evaluated = trimTracks.start ? evaluateTrackAtTime(trimTracks.start, playheadMs) : undefined;
    if (typeof evaluated === 'number') return Math.round(evaluated * 10) / 10;
    const def = getDefaultNodePropertyValue(targetNode, 'trimStart');
    return typeof def === 'number' ? def : 0;
  }, [targetNode, trimTracks.start, playheadMs]);

  const trimEndVal = useMemo(() => {
    if (!targetNode) return 100;
    const evaluated = trimTracks.end ? evaluateTrackAtTime(trimTracks.end, playheadMs) : undefined;
    if (typeof evaluated === 'number') return Math.round(evaluated * 10) / 10;
    const def = getDefaultNodePropertyValue(targetNode, 'trimEnd');
    return typeof def === 'number' ? def : 100;
  }, [targetNode, trimTracks.end, playheadMs]);

  const trimOffsetVal = useMemo(() => {
    if (!targetNode) return 0;
    const evaluated = trimTracks.offset ? evaluateTrackAtTime(trimTracks.offset, playheadMs) : undefined;
    if (typeof evaluated === 'number') return Math.round(evaluated * 10) / 10;
    const def = getDefaultNodePropertyValue(targetNode, 'trimOffset');
    return typeof def === 'number' ? def : 0;
  }, [targetNode, trimTracks.offset, playheadMs]);

  const activeTrimMode: TrimPathMode = useMemo(() => {
    if (trimTracks.end?.trimMode) return trimTracks.end.trimMode;
    if (trimTracks.start?.trimMode) return trimTracks.start.trimMode;
    if (trimTracks.offset?.trimMode) return trimTracks.offset.trimMode;
    if (targetNode && 'style' in targetNode && 'trimMode' in targetNode.style && targetNode.style.trimMode) {
      return targetNode.style.trimMode;
    }
    return 'simultaneous';
  }, [trimTracks, targetNode]);

  const hasTrimTracks = Boolean(trimTracks.start || trimTracks.end || trimTracks.offset);
  const preferredTrimGraphProp: AnimatableProperty = trimTracks.end
    ? 'trimEnd'
    : trimTracks.start
      ? 'trimStart'
      : 'trimOffset';

  const handleApplyTrimPreset = (preset: 'draw-in' | 'draw-out' | 'traveling-dash') => {
    if (!targetNode || !trimSupported) return;
    const baseClip = ensureClip();
    const nextClip = enableTrimPathInClip(baseClip, targetNode, preset, activeTrimMode);
    const label =
      preset === 'draw-in'
        ? 'Draw In'
        : preset === 'draw-out'
          ? 'Draw Out'
          : 'Traveling Dash';
    onUpdateClip(nextClip, `Apply Trim Path "${label}" to ${targetNode.name}`);
  };

  const handleApplyTrimStagger = (preset: 'draw-in' | 'draw-out' | 'traveling-dash') => {
    if (trimCapableSelection.length < 2) return;
    const baseClip = ensureClip();
    const nextClip = applyStaggeredTrimPathInClip(
      baseClip,
      trimCapableSelection,
      preset,
      activeTrimMode,
      {
        staggerMs: Math.max(0, staggerMs),
        order: staggerOrder,
      },
    );
    onUpdateClip(
      nextClip,
      `Apply Staggered Trim Path "${preset}" (${trimCapableSelection.length} shapes, ${staggerMs}ms)`,
    );
  };

  const handleSetTrimValue = (
    property: 'trimStart' | 'trimEnd' | 'trimOffset',
    rawValue: number,
    coalesceKey?: string,
  ) => {
    if (!targetNode || !trimSupported || !Number.isFinite(rawValue)) return;
    const clamped =
      property === 'trimOffset'
        ? Math.max(-1000, Math.min(1000, rawValue))
        : Math.max(0, Math.min(100, rawValue));
    const defaultBaseline = getDefaultNodePropertyValue(targetNode, property);
    let clip = ensureClip();
    clip = setSingleChannelKeyframeInClip(clip, targetNode, property, playheadMs, clamped, {
      baselineValue: defaultBaseline,
      easing: 'ease-in-out',
    }).clip;
    clip = setNodeTrimModeInClip(clip, targetNode.id, activeTrimMode);
    onUpdateClip(clip, `Update ${property} on ${targetNode.name}`, coalesceKey);
  };

  const handleToggleTrimKeyframe = (property: AnimatableProperty) => {
    if (!targetNode) return;
    const clip = ensureClip();
    const isTrimChannel =
      property === 'trimStart' || property === 'trimEnd' || property === 'trimOffset';
    const liveVal =
      property === 'trimStart'
        ? trimStartVal
        : property === 'trimEnd'
          ? trimEndVal
          : property === 'trimOffset'
            ? trimOffsetVal
            : undefined;
    const defaultBaseline = isTrimChannel
      ? getDefaultNodePropertyValue(targetNode, property)
      : undefined;
    const toggled = togglePropertyKeyframeInClip(clip, targetNode, property, playheadMs, {
      baselineNode: targetNode,
      easing: 'ease-in-out',
      ...(isTrimChannel ? { valueOverride: liveVal, baselineValueOverride: defaultBaseline } : {}),
    });
    if (toggled.action === 'blocked') return;
    onUpdateClip(toggled.clip, `Toggle ${property} keyframe on ${targetNode.name}`);
  };

  const handleChangeTrimMode = (mode: TrimPathMode) => {
    if (!targetNode || !trimSupported) return;
    let clip = ensureClip();
    if (!hasTrimTracks) {
      clip = enableTrimPathInClip(clip, targetNode, 'draw-in', mode);
    } else {
      clip = setNodeTrimModeInClip(clip, targetNode.id, mode);
    }
    onUpdateClip(clip, `Set Trim Path mode to ${mode}`);
  };

  const contextualGuide = useMemo(() => {
    if (!targetNode) {
      return 'Select one or more layers on Canvas to author Motion Paths, Shape Morphs, or Trim Path strokes.';
    }
    if (activeTab === 'motion-path') {
      if (!motionBinding) {
        if (canConvertFromXY) {
          return 'Existing X/Y keyframes detected · Click "Convert X/Y → Path" to turn them into a smooth Bézier Motion Path while preserving timing.';
        }
        return 'Step 1: Add a Motion Path or pick an existing Path layer. Select 2+ layers to animate with sequential Stagger.';
      }
      return 'Motion Path drives X/Y (no position conflicts) · Velocity dots show easing speed · Drag numeric labels to scrub · Rotation, size & style remain active.';
    }
    if (activeTab === 'shape-morph') {
      return 'Move playhead & pick a target shape or "+ Morph Key" · Toggle "Vertex #" and click any #N badge on Canvas to set start vertex (#1).';
    }
    return 'Choose a Trim preset or drag Start / End / Offset labels to scrub · Open Speed or Value Graph for silky draw-in velocity.';
  }, [targetNode, activeTab, motionBinding, canConvertFromXY]);

  const startOffsetVal = activeMorphSnap?.morph?.startOffset ?? 0;

  return (
    <section
      class="ps-bar"
      aria-label="FOLIO Path Studio controls"
      data-testid="path-studio-panel"
    >
      <div class="ps-header-row">
        <div class="ps-tabs" role="tablist" aria-label="Path Studio modes">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'motion-path'}
            class={`ps-tab${activeTab === 'motion-path' ? ' is-active' : ''}`}
            data-testid="path-studio-tab-motion"
            onClick={() => setActiveTab('motion-path')}
          >
            <span>Motion Path</span>
            {motionBinding && <span class="ps-tab-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shape-morph'}
            class={`ps-tab${activeTab === 'shape-morph' ? ' is-active' : ''}`}
            data-testid="path-studio-tab-morph"
            onClick={() => setActiveTab('shape-morph')}
          >
            <span>Shape Morph</span>
            {morphTrack && morphTrack.keyframes.length > 0 && <span class="ps-tab-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'trim-path'}
            class={`ps-tab${activeTab === 'trim-path' ? ' is-active' : ''}`}
            data-testid="path-studio-tab-trim"
            onClick={() => setActiveTab('trim-path')}
          >
            <span>Trim Path</span>
            {hasTrimTracks && <span class="ps-tab-dot" aria-hidden="true" />}
          </button>
        </div>

        <span class="ps-guide" data-testid="path-studio-guide">
          {contextualGuide}
        </span>
      </div>

      <div class="ps-content">
        {!targetNode ? (
          <div class="ps-empty">
            Select any layer on the canvas to author Motion Path, Shape Morph, or Trim Path animations.
          </div>
        ) : activeTab === 'motion-path' ? (
          <div class="ps-groups" data-testid="path-studio-motion-content">
            {/* Group 1: Source & Trajectory Shape Keys */}
            <div class="ps-group">
              <span class="ps-group-label">Trajectory</span>
              <span class="ps-target-label" title={targetNode.name}>
                {targetNode.name}
              </span>

              {!motionBinding ? (
                <>
                  <button
                    type="button"
                    class="ps-btn ps-btn-accent"
                    data-testid="ps-add-motion-path-btn"
                    data-convert-xy={canConvertFromXY ? 'true' : undefined}
                    onClick={handleAddMotionPath}
                    title={
                      canConvertFromXY
                        ? 'Convert existing X/Y position keyframes into an editable Bézier Motion Path while preserving timing'
                        : 'Attach an editable Bézier Motion Path directly on Canvas'
                    }
                  >
                    {canConvertFromXY ? '✦ Convert X/Y → Path' : '+ Add Motion Path'}
                  </button>
                  {pathLayerSources.length > 0 && (
                    <select
                      class="ps-select"
                      aria-label="Create Motion Path from existing Path layer"
                      data-testid="ps-use-path-layer-select"
                      value=""
                      onChange={(event) => {
                        const id = event.currentTarget.value;
                        event.currentTarget.value = '';
                        handleUsePathLayer(id);
                      }}
                    >
                      <option value="">Use Path Layer…</option>
                      {pathLayerSources.map((src) => (
                        <option key={src.id} value={src.id}>
                          {src.name} ({src.points.length} pts)
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    class={`ps-btn${hasShapeKeyAtPlayhead ? ' is-active' : ''}`}
                    data-testid="ps-mp-path-key-btn"
                    title="Keyframe the Motion Path curve geometry at the current playhead so the path itself animates over time"
                    onClick={handleAddOrUpdatePathShapeKey}
                  >
                    ◆ {hasShapeKeyAtPlayhead ? 'Update Path Key' : '+ Path Key'}
                    {motionPathShapeKeyCount > 0 ? ` (${motionPathShapeKeyCount})` : ''}
                  </button>
                  {hasShapeKeyAtPlayhead && motionPathShapeKeyCount > 0 && (
                    <button
                      type="button"
                      class="ps-btn"
                      data-testid="ps-mp-path-key-del-btn"
                      title="Remove Motion Path shape keyframe at playhead"
                      onClick={handleRemovePathShapeKey}
                    >
                      × Key
                    </button>
                  )}
                  <button
                    type="button"
                    class={`ps-toggle${motionBinding.closed ? ' is-active' : ''}`}
                    aria-pressed={motionBinding.closed}
                    data-testid="ps-mp-closed-btn"
                    title="Close path into a continuous loop"
                    onClick={() =>
                      commitMotionBinding(
                        { ...motionBinding, closed: !motionBinding.closed },
                        'Toggle Closed Motion Path',
                      )
                    }
                  >
                    Closed
                  </button>
                  <button
                    type="button"
                    class={`ps-toggle${motionBinding.visible !== false ? ' is-active' : ''}`}
                    aria-pressed={motionBinding.visible !== false}
                    data-testid="ps-mp-guide-btn"
                    title="Show or hide path guide overlay on Canvas"
                    onClick={() =>
                      commitMotionBinding(
                        { ...motionBinding, visible: motionBinding.visible === false },
                        'Toggle Motion Path guide visibility',
                      )
                    }
                  >
                    Guide
                  </button>
                  {pathLayerSources.length > 0 && (
                    <select
                      class="ps-select"
                      aria-label="Replace Motion Path from Path layer"
                      value=""
                      onChange={(event) => {
                        const id = event.currentTarget.value;
                        event.currentTarget.value = '';
                        handleUsePathLayer(id);
                      }}
                    >
                      <option value="">From Path…</option>
                      {pathLayerSources.map((src) => (
                        <option key={src.id} value={src.id}>
                          {src.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    class="ps-btn ps-btn-danger"
                    data-testid="ps-mp-remove-btn"
                    title="Remove Motion Path from layer"
                    onClick={handleRemoveMotionPath}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>

            {motionBinding && (
              <>
                {/* Group 2: Travel & Speed Graph */}
                <div class="ps-group">
                  <span class="ps-group-label">Motion &amp; Speed</span>
                  <button
                    type="button"
                    class={`ps-toggle${motionBinding.autoOrient ? ' is-active' : ''}`}
                    aria-pressed={motionBinding.autoOrient}
                    data-testid="ps-auto-orient-btn"
                    title="Automatically rotate object tangent to the curve direction"
                    onClick={() =>
                      commitMotionBinding(
                        { ...motionBinding, autoOrient: !motionBinding.autoOrient },
                        'Toggle Motion Path Auto Orient',
                      )
                    }
                  >
                    Auto Orient
                  </button>

                  {motionBinding.autoOrient && (
                    <label class="ps-field" title="Rotation angle offset in degrees (drag label to scrub)">
                      <span
                        class="ps-scrub-label"
                        data-testid="ps-scrub-orient-offset"
                        onPointerDown={(event) =>
                          startLabelScrub(event, {
                            value: Math.round(motionBinding.orientOffsetDeg ?? 0),
                            min: -360,
                            max: 360,
                            step: 5,
                            pixelsPerStep: 5,
                            onValue: (val) =>
                              commitMotionBinding(
                                { ...motionBinding, orientOffsetDeg: val },
                                'Update Auto Orient offset',
                                `mp-orient:${motionBinding.id}`,
                              ),
                          })
                        }
                      >
                        Rot
                      </span>
                      <input
                        type="number"
                        class="ps-num"
                        step={5}
                        min={-360}
                        max={360}
                        aria-label="Auto Orient angle offset (degrees)"
                        data-testid="ps-orient-offset-input"
                        value={Math.round(motionBinding.orientOffsetDeg ?? 0)}
                        onInput={(event) => {
                          const val = Number(event.currentTarget.value);
                          if (Number.isFinite(val)) {
                            commitMotionBinding(
                              { ...motionBinding, orientOffsetDeg: val },
                              'Update Auto Orient offset',
                              `mp-orient:${motionBinding.id}`,
                            );
                          }
                        }}
                      />
                      <span>°</span>
                    </label>
                  )}

                  <button
                    type="button"
                    class={`ps-toggle${motionBinding.reverse ? ' is-active' : ''}`}
                    aria-pressed={motionBinding.reverse}
                    data-testid="ps-reverse-path-btn"
                    title="Reverse travel direction along the path"
                    onClick={() =>
                      commitMotionBinding(
                        { ...motionBinding, reverse: !motionBinding.reverse },
                        'Toggle Reverse Motion Path',
                      )
                    }
                  >
                    Reverse
                  </button>

                  <button
                    type="button"
                    class={`ps-toggle${motionBinding.constantSpeed ? ' is-active' : ''}`}
                    aria-pressed={motionBinding.constantSpeed}
                    data-testid="ps-constant-speed-btn"
                    title="Arc-length parameterized constant speed across curved segments"
                    onClick={() =>
                      commitMotionBinding(
                        { ...motionBinding, constantSpeed: !motionBinding.constantSpeed },
                        'Toggle Constant Speed',
                      )
                    }
                  >
                    Const Speed
                  </button>

                  <div class="ps-seg" role="group" aria-label="Motion Path loop mode">
                    {([
                      { id: 'none', label: 'Once' },
                      { id: 'loop', label: 'Loop' },
                      { id: 'ping-pong', label: 'Ping-Pong' },
                    ] as const).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        class={`ps-seg-btn${motionBinding.loopMode === item.id ? ' is-active' : ''}`}
                        data-testid={`ps-loop-${item.id}`}
                        aria-pressed={motionBinding.loopMode === item.id}
                        onClick={() =>
                          commitMotionBinding(
                            { ...motionBinding, loopMode: item.id as MotionPathLoopMode },
                            `Set Motion Path loop mode to ${item.label}`,
                          )
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  {onOpenSpeedCurve && (
                    <div class="ps-seg" role="group" aria-label="Motion Path Graph Editor">
                      <button
                        type="button"
                        class="ps-seg-btn"
                        data-testid="ps-mp-speed-curve-btn"
                        title="Open Speed Graph (velocity curve in %/s with influence handles)"
                        onClick={() => onOpenSpeedCurve(motionBinding.targetNodeId, 'motionPathProgress', 'speed')}
                      >
                        Speed Graph
                      </button>
                      <button
                        type="button"
                        class="ps-seg-btn"
                        data-testid="ps-mp-value-graph-btn"
                        title="Open Value Graph (draggable keyframes and tangent handles)"
                        onClick={() => onOpenSpeedCurve(motionBinding.targetNodeId, 'motionPathProgress', 'value')}
                      >
                        Value Graph
                      </button>
                    </div>
                  )}
                </div>

                {/* Group 3: Animatable Range & Offset Channels */}
                <div class="ps-group">
                  <span class="ps-group-label">Range &amp; Offset</span>

                  <label class="ps-field" title="Start percent along path (0–100%). Drag label to scrub or click ◆ to animate.">
                    <span
                      class="ps-scrub-label"
                      data-testid="ps-scrub-mp-start"
                      onPointerDown={(event) =>
                        startLabelScrub(event, {
                          value: liveMpStartVal,
                          min: 0,
                          max: 100,
                          step: 1,
                          pixelsPerStep: 3,
                          onValue: (val) =>
                            handleSetMotionPathChannelValue('motionPathStart', val, `mp-start:${motionBinding.id}`),
                        })
                      }
                    >
                      Start
                    </span>
                    <input
                      type="number"
                      class="ps-num"
                      min={0}
                      max={100}
                      step={5}
                      aria-label="Motion Path Start percent"
                      data-testid="ps-mp-start-input"
                      value={liveMpStartVal}
                      onInput={(event) => {
                        const val = Number(event.currentTarget.value);
                        if (Number.isFinite(val)) {
                          handleSetMotionPathChannelValue('motionPathStart', val, `mp-start:${motionBinding.id}`);
                        }
                      }}
                    />
                    <span>%</span>
                    <button
                      type="button"
                      class={`ps-kf-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'motionPathStart', playheadMs) ? ' is-keyed' : ''}`}
                      aria-label="Toggle Motion Path Start keyframe"
                      data-testid="ps-mp-start-kf-btn"
                      title="Toggle animatable Motion Path Start keyframe at playhead"
                      onClick={() => handleToggleMotionPathChannelKey('motionPathStart')}
                    >
                      ◆
                    </button>
                  </label>

                  <label class="ps-field" title="End percent along path (0–100%). Drag label to scrub or click ◆ to animate.">
                    <span
                      class="ps-scrub-label"
                      data-testid="ps-scrub-mp-end"
                      onPointerDown={(event) =>
                        startLabelScrub(event, {
                          value: liveMpEndVal,
                          min: 0,
                          max: 100,
                          step: 1,
                          pixelsPerStep: 3,
                          onValue: (val) =>
                            handleSetMotionPathChannelValue('motionPathEnd', val, `mp-end:${motionBinding.id}`),
                        })
                      }
                    >
                      End
                    </span>
                    <input
                      type="number"
                      class="ps-num"
                      min={0}
                      max={100}
                      step={5}
                      aria-label="Motion Path End percent"
                      data-testid="ps-mp-end-input"
                      value={liveMpEndVal}
                      onInput={(event) => {
                        const val = Number(event.currentTarget.value);
                        if (Number.isFinite(val)) {
                          handleSetMotionPathChannelValue('motionPathEnd', val, `mp-end:${motionBinding.id}`);
                        }
                      }}
                    />
                    <span>%</span>
                    <button
                      type="button"
                      class={`ps-kf-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'motionPathEnd', playheadMs) ? ' is-keyed' : ''}`}
                      aria-label="Toggle Motion Path End keyframe"
                      data-testid="ps-mp-end-kf-btn"
                      title="Toggle animatable Motion Path End keyframe at playhead"
                      onClick={() => handleToggleMotionPathChannelKey('motionPathEnd')}
                    >
                      ◆
                    </button>
                  </label>

                  <label class="ps-field" title="Perpendicular offset from path in pixels. Drag label to scrub or click ◆ to animate.">
                    <span
                      class="ps-scrub-label"
                      data-testid="ps-scrub-mp-offset"
                      onPointerDown={(event) =>
                        startLabelScrub(event, {
                          value: liveMpOffsetVal,
                          min: -1000,
                          max: 1000,
                          step: 2,
                          pixelsPerStep: 3,
                          onValue: (val) =>
                            handleSetMotionPathChannelValue('motionPathOffset', val, `mp-offset:${motionBinding.id}`),
                        })
                      }
                    >
                      Offset
                    </span>
                    <input
                      type="number"
                      class="ps-num"
                      min={-1000}
                      max={1000}
                      step={4}
                      aria-label="Motion Path perpendicular offset (px)"
                      data-testid="ps-mp-offset-input"
                      value={liveMpOffsetVal}
                      onInput={(event) => {
                        const val = Number(event.currentTarget.value);
                        if (Number.isFinite(val)) {
                          handleSetMotionPathChannelValue('motionPathOffset', val, `mp-offset:${motionBinding.id}`);
                        }
                      }}
                    />
                    <span>px</span>
                    <button
                      type="button"
                      class={`ps-kf-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'motionPathOffset', playheadMs) ? ' is-keyed' : ''}`}
                      aria-label="Toggle Motion Path Offset keyframe"
                      data-testid="ps-mp-offset-kf-btn"
                      title="Toggle animatable Motion Path Offset keyframe at playhead"
                      onClick={() => handleToggleMotionPathChannelKey('motionPathOffset')}
                    >
                      ◆
                    </button>
                  </label>
                </div>

                {/* Group 4: Anchor Point Editing */}
                {evaluatedMotionBinding && (
                  <div class="ps-group">
                    <span class="ps-group-label">Anchor Point</span>
                    <div class="ps-point-group" role="group" aria-label="Selected anchor point">
                      <button
                        type="button"
                        class="ps-mini-btn"
                        aria-label="Previous anchor point"
                        title="Previous anchor point"
                        onClick={() =>
                          onSelectMotionPathPoint?.({
                            nodeId: motionBinding.targetNodeId,
                            pointIndex:
                              (activePointIndex - 1 + evaluatedMotionBinding.points.length) %
                              evaluatedMotionBinding.points.length,
                          })
                        }
                      >
                        ‹
                      </button>
                      <span class="ps-point-label" data-testid="ps-mp-point-label">
                        Pt {activePointIndex + 1}/{evaluatedMotionBinding.points.length}
                      </span>
                      <button
                        type="button"
                        class="ps-mini-btn"
                        aria-label="Next anchor point"
                        title="Next anchor point"
                        onClick={() =>
                          onSelectMotionPathPoint?.({
                            nodeId: motionBinding.targetNodeId,
                            pointIndex: (activePointIndex + 1) % evaluatedMotionBinding.points.length,
                          })
                        }
                      >
                        ›
                      </button>
                    </div>

                    {activePoint && (
                      <div class="ps-seg" role="group" aria-label="Anchor point type">
                        {(['corner', 'smooth', 'symmetric'] as const).map((ptType) => (
                          <button
                            key={ptType}
                            type="button"
                            class={`ps-seg-btn${activePoint.pointType === ptType ? ' is-active' : ''}`}
                            data-testid={`ps-point-type-${ptType}`}
                            aria-pressed={activePoint.pointType === ptType}
                            onClick={() => handleSetPointType(ptType)}
                          >
                            {ptType === 'corner' ? 'Corner' : ptType === 'smooth' ? 'Smooth' : 'Sym'}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      class="ps-btn"
                      data-testid="ps-mp-add-point-btn"
                      title="Insert anchor point on segment (or Alt+Click / Double-Click curve on Canvas)"
                      onClick={handleInsertPoint}
                    >
                      + Pt
                    </button>

                    <button
                      type="button"
                      class="ps-btn"
                      data-testid="ps-mp-del-point-btn"
                      disabled={evaluatedMotionBinding.points.length <= 2}
                      title="Remove selected anchor point (minimum 2 points)"
                      onClick={handleRemovePoint}
                    >
                      − Pt
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Group 5: Multi-Object Stagger (appears whenever 2+ layers are selected) */}
            {selectedDesignNodes.length >= 2 && (
              <div class="ps-group ps-group-stagger" data-testid="ps-mp-stagger-group">
                <span class="ps-group-label">Multi-Object Stagger</span>
                <span class="ps-status-tag" data-testid="ps-mp-stagger-count">
                  {selectedDesignNodes.length} layers
                </span>
                <label class="ps-field" title="Sequential delay between each layer in milliseconds (drag label to scrub)">
                  <span
                    class="ps-scrub-label"
                    data-testid="ps-scrub-mp-stagger"
                    onPointerDown={(event) =>
                      startLabelScrub(event, {
                        value: staggerMs,
                        min: 0,
                        max: 5000,
                        step: 20,
                        pixelsPerStep: 5,
                        onValue: (v) => setStaggerMs(Math.round(v)),
                      })
                    }
                  >
                    Step
                  </span>
                  <input
                    type="number"
                    class="ps-num"
                    min={0}
                    max={5000}
                    step={20}
                    aria-label="Motion Path stagger step (ms)"
                    data-testid="ps-mp-stagger-ms-input"
                    value={staggerMs}
                    onInput={(event) => {
                      const v = Number(event.currentTarget.value);
                      if (Number.isFinite(v)) setStaggerMs(Math.max(0, Math.min(5000, v)));
                    }}
                  />
                  <span>ms</span>
                </label>
                <button
                  type="button"
                  class={`ps-toggle${staggerOrder === 'reverse' ? ' is-active' : ''}`}
                  data-testid="ps-mp-stagger-order-btn"
                  aria-pressed={staggerOrder === 'reverse'}
                  title="Toggle stagger order between Selection order and Reverse order"
                  onClick={() => setStaggerOrder((o) => (o === 'selection' ? 'reverse' : 'selection'))}
                >
                  {staggerOrder === 'selection' ? 'Forward' : 'Reverse'}
                </button>
                <button
                  type="button"
                  class="ps-btn ps-btn-accent"
                  data-testid="ps-mp-apply-stagger-btn"
                  title="Attach Motion Paths to all selected layers with sequential stagger timing"
                  onClick={handleApplyMotionPathStagger}
                >
                  Apply Stagger Path
                </button>
              </div>
            )}
          </div>
        ) : activeTab === 'shape-morph' ? (
          <div class="ps-groups" data-testid="path-studio-morph-content">
            {/* Group 1: Keyframes & Direct Point Editing */}
            <div class="ps-group">
              <span class="ps-group-label">Shape Keys</span>
              <span class="ps-target-label" title={targetNode.name}>
                {targetNode.name}
              </span>
              <span class="ps-status-tag" data-testid="ps-morph-topology">
                {morphTopologyBadge}
              </span>

              {!morphSupport.supported ? (
                <span class="ps-hint">{morphSupport.message}</span>
              ) : (
                <>
                  {onKeyframePathMorph && (
                    <button
                      type="button"
                      class="ps-btn ps-btn-accent"
                      data-testid="ps-morph-add-key-btn"
                      onClick={onKeyframePathMorph}
                      title="Add a Shape Path geometry keyframe at the current playhead"
                    >
                      + Morph Key
                    </button>
                  )}

                  {onEditMorphPoints && (
                    <button
                      type="button"
                      class="ps-btn"
                      data-testid="ps-morph-edit-points-btn"
                      onClick={() => onEditMorphPoints(targetNode.id)}
                      title="Switch to Direct Selection to animate individual anchor points and handles"
                    >
                      Edit Points
                    </button>
                  )}
                </>
              )}
            </div>

            {morphSupport.supported && (
              <>
                {/* Group 2: Target Presets & Component Import */}
                <div class="ps-group">
                  <span class="ps-group-label">Morph Target</span>
                  <div class="ps-seg" role="group" aria-label="Shape morph target presets">
                    {MORPH_SHAPE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        class="ps-seg-btn"
                        data-testid={`ps-morph-preset-${preset.id}`}
                        title={`Morph into ${preset.label} at playhead`}
                        onClick={() => handleApplyMorphPreset(preset.id)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  {onImportMorphFromComponent && componentMorphOptions.length > 0 && (
                    <select
                      class="ps-select"
                      aria-label="Morph from saved component"
                      value=""
                      onChange={(event) => {
                        const compId = event.currentTarget.value;
                        event.currentTarget.value = '';
                        const entry = componentMorphOptions.find((c) => c.component.id === compId);
                        if (entry && entry.info.supported) {
                          onImportMorphFromComponent(entry.component, {
                            targetNodeId: targetNode.id,
                            atTimeMs: playheadMs,
                          });
                        }
                      }}
                    >
                      <option value="">From Comp…</option>
                      {componentMorphOptions.map(({ component, info }) => (
                        <option key={component.id} value={component.id} disabled={!info.supported}>
                          {component.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Group 3: Correspondence & Winding */}
                <div class="ps-group">
                  <span class="ps-group-label">Correspondence</span>

                  {onToggleMorphCorrespondence && (
                    <button
                      type="button"
                      class={`ps-toggle${showMorphCorrespondence ? ' is-active' : ''}`}
                      aria-pressed={showMorphCorrespondence}
                      data-testid="ps-morph-correspondence-toggle"
                      title="Show numbered vertex indices (#1 green Start Vertex + winding direction arrow) on Canvas"
                      onClick={onToggleMorphCorrespondence}
                    >
                      Vertex #
                    </button>
                  )}

                  {activeMorphSnap ? (
                    <>
                      <div class="ps-seg" role="group" aria-label="Vertex matching mode">
                        <button
                          type="button"
                          class={`ps-seg-btn${(activeMorphSnap.morph?.matchMode ?? 'auto') === 'auto' ? ' is-active' : ''}`}
                          data-testid="ps-morph-match-auto"
                          onClick={() => handleUpdateMorphOptions({ matchMode: 'auto' })}
                        >
                          Auto Match
                        </button>
                        <button
                          type="button"
                          class={`ps-seg-btn${activeMorphSnap.morph?.matchMode === 'index' ? ' is-active' : ''}`}
                          data-testid="ps-morph-match-index"
                          onClick={() => handleUpdateMorphOptions({ matchMode: 'index' })}
                        >
                          Index
                        </button>
                      </div>
                      <button
                        type="button"
                        class={`ps-toggle${activeMorphSnap.morph?.reverse ? ' is-active' : ''}`}
                        aria-pressed={Boolean(activeMorphSnap.morph?.reverse)}
                        data-testid="ps-morph-reverse-btn"
                        title="Flip contour winding order (CW ↔ CCW) to prevent twist during morph"
                        onClick={() => handleUpdateMorphOptions({ reverse: !activeMorphSnap.morph?.reverse })}
                      >
                        Reverse
                      </button>
                      <div class="ps-seg" role="group" aria-label="Start vertex offset">
                        <button
                          type="button"
                          class="ps-seg-btn"
                          data-testid="ps-morph-start-prev"
                          title="Shift morph start vertex (#1) backward"
                          onClick={() => handleUpdateMorphOptions({ startOffsetDelta: -1 })}
                        >
                          Start −
                        </button>
                        <button
                          type="button"
                          class="ps-seg-btn"
                          data-testid="ps-morph-start-next"
                          title="Shift morph start vertex (#1) forward"
                          onClick={() => handleUpdateMorphOptions({ startOffsetDelta: 1 })}
                        >
                          Start +
                        </button>
                      </div>
                      {startOffsetVal !== 0 && (
                        <span class="ps-status-tag" data-testid="ps-morph-offset-badge">
                          Shift {startOffsetVal > 0 ? `+${startOffsetVal}` : startOffsetVal}
                        </span>
                      )}
                    </>
                  ) : (
                    <span class="ps-hint">Add a morph preset or keyframe to align start vertex &amp; winding.</span>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div class="ps-groups" data-testid="path-studio-trim-content">
            {/* Group 1: Trim Presets & Multi-Contour Mode */}
            <div class="ps-group">
              <span class="ps-group-label">Trim Presets</span>
              <span class="ps-target-label" title={targetNode.name}>
                {targetNode.name}
              </span>

              {!trimSupported ? (
                <span class="ps-hint">
                  Select a Path, Rectangle, Frame, or Ellipse layer to animate Trim Path strokes.
                </span>
              ) : (
                <>
                  <div class="ps-seg" role="group" aria-label="Trim Path presets">
                    <button
                      type="button"
                      class="ps-seg-btn"
                      data-testid="ps-trim-preset-draw-in"
                      title="Progressively draw stroke from 0% to 100%"
                      onClick={() => handleApplyTrimPreset('draw-in')}
                    >
                      Draw In
                    </button>
                    <button
                      type="button"
                      class="ps-seg-btn"
                      data-testid="ps-trim-preset-draw-out"
                      title="Progressively erase stroke from 0% to 100%"
                      onClick={() => handleApplyTrimPreset('draw-out')}
                    >
                      Draw Out
                    </button>
                    <button
                      type="button"
                      class="ps-seg-btn"
                      data-testid="ps-trim-preset-traveling-dash"
                      title="Animate a 25% stroke segment gliding along the contour"
                      onClick={() => handleApplyTrimPreset('traveling-dash')}
                    >
                      Traveling Dash
                    </button>
                  </div>

                  <div class="ps-seg" role="group" aria-label="Multi-contour trim mode">
                    <button
                      type="button"
                      class={`ps-seg-btn${activeTrimMode === 'simultaneous' ? ' is-active' : ''}`}
                      data-testid="ps-trim-mode-simultaneous"
                      aria-pressed={activeTrimMode === 'simultaneous'}
                      title="Trim all contours at the same time"
                      onClick={() => handleChangeTrimMode('simultaneous')}
                    >
                      Simultaneous
                    </button>
                    <button
                      type="button"
                      class={`ps-seg-btn${activeTrimMode === 'sequential' ? ' is-active' : ''}`}
                      data-testid="ps-trim-mode-sequential"
                      aria-pressed={activeTrimMode === 'sequential'}
                      title="Trim compound subpaths one after another proportionally by length"
                      onClick={() => handleChangeTrimMode('sequential')}
                    >
                      Sequential
                    </button>
                  </div>
                </>
              )}
            </div>

            {trimSupported && (
              <>
                {/* Group 2: Animatable Trim Channels + Graph Editor */}
                <div class="ps-group">
                  <span class="ps-group-label">Trim Channels</span>

                  <label class="ps-field" title="Trim Start percentage (0–100%). Drag label to scrub.">
                    <span
                      class="ps-scrub-label"
                      data-testid="ps-scrub-trim-start"
                      onPointerDown={(event) =>
                        startLabelScrub(event, {
                          value: trimStartVal,
                          min: 0,
                          max: 100,
                          step: 1,
                          pixelsPerStep: 3,
                          onValue: (val) => handleSetTrimValue('trimStart', val, `trim-start:${targetNode.id}`),
                        })
                      }
                    >
                      Start
                    </span>
                    <input
                      type="number"
                      class="ps-num"
                      min={0}
                      max={100}
                      step={5}
                      aria-label="Trim Start percent"
                      data-testid="ps-trim-start-input"
                      value={trimStartVal}
                      onInput={(event) => {
                        const val = Number(event.currentTarget.value);
                        if (Number.isFinite(val)) {
                          handleSetTrimValue('trimStart', val, `trim-start:${targetNode.id}`);
                        }
                      }}
                    />
                    <span>%</span>
                    <button
                      type="button"
                      class={`ps-kf-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'trimStart', playheadMs) ? ' is-keyed' : ''}`}
                      aria-label="Toggle Trim Start keyframe"
                      title="Toggle Trim Start keyframe at playhead"
                      onClick={() => handleToggleTrimKeyframe('trimStart')}
                    >
                      ◆
                    </button>
                  </label>

                  <label class="ps-field" title="Trim End percentage (0–100%). Drag label to scrub.">
                    <span
                      class="ps-scrub-label"
                      data-testid="ps-scrub-trim-end"
                      onPointerDown={(event) =>
                        startLabelScrub(event, {
                          value: trimEndVal,
                          min: 0,
                          max: 100,
                          step: 1,
                          pixelsPerStep: 3,
                          onValue: (val) => handleSetTrimValue('trimEnd', val, `trim-end:${targetNode.id}`),
                        })
                      }
                    >
                      End
                    </span>
                    <input
                      type="number"
                      class="ps-num"
                      min={0}
                      max={100}
                      step={5}
                      aria-label="Trim End percent"
                      data-testid="ps-trim-end-input"
                      value={trimEndVal}
                      onInput={(event) => {
                        const val = Number(event.currentTarget.value);
                        if (Number.isFinite(val)) {
                          handleSetTrimValue('trimEnd', val, `trim-end:${targetNode.id}`);
                        }
                      }}
                    />
                    <span>%</span>
                    <button
                      type="button"
                      class={`ps-kf-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'trimEnd', playheadMs) ? ' is-keyed' : ''}`}
                      aria-label="Toggle Trim End keyframe"
                      title="Toggle Trim End keyframe at playhead"
                      onClick={() => handleToggleTrimKeyframe('trimEnd')}
                    >
                      ◆
                    </button>
                  </label>

                  <label class="ps-field" title="Trim Offset shift (-1000% to 1000%). Drag label to scrub.">
                    <span
                      class="ps-scrub-label"
                      data-testid="ps-scrub-trim-offset"
                      onPointerDown={(event) =>
                        startLabelScrub(event, {
                          value: trimOffsetVal,
                          min: -1000,
                          max: 1000,
                          step: 5,
                          pixelsPerStep: 3,
                          onValue: (val) => handleSetTrimValue('trimOffset', val, `trim-offset:${targetNode.id}`),
                        })
                      }
                    >
                      Offset
                    </span>
                    <input
                      type="number"
                      class="ps-num"
                      min={-1000}
                      max={1000}
                      step={10}
                      aria-label="Trim Offset percent"
                      data-testid="ps-trim-offset-input"
                      value={trimOffsetVal}
                      onInput={(event) => {
                        const val = Number(event.currentTarget.value);
                        if (Number.isFinite(val)) {
                          handleSetTrimValue('trimOffset', val, `trim-offset:${targetNode.id}`);
                        }
                      }}
                    />
                    <span>%</span>
                    <button
                      type="button"
                      class={`ps-kf-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'trimOffset', playheadMs) ? ' is-keyed' : ''}`}
                      aria-label="Toggle Trim Offset keyframe"
                      title="Toggle Trim Offset keyframe at playhead"
                      onClick={() => handleToggleTrimKeyframe('trimOffset')}
                    >
                      ◆
                    </button>
                  </label>

                  {onOpenSpeedCurve && hasTrimTracks && (
                    <div class="ps-seg" role="group" aria-label="Trim Path Graph Editor">
                      <button
                        type="button"
                        class="ps-seg-btn"
                        data-testid="ps-trim-speed-graph-btn"
                        title="Open Speed Graph for Trim Path velocity"
                        onClick={() => onOpenSpeedCurve(targetNode.id, preferredTrimGraphProp, 'speed')}
                      >
                        Speed Graph
                      </button>
                      <button
                        type="button"
                        class="ps-seg-btn"
                        data-testid="ps-trim-value-graph-btn"
                        title="Open Value Graph for Trim Path keyframes"
                        onClick={() => onOpenSpeedCurve(targetNode.id, preferredTrimGraphProp, 'value')}
                      >
                        Value Graph
                      </button>
                    </div>
                  )}
                </div>

                {/* Group 3: Stroke Styling Keys */}
                <div class="ps-group">
                  <span class="ps-group-label">Stroke Style</span>
                  <button
                    type="button"
                    class={`ps-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'strokeWidth', playheadMs) ? ' is-active' : ''}`}
                    data-testid="ps-trim-stroke-width-kf-btn"
                    title="Toggle Stroke Width keyframe at playhead"
                    onClick={() => handleToggleTrimKeyframe('strokeWidth')}
                  >
                    ◆ Stroke W
                  </button>
                  <button
                    type="button"
                    class={`ps-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'opacity', playheadMs) ? ' is-active' : ''}`}
                    data-testid="ps-trim-opacity-kf-btn"
                    title="Toggle Opacity keyframe at playhead"
                    onClick={() => handleToggleTrimKeyframe('opacity')}
                  >
                    ◆ Opacity
                  </button>
                </div>
              </>
            )}

            {/* Group 4: Multi-Object Trim Stagger */}
            {trimCapableSelection.length >= 2 && (
              <div class="ps-group ps-group-stagger" data-testid="ps-trim-stagger-group">
                <span class="ps-group-label">Multi-Object Stagger</span>
                <span class="ps-status-tag" data-testid="ps-trim-stagger-count">
                  {trimCapableSelection.length} shapes
                </span>
                <label class="ps-field" title="Sequential delay between each shape in milliseconds (drag label to scrub)">
                  <span
                    class="ps-scrub-label"
                    data-testid="ps-scrub-trim-stagger"
                    onPointerDown={(event) =>
                      startLabelScrub(event, {
                        value: staggerMs,
                        min: 0,
                        max: 5000,
                        step: 20,
                        pixelsPerStep: 5,
                        onValue: (v) => setStaggerMs(Math.round(v)),
                      })
                    }
                  >
                    Step
                  </span>
                  <input
                    type="number"
                    class="ps-num"
                    min={0}
                    max={5000}
                    step={20}
                    aria-label="Trim Path stagger step (ms)"
                    data-testid="ps-trim-stagger-ms-input"
                    value={staggerMs}
                    onInput={(event) => {
                      const v = Number(event.currentTarget.value);
                      if (Number.isFinite(v)) setStaggerMs(Math.max(0, Math.min(5000, v)));
                    }}
                  />
                  <span>ms</span>
                </label>
                <button
                  type="button"
                  class={`ps-toggle${staggerOrder === 'reverse' ? ' is-active' : ''}`}
                  data-testid="ps-trim-stagger-order-btn"
                  aria-pressed={staggerOrder === 'reverse'}
                  title="Toggle stagger order between Selection order and Reverse order"
                  onClick={() => setStaggerOrder((o) => (o === 'selection' ? 'reverse' : 'selection'))}
                >
                  {staggerOrder === 'selection' ? 'Forward' : 'Reverse'}
                </button>
                <button
                  type="button"
                  class="ps-btn ps-btn-accent"
                  data-testid="ps-trim-stagger-draw-in-btn"
                  title="Stagger Draw In across all selected shapes"
                  onClick={() => handleApplyTrimStagger('draw-in')}
                >
                  Stagger Draw In
                </button>
                <button
                  type="button"
                  class="ps-btn"
                  data-testid="ps-trim-stagger-dash-btn"
                  title="Stagger Traveling Dash across all selected shapes"
                  onClick={() => handleApplyTrimStagger('traveling-dash')}
                >
                  Stagger Dash
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
