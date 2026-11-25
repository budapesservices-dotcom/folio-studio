import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { JSX } from 'preact';
import type {
  AssetReference,
  BreakpointId,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  PathNode,
  TextNode,
} from '../../core/document/types';
import { buildFrameClipAncestorMap, buildLayerClipMaskMap, getEffectiveLayerStates, getLayerRenderOrder } from '../../core/document/layers';
import { computeAutoLayoutNodes, getBreakpointCanvasWidth } from '../layout/autoLayout';
import {
  decomposeNodesForShapeBuilder,
  findNearestSegmentHit,
  hitTestPlanarFace,
  nodeLocalPointToWorld,
  worldPointToNodeLocal,
} from '../../core/document/vector';
import {
  createToolOperation,
  extractToolOperationsFromTransition,
  type ToolOperation,
} from '../../core/tools/operationContract';
import { sanitizeMaskIdSegment } from './artwork';
import {
  buildCanvasPointerInput,
  buildSpatialIndexForNodes,
  computeVisibleArtboardRect,
  cullVisibleRenderNodes,
  toCanvasPoint,
} from './canvasHelpers';
import { hitTestNodesAtPoint } from './hitTest';
import { CanvasInteractiveOverlays } from './CanvasOverlays';
import { CanvasSceneLayer } from './CanvasSceneLayer';
import {
  GPU_HYBRID_AUTO_THRESHOLD,
  type GpuSceneMetrics,
  type ViewportRendererMode,
} from './gpu/types';

const LazyGpuViewportLayer = lazy(() =>
  import('./gpu/GpuViewportLayer').then((m) => ({ default: m.GpuViewportLayer })),
);
import { computeSpacingRedlines, getBounds, type Bounds, type SnapGuide } from './geometry';
import {
  evaluateToolOperation,
  evaluateToolOperationBatch,
  type ValidatedToolOperation,
} from './geometryEngine';
import { getStudioTool } from './tools/studioRegistry';
import { extractSampledColor } from './tools/utility-tools';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolId,
  type CanvasToolOptions,
  type CanvasToolPointerInput,
  type CanvasToolSession,
  type CanvasToolTransition,
  type ToolWorkspaceScope,
} from './tools/types';
import './canvas.css';

import type { DrawMaskMode } from '../../core/document/types';
import type { SelectSimilarCriterion } from '../../core/document/selectionQueries';

export interface CanvasContextMenuActions {
  readonly onDeselect: () => void;
  readonly onInvertSelection: () => void;
  readonly onSelectSimilar: (criterion: SelectSimilarCriterion) => void;
  readonly onSetDrawMode: (mode: DrawMaskMode) => void;
  readonly onPermanentSubtractOutside: () => void;
}

interface CanvasProps {
  document: FolioDocument;
  components?: ComponentDefinition[];
  assets?: readonly AssetReference[];
  designTokens?: DesignTokenCollection;
  activeBreakpoint?: BreakpointId;
  selectedNodeIds: string[];
  toolId: CanvasToolId;
  workspace?: ToolWorkspaceScope;
  toolOptions?: CanvasToolOptions;
  zoom: number;
  pan: { x: number; y: number };
  onToolOperation?: (operation: ValidatedToolOperation) => void;
  onToolOperationBatch?: (
    operations: readonly ValidatedToolOperation[],
  ) => ReadonlyArray<{ readonly operationId: string; readonly status: 'applied' | 'no-op' | 'rejected' }> | void;
  onPanChange?: (pan: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
  onSelectionChange?: (nodeIds: string[]) => void;
  onTransformCommit?: (nodes: DesignNode[]) => void;
  onLayerDrop: (nodeIds: string[]) => void;
  onDropImageFiles?: (files: readonly File[], canvasPoint: { x: number; y: number }) => void;
  onCreateNodes?: (nodes: DesignNode[]) => void;
  onReplaceNodeWithNodes?: (nodeId: string, nodes: DesignNode[]) => void;
  onReplaceNodes?: (removeIds: string[], insertNodes: DesignNode[]) => void;
  onSampledColor?: (color: string, sourceName: string, target?: 'fill' | 'stroke') => void;
  onToolChange?: (toolId: CanvasToolId) => void;
  onToolNotice?: (message: string) => void;
  onInlineTextCommit?: (nodeId: string, text: string) => void;
  rendererMode?: ViewportRendererMode;
  onGpuMetrics?: (metrics: GpuSceneMetrics | null) => void;
  contextMenuActions?: CanvasContextMenuActions;
}

interface PanSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPan: { x: number; y: number };
}

interface InlineTextEditState {
  nodeId: string;
  draft: string;
}

const VECTOR_OVERLAY_TOOLS = new Set<CanvasToolId>([
  'direct-selection',
  'anchor-point',
  'pen',
  'curvature',
  'scissors',
  'smooth',
]);

export function Canvas({
  document,
  components = [],
  assets = [],
  designTokens,
  activeBreakpoint = 'desktop',
  selectedNodeIds,
  toolId,
  workspace = 'main',
  toolOptions = DEFAULT_CANVAS_TOOL_OPTIONS,
  zoom,
  pan,
  onToolOperation,
  onToolOperationBatch,
  onPanChange,
  onZoomChange,
  onSelectionChange,
  onTransformCommit,
  onLayerDrop,
  onDropImageFiles,
  onCreateNodes,
  onReplaceNodeWithNodes,
  onReplaceNodes,
  onSampledColor,
  onToolChange,
  onToolNotice,
  onInlineTextCommit,
  rendererMode = 'auto',
  onGpuMetrics,
  contextMenuActions,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const inlineTextInputRef = useRef<HTMLTextAreaElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<DesignNode[] | null>(null);
  const [previewNodes, setPreviewNodes] = useState<DesignNode[] | null>(null);
  const [previewCreateNodes, setPreviewCreateNodes] = useState<DesignNode[] | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [isImageFileDragOver, setIsImageFileDragOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const panRef = useRef<PanSession | null>(null);
  const toolSessionRef = useRef<CanvasToolSession | null>(null);
  const [toolSession, setToolSession] = useState<CanvasToolSession | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [inlineTextEdit, setInlineTextEdit] = useState<InlineTextEditState | null>(null);
  const [customPivot, setCustomPivot] = useState<{ x: number; y: number } | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<{ nodeId: string; pointIndex: number } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const lastPointerRef = useRef<{ point: { x: number; y: number } | null; nodeId: string | null }>({
    point: null,
    nodeId: null,
  });
  const lastActivePointerInputRef = useRef<CanvasToolPointerInput | null>(null);
  const capturedPointerRef = useRef<{ svg: SVGSVGElement; pointerId: number } | null>(null);
  const pendingInlineEditRef = useRef<InlineTextEditState | null>(null);
  const prevDocumentIdRef = useRef<string>(document.id);
  const [renderedSvgWidth, setRenderedSvgWidth] = useState<number>(0);

  // High-frequency pointer/pan/wheel RAF coalescing refs (120Hz–240Hz input protection)
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const wheelPanRafRef = useRef<number | null>(null);
  const pendingWheelDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const pointerMoveRafRef = useRef<number | null>(null);
  const pendingPointerMoveRef = useRef<{
    input: CanvasToolPointerInput;
    svg: SVGSVGElement;
    pointerId: number;
  } | null>(null);
  const latestPanRef = useRef(pan);
  latestPanRef.current = pan;
  const emitViewportUpdateRef = useRef<(update: { pan?: { x: number; y: number }; zoom?: number }) => void>(() => {});
  const processPointerMoveRef = useRef<(
    input: CanvasToolPointerInput,
    svg: SVGSVGElement,
    pointerId: number,
  ) => void>(() => {});

  const cancelPendingMotionFrames = () => {
    if (typeof cancelAnimationFrame === 'function') {
      if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
      if (wheelPanRafRef.current !== null) cancelAnimationFrame(wheelPanRafRef.current);
      if (pointerMoveRafRef.current !== null) cancelAnimationFrame(pointerMoveRafRef.current);
    }
    panRafRef.current = null;
    pendingPanRef.current = null;
    wheelPanRafRef.current = null;
    pendingWheelDeltaRef.current = { dx: 0, dy: 0 };
    pointerMoveRafRef.current = null;
    pendingPointerMoveRef.current = null;
  };

  useEffect(() => () => cancelPendingMotionFrames(), []);

  const releaseCapturedPointer = () => {
    const captured = capturedPointerRef.current;
    capturedPointerRef.current = null;
    if (!captured) return;
    try {
      if (captured.svg.hasPointerCapture?.(captured.pointerId)) {
        captured.svg.releasePointerCapture(captured.pointerId);
      }
    } catch {
      // Ignore if pointer already ended or element detached.
    }
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let rafId: number | null = null;
    let disposed = false;

    const commitWidth = () => {
      if (disposed) return;
      const measured = svg.getBoundingClientRect().width;
      if (!Number.isFinite(measured) || measured <= 0) return;
      const rounded = Math.round(measured * 2) / 2;
      setRenderedSvgWidth((prev) => (Math.abs(prev - rounded) >= 0.5 ? rounded : prev));
    };

    const scheduleWidthUpdate = () => {
      if (disposed) return;
      if (typeof requestAnimationFrame !== 'function') {
        commitWidth();
        return;
      }
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        commitWidth();
      });
    };

    commitWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        scheduleWidthUpdate();
      });
      observer.observe(svg);
      return () => {
        disposed = true;
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        observer.disconnect();
      };
    }

    window.addEventListener('resize', scheduleWidthUpdate);
    return () => {
      disposed = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      window.removeEventListener('resize', scheduleWidthUpdate);
    };
  }, [document.width, zoom]);

  const rawCanvasUnitsPerPixel = renderedSvgWidth > 10
    ? document.width / renderedSvgWidth
    : 1 / Math.max(0.05, zoom);
  const canvasUnitsPerPixel = Math.min(20, Math.max(0.05, rawCanvasUnitsPerPixel));
  const invZoom = canvasUnitsPerPixel;
  const selectionKey = selectedNodeIds.join(',');

  const updateToolSession = (next: CanvasToolSession | null) => {
    toolSessionRef.current = next;
    if (!next) {
      lastActivePointerInputRef.current = null;
      releaseCapturedPointer();
    }
    setToolSession(next);
  };

  useEffect(() => {
    const docChanged = prevDocumentIdRef.current !== document.id;
    prevDocumentIdRef.current = document.id;
    releaseCapturedPointer();
    lastActivePointerInputRef.current = null;
    panRef.current = null;
    setIsPanning(false);
    updateToolSession(null);
    previewRef.current = null;
    setPreviewNodes(null);
    setPreviewCreateNodes(null);
    setGuides([]);
    setActiveAnchor(null);
    setHoverPoint(null);
    setHoverNodeId(null);
    if (docChanged) {
      pendingInlineEditRef.current = null;
      setInlineTextEdit(null);
    } else if (pendingInlineEditRef.current) {
      pendingInlineEditRef.current = null;
    } else {
      setInlineTextEdit(null);
    }
  }, [toolId, document.id]);

  useEffect(() => {
    setCustomPivot(null);
    setActiveAnchor(null);
  }, [selectionKey, document.id]);

  const syncActiveSessionModifiersRef = useRef<(event: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || target.matches('input, textarea, select, button, a, [role="button"]');
    };

    const isModifierKey = (key: string): boolean =>
      key === 'Shift' || key === 'Alt' || key === 'Control' || key === 'Meta';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(true);
      if (event.key === 'Shift') setShiftHeld(true);
      if (event.code === 'Space' && !toolSessionRef.current && !isInteractiveTarget(event.target)) {
        setSpaceHeld(true);
        event.preventDefault();
      }
      if (isModifierKey(event.key) && toolSessionRef.current) {
        syncActiveSessionModifiersRef.current(event);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(false);
      if (event.key === 'Shift') setShiftHeld(false);
      if (event.code === 'Space') setSpaceHeld(false);
      if (isModifierKey(event.key) && toolSessionRef.current) {
        syncActiveSessionModifiersRef.current(event);
      }
    };
    const handleWindowBlur = () => {
      setSpaceHeld(false);
      setAltHeld(false);
      setShiftHeld(false);
      panRef.current = null;
      lastActivePointerInputRef.current = null;
      releaseCapturedPointer();
      updateToolSession(null);
      previewRef.current = null;
      setPreviewNodes(null);
      setPreviewCreateNodes(null);
      setGuides([]);
      setIsPanning(false);
    };

    window.addEventListener('keydown', handleKeyDown, { signal });
    window.addEventListener('keyup', handleKeyUp, { signal });
    window.addEventListener('blur', handleWindowBlur, { signal });
    return () => controller.abort();
  }, []);

  const updatePreview = (nodes: DesignNode[] | null) => {
    previewRef.current = nodes;
    setPreviewNodes(nodes);
  };

  const effectiveDocWidth = useMemo(
    () => (workspace === 'main' ? getBreakpointCanvasWidth(document.width, activeBreakpoint) : document.width),
    [workspace, document.width, activeBreakpoint],
  );

  const resolvedLayoutNodes = useMemo(
    () => computeAutoLayoutNodes(document.nodes, {
      breakpoint: activeBreakpoint,
      tokens: designTokens,
      canvasWidth: effectiveDocWidth,
    }),
    [document.nodes, activeBreakpoint, designTokens, effectiveDocWidth],
  );

  // Static scene structures depend ONLY on committed layout nodes (not active drag preview),
  // so 1,500+ idle nodes keep stable references and skip reconciliation during drags.
  const staticCanvasNodes = useMemo(
    () => resolvedLayoutNodes.filter((node) => node.onCanvas !== false),
    [resolvedLayoutNodes],
  );

  const staticSceneData = useMemo(() => {
    const byId = new Map(staticCanvasNodes.map((node) => [node.id, node]));
    const states = getEffectiveLayerStates(staticCanvasNodes);
    const masks = buildLayerClipMaskMap(staticCanvasNodes, byId);
    const frameClips = buildFrameClipAncestorMap(staticCanvasNodes, byId);
    const clipMaskBaseIds = new Set<string>();
    for (const baseIds of masks.values()) {
      for (const baseId of baseIds) clipMaskBaseIds.add(baseId);
    }
    const renderNodes = getLayerRenderOrder(staticCanvasNodes).filter((node) => {
      const state = states.get(node.id);
      if (!state?.visible) return false;
      const baseIds = masks.get(node.id) ?? [];
      return baseIds.every((baseId) => states.get(baseId)?.visible);
    });
    const selectable = staticCanvasNodes.filter((node) => {
      const effective = states.get(node.id);
      return effective?.visible && !effective.locked;
    });
    return {
      nodeById: byId,
      layerStates: states,
      clipMaskMap: masks,
      frameClipMap: frameClips,
      clipMaskBaseIds,
      visibleRenderNodes: renderNodes,
      selectableNodes: selectable,
      spatialIndex: buildSpatialIndexForNodes(renderNodes),
    };
  }, [staticCanvasNodes]);

  // Isolate dragged preview nodes onto the active overlay whenever they are not
  // acting as clip-mask bases or clipping frames for non-dragged children.
  const canIsolatePreviewNodes = useMemo(() => {
    if (!previewNodes || previewNodes.length === 0) return false;
    const previewIds = new Set(previewNodes.map((node) => node.id));
    for (const node of previewNodes) {
      if (staticSceneData.clipMaskBaseIds.has(node.id)) return false;
      if (node.type === 'frame' && node.clipContent) return false;
    }
    for (const node of staticCanvasNodes) {
      if (!previewIds.has(node.id) && node.parentId && previewIds.has(node.parentId)) {
        return false;
      }
    }
    return true;
  }, [previewNodes, staticSceneData.clipMaskBaseIds, staticCanvasNodes]);

  // Key-stabilized Set so CanvasSceneLayer receives the exact same Set reference on frames 2..N of a drag.
  const isolatedPreviewKey = canIsolatePreviewNodes && previewNodes
    ? previewNodes.map((node) => node.id).join(',')
    : '';
  const isolatedPreviewIdSet = useMemo<ReadonlySet<string> | null>(
    () => (isolatedPreviewKey ? new Set(isolatedPreviewKey.split(',')) : null),
    [isolatedPreviewKey],
  );
  const isolatedPreviewNodes = canIsolatePreviewNodes ? previewNodes : null;

  const displayedNodes = useMemo(() => {
    if (!previewNodes || previewNodes.length === 0) return resolvedLayoutNodes;
    const previewById = new Map(previewNodes.map((node) => [node.id, node]));
    return resolvedLayoutNodes.map((node) => previewById.get(node.id) ?? node);
  }, [resolvedLayoutNodes, previewNodes]);

  const canvasNodes = useMemo(
    () => (previewNodes && previewNodes.length > 0 ? displayedNodes.filter((node) => node.onCanvas !== false) : staticCanvasNodes),
    [displayedNodes, previewNodes, staticCanvasNodes],
  );

  // When drag preview is isolated, reuse static scene maps and spatial index directly
  // instead of rebuilding the entire scene graph at 60–120Hz, while keeping nodeById
  // synchronized with live preview coordinates for selection bounds and handles.
  const {
    nodeById,
    layerStates,
    clipMaskMap,
    frameClipMap,
    visibleRenderNodes,
    selectableNodes,
    spatialIndex,
  } = useMemo(() => {
    if (!previewNodes || previewNodes.length === 0) {
      return {
        nodeById: staticSceneData.nodeById,
        layerStates: staticSceneData.layerStates,
        clipMaskMap: staticSceneData.clipMaskMap,
        frameClipMap: staticSceneData.frameClipMap,
        visibleRenderNodes: staticSceneData.visibleRenderNodes,
        selectableNodes: staticSceneData.selectableNodes,
        spatialIndex: staticSceneData.spatialIndex,
      };
    }
    if (canIsolatePreviewNodes) {
      const byId = new Map(staticSceneData.nodeById);
      for (let i = 0; i < previewNodes.length; i += 1) {
        const preview = previewNodes[i];
        if (preview.onCanvas !== false) {
          byId.set(preview.id, preview);
        }
      }
      return {
        nodeById: byId,
        layerStates: staticSceneData.layerStates,
        clipMaskMap: staticSceneData.clipMaskMap,
        frameClipMap: staticSceneData.frameClipMap,
        visibleRenderNodes: staticSceneData.visibleRenderNodes,
        selectableNodes: staticSceneData.selectableNodes,
        spatialIndex: staticSceneData.spatialIndex,
      };
    }
    const byId = new Map(canvasNodes.map((node) => [node.id, node]));
    const states = getEffectiveLayerStates(canvasNodes);
    const masks = buildLayerClipMaskMap(canvasNodes, byId);
    const frameClips = buildFrameClipAncestorMap(canvasNodes, byId);
    const renderNodes = getLayerRenderOrder(canvasNodes).filter((node) => {
      const state = states.get(node.id);
      if (!state?.visible) return false;
      const baseIds = masks.get(node.id) ?? [];
      return baseIds.every((baseId) => states.get(baseId)?.visible);
    });
    const selectable = canvasNodes.filter((node) => {
      const effective = states.get(node.id);
      return effective?.visible && !effective.locked;
    });
    return {
      nodeById: byId,
      layerStates: states,
      clipMaskMap: masks,
      frameClipMap: frameClips,
      visibleRenderNodes: renderNodes,
      selectableNodes: selectable,
      spatialIndex: buildSpatialIndexForNodes(renderNodes),
    };
  }, [canIsolatePreviewNodes, canvasNodes, previewNodes, staticSceneData]);

  const sceneCanvasNodes = canIsolatePreviewNodes ? staticCanvasNodes : canvasNodes;
  const sceneNodeById = canIsolatePreviewNodes ? staticSceneData.nodeById : nodeById;
  const sceneClipMaskMap = canIsolatePreviewNodes ? staticSceneData.clipMaskMap : clipMaskMap;
  const sceneFrameClipMap = canIsolatePreviewNodes ? staticSceneData.frameClipMap : frameClipMap;
  const sceneVisibleRenderNodes = canIsolatePreviewNodes ? staticSceneData.visibleRenderNodes : visibleRenderNodes;
  const sceneSpatialIndex = canIsolatePreviewNodes ? staticSceneData.spatialIndex : spatialIndex;

  const visibleArtboardRect = useMemo(
    () =>
      computeVisibleArtboardRect(
        scrollAreaRef.current,
        svgRef.current,
        effectiveDocWidth,
        document.height,
      ),
    [effectiveDocWidth, document.height, zoom, pan.x, pan.y, renderedSvgWidth],
  );

  const culledRenderNodes = useMemo(
    () =>
      cullVisibleRenderNodes(
        sceneVisibleRenderNodes,
        sceneSpatialIndex,
        visibleArtboardRect,
        selectedNodeIds,
        sceneNodeById,
      ),
    [
      sceneVisibleRenderNodes,
      sceneSpatialIndex,
      visibleArtboardRect,
      selectedNodeIds,
      sceneNodeById,
    ],
  );

  const gpuHybridActive =
    rendererMode === 'gpu-hybrid' ||
    (rendererMode === 'auto' && sceneCanvasNodes.length >= GPU_HYBRID_AUTO_THRESHOLD);

  useEffect(() => {
    if (!gpuHybridActive) {
      onGpuMetrics?.(null);
    }
  }, [gpuHybridActive, onGpuMetrics]);

  const gpuViewportRect = useMemo(
    () =>
      visibleArtboardRect
        ? {
            x: visibleArtboardRect.minX,
            y: visibleArtboardRect.minY,
            width: Math.max(1, visibleArtboardRect.maxX - visibleArtboardRect.minX),
            height: Math.max(1, visibleArtboardRect.maxY - visibleArtboardRect.minY),
          }
        : null,
    [visibleArtboardRect],
  );

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

  const maskPrefix = useMemo(
    () => `folio-mask-${sanitizeMaskIdSegment(document.id)}`,
    [document.id],
  );

  const { selectedNodes, selectionBounds } = useMemo(() => {
    const selectedSet = new Set(selectedNodeIds);
    const activeSelection = canvasNodes.filter((node) => {
      if (!selectedSet.has(node.id)) return false;
      const effective = layerStates.get(node.id);
      return effective?.visible && !effective.locked;
    });
    return {
      selectedNodes: activeSelection,
      selectionBounds: getBounds(activeSelection),
    };
  }, [canvasNodes, layerStates, selectedNodeIds]);

  const selectedPathNodes = useMemo(
    () => selectedNodes.filter((node): node is PathNode => node.type === 'path'),
    [selectedNodes],
  );

  const shapeBuilderHoverArrangement = useMemo(() => {
    if (toolId !== 'shape-builder') return null;
    const { candidates, arrangement } = decomposeNodesForShapeBuilder(selectedNodes);
    return candidates.length >= 2 && arrangement.faces.length > 0 ? arrangement : null;
  }, [toolId, selectedNodes]);

  const inlineEditNode = useMemo(() => {
    if (!inlineTextEdit) return null;
    const node = nodeById.get(inlineTextEdit.nodeId);
    return node?.type === 'text' ? (node as TextNode) : null;
  }, [inlineTextEdit, nodeById]);

  useEffect(() => {
    if (inlineEditNode && inlineTextInputRef.current) {
      inlineTextInputRef.current.focus();
      inlineTextInputRef.current.select();
    }
  }, [inlineEditNode?.id]);

  const needsHoverTracking =
    toolId === 'eyedropper' ||
    toolId === 'anchor-point' ||
    toolId === 'scissors' ||
    toolId === 'smooth' ||
    (toolId === 'shape-builder' && Boolean(shapeBuilderHoverArrangement)) ||
    (altHeld && Boolean(selectionBounds) && (toolId === 'select' || toolId === 'direct-selection'));

  useEffect(() => {
    if (needsHoverTracking) {
      setHoverPoint(lastPointerRef.current.point);
      setHoverNodeId(lastPointerRef.current.nodeId);
    } else {
      setHoverPoint((prev) => (prev === null ? prev : null));
      setHoverNodeId((prev) => (prev === null ? prev : null));
    }
  }, [needsHoverTracking]);

  const canResize = selectedNodes.length > 0;
  const activeTool = getStudioTool(toolId);

  const createToolContext = (): CanvasToolContext => ({
    document,
    canvasNodes,
    selectableNodes,
    otherNodes: selectableNodes,
    selectedNodeIds,
    selectedNodes,
    selectionBounds,
    zoom,
    canvasUnitsPerPixel,
    pan,
    viewportWidth: scrollAreaRef.current?.clientWidth ?? document.width,
    session: toolSessionRef.current,
    toolOptions,
    workspace,
    customPivot,
    activeAnchor,
  });

  const capturePointer = (svg: SVGSVGElement, pointerId: number) => {
    try {
      svg.setPointerCapture(pointerId);
      capturedPointerRef.current = { svg, pointerId };
    } catch {
      // Pointer capture can fail when the browser cancels the initiating pointer.
    }
  };

  const canEditInlineText = Boolean(onToolOperationBatch || onToolOperation || onInlineTextCommit);

  const dispatchValidatedOperation = (validated: ValidatedToolOperation) => {
    if (onToolOperation) {
      onToolOperation(validated);
      return;
    }
    const payload = validated.payload;
    switch (payload.kind) {
      case 'create-nodes':
        onCreateNodes?.([...payload.nodes]);
        return;
      case 'transform-nodes':
        onTransformCommit?.([...payload.nodes]);
        return;
      case 'replace-node-with-nodes':
        onReplaceNodeWithNodes?.(payload.nodeId, [...payload.nodes]);
        return;
      case 'replace-nodes':
        onReplaceNodes?.([...payload.removeIds], [...payload.insertNodes]);
        return;
      case 'sample-color':
        onSampledColor?.(payload.color, payload.sourceName, payload.target);
        return;
      case 'commit-inline-text':
        onInlineTextCommit?.(payload.nodeId, payload.text);
        return;
      case 'select-nodes':
        onSelectionChange?.([...payload.nodeIds]);
        return;
      case 'viewport-update':
        if (payload.pan !== undefined) onPanChange?.({ x: payload.pan.x, y: payload.pan.y });
        if (payload.zoom !== undefined) onZoomChange?.(payload.zoom);
        return;
      case 'switch-tool':
        onToolChange?.(payload.nextToolId);
        return;
      case 'notify':
        onToolNotice?.(payload.message);
        return;
    }
  };

  const dispatchValidatedOperationBatch = (validatedOps: readonly ValidatedToolOperation[]): boolean => {
    if (validatedOps.length === 0) return false;
    if (onToolOperationBatch) {
      const reports = onToolOperationBatch(validatedOps);
      if (Array.isArray(reports) && reports.some((report) => report.status === 'rejected')) {
        return false;
      }
      return true;
    }
    for (const validatedOp of validatedOps) {
      dispatchValidatedOperation(validatedOp);
    }
    return true;
  };

  const evaluateAndDispatchOperation = (operation: ToolOperation) => {
    const result = evaluateToolOperation(operation, {
      document,
      selectedNodeIds,
      effectiveLayerStates: layerStates,
    });
    if (result.status === 'ready') {
      dispatchValidatedOperation(result.operation);
    }
  };

  const emitViewportUpdate = (update: { pan?: { x: number; y: number }; zoom?: number }) => {
    evaluateAndDispatchOperation(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'viewport-update',
          ...(update.pan !== undefined ? { pan: update.pan } : {}),
          ...(update.zoom !== undefined ? { zoom: update.zoom } : {}),
        },
        { atomicHistoryStep: false },
      ),
    );
  };
  emitViewportUpdateRef.current = emitViewportUpdate;

  const flushPendingPan = () => {
    if (panRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    const nextPan = pendingPanRef.current;
    pendingPanRef.current = null;
    if (nextPan) {
      emitViewportUpdateRef.current({ pan: nextPan });
    }
  };

  const schedulePanUpdate = (nextPan: { x: number; y: number }) => {
    if (typeof requestAnimationFrame !== 'function') {
      emitViewportUpdate({ pan: nextPan });
      return;
    }
    pendingPanRef.current = nextPan;
    if (panRafRef.current !== null) return;
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null;
      const queued = pendingPanRef.current;
      pendingPanRef.current = null;
      if (queued) emitViewportUpdateRef.current({ pan: queued });
    });
  };

  const scheduleWheelPanDelta = (dx: number, dy: number) => {
    if (typeof requestAnimationFrame !== 'function') {
      emitViewportUpdate({ pan: { x: latestPanRef.current.x - dx, y: latestPanRef.current.y - dy } });
      return;
    }
    pendingWheelDeltaRef.current.dx += dx;
    pendingWheelDeltaRef.current.dy += dy;
    if (wheelPanRafRef.current !== null) return;
    wheelPanRafRef.current = requestAnimationFrame(() => {
      wheelPanRafRef.current = null;
      const { dx: accumX, dy: accumY } = pendingWheelDeltaRef.current;
      pendingWheelDeltaRef.current = { dx: 0, dy: 0 };
      if (accumX !== 0 || accumY !== 0) {
        emitViewportUpdateRef.current({
          pan: {
            x: latestPanRef.current.x - accumX,
            y: latestPanRef.current.y - accumY,
          },
        });
      }
    });
  };

  const commitInlineText = () => {
    if (!inlineTextEdit) return;
    const trimmed = inlineTextEdit.draft;
    const nodeId = inlineTextEdit.nodeId;
    setInlineTextEdit(null);
    evaluateAndDispatchOperation(
      createToolOperation(
        toolId,
        workspace,
        {
          kind: 'commit-inline-text',
          nodeId,
          text: trimmed.length > 0 ? trimmed : 'Text',
        },
        { description: 'Edit text on canvas' },
      ),
    );
  };

  const handleWheel = (event: JSX.TargetedWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
    const deltaX = event.deltaX * unit * 0.55;
    const deltaY = event.deltaY * unit * 0.55;

    if (event.ctrlKey || event.metaKey) {
      const direction = deltaY > 0 ? -1 : 1;
      const nextZoom = Math.min(8, Math.max(0.15, Number((zoom * (direction > 0 ? 1.1 : 1 / 1.1)).toFixed(3))));
      if (nextZoom === zoom) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - rect.width / 2;
      const pointerY = event.clientY - rect.top - rect.height / 2;
      const ratio = nextZoom / zoom;
      emitViewportUpdate({
        pan: {
          x: pointerX - (pointerX - pan.x) * ratio,
          y: pointerY - (pointerY - pan.y) * ratio,
        },
        zoom: nextZoom,
      });
      return;
    }

    if (event.shiftKey) {
      const delta = deltaX !== 0 ? deltaX : deltaY;
      scheduleWheelPanDelta(delta, 0);
      return;
    }

    scheduleWheelPanDelta(0, deltaY);
  };

  const handlePanPointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button === 1 && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      panRef.current = null;
      setIsPanning(false);
      emitViewportUpdate({ pan: { x: 0, y: 0 }, zoom: 1 });
      return;
    }

    const isMiddleDrag = event.button === 1;
    const isSpaceDrag = event.button === 0 && spaceHeld && !toolSessionRef.current;
    if (!isMiddleDrag && !isSpaceDrag) return;

    event.preventDefault();
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: pan,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail if the browser cancels the initiating pointer.
    }
    setIsPanning(true);
  };

  const handlePanPointerMove = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    schedulePanUpdate({
      x: session.startPan.x + event.clientX - session.startClientX,
      y: session.startPan.y + event.clientY - session.startClientY,
    });
    event.preventDefault();
  };

  const finishPan = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    flushPendingPan();
    panRef.current = null;
    setIsPanning(false);
    event.preventDefault();
  };

  const cancelPan = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (panRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    pendingPanRef.current = null;
    emitViewportUpdate({ pan: session.startPan });
    panRef.current = null;
    setIsPanning(false);
    event.preventDefault();
  };

  const handleLayerDragOver = (event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
    if (types.includes('application/x-folio-layer-ids')) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return;
    }
    if (onDropImageFiles && types.includes('Files')) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!isImageFileDragOver) setIsImageFileDragOver(true);
    }
  };

  const handleLayerDragLeave = (event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    if (!isImageFileDragOver) return;
    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setIsImageFileDragOver(false);
    }
  };

  const handleLayerDrop = (event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    setIsImageFileDragOver(false);
    const payload = event.dataTransfer?.getData('application/x-folio-layer-ids');
    if (payload) {
      event.preventDefault();
      try {
        const parsed: unknown = JSON.parse(payload);
        if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return;
        onLayerDrop(parsed);
      } catch {
        // Ignore malformed drag payloads instead of creating or moving arbitrary nodes.
      }
      return;
    }

    if (onDropImageFiles && event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const files = Array.from(event.dataTransfer.files);
      event.preventDefault();
      let canvasX = effectiveDocWidth * 0.5;
      let canvasY = document.height * 0.5;
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          canvasX = ((event.clientX - rect.left) / rect.width) * effectiveDocWidth;
          canvasY = ((event.clientY - rect.top) / rect.height) * document.height;
        }
      }
      onDropImageFiles(files, { x: canvasX, y: canvasY });
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDownOutside = (event: PointerEvent) => {
      if (contextMenuRef.current && event.target instanceof Node && contextMenuRef.current.contains(event.target)) {
        return;
      }
      setContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDownOutside, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  const resolveShapeAwareHitNodeId = (point: { x: number; y: number }): string | null => {
    const tol = 4 * invZoom;
    const spatialHits = spatialIndex.queryPoint(point.x, point.y, Math.max(8, tol * 2));
    if (spatialHits.length === 0) return null;
    const candidateIds = new Set(spatialHits);
    return hitTestNodesAtPoint(visibleRenderNodes, point, layerStates, {
      strokeTolerance: tol,
      candidateIds,
    });
  };

  const createPointerInput = (event: JSX.TargetedPointerEvent<SVGSVGElement>): CanvasToolPointerInput => {
    const raw = buildCanvasPointerInput(event, scrollAreaRef.current);
    if (
      raw.resizeHandle === null &&
      !raw.rotateHandle &&
      !raw.smartHandleHit &&
      !raw.anchorHit
    ) {
      const svgRect = event.currentTarget.getBoundingClientRect();
      const hasMeasuredViewport = svgRect.width > 1 && svgRect.height > 1;
      if (hasMeasuredViewport || gpuHybridActive) {
        const shapeHitId = resolveShapeAwareHitNodeId(raw.point);
        return { ...raw, targetNodeId: shapeHitId };
      }
    }
    return raw;
  };

  const handleCanvasContextMenu = (event: JSX.TargetedMouseEvent<SVGSVGElement>) => {
    if (!contextMenuActions) return;
    event.preventDefault();
    event.stopPropagation();
    const point = toCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const hitId = resolveShapeAwareHitNodeId(point);
    if (hitId && !selectedNodeIds.includes(hitId)) {
      evaluateAndDispatchOperation(
        createToolOperation(
          toolId,
          workspace,
          { kind: 'select-nodes', nodeIds: [hitId] },
          { description: 'Select layer for context menu', atomicHistoryStep: false },
        ),
      );
    }
    const maxW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const maxH = typeof window !== 'undefined' ? window.innerHeight : 720;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, maxW - 236)),
      y: Math.max(8, Math.min(event.clientY, maxH - 320)),
    });
  };

  const applyToolTransition = (
    transition: CanvasToolTransition,
    svg?: SVGSVGElement,
    pointerId?: number,
    sourceEvent?: { preventDefault(): void },
  ) => {
    if ('session' in transition) updateToolSession(transition.session ?? null);
    if ('previewNodes' in transition) updatePreview(transition.previewNodes ?? null);
    if ('previewCreateNodes' in transition) setPreviewCreateNodes(transition.previewCreateNodes ?? null);
    if ('customPivot' in transition) setCustomPivot(transition.customPivot ?? null);
    if ('activeAnchor' in transition) setActiveAnchor(transition.activeAnchor ?? null);
    if (transition.guides) setGuides(transition.guides);
    if (transition.capturePointer && svg && pointerId !== undefined) capturePointer(svg, pointerId);
    if (transition.preventDefault) sourceEvent?.preventDefault();

    const operations = extractToolOperationsFromTransition(toolId, workspace, transition);
    if (operations.length > 0) {
      const evaluated = evaluateToolOperationBatch(operations, {
        document,
        selectedNodeIds,
        effectiveLayerStates: layerStates,
      });
      if (evaluated.aborted || evaluated.rejected.length > 0 || evaluated.ready.length === 0) {
        return;
      }
      const committed = dispatchValidatedOperationBatch(evaluated.ready);
      if (committed && canEditInlineText) {
        for (const validatedOp of evaluated.ready) {
          const validatedPayload = validatedOp.payload;
          if (validatedPayload.kind === 'create-nodes' && validatedPayload.openInlineTextForNodeId) {
            const createdText = validatedPayload.nodes.find(
              (n): n is TextNode => n.id === validatedPayload.openInlineTextForNodeId && n.type === 'text',
            );
            if (createdText) {
              const nextEdit = { nodeId: createdText.id, draft: createdText.text };
              pendingInlineEditRef.current = nextEdit;
              setInlineTextEdit(nextEdit);
            }
          }
        }
      }
    }
  };

  const handlePointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    if (spaceHeld && !toolSessionRef.current) return;
    if ((event.target as Element)?.closest('.canvas-inline-text-editor')) return;
    if (inlineTextEdit) commitInlineText();
    const input = createPointerInput(event);
    const transition = activeTool.onPointerDown(input, createToolContext());
    if (transition.session) {
      lastActivePointerInputRef.current = input;
    }
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
  };

  const processPointerMove = (
    input: CanvasToolPointerInput,
    svg: SVGSVGElement,
    pointerId: number,
  ) => {
    lastPointerRef.current = { point: input.point, nodeId: input.targetNodeId };
    if (toolSessionRef.current) {
      lastActivePointerInputRef.current = input;
    }
    if (needsHoverTracking) {
      setHoverPoint(input.point);
      setHoverNodeId((prev) => (prev === input.targetNodeId ? prev : input.targetNodeId));
    }
    const transition = activeTool.onPointerMove(input, createToolContext());
    applyToolTransition(transition, svg, pointerId);
  };
  processPointerMoveRef.current = processPointerMove;

  const flushPendingPointerMove = () => {
    if (pointerMoveRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pointerMoveRafRef.current);
      pointerMoveRafRef.current = null;
    }
    const queued = pendingPointerMoveRef.current;
    pendingPointerMoveRef.current = null;
    if (queued) {
      processPointerMoveRef.current(queued.input, queued.svg, queued.pointerId);
    }
  };

  const handlePointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const input = createPointerInput(event);
    const svg = event.currentTarget;
    const pointerId = event.pointerId;
    if (toolSessionRef.current) {
      event.preventDefault();
    }
    if (typeof requestAnimationFrame !== 'function') {
      processPointerMove(input, svg, pointerId);
      return;
    }
    pendingPointerMoveRef.current = { input, svg, pointerId };
    if (pointerMoveRafRef.current !== null) return;
    pointerMoveRafRef.current = requestAnimationFrame(() => {
      pointerMoveRafRef.current = null;
      const queued = pendingPointerMoveRef.current;
      pendingPointerMoveRef.current = null;
      if (queued) {
        processPointerMoveRef.current(queued.input, queued.svg, queued.pointerId);
      }
    });
  };

  const handlePointerLeave = () => {
    if (pointerMoveRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pointerMoveRafRef.current);
      pointerMoveRafRef.current = null;
    }
    pendingPointerMoveRef.current = null;
    lastPointerRef.current = { point: null, nodeId: null };
    setHoverPoint((prev) => (prev === null ? prev : null));
    setHoverNodeId((prev) => (prev === null ? prev : null));
  };

  const finishPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    flushPendingPointerMove();
    const input = createPointerInput(event);
    const transition = activeTool.onPointerUp(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
    if (!toolSessionRef.current) {
      releaseCapturedPointer();
      lastActivePointerInputRef.current = null;
    }
  };

  const cancelPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    if (pointerMoveRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pointerMoveRafRef.current);
      pointerMoveRafRef.current = null;
    }
    pendingPointerMoveRef.current = null;
    const input = createPointerInput(event);
    const transition = activeTool.onPointerCancel(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
    releaseCapturedPointer();
    lastActivePointerInputRef.current = null;
  };

  syncActiveSessionModifiersRef.current = (event: KeyboardEvent) => {
    const lastInput = lastActivePointerInputRef.current;
    if (!toolSessionRef.current || !lastInput) return;
    const syntheticInput: CanvasToolPointerInput = {
      ...lastInput,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
    lastActivePointerInputRef.current = syntheticInput;
    const transition = getStudioTool(toolId).onPointerMove(syntheticInput, createToolContext());
    applyToolTransition(transition);
  };

  const handleDoubleClick = (event: JSX.TargetedMouseEvent<SVGSVGElement>) => {
    if (!canEditInlineText) return;
    if (toolId !== 'select' && toolId !== 'direct-selection') return;
    const target = event.target as Element;
    if (target.closest('[data-smart-handle]')) return;
    const svgRect = event.currentTarget.getBoundingClientRect();
    let nodeId = svgRect.width > 1 && svgRect.height > 1
      ? resolveShapeAwareHitNodeId(toCanvasPoint(event.currentTarget, event.clientX, event.clientY))
      : (target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null);
    if (!nodeId) return;
    const node = nodeById.get(nodeId);
    if (!node || node.type !== 'text') return;
    const state = layerStates.get(node.id);
    if (!state?.visible || state.locked) return;
    event.preventDefault();
    setInlineTextEdit({ nodeId: node.id, draft: node.text });
  };

  const toolKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  toolKeyDownRef.current = (event: KeyboardEvent) => {
    if (inlineTextEdit) return;

    if (event.key === 'Escape') {
      if (panRef.current) {
        emitViewportUpdate({ pan: panRef.current.startPan });
        panRef.current = null;
        setIsPanning(false);
        event.preventDefault();
        return;
      }
      if (toolSessionRef.current) {
        const transition = getStudioTool(toolId).onKeyDown({
          key: event.key,
          code: event.code,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        }, createToolContext());
        applyToolTransition(transition, undefined, undefined, event);
        if (toolSessionRef.current !== null) {
          updateToolSession(null);
          updatePreview(null);
          setPreviewCreateNodes(null);
          setGuides([]);
          event.preventDefault();
        }
        return;
      }
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.matches('input, textarea, select, button, a, [role="button"], [role="treeitem"], [role="separator"], [role="menuitem"]') ||
        Boolean(target.closest('[role="tree"], [role="menu"], [role="menubar"]')))
    ) {
      return;
    }
    const transition = getStudioTool(toolId).onKeyDown({
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
    }, createToolContext());
    applyToolTransition(transition, undefined, undefined, event);
  };

  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener('keydown', (event) => toolKeyDownRef.current(event), {
      signal: controller.signal,
    });
    return () => controller.abort();
  }, []);

  const renderToolContext = createToolContext();
  const toolCursor = activeTool.cursorStyle(renderToolContext);
  const toolOverlay = activeTool.renderOverlay(renderToolContext);
  const showVectorAnchors = VECTOR_OVERLAY_TOOLS.has(toolId) && selectedPathNodes.length > 0;
  const vectorAnchorsInteractive = toolId === 'direct-selection' || toolId === 'anchor-point';
  const showSelectionBox = Boolean(selectionBounds) &&
    toolId !== 'shape-builder' &&
    !(toolId === 'direct-selection' && selectedPathNodes.length === selectedNodes.length && selectedPathNodes.length > 0);

  const spacingRedlines = useMemo(() => {
    if (!altHeld || toolSession || !selectionBounds) return null;
    if (toolId !== 'select' && toolId !== 'direct-selection') return null;
    const selectedSet = new Set(selectedNodeIds);
    const hoveredNode = hoverNodeId && !selectedSet.has(hoverNodeId) ? nodeById.get(hoverNodeId) : undefined;
    const hoveredVisible = hoveredNode && layerStates.get(hoveredNode.id)?.visible;
    const targetBounds: Bounds = hoveredVisible
      ? { x: hoveredNode.x, y: hoveredNode.y, width: hoveredNode.width, height: hoveredNode.height }
      : { x: 0, y: 0, width: document.width, height: document.height };
    return computeSpacingRedlines(selectionBounds, targetBounds);
  }, [altHeld, toolSession, selectionBounds, toolId, selectedNodeIds, hoverNodeId, nodeById, layerStates, document.width, document.height]);

  const pathSnapWorldPoint = useMemo(() => {
    if (!hoverPoint || toolSession) return null;
    if (toolId !== 'anchor-point' && toolId !== 'scissors') return null;
    const hoveredNode = hoverNodeId ? nodeById.get(hoverNodeId) : undefined;
    const candidates: PathNode[] =
      hoveredNode?.type === 'path'
        ? [hoveredNode]
        : selectedPathNodes.length > 0
          ? selectedPathNodes
          : [];
    const tolerance = 14 * invZoom;
    let bestWorld: { x: number; y: number } | null = null;
    let bestDist = tolerance;
    for (const candidate of candidates) {
      const localPt = worldPointToNodeLocal(candidate, hoverPoint);
      const hit = findNearestSegmentHit(candidate, localPt, bestDist);
      if (hit && hit.distance < bestDist) {
        bestDist = hit.distance;
        bestWorld = nodeLocalPointToWorld(candidate, hit.point);
      }
    }
    return bestWorld;
  }, [hoverPoint, toolSession, toolId, hoverNodeId, nodeById, selectedPathNodes, invZoom]);

  const eyedropperLoupe = useMemo(() => {
    if (toolId !== 'eyedropper' || !hoverPoint) return null;
    const hitNode = hoverNodeId ? nodeById.get(hoverNodeId) : undefined;
    const sampled = extractSampledColor(hitNode, document.background);
    return {
      x: hoverPoint.x,
      y: hoverPoint.y,
      color: sampled.color,
      sourceName: sampled.sourceName,
      target: shiftHeld ? 'STROKE' : 'FILL',
    };
  }, [toolId, hoverPoint, hoverNodeId, nodeById, document.background, shiftHeld]);

  const shapeBuilderHoveredFace = useMemo(() => {
    if (toolId !== 'shape-builder' || toolSession || !shapeBuilderHoverArrangement || !hoverPoint) return null;
    return hitTestPlanarFace(shapeBuilderHoverArrangement, hoverPoint);
  }, [toolId, toolSession, shapeBuilderHoverArrangement, hoverPoint]);

  const smartHandleNode =
    toolId === 'select' &&
    selectedNodes.length === 1 &&
    (!toolSession || toolSession.kind === 'smart-handle')
      ? selectedNodes[0]
      : null;

  const showPivotHandle = Boolean(selectionBounds) && (toolId === 'rotate' || customPivot !== null);
  const pivotPoint = showPivotHandle && selectionBounds
    ? (customPivot ?? {
      x: selectionBounds.x + selectionBounds.width / 2,
      y: selectionBounds.y + selectionBounds.height / 2,
    })
    : null;

  return (
    <div
      ref={scrollAreaRef}
      data-workspace={workspace}
      class={
        'canvas-scroll-area' +
        (workspace === 'component' ? ' is-component-studio' : '') +
        (spaceHeld ? ' canvas-pan-ready' : '') +
        (isPanning ? ' canvas-panning' : '') +
        (isImageFileDragOver ? ' is-file-drop-active' : '')
      }
      onWheel={handleWheel}
      onDragOver={handleLayerDragOver}
      onDragLeave={handleLayerDragLeave}
      onDrop={handleLayerDrop}
      onPointerDown={handlePanPointerDown}
      onPointerMove={handlePanPointerMove}
      onPointerUp={finishPan}
      onPointerCancel={cancelPan}
    >
      <div
        class="canvas-stage"
        style={{
          width: String(zoom * 100) + '%',
          transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px)',
          transition: (isPanning || toolSession?.kind === 'hand' || toolSession?.kind === 'scrubby-zoom') ? 'none' : 'transform 110ms ease-out',
          willChange: 'transform',
        }}
      >
        <div class="artboard-label">
          <span>
            {document.name}
            {workspace === 'main' && activeBreakpoint !== 'desktop'
              ? ` · ${activeBreakpoint === 'tablet' ? 'Tablet' : 'Mobile'}`
              : ''}
          </span>
          <span>{effectiveDocWidth} × {document.height}</span>
        </div>
        <div class="artboard-stack">
          {gpuHybridActive && (
            <Suspense fallback={null}>
              <LazyGpuViewportLayer
                active={gpuHybridActive}
                docWidth={effectiveDocWidth}
                docHeight={document.height}
                background={document.background}
                canvasNodes={sceneCanvasNodes}
                renderNodes={sceneVisibleRenderNodes}
                viewportRect={gpuViewportRect}
                zoom={zoom}
                components={components}
                assets={assets}
                nodeById={sceneNodeById}
                clipMaskMap={sceneClipMaskMap}
                frameClipMap={sceneFrameClipMap}
                componentById={componentById}
                assetById={assetById}
                tokens={designTokens}
                hiddenNodeIds={isolatedPreviewIdSet}
                inlineEditNodeId={inlineEditNode?.id ?? null}
                onMetrics={onGpuMetrics}
              />
            </Suspense>
          )}
          <svg
            ref={svgRef}
            class={`artboard${gpuHybridActive ? ' is-gpu-hybrid' : ''}`}
            data-tool={toolId}
            data-workspace={workspace}
            data-breakpoint={activeBreakpoint}
            data-renderer={gpuHybridActive ? 'gpu-hybrid' : 'svg-dom'}
            style={{ cursor: toolCursor }}
            viewBox={'0 0 ' + effectiveDocWidth + ' ' + document.height}
            role="application"
            aria-label="Folio design artboard. Use the active Tool Rack tool to select, draw, edit vector paths, navigate, or inspect artwork."
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerUp={finishPointer}
            onPointerCancel={cancelPointer}
            onDblClick={handleDoubleClick}
            onContextMenu={handleCanvasContextMenu}
          >
            {!gpuHybridActive && (
              <CanvasSceneLayer
                width={effectiveDocWidth}
                height={document.height}
                background={document.background}
                canvasNodes={sceneCanvasNodes}
                renderNodes={culledRenderNodes}
                inlineEditNodeId={inlineEditNode?.id ?? null}
                components={components}
                assets={assets}
                maskPrefix={maskPrefix}
                nodeById={sceneNodeById}
                clipMaskMap={sceneClipMaskMap}
                frameClipMap={sceneFrameClipMap}
                componentById={componentById}
                assetById={assetById}
                tokens={designTokens}
                hiddenNodeIds={isolatedPreviewIdSet}
              />
            )}

          <CanvasInteractiveOverlays
            docWidth={effectiveDocWidth}
            docHeight={document.height}
            invZoom={invZoom}
            toolId={toolId}
            toolOptions={toolOptions}
            toolSession={toolSession}
            toolOverlay={toolOverlay}
            selectedNodes={selectedNodes}
            selectedPathNodes={selectedPathNodes}
            selectionBounds={selectionBounds}
            showSelectionBox={showSelectionBox}
            canResize={canResize}
            showVectorAnchors={showVectorAnchors}
            vectorAnchorsInteractive={vectorAnchorsInteractive}
            activeAnchor={activeAnchor}
            previewCreateNodes={previewCreateNodes}
            isolatedPreviewNodes={isolatedPreviewNodes}
            canvasNodes={canvasNodes}
            components={components}
            assets={assets}
            maskPrefix={maskPrefix}
            clipMaskMap={clipMaskMap}
            frameClipMap={frameClipMap}
            componentById={componentById}
            assetById={assetById}
            designTokens={designTokens}
            shapeBuilderHoverArrangement={shapeBuilderHoverArrangement}
            shapeBuilderHoveredFace={shapeBuilderHoveredFace}
            altHeld={altHeld}
            smartHandleNode={smartHandleNode}
            pivotPoint={pivotPoint}
            spacingRedlines={spacingRedlines}
            pathSnapWorldPoint={pathSnapWorldPoint}
            hoverPoint={hoverPoint}
            eyedropperLoupe={eyedropperLoupe}
            guides={guides}
          />

          {inlineEditNode && inlineTextEdit && (
            <foreignObject
              x={inlineEditNode.x - 4}
              y={inlineEditNode.y - 4}
              width={Math.max(180, inlineEditNode.width + 44)}
              height={Math.max(44, inlineEditNode.height + 28)}
            >
              <textarea
                ref={inlineTextInputRef}
                class="canvas-inline-text-editor"
                value={inlineTextEdit.draft}
                style={{
                  fontSize: `${inlineEditNode.style.fontSize}px`,
                  fontFamily: inlineEditNode.style.fontFamily,
                  fontWeight: String(inlineEditNode.style.fontWeight),
                  lineHeight: String(inlineEditNode.style.lineHeight),
                  color: inlineEditNode.style.fill,
                }}
                onInput={(event) => {
                  setInlineTextEdit({
                    nodeId: inlineTextEdit.nodeId,
                    draft: (event.target as HTMLTextAreaElement).value,
                  });
                }}
                onBlur={commitInlineText}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setInlineTextEdit(null);
                  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    commitInlineText();
                  }
                }}
              />
            </foreignObject>
          )}
        </svg>
        </div>
      </div>

      {contextMenu && contextMenuActions && (() => {
        const primarySelected = selectedNodes.length === 1 ? selectedNodes[0] : null;
        const activeDrawMode = primarySelected?.drawMode ?? 'normal';
        const hasOutsideTargets = Boolean(
          primarySelected && (
            (primarySelected.clipMaskBaseId && primarySelected.clipMaskMode === 'outside') ||
            canvasNodes.some((n) => n.clipMaskBaseId === primarySelected.id && n.clipMaskMode === 'outside')
          ),
        );
        const runMenuAction = (fn: () => void) => {
          setContextMenu(null);
          fn();
        };
        return (
          <div
            ref={contextMenuRef}
            class="canvas-context-menu"
            role="menu"
            aria-label="Canvas selection and draw mode menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <div class="canvas-context-menu-header">Selection</div>
            <button
              type="button"
              role="menuitem"
              class="canvas-context-menu-item"
              disabled={selectedNodeIds.length === 0}
              onClick={() => runMenuAction(contextMenuActions.onDeselect)}
            >
              <span>Deselect</span>
              <kbd>Ctrl+D</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              class="canvas-context-menu-item"
              onClick={() => runMenuAction(contextMenuActions.onInvertSelection)}
            >
              <span>Invert Selection</span>
              <kbd>Ctrl+Shift+I</kbd>
            </button>
            <div class="canvas-context-menu-divider" role="separator" />
            <div class="canvas-context-menu-header">Select Similar</div>
            <button
              type="button"
              role="menuitem"
              class="canvas-context-menu-item"
              disabled={selectedNodeIds.length === 0}
              onClick={() => runMenuAction(() => contextMenuActions.onSelectSimilar('fill'))}
            >
              <span>Same Fill</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="canvas-context-menu-item"
              disabled={selectedNodeIds.length === 0}
              onClick={() => runMenuAction(() => contextMenuActions.onSelectSimilar('stroke'))}
            >
              <span>Same Stroke</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="canvas-context-menu-item"
              disabled={selectedNodeIds.length === 0}
              onClick={() => runMenuAction(() => contextMenuActions.onSelectSimilar('type'))}
            >
              <span>Same Node Type</span>
            </button>
            {selectedNodes.length > 0 && (
              <>
                <div class="canvas-context-menu-divider" role="separator" />
                <div class="canvas-context-menu-header">Draw Mode</div>
                {([
                  { id: 'normal', label: 'Draw Normal' },
                  { id: 'inside', label: 'Draw Inside' },
                  { id: 'outside', label: 'Draw Outside' },
                ] as const).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={activeDrawMode === item.id}
                    class={`canvas-context-menu-item${activeDrawMode === item.id ? ' is-active' : ''}`}
                    onClick={() => runMenuAction(() => contextMenuActions.onSetDrawMode(item.id))}
                  >
                    <span>{item.label}</span>
                    {activeDrawMode === item.id && <span class="canvas-context-menu-check">●</span>}
                  </button>
                ))}
                {hasOutsideTargets && (
                  <button
                    type="button"
                    role="menuitem"
                    class="canvas-context-menu-item is-accent"
                    onClick={() => runMenuAction(contextMenuActions.onPermanentSubtractOutside)}
                  >
                    <span>Permanent Subtract (Pathfinder)</span>
                  </button>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
