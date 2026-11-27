import type { DesignNode, MotionPathBinding } from '../../core/document/types';
import {
  evaluateMotionPathAtProgress,
  projectPointOntoMotionPath,
  sampleMotionPathChevrons,
  serializeMotionPathToSvgD,
} from '../../core/document/pathStudio';

export interface MotionPathPointSelection {
  readonly nodeId: string;
  readonly pointIndex: number;
}

interface MotionPathOverlayProps {
  motionPaths?: readonly MotionPathBinding[];
  canvasNodes: readonly DesignNode[];
  selectedNodeIds: readonly string[];
  selectedPoint?: MotionPathPointSelection | null;
  invZoom: number;
  interactive: boolean;
}

export function MotionPathOverlay({
  motionPaths,
  canvasNodes,
  selectedNodeIds,
  selectedPoint,
  invZoom,
  interactive,
}: MotionPathOverlayProps) {
  if (!motionPaths || motionPaths.length === 0) return null;

  const selectedIdSet = new Set(selectedNodeIds);
  const nodeById = new Map<string, DesignNode>();
  for (const node of canvasNodes) {
    nodeById.set(node.id, node);
  }

  const strokeWidth = 1.75 * invZoom;
  const backdropWidth = 3.5 * invZoom;
  const hitWidth = Math.max(12, 14 * invZoom);
  const anchorRadius = 4.6 * invZoom;
  const handleRadius = 3.2 * invZoom;
  const dashPattern = `${6 * invZoom} ${4 * invZoom}`;
  const offsetDash = `${3 * invZoom} ${3 * invZoom}`;

  return (
    <g class="canvas-motion-path-layer" data-testid="canvas-motion-path-overlay">
      {motionPaths.map((binding) => {
        if (binding.visible === false || binding.points.length < 2) return null;
        const d = serializeMotionPathToSvgD(binding.points, binding.closed);
        if (!d) return null;

        const isActive = selectedIdSet.has(binding.targetNodeId);
        const chevrons = sampleMotionPathChevrons(binding, isActive ? 7 : 4);
        const targetNode = nodeById.get(binding.targetNodeId);

        // Evaluate Start & End markers along the base curve (offsetPx = 0)
        const baseBinding: MotionPathBinding = {
          ...binding,
          offsetPx: 0,
          loopMode: 'none',
        };
        const startSample = evaluateMotionPathAtProgress(baseBinding, 0);
        const endSample = evaluateMotionPathAtProgress(baseBinding, 100);

        // Offset visual connector when offsetPx != 0
        let offsetConnector: { fromX: number; fromY: number; toX: number; toY: number } | null = null;
        if (targetNode && Math.abs(binding.offsetPx) > 0.5) {
          const cx = targetNode.x + targetNode.width / 2;
          const cy = targetNode.y + targetNode.height / 2;
          const proj = projectPointOntoMotionPath(binding, { x: cx, y: cy });
          if (proj) {
            offsetConnector = {
              fromX: proj.x,
              fromY: proj.y,
              toX: cx,
              toY: cy,
            };
          }
        }

        return (
          <g
            key={binding.id}
            class={`canvas-motion-path-group${isActive ? ' is-active' : ''}`}
            data-motion-path-id={binding.id}
            data-motion-path-target={binding.targetNodeId}
          >
            {/* High-contrast subtle backdrop under curve */}
            <path
              class="canvas-motion-path-backdrop"
              d={d}
              fill="none"
              strokeWidth={backdropWidth}
              pointer-events="none"
            />

            {/* Primary trajectory curve */}
            <path
              class={`canvas-motion-path-curve${isActive ? ' is-active' : ''}`}
              d={d}
              fill="none"
              strokeWidth={strokeWidth}
              strokeDasharray={dashPattern}
              pointer-events="none"
            />

            {/* Wide transparent hit target for Alt+Click / Double-Click point insertion */}
            {interactive && (
              <path
                class="canvas-motion-path-hit"
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={hitWidth}
                data-motion-path-curve="true"
                data-motion-path-node-id={binding.targetNodeId}
              />
            )}

            {/* Perpendicular Path Offset connector */}
            {offsetConnector && (
              <g pointer-events="none">
                <line
                  class="canvas-motion-path-offset-line"
                  x1={offsetConnector.fromX}
                  y1={offsetConnector.fromY}
                  x2={offsetConnector.toX}
                  y2={offsetConnector.toY}
                  strokeWidth={1.25 * invZoom}
                  strokeDasharray={offsetDash}
                />
                <circle
                  class="canvas-motion-path-offset-dot"
                  cx={offsetConnector.fromX}
                  cy={offsetConnector.fromY}
                  r={2.4 * invZoom}
                />
              </g>
            )}

            {/* Directional travel chevrons */}
            {chevrons.map((chev, idx) => (
              <g
                key={`chev-${idx}`}
                transform={`translate(${chev.x} ${chev.y}) rotate(${chev.angleDeg}) scale(${invZoom})`}
                pointer-events="none"
              >
                <path
                  class={`canvas-motion-path-chevron${isActive ? ' is-active' : ''}`}
                  d="M -3.5 -3 L 2.5 0 L -3.5 3"
                  fill="none"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}

            {/* Active Start / End range markers when Start > 0 or End < 100 */}
            {isActive &&
              startSample &&
              endSample &&
              (binding.startPct > 0.2 || binding.endPct < 99.8) && (
                <g pointer-events="none">
                  <circle
                    class="canvas-motion-path-range-dot is-start"
                    cx={startSample.x}
                    cy={startSample.y}
                    r={3.5 * invZoom}
                    strokeWidth={1.4 * invZoom}
                  />
                  <circle
                    class="canvas-motion-path-range-dot is-end"
                    cx={endSample.x}
                    cy={endSample.y}
                    r={3.5 * invZoom}
                    strokeWidth={1.4 * invZoom}
                  />
                </g>
              )}

            {/* Direct Path Editing: Bézier Handles & Anchor Points (when target layer is selected) */}
            {isActive && binding.points.map((pt, index) => {
              const isSelectedPoint =
                selectedPoint?.nodeId === binding.targetNodeId &&
                selectedPoint.pointIndex === index;
              const hasIn = Boolean(
                pt.handleIn &&
                  (Math.abs(pt.handleIn.x - pt.x) > 0.5 || Math.abs(pt.handleIn.y - pt.y) > 0.5),
              );
              const hasOut = Boolean(
                pt.handleOut &&
                  (Math.abs(pt.handleOut.x - pt.x) > 0.5 || Math.abs(pt.handleOut.y - pt.y) > 0.5),
              );
              const showHandles = interactive && (isSelectedPoint || pt.pointType !== 'corner' || hasIn || hasOut);
              const isStartAnchor = index === 0;
              const isEndAnchor = !binding.closed && index === binding.points.length - 1;

              return (
                <g key={`pt-${index}`} class="canvas-motion-path-point-group">
                  {showHandles && pt.handleIn && (
                    <g class="canvas-motion-path-handle-group">
                      <line
                        class="canvas-motion-path-handle-line"
                        x1={pt.x}
                        y1={pt.y}
                        x2={pt.handleIn.x}
                        y2={pt.handleIn.y}
                        strokeWidth={1.1 * invZoom}
                        pointer-events="none"
                      />
                      <circle
                        class={`canvas-motion-path-handle${isSelectedPoint ? ' is-selected' : ''}`}
                        cx={pt.handleIn.x}
                        cy={pt.handleIn.y}
                        r={handleRadius}
                        strokeWidth={1.25 * invZoom}
                        data-motion-path-handle="in"
                        data-motion-path-node-id={binding.targetNodeId}
                        data-motion-path-point-index={index}
                        data-testid={`motion-path-handle-in-${index}`}
                      />
                    </g>
                  )}

                  {showHandles && pt.handleOut && (
                    <g class="canvas-motion-path-handle-group">
                      <line
                        class="canvas-motion-path-handle-line"
                        x1={pt.x}
                        y1={pt.y}
                        x2={pt.handleOut.x}
                        y2={pt.handleOut.y}
                        strokeWidth={1.1 * invZoom}
                        pointer-events="none"
                      />
                      <circle
                        class={`canvas-motion-path-handle${isSelectedPoint ? ' is-selected' : ''}`}
                        cx={pt.handleOut.x}
                        cy={pt.handleOut.y}
                        r={handleRadius}
                        strokeWidth={1.25 * invZoom}
                        data-motion-path-handle="out"
                        data-motion-path-node-id={binding.targetNodeId}
                        data-motion-path-point-index={index}
                        data-testid={`motion-path-handle-out-${index}`}
                      />
                    </g>
                  )}

                  {/* Selected anchor halo */}
                  {isSelectedPoint && (
                    <circle
                      class="canvas-motion-path-anchor-ring"
                      cx={pt.x}
                      cy={pt.y}
                      r={anchorRadius + 3.2 * invZoom}
                      fill="none"
                      strokeWidth={1.5 * invZoom}
                      pointer-events="none"
                    />
                  )}

                  {/* Anchor point shape reflects pointType: square=corner, circle=smooth, diamond=symmetric */}
                  {pt.pointType === 'corner' ? (
                    <rect
                      class={`canvas-motion-path-anchor${isSelectedPoint ? ' is-selected' : ''}${isStartAnchor ? ' is-start' : ''}${isEndAnchor ? ' is-end' : ''}`}
                      x={pt.x - anchorRadius}
                      y={pt.y - anchorRadius}
                      width={anchorRadius * 2}
                      height={anchorRadius * 2}
                      strokeWidth={1.5 * invZoom}
                      data-motion-path-anchor="true"
                      data-motion-path-node-id={binding.targetNodeId}
                      data-motion-path-point-index={index}
                      data-point-type="corner"
                      data-testid={`motion-path-anchor-${index}`}
                    />
                  ) : pt.pointType === 'symmetric' ? (
                    <rect
                      class={`canvas-motion-path-anchor${isSelectedPoint ? ' is-selected' : ''}${isStartAnchor ? ' is-start' : ''}${isEndAnchor ? ' is-end' : ''}`}
                      x={pt.x - anchorRadius * 0.92}
                      y={pt.y - anchorRadius * 0.92}
                      width={anchorRadius * 1.84}
                      height={anchorRadius * 1.84}
                      transform={`rotate(45 ${pt.x} ${pt.y})`}
                      strokeWidth={1.5 * invZoom}
                      data-motion-path-anchor="true"
                      data-motion-path-node-id={binding.targetNodeId}
                      data-motion-path-point-index={index}
                      data-point-type="symmetric"
                      data-testid={`motion-path-anchor-${index}`}
                    />
                  ) : (
                    <circle
                      class={`canvas-motion-path-anchor${isSelectedPoint ? ' is-selected' : ''}${isStartAnchor ? ' is-start' : ''}${isEndAnchor ? ' is-end' : ''}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={anchorRadius}
                      strokeWidth={1.5 * invZoom}
                      data-motion-path-anchor="true"
                      data-motion-path-node-id={binding.targetNodeId}
                      data-motion-path-point-index={index}
                      data-point-type="smooth"
                      data-testid={`motion-path-anchor-${index}`}
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
