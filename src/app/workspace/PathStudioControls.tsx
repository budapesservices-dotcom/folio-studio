import { useMemo, useState } from 'preact/hooks';
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
  createDefaultMotionPathForNode,
  createMotionPathFromPathNode,
  insertMotionPathPointOnSegment,
  removeMotionPathPoint,
  setMotionPathPointType,
} from '../../core/document/pathStudio';
import {
  MORPH_SHAPE_PRESETS,
  checkNodeMorphSupport,
  createMorphPresetSnapshot,
  extractMorphSnapshotFromNode,
  parsePathMorphSnapshot,
  updateMorphSnapshotOptions,
  type MorphShapePresetId,
} from '../../core/document/pathMorph';
import {
  addTrackToClip,
  createAnimationClip,
  enableTrimPathInClip,
  evaluateTrackAtTime,
  getDefaultNodePropertyValue,
  hasKeyframeAtTime,
  inspectComponentMorphSource,
  removeMotionPathFromClip,
  setNodeTrimModeInClip,
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
  onOpenSpeedCurve?: (nodeId: string) => void;
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
}: PathStudioControlsProps) {
  const [activeTab, setActiveTab] = useState<PathStudioTab>('motion-path');

  const nodes = activePage.document.nodes;
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const targetNode: DesignNode | null = useMemo(() => {
    for (const id of selectedNodeIds) {
      const n = nodeById.get(id);
      if (n) return n;
    }
    if (activeClip?.motionPaths?.[0]) {
      return nodeById.get(activeClip.motionPaths[0].targetNodeId) ?? null;
    }
    return null;
  }, [selectedNodeIds, nodeById, activeClip]);

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

  const activePointIndex = useMemo(() => {
    if (!motionBinding || motionBinding.points.length === 0) return 0;
    if (
      selectedMotionPathPoint &&
      selectedMotionPathPoint.nodeId === motionBinding.targetNodeId &&
      selectedMotionPathPoint.pointIndex >= 0 &&
      selectedMotionPathPoint.pointIndex < motionBinding.points.length
    ) {
      return selectedMotionPathPoint.pointIndex;
    }
    return 0;
  }, [motionBinding, selectedMotionPathPoint]);

  const activePoint = motionBinding?.points[activePointIndex] ?? null;

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

  const handleSetPointType = (pointType: VectorPointType) => {
    if (!motionBinding) return;
    const next = setMotionPathPointType(motionBinding, activePointIndex, pointType);
    commitMotionBinding(next, `Set Motion Path point to ${pointType}`);
  };

  const handleInsertPoint = () => {
    if (!motionBinding) return;
    const maxSeg = motionBinding.closed
      ? motionBinding.points.length - 1
      : Math.max(0, motionBinding.points.length - 2);
    const segIdx = Math.min(activePointIndex, maxSeg);
    const inserted = insertMotionPathPointOnSegment(motionBinding, segIdx, 0.5);
    if (inserted.insertedIndex < 0) return;
    commitMotionBinding(inserted.binding, 'Insert Motion Path point');
    onSelectMotionPathPoint?.({ nodeId: motionBinding.targetNodeId, pointIndex: inserted.insertedIndex });
  };

  const handleRemovePoint = () => {
    if (!motionBinding || motionBinding.points.length <= 2) return;
    const next = removeMotionPathPoint(motionBinding, activePointIndex);
    commitMotionBinding(next, 'Remove Motion Path point');
    onSelectMotionPathPoint?.({
      nodeId: motionBinding.targetNodeId,
      pointIndex: Math.max(0, Math.min(activePointIndex - 1, next.points.length - 1)),
    });
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
    // Nearest prior or first keyframe
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

  const morphTopologyBadge = useMemo(() => {
    if (morphTrack && morphTrack.keyframes.length >= 2) {
      const snaps = morphTrack.keyframes
        .map((kf) => (typeof kf.value === 'string' ? parsePathMorphSnapshot(kf.value) : null))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const hasOpen = snaps.some((s) => s.closed === false);
      const hasClosed = snaps.some((s) => s.closed !== false);
      const maxContours = snaps.reduce((acc, s) => Math.max(acc, 1 + (s.subpaths?.length ?? 0)), 1);
      if (hasOpen && hasClosed) return 'Open ↔ Closed Bridge';
      if (maxContours > 1) return `Multi-Contour (${maxContours})`;
      if (hasOpen) return 'Open Path';
      return 'Closed Path';
    }
    if (targetNode?.type === 'path') {
      const contours = 1 + (targetNode.subpaths?.length ?? 0);
      if (contours > 1) return `Multi-Contour (${contours})`;
      return targetNode.closed === false ? 'Open Path' : 'Closed Path';
    }
    return morphSupport.supported ? 'Closed Vector' : 'Unsupported';
  }, [morphTrack, targetNode, morphSupport.supported]);

  const handleApplyMorphPreset = (presetId: MorphShapePresetId) => {
    if (!targetNode || !morphSupport.supported) return;
    let clip = ensureClip();
    const added = addTrackToClip(clip, targetNode, 'pathMorph');
    clip = added.clip;
    const track = clip.tracks.find((t) => t.id === added.trackId);
    const snap = createMorphPresetSnapshot(presetId, targetNode.width, targetNode.height);
    if (track && track.keyframes.length === 0) {
      const baseSnap = extractMorphSnapshotFromNode(targetNode);
      if (baseSnap) {
        clip = upsertKeyframeInClip(clip, track.id, 0, baseSnap, 'ease-in-out').clip;
      }
    }
    const targetTime = playheadMs > 0 ? playheadMs : clip.durationMs;
    clip = upsertKeyframeInClip(clip, added.trackId, targetTime, snap, 'ease-in-out').clip;
    onUpdateClip(clip, `Morph ${targetNode.name} to ${presetId}`);
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
    let clip = ensureClip();
    const added = addTrackToClip(clip, targetNode, property);
    clip = added.clip;
    clip = upsertKeyframeInClip(clip, added.trackId, playheadMs, clamped, 'ease-in-out').clip;
    clip = setNodeTrimModeInClip(clip, targetNode.id, activeTrimMode);
    onUpdateClip(clip, `Update ${property} on ${targetNode.name}`, coalesceKey);
  };

  const handleToggleTrimKeyframe = (property: AnimatableProperty) => {
    if (!targetNode) return;
    const clip = ensureClip();
    const toggled = togglePropertyKeyframeInClip(clip, targetNode, property, playheadMs, {
      baselineNode: targetNode,
      easing: 'ease-in-out',
    });
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

  return (
    <section
      class="ps-bar"
      aria-label="FOLIO Path Studio controls"
      data-testid="path-studio-panel"
    >
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

      <div class="ps-content">
        {!targetNode ? (
          <div class="ps-empty">
            Select any layer on the canvas to author Motion Path, Shape Morph, or Trim Path animations.
          </div>
        ) : activeTab === 'motion-path' ? (
          <div class="ps-row-wrap" data-testid="path-studio-motion-content">
            <span class="ps-target-label" title={targetNode.name}>
              {targetNode.name}
            </span>

            {!motionBinding ? (
              <>
                <button
                  type="button"
                  class="ps-btn ps-btn-accent"
                  data-testid="ps-add-motion-path-btn"
                  onClick={handleAddMotionPath}
                  title="Attach an editable Bézier Motion Path directly on Canvas"
                >
                  + Add Motion Path
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
                <span class="ps-hint">
                  Move objects along editable Bézier curves with Auto Orient, Constant Speed, Offset, and Loop / Ping-Pong.
                </span>
              </>
            ) : (
              <>
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
                  <label class="ps-field" title="Rotation angle offset in degrees">
                    <span>Rot</span>
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

                <label class="ps-field" title="Start percent along path (0–100%)">
                  <span>Start</span>
                  <input
                    type="number"
                    class="ps-num"
                    min={0}
                    max={100}
                    step={5}
                    aria-label="Motion Path Start percent"
                    data-testid="ps-mp-start-input"
                    value={Math.round(motionBinding.startPct)}
                    onInput={(event) => {
                      const val = Number(event.currentTarget.value);
                      if (Number.isFinite(val)) {
                        commitMotionBinding(
                          { ...motionBinding, startPct: Math.max(0, Math.min(100, val)) },
                          'Update Motion Path Start',
                          `mp-start:${motionBinding.id}`,
                        );
                      }
                    }}
                  />
                  <span>%</span>
                </label>

                <label class="ps-field" title="End percent along path (0–100%)">
                  <span>End</span>
                  <input
                    type="number"
                    class="ps-num"
                    min={0}
                    max={100}
                    step={5}
                    aria-label="Motion Path End percent"
                    data-testid="ps-mp-end-input"
                    value={Math.round(motionBinding.endPct)}
                    onInput={(event) => {
                      const val = Number(event.currentTarget.value);
                      if (Number.isFinite(val)) {
                        commitMotionBinding(
                          { ...motionBinding, endPct: Math.max(0, Math.min(100, val)) },
                          'Update Motion Path End',
                          `mp-end:${motionBinding.id}`,
                        );
                      }
                    }}
                  />
                  <span>%</span>
                </label>

                <label class="ps-field" title="Perpendicular offset from path in pixels">
                  <span>Offset</span>
                  <input
                    type="number"
                    class="ps-num"
                    min={-1000}
                    max={1000}
                    step={4}
                    aria-label="Motion Path perpendicular offset (px)"
                    data-testid="ps-mp-offset-input"
                    value={Math.round(motionBinding.offsetPx)}
                    onInput={(event) => {
                      const val = Number(event.currentTarget.value);
                      if (Number.isFinite(val)) {
                        commitMotionBinding(
                          { ...motionBinding, offsetPx: val },
                          'Update Motion Path offset',
                          `mp-offset:${motionBinding.id}`,
                        );
                      }
                    }}
                  />
                  <span>px</span>
                </label>

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

                <span class="ps-divider" aria-hidden="true" />

                {/* Direct Anchor Point Controls */}
                <div class="ps-point-group" role="group" aria-label="Selected anchor point">
                  <button
                    type="button"
                    class="ps-mini-btn"
                    title="Previous anchor point"
                    onClick={() =>
                      onSelectMotionPathPoint?.({
                        nodeId: motionBinding.targetNodeId,
                        pointIndex:
                          (activePointIndex - 1 + motionBinding.points.length) %
                          motionBinding.points.length,
                      })
                    }
                  >
                    ‹
                  </button>
                  <span class="ps-point-label" data-testid="ps-mp-point-label">
                    Pt {activePointIndex + 1}/{motionBinding.points.length}
                  </span>
                  <button
                    type="button"
                    class="ps-mini-btn"
                    title="Next anchor point"
                    onClick={() =>
                      onSelectMotionPathPoint?.({
                        nodeId: motionBinding.targetNodeId,
                        pointIndex: (activePointIndex + 1) % motionBinding.points.length,
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
                  disabled={motionBinding.points.length <= 2}
                  title="Remove selected anchor point (minimum 2 points)"
                  onClick={handleRemovePoint}
                >
                  − Pt
                </button>

                {onOpenSpeedCurve && (
                  <button
                    type="button"
                    class="ps-btn"
                    data-testid="ps-mp-speed-curve-btn"
                    title="Open Easing Graph Editor for Motion Path speed control"
                    onClick={() => onOpenSpeedCurve(motionBinding.targetNodeId)}
                  >
                    Speed Curve
                  </button>
                )}

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
        ) : activeTab === 'shape-morph' ? (
          <div class="ps-row-wrap" data-testid="path-studio-morph-content">
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

                <span class="ps-divider" aria-hidden="true" />

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

                {activeMorphSnap && (
                  <>
                    <span class="ps-divider" aria-hidden="true" />
                    <div class="ps-seg" role="group" aria-label="Vertex matching mode">
                      <button
                        type="button"
                        class={`ps-seg-btn${(activeMorphSnap.morph?.matchMode ?? 'auto') === 'auto' ? ' is-active' : ''}`}
                        onClick={() => handleUpdateMorphOptions({ matchMode: 'auto' })}
                      >
                        Auto Match
                      </button>
                      <button
                        type="button"
                        class={`ps-seg-btn${activeMorphSnap.morph?.matchMode === 'index' ? ' is-active' : ''}`}
                        onClick={() => handleUpdateMorphOptions({ matchMode: 'index' })}
                      >
                        Index
                      </button>
                    </div>
                    <button
                      type="button"
                      class={`ps-toggle${activeMorphSnap.morph?.reverse ? ' is-active' : ''}`}
                      aria-pressed={Boolean(activeMorphSnap.morph?.reverse)}
                      onClick={() => handleUpdateMorphOptions({ reverse: !activeMorphSnap.morph?.reverse })}
                    >
                      Reverse
                    </button>
                    <button
                      type="button"
                      class="ps-btn"
                      title="Shift morph start vertex backward"
                      onClick={() => handleUpdateMorphOptions({ startOffsetDelta: -1 })}
                    >
                      Start −
                    </button>
                    <button
                      type="button"
                      class="ps-btn"
                      title="Shift morph start vertex forward"
                      onClick={() => handleUpdateMorphOptions({ startOffsetDelta: 1 })}
                    >
                      Start +
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          <div class="ps-row-wrap" data-testid="path-studio-trim-content">
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

                <span class="ps-divider" aria-hidden="true" />

                <label class="ps-field" title="Trim Start percentage (0–100%)">
                  <span>Start</span>
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
                    title="Toggle Trim Start keyframe at playhead"
                    onClick={() => handleToggleTrimKeyframe('trimStart')}
                  >
                    ◆
                  </button>
                </label>

                <label class="ps-field" title="Trim End percentage (0–100%)">
                  <span>End</span>
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
                    title="Toggle Trim End keyframe at playhead"
                    onClick={() => handleToggleTrimKeyframe('trimEnd')}
                  >
                    ◆
                  </button>
                </label>

                <label class="ps-field" title="Trim Offset percentage (wraps around 100%)">
                  <span>Offset</span>
                  <input
                    type="number"
                    class="ps-num"
                    min={-1000}
                    max={1000}
                    step={5}
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
                    title="Toggle Trim Offset keyframe at playhead"
                    onClick={() => handleToggleTrimKeyframe('trimOffset')}
                  >
                    ◆
                  </button>
                </label>

                <span class="ps-divider" aria-hidden="true" />

                <button
                  type="button"
                  class={`ps-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'strokeWidth', playheadMs) ? ' is-active' : ''}`}
                  title="Keyframe Stroke Width at playhead to compose with Trim Path"
                  onClick={() => handleToggleTrimKeyframe('strokeWidth')}
                >
                  ◆ Stroke W
                </button>
                <button
                  type="button"
                  class={`ps-btn${activeClip && hasKeyframeAtTime(activeClip, targetNode.id, 'opacity', playheadMs) ? ' is-active' : ''}`}
                  title="Keyframe Opacity at playhead to compose with Trim Path"
                  onClick={() => handleToggleTrimKeyframe('opacity')}
                >
                  ◆ Opacity
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
