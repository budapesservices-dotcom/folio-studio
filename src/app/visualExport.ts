import type {
  AssetReference,
  BreakpointId,
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  DesignTokenCollection,
  FillPaint,
  FolioDocument,
  FrameNode,
  ImageFitMode,
  ImageNode,
  PathNode,
} from '../core/document/types';
import { resolveComponentInstanceNodes } from '../core/document/components';
import {
  buildSvgFilterId,
  buildSvgPaintId,
  getBackdropBlurRadius,
  getVisibleFillPaints,
  hasSvgFilterEffects,
  sanitizeStyleColor,
  serializeNodeSvgStyleDefs,
} from '../core/document/styling';
import { getSvgTextAnchorAndX, wrapTextLines } from '../core/document/typography';
import { serializePathPointsToSvgD } from '../core/document/vector';
import { resolveAssetDisplayUrl } from '../core/persistence/assetStore';
import {
  buildFrameClipAncestorMap,
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerDescendantIds,
  getLayerRenderOrder,
} from '../core/document/layers';
import { computeAutoLayoutNodes, getBreakpointCanvasWidth } from '../engines/layout/autoLayout';

type PrimitiveNode = Exclude<DesignNode, ComponentInstanceNode>;

const MAX_COMPONENT_RECURSION_DEPTH = 16;

export interface VisualExportOptions {
  title?: string;
  designTokens?: DesignTokenCollection;
  breakpoint?: BreakpointId;
  assets?: readonly AssetReference[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeIdSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function maskId(prefix: string, baseId: string): string {
  return `${prefix}--mask--${sanitizeIdSegment(baseId)}`;
}

function frameClipId(prefix: string, frameId: string): string {
  return `${prefix}--clip--${sanitizeIdSegment(frameId)}`;
}

function imageClipId(prefix: string, imageId: string): string {
  return `${prefix}--imgclip--${sanitizeIdSegment(imageId)}`;
}

function imageFitToPreserveAspectRatio(fit: ImageFitMode): string {
  if (fit === 'contain') return 'xMidYMid meet';
  if (fit === 'fill') return 'none';
  return 'xMidYMid slice';
}

function formatRotationTransform(node: Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>): string {
  if (!node.rotation) return '';
  const cx = Math.round((node.x + node.width / 2) * 100) / 100;
  const cy = Math.round((node.y + node.height / 2) * 100) / 100;
  return ` transform="rotate(${node.rotation} ${cx} ${cy})"`;
}

function buildArrowheadPolygon(
  tip: { x: number; y: number },
  from: { x: number; y: number },
  size: number,
): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return '';
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const backX = tip.x - ux * size;
  const backY = tip.y - uy * size;
  const wing = size * 0.48;
  return `${tip.x},${tip.y} ${backX + px * wing},${backY + py * wing} ${backX - px * wing},${backY - py * wing}`;
}

function serializeArrowheads(node: PathNode, mask: boolean): string {
  if (node.closed || node.points.length < 2) return '';
  if (!node.style.arrowStart && !node.style.arrowEnd) return '';
  const color = mask
    ? '#fff'
    : (node.style.stroke !== 'none' && node.style.stroke !== '#00000000' ? node.style.stroke : node.style.fill);
  if (!color || color === 'none') return '';
  const size = Math.max(10, Math.min(28, (node.style.strokeWidth || 2) * 3.8));
  const parts: string[] = [];
  if (node.style.arrowEnd) {
    const tip = node.points[node.points.length - 1];
    const prev = tip.handleIn ?? node.points[node.points.length - 2];
    const pts = buildArrowheadPolygon(tip, prev, size);
    if (pts) parts.push(`<polygon points="${escapeXml(pts)}" fill="${escapeXml(color)}" />`);
  }
  if (node.style.arrowStart) {
    const tip = node.points[0];
    const next = tip.handleOut ?? node.points[1];
    const pts = buildArrowheadPolygon(tip, next, size);
    if (pts) parts.push(`<polygon points="${escapeXml(pts)}" fill="${escapeXml(color)}" />`);
  }
  return parts.join('');
}

function serializePaintFillAttr(
  paint: FillPaint,
  nodeId: string,
  index: number,
  prefix: string,
): string {
  const opacity = paint.opacity ?? 1;
  const opacityAttr = opacity < 1 ? ` fill-opacity="${opacity}"` : '';
  if (paint.type === 'solid') {
    return ` fill="${escapeXml(sanitizeStyleColor(paint.color))}"${opacityAttr}`;
  }
  return ` fill="url(#${buildSvgPaintId(prefix, nodeId, index)})"${opacityAttr}`;
}

function serializeBackdropBlur(
  node: PrimitiveNode,
  mask: boolean,
  radius: number,
  isEllipse = false,
): string {
  if (mask) return '';
  const blurRadius = getBackdropBlurRadius(node);
  if (blurRadius <= 0 || node.width <= 0 || node.height <= 0) return '';
  const borderRadius = isEllipse ? '50%' : `${radius}px`;
  return `<foreignObject x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;border-radius:${borderRadius};backdrop-filter:blur(${blurRadius}px);-webkit-backdrop-filter:blur(${blurRadius}px);background:transparent;"></div></foreignObject>`;
}

function serializePrimitiveNode(
  node: PrimitiveNode,
  mask: boolean,
  prefix: string,
  assetById: ReadonlyMap<string, AssetReference>,
): string {
  if (node.type === 'group') return '';
  const transformAttr = formatRotationTransform(node);
  const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';
  const filterAttr = !mask && hasSvgFilterEffects(node)
    ? ` filter="url(#${buildSvgFilterId(prefix, node.id)})"`
    : '';
  const blendAttr = !mask && node.blendMode && node.blendMode !== 'normal'
    ? ` style="mix-blend-mode:${node.blendMode}"`
    : '';

  let inner = '';
  if (node.type === 'frame' || node.type === 'rect') {
    const fills = getVisibleFillPaints(node);
    const rx = node.style.radius ?? 0;
    const rxAttr = rx ? ` rx="${rx}"` : '';
    const dashAttr = node.type === 'frame' && node.isSection && !mask ? ' stroke-dasharray="6 4"' : '';
    const backdrop = serializeBackdropBlur(node, mask, rx);
    if (mask || fills.length <= 1) {
      const fillAttr = mask
        ? ` fill="${node.style.fill === 'none' && fills.length === 0 ? 'none' : '#fff'}"`
        : fills.length === 1
          ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
          : ' fill="none"';
      const stroke = mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke;
      inner = `${backdrop}<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rxAttr}${fillAttr} stroke="${escapeXml(stroke)}" stroke-width="${node.style.strokeWidth}"${dashAttr} />`;
    } else {
      const fillRects = fills
        .map((paint, idx) => `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rxAttr}${serializePaintFillAttr(paint, node.id, idx, prefix)} stroke="none" />`)
        .join('');
      const strokeRect = node.style.strokeWidth > 0 && node.style.stroke !== 'none'
        ? `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rxAttr} fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth}"${dashAttr} />`
        : '';
      inner = `${backdrop}${fillRects}${strokeRect}`;
    }
  } else if (node.type === 'ellipse') {
    const fills = getVisibleFillPaints(node);
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const backdrop = serializeBackdropBlur(node, mask, 0, true);
    if (mask || fills.length <= 1) {
      const fillAttr = mask
        ? ` fill="${node.style.fill === 'none' && fills.length === 0 ? 'none' : '#fff'}"`
        : fills.length === 1
          ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
          : ' fill="none"';
      const stroke = mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke;
      inner = `${backdrop}<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}"${fillAttr} stroke="${escapeXml(stroke)}" stroke-width="${node.style.strokeWidth}" />`;
    } else {
      const fillEllipses = fills
        .map((paint, idx) => `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}"${serializePaintFillAttr(paint, node.id, idx, prefix)} stroke="none" />`)
        .join('');
      const strokeEllipse = node.style.strokeWidth > 0 && node.style.stroke !== 'none'
        ? `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}" fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth}" />`
        : '';
      inner = `${backdrop}${fillEllipses}${strokeEllipse}`;
    }
  } else if (node.type === 'path') {
    const pathD = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
    const fills = getVisibleFillPaints(node);
    const fillRule = node.style.fillRule ?? 'nonzero';
    const linecap = node.style.strokeLinecap ?? 'round';
    const linejoin = node.style.strokeLinejoin ?? 'round';
    const dashAttr = node.style.strokeDasharray ? ` stroke-dasharray="${escapeXml(node.style.strokeDasharray)}"` : '';
    const arrows = serializeArrowheads(node, mask);
    if (mask || fills.length <= 1) {
      const fillAttr = mask
        ? ` fill="${node.style.fill === 'none' && fills.length === 0 ? 'none' : '#fff'}"`
        : fills.length === 1
          ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
          : ' fill="none"';
      const stroke = mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke;
      inner = `<g transform="translate(${node.x} ${node.y})"><path d="${escapeXml(pathD)}"${fillAttr} fill-rule="${fillRule}" stroke="${escapeXml(stroke)}" stroke-width="${node.style.strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />${arrows}</g>`;
    } else {
      const fillPaths = fills
        .map((paint, idx) => `<path d="${escapeXml(pathD)}"${serializePaintFillAttr(paint, node.id, idx, prefix)} fill-rule="${fillRule}" stroke="none" />`)
        .join('');
      const strokePath = node.style.strokeWidth > 0 && node.style.stroke !== 'none'
        ? `<path d="${escapeXml(pathD)}" fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`
        : '';
      inner = `<g transform="translate(${node.x} ${node.y})">${fillPaths}${strokePath}${arrows}</g>`;
    }
  } else if (node.type === 'text') {
    const fill = mask ? '#fff' : node.style.fill;
    const lines = wrapTextLines(node.text, {
      maxWidth: node.width,
      fontSize: node.style.fontSize,
      fontFamily: node.style.fontFamily,
      fontWeight: node.style.fontWeight,
      letterSpacing: node.style.letterSpacing,
      textWrap: node.style.textWrap,
      textTransform: node.style.textTransform,
    });
    const { anchor, xPos } = getSvgTextAnchorAndX(node.x, node.width, node.style.textAlign);
    const decorationAttr = node.style.textDecoration && node.style.textDecoration !== 'none'
      ? ` text-decoration="${node.style.textDecoration}"`
      : '';
    const tspans = lines
      .map((line, index) => {
        const dy = index === 0 ? 0 : node.style.fontSize * node.style.lineHeight;
        return `<tspan x="${xPos}" dy="${dy}">${escapeXml(line || ' ')}</tspan>`;
      })
      .join('');
    inner = `<text x="${xPos}" y="${node.y}" fill="${escapeXml(fill)}" font-size="${node.style.fontSize}" font-family="${escapeXml(node.style.fontFamily)}" font-weight="${node.style.fontWeight}" letter-spacing="${node.style.letterSpacing}" text-anchor="${anchor}"${decorationAttr} dominant-baseline="hanging">${tspans}</text>`;
  } else if (node.type === 'image') {
    const imgNode = node as ImageNode;
    const rx = imgNode.style.radius ?? 0;
    const rxAttr = rx ? ` rx="${rx}"` : '';
    if (mask) {
      inner = `<rect x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}"${rxAttr} fill="#fff" />`;
    } else {
      const asset = assetById.get(imgNode.assetId);
      const href = resolveAssetDisplayUrl(asset);
      const clipAttr = rx > 0 ? ` clip-path="url(#${imageClipId(prefix, imgNode.id)})"` : '';
      const imgMarkup = href
        ? `<image href="${escapeXml(href)}" x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}" preserveAspectRatio="${imageFitToPreserveAspectRatio(imgNode.style.fit)}"${clipAttr} />`
        : `<rect x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}"${rxAttr} fill="#1E2534" stroke="#4B5A78" stroke-width="1.5" stroke-dasharray="6 4" />`;
      const strokeMarkup = imgNode.style.stroke && imgNode.style.stroke !== 'none' && (imgNode.style.strokeWidth ?? 0) > 0
        ? `<rect x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}"${rxAttr} fill="none" stroke="${escapeXml(imgNode.style.stroke)}" stroke-width="${imgNode.style.strokeWidth}" />`
        : '';
      inner = `${imgMarkup}${strokeMarkup}`;
    }
  }

  return `<g${transformAttr}${opacityAttr}${filterAttr}${blendAttr}>${inner}</g>`;
}

function serializeClipMaskArtwork(
  node: DesignNode,
  nodes: readonly DesignNode[],
  componentById: ReadonlyMap<string, ComponentDefinition>,
  assetById: ReadonlyMap<string, AssetReference>,
  prefix: string,
  nodeById: ReadonlyMap<string, DesignNode>,
  tokens: DesignTokenCollection | undefined,
  visitedComponentIds: ReadonlySet<string>,
  depth: number,
): string {
  if (node.type === 'group') {
    const states = getEffectiveLayerStates(nodes);
    const descendants = [...getLayerDescendantIds(nodes, node.id)]
      .map((id) => nodeById.get(id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (descendants.length === 0) {
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#fff" opacity="${node.opacity}" />`;
    }
    return `<g>${descendants.map((child) => serializeClipMaskArtwork(child, nodes, componentById, assetById, prefix, nodeById, tokens, visitedComponentIds, depth)).join('')}</g>`;
  }

  if (node.type === 'component-instance') {
    const component = componentById.get(node.componentId);
    if (!component || visitedComponentIds.has(node.componentId) || depth >= MAX_COMPONENT_RECURSION_DEPTH) {
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#fff" opacity="${node.opacity}"${formatRotationTransform(node)} />`;
    }
    const scaleX = node.width / Math.max(1, component.document.width);
    const scaleY = node.height / Math.max(1, component.document.height);
    const resolvedRaw = resolveComponentInstanceNodes(node, component, tokens);
    const laidOut = computeAutoLayoutNodes(resolvedRaw, {
      breakpoint: 'desktop',
      tokens,
      canvasWidth: component.document.width,
    });
    const resolved = laidOut.filter((child) => child.onCanvas !== false);
    const childPrefix = `${prefix}-instmask-${sanitizeIdSegment(node.id)}`;
    const nextVisited = new Set(visitedComponentIds);
    nextVisited.add(node.componentId);
    const content = serializeNodesBlock(
      resolved,
      component.document.width,
      component.document.height,
      componentById,
      assetById,
      childPrefix,
      true,
      tokens,
      nextVisited,
      depth + 1,
    );
    return `<g${formatRotationTransform(node)} opacity="${node.opacity}"><g transform="translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})">${content}</g></g>`;
  }

  return serializePrimitiveNode(node, true, prefix, assetById);
}

function serializeDefs(
  nodes: readonly DesignNode[],
  width: number,
  height: number,
  componentById: ReadonlyMap<string, ComponentDefinition>,
  assetById: ReadonlyMap<string, AssetReference>,
  prefix: string,
  nodeById: ReadonlyMap<string, DesignNode>,
  clipMaskMap: ReadonlyMap<string, string[]>,
  frameClipMap: ReadonlyMap<string, string[]>,
  mask: boolean,
  tokens: DesignTokenCollection | undefined,
  visitedComponentIds: ReadonlySet<string>,
  depth: number,
): string {
  const referencedMasks = new Set<string>();
  const referencedFrames = new Set<string>();
  const defsParts: string[] = [];

  for (const node of nodes) {
    for (const baseId of clipMaskMap.get(node.id) ?? []) referencedMasks.add(baseId);
    for (const fId of frameClipMap.get(node.id) ?? []) referencedFrames.add(fId);

    if (!mask) {
      const styleDefs = serializeNodeSvgStyleDefs(node, prefix);
      if (styleDefs) defsParts.push(styleDefs);
      if (node.type === 'image' && (node.style.radius ?? 0) > 0) {
        defsParts.push(
          `<clipPath id="${imageClipId(prefix, node.id)}" clipPathUnits="userSpaceOnUse"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.style.radius ?? 0}" /></clipPath>`,
        );
      }
    }
  }

  for (const baseId of referencedMasks) {
    const base = nodeById.get(baseId);
    if (!base) continue;
    const artwork = serializeClipMaskArtwork(base, nodes, componentById, assetById, prefix, nodeById, tokens, visitedComponentIds, depth);
    defsParts.push(
      `<mask id="${maskId(prefix, baseId)}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#000" />${artwork}</mask>`,
    );
  }

  for (const fId of referencedFrames) {
    const frame = nodeById.get(fId);
    if (!frame || frame.type !== 'frame') continue;
    const frameNode = frame as FrameNode;
    const rxAttr = frameNode.style.radius ? ` rx="${frameNode.style.radius}"` : '';
    const transformAttr = formatRotationTransform(frameNode);
    defsParts.push(
      `<clipPath id="${frameClipId(prefix, fId)}" clipPathUnits="userSpaceOnUse"><rect x="${frameNode.x}" y="${frameNode.y}" width="${frameNode.width}" height="${frameNode.height}"${rxAttr}${transformAttr} /></clipPath>`,
    );
  }

  return defsParts.length > 0 ? `<defs>${defsParts.join('')}</defs>` : '';
}

function serializeNodesBlock(
  canvasNodes: readonly DesignNode[],
  width: number,
  height: number,
  componentById: ReadonlyMap<string, ComponentDefinition>,
  assetById: ReadonlyMap<string, AssetReference>,
  prefix: string,
  mask: boolean,
  tokens: DesignTokenCollection | undefined,
  visitedComponentIds: ReadonlySet<string>,
  depth: number,
): string {
  const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
  const clipMaskMap = buildLayerClipMaskMap(canvasNodes, nodeById);
  const frameClipMap = buildFrameClipAncestorMap(canvasNodes, nodeById);
  const states = getEffectiveLayerStates(canvasNodes);

  const defs = serializeDefs(
    canvasNodes,
    width,
    height,
    componentById,
    assetById,
    prefix,
    nodeById,
    clipMaskMap,
    frameClipMap,
    mask,
    tokens,
    visitedComponentIds,
    depth,
  );

  const renderedNodes = getLayerRenderOrder(canvasNodes)
    .filter((node) => {
      if (node.type === 'group') return false;
      const state = states.get(node.id);
      if (!state?.visible) return false;
      const maskIds = clipMaskMap.get(node.id) ?? [];
      return maskIds.every((baseId) => states.get(baseId)?.visible);
    })
    .map((node) => {
      let markup = '';
      if (node.type === 'component-instance') {
        const component = componentById.get(node.componentId);
        const blockedByCycle = visitedComponentIds.has(node.componentId) || depth >= MAX_COMPONENT_RECURSION_DEPTH;
        if (!component || blockedByCycle) {
          markup = mask
            ? `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#fff" opacity="${node.opacity}"${formatRotationTransform(node)} />`
            : `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="none" stroke="#D45B5B" stroke-dasharray="6 4" stroke-width="2"${formatRotationTransform(node)} />`;
        } else {
          const scaleX = node.width / Math.max(1, component.document.width);
          const scaleY = node.height / Math.max(1, component.document.height);
          const resolvedRaw = resolveComponentInstanceNodes(node, component, tokens);
          const laidOut = computeAutoLayoutNodes(resolvedRaw, {
            breakpoint: 'desktop',
            tokens,
            canvasWidth: component.document.width,
          });
          const resolvedChildren = laidOut.filter((child) => child.onCanvas !== false);
          const instPrefix = `${prefix}-inst-${sanitizeIdSegment(node.id)}`;
          const nextVisited = new Set(visitedComponentIds);
          nextVisited.add(node.componentId);
          const inner = serializeNodesBlock(
            resolvedChildren,
            component.document.width,
            component.document.height,
            componentById,
            assetById,
            instPrefix,
            mask,
            tokens,
            nextVisited,
            depth + 1,
          );
          const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';
          const filterAttr = !mask && hasSvgFilterEffects(node)
            ? ` filter="url(#${buildSvgFilterId(prefix, node.id)})"`
            : '';
          const blendAttr = !mask && node.blendMode && node.blendMode !== 'normal'
            ? ` style="mix-blend-mode:${node.blendMode}"`
            : '';
          markup = `<g${formatRotationTransform(node)}${opacityAttr}${filterAttr}${blendAttr}><g transform="translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})">${inner}</g></g>`;
        }
      } else {
        markup = serializePrimitiveNode(node, mask, prefix, assetById);
      }

      if (!markup) return '';

      const frameIds = frameClipMap.get(node.id) ?? [];
      for (let i = frameIds.length - 1; i >= 0; i -= 1) {
        markup = `<g clip-path="url(#${frameClipId(prefix, frameIds[i])})">${markup}</g>`;
      }

      const maskIds = clipMaskMap.get(node.id) ?? [];
      for (let i = maskIds.length - 1; i >= 0; i -= 1) {
        markup = `<g mask="url(#${maskId(prefix, maskIds[i])})">${markup}</g>`;
      }

      return markup;
    })
    .join('');

  return `${defs}${renderedNodes}`;
}

/**
 * Serializes a FolioDocument into a clean, self-contained standalone SVG document string.
 * Respects active Design Tokens/Themes, Flex/Grid Auto-Layout, Responsive Breakpoints,
 * Multi-Fills/Gradients, Effects, Blend Modes, ImageNodes, Auto Text-Wrapping,
 * and guards against cyclic or overly deep component recursion.
 */
export function serializeDocumentToSvgString(
  doc: FolioDocument,
  components: readonly ComponentDefinition[] = [],
  options: VisualExportOptions = {},
): string {
  const breakpoint = options.breakpoint ?? 'desktop';
  const effectiveDocWidth = getBreakpointCanvasWidth(doc.width, breakpoint);
  const width = Math.max(1, Math.round(effectiveDocWidth));
  const height = Math.max(1, Math.round(doc.height));
  const resolvedNodes = computeAutoLayoutNodes(doc.nodes, {
    breakpoint,
    tokens: options.designTokens,
    canvasWidth: effectiveDocWidth,
  });
  const canvasNodes = resolvedNodes.filter((node) => node.onCanvas !== false);
  const componentById = new Map(components.map((component) => [component.id, component]));
  const assetById = new Map((options.assets ?? []).map((asset) => [asset.id, asset]));
  const prefix = `folio-export-${sanitizeIdSegment(doc.id)}`;

  const titleMarkup = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  const hasBackground = Boolean(
    doc.background &&
    doc.background !== 'transparent' &&
    doc.background !== 'none' &&
    doc.background !== '#00000000',
  );
  const bgMarkup = hasBackground
    ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(doc.background)}" />`
    : '';

  const content = serializeNodesBlock(
    canvasNodes,
    width,
    height,
    componentById,
    assetById,
    prefix,
    false,
    options.designTokens,
    new Set<string>(),
    0,
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    titleMarkup,
    bgMarkup,
    content,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createVisualExportFilename(name: string, extension: 'svg' | 'png'): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'folio-canvas'}.${extension}`;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports the document as a standalone `.svg` file download and returns the serialized SVG string. */
export function downloadSvgDocument(
  doc: FolioDocument,
  components: readonly ComponentDefinition[],
  filenameBase: string,
  options: VisualExportOptions = {},
): string {
  const svg = serializeDocumentToSvgString(doc, components, { ...options, title: options.title ?? filenameBase });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  triggerBlobDownload(blob, createVisualExportFilename(filenameBase, 'svg'));
  return svg;
}

/** Rasterizes the document SVG onto an offscreen canvas at `scale` (default 2×) and downloads a `.png`. */
export async function downloadPngDocument(
  doc: FolioDocument,
  components: readonly ComponentDefinition[],
  filenameBase: string,
  scale = 2,
  options: VisualExportOptions = {},
): Promise<{ width: number; height: number }> {
  const safeScale = Math.max(1, Math.min(4, scale));
  const effectiveDocWidth = getBreakpointCanvasWidth(doc.width, options.breakpoint ?? 'desktop');
  const width = Math.max(1, Math.round(effectiveDocWidth * safeScale));
  const height = Math.max(1, Math.round(doc.height * safeScale));
  const svg = serializeDocumentToSvgString(doc, components, { ...options, title: options.title ?? filenameBase });
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Browser failed to rasterize SVG artwork into PNG.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context is unavailable for PNG export.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode PNG image blob.'));
      }, 'image/png');
    });

    triggerBlobDownload(pngBlob, createVisualExportFilename(filenameBase, 'png'));
    return { width, height };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
