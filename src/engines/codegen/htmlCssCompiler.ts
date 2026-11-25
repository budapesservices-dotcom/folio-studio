import { resolveComponentInstanceNodes } from '../../core/document/components';
import {
  buildCustomFontFaceCss,
  buildGoogleFontsStylesheetUrl,
  collectProjectGoogleFonts,
} from '../../core/document/fonts';
import { sanitizeProjectNetworkSecrets } from '../../core/document/networkSecrets';
import { getActivePage } from '../../core/document/project';
import {
  buildCssBackgroundFromFills,
  buildCssEffectsAndBlendDeclarations,
} from '../../core/document/styling';
import {
  generateDesignTokensCss,
  getProjectDesignTokens,
  toCssVariableName,
  toDesignTokenThemeSlug,
} from '../../core/document/tokens';
import type {
  AssetReference,
  CodeModuleRecord,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  NodeLayoutConfig,
  NodePadding,
  PathNode,
  SemanticHtmlTag,
} from '../../core/document/types';
import { serializePathPointsToSvgD } from '../../core/document/vector';
import { getAssetBundlePath, resolveAssetDisplayUrl } from '../../core/persistence/assetStore';
import {
  escapeAttr,
  escapeHtml,
  sanitizeCssText,
  sanitizeCssValue,
  sanitizeHref,
  sanitizeJsText,
  toCssClassName,
  toPageFileSlug,
} from './sanitize';
import type { CodeMappingEntry, CompiledCodeFile } from './types';
import { buildLivePreviewLogicScript } from '../prototype/codegen';
import { compilePageAnimationsCss } from '../animation/codegen';

export function roundCss(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapJustifyContent(value: NodeLayoutConfig['justifyContent']): string {
  switch (value) {
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'space-between': return 'space-between';
    case 'space-around': return 'space-around';
    case 'space-evenly': return 'space-evenly';
    case 'start':
    default:
      return 'flex-start';
  }
}

function mapAlignItems(value: NodeLayoutConfig['alignItems']): string {
  switch (value) {
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'stretch': return 'stretch';
    case 'start':
    default:
      return 'flex-start';
  }
}

function formatPadding(padding: NodePadding): string {
  const { top, right, bottom, left } = padding;
  if (top === right && right === bottom && bottom === left) {
    return `${roundCss(top)}px`;
  }
  if (top === bottom && left === right) {
    return `${roundCss(top)}px ${roundCss(right)}px`;
  }
  return `${roundCss(top)}px ${roundCss(right)}px ${roundCss(bottom)}px ${roundCss(left)}px`;
}

export function resolveTokenCssVar(
  tokens: DesignTokenCollection,
  tokenId: string | undefined,
): string | null {
  if (!tokenId) return null;
  const token = tokens.tokens.find((item) => item.id === tokenId);
  if (!token) return null;
  return `var(${toCssVariableName(token.name)})`;
}

export function resolveSemanticTag(node: DesignNode): SemanticHtmlTag {
  if (node.semanticTag) return node.semanticTag;
  if (node.type === 'image') return 'img';
  if (node.type === 'text') {
    if (node.style.fontSize >= 36) return 'h1';
    if (node.style.fontSize >= 26) return 'h2';
    if (node.style.fontSize >= 20) return 'h3';
    return 'p';
  }
  if (node.type === 'frame') {
    return node.isSection ? 'section' : 'div';
  }
  if (node.type === 'component-instance') {
    return 'div';
  }
  return 'div';
}

export function buildArrowheadPoints(
  tip: { x: number; y: number },
  from: { x: number; y: number },
  size: number,
): string | null {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return null;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const backX = tip.x - ux * size;
  const backY = tip.y - uy * size;
  const wing = size * 0.48;
  return `${roundCss(tip.x)},${roundCss(tip.y)} ${roundCss(backX + px * wing)},${roundCss(backY + py * wing)} ${roundCss(backX - px * wing)},${roundCss(backY - py * wing)}`;
}

function buildInlineSvgMarkup(
  node: PathNode,
  tokens: DesignTokenCollection,
  indent: string,
): string[] {
  const d = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
  const w = Math.max(1, roundCss(node.width));
  const h = Math.max(1, roundCss(node.height));
  const fillVar = resolveTokenCssVar(tokens, node.tokenBindings?.fill);
  const strokeVar = resolveTokenCssVar(tokens, node.tokenBindings?.stroke);
  const fill = fillVar ?? sanitizeCssValue(node.style.fill || 'none', 'none');
  const stroke = strokeVar ?? sanitizeCssValue(node.style.stroke || 'none', 'none');
  const strokeWidth = Math.max(0, roundCss(node.style.strokeWidth));
  const fillRule = node.style.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  const linecap = ` stroke-linecap="${escapeAttr(node.style.strokeLinecap ?? 'round')}"`;
  const linejoin = ` stroke-linejoin="${escapeAttr(node.style.strokeLinejoin ?? 'round')}"`;
  const dash = node.style.strokeDasharray
    ? ` stroke-dasharray="${escapeAttr(node.style.strokeDasharray)}"`
    : '';

  const svgLines: string[] = [
    `${indent}<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" overflow="visible" aria-hidden="true">`,
    `${indent}  <path d="${escapeAttr(d)}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}"${fillRule}${linecap}${linejoin}${dash} />`,
  ];

  if (!node.closed && node.points.length >= 2 && (node.style.arrowStart || node.style.arrowEnd)) {
    const arrowColor =
      stroke !== 'none' && stroke !== '#00000000' ? stroke : fill;
    if (arrowColor && arrowColor !== 'none') {
      const size = Math.max(10, Math.min(28, (node.style.strokeWidth || 2) * 3.8));
      if (node.style.arrowEnd) {
        const tip = node.points[node.points.length - 1];
        const prev = tip.handleIn ?? node.points[node.points.length - 2];
        const pts = buildArrowheadPoints(tip, prev, size);
        if (pts) svgLines.push(`${indent}  <polygon points="${escapeAttr(pts)}" fill="${escapeAttr(arrowColor)}" />`);
      }
      if (node.style.arrowStart) {
        const tip = node.points[0];
        const next = tip.handleOut ?? node.points[1];
        const pts = buildArrowheadPoints(tip, next, size);
        if (pts) svgLines.push(`${indent}  <polygon points="${escapeAttr(pts)}" fill="${escapeAttr(arrowColor)}" />`);
      }
    }
  }

  svgLines.push(`${indent}</svg>`);
  return svgLines;
}

function resolveCssBorderStyle(strokeDasharray?: string): 'solid' | 'dashed' | 'dotted' {
  const trimmed = strokeDasharray?.trim();
  if (!trimmed) return 'solid';
  const firstToken = Number(trimmed.split(/[\s,]+/)[0]);
  if (Number.isFinite(firstToken) && firstToken > 0 && firstToken <= 3) {
    return 'dotted';
  }
  return 'dashed';
}

export function needsSvgMaskForClip(node: DesignNode, base: DesignNode): boolean {
  if (node.clipMaskMode === 'outside') return true;
  if (base.type === 'path') return true;
  if (Math.abs(base.rotation) > 0.01) return true;
  return false;
}

export function buildVectorMaskId(prefix: string, nodeId: string, mode: 'inside' | 'outside'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_') || 'page';
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `folio-mask-${safePrefix}-${mode}-${safeId}`;
}

export function buildVectorMaskDefsLines(
  nodes: readonly DesignNode[],
  prefix: string,
  jsxMode: boolean,
  indent: string,
): string[] {
  const nodeById = new Map<string, DesignNode>();
  for (const item of nodes) nodeById.set(item.id, item);

  const maskBlocks: string[] = [];
  for (const node of nodes) {
    if (!node.clipMaskBaseId || node.onCanvas === false) continue;
    const base = nodeById.get(node.clipMaskBaseId);
    if (!base || !needsSvgMaskForClip(node, base)) continue;

    const mode: 'inside' | 'outside' = node.clipMaskMode === 'outside' ? 'outside' : 'inside';
    const maskId = buildVectorMaskId(prefix, node.id, mode);
    const dx = roundCss(base.x - node.x);
    const dy = roundCss(base.y - node.y);
    const baseFill = mode === 'outside' ? '#000000' : '#ffffff';
    const bgFill = mode === 'outside' ? '#ffffff' : '#000000';
    const cx = roundCss(dx + base.width / 2);
    const cy = roundCss(dy + base.height / 2);
    const rotTransform = Math.abs(base.rotation) > 0.01 ? `rotate(${roundCss(base.rotation)} ${cx} ${cy})` : '';

    let shapeEl = '';
    if (base.type === 'ellipse') {
      const rx = roundCss(Math.max(0.5, base.width / 2));
      const ry = roundCss(Math.max(0.5, base.height / 2));
      const transformAttr = rotTransform ? ` transform="${escapeAttr(rotTransform)}"` : '';
      shapeEl = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${baseFill}"${transformAttr} />`;
    } else if (base.type === 'path') {
      const d = serializePathPointsToSvgD(base.points, base.closed, base.subpaths);
      const fullTransform = rotTransform
        ? `${rotTransform} translate(${dx} ${dy})`
        : `translate(${dx} ${dy})`;
      const fillRuleAttr =
        base.style.fillRule === 'evenodd'
          ? jsxMode
            ? ' fillRule="evenodd"'
            : ' fill-rule="evenodd"'
          : '';
      shapeEl = `<path d="${escapeAttr(d)}" transform="${escapeAttr(fullTransform)}" fill="${baseFill}"${fillRuleAttr} />`;
    } else {
      const w = roundCss(Math.max(1, base.width));
      const h = roundCss(Math.max(1, base.height));
      const radius =
        (base.type === 'rect' || base.type === 'frame' || base.type === 'image') && base.style.radius
          ? roundCss(Math.max(0, base.style.radius))
          : 0;
      const rxAttr = radius > 0 ? ` rx="${radius}"` : '';
      const transformAttr = rotTransform ? ` transform="${escapeAttr(rotTransform)}"` : '';
      shapeEl = `<rect x="${dx}" y="${dy}" width="${w}" height="${h}"${rxAttr} fill="${baseFill}"${transformAttr} />`;
    }

    maskBlocks.push(
      `${indent}    <mask id="${escapeAttr(maskId)}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">`,
      `${indent}      <rect x="-10000" y="-10000" width="20000" height="20000" fill="${bgFill}" />`,
      `${indent}      ${shapeEl}`,
      `${indent}    </mask>`,
    );
  }

  if (maskBlocks.length === 0) return [];

  if (jsxMode) {
    return [
      `${indent}<svg width={0} height={0} aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}>`,
      `${indent}  <defs>`,
      ...maskBlocks,
      `${indent}  </defs>`,
      `${indent}</svg>`,
    ];
  }

  return [
    `${indent}<svg width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none">`,
    `${indent}  <defs>`,
    ...maskBlocks,
    `${indent}  </defs>`,
    `${indent}</svg>`,
  ];
}

export function compileTokensCssFile(project: FolioProject): CompiledCodeFile {
  const tokens = getProjectDesignTokens(project);
  const blocks: string[] = [
    '/* Generated by FOLIO Code Engine — Design Tokens & Theme Custom Properties */',
    '/* Edit tokens in the Design Tokens rack; this file stays deterministically synchronized. */',
    '',
  ];
  for (const theme of tokens.themes) {
    blocks.push(generateDesignTokensCss(tokens, theme.id));
    blocks.push('');
  }
  const customFontFaceCss = buildCustomFontFaceCss(project.assets);
  if (customFontFaceCss) {
    blocks.push('/* Project Custom @font-face Rules */');
    blocks.push(customFontFaceCss);
    blocks.push('');
  }
  const content = `${blocks.join('\n').trimEnd()}\n`;
  return {
    id: 'generated:tokens.css',
    path: 'styles/tokens.css',
    language: 'css',
    category: 'generated',
    readOnly: true,
    content,
    description: 'Compiled CSS custom properties for all Folio Design Tokens and themes.',
    mappings: [],
  };
}

interface CompiledPageArtifacts {
  htmlFile: CompiledCodeFile;
  cssFile: CompiledCodeFile;
  bodyInnerHtml: string;
  pageCssContent: string;
}

export function buildChildrenMap(nodes: readonly DesignNode[]): {
  roots: DesignNode[];
  childrenByParent: Map<string, DesignNode[]>;
  nodeById: Map<string, DesignNode>;
} {
  const nodeById = new Map<string, DesignNode>();
  for (const node of nodes) nodeById.set(node.id, node);

  const childrenByParent = new Map<string, DesignNode[]>();
  const roots: DesignNode[] = [];
  for (const node of nodes) {
    if (node.onCanvas === false) continue;
    if (node.parentId && nodeById.has(node.parentId)) {
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node);
      childrenByParent.set(node.parentId, list);
    } else {
      roots.push(node);
    }
  }
  return { roots, childrenByParent, nodeById };
}

export function buildNodeCssDeclarations(
  node: DesignNode,
  tokens: DesignTokenCollection,
  options: {
    parent: DesignNode | null;
    isChildOfAutoLayout: boolean;
    isInstanceChild: boolean;
    hasRootAutoLayout: boolean;
    originOffset: { x: number; y: number };
    nodeById?: ReadonlyMap<string, DesignNode>;
    maskPrefix?: string;
  },
): string[] {
  const { parent, isChildOfAutoLayout, isInstanceChild, hasRootAutoLayout, originOffset, nodeById, maskPrefix } = options;
  const declarations: string[] = [];

  if (!node.visible) {
    declarations.push('display: none;');
  } else if (node.layout && node.layout.mode === 'flex') {
    declarations.push('display: flex;');
    declarations.push(`flex-direction: ${node.layout.direction};`);
    if (node.layout.wrap === 'wrap') declarations.push('flex-wrap: wrap;');
    declarations.push(`justify-content: ${mapJustifyContent(node.layout.justifyContent)};`);
    declarations.push(`align-items: ${mapAlignItems(node.layout.alignItems)};`);
    const gapVar = resolveTokenCssVar(tokens, node.tokenBindings?.gap);
    if (gapVar) {
      declarations.push(`gap: ${gapVar};`);
    } else {
      const rowGap = roundCss(node.layout.rowGap ?? node.layout.gap);
      const colGap = roundCss(node.layout.columnGap ?? node.layout.gap);
      declarations.push(rowGap === colGap ? `gap: ${rowGap}px;` : `gap: ${rowGap}px ${colGap}px;`);
    }
    const padVar = resolveTokenCssVar(tokens, node.tokenBindings?.padding);
    declarations.push(`padding: ${padVar ?? formatPadding(node.layout.padding)};`);
    if (node.layout.overflow === 'scroll') {
      declarations.push('overflow: auto;');
    } else if (node.layout.overflow === 'hidden') {
      declarations.push('overflow: hidden;');
    } else if (node.layout.overflow === 'visible') {
      declarations.push('overflow: visible;');
    }
  } else if (node.layout && node.layout.mode === 'grid') {
    declarations.push('display: grid;');
    const cols = Math.max(1, Math.round(node.layout.gridColumns ?? 2));
    declarations.push(`grid-template-columns: repeat(${cols}, minmax(0, 1fr));`);
    const gapVar = resolveTokenCssVar(tokens, node.tokenBindings?.gap);
    if (gapVar) {
      declarations.push(`gap: ${gapVar};`);
    } else {
      const rowGap = roundCss(node.layout.rowGap ?? node.layout.gap);
      const colGap = roundCss(node.layout.columnGap ?? node.layout.gap);
      declarations.push(rowGap === colGap ? `gap: ${rowGap}px;` : `gap: ${rowGap}px ${colGap}px;`);
    }
    const padVar = resolveTokenCssVar(tokens, node.tokenBindings?.padding);
    declarations.push(`padding: ${padVar ?? formatPadding(node.layout.padding)};`);
    if (node.layout.overflow === 'scroll') {
      declarations.push('overflow: auto;');
    } else if (node.layout.overflow === 'hidden') {
      declarations.push('overflow: hidden;');
    } else if (node.layout.overflow === 'visible') {
      declarations.push('overflow: visible;');
    }
  }

  const isAbsoluteInAutoLayout = isChildOfAutoLayout && node.layoutChild?.position === 'absolute';

  if (isChildOfAutoLayout && !isAbsoluteInAutoLayout) {
    declarations.push('position: relative;');
    const widthMode = node.layoutChild?.widthMode ?? 'fixed';
    const heightMode = node.layoutChild?.heightMode ?? 'fixed';
    const parentMode = parent?.layout?.mode ?? 'flex';
    const parentIsRow = parentMode === 'flex' && (parent?.layout?.direction ?? 'row') === 'row';
    const growWeight = Math.max(1, roundCss(node.layoutChild?.flexGrow ?? 1));

    if (widthMode === 'fill') {
      declarations.push('width: 100%;');
      if (parentIsRow) {
        declarations.push(`flex: ${growWeight} 1 0%;`);
      } else if (parentMode === 'flex') {
        declarations.push('align-self: stretch;');
      }
    } else if (widthMode === 'relative') {
      declarations.push(`width: ${roundCss(node.layoutChild?.widthPercent ?? 100)}%;`);
      if (parentIsRow) declarations.push('flex-shrink: 0;');
    } else if (widthMode === 'hug') {
      declarations.push('width: fit-content;');
    } else {
      declarations.push(`width: ${roundCss(node.width)}px;`);
    }

    if (heightMode === 'fill') {
      declarations.push('height: 100%;');
      if (!parentIsRow && parentMode === 'flex') {
        declarations.push(`flex: ${growWeight} 1 0%;`);
      } else {
        declarations.push('align-self: stretch;');
      }
    } else if (heightMode === 'relative') {
      declarations.push(`height: ${roundCss(node.layoutChild?.heightPercent ?? 100)}%;`);
    } else if (heightMode === 'hug') {
      declarations.push('height: fit-content;');
    } else if (node.type !== 'text') {
      declarations.push(`min-height: ${roundCss(node.height)}px;`);
    }

    if (parentMode === 'grid' && node.layoutChild?.gridColumnSpan && node.layoutChild.gridColumnSpan > 1) {
      declarations.push(`grid-column: span ${Math.round(node.layoutChild.gridColumnSpan)};`);
    }
    if (node.layoutChild?.minWidth !== undefined) declarations.push(`min-width: ${roundCss(node.layoutChild.minWidth)}px;`);
    if (node.layoutChild?.maxWidth !== undefined) declarations.push(`max-width: ${roundCss(node.layoutChild.maxWidth)}px;`);
    if (node.layoutChild?.minHeight !== undefined) declarations.push(`min-height: ${roundCss(node.layoutChild.minHeight)}px;`);
    if (node.layoutChild?.maxHeight !== undefined) declarations.push(`max-height: ${roundCss(node.layoutChild.maxHeight)}px;`);
    if (node.layoutChild?.alignSelf && node.layoutChild.alignSelf !== 'auto') {
      declarations.push(`align-self: ${mapAlignItems(node.layoutChild.alignSelf)};`);
    }
    if (node.layoutChild?.zIndex !== undefined) {
      declarations.push(`z-index: ${Math.round(node.layoutChild.zIndex)};`);
    }
  } else if (hasRootAutoLayout && !parent && !isInstanceChild) {
    declarations.push('position: relative;');
    const rootWMode = node.layoutChild?.widthMode ?? 'fill';
    const rootHMode = node.layoutChild?.heightMode ?? 'fixed';
    if (rootWMode === 'hug') declarations.push('width: fit-content;');
    else if (rootWMode === 'relative') declarations.push(`width: ${roundCss(node.layoutChild?.widthPercent ?? 100)}%;`);
    else if (rootWMode === 'fixed') declarations.push(`width: ${roundCss(node.width)}px;`);
    else declarations.push('width: 100%;');

    if (rootHMode === 'hug') declarations.push('height: fit-content;');
    else if (rootHMode === 'relative') declarations.push(`height: ${roundCss(node.layoutChild?.heightPercent ?? 100)}%;`);
    else declarations.push(`min-height: ${roundCss(node.height)}px;`);
  } else {
    const relX = roundCss(node.x - originOffset.x);
    const relY = roundCss(node.y - originOffset.y);
    declarations.push('position: absolute;');
    declarations.push(`left: ${relX}px;`);
    declarations.push(`top: ${relY}px;`);
    if (node.layoutChild?.widthMode === 'relative') {
      declarations.push(`width: ${roundCss(node.layoutChild.widthPercent ?? 100)}%;`);
    } else if (node.layoutChild?.widthMode === 'hug') {
      declarations.push('width: fit-content;');
    } else {
      declarations.push(`width: ${roundCss(node.width)}px;`);
    }
    if (node.layoutChild?.heightMode === 'relative') {
      declarations.push(`height: ${roundCss(node.layoutChild.heightPercent ?? 100)}%;`);
    } else if (node.layoutChild?.heightMode === 'hug') {
      declarations.push('height: fit-content;');
    } else if (node.type !== 'text') {
      declarations.push(`height: ${roundCss(node.height)}px;`);
    }
    if (node.layoutChild?.zIndex !== undefined) {
      declarations.push(`z-index: ${Math.round(node.layoutChild.zIndex)};`);
    }
  }

  if (Math.abs(node.rotation) > 0.01) {
    declarations.push(`transform: rotate(${roundCss(node.rotation)}deg);`);
  }
  if (node.opacity < 0.999) {
    declarations.push(`opacity: ${roundCss(node.opacity)};`);
  }

  if (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') {
    const fillVar = resolveTokenCssVar(tokens, node.tokenBindings?.fill);
    const strokeVar = resolveTokenCssVar(tokens, node.tokenBindings?.stroke);
    const radiusVar = resolveTokenCssVar(tokens, node.tokenBindings?.radius);
    const hasExplicitFills = Array.isArray(node.style.fills) && node.style.fills.length > 0;
    const multiFillBg = hasExplicitFills ? buildCssBackgroundFromFills(node.style.fills, node.style.fill) : null;
    const fillVal =
      multiFillBg && (!fillVar || (node.style.fills?.length ?? 0) > 1 || node.style.fills?.[0]?.type !== 'solid')
        ? multiFillBg
        : (fillVar ?? sanitizeCssValue(node.style.fill, 'transparent'));
    if (fillVal && fillVal !== 'none') {
      declarations.push(`background: ${fillVal};`);
    }
    if (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
      const strokeVal = strokeVar ?? sanitizeCssValue(node.style.stroke, 'transparent');
      const borderStyle = resolveCssBorderStyle(node.style.strokeDasharray);
      const sw = roundCss(node.style.strokeWidth);
      if (node.style.strokeAlign === 'outside') {
        declarations.push(`outline: ${sw}px ${borderStyle} ${strokeVal};`);
        declarations.push('outline-offset: 0;');
      } else if (node.style.strokeAlign === 'inside') {
        declarations.push('box-sizing: border-box;');
        declarations.push(`border: ${sw}px ${borderStyle} ${strokeVal};`);
      } else {
        declarations.push(`border: ${sw}px ${borderStyle} ${strokeVal};`);
      }
    }
    if (node.type === 'ellipse') {
      declarations.push('border-radius: 9999px;');
    } else if (radiusVar) {
      declarations.push(`border-radius: ${radiusVar};`);
    } else if (node.style.radius !== undefined && node.style.radius > 0) {
      declarations.push(`border-radius: ${roundCss(node.style.radius)}px;`);
    }
    if (node.type === 'frame' && node.clipContent) {
      declarations.push('overflow: hidden;');
    }
  } else if (node.type === 'image') {
    const strokeVar = resolveTokenCssVar(tokens, node.tokenBindings?.stroke);
    const radiusVar = resolveTokenCssVar(tokens, node.tokenBindings?.radius);
    declarations.push('display: block;');
    declarations.push(`object-fit: ${node.style.fit};`);
    const imgStrokeWidth = node.style.strokeWidth ?? 0;
    if (imgStrokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
      const strokeVal = strokeVar ?? sanitizeCssValue(node.style.stroke, 'transparent');
      const dasharray =
        'strokeDasharray' in node.style && typeof node.style.strokeDasharray === 'string'
          ? node.style.strokeDasharray
          : undefined;
      const borderStyle = resolveCssBorderStyle(dasharray);
      declarations.push(`border: ${roundCss(imgStrokeWidth)}px ${borderStyle} ${strokeVal};`);
    }
    if (radiusVar) {
      declarations.push(`border-radius: ${radiusVar};`);
    } else if (node.style.radius !== undefined && node.style.radius > 0) {
      declarations.push(`border-radius: ${roundCss(node.style.radius)}px;`);
    }
  } else if (node.type === 'text') {
    const fillVar = resolveTokenCssVar(tokens, node.tokenBindings?.fill);
    const fontSizeVar = resolveTokenCssVar(tokens, node.tokenBindings?.fontSize);
    declarations.push(`color: ${fillVar ?? sanitizeCssValue(node.style.fill, '#111827')};`);
    declarations.push(`font-family: ${sanitizeCssValue(node.style.fontFamily, 'system-ui, sans-serif')};`);
    declarations.push(`font-size: ${fontSizeVar ?? `${roundCss(node.style.fontSize)}px`};`);
    declarations.push(`font-weight: ${Math.round(node.style.fontWeight)};`);
    declarations.push(`line-height: ${roundCss(node.style.lineHeight)};`);
    if (Math.abs(node.style.letterSpacing) > 0.01) {
      declarations.push(`letter-spacing: ${roundCss(node.style.letterSpacing)}px;`);
    }
    if (node.style.textAlign && node.style.textAlign !== 'left') {
      declarations.push(`text-align: ${node.style.textAlign};`);
    }
    if (node.style.verticalAlign === 'middle' || node.style.verticalAlign === 'bottom') {
      declarations.push('display: flex;');
      declarations.push('flex-direction: column;');
      declarations.push(`justify-content: ${node.style.verticalAlign === 'middle' ? 'center' : 'flex-end'};`);
      declarations.push(`height: ${roundCss(node.height)}px;`);
    }
    if (node.style.textTransform && node.style.textTransform !== 'none') {
      declarations.push(`text-transform: ${node.style.textTransform};`);
    }
    if (node.style.textDecoration && node.style.textDecoration !== 'none') {
      declarations.push(`text-decoration: ${node.style.textDecoration};`);
    }
    declarations.push('margin: 0;');
    if (node.style.textWrap === 'nowrap') {
      declarations.push('white-space: pre;');
    } else {
      declarations.push('white-space: pre-wrap;');
      declarations.push('overflow-wrap: break-word;');
    }
  } else if (node.type === 'component-instance') {
    declarations.push('overflow: visible;');
  }

  if (node.clipMaskBaseId && nodeById) {
    const base = nodeById.get(node.clipMaskBaseId);
    if (base) {
      const mode: 'inside' | 'outside' = node.clipMaskMode === 'outside' ? 'outside' : 'inside';
      if (needsSvgMaskForClip(node, base)) {
        const maskId = buildVectorMaskId(maskPrefix ?? 'page', node.id, mode);
        declarations.push(`mask: url(#${maskId});`);
        declarations.push(`-webkit-mask: url(#${maskId});`);
      } else if (base.type === 'ellipse') {
        const rx = roundCss(Math.max(0.5, base.width / 2));
        const ry = roundCss(Math.max(0.5, base.height / 2));
        const cx = roundCss(base.x - node.x + base.width / 2);
        const cy = roundCss(base.y - node.y + base.height / 2);
        declarations.push(`clip-path: ellipse(${rx}px ${ry}px at ${cx}px ${cy}px);`);
      } else {
        const top = roundCss(base.y - node.y);
        const left = roundCss(base.x - node.x);
        const right = roundCss(node.x + node.width - (base.x + base.width));
        const bottom = roundCss(node.y + node.height - (base.y + base.height));
        const radius =
          (base.type === 'rect' || base.type === 'frame' || base.type === 'image') && base.style.radius
            ? roundCss(Math.max(0, base.style.radius))
            : 0;
        const roundPart = radius > 0 ? ` round ${radius}px` : '';
        declarations.push(`clip-path: inset(${top}px ${right}px ${bottom}px ${left}px${roundPart});`);
      }
    }
  }

  const effectAndBlendDecls = buildCssEffectsAndBlendDeclarations(node);
  if (effectAndBlendDecls.length > 0) {
    declarations.push(...effectAndBlendDecls);
  }

  return declarations;
}

function pushCssRule(
  lines: string[],
  selector: string,
  declarations: readonly string[],
  mappingMeta?: {
    nodeId: string;
    nodeName: string;
    pageId: string;
    category: 'mapped' | 'extension';
  },
  mappings?: CodeMappingEntry[],
): void {
  if (declarations.length === 0) return;
  const startLine = lines.length + 1;
  lines.push(`${selector} {`);
  for (const decl of declarations) {
    lines.push(`  ${decl}`);
  }
  lines.push('}');
  const endLine = lines.length;
  lines.push('');
  if (mappingMeta && mappings) {
    mappings.push({
      nodeId: mappingMeta.nodeId,
      nodeName: mappingMeta.nodeName,
      pageId: mappingMeta.pageId,
      category: mappingMeta.category,
      startLine,
      endLine,
      selector,
    });
  }
}

const MAX_COMPONENT_RENDER_DEPTH = 16;

export interface CompilePageHtmlCssOptions {
  assetMode?: 'bundle' | 'inline';
}

export function compilePageHtmlCss(
  inputProject: FolioProject,
  page: FolioPage,
  options: CompilePageHtmlCssOptions = {},
): CompiledPageArtifacts {
  const project = sanitizeProjectNetworkSecrets(inputProject);
  const assetMode = options.assetMode ?? 'bundle';
  const tokens = getProjectDesignTokens(project);
  const slug = toPageFileSlug(page.route, page.name);
  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );
  const assetsById = new Map<string, AssetReference>(
    project.assets.map((asset) => [asset.id, asset]),
  );

  const { roots, childrenByParent, nodeById } = buildChildrenMap(page.document.nodes);
  const htmlBodyLines: string[] = [];
  const htmlMappings: CodeMappingEntry[] = [];
  const cssLines: string[] = [
    `/* Mapped by FOLIO Code Engine — Page "${page.name}" (${page.route}) */`,
    '/* Structured AST layout, typography, semantic classes, and responsive rules. */',
    '',
  ];
  const cssMappings: CodeMappingEntry[] = [];
  const tabletRules: string[] = [];
  const mobileRules: string[] = [];

  const pageClass = `folio-page-${slug}`;
  const hasRootAutoLayout = roots.length > 0 && roots.every((node) => node.layout && node.layout.mode !== 'none');

  pushCssRule(cssLines, `.${pageClass}`, [
    'position: relative;',
    'width: 100%;',
    `max-width: ${roundCss(page.document.width)}px;`,
    `min-height: ${roundCss(page.document.height)}px;`,
    'margin: 0 auto;',
    `background: ${sanitizeCssValue(page.document.background, '#ffffff')};`,
    ...(hasRootAutoLayout
      ? ['display: flex;', 'flex-direction: column;', 'gap: 24px;']
      : ['overflow: hidden;']),
  ]);

  const emitNodeCss = (
    node: DesignNode,
    className: string,
    parent: DesignNode | null,
    isChildOfAutoLayout: boolean,
    isInstanceChild: boolean,
    originOffset: { x: number; y: number },
  ) => {
    const selector = `.${className}`;
    const declarations = buildNodeCssDeclarations(node, tokens, {
      parent,
      isChildOfAutoLayout,
      isInstanceChild,
      hasRootAutoLayout,
      originOffset,
      nodeById,
      maskPrefix: slug,
    });

    pushCssRule(
      cssLines,
      selector,
      declarations,
      isInstanceChild
        ? undefined
        : { nodeId: node.id, nodeName: node.name, pageId: page.id, category: 'mapped' },
      cssMappings,
    );

    if (node.responsive?.tablet) {
      const t = node.responsive.tablet;
      const tDecls: string[] = [];
      if (t.visible === false) tDecls.push('display: none;');
      if (t.width !== undefined) tDecls.push(`width: ${roundCss(t.width)}px;`);
      if (t.height !== undefined) tDecls.push(`min-height: ${roundCss(t.height)}px;`);
      if (t.layoutDirection) tDecls.push(`flex-direction: ${t.layoutDirection};`);
      if (t.gridColumns !== undefined) tDecls.push(`grid-template-columns: repeat(${Math.max(1, Math.round(t.gridColumns))}, minmax(0, 1fr));`);
      if (t.gap !== undefined) tDecls.push(`gap: ${roundCss(t.gap)}px;`);
      if (t.padding) tDecls.push(`padding: ${formatPadding(t.padding)};`);
      if (tDecls.length > 0) {
        tabletRules.push(`  ${selector} { ${tDecls.join(' ')} }`);
      }
    }

    if (node.responsive?.mobile) {
      const m = node.responsive.mobile;
      const mDecls: string[] = [];
      if (m.visible === false) mDecls.push('display: none;');
      if (m.width !== undefined) mDecls.push(`width: ${roundCss(m.width)}px;`);
      if (m.height !== undefined) mDecls.push(`min-height: ${roundCss(m.height)}px;`);
      if (m.layoutDirection) mDecls.push(`flex-direction: ${m.layoutDirection};`);
      if (m.gridColumns !== undefined) mDecls.push(`grid-template-columns: repeat(${Math.max(1, Math.round(m.gridColumns))}, minmax(0, 1fr));`);
      if (m.gap !== undefined) mDecls.push(`gap: ${roundCss(m.gap)}px;`);
      if (m.padding) mDecls.push(`padding: ${formatPadding(m.padding)};`);
      if (mDecls.length > 0) {
        mobileRules.push(`  ${selector} { ${mDecls.join(' ')} }`);
      }
    }
  };

  const emitNodeHtml = (
    node: DesignNode,
    parent: DesignNode | null,
    depth: number,
    isChildOfAutoLayout: boolean,
    isInstanceChild: boolean,
    originOffset: { x: number; y: number },
    htmlLineOffset: number,
    activeChildrenByParent: Map<string, DesignNode[]>,
    idPrefix: string,
    visitedComponentIds: ReadonlySet<string>,
    componentDepth: number,
  ) => {
    const indent = '  '.repeat(depth);
    const emittedId = idPrefix ? `${idPrefix}${node.id}` : node.id;
    const className = toCssClassName('f', node.name, emittedId);
    emitNodeCss(node, className, parent, isChildOfAutoLayout, isInstanceChild, originOffset);

    const tag = resolveSemanticTag(node);
    const attrs: string[] = [
      `class="${escapeAttr(className)}"`,
      `data-folio-id="${escapeAttr(emittedId)}"`,
    ];
    if (node.ariaLabel?.trim()) {
      attrs.push(`aria-label="${escapeAttr(node.ariaLabel.trim())}"`);
    }
    if (tag === 'a') {
      const safeHref = sanitizeHref(node.href);
      attrs.push(`href="${escapeAttr(safeHref ?? '#')}"`);
    }
    if (tag === 'button') {
      attrs.push('type="button"');
    }
    if (node.type === 'component-instance') {
      attrs.push(`data-folio-component="${escapeAttr(node.componentId)}"`);
    }

    const startLine = htmlLineOffset + htmlBodyLines.length + 1;

    if (node.type === 'text') {
      htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}>${escapeHtml(node.text)}</${tag}>`);
    } else if (node.type === 'image') {
      const asset = assetsById.get(node.assetId);
      const src = asset
        ? assetMode === 'inline'
          ? (resolveAssetDisplayUrl(asset) ?? '')
          : `../${getAssetBundlePath(asset)}`
        : '';
      const alt = node.alt ?? node.name;
      htmlBodyLines.push(
        `${indent}<img ${attrs.join(' ')} src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`,
      );
    } else if (node.type === 'path') {
      htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}>`);
      htmlBodyLines.push(...buildInlineSvgMarkup(node, tokens, `${indent}  `));
      htmlBodyLines.push(`${indent}</${tag}>`);
    } else if (node.type === 'component-instance') {
      const master = componentsById.get(node.componentId);
      if (master && !visitedComponentIds.has(master.id) && componentDepth < MAX_COMPONENT_RENDER_DEPTH) {
        const nextVisited = new Set(visitedComponentIds);
        nextVisited.add(master.id);
        const resolvedChildren = resolveComponentInstanceNodes(node, master, tokens);
        const childMap = buildChildrenMap(resolvedChildren);
        const masterW = Math.max(1, master.document.width);
        const masterH = Math.max(1, master.document.height);
        const scaleX = node.width / masterW;
        const scaleY = node.height / masterH;
        const needsScale = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
        const childPrefix = `${emittedId}__`;
        htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}>`);
        if (needsScale) {
          const innerClass = `${className}__inner`;
          pushCssRule(cssLines, `.${innerClass}`, [
            'position: relative;',
            `width: ${roundCss(masterW)}px;`,
            `height: ${roundCss(masterH)}px;`,
            'transform-origin: top left;',
            `transform: scale(${roundCss(scaleX)}, ${roundCss(scaleY)});`,
          ]);
          htmlBodyLines.push(`${indent}  <div class="${escapeAttr(innerClass)}">`);
          for (const child of childMap.roots) {
            emitNodeHtml(
              child,
              node,
              depth + 2,
              false,
              true,
              { x: 0, y: 0 },
              htmlLineOffset,
              childMap.childrenByParent,
              childPrefix,
              nextVisited,
              componentDepth + 1,
            );
          }
          htmlBodyLines.push(`${indent}  </div>`);
        } else {
          for (const child of childMap.roots) {
            emitNodeHtml(
              child,
              node,
              depth + 1,
              false,
              true,
              { x: 0, y: 0 },
              htmlLineOffset,
              childMap.childrenByParent,
              childPrefix,
              nextVisited,
              componentDepth + 1,
            );
          }
        }
        htmlBodyLines.push(`${indent}</${tag}>`);
      } else {
        htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}></${tag}>`);
      }
    } else {
      const children = activeChildrenByParent.get(node.id) ?? [];
      const selfIsAutoLayout = Boolean(node.layout && node.layout.mode !== 'none');
      if (children.length === 0) {
        htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}></${tag}>`);
      } else {
        htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}>`);
        const nextOrigin = { x: node.x, y: node.y };
        for (const child of children) {
          emitNodeHtml(
            child,
            node,
            depth + 1,
            selfIsAutoLayout,
            isInstanceChild,
            nextOrigin,
            htmlLineOffset,
            activeChildrenByParent,
            idPrefix,
            visitedComponentIds,
            componentDepth,
          );
        }
        htmlBodyLines.push(`${indent}</${tag}>`);
      }
    }

    const endLine = htmlLineOffset + htmlBodyLines.length;
    if (!isInstanceChild) {
      htmlMappings.push({
        nodeId: node.id,
        nodeName: node.name,
        pageId: page.id,
        category: 'mapped',
        startLine,
        endLine,
        selector: `.${className}`,
      });
    }
  };

  const googleFontsUrl = buildGoogleFontsStylesheetUrl(collectProjectGoogleFonts(project));

  const htmlPreambleLines = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${escapeHtml(project.metadata.name)} — ${escapeHtml(page.name)}</title>`,
    ...(googleFontsUrl
      ? [
          '  <link rel="preconnect" href="https://fonts.googleapis.com" />',
          '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
          `  <link rel="stylesheet" href="${escapeAttr(googleFontsUrl)}" />`,
        ]
      : []),
    '  <link rel="stylesheet" href="../styles/tokens.css" />',
    `  <link rel="stylesheet" href="../styles/${slug}.css" />`,
  ];

  const customCssModules = (project.codeModules ?? []).filter(
    (mod) => mod.language === 'css' && (!mod.targetPageId || mod.targetPageId === page.id),
  );
  for (const mod of customCssModules) {
    htmlPreambleLines.push(`  <link rel="stylesheet" href="../${escapeAttr(mod.path)}" />`);
  }

  htmlPreambleLines.push(
    '</head>',
    '<body>',
    `  <main class="${escapeAttr(pageClass)}" data-folio-page="${escapeAttr(page.id)}">`,
  );

  const htmlLineOffset = htmlPreambleLines.length;
  const pageMaskDefs = buildVectorMaskDefsLines(page.document.nodes, slug, false, '    ');
  if (pageMaskDefs.length > 0) {
    htmlBodyLines.push(...pageMaskDefs);
  }
  const emptyVisited = new Set<string>();
  for (const root of roots) {
    emitNodeHtml(
      root,
      null,
      2,
      false,
      false,
      { x: 0, y: 0 },
      htmlLineOffset,
      childrenByParent,
      '',
      emptyVisited,
      0,
    );
  }

  if (tabletRules.length > 0) {
    cssLines.push('@media (max-width: 768px) {');
    cssLines.push(...tabletRules);
    cssLines.push('}');
    cssLines.push('');
  }
  if (mobileRules.length > 0) {
    cssLines.push('@media (max-width: 390px) {');
    cssLines.push(...mobileRules);
    cssLines.push('}');
    cssLines.push('');
  }

  const animationsCss = compilePageAnimationsCss(project, page);
  if (animationsCss) {
    cssLines.push(animationsCss);
    cssLines.push('');
  }

  const pageHtmlContent = [
    ...htmlPreambleLines,
    ...htmlBodyLines,
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  const pageCssContent = `${cssLines.join('\n').trimEnd()}\n`;

  const htmlFile: CompiledCodeFile = {
    id: `mapped:html:${page.id}`,
    path: `pages/${slug}.html`,
    language: 'html',
    category: 'mapped',
    readOnly: false,
    content: pageHtmlContent,
    pageId: page.id,
    description: `Semantic HTML5 markup mapped to Folio page "${page.name}" (${page.route}).`,
    mappings: htmlMappings,
  };

  const cssFile: CompiledCodeFile = {
    id: `mapped:css:${page.id}`,
    path: `styles/${slug}.css`,
    language: 'css',
    category: 'mapped',
    readOnly: false,
    content: pageCssContent,
    pageId: page.id,
    description: `Auto-Layout, typography, token bindings, and responsive CSS for "${page.name}".`,
    mappings: cssMappings,
  };

  return {
    htmlFile,
    cssFile,
    bodyInnerHtml: `  <main class="${escapeAttr(pageClass)}" data-folio-page="${escapeAttr(page.id)}">\n${htmlBodyLines.join('\n')}\n  </main>`,
    pageCssContent,
  };
}

export interface LivePreviewOptions {
  pageId?: string;
  themeId?: string;
  includeCustomScripts?: boolean;
  includeLogicRuntime?: boolean;
}

function sanitizeCommentLabel(value: string): string {
  return value
    .replace(/\*\//g, '* /')
    .replace(/<\/style/gi, '<\\/style')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/[\r\n]+/g, ' ');
}

export const LIVE_PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; script-src 'unsafe-inline'; img-src data: blob:; font-src data: https://fonts.gstatic.com;";

/**
 * Compiles a complete, self-contained HTML5 document for Folio's sandboxed
 * Live Preview (`<iframe sandbox="allow-scripts">`).
 *
 * Security guarantees:
 * - Strict CSP blocks outbound network requests (fetch/XHR/beacons/external scripts/images)
 *   while allowing curated Google Fonts stylesheets/woff2 assets.
 * - All AST text/attributes are HTML-escaped; URLs are protocol-allowlisted.
 * - All CSS blocks & module comments neutralize `</style` breakout.
 * - Custom JS is optional and neutralizes `</script` breakout; host iframe
 *   NEVER grants `allow-same-origin`.
 */
export function buildLivePreviewHtml(
  inputProject: FolioProject,
  options: LivePreviewOptions = {},
): string {
  const project = sanitizeProjectNetworkSecrets(inputProject);
  const page =
    (options.pageId ? project.pages.find((item) => item.id === options.pageId) : undefined) ??
    getActivePage(project);
  const tokens = getProjectDesignTokens(project);
  const activeThemeId = options.themeId ?? tokens.activeThemeId;
  const activeTheme = tokens.themes.find((theme) => theme.id === activeThemeId) ?? tokens.themes[0];
  const themeAttr =
    activeTheme && activeTheme.id !== tokens.themes[0]?.id
      ? ` data-theme="${escapeAttr(toDesignTokenThemeSlug(activeTheme.name))}"`
      : '';

  const tokensCss = compileTokensCssFile(project).content;
  const compiledPage = compilePageHtmlCss(project, page, { assetMode: 'inline' });
  const googleFontsUrl = buildGoogleFontsStylesheetUrl(collectProjectGoogleFonts(project));

  const modules: readonly CodeModuleRecord[] = project.codeModules ?? [];
  const customCssBlocks = modules
    .filter((mod) => mod.language === 'css' && mod.mapping === 'custom' && (!mod.targetPageId || mod.targetPageId === page.id))
    .map((mod) => `/* Custom Module: ${sanitizeCommentLabel(mod.path)} */\n${sanitizeCssText(mod.content)}`);

  const extensionCssBlocks = modules
    .filter((mod) => mod.language === 'css' && mod.mapping === 'extension' && (!mod.targetPageId || mod.targetPageId === page.id))
    .map((mod) => `/* Node Extension: ${sanitizeCommentLabel(mod.path)} */\n${sanitizeCssText(mod.content)}`);

  const logicScript =
    options.includeLogicRuntime !== false
      ? buildLivePreviewLogicScript(project, page)
      : null;

  const customJsBlocks = options.includeCustomScripts
    ? modules
        .filter((mod) => mod.language === 'js' && (!mod.targetPageId || mod.targetPageId === page.id))
        .map((mod) => `/* Custom Script: ${sanitizeCommentLabel(mod.path)} */\n${sanitizeJsText(mod.content)}`)
    : [];

  const allScriptBlocks = [
    ...(logicScript ? [logicScript] : []),
    ...customJsBlocks,
  ];

  const baseResetCss = [
    '*, *::before, *::after { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; min-height: 100%; background: var(--surface-canvas, #f5f2ec); color: var(--text-primary, #1d1f28); font-family: system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }',
    'a { color: inherit; text-decoration: none; }',
    'button { font: inherit; cursor: pointer; background: none; border: none; padding: 0; }',
  ].join('\n');

  const combinedStyles = [
    baseResetCss,
    sanitizeCssText(tokensCss),
    sanitizeCssText(compiledPage.pageCssContent),
    ...customCssBlocks,
    ...extensionCssBlocks,
  ].join('\n\n');

  const scriptTag = allScriptBlocks.length > 0
    ? `\n  <script>\n${allScriptBlocks.join('\n\n')}\n  </script>`
    : '';

  return [
    '<!DOCTYPE html>',
    `<html lang="en"${themeAttr}>`,
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <meta http-equiv="Content-Security-Policy" content="${LIVE_PREVIEW_CSP}" />`,
    `  <title>${escapeHtml(project.metadata.name)} — ${escapeHtml(page.name)}</title>`,
    ...(googleFontsUrl
      ? [`  <link rel="stylesheet" href="${escapeAttr(googleFontsUrl)}" />`]
      : []),
    '  <style>',
    combinedStyles,
    '  </style>',
    '</head>',
    '<body>',
    compiledPage.bodyInnerHtml,
    scriptTag,
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n');
}
