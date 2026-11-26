import type {
  AnimationClip,
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
  buildCssFilterString,
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
import { resolvePortableAssetUrl } from '../core/persistence/assetStore';
import {
  buildFrameClipAncestorMap,
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerDescendantIds,
  getLayerRenderOrder,
} from '../core/document/layers';
import { computeAutoLayoutNodes, getBreakpointCanvasWidth } from '../engines/layout/autoLayout';
import { applyAnimatedPosesToDocument, evaluateClipAtTime } from '../engines/animation/evaluator';
import { buildNodeSvgSmilAnimations } from '../engines/animation/svgExport';

type PrimitiveNode = Exclude<DesignNode, ComponentInstanceNode>;

const MAX_COMPONENT_RECURSION_DEPTH = 16;

export interface VisualExportOptions {
  title?: string;
  designTokens?: DesignTokenCollection;
  breakpoint?: BreakpointId;
  assets?: readonly AssetReference[];
  /** When true (PNG canvas rasterization), skips <foreignObject> backdrop-blur elements that taint <canvas> in WebKit/Safari. */
  rasterizeSafe?: boolean;
  /** When provided (e.g. during video/GIF/PNG-sequence export), evaluates animated component instances at this timestamp (ms). */
  animationTimeMs?: number;
  /** When true (standalone SVG export), embeds native SVG SMIL (<animate> / <animateTransform>) for page clips and animated component instances. */
  embedAnimations?: boolean;
  /** Optional active animation clip for the root document when `embedAnimations` is true. */
  activeClip?: AnimationClip | null;
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

function outsideMaskId(prefix: string, baseId: string): string {
  return `${prefix}--outsidemask--${sanitizeIdSegment(baseId)}`;
}

function frameClipId(prefix: string, frameId: string): string {
  return `${prefix}--clip--${sanitizeIdSegment(frameId)}`;
}

function imageClipId(prefix: string, imageId: string): string {
  return `${prefix}--imgclip--${sanitizeIdSegment(imageId)}`;
}

function hasDistinctCornerRadii(radii?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }): boolean {
  if (!radii) return false;
  return !(
    radii.topLeft === radii.topRight &&
    radii.topRight === radii.bottomRight &&
    radii.bottomRight === radii.bottomLeft
  );
}

function buildRoundedRectPathD(
  x: number,
  y: number,
  w: number,
  h: number,
  tlRaw: number,
  trRaw: number,
  brRaw: number,
  blRaw: number,
): string {
  const maxR = Math.max(0, Math.min(w, h) / 2);
  const tl = Math.max(0, Math.min(maxR, tlRaw));
  const tr = Math.max(0, Math.min(maxR, trRaw));
  const br = Math.max(0, Math.min(maxR, brRaw));
  const bl = Math.max(0, Math.min(maxR, blRaw));
  const x2 = x + w;
  const y2 = y + h;
  return [
    `M ${x + tl} ${y}`,
    `H ${x2 - tr}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${x2} ${y + tr}` : `L ${x2} ${y}`,
    `V ${y2 - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${x2 - br} ${y2}` : `L ${x2} ${y2}`,
    `H ${x + bl}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${y2 - bl}` : `L ${x} ${y2}`,
    `V ${y + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : `L ${x} ${y}`,
    'Z',
  ].join(' ');
}

function buildBlendStyleAttr(node: DesignNode, mask: boolean): string {
  if (mask) return '';
  if (node.blendMode && node.blendMode !== 'normal') {
    return ` style="${escapeXml(`mix-blend-mode:${node.blendMode}`)}"`;
  }
  return '';
}

function buildCssFilterStyleAttr(node: DesignNode, mask: boolean): string {
  if (mask) return '';
  const cssFilterStr = buildCssFilterString(node.cssFilters);
  if (!cssFilterStr) return '';
  return ` style="${escapeXml(`filter:${cssFilterStr}`)}"`;
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

function serializeArrowheads(node: PathNode, mask: boolean, maskFill = '#fff'): string {
  if (node.closed || node.points.length < 2) return '';
  if (!node.style.arrowStart && !node.style.arrowEnd) return '';
  const color = mask
    ? maskFill
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
  rasterizeSafe = false,
): string {
  if (mask || rasterizeSafe) return '';
  const blurRadius = getBackdropBlurRadius(node);
  if (blurRadius <= 0 || node.width <= 0 || node.height <= 0) return '';
  const borderRadius = isEllipse ? '50%' : `${radius}px`;
  return `<foreignObject x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;border-radius:${borderRadius};backdrop-filter:blur(${blurRadius}px);-webkit-backdrop-filter:blur(${blurRadius}px);background:transparent;"></div></foreignObject>`;
}

function injectSvgSmilInsideElement(markup: string, smilMarkup: string): string {
  if (!smilMarkup) return markup;
  const selfClosingMatch = /<([a-zA-Z][\w:-]*)(\b[^>]*?)\s*\/>/.exec(markup);
  if (selfClosingMatch && selfClosingMatch.index !== undefined) {
    const [full, tag, attrs] = selfClosingMatch;
    const replacement = `<${tag}${attrs}>${smilMarkup}</${tag}>`;
    return `${markup.slice(0, selfClosingMatch.index)}${replacement}${markup.slice(selfClosingMatch.index + full.length)}`;
  }
  const textCloseIdx = markup.lastIndexOf('</text>');
  if (textCloseIdx >= 0) {
    return `${markup.slice(0, textCloseIdx)}${smilMarkup}${markup.slice(textCloseIdx)}`;
  }
  return markup;
}

function getComponentPrimaryAnimatedClip(component: ComponentDefinition): AnimationClip | null {
  if (!component.animations || component.animations.length === 0) return null;
  return component.animations.find((clip) => clip.tracks.length > 0) ?? null;
}

function evaluateComponentNodesAtTime(
  component: ComponentDefinition,
  nodes: readonly DesignNode[],
  timeMs: number,
): DesignNode[] {
  const clip = getComponentPrimaryAnimatedClip(component);
  if (!clip || clip.durationMs <= 0) return [...nodes];
  const sampleTimeMs = clip.loop
    ? ((timeMs % clip.durationMs) + clip.durationMs) % clip.durationMs
    : Math.max(0, Math.min(clip.durationMs, timeMs));
  const poses = evaluateClipAtTime(clip, sampleTimeMs);
  const tempDoc: FolioDocument = {
    ...component.document,
    nodes: [...nodes],
  };
  return applyAnimatedPosesToDocument(tempDoc, poses).nodes;
}

function serializePrimitiveNode(
  node: PrimitiveNode,
  mask: boolean,
  prefix: string,
  assetById: ReadonlyMap<string, AssetReference>,
  rasterizeSafe = false,
  maskFill = '#fff',
  embedAnimations = false,
  activeClip: AnimationClip | null = null,
): string {
  if (node.type === 'group') return '';
  const transformAttr = formatRotationTransform(node);
  const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';
  const filterAttr = !mask && hasSvgFilterEffects(node)
    ? ` filter="url(#${buildSvgFilterId(prefix, node.id)})"`
    : '';
  const blendStyleAttr = buildBlendStyleAttr(node, mask);
  const cssFilterStyleAttr = buildCssFilterStyleAttr(node, mask);
  const smil = embedAnimations && !mask && !rasterizeSafe && activeClip
    ? buildNodeSvgSmilAnimations(node, activeClip)
    : null;

  let inner = '';
  if (smil?.morphSmil && (node.type === 'frame' || node.type === 'rect' || node.type === 'ellipse' || node.type === 'path')) {
    const fills = getVisibleFillPaints(node);
    const fillRule = node.type === 'path' ? (node.style.fillRule ?? 'nonzero') : 'nonzero';
    const linecap = node.type === 'path' ? (node.style.strokeLinecap ?? 'round') : 'round';
    const linejoin = node.type === 'path' ? (node.style.strokeLinejoin ?? 'round') : 'round';
    const dashAttr = node.type === 'path' && node.style.strokeDasharray
      ? ` stroke-dasharray="${escapeXml(node.style.strokeDasharray)}"`
      : '';
    const sw = node.style.strokeWidth;
    const morphInnerSmil = `${smil.morphSmil.animateMarkup}${smil.shapeSmilMarkup}`;
    if (fills.length <= 1) {
      const fillAttr = fills.length === 1
        ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
        : ' fill="none"';
      inner = `<path d="${escapeXml(smil.morphSmil.initialD)}"${fillAttr} fill-rule="${fillRule}" stroke="${escapeXml(node.style.stroke)}" stroke-width="${sw}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr}>${morphInnerSmil}</path>`;
    } else {
      const fillPaths = fills
        .map((paint, idx) => `<path d="${escapeXml(smil.morphSmil!.initialD)}"${serializePaintFillAttr(paint, node.id, idx, prefix)} fill-rule="${fillRule}" stroke="none">${smil.morphSmil!.animateMarkup}</path>`)
        .join('');
      const strokePath = sw > 0 && node.style.stroke !== 'none'
        ? `<path d="${escapeXml(smil.morphSmil.initialD)}" fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${sw}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr}>${morphInnerSmil}</path>`
        : '';
      inner = `${fillPaths}${strokePath}`;
    }
  } else if (node.type === 'frame' || node.type === 'rect') {
    const fills = getVisibleFillPaints(node);
    const radii = node.style.cornerRadii;
    const usePerCornerPath = hasDistinctCornerRadii(radii);
    const rx = radii && !usePerCornerPath ? radii.topLeft : (node.style.radius ?? 0);
    const dashAttr = node.type === 'frame' && node.isSection && !mask ? ' stroke-dasharray="6 4"' : '';
    const sw = node.style.strokeWidth;
    const strokeAlign = node.style.strokeAlign ?? 'center';
    const hasStroke = sw > 0 && node.style.stroke !== 'none' && node.style.stroke !== 'transparent';
    const strokeDelta = strokeAlign === 'inside' ? sw * 0.5 : strokeAlign === 'outside' ? -sw * 0.5 : 0;
    const needsSeparateStroke = !mask && hasStroke && (fills.length > 1 || strokeAlign !== 'center');
    const backdrop = serializeBackdropBlur(node, mask, rx, false, rasterizeSafe);

    const renderBoxShape = (
      x: number,
      y: number,
      w: number,
      h: number,
      delta: number,
      attrs: string,
    ): string => {
      if (usePerCornerPath && radii) {
        const d = buildRoundedRectPathD(
          x,
          y,
          w,
          h,
          radii.topLeft > 0 ? Math.max(0, radii.topLeft - delta) : 0,
          radii.topRight > 0 ? Math.max(0, radii.topRight - delta) : 0,
          radii.bottomRight > 0 ? Math.max(0, radii.bottomRight - delta) : 0,
          radii.bottomLeft > 0 ? Math.max(0, radii.bottomLeft - delta) : 0,
        );
        return `<path d="${escapeXml(d)}"${attrs} />`;
      }
      const adjRx = rx > 0 ? Math.max(0, rx - delta) : 0;
      const adjRxAttr = adjRx > 0 ? ` rx="${adjRx}"` : '';
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${adjRxAttr}${attrs} />`;
    };

    if (mask || (fills.length <= 1 && !needsSeparateStroke)) {
      const fillAttr = mask
        ? ` fill="${node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill}"`
        : fills.length === 1
          ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
          : ' fill="none"';
      const stroke = mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke;
      inner = `${backdrop}${renderBoxShape(
        node.x,
        node.y,
        node.width,
        node.height,
        0,
        `${fillAttr} stroke="${escapeXml(stroke)}" stroke-width="${sw}"${dashAttr}`,
      )}`;
    } else {
      const fillShapes = fills
        .map((paint, idx) =>
          renderBoxShape(
            node.x,
            node.y,
            node.width,
            node.height,
            0,
            `${serializePaintFillAttr(paint, node.id, idx, prefix)} stroke="none"`,
          ),
        )
        .join('');
      const strokeShape = hasStroke
        ? renderBoxShape(
            node.x + strokeDelta,
            node.y + strokeDelta,
            Math.max(0, node.width - strokeDelta * 2),
            Math.max(0, node.height - strokeDelta * 2),
            strokeDelta,
            ` fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${sw}"${dashAttr}`,
          )
        : '';
      inner = `${backdrop}${fillShapes}${strokeShape}`;
    }
  } else if (node.type === 'ellipse') {
    const fills = getVisibleFillPaints(node);
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const sw = node.style.strokeWidth;
    const strokeAlign = node.style.strokeAlign ?? 'center';
    const hasStroke = sw > 0 && node.style.stroke !== 'none' && node.style.stroke !== 'transparent';
    const strokeDelta = strokeAlign === 'inside' ? sw * 0.5 : strokeAlign === 'outside' ? -sw * 0.5 : 0;
    const needsSeparateStroke = !mask && hasStroke && (fills.length > 1 || strokeAlign !== 'center');
    const backdrop = serializeBackdropBlur(node, mask, 0, true, rasterizeSafe);
    if (mask || (fills.length <= 1 && !needsSeparateStroke)) {
      const fillAttr = mask
        ? ` fill="${node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill}"`
        : fills.length === 1
          ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
          : ' fill="none"';
      const stroke = mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke;
      inner = `${backdrop}<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}"${fillAttr} stroke="${escapeXml(stroke)}" stroke-width="${sw}" />`;
    } else {
      const fillEllipses = fills
        .map((paint, idx) => `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}"${serializePaintFillAttr(paint, node.id, idx, prefix)} stroke="none" />`)
        .join('');
      const strokeEllipse = hasStroke
        ? `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(0, node.width / 2 - strokeDelta)}" ry="${Math.max(0, node.height / 2 - strokeDelta)}" fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${sw}" />`
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
    const arrows = serializeArrowheads(node, mask, maskFill);
    if (mask || fills.length <= 1) {
      const fillAttr = mask
        ? ` fill="${node.style.fill === 'none' && fills.length === 0 ? 'none' : maskFill}"`
        : fills.length === 1
          ? serializePaintFillAttr(fills[0], node.id, 0, prefix)
          : ' fill="none"';
      const stroke = mask ? (node.style.stroke === 'none' ? 'none' : maskFill) : node.style.stroke;
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
    const fill = mask ? maskFill : node.style.fill;
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
    const radii = imgNode.style.cornerRadii;
    const usePerCornerPath = hasDistinctCornerRadii(radii);
    const rx = radii && !usePerCornerPath ? radii.topLeft : (imgNode.style.radius ?? 0);
    const rxAttr = rx ? ` rx="${rx}"` : '';
    const hasRadiusClip = usePerCornerPath || rx > 0;
    if (mask) {
      inner = usePerCornerPath && radii
        ? `<path d="${escapeXml(buildRoundedRectPathD(imgNode.x, imgNode.y, imgNode.width, imgNode.height, radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft))}" fill="${maskFill}" />`
        : `<rect x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}"${rxAttr} fill="${maskFill}" />`;
    } else {
      const asset = assetById.get(imgNode.assetId);
      const href = resolvePortableAssetUrl(asset);
      const clipAttr = hasRadiusClip ? ` clip-path="url(#${imageClipId(prefix, imgNode.id)})"` : '';
      const imgMarkup = href
        ? `<image href="${escapeXml(href)}" x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}" preserveAspectRatio="${imageFitToPreserveAspectRatio(imgNode.style.fit)}"${clipAttr} />`
        : `<rect x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}"${rxAttr} fill="#1E2534" stroke="#4B5A78" stroke-width="1.5" stroke-dasharray="6 4" />`;
      const strokeMarkup = imgNode.style.stroke && imgNode.style.stroke !== 'none' && (imgNode.style.strokeWidth ?? 0) > 0
        ? usePerCornerPath && radii
          ? `<path d="${escapeXml(buildRoundedRectPathD(imgNode.x, imgNode.y, imgNode.width, imgNode.height, radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft))}" fill="none" stroke="${escapeXml(imgNode.style.stroke)}" stroke-width="${imgNode.style.strokeWidth}" />`
          : `<rect x="${imgNode.x}" y="${imgNode.y}" width="${imgNode.width}" height="${imgNode.height}"${rxAttr} fill="none" stroke="${escapeXml(imgNode.style.stroke)}" stroke-width="${imgNode.style.strokeWidth}" />`
        : '';
      inner = `${imgMarkup}${strokeMarkup}`;
    }
  }

  if (smil && !smil.morphSmil && smil.shapeSmilMarkup) {
    inner = injectSvgSmilInsideElement(inner, smil.shapeSmilMarkup);
  }
  const wrappedInner = cssFilterStyleAttr ? `<g${cssFilterStyleAttr}>${inner}</g>` : inner;
  const wrapperSmil = smil?.wrapperSmilMarkup ?? '';
  return `<g${transformAttr}${opacityAttr}${filterAttr}${blendStyleAttr}>${wrapperSmil}${wrappedInner}</g>`;
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
  maskFill = '#fff',
  animationTimeMs?: number,
): string {
  if (node.type === 'group') {
    const states = getEffectiveLayerStates(nodes);
    const descendants = [...getLayerDescendantIds(nodes, node.id)]
      .map((id) => nodeById.get(id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (descendants.length === 0) {
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${maskFill}" opacity="${node.opacity}" />`;
    }
    return `<g>${descendants.map((child) => serializeClipMaskArtwork(child, nodes, componentById, assetById, prefix, nodeById, tokens, visitedComponentIds, depth, maskFill, animationTimeMs)).join('')}</g>`;
  }

  if (node.type === 'component-instance') {
    const component = componentById.get(node.componentId);
    if (!component || visitedComponentIds.has(node.componentId) || depth >= MAX_COMPONENT_RECURSION_DEPTH) {
      return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${maskFill}" opacity="${node.opacity}"${formatRotationTransform(node)} />`;
    }
    const scaleX = node.width / Math.max(1, component.document.width);
    const scaleY = node.height / Math.max(1, component.document.height);
    const resolvedRaw = resolveComponentInstanceNodes(node, component, tokens);
    const laidOut = computeAutoLayoutNodes(resolvedRaw, {
      breakpoint: 'desktop',
      tokens,
      canvasWidth: component.document.width,
    });
    const evaluatedNodes = animationTimeMs !== undefined
      ? evaluateComponentNodesAtTime(component, laidOut, animationTimeMs)
      : laidOut;
    const resolved = evaluatedNodes.filter((child) => child.onCanvas !== false);
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
      false,
      maskFill,
      animationTimeMs,
      false,
      null,
    );
    return `<g${formatRotationTransform(node)} opacity="${node.opacity}"><g transform="translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})">${content}</g></g>`;
  }

  return serializePrimitiveNode(node, true, prefix, assetById, false, maskFill);
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
  animationTimeMs?: number,
): string {
  const referencedMasks = new Set<string>();
  const referencedOutsideMasks = new Set<string>();
  const referencedFrames = new Set<string>();
  const defsParts: string[] = [];

  for (const node of nodes) {
    for (const baseId of clipMaskMap.get(node.id) ?? []) referencedMasks.add(baseId);
    if (node.clipMaskBaseId && node.clipMaskMode === 'outside') {
      referencedOutsideMasks.add(node.clipMaskBaseId);
    }
    for (const fId of frameClipMap.get(node.id) ?? []) referencedFrames.add(fId);

    if (!mask) {
      const styleDefs = serializeNodeSvgStyleDefs(node, prefix);
      if (styleDefs) defsParts.push(styleDefs);
      if (node.type === 'image') {
        const radii = node.style.cornerRadii;
        if (hasDistinctCornerRadii(radii) && radii) {
          const d = buildRoundedRectPathD(
            node.x,
            node.y,
            node.width,
            node.height,
            radii.topLeft,
            radii.topRight,
            radii.bottomRight,
            radii.bottomLeft,
          );
          defsParts.push(
            `<clipPath id="${imageClipId(prefix, node.id)}" clipPathUnits="userSpaceOnUse"><path d="${escapeXml(d)}" /></clipPath>`,
          );
        } else if ((node.style.radius ?? 0) > 0) {
          defsParts.push(
            `<clipPath id="${imageClipId(prefix, node.id)}" clipPathUnits="userSpaceOnUse"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.style.radius ?? 0}" /></clipPath>`,
          );
        }
      }
    }
  }

  for (const baseId of referencedMasks) {
    const base = nodeById.get(baseId);
    if (!base) continue;
    const artwork = serializeClipMaskArtwork(base, nodes, componentById, assetById, prefix, nodeById, tokens, visitedComponentIds, depth, '#fff', animationTimeMs);
    defsParts.push(
      `<mask id="${maskId(prefix, baseId)}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#000" />${artwork}</mask>`,
    );
  }

  for (const baseId of referencedOutsideMasks) {
    const base = nodeById.get(baseId);
    if (!base) continue;
    const artwork = serializeClipMaskArtwork(base, nodes, componentById, assetById, prefix, nodeById, tokens, visitedComponentIds, depth, '#000', animationTimeMs);
    defsParts.push(
      `<mask id="${outsideMaskId(prefix, baseId)}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#fff" />${artwork}</mask>`,
    );
  }

  for (const fId of referencedFrames) {
    const frame = nodeById.get(fId);
    if (!frame || frame.type !== 'frame') continue;
    const frameNode = frame as FrameNode;
    const transformAttr = formatRotationTransform(frameNode);
    const radii = frameNode.style.cornerRadii;
    if (hasDistinctCornerRadii(radii) && radii) {
      const d = buildRoundedRectPathD(
        frameNode.x,
        frameNode.y,
        frameNode.width,
        frameNode.height,
        radii.topLeft,
        radii.topRight,
        radii.bottomRight,
        radii.bottomLeft,
      );
      defsParts.push(
        `<clipPath id="${frameClipId(prefix, fId)}" clipPathUnits="userSpaceOnUse"><path d="${escapeXml(d)}"${transformAttr} /></clipPath>`,
      );
    } else {
      const rxAttr = frameNode.style.radius ? ` rx="${frameNode.style.radius}"` : '';
      defsParts.push(
        `<clipPath id="${frameClipId(prefix, fId)}" clipPathUnits="userSpaceOnUse"><rect x="${frameNode.x}" y="${frameNode.y}" width="${frameNode.width}" height="${frameNode.height}"${rxAttr}${transformAttr} /></clipPath>`,
      );
    }
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
  rasterizeSafe = false,
  maskFill = '#fff',
  animationTimeMs?: number,
  embedAnimations = false,
  activeClip: AnimationClip | null = null,
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
    animationTimeMs,
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
            ? `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${maskFill}" opacity="${node.opacity}"${formatRotationTransform(node)} />`
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
          const compActiveClip = getComponentPrimaryAnimatedClip(component);
          const evaluatedChildren = animationTimeMs !== undefined && !embedAnimations && compActiveClip
            ? evaluateComponentNodesAtTime(component, laidOut, animationTimeMs)
            : laidOut;
          const resolvedChildren = evaluatedChildren.filter((child) => child.onCanvas !== false);
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
            rasterizeSafe,
            maskFill,
            animationTimeMs,
            embedAnimations,
            embedAnimations ? compActiveClip : null,
          );
          const opacityAttr = node.opacity < 1 ? ` opacity="${node.opacity}"` : '';
          const filterAttr = !mask && hasSvgFilterEffects(node)
            ? ` filter="url(#${buildSvgFilterId(prefix, node.id)})"`
            : '';
          const blendStyleAttr = buildBlendStyleAttr(node, mask);
          const cssFilterStyleAttr = buildCssFilterStyleAttr(node, mask);
          const innerWithCss = cssFilterStyleAttr ? `<g${cssFilterStyleAttr}>${inner}</g>` : inner;
          const instanceSmil = embedAnimations && !mask && !rasterizeSafe && activeClip
            ? (buildNodeSvgSmilAnimations(node, activeClip)?.wrapperSmilMarkup ?? '')
            : '';
          markup = `<g${formatRotationTransform(node)}${opacityAttr}${filterAttr}${blendStyleAttr}>${instanceSmil}<g transform="translate(${node.x} ${node.y}) scale(${scaleX} ${scaleY})">${innerWithCss}</g></g>`;
        }
      } else {
        markup = serializePrimitiveNode(
          node,
          mask,
          prefix,
          assetById,
          rasterizeSafe,
          maskFill,
          embedAnimations,
          activeClip,
        );
      }

      if (!markup) return '';

      const frameIds = frameClipMap.get(node.id) ?? [];
      for (let i = frameIds.length - 1; i >= 0; i -= 1) {
        markup = `<g clip-path="url(#${frameClipId(prefix, frameIds[i])})">${markup}</g>`;
      }

      const maskIds = clipMaskMap.get(node.id) ?? [];
      for (let i = maskIds.length - 1; i >= 0; i -= 1) {
        const targetMaskId =
          node.clipMaskMode === 'outside' && maskIds[i] === node.clipMaskBaseId
            ? outsideMaskId(prefix, maskIds[i])
            : maskId(prefix, maskIds[i]);
        markup = `<g mask="url(#${targetMaskId})">${markup}</g>`;
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
    Boolean(options.rasterizeSafe),
    '#fff',
    options.animationTimeMs,
    Boolean(options.embedAnimations),
    options.activeClip ?? null,
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
  const svg = serializeDocumentToSvgString(doc, components, {
    ...options,
    title: options.title ?? filenameBase,
    rasterizeSafe: true,
  });
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
