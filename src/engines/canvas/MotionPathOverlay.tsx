import type { JSX } from 'preact';
import type { DesignNode, MotionPathBinding } from '../../core/document/types';
import {
  evaluateMotionPathAtProgress,
  projectPointOntoMotionPath,
  sampleMotionPathChevrons,
  serializeMotionPathToSvgD,
} from '../../core/document/pathStudio';
import {
  extractMorphSnapshotFromNode,
  parsePathMorphSnapshot,
} from '../../core/document/pathMorph';

export interface MotionPathPointSelection {
  readonly nodeId: string;
  readonly pointIndex: number;
}

export interface MorphCorrespondenceMeta {
  readonly startOffset?: number;
  readonly reverse?: boolean;
}

interface MotionPathOverlayProps {
  motionPaths?: readonly MotionPathBinding[];
  canvasNodes: readonly DesignNode[];
  selectedNodeIds: readonly string[];
  selectedPoint?: MotionPathPointSelection | null;
  invZoom: number;
  interactive: boolean;
  showMorphCorrespondence?: boolean;
  morphCorrespondenceMetaByNodeId?: Readonly<Record<string, MorphCorrespondenceMeta>>;
}

function toNodeWorldPoint(
  node: DesignNode,
  localX: number,
  localY: number,
): { x: number; y: number } {
  const wx = node.x + localX;
  const wy = node.y + localY;
  const rot = node.rotation ?? 0;
  if (Math.abs(rot) < 0.01) {
    return { x: wx, y: wy };
  }
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

export function MotionPathOverlay({
  motionPaths,
  canvasNodes,
  selectedNodeIds,
  selectedPoint,
  invZoom,
  interactive,
  showMorphCorrespondence = false,
  morphCorrespondenceMetaByNodeId,
}: MotionPathOverlayProps) {
  const hasMotionPaths = Boolean(motionPaths && motionPaths.length > 0);
  if (!hasMotionPaths && !showMorphCorrespondence) return null;

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

  const morphCorrespondenceNodes = showMorphCorrespondence
    ? selectedNodeIds
        .map((id) => nodeById.get(id))
        .filter((node): node is DesignNode => Boolean(node))
        .map((node) => {
          const rawSnap = extractMorphSnapshotFromNode(node);
          const snap = rawSnap ? parsePathMorphSnapshot(rawSnap) : null;
          if (!snap || snap.points.length === 0) return null;
          const contours = [
            { points: snap.points, closed: snap.closed !== false },
            ...(snap.subpaths ?? []).map((sp) => ({
              points: sp.points,
              closed: sp.closed !== false,
            })),
          ];
          return { node, contours };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];

  return (
    <g class="canvas-motion-path-layer" data-testid="canvas-motion-path-overlay">
      {hasMotionPaths && (motionPaths ?? []).map((binding) => {
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

      {/* Live Canvas Shape Morph Point Correspondence Overlay */}
      {showMorphCorrespondence && morphCorrespondenceNodes.length > 0 && (
        <g
          class="canvas-morph-correspondence-layer"
          data-testid="canvas-morph-correspondence-overlay"
          pointer-events="none"
        >
          {morphCorrespondenceNodes.map(({ node, contours }) => {
            const corrMeta = morphCorrespondenceMetaByNodeId?.[node.id];
            const startOffset = corrMeta?.startOffset ?? 0;
            const isReversed = Boolean(corrMeta?.reverse);
            return (
            <g
              key={`morph-corr-${node.id}`}
              data-morph-corr-node={node.id}
              data-morph-start-offset={String(startOffset)}
              data-morph-reversed={isReversed ? 'true' : 'false'}
            >
              {contours.map((contour, cIdx) => {
                const pts = contour.points;
                if (pts.length === 0) return null;
                let worldPts = pts.map((pt) => toNodeWorldPoint(node, pt.x, pt.y));
                if (cIdx === 0 && worldPts.length >= 2) {
                  if (isReversed) {
                    worldPts = contour.closed
                      ? [worldPts[0], ...worldPts.slice(1).reverse()]
                      : [...worldPts].reverse();
                  }
                  if (contour.closed && startOffset !== 0) {
                    const n = worldPts.length;
                    const shift = ((Math.trunc(startOffset) % n) + n) % n;
                    if (shift > 0) {
                      worldPts = [...worldPts.slice(shift), ...worldPts.slice(0, shift)];
                    }
                  }
                }
                const step = worldPts.length > 32 ? Math.ceil(worldPts.length / 24) : 1;
                const badgeR = 7.2 * invZoom;
                const fontSize = 8.4 * invZoom;

                // Winding direction arrow from vertex #1 toward vertex #2
                let arrowEl: JSX.Element | null = null;
                if (worldPts.length >= 2) {
                  const p0 = worldPts[0];
                  const p1 = worldPts[1];
                  const dx = p1.x - p0.x;
                  const dy = p1.y - p0.y;
                  const len = Math.hypot(dx, dy);
                  if (len > 2) {
                    const ux = dx / len;
                    const uy = dy / len;
                    const startDist = Math.min(len * 0.25, badgeR + 2 * invZoom);
                    const endDist = Math.min(len * 0.72, startDist + 24 * invZoom);
                    const ax1 = p0.x + ux * startDist;
                    const ay1 = p0.y + uy * startDist;
                    const ax2 = p0.x + ux * endDist;
                    const ay2 = p0.y + uy * endDist;
                    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
                    arrowEl = (
                      <g key={`arrow-${cIdx}`}>
                        <line
                          class="canvas-morph-corr-arrow"
                          x1={ax1}
                          y1={ay1}
                          x2={ax2}
                          y2={ay2}
                          strokeWidth={2 * invZoom}
                          strokeLinecap="round"
                        />
                        <g transform={`translate(${ax2} ${ay2}) rotate(${angleDeg}) scale(${invZoom})`}>
                          <path
                            class="canvas-morph-corr-arrow"
                            d="M -4 -3 L 2 0 L -4 3"
                            fill="none"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </g>
                      </g>
                    );
                  }
                }

                return (
                  <g key={`contour-${cIdx}`}>
                    {arrowEl}
                    {worldPts.map((wp, vIdx) => {
                      const isStart = vIdx === 0;
                      const isLast = vIdx === worldPts.length - 1;
                      if (!isStart && !isLast && vIdx % step !== 0) return null;
                      return (
                        <g
                          key={`v-${cIdx}-${vIdx}`}
                          data-testid={
                            cIdx === 0 && isStart
                              ? 'morph-corr-start-vertex'
                              : `morph-corr-vertex-${cIdx}-${vIdx + 1}`
                          }
                        >
                          {isStart && (
                            <circle
                              class="canvas-morph-corr-start-ring"
                              cx={wp.x}
                              cy={wp.y}
                              r={badgeR + 3.2 * invZoom}
                              fill="none"
                              strokeWidth={1.6 * invZoom}
                            />
                          )}
                          <circle
                            class={`canvas-morph-corr-badge${isStart ? ' is-start' : ''}`}
                            cx={wp.x}
                            cy={wp.y}
                            r={badgeR}
                            strokeWidth={1.35 * invZoom}
                          />
                          <text
                            class={`canvas-morph-corr-label${isStart ? ' is-start' : ''}`}
                            x={wp.x}
                            y={wp.y}
                            fontSize={fontSize}
                            textAnchor="middle"
                            dominantBaseline="central"
                          >
                            {vIdx + 1}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
            );
          })}
        </g>
      )}
    </g>
  );
}
