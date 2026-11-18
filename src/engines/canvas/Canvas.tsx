import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { DesignNode, FolioDocument } from '../../core/document/types';
import {
  getBounds,
  resizeNodes,
  snapTranslation,
  type Bounds,
  type ResizeHandle,
  type SnapGuide,
} from './geometry';
import './canvas.css';

interface CanvasProps {
  document: FolioDocument;
  selectedNodeIds: string[];
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (nodeIds: string[]) => void;
  onTransformCommit: (nodes: DesignNode[]) => void;
}

interface DragSession {
  pointerId: number;
  mode: 'move' | 'resize';
  start: { x: number; y: number };
  nodes: DesignNode[];
  bounds: Bounds;
  ids: string[];
  handle?: ResizeHandle;
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

function NodeArtwork({ node }: { node: DesignNode }) {
  const transform = node.rotation
    ? 'rotate(' + node.rotation + ' ' + (node.x + node.width / 2) + ' ' + (node.y + node.height / 2) + ')'
    : undefined;

  return (
    <g
      data-node-id={node.id}
      transform={transform}
      opacity={node.opacity}
      class="canvas-node"
      style={{ cursor: node.locked ? 'default' : 'grab' }}
    >
      {node.type === 'rect' && (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={node.style.radius ?? 0}
          fill={node.style.fill}
          stroke={node.style.stroke}
          strokeWidth={node.style.strokeWidth}
        />
      )}
      {node.type === 'ellipse' && (
        <ellipse
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          fill={node.style.fill}
          stroke={node.style.stroke}
          strokeWidth={node.style.strokeWidth}
        />
      )}
      {node.type === 'text' && (
        <text
          x={node.x}
          y={node.y}
          fill={node.style.fill}
          fontSize={node.style.fontSize}
          fontFamily={node.style.fontFamily}
          fontWeight={node.style.fontWeight}
          letterSpacing={node.style.letterSpacing}
          dominantBaseline="hanging"
        >
          {node.text.split('\n').map((line, index) => (
            <tspan key={node.id + '-' + index} x={node.x} dy={index === 0 ? 0 : node.style.fontSize * node.style.lineHeight}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )}
    </g>
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
  selectedNodeIds,
  zoom,
  pan,
  onPanChange,
  onZoomChange,
  onSelectionChange,
  onTransformCommit,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const previewRef = useRef<DesignNode[] | null>(null);
  const [previewNodes, setPreviewNodes] = useState<DesignNode[] | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const panRef = useRef<PanSession | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || target.matches('input, textarea, select, button, a, [role="button"]');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isInteractiveTarget(event.target)) return;
      setSpaceHeld(true);
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const handleWindowBlur = () => {
      setSpaceHeld(false);
      panRef.current = null;
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

  // Locked layers may remain selected in the Layers panel, but they never
  // participate in canvas group transforms or resize bounds.
  const selectedNodes = displayedNodes.filter(
    (node) => selectedNodeIds.includes(node.id) && node.visible && !node.locked,
  );
  const selectionBounds = getBounds(selectedNodes);
  const canResize = selectedNodes.length > 0;

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
      setPan((current) => ({
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      }));
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

  const handlePointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || spaceHeld) return;
    const svg = event.currentTarget;
    const target = event.target as Element;
    const handleElement = target.closest('[data-resize-handle]');
    const point = toCanvasPoint(svg, event.clientX, event.clientY);

    if (handleElement) {
      if (!canResize || !selectionBounds) return;
      const handle = handleElement.getAttribute('data-resize-handle') as ResizeHandle | null;
      if (!handle) return;
      dragRef.current = {
        pointerId: event.pointerId,
        mode: 'resize',
        start: point,
        nodes: selectedNodes,
        bounds: selectionBounds,
        ids: selectedNodes.map((node) => node.id),
        handle,
      };
      capturePointer(svg, event.pointerId);
      event.preventDefault();
      return;
    }

    const nodeElement = target.closest('[data-node-id]');
    const nodeId = nodeElement?.getAttribute('data-node-id') ?? null;

    if (!nodeId) {
      onSelectionChange([]);
      return;
    }

    const hitNode = document.nodes.find((node) => node.id === nodeId);
    if (!hitNode || !hitNode.visible || hitNode.locked) return;

    const modifier = event.shiftKey || event.ctrlKey || event.metaKey;
    const wasSelected = selectedNodeIds.includes(nodeId);
    const nextIds = modifier
      ? (wasSelected
        ? selectedNodeIds.filter((id) => id !== nodeId)
        : [...selectedNodeIds, nodeId])
      : (wasSelected ? selectedNodeIds : [nodeId]);

    onSelectionChange(nextIds);
    if (modifier && wasSelected) return;

    const movingNodes = document.nodes.filter((node) => nextIds.includes(node.id) && node.visible && !node.locked);
    if (movingNodes.length === 0) return;
    const bounds = getBounds(movingNodes);
    if (!bounds) return;

    dragRef.current = {
      pointerId: event.pointerId,
      mode: 'move',
      start: point,
      nodes: movingNodes,
      bounds,
      ids: movingNodes.map((node) => node.id),
    };
    capturePointer(svg, event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const point = toCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const dx = point.x - session.start.x;
    const dy = point.y - session.start.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.25) return;

    if (session.mode === 'move') {
      const scale = document.width / Math.max(1, event.currentTarget.clientWidth);
      const tolerance = 8 * scale;
      const otherNodes = document.nodes.filter(
        (node) => node.visible && !session.ids.includes(node.id),
      );
      const snapped = snapTranslation(
        session.nodes,
        dx,
        dy,
        { x: 0, y: 0, width: document.width, height: document.height },
        otherNodes,
        tolerance,
      );
      const updated = session.nodes.map((node) => ({
        ...node,
        x: node.x + snapped.dx,
        y: node.y + snapped.dy,
      }));
      updatePreview(updated);
      setGuides(snapped.guides);
    } else if (session.handle) {
      updatePreview(resizeNodes(session.nodes, session.bounds, session.handle, dx, dy));
      setGuides([]);
    }
  };

  const finishPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const preview = previewRef.current;
    const changed = Boolean(preview?.some((node) => {
      const original = session.nodes.find((item) => item.id === node.id);
      return original && (
        Math.abs(original.x - node.x) > 0.01 ||
        Math.abs(original.y - node.y) > 0.01 ||
        Math.abs(original.width - node.width) > 0.01 ||
        Math.abs(original.height - node.height) > 0.01 ||
        (original.type === 'text' && node.type === 'text' && Math.abs(original.style.fontSize - node.style.fontSize) > 0.01)
      );
    }));

    if (changed && preview) onTransformCommit(preview);
    dragRef.current = null;
    updatePreview(null);
    setGuides([]);
  };

  const cancelPointer = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragRef.current = null;
    updatePreview(null);
    setGuides([]);
  };

  return (
    <div
      class={
        'canvas-scroll-area' +
        (spaceHeld ? ' canvas-pan-ready' : '') +
        (isPanning ? ' canvas-panning' : '')
      }
      onWheel={handleWheel}
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
            transition: isPanning ? 'none' : 'transform 110ms ease-out',
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
          viewBox={'0 0 ' + document.width + ' ' + document.height}
          role="application"
          aria-label="Folio design artboard. Drag to move; Shift-click to select multiple layers."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
        >
          <rect x="0" y="0" width={document.width} height={document.height} fill={document.background} />
          {displayedNodes.filter((node) => node.visible).map((node) => (
            <NodeArtwork key={node.id} node={node} />
          ))}
          {selectionBounds && (
            <SelectionOverlay bounds={selectionBounds} canResize={canResize} />
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
