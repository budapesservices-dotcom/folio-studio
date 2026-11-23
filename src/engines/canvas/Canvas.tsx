import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
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
} from './canvasHelpers';
import { CanvasInteractiveOverlays } from './CanvasOverlays';
import { CanvasSceneLayer } from './CanvasSceneLayer';
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

interface CanvasProps {
  document: FolioDocument;
  components?: ComponentDefinition[];
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
  onCreateNodes?: (nodes: DesignNode[]) => void;
  onReplaceNodeWithNodes?: (nodeId: string, nodes: DesignNode[]) => void;
  onReplaceNodes?: (removeIds: string[], insertNodes: DesignNode[]) => void;
  onSampledColor?: (color: string, sourceName: string, target?: 'fill' | 'stroke') => void;
  onToolChange?: (toolId: CanvasToolId) => void;
  onToolNotice?: (message: string) => void;
  onInlineTextCommit?: (nodeId: string, text: string) => void;
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
  onCreateNodes,
  onReplaceNodeWithNodes,
  onReplaceNodes,
  onSampledColor,
  onToolChange,
  onToolNotice,
  onInlineTextCommit,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const inlineTextInputRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<DesignNode[] | null>(null);
  const [previewNodes, setPreviewNodes] = useState<DesignNode[] | null>(null);
  const [previewCreateNodes, setPreviewCreateNodes] = useState<DesignNode[] | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
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

  const displayedNodes = useMemo(() => {
    if (!previewNodes || previewNodes.length === 0) return resolvedLayoutNodes;
    const previewById = new Map(previewNodes.map((node) => [node.id, node]));
    return resolvedLayoutNodes.map((node) => previewById.get(node.id) ?? node);
  }, [resolvedLayoutNodes, previewNodes]);

  const canvasNodes = useMemo(
    () => displayedNodes.filter((node) => node.onCanvas !== false),
    [displayedNodes],
  );

  // Precompute lookup maps, layer states, and WASM-ready spatial index once per scene change.
  const {
    nodeById,
    layerStates,
    clipMaskMap,
    frameClipMap,
    visibleRenderNodes,
    selectableNodes,
    spatialIndex,
  } = useMemo(() => {
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
  }, [canvasNodes]);

  const culledRenderNodes = useMemo(() => {
    const viewportRect = computeVisibleArtboardRect(
      scrollAreaRef.current,
      svgRef.current,
      effectiveDocWidth,
      document.height,
    );
    return cullVisibleRenderNodes(
      visibleRenderNodes,
      spatialIndex,
      viewportRect,
      selectedNodeIds,
      nodeById,
    );
  }, [
    visibleRenderNodes,
    spatialIndex,
    effectiveDocWidth,
    document.height,
    zoom,
    pan.x,
    pan.y,
    renderedSvgWidth,
    selectedNodeIds,
    nodeById,
  ]);

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
      emitViewportUpdate({ pan: { ...pan, x: pan.x - delta } });
      return;
    }

    emitViewportUpdate({ pan: { ...pan, y: pan.y - deltaY } });
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

    emitViewportUpdate({
      pan: {
        x: session.startPan.x + event.clientX - session.startClientX,
        y: session.startPan.y + event.clientY - session.startClientY,
      },
    });
    event.preventDefault();
  };

  const finishPan = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    event.preventDefault();
  };

  const cancelPan = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const session = panRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    emitViewportUpdate({ pan: session.startPan });
    panRef.current = null;
    setIsPanning(false);
    event.preventDefault();
  };

  const handleLayerDragOver = (event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
    if (!types.includes('application/x-folio-layer-ids')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };

  const handleLayerDrop = (event: JSX.TargetedDragEvent<HTMLDivElement>) => {
    const payload = event.dataTransfer?.getData('application/x-folio-layer-ids');
    if (!payload) return;
    event.preventDefault();
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return;
      onLayerDrop(parsed);
    } catch {
      // Ignore malformed drag payloads instead of creating or moving arbitrary nodes.
    }
  };

  const createPointerInput = (event: JSX.TargetedPointerEvent<SVGSVGElement>): CanvasToolPointerInput =>
    buildCanvasPointerInput(event, scrollAreaRef.current);

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

  const handlePointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const input = createPointerInput(event);
    lastPointerRef.current = { point: input.point, nodeId: input.targetNodeId };
    if (toolSessionRef.current) {
      lastActivePointerInputRef.current = input;
    }
    if (needsHoverTracking) {
      setHoverPoint(input.point);
      setHoverNodeId((prev) => (prev === input.targetNodeId ? prev : input.targetNodeId));
    }
    const transition = activeTool.onPointerMove(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
  };

  const handlePointerLeave = () => {
    lastPointerRef.current = { point: null, nodeId: null };
    setHoverPoint((prev) => (prev === null ? prev : null));
    setHoverNodeId((prev) => (prev === null ? prev : null));
  };

  const finishPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const input = createPointerInput(event);
    const transition = activeTool.onPointerUp(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
    if (!toolSessionRef.current) {
      releaseCapturedPointer();
      lastActivePointerInputRef.current = null;
    }
  };

  const cancelPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
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
    const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id');
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
        (isPanning ? ' canvas-panning' : '')
      }
      onWheel={handleWheel}
      onDragOver={handleLayerDragOver}
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
        <svg
          ref={svgRef}
          class="artboard"
          data-tool={toolId}
          data-workspace={workspace}
          data-breakpoint={activeBreakpoint}
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
        >
          <CanvasSceneLayer
            width={effectiveDocWidth}
            height={document.height}
            background={document.background}
            canvasNodes={canvasNodes}
            renderNodes={culledRenderNodes}
            inlineEditNodeId={inlineEditNode?.id ?? null}
            components={components}
            maskPrefix={maskPrefix}
            nodeById={nodeById}
            clipMaskMap={clipMaskMap}
            frameClipMap={frameClipMap}
            componentById={componentById}
            tokens={designTokens}
            patternScale={toolId === 'shape-builder' ? invZoom : 1}
          />

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
            canvasNodes={canvasNodes}
            components={components}
            maskPrefix={maskPrefix}
            clipMaskMap={clipMaskMap}
            frameClipMap={frameClipMap}
            componentById={componentById}
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
  );
}
