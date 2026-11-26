import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AnimatableProperty,
  AnimationClip,
  AnimationEasing,
  AnimationKeyframe,
  AnimationTrack,
  ComponentDefinition,
  CustomEasingPreset,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
} from '../../core/document/types';
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
  ANIMATABLE_PROPERTIES,
  ANIMATABLE_PROPERTY_META,
  MOTION_PRESETS,
  addTrackToClip,
  captureNodeKeyframeSnapshot,
  deleteKeyframeFromClip,
  deleteLayerKeyframesAtTimeInClip,
  evaluateTrackAtTime,
  formatEasingLabel,
  getDefaultNodePropertyValue,
  groupClipTracksByNode,
  inspectComponentMorphSource,
  moveLayerKeyframesInClip,
  removeLayerTracksFromClip,
  removeTrackFromClip,
  updateClipSettings,
  updateKeyframeInClip,
  updateLayerKeyframesEasingInClip,
  upsertKeyframeInClip,
  type MotionPresetDefinition,
} from '../../engines/animation';
import { EasingCurveMiniSvg, MotionGraphEditor } from './MotionGraphEditor';
import { StudioContextMenu, type StudioContextMenuEntry } from './StudioContextMenu';
import { StudioIcon } from './StudioIcon';

export interface MotionTimelinePanelProps {
  workspaceScope?: 'main' | 'component';
  activePage: FolioPage;
  pageClips: readonly AnimationClip[];
  activeClip: AnimationClip | null;
  components?: readonly ComponentDefinition[];
  designTokens?: DesignTokenCollection;
  customEasings?: readonly CustomEasingPreset[];
  selectedNodeIds: readonly string[];
  playheadMs: number;
  isPlaying: boolean;
  previewActive: boolean;
  autoKeyEnabled: boolean;
  onToggleAutoKey: () => void;
  onSelectClip: (clipId: string) => void;
  onCreateClip: () => void;
  onApplyPreset: (presetId: MotionPresetDefinition['id']) => void;
  onDeleteClip: () => void;
  onUpdateClip: (nextClip: AnimationClip, description?: string, coalesceKey?: string) => void;
  onUpdateCustomEasings?: (nextCustomEasings: readonly CustomEasingPreset[], description?: string) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (ms: number) => void;
  onKeyframeSelected: () => void;
  onKeyframePathMorph?: () => void;
  onImportMorphFromComponent?: (
    component: ComponentDefinition,
    options?: { targetNodeId?: string; atTimeMs?: number },
  ) => void;
  onEditMorphPoints?: (nodeId: string) => void;
  onOpenLivePreview: (pageId?: string) => void;
  onOpenMotionExport?: () => void;
  onSelectCanvasNode: (nodeId: string) => void;
  onFocusStudio?: () => void;
  onClose: () => void;
}

type TimelineSelection =
  | { kind: 'track'; trackId: string; keyframeId: string }
  | { kind: 'layer'; targetNodeId: string; timeMs: number };

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTrackValue(property: AnimatableProperty, value: number | string | undefined): string {
  if (value === undefined) return '—';
  if (property === 'pathMorph' && typeof value === 'string') {
    const snap = parsePathMorphSnapshot(value);
    if (!snap) return 'Shape';
    return snap.label ? `${snap.label} (${snap.points.length})` : `${snap.points.length} pts`;
  }
  if (typeof value === 'string') return value;
  const meta = ANIMATABLE_PROPERTY_META[property];
  const rounded = property === 'opacity' || property === 'shadowOpacity' || property === 'scale'
    ? value.toFixed(2)
    : Math.round(value).toString();
  return meta.unit ? `${rounded}${meta.unit}` : rounded;
}

export function MotionTimelinePanel({
  workspaceScope = 'main',
  activePage,
  pageClips,
  activeClip,
  components = [],
  designTokens,
  customEasings = [],
  selectedNodeIds,
  playheadMs,
  isPlaying,
  previewActive,
  autoKeyEnabled,
  onToggleAutoKey,
  onSelectClip,
  onCreateClip,
  onApplyPreset,
  onDeleteClip,
  onUpdateClip,
  onUpdateCustomEasings,
  onTogglePlay,
  onStop,
  onSeek,
  onKeyframeSelected,
  onKeyframePathMorph,
  onImportMorphFromComponent,
  onEditMorphPoints,
  onOpenLivePreview,
  onOpenMotionExport,
  onSelectCanvasNode,
  onFocusStudio,
  onClose,
}: MotionTimelinePanelProps) {
  const nodes = activePage.document.nodes;
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const componentMorphOptions = useMemo(
    () =>
      components.map((component) => ({
        component,
        info: inspectComponentMorphSource(component, designTokens),
      })),
    [components, designTokens],
  );
  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );
  const selectedMorphInfo = useMemo(() => {
    const selectedNodes = selectedNodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is DesignNode => Boolean(n));
    if (selectedNodes.length === 0) {
      return {
        supported: false,
        message: 'Select a closed vector shape (Circle, Rectangle, Frame, or closed Path) to enable Shape Morph.',
      };
    }
    const supportedNode = selectedNodes.find((n) => checkNodeMorphSupport(n).supported);
    if (supportedNode) {
      return {
        supported: true,
        message: 'Enable Shape Morph or add a geometry keyframe at the current playhead (preserves exact object ID)',
      };
    }
    const firstCheck = checkNodeMorphSupport(selectedNodes[0]);
    return {
      supported: false,
      message: firstCheck.message,
    };
  }, [selectedNodeIds, nodeById]);

  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [graphEditorOpen, setGraphEditorOpen] = useState(false);
  const [expandedOverrides, setExpandedOverrides] = useState<Readonly<Record<string, boolean>>>(() => ({}));
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [newTrackNodeId, setNewTrackNodeId] = useState<string>('');
  const [newTrackProperty, setNewTrackProperty] = useState<AnimatableProperty>('y');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target:
      | { kind: 'stage' }
      | { kind: 'layer'; targetNodeId: string }
      | { kind: 'track'; track: AnimationTrack }
      | { kind: 'keyframe'; track: AnimationTrack; keyframe: AnimationKeyframe }
      | { kind: 'master-keyframe'; targetNodeId: string; timeMs: number };
  } | null>(null);

  const rulerRef = useRef<HTMLDivElement | null>(null);
  const lanesContainerRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const pendingMorphAutoSelectRef = useRef<{ nodeIds: readonly string[]; timeMs: number } | null>(null);
  const activeClipRef = useRef<AnimationClip | null>(activeClip);
  activeClipRef.current = activeClip;

  useEffect(() => {
    const pending = pendingMorphAutoSelectRef.current;
    if (!pending || !activeClip) return;
    const morphTrack = activeClip.tracks.find(
      (t) => t.property === 'pathMorph' && pending.nodeIds.includes(t.targetNodeId),
    );
    if (!morphTrack || morphTrack.keyframes.length === 0) return;
    const targetKf =
      morphTrack.keyframes.find((kf) => Math.abs(kf.timeMs - pending.timeMs) <= 20) ??
      morphTrack.keyframes[morphTrack.keyframes.length - 1];
    if (targetKf) {
      pendingMorphAutoSelectRef.current = null;
      setSelection({ kind: 'track', trackId: morphTrack.id, keyframeId: targetKf.id });
    }
  }, [activeClip]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleOutside = (event: PointerEvent) => {
      if (moreRef.current && event.target instanceof Node && moreRef.current.contains(event.target)) return;
      setMoreOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [moreOpen]);

  // Keep selected add-track target synced with canvas selection or first visible node
  useEffect(() => {
    if (selectedNodeIds.length > 0 && nodeById.has(selectedNodeIds[0])) {
      setNewTrackNodeId(selectedNodeIds[0]);
      return;
    }
    if (!newTrackNodeId || !nodeById.has(newTrackNodeId)) {
      const first = nodes.find((n) => n.visible && n.onCanvas !== false) ?? nodes[0];
      setNewTrackNodeId(first?.id ?? '');
    }
  }, [selectedNodeIds, nodes, nodeById, newTrackNodeId]);

  const groupedLayers = useMemo(
    () => (activeClip ? groupClipTracksByNode(activeClip) : []),
    [activeClip],
  );

  // Validate active selection against current clip
  const activeTrackSelection = useMemo<{ track: AnimationTrack; keyframe: AnimationKeyframe } | null>(() => {
    if (!activeClip || !selection || selection.kind !== 'track') return null;
    const track = activeClip.tracks.find((t) => t.id === selection.trackId);
    if (!track) return null;
    const keyframe = track.keyframes.find((k) => k.id === selection.keyframeId);
    if (!keyframe) return null;
    return { track, keyframe };
  }, [activeClip, selection]);

  const activeLayerSelection = useMemo<{
    targetNodeId: string;
    timeMs: number;
    trackCount: number;
    easing: AnimationEasing;
  } | null>(() => {
    if (!activeClip || !selection || selection.kind !== 'layer') return null;
    const group = groupedLayers.find((g) => g.targetNodeId === selection.targetNodeId);
    if (!group || !group.keyframeTimes.some((t) => Math.abs(t - selection.timeMs) <= 1)) return null;
    let easing: AnimationEasing = 'ease-out';
    for (const track of group.tracks) {
      const kf = track.keyframes.find((k) => Math.abs(k.timeMs - selection.timeMs) <= 1);
      if (kf) {
        easing = kf.easing;
        break;
      }
    }
    return {
      targetNodeId: selection.targetNodeId,
      timeMs: selection.timeMs,
      trackCount: group.tracks.length,
      easing,
    };
  }, [activeClip, selection, groupedLayers]);

  const durationMs = activeClip?.durationMs ?? 1200;
  const playheadPct = Math.max(0, Math.min(100, (playheadMs / Math.max(1, durationMs)) * 100));

  const tickMarks = useMemo(() => {
    const stepCount = durationMs <= 1200 ? 4 : durationMs <= 2400 ? 6 : 8;
    const marks: Array<{ ms: number; pct: number; label: string }> = [];
    for (let i = 0; i <= stepCount; i += 1) {
      const ms = Math.round((durationMs * i) / stepCount);
      marks.push({
        ms,
        pct: (i / stepCount) * 100,
        label: `${(ms / 1000).toFixed(durationMs < 1000 ? 2 : 1)}s`,
      });
    }
    return marks;
  }, [durationMs]);

  const computeTimeFromClientX = (clientX: number, rect: DOMRect): number => {
    const inset = 12;
    const trackWidth = Math.max(1, rect.width - inset * 2);
    const ratio = Math.max(0, Math.min(1, (clientX - (rect.left + inset)) / trackWidth));
    return Math.round((ratio * durationMs) / 10) * 10;
  };

  const isLayerGroupExpanded = (targetNodeId: string, trackCount: number): boolean => {
    const key = `${activeClip?.id ?? ''}:${targetNodeId}`;
    const override = expandedOverrides[key];
    if (override !== undefined) return override;
    // Compact hand-authored or preset layers (<= 4 animated properties) expand
    // by default so individual property tracks are immediately inspectable;
    // dense full-pose Auto-Key snapshots stay collapsed until expanded.
    return trackCount <= 4;
  };

  const toggleExpandLayer = (targetNodeId: string, trackCount: number) => {
    const key = `${activeClip?.id ?? ''}:${targetNodeId}`;
    setExpandedOverrides((prev) => {
      const current = prev[key] ?? trackCount <= 4;
      return { ...prev, [key]: !current };
    });
  };

  const handleRulerPointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const rect = target.getBoundingClientRect();
    onSeek(computeTimeFromClientX(event.clientX, rect));

    const handleMove = (moveEvent: PointerEvent) => {
      onSeek(computeTimeFromClientX(moveEvent.clientX, rect));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleKeyframePointerDown = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
    track: AnimationTrack,
    kf: AnimationKeyframe,
  ) => {
    event.stopPropagation();
    setSelection({ kind: 'track', trackId: track.id, keyframeId: kf.id });
    onSeek(kf.timeMs);

    const startClip = activeClipRef.current;
    if (!startClip) return;
    const laneEl = (event.currentTarget as HTMLElement).parentElement;
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const startX = event.clientX;
    const origTimeMs = kf.timeMs;

    const handleMove = (moveEvent: PointerEvent) => {
      const currentClip = activeClipRef.current;
      if (!currentClip || rect.width <= 0) return;
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) < 3) return;
      const deltaMs = (dx / rect.width) * currentClip.durationMs;
      const nextTime = Math.max(
        0,
        Math.min(currentClip.durationMs, Math.round((origTimeMs + deltaMs) / 10) * 10),
      );
      const updated = updateKeyframeInClip(currentClip, track.id, kf.id, { timeMs: nextTime });
      onUpdateClip(updated, 'Move keyframe');
      onSeek(nextTime);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleMasterKeyframePointerDown = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
    targetNodeId: string,
    timeMs: number,
  ) => {
    event.stopPropagation();
    setSelection({ kind: 'layer', targetNodeId, timeMs });
    onSeek(timeMs);

    const startClip = activeClipRef.current;
    if (!startClip) return;
    const laneEl = (event.currentTarget as HTMLElement).parentElement;
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const startX = event.clientX;
    let currentTimeMs = timeMs;

    const handleMove = (moveEvent: PointerEvent) => {
      const currentClip = activeClipRef.current;
      if (!currentClip || rect.width <= 0) return;
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) < 3) return;
      const deltaMs = (dx / rect.width) * currentClip.durationMs;
      const nextTime = Math.max(
        0,
        Math.min(currentClip.durationMs, Math.round((timeMs + deltaMs) / 10) * 10),
      );
      if (nextTime === currentTimeMs) return;
      const updated = moveLayerKeyframesInClip(currentClip, targetNodeId, currentTimeMs, nextTime);
      currentTimeMs = nextTime;
      onUpdateClip(updated, 'Move layer keyframe pose');
      setSelection({ kind: 'layer', targetNodeId, timeMs: nextTime });
      onSeek(nextTime);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleLaneDoubleClick = (
    event: JSX.TargetedMouseEvent<HTMLDivElement>,
    track: AnimationTrack,
  ) => {
    if (!activeClip) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickedMs = computeTimeFromClientX(event.clientX, rect);
    const node = nodeById.get(track.targetNodeId);
    const evaluated = evaluateTrackAtTime(track, clickedMs)
      ?? (node ? getDefaultNodePropertyValue(node, track.property) : 0);
    const added = upsertKeyframeInClip(activeClip, track.id, clickedMs, evaluated, 'ease-out');
    onUpdateClip(added.clip, `Insert ${track.property} keyframe`);
    setSelection({ kind: 'track', trackId: track.id, keyframeId: added.keyframeId });
    onSeek(clickedMs);
  };

  const handleMasterLaneDoubleClick = (
    event: JSX.TargetedMouseEvent<HTMLDivElement>,
    targetNodeId: string,
  ) => {
    if (!activeClip) return;
    const node = nodeById.get(targetNodeId);
    if (!node) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickedMs = computeTimeFromClientX(event.clientX, rect);
    const group = groupedLayers.find((g) => g.targetNodeId === targetNodeId);
    let nextClip = activeClip;
    if (group && group.tracks.length > 0) {
      for (const track of group.tracks) {
        const evaluated = evaluateTrackAtTime(track, clickedMs)
          ?? getDefaultNodePropertyValue(node, track.property);
        nextClip = upsertKeyframeInClip(nextClip, track.id, clickedMs, evaluated, 'ease-out').clip;
      }
    } else {
      nextClip = captureNodeKeyframeSnapshot(activeClip, node, clickedMs, {
        baselineNode: node,
        easing: 'ease-out',
      }).clip;
    }
    onUpdateClip(nextClip, `Insert full keyframe for ${node.name}`);
    setSelection({ kind: 'layer', targetNodeId, timeMs: clickedMs });
    onSeek(clickedMs);
  };

  const handleQuickKeyframeLayer = (targetNodeId: string) => {
    if (!activeClip) return;
    const node = nodeById.get(targetNodeId);
    if (!node) return;
    const group = groupedLayers.find((g) => g.targetNodeId === targetNodeId);
    let nextClip = activeClip;
    if (group && group.tracks.length > 0) {
      for (const track of group.tracks) {
        const val = evaluateTrackAtTime(track, playheadMs)
          ?? getDefaultNodePropertyValue(node, track.property);
        nextClip = upsertKeyframeInClip(nextClip, track.id, playheadMs, val, 'ease-out').clip;
      }
    } else {
      nextClip = captureNodeKeyframeSnapshot(activeClip, node, playheadMs, {
        baselineNode: node,
        easing: 'ease-out',
      }).clip;
    }
    onUpdateClip(nextClip, `Insert full keyframe for ${node.name}`);
    setSelection({ kind: 'layer', targetNodeId, timeMs: playheadMs });
  };

  const handleRemoveLayerTracks = (targetNodeId: string) => {
    if (!activeClip) return;
    const node = nodeById.get(targetNodeId);
    const nextClip = removeLayerTracksFromClip(activeClip, targetNodeId);
    if (selection?.kind === 'layer' && selection.targetNodeId === targetNodeId) {
      setSelection(null);
    }
    onUpdateClip(nextClip, `Remove all tracks for ${node?.name ?? targetNodeId}`);
  };

  const handleAddTrack = () => {
    if (!activeClip) return;
    const node: DesignNode | undefined = nodeById.get(newTrackNodeId);
    if (!node) return;
    const { clip: nextClip, trackId } = addTrackToClip(activeClip, node, newTrackProperty);
    if (nextClip !== activeClip) {
      onUpdateClip(nextClip, `Add ${newTrackProperty} track for ${node.name}`);
      const expandKey = `${activeClip.id}:${node.id}`;
      setExpandedOverrides((prev) => ({ ...prev, [expandKey]: true }));
      const addedTrack = nextClip.tracks.find((t) => t.id === trackId);
      if (addedTrack && addedTrack.keyframes[0]) {
        setSelection({ kind: 'track', trackId: addedTrack.id, keyframeId: addedTrack.keyframes[0].id });
      }
    }
  };

  const handleQuickKeyframeTrack = (track: AnimationTrack) => {
    if (!activeClip) return;
    const node = nodeById.get(track.targetNodeId);
    const value = evaluateTrackAtTime(track, playheadMs)
      ?? (node ? getDefaultNodePropertyValue(node, track.property) : 0);
    const added = upsertKeyframeInClip(activeClip, track.id, playheadMs, value, 'ease-out');
    onUpdateClip(added.clip, `Insert ${track.property} keyframe`);
    setSelection({ kind: 'track', trackId: track.id, keyframeId: added.keyframeId });
  };

  const handleRemoveTrack = (track: AnimationTrack) => {
    if (!activeClip) return;
    const nextClip = removeTrackFromClip(activeClip, track.id);
    if (selection?.kind === 'track' && selection.trackId === track.id) setSelection(null);
    onUpdateClip(nextClip, `Remove ${track.property} track`);
  };

  const handleDurationChange = (raw: string) => {
    if (!activeClip) return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 100) return;
    const clamped = Math.min(60_000, Math.max(100, parsed));
    onUpdateClip(updateClipSettings(activeClip, { durationMs: clamped }), 'Update clip duration');
  };

  const handleToggleLoop = () => {
    if (!activeClip) return;
    onUpdateClip(updateClipSettings(activeClip, { loop: !activeClip.loop }), 'Toggle clip loop');
  };

  const handleToggleAutoplay = () => {
    if (!activeClip) return;
    onUpdateClip(updateClipSettings(activeClip, { autoplay: !activeClip.autoplay }), 'Toggle clip autoplay');
  };

  const handleInspectorPatch = (
    patch: Partial<Pick<AnimationKeyframe, 'timeMs' | 'value' | 'easing'>>,
    coalesceKey?: string,
  ) => {
    if (!activeClip || !activeTrackSelection) return;
    const nextClip = updateKeyframeInClip(
      activeClip,
      activeTrackSelection.track.id,
      activeTrackSelection.keyframe.id,
      patch,
    );
    onUpdateClip(nextClip, 'Update keyframe', coalesceKey);
    if (patch.timeMs !== undefined) {
      onSeek(patch.timeMs);
    }
  };

  const handleGraphEasingChange = (nextEasing: AnimationEasing, coalesceKey?: string) => {
    if (!activeClip) return;
    if (activeTrackSelection) {
      handleInspectorPatch(
        { easing: nextEasing },
        coalesceKey ? `easing:${activeTrackSelection.keyframe.id}:${coalesceKey}` : undefined,
      );
      return;
    }
    if (activeLayerSelection) {
      const nextClip = updateLayerKeyframesEasingInClip(
        activeClip,
        activeLayerSelection.targetNodeId,
        activeLayerSelection.timeMs,
        nextEasing,
      );
      onUpdateClip(
        nextClip,
        'Update layer keyframe easing',
        coalesceKey ? `easing-layer:${activeLayerSelection.targetNodeId}:${activeLayerSelection.timeMs}:${coalesceKey}` : undefined,
      );
    }
  };

  const handleDeleteSelectedKeyframe = () => {
    if (!activeClip) return;
    if (activeTrackSelection) {
      const nextClip = deleteKeyframeFromClip(
        activeClip,
        activeTrackSelection.track.id,
        activeTrackSelection.keyframe.id,
      );
      setSelection(null);
      onUpdateClip(nextClip, 'Delete keyframe');
      return;
    }
    if (activeLayerSelection) {
      const nextClip = deleteLayerKeyframesAtTimeInClip(
        activeClip,
        activeLayerSelection.targetNodeId,
        activeLayerSelection.timeMs,
      );
      setSelection(null);
      onUpdateClip(nextClip, 'Delete layer keyframe pose');
    }
  };

  const buildMotionContextEntries = (): StudioContextMenuEntry[] => {
    if (!contextMenu) return [];
    const { target } = contextMenu;
    const presetEasings: readonly { id: AnimationEasing; label: string }[] = [
      { id: 'linear', label: 'Linear' },
      { id: 'ease-in', label: 'Ease In' },
      { id: 'ease-out', label: 'Ease Out' },
      { id: 'ease-in-out', label: 'Ease In-Out' },
    ];

    if (target.kind === 'keyframe' && activeClip) {
      const layerName = nodeById.get(target.track.targetNodeId)?.name ?? 'Layer';
      const propLabel = ANIMATABLE_PROPERTY_META[target.track.property].label;
      return [
        { kind: 'header', id: 'hdr-kf', label: `${layerName} · ${propLabel}`, meta: `${target.keyframe.timeMs}ms` },
        {
          kind: 'item',
          id: 'kf-graph',
          label: 'Open Easing Graph Editor',
          onSelect: () => {
            setSelection({ kind: 'track', trackId: target.track.id, keyframeId: target.keyframe.id });
            setGraphEditorOpen(true);
          },
        },
        { kind: 'divider', id: 'div-kf-ease' },
        { kind: 'header', id: 'hdr-kf-ease', label: 'Easing Curve' },
        ...presetEasings.map((item) => ({
          kind: 'item' as const,
          id: `kf-ease-${String(item.id)}`,
          label: item.label,
          active: target.keyframe.easing === item.id,
          onSelect: () => {
            const nextClip = updateKeyframeInClip(activeClip, target.track.id, target.keyframe.id, { easing: item.id });
            onUpdateClip(nextClip, 'Update keyframe easing');
          },
        })),
        { kind: 'divider', id: 'div-kf-del' },
        {
          kind: 'item',
          id: 'kf-del',
          label: 'Delete Keyframe',
          shortcut: ['Delete'],
          tone: 'danger',
          onSelect: () => {
            const nextClip = deleteKeyframeFromClip(activeClip, target.track.id, target.keyframe.id);
            setSelection(null);
            onUpdateClip(nextClip, 'Delete keyframe');
          },
        },
      ];
    }

    if (target.kind === 'master-keyframe' && activeClip) {
      const layerName = nodeById.get(target.targetNodeId)?.name ?? 'Layer';
      return [
        { kind: 'header', id: 'hdr-mkf', label: `${layerName} · Pose`, meta: `${target.timeMs}ms` },
        {
          kind: 'item',
          id: 'mkf-graph',
          label: 'Open Easing Graph Editor',
          onSelect: () => {
            setSelection({ kind: 'layer', targetNodeId: target.targetNodeId, timeMs: target.timeMs });
            setGraphEditorOpen(true);
          },
        },
        { kind: 'divider', id: 'div-mkf-ease' },
        { kind: 'header', id: 'hdr-mkf-ease', label: 'Pose Easing' },
        ...presetEasings.map((item) => ({
          kind: 'item' as const,
          id: `mkf-ease-${String(item.id)}`,
          label: item.label,
          onSelect: () => {
            const nextClip = updateLayerKeyframesEasingInClip(activeClip, target.targetNodeId, target.timeMs, item.id);
            onUpdateClip(nextClip, 'Update layer pose easing');
          },
        })),
        { kind: 'divider', id: 'div-mkf-del' },
        {
          kind: 'item',
          id: 'mkf-del',
          label: 'Delete Layer Pose',
          shortcut: ['Delete'],
          tone: 'danger',
          onSelect: () => {
            const nextClip = deleteLayerKeyframesAtTimeInClip(activeClip, target.targetNodeId, target.timeMs);
            setSelection(null);
            onUpdateClip(nextClip, 'Delete layer keyframe pose');
          },
        },
      ];
    }

    if (target.kind === 'track') {
      const layerName = nodeById.get(target.track.targetNodeId)?.name ?? 'Layer';
      const propLabel = ANIMATABLE_PROPERTY_META[target.track.property].label;
      return [
        { kind: 'header', id: 'hdr-trk', label: `${layerName} · ${propLabel}` },
        {
          kind: 'item',
          id: 'trk-kf',
          label: `Add Keyframe at ${formatSeconds(playheadMs)}`,
          onSelect: () => handleQuickKeyframeTrack(target.track),
        },
        {
          kind: 'item',
          id: 'trk-sel',
          label: 'Select Layer on Canvas',
          onSelect: () => onSelectCanvasNode(target.track.targetNodeId),
        },
        { kind: 'divider', id: 'div-trk-del' },
        {
          kind: 'item',
          id: 'trk-del',
          label: `Remove ${propLabel} Track`,
          tone: 'danger',
          onSelect: () => handleRemoveTrack(target.track),
        },
      ];
    }

    if (target.kind === 'layer') {
      const targetNode = nodeById.get(target.targetNodeId);
      const isPath = targetNode?.type === 'path';
      return [
        { kind: 'header', id: 'hdr-lyr', label: targetNode?.name ?? 'Layer Track' },
        {
          kind: 'item',
          id: 'lyr-kf',
          label: `Keyframe All Properties at ${formatSeconds(playheadMs)}`,
          shortcut: ['K'],
          onSelect: () => handleQuickKeyframeLayer(target.targetNodeId),
        },
        ...(isPath && onKeyframePathMorph
          ? [
              {
                kind: 'item' as const,
                id: 'lyr-morph',
                label: 'Keyframe Shape Points & Curves',
                onSelect: () => {
                  onSelectCanvasNode(target.targetNodeId);
                  onKeyframePathMorph();
                },
              },
            ]
          : []),
        {
          kind: 'item',
          id: 'lyr-sel',
          label: 'Select Layer on Canvas',
          onSelect: () => onSelectCanvasNode(target.targetNodeId),
        },
        { kind: 'divider', id: 'div-lyr-del' },
        {
          kind: 'item',
          id: 'lyr-del',
          label: 'Remove All Tracks for Layer',
          tone: 'danger',
          onSelect: () => handleRemoveLayerTracks(target.targetNodeId),
        },
      ];
    }

    // Stage / ruler context menu
    return [
      { kind: 'header', id: 'hdr-stage', label: 'Motion Timeline', meta: formatSeconds(playheadMs) },
      {
        kind: 'item',
        id: 'stg-play',
        label: isPlaying ? 'Pause Playback' : 'Play Animation',
        shortcut: ['Space'],
        disabled: !activeClip,
        onSelect: onTogglePlay,
      },
      {
        kind: 'item',
        id: 'stg-home',
        label: 'Jump to Start (0.00s)',
        shortcut: ['Home'],
        disabled: !activeClip,
        onSelect: () => onSeek(0),
      },
      {
        kind: 'item',
        id: 'stg-loop',
        label: 'Loop Playback',
        active: Boolean(activeClip?.loop),
        disabled: !activeClip,
        onSelect: handleToggleLoop,
      },
      {
        kind: 'item',
        id: 'stg-autokey',
        label: 'Auto-Key Recording',
        active: autoKeyEnabled,
        onSelect: onToggleAutoKey,
      },
      { kind: 'divider', id: 'div-stg' },
      {
        kind: 'item',
        id: 'stg-kf',
        label: 'Keyframe Selected Layer',
        shortcut: ['K'],
        disabled: selectedNodeIds.length === 0,
        onSelect: onKeyframeSelected,
      },
      ...(onKeyframePathMorph
        ? [
            {
              kind: 'item' as const,
              id: 'stg-morph',
              label: 'Enable / Add Shape Morph Keyframe',
              disabled: !selectedMorphInfo.supported,
              onSelect: onKeyframePathMorph,
            },
          ]
        : []),
      {
        kind: 'item',
        id: 'stg-new',
        label: 'Create New Clip',
        onSelect: onCreateClip,
      },
    ];
  };

  const handleDockKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space' && activeClip) {
      event.preventDefault();
      onTogglePlay();
    } else if (event.key === 'Home' && activeClip) {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === 'ArrowRight' && activeClip) {
      event.preventDefault();
      onSeek(Math.min(durationMs, playheadMs + (event.shiftKey ? 200 : 50)));
    } else if (event.key === 'ArrowLeft' && activeClip) {
      event.preventDefault();
      onSeek(Math.max(0, playheadMs - (event.shiftKey ? 200 : 50)));
    } else if (event.key.toLowerCase() === 'k' && selectedNodeIds.length > 0) {
      event.preventDefault();
      onKeyframeSelected();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && (activeTrackSelection || activeLayerSelection)) {
      event.preventDefault();
      handleDeleteSelectedKeyframe();
    }
  };

  return (
    <section
      class="motion-timeline-dock"
      aria-label="Motion Timeline Studio"
      data-testid="motion-timeline"
      tabIndex={-1}
      onKeyDown={handleDockKeyDown}
      onPointerDown={() => onFocusStudio?.()}
      onFocus={() => onFocusStudio?.()}
      onContextMenu={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.matches('input, textarea, select')) return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, target: { kind: 'stage' } });
      }}
    >
      <header class="mt-header">
        <div class="mt-header-group mt-clip-controls">
          <span class="mt-brand-label">
            <StudioIcon name="motion" />
            <span>Motion</span>
            {workspaceScope === 'component' && (
              <span class="mt-scope-badge" data-testid="motion-component-badge" title="Component Master Animation">
                COMP
              </span>
            )}
          </span>

          <select
            class="mt-select mt-clip-select"
            aria-label="Active animation clip"
            value={activeClip?.id ?? ''}
            disabled={pageClips.length === 0}
            onChange={(event) => onSelectClip(event.currentTarget.value)}
          >
            {pageClips.length === 0 ? (
              <option value="">No clips on {activePage.name}</option>
            ) : (
              pageClips.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.name} ({clip.tracks.length})
                </option>
              ))
            )}
          </select>

          <button type="button" class="mt-btn" onClick={onCreateClip} title="Create a new empty animation clip">
            + Clip
          </button>

          <div class="mt-presets-anchor">
            <button
              type="button"
              class={`mt-btn ${presetsOpen ? 'active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={presetsOpen}
              onClick={() => setPresetsOpen((open) => !open)}
              title="Create a clip from a built-in motion preset"
            >
              Presets ▾
            </button>
            {presetsOpen && (
              <div class="mt-presets-menu" role="menu" aria-label="Motion presets">
                {MOTION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitem"
                    class="mt-preset-item"
                    onClick={() => {
                      setPresetsOpen(false);
                      onApplyPreset(preset.id);
                    }}
                  >
                    <strong>{preset.name}</strong>
                    <span>{preset.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div class="mt-header-group mt-transport" role="group" aria-label="Playback transport">
          <button
            type="button"
            class={`mt-toggle-btn mt-autokey-btn ${autoKeyEnabled ? 'is-recording' : ''}`}
            aria-pressed={autoKeyEnabled}
            data-testid="motion-autokey-toggle"
            title={
              autoKeyEnabled
                ? 'Auto-Key ON: Scrub the playhead, then move, resize, rotate, or recolor objects directly on Canvas or Inspector to automatically add keyframes.'
                : 'Auto-Key OFF: Enable to automatically record keyframes when editing objects on Canvas or Inspector.'
            }
            onClick={onToggleAutoKey}
          >
            <span class="mt-autokey-dot" aria-hidden="true" />
            <span>Auto-Key</span>
          </button>

          <button
            type="button"
            class={`mt-icon-btn mt-play-btn ${isPlaying ? 'playing' : ''}`}
            disabled={!activeClip}
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            onClick={onTogglePlay}
          >
            <StudioIcon name={isPlaying ? 'pause' : 'play'} />
          </button>
          <button
            type="button"
            class="mt-icon-btn"
            disabled={!activeClip}
            aria-label="Stop and rewind"
            title="Stop & reset canvas pose (Home)"
            onClick={onStop}
          >
            <StudioIcon name="stop" />
          </button>
          <button
            type="button"
            class={`mt-icon-btn ${activeClip?.loop ? 'active' : ''}`}
            disabled={!activeClip}
            aria-pressed={Boolean(activeClip?.loop)}
            aria-label="Toggle loop playback"
            title="Loop playback"
            onClick={handleToggleLoop}
          >
            <StudioIcon name="loop" />
          </button>

          <span class="mt-timecode" data-testid="motion-timecode">
            {formatSeconds(playheadMs)} / {formatSeconds(durationMs)}
          </span>

          {activeClip && (
            <label class="mt-duration-field" title="Clip duration in milliseconds">
              <span>Dur</span>
              <input
                type="number"
                min={100}
                max={60000}
                step={100}
                aria-label="Clip duration (ms)"
                value={activeClip.durationMs}
                onChange={(event) => handleDurationChange(event.currentTarget.value)}
              />
              <span>ms</span>
            </label>
          )}
        </div>

        <div class="mt-header-group mt-header-actions">
          {onKeyframePathMorph && (
            <button
              type="button"
              class="mt-btn mt-morph-btn"
              data-testid="timeline-keyframe-morph-btn"
              disabled={!selectedMorphInfo.supported}
              title={selectedMorphInfo.message}
              onClick={() => {
                pendingMorphAutoSelectRef.current = { nodeIds: selectedNodeIds, timeMs: playheadMs };
                onKeyframePathMorph();
              }}
            >
              + Morph
            </button>
          )}
          {onImportMorphFromComponent && componentMorphOptions.length > 0 && (
            <select
              class="mt-select mt-morph-component-select"
              aria-label="Add Shape Morph from Component"
              data-testid="timeline-morph-from-component-select"
              value=""
              disabled={!selectedMorphInfo.supported}
              title={
                selectedMorphInfo.supported
                  ? 'Import a static shape or animated SVG morph sequence from a saved component into the selected object (same node ID preserved)'
                  : selectedMorphInfo.message
              }
              onChange={(event) => {
                const componentId = event.currentTarget.value;
                event.currentTarget.value = '';
                if (!componentId) return;
                const component = componentById.get(componentId);
                if (!component) return;
                pendingMorphAutoSelectRef.current = { nodeIds: selectedNodeIds, timeMs: playheadMs };
                onImportMorphFromComponent(component);
              }}
            >
              <option value="">From Comp…</option>
              {componentMorphOptions.map(({ component, info }) => (
                <option
                  key={component.id}
                  value={component.id}
                  disabled={!info.supported}
                  title={info.reason}
                >
                  {!info.supported
                    ? `${component.name} (no closed vector)`
                    : info.isAnimated
                      ? `✦ ${component.name} (Anim SVG · ${info.keyframeCount} kf)`
                      : `◇ ${component.name}`}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            class="mt-btn"
            disabled={selectedNodeIds.length === 0}
            title={
              selectedNodeIds.length > 0
                ? 'Keyframe all properties of selected layers at the current playhead (K)'
                : 'Select a layer on the canvas first'
            }
            onClick={onKeyframeSelected}
          >
            + Key
          </button>
          {onOpenMotionExport && (
            <button
              type="button"
              class="mt-btn mt-export-btn"
              data-testid="motion-export-btn"
              onClick={onOpenMotionExport}
              title="Export animation as MP4, MOV (H.264 / Alpha), WebM, GIF, PNG Sequence ZIP, HTML5, CSS, or JSON"
            >
              Export…
            </button>
          )}
          <div class="mt-more-anchor" ref={moreRef}>
            <button
              type="button"
              class={`mt-btn${moreOpen ? ' active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              data-testid="motion-more-btn"
              title="More clip actions (Autoplay, Live Preview, Delete Clip)"
              onClick={() => setMoreOpen((open) => !open)}
            >
              More ▾
            </button>
            {moreOpen && (
              <div class="mt-more-menu" role="menu" aria-label="More motion clip actions">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={Boolean(activeClip?.autoplay)}
                  disabled={!activeClip}
                  class={`studio-opt-popover-item${activeClip?.autoplay ? ' is-active' : ''}`}
                  onClick={() => {
                    handleToggleAutoplay();
                    setMoreOpen(false);
                  }}
                >
                  <span>Autoplay on Page Load</span>
                  {activeClip?.autoplay && <span aria-hidden="true">✓</span>}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="studio-opt-popover-item"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenLivePreview(activePage.id);
                  }}
                >
                  <span>Test in Live Preview</span>
                </button>
                {activeClip && (
                  <>
                    <div class="studio-opt-popover-divider" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      class="studio-opt-popover-item is-danger"
                      onClick={() => {
                        setMoreOpen(false);
                        onDeleteClip();
                      }}
                    >
                      <span>Delete Active Clip</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            class="mt-icon-btn"
            aria-label="Close Motion Timeline"
            title="Close Motion Timeline"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>

      <div class="mt-body">
        <div class="mt-grid-header">
          <div class="mt-add-track-bar">
            <select
              class="mt-select mt-node-select"
              aria-label="Target layer for new track"
              value={newTrackNodeId}
              disabled={!activeClip || nodes.length === 0}
              onChange={(event) => setNewTrackNodeId(event.currentTarget.value)}
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <select
              class="mt-select mt-prop-select"
              aria-label="Animatable property"
              value={newTrackProperty}
              disabled={!activeClip}
              onChange={(event) => setNewTrackProperty(event.currentTarget.value as AnimatableProperty)}
            >
              {ANIMATABLE_PROPERTIES.map((prop) => (
                <option key={prop} value={prop}>
                  {ANIMATABLE_PROPERTY_META[prop].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              class="mt-btn mt-add-track-btn"
              disabled={!activeClip || !newTrackNodeId}
              onClick={handleAddTrack}
              title="Add property animation track"
            >
              + Track
            </button>
          </div>

          <div
            ref={rulerRef}
            class="mt-ruler"
            role="slider"
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={durationMs}
            aria-valuenow={playheadMs}
            tabIndex={0}
            onPointerDown={handleRulerPointerDown}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ x: event.clientX, y: event.clientY, target: { kind: 'stage' } });
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                onSeek(playheadMs + (event.shiftKey ? 100 : 20));
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                onSeek(playheadMs - (event.shiftKey ? 100 : 20));
              } else if (event.key === ' ') {
                event.preventDefault();
                onTogglePlay();
              }
            }}
          >
            <div class="mt-ruler-track">
              {tickMarks.map((tick, idx) => (
                <div key={tick.ms} class={`mt-ruler-tick ${idx === tickMarks.length - 1 ? 'is-end' : ''}`} style={{ left: `${tick.pct}%` }}>
                  <span>{tick.label}</span>
                </div>
              ))}
              <div class="mt-playhead-cap" style={{ left: `${playheadPct}%` }} />
            </div>
          </div>
        </div>

        <div
          ref={lanesContainerRef}
          class="mt-tracks-scroll"
          role="list"
          aria-label="Animation tracks"
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY, target: { kind: 'stage' } });
          }}
        >
          {!activeClip || groupedLayers.length === 0 ? (
            <div class="mt-empty-tracks">
              {autoKeyEnabled
                ? 'Scrub the ruler to any time, then move, resize, or recolor any object on Canvas or Inspector — keyframes record automatically!'
                : activeClip
                  ? 'No tracks yet. Turn on Auto-Key, click + Keyframe All, or pick a layer and property above.'
                  : 'Scrub the ruler and edit an object on Canvas (Auto-Key), or create a clip / preset.'}
            </div>
          ) : (
            <div class="mt-tracks-inner">
              <div class="mt-playhead-overlay" aria-hidden="true">
                <div class="mt-playhead-track">
                  <div
                    class={`mt-playhead-line ${isPlaying || previewActive ? 'active' : ''}`}
                    style={{ left: `${playheadPct}%` }}
                  />
                </div>
              </div>
              {groupedLayers.map((group) => {
                const targetNode = nodeById.get(group.targetNodeId);
                const isExpanded = isLayerGroupExpanded(group.targetNodeId, group.tracks.length);
                const isLayerSelected =
                  activeLayerSelection?.targetNodeId === group.targetNodeId
                  || selectedNodeIds.includes(group.targetNodeId);

                return (
                  <div key={group.targetNodeId} class="mt-layer-group">
                    <div
                      role="listitem"
                      class={`mt-track-grid-row mt-layer-master-row ${isLayerSelected ? 'selected' : ''}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({
                          x: event.clientX,
                          y: event.clientY,
                          target: { kind: 'layer', targetNodeId: group.targetNodeId },
                        });
                      }}
                    >
                      <div class="mt-track-row">
                        <button
                          type="button"
                          class="mt-mini-btn mt-layer-expand-btn"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} property tracks for ${targetNode?.name ?? group.targetNodeId}`}
                          title={isExpanded ? 'Collapse property tracks' : 'Expand individual property tracks'}
                          onClick={() => toggleExpandLayer(group.targetNodeId, group.tracks.length)}
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                        <button
                          type="button"
                          class="mt-track-target"
                          onClick={() => targetNode && onSelectCanvasNode(targetNode.id)}
                          title={targetNode ? `Select "${targetNode.name}" on canvas` : 'Missing layer'}
                        >
                          <span class="mt-track-node-name">{targetNode?.name ?? 'Missing layer'}</span>
                          <span class="mt-layer-prop-count" title="Animated properties in this layer">
                            {group.tracks.length} {group.tracks.length === 1 ? 'prop' : 'props'}
                          </span>
                        </button>
                        <button
                          type="button"
                          class="mt-mini-btn"
                          aria-label={`Insert full keyframe for ${targetNode?.name ?? group.targetNodeId}`}
                          title={`Keyframe all properties at ${formatSeconds(playheadMs)}`}
                          onClick={() => handleQuickKeyframeLayer(group.targetNodeId)}
                        >
                          ◆
                        </button>
                        <button
                          type="button"
                          class="mt-mini-btn mt-danger-btn"
                          aria-label={`Remove all tracks for ${targetNode?.name ?? group.targetNodeId}`}
                          title="Remove all tracks for this layer"
                          onClick={() => handleRemoveLayerTracks(group.targetNodeId)}
                        >
                          ×
                        </button>
                      </div>

                      <div
                        class="mt-lane"
                        onDblClick={(event) => handleMasterLaneDoubleClick(event, group.targetNodeId)}
                        title="Double-click to insert a full object keyframe"
                      >
                        <div class="mt-lane-track">
                          {group.keyframeTimes.length >= 2 &&
                            group.keyframeTimes.slice(0, -1).map((startMs, segIdx) => {
                              const endMs = group.keyframeTimes[segIdx + 1];
                              const segLeft = (startMs / Math.max(1, durationMs)) * 100;
                              const segWidth = ((endMs - startMs) / Math.max(1, durationMs)) * 100;
                              const isSegSelected =
                                graphEditorOpen &&
                                activeLayerSelection?.targetNodeId === group.targetNodeId &&
                                Math.abs(activeLayerSelection.timeMs - endMs) <= 1;
                              return (
                                <button
                                  key={`mseg-${startMs}-${endMs}`}
                                  type="button"
                                  class={`mt-lane-segment mt-lane-segment-master${isSegSelected ? ' is-active' : ''}`}
                                  style={{ left: `${segLeft}%`, width: `${segWidth}%` }}
                                  aria-label={`Edit easing curve for ${targetNode?.name ?? group.targetNodeId} segment ${startMs}ms to ${endMs}ms`}
                                  title={`Click to open Easing Graph Editor (${startMs}ms → ${endMs}ms)`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelection({ kind: 'layer', targetNodeId: group.targetNodeId, timeMs: endMs });
                                    setGraphEditorOpen(true);
                                  }}
                                />
                              );
                            })}
                          {group.keyframeTimes.map((timeMs) => {
                            const leftPct = (timeMs / Math.max(1, durationMs)) * 100;
                            const isSelected =
                              activeLayerSelection?.targetNodeId === group.targetNodeId
                              && Math.abs(activeLayerSelection.timeMs - timeMs) <= 1;
                            return (
                              <button
                                key={timeMs}
                                type="button"
                                class={`mt-keyframe mt-keyframe-master ${isSelected ? 'selected' : ''}`}
                                style={{ left: `${leftPct}%` }}
                                aria-label={`Layer keyframe ${targetNode?.name ?? group.targetNodeId} at ${timeMs}ms (${group.tracks.length} properties)`}
                                title={`${targetNode?.name ?? 'Layer'} · All ${group.tracks.length} properties @ ${timeMs}ms — drag to re-time`}
                                onPointerDown={(event) => handleMasterKeyframePointerDown(event, group.targetNodeId, timeMs)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSelection({ kind: 'layer', targetNodeId: group.targetNodeId, timeMs });
                                  setContextMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    target: { kind: 'master-keyframe', targetNodeId: group.targetNodeId, timeMs },
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {isExpanded && group.tracks.map((track) => {
                      const liveValue = evaluateTrackAtTime(track, playheadMs);
                      const isSelectedTrack = activeTrackSelection?.track.id === track.id;
                      return (
                        <div
                          key={track.id}
                          role="listitem"
                          class={`mt-track-grid-row mt-subtrack-row ${isSelectedTrack ? 'selected' : ''}`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              target: { kind: 'track', track },
                            });
                          }}
                        >
                          <div class="mt-track-row mt-subtrack-label-cell">
                            <button
                              type="button"
                              class="mt-track-target"
                              onClick={() => targetNode && onSelectCanvasNode(targetNode.id)}
                              title={targetNode ? `Select "${targetNode.name}" on canvas` : 'Missing layer'}
                            >
                              <span class="mt-track-prop-code">{ANIMATABLE_PROPERTY_META[track.property].label}</span>
                            </button>
                            <span class="mt-track-value" title="Evaluated value at playhead">
                              {formatTrackValue(track.property, liveValue)}
                            </span>
                            <button
                              type="button"
                              class="mt-mini-btn"
                              aria-label={`Insert keyframe on ${targetNode?.name ?? track.targetNodeId} ${track.property}`}
                              title={`Insert ${track.property} keyframe at ${formatSeconds(playheadMs)}`}
                              onClick={() => handleQuickKeyframeTrack(track)}
                            >
                              ◆
                            </button>
                            <button
                              type="button"
                              class="mt-mini-btn mt-danger-btn"
                              aria-label={`Remove ${track.property} track`}
                              title="Remove property track"
                              onClick={() => handleRemoveTrack(track)}
                            >
                              ×
                            </button>
                          </div>

                          <div
                            class="mt-lane"
                            onDblClick={(event) => handleLaneDoubleClick(event, track)}
                            title="Double-click to insert a keyframe"
                          >
                            <div class="mt-lane-track">
                              {track.keyframes.length >= 2 &&
                                track.keyframes.slice(0, -1).map((startKf, segIdx) => {
                                  const endKf = track.keyframes[segIdx + 1];
                                  const segLeft = (startKf.timeMs / Math.max(1, durationMs)) * 100;
                                  const segWidth = ((endKf.timeMs - startKf.timeMs) / Math.max(1, durationMs)) * 100;
                                  const isSegSelected =
                                    graphEditorOpen &&
                                    activeTrackSelection?.track.id === track.id &&
                                    activeTrackSelection.keyframe.id === endKf.id;
                                  return (
                                    <button
                                      key={`seg-${startKf.id}-${endKf.id}`}
                                      type="button"
                                      class={`mt-lane-segment${isSegSelected ? ' is-active' : ''}`}
                                      style={{ left: `${segLeft}%`, width: `${segWidth}%` }}
                                      aria-label={`Edit ${track.property} easing curve from ${startKf.timeMs}ms to ${endKf.timeMs}ms (${formatEasingLabel(endKf.easing)})`}
                                      title={`${track.property} easing: ${formatEasingLabel(endKf.easing)} — click to open Graph Editor`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setSelection({ kind: 'track', trackId: track.id, keyframeId: endKf.id });
                                        setGraphEditorOpen(true);
                                      }}
                                    />
                                  );
                                })}
                              {track.keyframes.map((kf) => {
                                const leftPct = (kf.timeMs / Math.max(1, durationMs)) * 100;
                                const isSelected = activeTrackSelection?.track.id === track.id
                                  && activeTrackSelection.keyframe.id === kf.id;
                                return (
                                  <button
                                    key={kf.id}
                                    type="button"
                                    class={`mt-keyframe ${isSelected ? 'selected' : ''}`}
                                    style={{ left: `${leftPct}%` }}
                                    aria-label={`Keyframe ${targetNode?.name ?? track.targetNodeId} ${track.property} at ${kf.timeMs}ms (${kf.value})`}
                                    title={`${track.property}: ${kf.value} @ ${kf.timeMs}ms (${formatEasingLabel(kf.easing)}) — drag to re-time`}
                                    onPointerDown={(event) => handleKeyframePointerDown(event, track, kf)}
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setSelection({ kind: 'track', trackId: track.id, keyframeId: kf.id });
                                      setContextMenu({
                                        x: event.clientX,
                                        y: event.clientY,
                                        target: { kind: 'keyframe', track, keyframe: kf },
                                      });
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer class="mt-inspector-strip" aria-label="Selected keyframe inspector">
        {activeTrackSelection ? (
          <>
            <span class="mt-inspector-target">
              <strong>{nodeById.get(activeTrackSelection.track.targetNodeId)?.name ?? 'Layer'}</strong>
              <span>· {ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].label}</span>
            </span>

            <label class="mt-inspector-field">
              <span>Time</span>
              <input
                type="number"
                min={0}
                max={durationMs}
                step={10}
                aria-label="Keyframe time (ms)"
                value={activeTrackSelection.keyframe.timeMs}
                onChange={(event) => {
                  const val = Number.parseInt(event.currentTarget.value, 10);
                  if (Number.isFinite(val)) handleInspectorPatch({ timeMs: val });
                }}
              />
              <span>ms</span>
            </label>

            {ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].kind === 'morph' ? (() => {
              const rawVal = typeof activeTrackSelection.keyframe.value === 'string'
                ? activeTrackSelection.keyframe.value
                : '';
              const snap = rawVal ? parsePathMorphSnapshot(rawVal) : null;
              const targetNode = nodeById.get(activeTrackSelection.track.targetNodeId);
              const targetSupport = checkNodeMorphSupport(targetNode);
              const matchMode = snap?.morph?.matchMode ?? 'auto';
              const isReversed = Boolean(snap?.morph?.reverse);
              const startOffset = snap?.morph?.startOffset ?? 0;

              const applyMorphOptionPatch = (patch: {
                matchMode?: 'auto' | 'index';
                reverse?: boolean;
                startOffset?: number;
              }) => {
                if (!rawVal) return;
                const updated = updateMorphSnapshotOptions(rawVal, patch);
                if (updated) {
                  handleInspectorPatch({ value: updated });
                }
              };

              return (
                <div class="mt-inspector-field mt-morph-inspector-group" data-testid="morph-keyframe-inspector">
                  <span class="mt-morph-summary" data-testid="morph-shape-summary">
                    {snap ? `${snap.label ?? 'Shape'} · ${snap.points.length} pts` : 'Shape Morph'}
                  </span>
                  <select
                    class="mt-select mt-morph-preset-select"
                    aria-label="Morph shape preset or component"
                    data-testid="morph-preset-select"
                    value=""
                    title="Transform this keyframe into a built-in closed shape or import a static/animated SVG from a saved component while keeping the same object ID"
                    onChange={(event) => {
                      const rawChoice = event.currentTarget.value;
                      event.currentTarget.value = '';
                      if (!rawChoice) return;
                      if (rawChoice.startsWith('component:')) {
                        const componentId = rawChoice.slice('component:'.length);
                        const component = componentById.get(componentId);
                        if (component && onImportMorphFromComponent) {
                          onImportMorphFromComponent(component, {
                            targetNodeId: activeTrackSelection.track.targetNodeId,
                            atTimeMs: activeTrackSelection.keyframe.timeMs,
                          });
                        }
                        return;
                      }
                      const preset = rawChoice as MorphShapePresetId;
                      const w = targetNode?.width ?? snap?.w ?? 120;
                      const h = targetNode?.height ?? snap?.h ?? 120;
                      const nextSnap = createMorphPresetSnapshot(preset, w, h, snap?.morph);
                      handleInspectorPatch({ value: nextSnap });
                    }}
                  >
                    <option value="">Morph into…</option>
                    <optgroup label="Built-in Shapes">
                      {MORPH_SHAPE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </optgroup>
                    {onImportMorphFromComponent && componentMorphOptions.length > 0 && (
                      <optgroup label="From Component (Shape / Animated SVG)">
                        {componentMorphOptions.map(({ component, info }) => (
                          <option
                            key={component.id}
                            value={`component:${component.id}`}
                            disabled={!info.supported}
                          >
                            {!info.supported
                              ? `${component.name} (unsupported)`
                              : info.isAnimated
                                ? `✦ ${component.name} (Anim SVG · ${info.keyframeCount} kf)`
                                : `◇ ${component.name}`}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {onEditMorphPoints && targetNode && (
                    <button
                      type="button"
                      class="mt-btn"
                      data-testid="morph-edit-points-btn"
                      title="Edit this keyframe's Bezier anchors and curve handles directly on the canvas (Direct Selection A)"
                      onClick={() => onEditMorphPoints(targetNode.id)}
                    >
                      Edit Points
                    </button>
                  )}
                  {targetNode && targetSupport.supported && (
                    <button
                      type="button"
                      class="mt-btn"
                      title="Recapture the selected layer's current geometry into this keyframe"
                      onClick={() => {
                        const freshValue = extractMorphSnapshotFromNode(targetNode);
                        if (freshValue) {
                          handleInspectorPatch({ value: freshValue });
                        }
                      }}
                    >
                      Recapture
                    </button>
                  )}
                  <button
                    type="button"
                    class={`mt-btn${matchMode === 'index' ? ' active' : ''}`}
                    data-testid="morph-match-mode-btn"
                    title="Toggle between automatic start/winding alignment (Auto) and strict vertex index correspondence (Index)"
                    onClick={() => applyMorphOptionPatch({ matchMode: matchMode === 'auto' ? 'index' : 'auto' })}
                  >
                    {matchMode === 'auto' ? 'Auto Match' : 'Index Match'}
                  </button>
                  <button
                    type="button"
                    class={`mt-btn${isReversed ? ' active' : ''}`}
                    data-testid="morph-reverse-btn"
                    title="Reverse contour traversal direction to fix twisting or fold-overs"
                    onClick={() => applyMorphOptionPatch({ reverse: !isReversed })}
                  >
                    Reverse
                  </button>
                  <span class="mt-morph-shift-controls" title="Shift start-anchor correspondence around the contour">
                    <button
                      type="button"
                      class="mt-btn"
                      data-testid="morph-shift-prev-btn"
                      aria-label="Shift morph start point backward"
                      onClick={() => applyMorphOptionPatch({ startOffset: startOffset - 1 })}
                    >
                      Start −
                    </button>
                    <button
                      type="button"
                      class="mt-btn"
                      data-testid="morph-shift-next-btn"
                      aria-label="Shift morph start point forward"
                      onClick={() => applyMorphOptionPatch({ startOffset: startOffset + 1 })}
                    >
                      Start +{startOffset !== 0 ? ` (${startOffset > 0 ? `+${startOffset}` : startOffset})` : ''}
                    </button>
                  </span>
                </div>
              );
            })() : ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].kind === 'color' ? (
              <label class="mt-inspector-field">
                <span>{ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].label}</span>
                <input
                  type="color"
                  aria-label="Keyframe color"
                  value={typeof activeTrackSelection.keyframe.value === 'string' && /^#[0-9a-fA-F]{6}$/.test(activeTrackSelection.keyframe.value)
                    ? activeTrackSelection.keyframe.value
                    : '#7c6ff7'}
                  onInput={(event) => handleInspectorPatch({ value: event.currentTarget.value })}
                />
                <input
                  type="text"
                  class="mt-hex-input"
                  aria-label="Keyframe hex color"
                  value={String(activeTrackSelection.keyframe.value)}
                  onChange={(event) => handleInspectorPatch({ value: event.currentTarget.value.trim() })}
                />
              </label>
            ) : (
              <label class="mt-inspector-field">
                <span>Value</span>
                <input
                  type="number"
                  step={ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].step}
                  min={ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].min}
                  max={ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].max}
                  aria-label="Keyframe value"
                  value={Number(activeTrackSelection.keyframe.value)}
                  onChange={(event) => {
                    const val = Number.parseFloat(event.currentTarget.value);
                    if (Number.isFinite(val)) handleInspectorPatch({ value: val });
                  }}
                />
                {ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].unit && (
                  <span>{ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].unit}</span>
                )}
              </label>
            )}

            <div class="mt-inspector-field">
              <span>Easing</span>
              <button
                type="button"
                class={`mt-easing-curve-btn${graphEditorOpen ? ' is-active' : ''}`}
                aria-label="Keyframe easing curve"
                title="Open Easing Graph Editor (Bezier & Multi-Point)"
                aria-expanded={graphEditorOpen}
                data-testid="motion-easing-curve-btn"
                onClick={() => setGraphEditorOpen((open) => !open)}
              >
                <EasingCurveMiniSvg easing={activeTrackSelection.keyframe.easing} width={28} height={18} />
                <span>{formatEasingLabel(activeTrackSelection.keyframe.easing)}</span>
              </button>
            </div>

            <button
              type="button"
              class="mt-btn mt-danger-btn mt-inspector-delete"
              onClick={handleDeleteSelectedKeyframe}
            >
              Delete Keyframe
            </button>
          </>
        ) : activeLayerSelection && activeClip ? (
          <>
            <span class="mt-inspector-target">
              <strong>{nodeById.get(activeLayerSelection.targetNodeId)?.name ?? 'Layer'}</strong>
              <span>· Full Pose ({activeLayerSelection.trackCount} props)</span>
            </span>

            <label class="mt-inspector-field">
              <span>Time</span>
              <input
                type="number"
                min={0}
                max={durationMs}
                step={10}
                aria-label="Layer keyframe time (ms)"
                value={activeLayerSelection.timeMs}
                onChange={(event) => {
                  const val = Number.parseInt(event.currentTarget.value, 10);
                  if (!Number.isFinite(val)) return;
                  const nextClip = moveLayerKeyframesInClip(
                    activeClip,
                    activeLayerSelection.targetNodeId,
                    activeLayerSelection.timeMs,
                    val,
                  );
                  onUpdateClip(nextClip, 'Re-time layer keyframe pose');
                  setSelection({ kind: 'layer', targetNodeId: activeLayerSelection.targetNodeId, timeMs: val });
                  onSeek(val);
                }}
              />
              <span>ms</span>
            </label>

            <div class="mt-inspector-field">
              <span>Easing</span>
              <button
                type="button"
                class={`mt-easing-curve-btn${graphEditorOpen ? ' is-active' : ''}`}
                aria-label="Keyframe easing curve"
                title="Open Easing Graph Editor (Bezier & Multi-Point)"
                aria-expanded={graphEditorOpen}
                data-testid="motion-easing-curve-btn"
                onClick={() => setGraphEditorOpen((open) => !open)}
              >
                <EasingCurveMiniSvg easing={activeLayerSelection.easing} width={28} height={18} />
                <span>{formatEasingLabel(activeLayerSelection.easing)}</span>
              </button>
            </div>

            <button
              type="button"
              class="mt-btn mt-danger-btn mt-inspector-delete"
              onClick={handleDeleteSelectedKeyframe}
            >
              Delete Pose
            </button>
          </>
        ) : (
          <span class="mt-inspector-hint">
            {autoKeyEnabled
              ? 'Auto-Key ON · Scrub the ruler, edit any object or Modern Effect, or click a segment bar between keyframes to shape its Easing Curve.'
              : 'Scrub the ruler to preview · Click ◆ or any segment bar between keyframes to open the Easing Graph Editor'}
          </span>
        )}
      </footer>

      {graphEditorOpen && (activeTrackSelection || activeLayerSelection) && (
        <MotionGraphEditor
          value={
            activeTrackSelection
              ? activeTrackSelection.keyframe.easing
              : (activeLayerSelection?.easing ?? 'ease-out')
          }
          title={
            activeTrackSelection
              ? `${nodeById.get(activeTrackSelection.track.targetNodeId)?.name ?? 'Layer'} · ${ANIMATABLE_PROPERTY_META[activeTrackSelection.track.property].label}`
              : `${nodeById.get(activeLayerSelection?.targetNodeId ?? '')?.name ?? 'Layer'} · Pose @ ${activeLayerSelection?.timeMs ?? 0}ms`
          }
          customEasings={customEasings}
          onChange={handleGraphEasingChange}
          onUpdateCustomEasings={(next, desc) => onUpdateCustomEasings?.(next, desc)}
          onClose={() => setGraphEditorOpen(false)}
        />
      )}

      <StudioContextMenu
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        ariaLabel="Motion timeline actions"
        entries={buildMotionContextEntries()}
        testId="motion-context-menu"
        onClose={() => setContextMenu(null)}
      />
    </section>
  );
}
