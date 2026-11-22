import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ComponentDefinition, DesignNode, FolioDocument, PathNode, TextNode } from '../../core/document/types';
import { buildLayerClipMaskMap, getEffectiveLayerStates, getLayerRenderOrder } from '../../core/document/layers';
import { serializePathPointsToSvgD } from '../../core/document/vector';
import { DocumentMaskDefs, MaskedNodeArtwork, NodeShape, sanitizeMaskIdSegment, type PrimitiveNode } from './artwork';
import { getBounds, type Bounds, type ResizeHandle, type SnapGuide } from './geometry';
import { getStudioTool } from './tools/studioRegistry';
import {
  DEFAULT_CANVAS_TOOL_OPTIONS,
  type CanvasToolContext,
  type CanvasToolId,
  type CanvasToolOptions,
  type CanvasToolPointerInput,
  type CanvasToolSession,
  type CanvasToolTransition,
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
  onSampledColor?: (color: string, sourceName: string) => void;
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

function SelectionOverlay({
  bounds,
  canResize,
  canRotate,
  isScaleTool,
}: {
  bounds: Bounds;
  canResize: boolean;
  canRotate: boolean;
  isScaleTool: boolean;
}) {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const middleX = left + bounds.width / 2;
  const middleY = top + bounds.height / 2;
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
    { id: 'rot-nw', x: left - ROTATE_ZONE_OFFSET, y: top - ROTATE_ZONE_OFFSET },
    { id: 'rot-ne', x: right + ROTATE_ZONE_OFFSET - ROTATE_ZONE_SIZE, y: top - ROTATE_ZONE_OFFSET },
    { id: 'rot-se', x: right + ROTATE_ZONE_OFFSET - ROTATE_ZONE_SIZE, y: bottom + ROTATE_ZONE_OFFSET - ROTATE_ZONE_SIZE },
    { id: 'rot-sw', x: left - ROTATE_ZONE_OFFSET, y: bottom + ROTATE_ZONE_OFFSET - ROTATE_ZONE_SIZE },
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
          width={ROTATE_ZONE_SIZE}
          height={ROTATE_ZONE_SIZE}
          rx="4"
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
          x={handle.x - HANDLE_SIZE / 2}
          y={handle.y - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          rx={isScaleTool ? '5' : '2'}
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
}: {
  nodes: PathNode[];
  interactive: boolean;
  activeSession: CanvasToolSession | null;
}) {
  if (nodes.length === 0) return null;
  const activeAnchor = activeSession?.kind === 'anchor-edit'
    ? { nodeId: activeSession.node.id, pointIndex: activeSession.pointIndex }
    : null;

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
                const isActive = activeAnchor?.nodeId === node.id && activeAnchor.pointIndex === index;
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
                          r={4.2}
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
                          r={4.2}
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
                        r={4.8}
                        data-anchor-node-id={interactive ? node.id : undefined}
                        data-anchor-index={interactive ? String(index) : undefined}
                        data-anchor-part={interactive ? 'anchor' : undefined}
                        pointer-events={interactive ? 'all' : 'none'}
                      />
                    ) : (
                      <rect
                        class={'canvas-vector-anchor' + (isActive ? ' is-active' : '')}
                        x={pt.x - 4.5}
                        y={pt.y - 4.5}
                        width={9}
                        height={9}
                        rx="1.5"
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

function HudBadge({ x, y, text, variant = 'default' }: { x: number; y: number; text: string; variant?: 'default' | 'measure' | 'rotate' }) {
  const width = Math.max(46, text.length * 6.8 + 16);
  const height = 22;
  return (
    <g class={`canvas-hud-badge is-${variant}`} transform={`translate(${x} ${y})`} pointer-events="none">
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
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const panRef = useRef<PanSession | null>(null);
  const toolSessionRef = useRef<CanvasToolSession | null>(null);
  const [toolSession, setToolSession] = useState<CanvasToolSession | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [inlineTextEdit, setInlineTextEdit] = useState<InlineTextEditState | null>(null);

  const updateToolSession = (next: CanvasToolSession | null) => {
    toolSessionRef.current = next;
    setToolSession(next);
  };

  // Clear in-progress tool sessions when switching tools or documents so no stale drafts leak.
  useEffect(() => {
    updateToolSession(null);
    previewRef.current = null;
    setPreviewNodes(null);
    setGuides([]);
    setInlineTextEdit(null);
  }, [toolId, document.id]);

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
      if (event.code === 'Space' && !isInteractiveTarget(event.target)) {
        setSpaceHeld(true);
        event.preventDefault();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const handleWindowBlur = () => {
      setSpaceHeld(false);
      panRef.current = null;
      updateToolSession(null);
      previewRef.current = null;
      setPreviewNodes(null);
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
    if (transition.createNodes && transition.createNodes.length > 0) {
      onCreateNodes?.(transition.createNodes);
    }
    if (transition.replaceNodeWithNodes) {
      onReplaceNodeWithNodes?.(transition.replaceNodeWithNodes.nodeId, transition.replaceNodeWithNodes.nodes);
    }
    if (transition.commitNodes) onTransformCommit(transition.commitNodes);
    if ('selection' in transition) onSelectionChange(transition.selection ?? []);
    if (transition.sampledColor) onSampledColor?.(transition.sampledColor.color, transition.sampledColor.sourceName);
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
    const transition = activeTool.onPointerMove(input, createToolContext());
    applyToolTransition(transition, event.currentTarget, event.pointerId, event);
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
  const showSelectionBox = Boolean(selectionBounds) && !(toolId === 'direct-selection' && selectedPathNodes.length === selectedNodes.length && selectedPathNodes.length > 0);

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
              <HudBadge x={toolOverlay.labelX} y={toolOverlay.labelY} text={toolOverlay.label} />
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
                      <circle class="canvas-bezier-handle" cx={pt.handleIn.x} cy={pt.handleIn.y} r="3.6" />
                    </>
                  )}
                  {pt.handleOut && (
                    <>
                      <line class="canvas-bezier-tangent" x1={pt.x} y1={pt.y} x2={pt.handleOut.x} y2={pt.handleOut.y} />
                      <circle class="canvas-bezier-handle" cx={pt.handleOut.x} cy={pt.handleOut.y} r="3.6" />
                    </>
                  )}
                  {index === 0 && toolOverlay.hoverClose && (
                    <circle class="canvas-pen-close-ring" cx={pt.x} cy={pt.y} r="9" />
                  )}
                  <rect
                    class={'canvas-vector-anchor' + (index === 0 ? ' is-origin' : '')}
                    x={pt.x - 4}
                    y={pt.y - 4}
                    width="8"
                    height="8"
                    rx="1.5"
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
                x1={toolOverlay.center.x - 7}
                y1={toolOverlay.center.y}
                x2={toolOverlay.center.x + 7}
                y2={toolOverlay.center.y}
              />
              <line
                class="canvas-rotate-crosshair"
                x1={toolOverlay.center.x}
                y1={toolOverlay.center.y - 7}
                x2={toolOverlay.center.x}
                y2={toolOverlay.center.y + 7}
              />
              <HudBadge
                x={toolOverlay.center.x}
                y={toolOverlay.center.y - toolOverlay.radius - 16}
                text={`${toolOverlay.angleDeg}°`}
                variant="rotate"
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
              <circle class="canvas-measure-dot" cx={toolOverlay.start.x} cy={toolOverlay.start.y} r="3.5" />
              <circle class="canvas-measure-dot" cx={toolOverlay.end.x} cy={toolOverlay.end.y} r="3.5" />
              <HudBadge
                x={(toolOverlay.start.x + toolOverlay.end.x) / 2}
                y={Math.min(toolOverlay.start.y, toolOverlay.end.y) - 18}
                text={`${toolOverlay.distance}px · ΔX ${toolOverlay.dx} · ΔY ${toolOverlay.dy} · ${toolOverlay.angleDeg}°`}
                variant="measure"
              />
            </g>
          )}
          {showSelectionBox && selectionBounds && (
            <SelectionOverlay
              bounds={selectionBounds}
              canResize={canResize && (toolId === 'select' || toolId === 'direct-selection' || toolId === 'scale')}
              canRotate={canResize && toolId === 'select'}
              isScaleTool={toolId === 'scale'}
            />
          )}
          {showVectorAnchors && (
            <VectorAnchorOverlay
              nodes={selectedPathNodes}
              interactive={vectorAnchorsInteractive}
              activeSession={toolSession}
            />
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
