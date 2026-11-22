import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ComponentDefinition, DesignNode, FolioDocument, PathNode, TextNode } from '../../core/document/types';
import { buildLayerClipMaskMap, getEffectiveLayerStates, getLayerRenderOrder } from '../../core/document/layers';
import {
  decomposeNodesForShapeBuilder,
  findNearestSegmentHit,
  hitTestPlanarFace,
  nodeLocalPointToWorld,
  serializePathPointsToSvgD,
  worldPointToNodeLocal,
  type PlanarFace,
} from '../../core/document/vector';
import { DocumentMaskDefs, MaskedNodeArtwork, NodeShape, sanitizeMaskIdSegment, type PrimitiveNode } from './artwork';
import { computeSpacingRedlines, getBounds, type Bounds, type ResizeHandle, type SnapGuide } from './geometry';
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
  type SmartHandleHit,
  type ToolWorkspaceScope,
  type VectorAnchorHit,
} from './tools/types';
import './canvas.css';

interface CanvasProps {
  document: FolioDocument;
  components?: ComponentDefinition[];
  selectedNodeIds: string[];
  toolId: CanvasToolId;
  workspace?: ToolWorkspaceScope;
  toolOptions?: CanvasToolOptions;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (nodeIds: string[]) => void;
  onTransformCommit: (nodes: DesignNode[]) => void;
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

const HANDLE_SIZE = 10;
const ROTATE_ZONE_OFFSET = 14;
const ROTATE_ZONE_SIZE = 14;
const VECTOR_OVERLAY_TOOLS = new Set<CanvasToolId>([
  'direct-selection',
  'anchor-point',
  'pen',
  'curvature',
  'scissors',
  'smooth',
]);

function toCanvasPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const matrix = svg.getScreenCTM();
  if (matrix) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }

  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * Number(svg.viewBox.baseVal.width),
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * Number(svg.viewBox.baseVal.height),
  };
}

function planarFaceToSvgPath(face: PlanarFace): string {
  const ring = face.polygon;
  if (ring.length === 0) return '';
  return `M ${ring[0].x} ${ring[0].y} ` + ring.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ') + ' Z';
}

function SelectionOverlay({
  bounds,
  canResize,
  canRotate,
  isScaleTool,
  invZoom,
}: {
  bounds: Bounds;
  canResize: boolean;
  canRotate: boolean;
  isScaleTool: boolean;
  invZoom: number;
}) {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const middleX = left + bounds.width / 2;
  const middleY = top + bounds.height / 2;
  const handleSize = HANDLE_SIZE * invZoom;
  const rotateOffset = ROTATE_ZONE_OFFSET * invZoom;
  const rotateSize = ROTATE_ZONE_SIZE * invZoom;

  const handles: { id: ResizeHandle; x: number; y: number }[] = [
    { id: 'nw', x: left, y: top },
    { id: 'n', x: middleX, y: top },
    { id: 'ne', x: right, y: top },
    { id: 'e', x: right, y: middleY },
    { id: 'se', x: right, y: bottom },
    { id: 's', x: middleX, y: bottom },
    { id: 'sw', x: left, y: bottom },
    { id: 'w', x: left, y: middleY },
  ];
  const rotateZones = [
    { id: 'rot-nw', x: left - rotateOffset, y: top - rotateOffset },
    { id: 'rot-ne', x: right + rotateOffset - rotateSize, y: top - rotateOffset },
    { id: 'rot-se', x: right + rotateOffset - rotateSize, y: bottom + rotateOffset - rotateSize },
    { id: 'rot-sw', x: left - rotateOffset, y: bottom + rotateOffset - rotateSize },
  ];

  return (
    <g class="canvas-selection" pointer-events="none">
      {canRotate && rotateZones.map((zone) => (
        <rect
          key={zone.id}
          data-rotate-handle="true"
          class="canvas-rotate-zone"
          x={zone.x}
          y={zone.y}
          width={rotateSize}
          height={rotateSize}
          rx={4 * invZoom}
          pointer-events="all"
        />
      ))}
      <rect
        class={'canvas-selection-outline' + (isScaleTool ? ' is-scale' : '')}
        x={left}
        y={top}
        width={Math.max(1, bounds.width)}
        height={Math.max(1, bounds.height)}
      />
      {canResize && handles.map((handle) => (
        <rect
          key={handle.id}
          data-resize-handle={handle.id}
          class={'canvas-resize-handle' + (isScaleTool ? ' is-scale' : '')}
          x={handle.x - handleSize / 2}
          y={handle.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          rx={isScaleTool ? handleSize / 2 : 2 * invZoom}
          pointer-events="all"
        />
      ))}
    </g>
  );
}

function VectorAnchorOverlay({
  nodes,
  interactive,
  activeSession,
  activeAnchor,
  invZoom,
}: {
  nodes: PathNode[];
  interactive: boolean;
  activeSession: CanvasToolSession | null;
  activeAnchor: { nodeId: string; pointIndex: number } | null;
  invZoom: number;
}) {
  if (nodes.length === 0) return null;
  const focusedAnchor = activeSession?.kind === 'anchor-edit'
    ? { nodeId: activeSession.node.id, pointIndex: activeSession.pointIndex }
    : activeAnchor;
  const handleR = 4.2 * invZoom;
  const smoothR = 4.8 * invZoom;
  const cornerSize = 9 * invZoom;

  return (
    <g class="canvas-vector-overlay" pointer-events="none">
      {nodes.map((node) => {
        const transform = node.rotation
          ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
          : undefined;
        const d = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
        return (
          <g key={`vec-${node.id}`} transform={transform}>
            <g transform={`translate(${node.x} ${node.y})`}>
              <path class="canvas-vector-wireframe" d={d} />
              {node.points.map((pt, index) => {
                const isActive = focusedAnchor?.nodeId === node.id && focusedAnchor.pointIndex === index;
                const isSmooth = pt.pointType === 'smooth' || pt.pointType === 'symmetric';
                return (
                  <g key={pt.id}>
                    {pt.handleIn && (
                      <>
                        <line
                          class="canvas-bezier-tangent"
                          x1={pt.x}
                          y1={pt.y}
                          x2={pt.handleIn.x}
                          y2={pt.handleIn.y}
                        />
                        <circle
                          class="canvas-bezier-handle"
                          cx={pt.handleIn.x}
                          cy={pt.handleIn.y}
                          r={handleR}
                          data-anchor-node-id={interactive ? node.id : undefined}
                          data-anchor-index={interactive ? String(index) : undefined}
                          data-anchor-part={interactive ? 'handle-in' : undefined}
                          pointer-events={interactive ? 'all' : 'none'}
                        />
                      </>
                    )}
                    {pt.handleOut && (
                      <>
                        <line
                          class="canvas-bezier-tangent"
                          x1={pt.x}
                          y1={pt.y}
                          x2={pt.handleOut.x}
                          y2={pt.handleOut.y}
                        />
                        <circle
                          class="canvas-bezier-handle"
                          cx={pt.handleOut.x}
                          cy={pt.handleOut.y}
                          r={handleR}
                          data-anchor-node-id={interactive ? node.id : undefined}
                          data-anchor-index={interactive ? String(index) : undefined}
                          data-anchor-part={interactive ? 'handle-out' : undefined}
                          pointer-events={interactive ? 'all' : 'none'}
                        />
                      </>
                    )}
                    {isSmooth ? (
                      <circle
                        class={'canvas-vector-anchor is-smooth' + (isActive ? ' is-active' : '')}
                        cx={pt.x}
                        cy={pt.y}
                        r={smoothR}
                        data-anchor-node-id={interactive ? node.id : undefined}
                        data-anchor-index={interactive ? String(index) : undefined}
                        data-anchor-part={interactive ? 'anchor' : undefined}
                        pointer-events={interactive ? 'all' : 'none'}
                      />
                    ) : (
                      <rect
                        class={'canvas-vector-anchor' + (isActive ? ' is-active' : '')}
                        x={pt.x - cornerSize / 2}
                        y={pt.y - cornerSize / 2}
                        width={cornerSize}
                        height={cornerSize}
                        rx={1.5 * invZoom}
                        data-anchor-node-id={interactive ? node.id : undefined}
                        data-anchor-index={interactive ? String(index) : undefined}
                        data-anchor-part={interactive ? 'anchor' : undefined}
                        pointer-events={interactive ? 'all' : 'none'}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        );
      })}
    </g>
  );
}

function HudBadge({
  x,
  y,
  text,
  variant = 'default',
  invZoom = 1,
}: {
  x: number;
  y: number;
  text: string;
  variant?: 'default' | 'measure' | 'rotate';
  invZoom?: number;
}) {
  const width = Math.max(46, text.length * 6.8 + 16);
  const height = 22;
  return (
    <g
      class={`canvas-hud-badge is-${variant}`}
      transform={`translate(${x} ${y}) scale(${invZoom})`}
      pointer-events="none"
    >
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="4" />
      <text x="0" y="1" text-anchor="middle" dominant-baseline="middle">{text}</text>
    </g>
  );
}

export function Canvas({
  document,
  components = [],
  selectedNodeIds,
  toolId,
  workspace = 'main',
  toolOptions = DEFAULT_CANVAS_TOOL_OPTIONS,
  zoom,
  pan,
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
  const [renderedSvgWidth, setRenderedSvgWidth] = useState<number>(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateWidth = () => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setRenderedSvgWidth(w);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(svg);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [document.width, zoom]);

  const invZoom = renderedSvgWidth > 20
    ? Math.min(3.5, Math.max(0.35, document.width / renderedSvgWidth))
    : 1 / Math.max(0.35, zoom);
  const selectionKey = selectedNodeIds.join(',');

  const updateToolSession = (next: CanvasToolSession | null) => {
    toolSessionRef.current = next;
    setToolSession(next);
  };

  // Clear in-progress tool sessions when switching tools or documents so no stale drafts leak.
  useEffect(() => {
    updateToolSession(null);
    previewRef.current = null;
    setPreviewNodes(null);
    setPreviewCreateNodes(null);
    setGuides([]);
    setInlineTextEdit(null);
    setActiveAnchor(null);
  }, [toolId, document.id]);

  // Reset custom pivot and focused anchor when active selection changes.
  useEffect(() => {
    setCustomPivot(null);
    setActiveAnchor(null);
  }, [selectionKey, document.id]);

  useEffect(() => {
    if (inlineTextEdit && inlineTextInputRef.current) {
      inlineTextInputRef.current.focus();
      inlineTextInputRef.current.select();
    }
  }, [inlineTextEdit?.nodeId]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || target.matches('input, textarea, select, button, a, [role="button"]');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(true);
      if (event.key === 'Shift') setShiftHeld(true);
      if (event.code === 'Space' && !isInteractiveTarget(event.target)) {
        setSpaceHeld(true);
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(false);
      if (event.key === 'Shift') setShiftHeld(false);
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const handleWindowBlur = () => {
      setSpaceHeld(false);
      setAltHeld(false);
      setShiftHeld(false);
      panRef.current = null;
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

  const displayedNodes = useMemo(() => {
    if (!previewNodes || previewNodes.length === 0) return document.nodes;
    const previewById = new Map(previewNodes.map((node) => [node.id, node]));
    return document.nodes.map((node) => previewById.get(node.id) ?? node);
  }, [document.nodes, previewNodes]);

  const canvasNodes = useMemo(
    () => displayedNodes.filter((node) => node.onCanvas !== false),
    [displayedNodes],
  );

  // Precompute lookup maps & layer states once per document/preview update (O(N))
  const { nodeById, layerStates, clipMaskMap, visibleRenderNodes, selectableNodes } = useMemo(() => {
    const byId = new Map(canvasNodes.map((node) => [node.id, node]));
    const states = getEffectiveLayerStates(canvasNodes);
    const masks = buildLayerClipMaskMap(canvasNodes, byId);
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
      visibleRenderNodes: renderNodes,
      selectableNodes: selectable,
    };
  }, [canvasNodes]);

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

  const maskPrefix = useMemo(
    () => `folio-mask-${sanitizeMaskIdSegment(document.id)}`,
    [document.id],
  );

  // Locked layers may remain selected in the Layers panel, but only placed
  // nodes participate in Canvas selection, transforms and resize bounds.
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
    } catch {
      // Pointer capture can fail when the browser cancels the initiating pointer.
    }
  };

  const commitInlineText = () => {
    if (!inlineTextEdit) return;
    const trimmed = inlineTextEdit.draft;
    const nodeId = inlineTextEdit.nodeId;
    setInlineTextEdit(null);
    onInlineTextCommit?.(nodeId, trimmed.length > 0 ? trimmed : 'Text');
  };

  const handleWheel = (event: JSX.TargetedWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
    const deltaX = event.deltaX * unit * 0.55;
    const deltaY = event.deltaY * unit * 0.55;

    if (event.ctrlKey || event.metaKey) {
      const direction = deltaY > 0 ? -1 : 1;
      const nextZoom = Math.min(2.5, Math.max(0.35, Number((zoom * (direction > 0 ? 1.1 : 1 / 1.1)).toFixed(3))));
      if (nextZoom === zoom) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - rect.width / 2;
      const pointerY = event.clientY - rect.top - rect.height / 2;
      const ratio = nextZoom / zoom;
      onPanChange({
        x: pointerX - (pointerX - pan.x) * ratio,
        y: pointerY - (pointerY - pan.y) * ratio,
      });
      onZoomChange(nextZoom);
      return;
    }

    if (event.shiftKey) {
      const delta = deltaX !== 0 ? deltaX : deltaY;
      onPanChange({ ...pan, x: pan.x - delta });
      return;
    }

    onPanChange({ ...pan, y: pan.y - deltaY });
  };

  const handlePanPointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button === 1 && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      panRef.current = null;
      setIsPanning(false);
      onPanChange({ x: 0, y: 0 });
      onZoomChange(1);
      return;
    }

    const isMiddleDrag = event.button === 1;
    const isSpaceDrag = event.button === 0 && spaceHeld;
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

    onPanChange({
      x: session.startPan.x + event.clientX - session.startClientX,
      y: session.startPan.y + event.clientY - session.startClientY,
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
    onPanChange(session.startPan);
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

  const createPointerInput = (event: JSX.TargetedPointerEvent<SVGSVGElement>): CanvasToolPointerInput => {
    const target = event.target as Element;
    const resizeElement = target.closest('[data-resize-handle]');
    const resizeHandle = resizeElement?.getAttribute('data-resize-handle') as ResizeHandle | null;
    const rotateHandle = Boolean(target.closest('[data-rotate-handle]'));
    const anchorElement = target.closest('[data-anchor-node-id]');
    let anchorHit: VectorAnchorHit | null = null;
    if (anchorElement) {
      const nodeId = anchorElement.getAttribute('data-anchor-node-id');
      const idxRaw = anchorElement.getAttribute('data-anchor-index');
      const part = anchorElement.getAttribute('data-anchor-part') as VectorAnchorHit['part'] | null;
      if (nodeId && idxRaw !== null && part) {
        const pointIndex = Number(idxRaw);
        if (Number.isInteger(pointIndex) && pointIndex >= 0) {
          anchorHit = { nodeId, pointIndex, part };
        }
      }
    }

    const smartEl = target.closest('[data-smart-handle]');
    let smartHandleHit: SmartHandleHit | null = null;
    if (smartEl) {
      const kind = smartEl.getAttribute('data-smart-handle');
      if (kind === 'corner-radius') {
        const nodeId = smartEl.getAttribute('data-smart-node-id');
        const corner = smartEl.getAttribute('data-smart-corner') as 'nw' | 'ne' | 'se' | 'sw' | null;
        if (nodeId && corner) smartHandleHit = { kind: 'corner-radius', nodeId, corner };
      } else if (kind === 'star-inner') {
        const nodeId = smartEl.getAttribute('data-smart-node-id');
        if (nodeId) smartHandleHit = { kind: 'star-inner', nodeId };
      } else if (kind === 'pivot') {
        smartHandleHit = { kind: 'pivot' };
      }
    }

    const scrollRect = scrollAreaRef.current?.getBoundingClientRect();
    return {
      pointerId: event.pointerId,
      button: event.button,
      point: toCanvasPoint(event.currentTarget, event.clientX, event.clientY),
      clientX: event.clientX,
      clientY: event.clientY,
      viewportAnchor: scrollRect ? {
        x: event.clientX - scrollRect.left - scrollRect.width / 2,
        y: event.clientY - scrollRect.top - scrollRect.height / 2,
      } : { x: 0, y: 0 },
      targetNodeId: target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
      resizeHandle,
      rotateHandle,
      anchorHit,
      smartHandleHit,
      detail: event.detail,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
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
    if (transition.createNodes && transition.createNodes.length > 0) {
      onCreateNodes?.(transition.createNodes);
    }
    if (transition.replaceNodeWithNodes) {
      onReplaceNodeWithNodes?.(transition.replaceNodeWithNodes.nodeId, transition.replaceNodeWithNodes.nodes);
    }
    if (transition.replaceNodes) {
      onReplaceNodes?.(transition.replaceNodes.removeIds, transition.replaceNodes.insertNodes);
    }
    if (transition.commitNodes) onTransformCommit(transition.commitNodes);
    if ('selection' in transition) onSelectionChange(transition.selection ?? []);
    if (transition.sampledColor) {
      onSampledColor?.(transition.sampledColor.color, transition.sampledColor.sourceName, transition.sampledColor.target);
    }
    if ('customPivot' in transition) setCustomPivot(transition.customPivot ?? null);
    if ('activeAnchor' in transition) setActiveAnchor(transition.activeAnchor ?? null);
    if (transition.nextToolId) onToolChange?.(transition.nextToolId);
    if (transition.notice) onToolNotice?.(transition.notice);
    if (transition.pan) onPanChange(transition.pan);
    if (transition.zoom !== undefined) onZoomChange(transition.zoom);
    if (transition.guides) setGuides(transition.guides);
    if (transition.capturePointer && svg && pointerId !== undefined) capturePointer(svg, pointerId);
    if (transition.preventDefault) sourceEvent?.preventDefault();
  };

  const handlePointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    if (spaceHeld) return;
    if ((event.target as Element)?.closest('.canvas-inline-text-editor')) return;
    if (inlineTextEdit) commitInlineText();
    const input = createPointerInput(event);
    const transition = activeTool.onPointerDown(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
  };

  const handlePointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const input = createPointerInput(event);
    setHoverPoint(input.point);
    setHoverNodeId(input.targetNodeId);
    const transition = activeTool.onPointerMove(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
  };

  const handlePointerLeave = () => {
    setHoverPoint(null);
    setHoverNodeId(null);
  };

  const finishPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const input = createPointerInput(event);
    const transition = activeTool.onPointerUp(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
  };

  const cancelPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const input = createPointerInput(event);
    const transition = activeTool.onPointerCancel(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
  };

  const handleDoubleClick = (event: JSX.TargetedMouseEvent<SVGSVGElement>) => {
    if (!onInlineTextCommit) return;
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

  // Keep a single persistent keydown listener via ref + AbortController so pan/zoom/drag
  // never tear down and re-register window listeners on every animation frame.
  const toolKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  toolKeyDownRef.current = (event: KeyboardEvent) => {
    if (inlineTextEdit) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) {
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

  // Alt-Hover Spacing Redlines (Figma-grade + Artboard distance)
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

  // Live Path-Snap preview dot for Anchor Point (`+`) and Scissors (`C`)
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

  // Live Eyedropper Loupe sample
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

  // Idle Shape Builder hover face hit
  const shapeBuilderHoveredFace = useMemo(() => {
    if (toolId !== 'shape-builder' || toolSession || !shapeBuilderHoverArrangement || !hoverPoint) return null;
    return hitTestPlanarFace(shapeBuilderHoverArrangement, hoverPoint);
  }, [toolId, toolSession, shapeBuilderHoverArrangement, hoverPoint]);

  // Single-selection On-Canvas Smart Handles (Corner Radius & Star Inner Ratio)
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
          <span>{document.name}</span>
          <span>{document.width} × {document.height}</span>
        </div>
        <svg
          ref={svgRef}
          class="artboard"
          data-tool={toolId}
          data-workspace={workspace}
          style={{ cursor: toolCursor }}
          viewBox={'0 0 ' + document.width + ' ' + document.height}
          role="application"
          aria-label="Folio design artboard. Use the active Tool Rack tool to select, draw, edit vector paths, navigate, or inspect artwork."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
          onDblClick={handleDoubleClick}
        >
          <defs>
            <DocumentMaskDefs
              nodes={canvasNodes}
              width={document.width}
              height={document.height}
              components={components}
              maskPrefix={maskPrefix}
              nodeById={nodeById}
              clipMaskMap={clipMaskMap}
              componentById={componentById}
            />
            <pattern
              id={`${maskPrefix}-sb-merge`}
              width={10 * invZoom}
              height={10 * invZoom}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width={10 * invZoom} height={10 * invZoom} fill="rgba(56, 189, 248, 0.28)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2={10 * invZoom}
                stroke="rgba(255, 255, 255, 0.55)"
                stroke-width={2 * invZoom}
              />
            </pattern>
            <pattern
              id={`${maskPrefix}-sb-punch`}
              width={10 * invZoom}
              height={10 * invZoom}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-45)"
            >
              <rect width={10 * invZoom} height={10 * invZoom} fill="rgba(244, 63, 94, 0.34)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2={10 * invZoom}
                stroke="rgba(255, 255, 255, 0.55)"
                stroke-width={2 * invZoom}
              />
            </pattern>
          </defs>
          <rect x="0" y="0" width={document.width} height={document.height} fill={document.background} />
          {visibleRenderNodes.map((node) => (
            <MaskedNodeArtwork
              key={node.id}
              node={node}
              nodes={canvasNodes}
              components={components}
              maskPrefix={maskPrefix}
              clipMaskMap={clipMaskMap}
              componentById={componentById}
            />
          ))}

          {/* Live Alt+Drag Clone Ghost Preview */}
          {previewCreateNodes && previewCreateNodes.length > 0 && (
            <g class="canvas-clone-preview" opacity={0.84} pointer-events="none">
              {previewCreateNodes.map((node) => (
                <MaskedNodeArtwork
                  key={`clone-${node.id}`}
                  node={node}
                  nodes={[...canvasNodes, ...previewCreateNodes]}
                  components={components}
                  maskPrefix={maskPrefix}
                  clipMaskMap={clipMaskMap}
                  componentById={componentById}
                />
              ))}
            </g>
          )}

          {toolOverlay?.kind === 'marquee' && (
            <rect
              class="canvas-marquee"
              x={toolOverlay.bounds.x}
              y={toolOverlay.bounds.y}
              width={toolOverlay.bounds.width}
              height={toolOverlay.bounds.height}
              pointer-events="none"
            />
          )}
          {toolOverlay?.kind === 'lasso' && (
            <polyline
              class="canvas-lasso"
              points={toolOverlay.points.map((point) => point.x + ',' + point.y).join(' ')}
              pointer-events="none"
            />
          )}
          {toolOverlay?.kind === 'draw-preview' && (
            <g class="canvas-draw-preview" pointer-events="none">
              <g opacity={0.78}>
                <NodeShape node={toolOverlay.node as PrimitiveNode} />
              </g>
              <rect
                class="canvas-draw-preview-box"
                x={toolOverlay.node.x}
                y={toolOverlay.node.y}
                width={Math.max(1, toolOverlay.node.width)}
                height={Math.max(1, toolOverlay.node.height)}
              />
              <HudBadge x={toolOverlay.labelX} y={toolOverlay.labelY} text={toolOverlay.label} invZoom={invZoom} />
            </g>
          )}
          {toolOverlay?.kind === 'pen-draft' && (
            <g class="canvas-pen-draft" pointer-events="none">
              {toolOverlay.points.length >= 2 && (
                <path
                  class="canvas-pen-draft-path"
                  d={serializePathPointsToSvgD(toolOverlay.points, false)}
                />
              )}
              {toolOverlay.points.length >= 1 && (() => {
                const last = toolOverlay.points[toolOverlay.points.length - 1];
                const target = toolOverlay.hoverClose && toolOverlay.points.length >= 3
                  ? toolOverlay.points[0]
                  : toolOverlay.cursor;
                const rubberD = last.handleOut
                  ? `M ${last.x} ${last.y} C ${last.handleOut.x} ${last.handleOut.y} ${target.x} ${target.y} ${target.x} ${target.y}`
                  : `M ${last.x} ${last.y} L ${target.x} ${target.y}`;
                return <path class="canvas-pen-rubberband" d={rubberD} />;
              })()}
              {toolOverlay.points.map((pt, index) => (
                <g key={pt.id}>
                  {pt.handleIn && (
                    <>
                      <line class="canvas-bezier-tangent" x1={pt.x} y1={pt.y} x2={pt.handleIn.x} y2={pt.handleIn.y} />
                      <circle class="canvas-bezier-handle" cx={pt.handleIn.x} cy={pt.handleIn.y} r={3.6 * invZoom} />
                    </>
                  )}
                  {pt.handleOut && (
                    <>
                      <line class="canvas-bezier-tangent" x1={pt.x} y1={pt.y} x2={pt.handleOut.x} y2={pt.handleOut.y} />
                      <circle class="canvas-bezier-handle" cx={pt.handleOut.x} cy={pt.handleOut.y} r={3.6 * invZoom} />
                    </>
                  )}
                  {index === 0 && toolOverlay.hoverClose && (
                    <circle class="canvas-pen-close-ring" cx={pt.x} cy={pt.y} r={9 * invZoom} />
                  )}
                  <rect
                    class={'canvas-vector-anchor' + (index === 0 ? ' is-origin' : '')}
                    x={pt.x - 4 * invZoom}
                    y={pt.y - 4 * invZoom}
                    width={8 * invZoom}
                    height={8 * invZoom}
                    rx={1.5 * invZoom}
                  />
                </g>
              ))}
            </g>
          )}
          {toolOverlay?.kind === 'freehand' && toolOverlay.points.length >= 2 && (
            <polyline
              class={'canvas-freehand-preview is-' + toolOverlay.mode}
              points={toolOverlay.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
              pointer-events="none"
            />
          )}
          {toolOverlay?.kind === 'rotate-ring' && (
            <g class="canvas-rotate-overlay" pointer-events="none">
              <circle
                class="canvas-rotate-circle"
                cx={toolOverlay.center.x}
                cy={toolOverlay.center.y}
                r={toolOverlay.radius}
              />
              <line
                class="canvas-rotate-crosshair"
                x1={toolOverlay.center.x - 7 * invZoom}
                y1={toolOverlay.center.y}
                x2={toolOverlay.center.x + 7 * invZoom}
                y2={toolOverlay.center.y}
              />
              <line
                class="canvas-rotate-crosshair"
                x1={toolOverlay.center.x}
                y1={toolOverlay.center.y - 7 * invZoom}
                x2={toolOverlay.center.x}
                y2={toolOverlay.center.y + 7 * invZoom}
              />
              <HudBadge
                x={toolOverlay.center.x}
                y={toolOverlay.center.y - toolOverlay.radius - 16 * invZoom}
                text={`${toolOverlay.angleDeg}°`}
                variant="rotate"
                invZoom={invZoom}
              />
            </g>
          )}
          {toolOverlay?.kind === 'measure' && (
            <g class="canvas-measure-overlay" pointer-events="none">
              <line
                class="canvas-measure-guide"
                x1={toolOverlay.start.x}
                y1={toolOverlay.start.y}
                x2={toolOverlay.end.x}
                y2={toolOverlay.start.y}
              />
              <line
                class="canvas-measure-guide"
                x1={toolOverlay.end.x}
                y1={toolOverlay.start.y}
                x2={toolOverlay.end.x}
                y2={toolOverlay.end.y}
              />
              <line
                class="canvas-measure-line"
                x1={toolOverlay.start.x}
                y1={toolOverlay.start.y}
                x2={toolOverlay.end.x}
                y2={toolOverlay.end.y}
              />
              {toolOverlay.snappedStart && (
                <circle class="canvas-measure-snap-ring" cx={toolOverlay.start.x} cy={toolOverlay.start.y} r={6.5 * invZoom} />
              )}
              {toolOverlay.snappedEnd && (
                <circle class="canvas-measure-snap-ring" cx={toolOverlay.end.x} cy={toolOverlay.end.y} r={6.5 * invZoom} />
              )}
              <circle class="canvas-measure-dot" cx={toolOverlay.start.x} cy={toolOverlay.start.y} r={3.5 * invZoom} />
              <circle class="canvas-measure-dot" cx={toolOverlay.end.x} cy={toolOverlay.end.y} r={3.5 * invZoom} />
              <HudBadge
                x={(toolOverlay.start.x + toolOverlay.end.x) / 2}
                y={Math.min(toolOverlay.start.y, toolOverlay.end.y) - 18 * invZoom}
                text={`${toolOverlay.distance}px · ΔX ${toolOverlay.dx} · ΔY ${toolOverlay.dy} · ${toolOverlay.angleDeg}°`}
                variant="measure"
                invZoom={invZoom}
              />
            </g>
          )}

          {/* Interactive Shape Builder Overlay (Active Drag & Hover Decomposition) */}
          {toolOverlay?.kind === 'shape-builder' && (
            <g class="canvas-shape-builder-overlay" pointer-events="none">
              {toolOverlay.arrangement.faces.map((face) => {
                const isTouched = toolOverlay.touchedFaceIds.includes(face.id);
                const patternFill = isTouched
                  ? `url(#${maskPrefix}-sb-${toolOverlay.mode === 'punch' ? 'punch' : 'merge'})`
                  : undefined;
                return (
                  <path
                    key={`sb-face-${face.id}`}
                    class={
                      'canvas-sb-face' +
                      (isTouched ? (toolOverlay.mode === 'punch' ? ' is-punch' : ' is-merge') : '')
                    }
                    style={patternFill ? { fill: patternFill } : undefined}
                    d={planarFaceToSvgPath(face)}
                    fill-rule="evenodd"
                  />
                );
              })}
              {toolOverlay.strokePoints.length >= 2 && (
                <polyline
                  class={'canvas-sb-stroke' + (toolOverlay.mode === 'punch' ? ' is-punch' : ' is-merge')}
                  points={toolOverlay.strokePoints.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                />
              )}
              {toolOverlay.strokePoints.length > 0 && (() => {
                const tip = toolOverlay.strokePoints[toolOverlay.strokePoints.length - 1];
                return (
                  <HudBadge
                    x={tip.x}
                    y={tip.y - 20 * invZoom}
                    text={
                      toolOverlay.mode === 'punch'
                        ? `− Punch (${toolOverlay.touchedFaceIds.length})`
                        : `+ Merge (${toolOverlay.touchedFaceIds.length})`
                    }
                    variant={toolOverlay.mode === 'punch' ? 'measure' : 'default'}
                    invZoom={invZoom}
                  />
                );
              })()}
            </g>
          )}
          {toolId === 'shape-builder' && !toolSession && shapeBuilderHoverArrangement && (
            <g class="canvas-shape-builder-overlay" pointer-events="none">
              {shapeBuilderHoverArrangement.faces.map((face) => {
                const isHover = shapeBuilderHoveredFace?.id === face.id;
                const patternFill = isHover
                  ? `url(#${maskPrefix}-sb-${altHeld ? 'punch' : 'merge'})`
                  : undefined;
                return (
                  <path
                    key={`sb-idle-${face.id}`}
                    class={
                      'canvas-sb-face' +
                      (isHover ? (altHeld ? ' is-punch' : ' is-merge') : '')
                    }
                    style={patternFill ? { fill: patternFill } : undefined}
                    d={planarFaceToSvgPath(face)}
                    fill-rule="evenodd"
                  />
                );
              })}
              {shapeBuilderHoveredFace && (
                <g
                  class={'canvas-sb-glyph' + (altHeld ? ' is-punch' : ' is-merge')}
                  transform={`translate(${shapeBuilderHoveredFace.interiorPoint.x} ${shapeBuilderHoveredFace.interiorPoint.y}) scale(${invZoom})`}
                >
                  <circle r="11" />
                  <text x="0" y="1" text-anchor="middle" dominant-baseline="middle">
                    {altHeld ? '−' : '+'}
                  </text>
                </g>
              )}
            </g>
          )}

          {showSelectionBox && selectionBounds && (
            <SelectionOverlay
              bounds={selectionBounds}
              canResize={canResize && (toolId === 'select' || toolId === 'direct-selection' || toolId === 'scale')}
              canRotate={canResize && toolId === 'select'}
              isScaleTool={toolId === 'scale'}
              invZoom={invZoom}
            />
          )}

          {/* On-Canvas Smart Handles: Corner Radius Knobs (Rect/Frame) */}
          {smartHandleNode &&
            (smartHandleNode.type === 'rect' || smartHandleNode.type === 'frame') &&
            smartHandleNode.width >= 28 &&
            smartHandleNode.height >= 28 && (() => {
              const maxR = Math.min(smartHandleNode.width, smartHandleNode.height) / 2;
              const currentR = Math.max(0, Math.min(maxR, smartHandleNode.style.radius ?? 0));
              const inset = Math.min(maxR - 4 * invZoom, Math.max(11 * invZoom, currentR * 0.72 + 10 * invZoom));
              const cx = smartHandleNode.x + smartHandleNode.width / 2;
              const cy = smartHandleNode.y + smartHandleNode.height / 2;
              const rot = smartHandleNode.rotation ? `rotate(${smartHandleNode.rotation} ${cx} ${cy})` : undefined;
              const corners: Array<{ id: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number }> = [
                { id: 'nw', x: smartHandleNode.x + inset, y: smartHandleNode.y + inset },
                { id: 'ne', x: smartHandleNode.x + smartHandleNode.width - inset, y: smartHandleNode.y + inset },
                { id: 'se', x: smartHandleNode.x + smartHandleNode.width - inset, y: smartHandleNode.y + smartHandleNode.height - inset },
                { id: 'sw', x: smartHandleNode.x + inset, y: smartHandleNode.y + smartHandleNode.height - inset },
              ];
              return (
                <g class="canvas-smart-handles" transform={rot}>
                  {corners.map((corner) => (
                    <g
                      key={`cr-${corner.id}`}
                      class="canvas-smart-handle"
                      data-smart-handle="corner-radius"
                      data-smart-node-id={smartHandleNode.id}
                      data-smart-corner={corner.id}
                      pointer-events="all"
                    >
                      <circle class="canvas-smart-handle-hit" cx={corner.x} cy={corner.y} r={9 * invZoom} />
                      <circle class="canvas-smart-handle-ring" cx={corner.x} cy={corner.y} r={4.2 * invZoom} />
                      <circle class="canvas-smart-handle-dot" cx={corner.x} cy={corner.y} r={1.4 * invZoom} />
                    </g>
                  ))}
                </g>
              );
            })()}

          {/* On-Canvas Smart Handle: Star Inner-Ratio Diamond Handle */}
          {smartHandleNode &&
            smartHandleNode.type === 'path' &&
            smartHandleNode.shapeMeta?.kind === 'star' &&
            smartHandleNode.points.length >= 2 && (() => {
              const worldInner = nodeLocalPointToWorld(smartHandleNode, smartHandleNode.points[1]);
              const size = 7.8 * invZoom;
              return (
                <g
                  class="canvas-smart-handle is-star"
                  data-smart-handle="star-inner"
                  data-smart-node-id={smartHandleNode.id}
                  transform={`translate(${worldInner.x} ${worldInner.y})`}
                  pointer-events="all"
                >
                  <circle class="canvas-smart-handle-hit" cx="0" cy="0" r={10 * invZoom} />
                  <rect
                    class="canvas-smart-handle-diamond"
                    x={-size / 2}
                    y={-size / 2}
                    width={size}
                    height={size}
                    transform="rotate(45)"
                  />
                </g>
              );
            })()}

          {/* Draggable Custom Rotation Pivot Crosshair */}
          {pivotPoint && (
            <g
              class="canvas-pivot-handle"
              data-smart-handle="pivot"
              transform={`translate(${pivotPoint.x} ${pivotPoint.y})`}
              pointer-events="all"
            >
              <circle class="canvas-smart-handle-hit" cx="0" cy="0" r={12 * invZoom} />
              <circle class="canvas-pivot-ring" cx="0" cy="0" r={6.5 * invZoom} />
              <line class="canvas-pivot-tick" x1={-10 * invZoom} y1="0" x2={10 * invZoom} y2="0" />
              <line class="canvas-pivot-tick" x1="0" y1={-10 * invZoom} x2="0" y2={10 * invZoom} />
              <circle class="canvas-pivot-dot" cx="0" cy="0" r={2.2 * invZoom} />
            </g>
          )}

          {showVectorAnchors && (
            <VectorAnchorOverlay
              nodes={selectedPathNodes}
              interactive={vectorAnchorsInteractive}
              activeSession={toolSession}
              activeAnchor={activeAnchor}
              invZoom={invZoom}
            />
          )}

          {/* Alt-Hover Spacing Redlines */}
          {spacingRedlines && spacingRedlines.segments.length > 0 && (
            <g class="canvas-redlines" pointer-events="none">
              <rect
                class="canvas-redline-target"
                x={spacingRedlines.targetBounds.x}
                y={spacingRedlines.targetBounds.y}
                width={Math.max(1, spacingRedlines.targetBounds.width)}
                height={Math.max(1, spacingRedlines.targetBounds.height)}
              />
              {spacingRedlines.extensions.map((ext, i) => (
                <line
                  key={`ext-${i}`}
                  class="canvas-redline-ext"
                  x1={ext.x1}
                  y1={ext.y1}
                  x2={ext.x2}
                  y2={ext.y2}
                />
              ))}
              {spacingRedlines.segments.map((seg, i) => {
                const mx = (seg.x1 + seg.x2) / 2;
                const my = (seg.y1 + seg.y2) / 2;
                const label = `${seg.value}px`;
                const chipW = Math.max(30, label.length * 6.5 + 10);
                const tick = 3.5 * invZoom;
                return (
                  <g key={`red-${i}`}>
                    <line class="canvas-redline-line" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} />
                    {seg.orientation === 'horizontal' ? (
                      <>
                        <line class="canvas-redline-line" x1={seg.x1} y1={seg.y1 - tick} x2={seg.x1} y2={seg.y1 + tick} />
                        <line class="canvas-redline-line" x1={seg.x2} y1={seg.y2 - tick} x2={seg.x2} y2={seg.y2 + tick} />
                      </>
                    ) : (
                      <>
                        <line class="canvas-redline-line" x1={seg.x1 - tick} y1={seg.y1} x2={seg.x1 + tick} y2={seg.y1} />
                        <line class="canvas-redline-line" x1={seg.x2 - tick} y1={seg.y2} x2={seg.x2 + tick} y2={seg.y2} />
                      </>
                    )}
                    <g class="canvas-redline-chip" transform={`translate(${mx} ${my}) scale(${invZoom})`}>
                      <rect x={-chipW / 2} y="-9" width={chipW} height="18" rx="3" />
                      <text x="0" y="1" text-anchor="middle" dominant-baseline="middle">{label}</text>
                    </g>
                  </g>
                );
              })}
            </g>
          )}

          {/* Path-Snap Hover Dot (Anchor Point & Scissors) */}
          {pathSnapWorldPoint && (
            <g class="canvas-snap-indicator" pointer-events="none">
              <circle
                class="canvas-snap-ring"
                cx={pathSnapWorldPoint.x}
                cy={pathSnapWorldPoint.y}
                r={7 * invZoom}
              />
              <circle
                class="canvas-snap-dot"
                cx={pathSnapWorldPoint.x}
                cy={pathSnapWorldPoint.y}
                r={3.5 * invZoom}
              />
            </g>
          )}

          {/* Smart HUD Overlay (Corner Radius, Star Ratio, Clone, Pivot) */}
          {toolOverlay?.kind === 'smart-hud' && (
            <HudBadge
              x={toolOverlay.x}
              y={toolOverlay.y - 20 * invZoom}
              text={toolOverlay.text}
              variant={toolOverlay.variant ?? 'default'}
              invZoom={invZoom}
            />
          )}

          {/* Live Eyedropper Loupe */}
          {eyedropperLoupe && (
            <g
              class="canvas-eyedropper-loupe"
              transform={`translate(${eyedropperLoupe.x} ${eyedropperLoupe.y}) scale(${invZoom})`}
              pointer-events="none"
            >
              <g transform="translate(22 -26)">
                <rect class="canvas-loupe-card" x="-2" y="-16" width="112" height="32" rx="6" />
                <circle class="canvas-loupe-swatch" cx="14" cy="0" r="9.5" fill={eyedropperLoupe.color} />
                <text class="canvas-loupe-hex" x="30" y="-3" dominant-baseline="middle">
                  {eyedropperLoupe.color.toUpperCase().slice(0, 7)}
                </text>
                <text class="canvas-loupe-meta" x="30" y="9" dominant-baseline="middle">
                  {eyedropperLoupe.target} · {eyedropperLoupe.sourceName.slice(0, 9)}
                </text>
              </g>
            </g>
          )}

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
          {guides.map((guide, index) => (
            guide.axis === 'x'
              ? <line key={'guide-x-' + index} class="canvas-guide" x1={guide.position} x2={guide.position} y1="0" y2={document.height} />
              : <line key={'guide-y-' + index} class="canvas-guide" x1="0" x2={document.width} y1={guide.position} y2={guide.position} />
          ))}
        </svg>
      </div>
    </div>
  );
}
