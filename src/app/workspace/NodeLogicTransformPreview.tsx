import { useMemo, useRef, useState } from 'preact/hooks';
import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  LogicNode,
} from '../../core/document/types';
import { getEffectiveLayerStates, getLayerRenderOrder } from '../../core/document/layers';
import { DocumentArtworkContent } from '../../engines/canvas/artwork';
import { hitTestNodesAtPoint } from '../../engines/canvas/hitTest';
import {
  computeVisualTransformDelta,
  parseCssTransformForVisual,
  serializeVisualTransformToCss,
  type PrototypeNodeOverride,
} from '../../engines/prototype';
import { StudioIcon } from './StudioIcon';

export interface NodeLogicTransformPreviewProps {
  document: FolioDocument;
  components: ComponentDefinition[];
  assets?: readonly AssetReference[];
  tokens?: DesignTokenCollection;
  logicNode: LogicNode;
  ownerLabel: string;
  onUpdateNodeData: (nodeId: string, patch: Record<string, string | number | boolean | null>) => void;
  onClose: () => void;
}

interface DragSession {
  pointerId: number;
  targetNodeId: string;
  startDocX: number;
  startDocY: number;
  baseTranslateX: number;
  baseTranslateY: number;
}

function getSvgDocumentPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  docWidth: number,
  docHeight: number,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const scale = Math.min(rect.width / Math.max(1, docWidth), rect.height / Math.max(1, docHeight));
  const renderedW = docWidth * scale;
  const renderedH = docHeight * scale;
  const offsetX = (rect.width - renderedW) / 2;
  const offsetY = (rect.height - renderedH) / 2;
  return {
    x: (clientX - rect.left - offsetX) / Math.max(0.0001, scale),
    y: (clientY - rect.top - offsetY) / Math.max(0.0001, scale),
  };
}

/**
 * Lightweight contextual canvas preview rendered inside Node Logic Workspace when
 * the user clicks "Set in Canvas" on a Transform node.
 *
 * Reuses Folio's existing `DocumentArtworkContent` SVG renderer and `hitTestNodesAtPoint`
 * geometry engine directly — no duplicate canvas engine and no workspace switching.
 */
export function NodeLogicTransformPreview({
  document,
  components,
  assets = [],
  tokens,
  logicNode,
  ownerLabel,
  onUpdateNodeData,
  onClose,
}: NodeLogicTransformPreviewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draftCss, setDraftCss] = useState<string | null>(null);

  const rawTransform = typeof logicNode.data.transform === 'string' ? logicNode.data.transform : '';
  const activeCss = draftCss ?? rawTransform;
  const parsed = useMemo(() => parseCssTransformForVisual(activeCss), [activeCss]);

  const targetNodeId = typeof logicNode.data.targetNodeId === 'string' ? logicNode.data.targetNodeId : '';
  const targetNode: DesignNode | null = useMemo(
    () => document.nodes.find((node) => node.id === targetNodeId) ?? null,
    [document.nodes, targetNodeId],
  );

  const previewOverrides = useMemo<Readonly<Record<string, PrototypeNodeOverride>> | undefined>(() => {
    if (!targetNode || !activeCss.trim() || activeCss.trim().toLowerCase() === 'none') return undefined;
    return {
      [targetNode.id]: { transform: activeCss },
    };
  }, [targetNode, activeCss]);

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !svgRef.current) return;
    const svg = svgRef.current;
    const docPoint = getSvgDocumentPoint(svg, event.clientX, event.clientY, document.width, document.height);

    // Check if the user grabbed the currently targeted layer at its transformed position first.
    let pickedNode: DesignNode | null = null;
    if (targetNode) {
      const tx = parsed.values.translateX;
      const ty = parsed.values.translateY;
      const hitAtTranslated =
        docPoint.x >= targetNode.x + tx
        && docPoint.x <= targetNode.x + tx + targetNode.width
        && docPoint.y >= targetNode.y + ty
        && docPoint.y <= targetNode.y + ty + targetNode.height;
      if (hitAtTranslated) {
        pickedNode = targetNode;
      }
    }

    if (!pickedNode) {
      const ordered = getLayerRenderOrder(document.nodes.filter((n) => n.onCanvas !== false));
      const layerStates = getEffectiveLayerStates(ordered);
      const hitId = hitTestNodesAtPoint(ordered, docPoint, layerStates);
      const hit = hitId ? document.nodes.find((n) => n.id === hitId) ?? null : null;
      if (hit) {
        pickedNode = hit;
        if (hit.id !== targetNodeId) {
          onUpdateNodeData(logicNode.id, {
            targetMode: 'override',
            targetNodeId: hit.id,
          });
        }
      }
    }

    if (!pickedNode) return;

    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture?.(event.pointerId);

    const baseVals = pickedNode.id === targetNodeId
      ? parsed.values
      : parseCssTransformForVisual(rawTransform).values;

    dragRef.current = {
      pointerId: event.pointerId,
      targetNodeId: pickedNode.id,
      startDocX: docPoint.x,
      startDocY: docPoint.y,
      baseTranslateX: baseVals.translateX,
      baseTranslateY: baseVals.translateY,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId || !svgRef.current) return;
    event.preventDefault();
    const current = getSvgDocumentPoint(
      svgRef.current,
      event.clientX,
      event.clientY,
      document.width,
      document.height,
    );
    const delta = computeVisualTransformDelta(
      { x: session.startDocX, y: session.startDocY },
      current,
    );
    const nextValues = {
      ...parsed.values,
      translateX: Math.round((session.baseTranslateX + delta.translateX) * 10) / 10,
      translateY: Math.round((session.baseTranslateY + delta.translateY) * 10) / 10,
    };
    setDraftCss(serializeVisualTransformToCss(nextValues));
  };

  const finishDrag = (event: PointerEvent, commit: boolean) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    svgRef.current?.releasePointerCapture?.(event.pointerId);

    if (commit && draftCss !== null) {
      onUpdateNodeData(logicNode.id, {
        targetMode: 'override',
        targetNodeId: session.targetNodeId,
        transform: draftCss,
      });
    }
    setDraftCss(null);
  };

  const destX = targetNode ? Math.round((targetNode.x + parsed.values.translateX) * 10) / 10 : 0;
  const destY = targetNode ? Math.round((targetNode.y + parsed.values.translateY) * 10) / 10 : 0;

  return (
    <section
      class="nl-transform-preview-pane"
      aria-label="Visual Transform Canvas Preview"
      data-testid="nl-transform-preview-pane"
    >
      <div class="nl-transform-preview-header">
        <div class="nl-transform-preview-title">
          <StudioIcon name="canvas" />
          <span>Set in Canvas · {ownerLabel}</span>
        </div>
        <div class="nl-transform-preview-actions">
          <button
            type="button"
            class="nl-bar-btn"
            data-testid="nl-transform-preview-reset"
            title="Reset transform delta to 0"
            onClick={() => {
              setDraftCss(null);
              onUpdateNodeData(logicNode.id, { transform: 'scale(1)' });
            }}
          >
            Reset
          </button>
          <button
            type="button"
            class="nl-bar-btn is-accent"
            data-testid="nl-transform-preview-done"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>

      <div class="nl-transform-preview-meta nl-tabular" data-testid="nl-transform-preview-readout">
        {targetNode ? (
          <>
            <span>Target: <strong>{targetNode.name}</strong></span>
            <span>Start: {Math.round(targetNode.x)}, {Math.round(targetNode.y)}</span>
            <span>End: {destX}, {destY}</span>
            <span>Δ: {parsed.values.translateX}px, {parsed.values.translateY}px</span>
          </>
        ) : (
          <span>Click any layer on the preview below to pick a target, then drag it to its destination.</span>
        )}
      </div>

      <div class={`nl-transform-preview-stage${dragging ? ' is-dragging' : ''}`}>
        <svg
          ref={svgRef}
          class="nl-transform-preview-svg"
          data-testid="nl-transform-preview-svg"
          viewBox={`0 0 ${Math.max(1, document.width)} ${Math.max(1, document.height)}`}
          style={{ aspectRatio: `${Math.max(1, document.width)} / ${Math.max(1, document.height)}` }}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishDrag(event, true)}
          onPointerCancel={(event) => finishDrag(event, false)}
        >
          <DocumentArtworkContent
            document={document}
            components={components}
            assets={assets}
            maskPrefix={`nl-xform-${logicNode.id}`}
            tokens={tokens}
            nodeOverrides={previewOverrides}
          />
          {targetNode && (
            <g class="nl-transform-preview-guides" pointer-events="none">
              {/* Dashed outline at the original AST position */}
              <rect
                x={targetNode.x}
                y={targetNode.y}
                width={targetNode.width}
                height={targetNode.height}
                fill="none"
                stroke="#94A3B8"
                stroke-width={Math.max(1, Math.min(document.width, document.height) * 0.003)}
                stroke-dasharray="5 4"
                data-testid="nl-transform-ghost-origin"
              />
              {/* Vector connector arrow from original center to destination center */}
              {(parsed.values.translateX !== 0 || parsed.values.translateY !== 0) && (
                <line
                  x1={targetNode.x + targetNode.width / 2}
                  y1={targetNode.y + targetNode.height / 2}
                  x2={targetNode.x + targetNode.width / 2 + parsed.values.translateX}
                  y2={targetNode.y + targetNode.height / 2 + parsed.values.translateY}
                  stroke="#38BDF8"
                  stroke-width={Math.max(1.5, Math.min(document.width, document.height) * 0.004)}
                  stroke-dasharray="4 3"
                />
              )}
              {/* Highlight box at the transformed destination */}
              <rect
                x={targetNode.x + parsed.values.translateX}
                y={targetNode.y + parsed.values.translateY}
                width={targetNode.width}
                height={targetNode.height}
                fill="rgba(56, 189, 248, 0.08)"
                stroke="#38BDF8"
                stroke-width={Math.max(1.5, Math.min(document.width, document.height) * 0.004)}
                data-testid="nl-transform-target-box"
              />
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
