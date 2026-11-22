import type { ComponentDefinition } from '../core/document/types';
import { getEffectiveLayerStates } from '../core/document/layers';
import { DocumentArtworkContent, sanitizeMaskIdSegment } from '../engines/canvas/artwork';

/**
 * Renders a live, proportional SVG preview of a ComponentDefinition's document.
 * Uses the same artwork, group, and clipping-mask pipeline as the Canvas engine
 * with a thumbnail-scoped mask ID prefix so DOM mask IDs never collide.
 */
export function ComponentThumbnail({
  component,
  components = [],
}: {
  component: ComponentDefinition;
  components?: ComponentDefinition[];
}) {
  const doc = component.document;
  const visibleNodes = doc.nodes.filter((node) => node.onCanvas !== false);
  const states = getEffectiveLayerStates(visibleNodes);
  const renderedLeaves = visibleNodes.filter((node) => node.type !== 'group' && states.get(node.id)?.visible);

  if (renderedLeaves.length === 0) {
    return (
      <span class="component-rack-thumbnail component-rack-thumbnail-empty" aria-hidden="true">
        <span class="component-rack-thumbnail-placeholder">Empty</span>
      </span>
    );
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of renderedLeaves) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + Math.max(1, node.width));
    maxY = Math.max(maxY, node.y + Math.max(1, node.height));
  }

  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const padding = Math.max(6, Math.round(Math.max(contentW, contentH) * 0.08));
  const vbX = Math.floor(minX - padding);
  const vbY = Math.floor(minY - padding);
  const vbW = Math.ceil(contentW + padding * 2);
  const vbH = Math.ceil(contentH + padding * 2);

  const maskPrefix = `folio-thumb-mask-${sanitizeMaskIdSegment(component.id)}`;

  return (
    <span class="component-rack-thumbnail" aria-hidden="true">
      <svg
        class="component-rack-thumbnail-svg"
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        <DocumentArtworkContent
          document={doc}
          components={components}
          maskPrefix={maskPrefix}
        />
      </svg>
    </span>
  );
}
