import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioDocument } from '../../core/document/types';
import { resolveComponentInstanceNodes } from '../../core/document/components';
import { getEffectiveLayerStates, getLayerRenderOrder, getLayerDescendantIds, getLayerClipMaskBaseIds } from '../../core/document/layers';
import { getBounds, type Bounds, type ResizeHandle, type SnapGuide } from './geometry';
import { getCanvasTool } from './tools/registry';
import type { CanvasToolContext, CanvasToolId, CanvasToolPointerInput, CanvasToolSession, CanvasToolTransition } from './tools/types';
import './canvas.css';

interface CanvasProps {
  document: FolioDocument;
  components?: ComponentDefinition[];
  selectedNodeIds: string[];
  toolId: CanvasToolId;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (nodeIds: string[]) => void;
  onTransformCommit: (nodes: DesignNode[]) => void;
  onLayerDrop: (nodeIds: string[]) => void;
}

interface PanSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPan: { x: number; y: number };
}

const HANDLE_SIZE = 10;

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

type PrimitiveNode = Exclude<DesignNode, ComponentInstanceNode>;

function NodeShape({ node, locked = node.locked, mask = false }: { node: PrimitiveNode; locked?: boolean; mask?: boolean }) {
  const transform = node.rotation
    ? 'rotate(' + node.rotation + ' ' + (node.x + node.width / 2) + ' ' + (node.y + node.height / 2) + ')'
    : undefined;

  return (
    <g transform={transform} opacity={node.opacity} class="canvas-node" >
      {node.type === 'group' && (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="transparent" pointerEvents="all" />
      )}
      {node.type === 'rect' && (
        <rect x={node.x} y={node.y} width={node.width} height={node.height}
          rx={node.style.radius ?? 0}
          fill={mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill}
          stroke={mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke} strokeWidth={node.style.strokeWidth} />
      )}
      {node.type === 'ellipse' && (
        <ellipse cx={node.x + node.width / 2} cy={node.y + node.height / 2}
          rx={node.width / 2} ry={node.height / 2}
          fill={mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill}
          stroke={mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke} strokeWidth={node.style.strokeWidth} />
      )}
      {node.type === 'text' && (
        <text x={node.x} y={node.y} fill={mask ? '#fff' : node.style.fill} fontSize={node.style.fontSize}
          fontFamily={node.style.fontFamily} fontWeight={node.style.fontWeight}
          letterSpacing={node.style.letterSpacing} dominantBaseline="hanging">
          {node.text.split('\\n').map((line, index) => (
            <tspan key={node.id + '-' + index} x={node.x} dy={index === 0 ? 0 : node.style.fontSize * node.style.lineHeight}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

function NodeArtwork({ node, components = [], locked = node.locked }: { node: DesignNode; components?: ComponentDefinition[]; locked?: boolean }) {
  if (node.type === 'component-instance') {
    const component = components.find((item) => item.id === node.componentId);
    const scaleX = component ? node.width / Math.max(1, component.document.width) : 1;
    const scaleY = component ? node.height / Math.max(1, component.document.height) : 1;
    const transform = node.rotation
      ? 'rotate(' + node.rotation + ' ' + (node.x + node.width / 2) + ' ' + (node.y + node.height / 2) + ')'
      : undefined;
    const resolvedChildren = component ? resolveComponentInstanceNodes(node, component) : [];
    const childStates = getEffectiveLayerStates(resolvedChildren);
    return (
      <g data-node-id={node.id} transform={transform} opacity={node.opacity} class="canvas-node component-instance-artwork">
        {component ? (
          <g transform={'translate(' + node.x + ' ' + node.y + ') scale(' + scaleX + ' ' + scaleY + ')'}>
            {getLayerRenderOrder(resolvedChildren).filter((child) => child.onCanvas !== false && childStates.get(child.id)?.visible).map((effective) => {
              const childState = childStates.get(effective.id);
              return effective.type === 'component-instance'
                ? null
                : <NodeShape key={effective.id} node={effective} locked={locked || Boolean(childState?.locked)} />;
            })}
          </g>
        ) : (
          <rect x={node.x} y={node.y} width={node.width} height={node.height}
            fill="none" stroke="#D45B5B" strokeDasharray="6 4" strokeWidth="2" />
        )}
      </g>
    );
  }

  return <g data-node-id={node.id}><NodeShape node={node as PrimitiveNode} locked={locked} /></g>;
}

/** Paint a base layer's alpha silhouette into an SVG mask. Group bases use their descendants. */
function ClipMaskArtwork({ node, nodes, components }: {
  node: DesignNode;
  nodes: DesignNode[];
  components: ComponentDefinition[];
}) {
  if (node.type === 'group') {
    const states = getEffectiveLayerStates(nodes);
    const descendants = [...getLayerDescendantIds(nodes, node.id)]
      .map((id) => nodes.find((item) => item.id === id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (descendants.length === 0) {
      return <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#fff" opacity={node.opacity} />;
    }
    return (
      <g>
        {descendants.map((child) => (
          <ClipMaskArtwork key={child.id} node={child} nodes={nodes} components={components} />
        ))}
      </g>
    );
  }

  if (node.type === 'component-instance') {
    const component = components.find((item) => item.id === node.componentId);
    if (!component) {
      const transform = node.rotation
        ? 'rotate(' + node.rotation + ' ' + (node.x + node.width / 2) + ' ' + (node.y + node.height / 2) + ')'
        : undefined;
      return <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#fff" opacity={node.opacity} transform={transform} />;
    }
    const scaleX = node.width / Math.max(1, component.document.width);
    const scaleY = node.height / Math.max(1, component.document.height);
    const transform = node.rotation
      ? 'rotate(' + node.rotation + ' ' + (node.x + node.width / 2) + ' ' + (node.y + node.height / 2) + ')'
      : undefined;
    const resolved = resolveComponentInstanceNodes(node, component);
    const states = getEffectiveLayerStates(resolved);
    return (
      <g transform={transform} opacity={node.opacity}>
        <g transform={'translate(' + node.x + ' ' + node.y + ') scale(' + scaleX + ' ' + scaleY + ')'}>
          {getLayerRenderOrder(resolved).filter((child) => child.type !== 'group' && states.get(child.id)?.visible).map((child) => (
            child.type === 'component-instance'
              ? <rect key={child.id} x={child.x} y={child.y} width={child.width} height={child.height} fill="#fff" opacity={child.opacity} />
              : <NodeShape key={child.id} node={child as PrimitiveNode} mask />
          ))}
        </g>
      </g>
    );
  }

  return <NodeShape node={node as PrimitiveNode} mask />;
}

function MaskedNodeArtwork({ node, nodes, components, locked }: {
  node: DesignNode;
  nodes: DesignNode[];
  components: ComponentDefinition[];
  locked: boolean;
}) {
  const maskIds = getLayerClipMaskBaseIds(nodes, node.id);
  return maskIds.reduceRight(
    (artwork, maskId) => <g mask={`url(#folio-mask-${maskId})`}>{artwork}</g>,
    <NodeArtwork node={node} components={components} locked={locked} />,
  );
}

function SelectionOverlay({ bounds, canResize }: { bounds: Bounds; canResize: boolean }) {
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

  return (
    <g class="canvas-selection" pointerEvents="none">
      <rect
        class="canvas-selection-outline"
        x={left}
        y={top}
        width={Math.max(1, bounds.width)}
        height={Math.max(1, bounds.height)}
      />
      {canResize && handles.map((handle) => (
        <rect
          key={handle.id}
          data-resize-handle={handle.id}
          class="canvas-resize-handle"
          x={handle.x - HANDLE_SIZE / 2}
          y={handle.y - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          rx="2"
          pointerEvents="all"
        />
      ))}
    </g>
  );
}

export function Canvas({
  document,
  components = [],
  selectedNodeIds,
  toolId,
  zoom,
  pan,
  onPanChange,
  onZoomChange,
  onSelectionChange,
  onTransformCommit,
  onLayerDrop,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<DesignNode[] | null>(null);
  const [previewNodes, setPreviewNodes] = useState<DesignNode[] | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const panRef = useRef<PanSession | null>(null);
  const [toolSession, setToolSession] = useState<CanvasToolSession | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
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
      setToolSession(null);
      previewRef.current = null;
      setPreviewNodes(null);
      setGuides([]);
      setIsPanning(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  const updatePreview = (nodes: DesignNode[] | null) => {
    previewRef.current = nodes;
    setPreviewNodes(nodes);
  };

  const displayedNodes = previewNodes
    ? document.nodes.map((node) => previewNodes.find((preview) => preview.id === node.id) ?? node)
    : document.nodes;
  const canvasNodes = displayedNodes.filter((node) => node.onCanvas !== false);

  // Locked layers may remain selected in the Layers panel, but only placed
  // nodes participate in Canvas selection, transforms and resize bounds.
  const layerStates = getEffectiveLayerStates(canvasNodes);
  const selectedSet = new Set(selectedNodeIds);
  const selectedNodes = canvasNodes.filter((node) => selectedSet.has(node.id)).filter((node) => {
    const effective = layerStates.get(node.id);
    return effective?.visible && !effective.locked;
  });
  const selectionBounds = getBounds(selectedNodes);
  const canResize = selectedNodes.length > 0;
  const selectableNodes = canvasNodes.filter((node) => {
    const effective = layerStates.get(node.id);
    return effective?.visible && !effective.locked;
  });
  const activeTool = getCanvasTool(toolId);

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
    session: toolSession,
  });

  const capturePointer = (svg: SVGSVGElement, pointerId: number) => {
    try {
      svg.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can fail when the browser cancels the initiating pointer.
    }
  };

  const handleWheel = (event: JSX.TargetedWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
    const deltaX = event.deltaX * unit * 0.55;
    const deltaY = event.deltaY * unit * 0.55;

    if (event.ctrlKey || event.metaKey) {
      const direction = deltaY > 0 ? -1 : 1;
      const nextZoom = Math.min(2, Math.max(0.35, Number((zoom * (direction > 0 ? 1.1 : 1 / 1.1)).toFixed(3))));
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
    if ('session' in transition) setToolSession(transition.session ?? null);
    if ('previewNodes' in transition) updatePreview(transition.previewNodes ?? null);
    if ('selection' in transition) onSelectionChange(transition.selection ?? []);
    if (transition.commitNodes) onTransformCommit(transition.commitNodes);
    if (transition.pan) onPanChange(transition.pan);
    if (transition.zoom !== undefined) onZoomChange(transition.zoom);
    if (transition.guides) setGuides(transition.guides);
    if (transition.capturePointer && svg && pointerId !== undefined) capturePointer(svg, pointerId);
    if (transition.preventDefault) sourceEvent?.preventDefault();
  };

  const handlePointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    if (spaceHeld) return;
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

  useEffect(() => {
    const handleToolKeyDown = (event: KeyboardEvent) => {
      const transition = getCanvasTool(toolId).onKeyDown({
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      }, createToolContext());
      applyToolTransition(transition);
    };
    window.addEventListener('keydown', handleToolKeyDown);
    return () => window.removeEventListener('keydown', handleToolKeyDown);
  }, [toolId, toolSession, selectedNodeIds, zoom, pan, document, previewNodes]);

  return (
    <div
      ref={scrollAreaRef}
      class={
        'canvas-scroll-area' +
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
          style={{ cursor: activeTool.cursorStyle(createToolContext()) }}
          viewBox={'0 0 ' + document.width + ' ' + document.height}
          role="application"
          aria-label="Folio design artboard. Use the active Tool Rack tool to select, navigate, or inspect artwork."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
        >
          <defs>
            {[...new Set(canvasNodes.flatMap((node) => getLayerClipMaskBaseIds(canvasNodes, node.id)))].map((baseId) => {
              const base = canvasNodes.find((node) => node.id === baseId);
              if (!base) return null;
              return (
                <mask
                  key={baseId}
                  id={'folio-mask-' + baseId}
                  maskUnits="userSpaceOnUse"
                  maskContentUnits="userSpaceOnUse"
                  x="0" y="0" width={document.width} height={document.height}
                >
                  <rect x="0" y="0" width={document.width} height={document.height} fill="#000" />
                  <ClipMaskArtwork node={base} nodes={canvasNodes} components={components} />
                </mask>
              );
            })}
          </defs>
          <rect x="0" y="0" width={document.width} height={document.height} fill={document.background} />
          {getLayerRenderOrder(canvasNodes).filter((node) => {
            const state = layerStates.get(node.id);
            if (!state?.visible) return false;
            return getLayerClipMaskBaseIds(canvasNodes, node.id).every((baseId) => layerStates.get(baseId)?.visible);
          }).map((node) => (
            <MaskedNodeArtwork
              key={node.id}
              node={node}
              nodes={canvasNodes}
              components={components}
              locked={Boolean(layerStates.get(node.id)?.locked)}
            />
          ))}
          {activeTool.renderOverlay(createToolContext())?.kind === 'marquee' && (() => {
            const overlay = activeTool.renderOverlay(createToolContext());
            return overlay?.kind === 'marquee' ? (
              <rect
                class="canvas-marquee"
                x={overlay.bounds.x}
                y={overlay.bounds.y}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                pointerEvents="none"
              />
            ) : null;
          })()}
          {activeTool.renderOverlay(createToolContext())?.kind === 'lasso' && (() => {
            const overlay = activeTool.renderOverlay(createToolContext());
            return overlay?.kind === 'lasso' ? (
              <polyline
                class="canvas-lasso"
                points={overlay.points.map((point) => point.x + ',' + point.y).join(' ')}
                pointerEvents="none"
              />
            ) : null;
          })()}
          {selectionBounds && (
            <SelectionOverlay
              bounds={selectionBounds}
              canResize={canResize && (toolId === 'select' || toolId === 'direct-selection')}
            />
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
