import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioDocument,
  FrameNode,
  PathNode,
} from '../core/document/types';
import { resolveComponentInstanceNodes } from '../core/document/components';
import { serializePathPointsToSvgD } from '../core/document/vector';
import {
  buildFrameClipAncestorMap,
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerDescendantIds,
  getLayerRenderOrder,
} from '../core/document/layers';

type PrimitiveNode = Exclude<DesignNode, ComponentInstanceNode>;

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

function serializePrimitiveNode(node: PrimitiveNode, mask: boolean): string {
  if (node.type === 'group') return '';
  const transformAttr = formatRotationTransform(node);
  const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';

  let inner = '';
  if (node.type === 'frame' || node.type === 'rect') {
    const fill = mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill;
    const stroke = mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke;
    const rxAttr = node.style.radius ? ` rx="${node.style.radius}"` : '';
    const dashAttr = node.type === 'frame' && node.isSection && !mask ? ' stroke-dasharray="6 4"' : '';
    inner = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"${rxAttr} fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${node.style.strokeWidth}"${dashAttr} />`;
  } else if (node.type === 'ellipse') {
    const fill = mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill;
    const stroke = mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    inner = `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${node.style.strokeWidth}" />`;
  } else if (node.type === 'path') {
    const pathD = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
    const fill = mask ? (node.style.fill === 'none' ? 'none' : '#fff') : node.style.fill;
    const stroke = mask ? (node.style.stroke === 'none' ? 'none' : '#fff') : node.style.stroke;
    const fillRule = node.style.fillRule ?? 'nonzero';
    const linecap = node.style.strokeLinecap ?? 'round';
    const linejoin = node.style.strokeLinejoin ?? 'round';
    const dashAttr = node.style.strokeDasharray ? ` stroke-dasharray="${escapeXml(node.style.strokeDasharray)}"` : '';
    const arrows = serializeArrowheads(node, mask);
    inner = `<g transform="translate(${node.x} ${node.y})"><path d="${escapeXml(pathD)}" fill="${escapeXml(fill)}" fill-rule="${fillRule}" stroke="${escapeXml(stroke)}" stroke-width="${node.style.strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />${arrows}</g>`;
  } else if (node.type === 'text') {
    const fill = mask ? '#fff' : node.style.fill;
    const lines = node.text.split(/\r?\n/);
    const tspans = lines
      .map((line, index) => {
        const dy = index === 0 ? 0 : node.style.fontSize * node.style.lineHeight;
        return `<tspan x="${node.x}" dy="${dy}">${escapeXml(line || ' ')}</tspan>`;
      })
      .join('');
    inner = `<text x="${node.x}" y="${node.y}" fill="${escapeXml(fill)}" font-size="${node.style.fontSize}" font-family="${escapeXml(node.style.fontFamily)}" font-weight="${node.style.fontWeight}" letter-spacing="${node.style.letterSpacing}" dominant-baseline="hanging">${tspans}</text>`;
  }

  return `<g${transformAttr}${opacityAttr}>${inner}</g>`;
}

function serializeClipMaskArtwork(
  node: DesignNode,
  nodes: readonly DesignNode[],
  componentById: ReadonlyMap<string, ComponentDefinition>,
  prefix: string,
  nodeById: ReadonlyMap<string, DesignNode>,
): string {
  if (node.type === 'group') {
    const states = getEffectiveLayerStates(nodes);
    const descendants = [...getLayerDescendantIds(nodes, node.id)]
      .map((id) => nodeById.get(id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (descendants.length === 0) {
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#fff" opacity="${node.opacity}" />`;
    }
    return `<g>${descendants.map((child) => serializeClipMaskArtwork(child, nodes, componentById, prefix, nodeById)).join('')}</g>`;
  }

  if (node.type === 'component-instance') {
    const component = componentById.get(node.componentId);
    if (!component) {
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#fff" opacity="${node.opacity}"${formatRotationTransform(node)} />`;
    }
    const scaleX = node.width / Math.max(1, component.document.width);
    const scaleY = node.height / Math.max(1, component.document.height);
    const resolved = resolveComponentInstanceNodes(node, component).filter((child) => child.onCanvas !== false);
    const childPrefix = `${prefix}-instmask-${sanitizeIdSegment(node.id)}`;
    const content = serializeNodesBlock(
      resolved,
      component.document.width,
      component.document.height,
      componentById,
      childPrefix,
      true,
    );
    return `<g${formatRotationTransform(node)} opacity="${node.opacity}"><g transform="translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})">${content}</g></g>`;
  }

  return serializePrimitiveNode(node, true);
}

function serializeDefs(
  nodes: readonly DesignNode[],
  width: number,
  height: number,
  componentById: ReadonlyMap<string, ComponentDefinition>,
  prefix: string,
  nodeById: ReadonlyMap<string, DesignNode>,
  clipMaskMap: ReadonlyMap<string, string[]>,
  frameClipMap: ReadonlyMap<string, string[]>,
): string {
  const referencedMasks = new Set<string>();
  const referencedFrames = new Set<string>();

  for (const node of nodes) {
    for (const baseId of clipMaskMap.get(node.id) ?? []) referencedMasks.add(baseId);
    for (const fId of frameClipMap.get(node.id) ?? []) referencedFrames.add(fId);
  }

  if (referencedMasks.size === 0 && referencedFrames.size === 0) return '';

  const defsParts: string[] = [];

  for (const baseId of referencedMasks) {
    const base = nodeById.get(baseId);
    if (!base) continue;
    const artwork = serializeClipMaskArtwork(base, nodes, componentById, prefix, nodeById);
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
  prefix: string,
  mask: boolean,
): string {
  const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
  const clipMaskMap = buildLayerClipMaskMap(canvasNodes, nodeById);
  const frameClipMap = buildFrameClipAncestorMap(canvasNodes, nodeById);
  const states = getEffectiveLayerStates(canvasNodes);

  const defs = serializeDefs(canvasNodes, width, height, componentById, prefix, nodeById, clipMaskMap, frameClipMap);

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
        if (!component) {
          markup = mask
            ? `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#fff" opacity="${node.opacity}"${formatRotationTransform(node)} />`
            : `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="none" stroke="#D45B5B" stroke-dasharray="6 4" stroke-width="2"${formatRotationTransform(node)} />`;
        } else {
          const scaleX = node.width / Math.max(1, component.document.width);
          const scaleY = node.height / Math.max(1, component.document.height);
          const resolvedChildren = resolveComponentInstanceNodes(node, component).filter((child) => child.onCanvas !== false);
          const instPrefix = `${prefix}-inst-${sanitizeIdSegment(node.id)}`;
          const inner = serializeNodesBlock(
            resolvedChildren,
            component.document.width,
            component.document.height,
            componentById,
            instPrefix,
            mask,
          );
          const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';
          markup = `<g${formatRotationTransform(node)}${opacityAttr}><g transform="translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})">${inner}</g></g>`;
        }
      } else {
        markup = serializePrimitiveNode(node, mask);
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

/** Serializes a FolioDocument into a clean, self-contained standalone SVG document string. */
export function serializeDocumentToSvgString(
  doc: FolioDocument,
  components: readonly ComponentDefinition[] = [],
  options: { title?: string } = {},
): string {
  const width = Math.max(1, Math.round(doc.width));
  const height = Math.max(1, Math.round(doc.height));
  const canvasNodes = doc.nodes.filter((node) => node.onCanvas !== false);
  const componentById = new Map(components.map((component) => [component.id, component]));
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

  const content = serializeNodesBlock(canvasNodes, width, height, componentById, prefix, false);

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
): string {
  const svg = serializeDocumentToSvgString(doc, components, { title: filenameBase });
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
): Promise<{ width: number; height: number }> {
  const safeScale = Math.max(1, Math.min(4, scale));
  const width = Math.max(1, Math.round(doc.width * safeScale));
  const height = Math.max(1, Math.round(doc.height * safeScale));
  const svg = serializeDocumentToSvgString(doc, components, { title: filenameBase });
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
