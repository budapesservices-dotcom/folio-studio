import { useMemo } from 'preact/hooks';
import type { ComponentDefinition, DesignTokenCollection } from '../core/document/types';
import { resolveComponentDefaultNodes } from '../core/document/components';
import { getEffectiveLayerStates } from '../core/document/layers';
import { DocumentArtworkContent, sanitizeMaskIdSegment } from '../engines/canvas/artwork';
import { computeAutoLayoutNodes } from '../engines/layout/autoLayout';

/**
 * Renders a live, proportional SVG preview of a ComponentDefinition's document.
 * Uses the exact same contract resolution (Master -> Default Variants -> Default Slots -> Tokens),
 * Auto-Layout, artwork, group, and clipping-mask pipeline as the Canvas engine
 * with a thumbnail-scoped mask ID prefix so DOM mask IDs never collide.
 */
export function ComponentThumbnail({
  component,
  components = [],
  designTokens,
}: {
  component: ComponentDefinition;
  components?: ComponentDefinition[];
  designTokens?: DesignTokenCollection;
}) {
  const doc = component.document;

  const resolvedDoc = useMemo(() => {
    const resolvedNodes = resolveComponentDefaultNodes(component, designTokens);
    return { ...doc, nodes: resolvedNodes };
  }, [component, doc, designTokens]);

  const thumbnailGeometry = useMemo(() => {
    const laidOutNodes = computeAutoLayoutNodes(resolvedDoc.nodes, {
      breakpoint: 'desktop',
      tokens: designTokens,
      canvasWidth: resolvedDoc.width,
    });
    const visibleNodes = laidOutNodes.filter((node) => node.onCanvas !== false);
    const states = getEffectiveLayerStates(visibleNodes);
    const renderedLeaves = visibleNodes.filter((node) => node.type !== 'group' && states.get(node.id)?.visible);
    if (renderedLeaves.length === 0) return null;

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

    return {
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
      maskPrefix: `folio-thumb-mask-${sanitizeMaskIdSegment(component.id)}`,
    };
  }, [component.id, designTokens, resolvedDoc.nodes, resolvedDoc.width]);

  if (!thumbnailGeometry) {
    return (
      <span class="component-rack-thumbnail component-rack-thumbnail-empty" aria-hidden="true">
        <span class="component-rack-thumbnail-placeholder">Empty</span>
      </span>
    );
  }

  return (
    <span class="component-rack-thumbnail" aria-hidden="true">
      <svg
        class="component-rack-thumbnail-svg"
        viewBox={thumbnailGeometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        <DocumentArtworkContent
          document={resolvedDoc}
          components={components}
          maskPrefix={thumbnailGeometry.maskPrefix}
          tokens={designTokens}
        />
      </svg>
    </span>
  );
}
