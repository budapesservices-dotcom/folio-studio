import { resolveComponentInstanceNodes } from '../../core/document/components';
import {
  buildCustomFontFaceCss,
  buildGoogleFontsStylesheetUrl,
  collectProjectGoogleFonts,
} from '../../core/document/fonts';
import { sanitizeProjectNetworkSecrets } from '../../core/document/networkSecrets';
import { getActivePage } from '../../core/document/project';
import {
  formatCssLengthValue,
  isSafeCssGridTemplate,
  isSafeHtmlClassName,
  isSafeHtmlId,
  normalizeCssAspectRatio,
} from '../../core/document/cssUnits';
import {
  buildCssBackgroundFromFills,
  buildCssEffectsAndBlendDeclarations,
  buildNodeTransitionCss,
  resolveShadowPresetCss,
} from '../../core/document/styling';
import {
  generateDesignTokensCss,
  getProjectDesignTokens,
  toCssVariableName,
  toDesignTokenThemeSlug,
} from '../../core/document/tokens';
import type {
  AssetReference,
  BorderSidesConfig,
  CodeModuleRecord,
  ComponentDefinition,
  CornerRadiiConfig,
  CssLengthUnit,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  NodeLayoutConfig,
  NodePadding,
  PathNode,
  PseudoStateKey,
  SemanticHtmlTag,
} from '../../core/document/types';
import { serializePathPointsToSvgD } from '../../core/document/vector';
import {
  applyMorphGeometryToDesignNode,
  extractMorphSnapshotFromNode,
} from '../../core/document/pathMorph';
import { getAssetBundlePath, resolveAssetDisplayUrl, resolvePortableAssetUrl } from '../../core/persistence/assetStore';
import {
  escapeAttr,
  escapeHtml,
  sanitizeCommentLabel,
  sanitizeCssText,
  sanitizeCssValue,
  sanitizeHref,
  sanitizeJsText,
  sanitizeRelativeModulePath,
  toCssClassName,
  toPageFileSlug,
} from './sanitize';
import type { CodeMappingEntry, CompiledCodeFile } from './types';
import { buildLivePreviewLogicScript } from '../prototype/codegen';
import {
  buildLivePreviewMorphScript,
  collectPageMorphNodeIds,
  compilePageAnimationsCss,
} from '../animation/codegen';
import { applyAutoLayoutToNodes } from '../layout/autoLayout';

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

function mapGridJustifyItems(value: NodeLayoutConfig['justifyContent']): string | null {
  switch (value) {
    case 'center': return 'center';
    case 'end': return 'end';
    case 'start': return 'start';
    default:
      return null;
  }
}

export function getNodeBorderInset(node: DesignNode | null | undefined): { top: number; left: number } {
  if (!node) return { top: 0, left: 0 };
  if (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') {
    if (node.style.borderSides) {
      const topSide = node.style.borderSides.top;
      const leftSide = node.style.borderSides.left;
      const top = topSide && topSide.width > 0 && topSide.color && topSide.color !== 'none'
        && (!topSide.widthUnit || topSide.widthUnit === 'px')
        ? topSide.width
        : 0;
      const left = leftSide && leftSide.width > 0 && leftSide.color && leftSide.color !== 'none'
        && (!leftSide.widthUnit || leftSide.widthUnit === 'px')
        ? leftSide.width
        : 0;
      return { top, left };
    }
    const sw = node.style.strokeWidth;
    if (
      sw > 0
      && node.style.stroke
      && node.style.stroke !== 'none'
      && node.style.strokeAlign !== 'outside'
      && (!node.style.strokeWidthUnit || node.style.strokeWidthUnit === 'px')
    ) {
      return { top: sw, left: sw };
    }
  } else if (node.type === 'image') {
    if (node.style.borderSides) {
      const topSide = node.style.borderSides.top;
      const leftSide = node.style.borderSides.left;
      const top = topSide && topSide.width > 0 && topSide.color && topSide.color !== 'none'
        && (!topSide.widthUnit || topSide.widthUnit === 'px')
        ? topSide.width
        : 0;
      const left = leftSide && leftSide.width > 0 && leftSide.color && leftSide.color !== 'none'
        && (!leftSide.widthUnit || leftSide.widthUnit === 'px')
        ? leftSide.width
        : 0;
      return { top, left };
    }
    const sw = node.style.strokeWidth ?? 0;
    if (
      sw > 0
      && node.style.stroke
      && node.style.stroke !== 'none'
      && (!node.style.strokeWidthUnit || node.style.strokeWidthUnit === 'px')
    ) {
      return { top: sw, left: sw };
    }
  }
  return { top: 0, left: 0 };
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

const VOID_HTML_TAGS = new Set<SemanticHtmlTag>(['img', 'input']);

export function isVoidHtmlTag(tag: SemanticHtmlTag): boolean {
  return VOID_HTML_TAGS.has(tag);
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
  isMorphTarget = false,
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
  const morphAttr = isMorphTarget ? ' data-folio-morph-path="true"' : '';

  const svgLines: string[] = [
    `${indent}<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" overflow="visible" style="display:block;width:100%;height:100%" aria-hidden="true">`,
    `${indent}  <path${morphAttr} d="${escapeAttr(d)}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}"${fillRule}${linecap}${linejoin}${dash} />`,
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
  if (Math.abs(node.rotation) > 0.01) return true;
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

    const nodeRot = node.type === 'group' ? 0 : (node.rotation || 0);
    const wrappedShapeEl = Math.abs(nodeRot) > 0.01
      ? `<g transform="${escapeAttr(`rotate(${roundCss(-nodeRot)} ${roundCss(node.width / 2)} ${roundCss(node.height / 2)})`)}">${shapeEl}</g>`
      : shapeEl;

    maskBlocks.push(
      `${indent}    <mask id="${escapeAttr(maskId)}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">`,
      `${indent}      <rect x="-10000" y="-10000" width="20000" height="20000" fill="${bgFill}" />`,
      `${indent}      ${wrappedShapeEl}`,
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

export interface CompileTokensCssOptions {
  readonly assetMode?: 'bundle' | 'inline' | 'portable';
  readonly bundlePrefix?: '../' | '/';
}

export function compileTokensCssFile(
  project: FolioProject,
  options: CompileTokensCssOptions = {},
): CompiledCodeFile {
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
  const customFontFaceCss =
    options.assetMode === 'bundle'
      ? buildCustomFontFaceCss(project.assets, {
          resolveHref: (asset) => `${options.bundlePrefix ?? '../'}${getAssetBundlePath(asset)}`,
          mode: 'portable',
        })
      : buildCustomFontFaceCss(project.assets, {
          mode: options.assetMode === 'portable' ? 'portable' : 'display',
        });
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

function emitOverflowAndScrollSnap(layout: NodeLayoutConfig, declarations: string[]): void {
  if (layout.overflow === 'scroll' || layout.overflow === 'auto') {
    declarations.push('overflow: auto;');
  } else if (layout.overflow === 'scroll-y') {
    declarations.push('overflow-y: auto;');
    declarations.push('overflow-x: hidden;');
  } else if (layout.overflow === 'scroll-x') {
    declarations.push('overflow-x: auto;');
    declarations.push('overflow-y: hidden;');
  } else if (layout.overflow === 'hidden') {
    declarations.push('overflow: hidden;');
  } else if (layout.overflow === 'visible') {
    declarations.push('overflow: visible;');
  }

  if (layout.scrollSnapType === 'x') {
    declarations.push('scroll-snap-type: x mandatory;');
  } else if (layout.scrollSnapType === 'y') {
    declarations.push('scroll-snap-type: y mandatory;');
  }
}

function formatPaddingWithUnit(padding: NodePadding, unit: CssLengthUnit = 'px'): string {
  const t = roundCss(padding.top);
  const r = roundCss(padding.right);
  const b = roundCss(padding.bottom);
  const l = roundCss(padding.left);
  if (t === r && r === b && b === l) return `${t}${unit}`;
  if (t === b && l === r) return `${t}${unit} ${r}${unit}`;
  return `${t}${unit} ${r}${unit} ${b}${unit} ${l}${unit}`;
}

function emitBorderSidesCss(borderSides: BorderSidesConfig, declarations: string[]): boolean {
  let emitted = false;
  const sideEntries: Array<['top' | 'right' | 'bottom' | 'left', BorderSidesConfig['top']]> = [
    ['top', borderSides.top],
    ['right', borderSides.right],
    ['bottom', borderSides.bottom],
    ['left', borderSides.left],
  ];
  for (const [side, cfg] of sideEntries) {
    if (!cfg || cfg.width <= 0 || !cfg.color || cfg.color === 'none') continue;
    const unit = cfg.widthUnit ?? 'px';
    const style = cfg.style ?? 'solid';
    const color = sanitizeCssValue(cfg.color, 'transparent');
    declarations.push(`border-${side}: ${roundCss(cfg.width)}${unit} ${style} ${color};`);
    emitted = true;
  }
  return emitted;
}

function formatCornerRadiiCss(radii: CornerRadiiConfig, unit: CssLengthUnit = 'px'): string {
  const tl = roundCss(radii.topLeft);
  const tr = roundCss(radii.topRight);
  const br = roundCss(radii.bottomRight);
  const bl = roundCss(radii.bottomLeft);
  if (tl === tr && tr === br && br === bl) return `${tl}${unit}`;
  return `${tl}${unit} ${tr}${unit} ${br}${unit} ${bl}${unit}`;
}

export interface PseudoStateCssRule {
  readonly selector: string;
  readonly declarations: string[];
}

const PSEUDO_STATE_ORDER: readonly PseudoStateKey[] = ['hover', 'focus', 'active', 'disabled'];

/**
 * Generates deterministic CSS pseudo-state rules (:hover, :focus, :active, :disabled)
 * shared across HTML/CSS Compiler, Live Preview, and React TSX Compiler.
 */
export function buildNodePseudoStateCssRules(
  node: DesignNode,
  selector: string,
): PseudoStateCssRule[] {
  const overrides = node.stateOverrides;
  if (!overrides) return [];
  const rules: PseudoStateCssRule[] = [];

  for (const stateKey of PSEUDO_STATE_ORDER) {
    const patch = overrides[stateKey];
    if (!patch) continue;
    const decls: string[] = [];
    if (patch.fill) {
      const safeFill = sanitizeCssValue(patch.fill, 'transparent');
      if (node.type === 'text') {
        decls.push(`color: ${safeFill};`);
      } else {
        decls.push(`background: ${safeFill};`);
      }
    }
    if (patch.stroke) {
      decls.push(`border-color: ${sanitizeCssValue(patch.stroke, 'transparent')};`);
    }
    if (patch.strokeWidth !== undefined) {
      decls.push(`border-width: ${roundCss(patch.strokeWidth)}px;`);
      if (!patch.stroke) {
        decls.push('border-style: solid;');
      }
    }
    if (patch.opacity !== undefined) {
      decls.push(`opacity: ${roundCss(patch.opacity)};`);
    }
    if (patch.radius !== undefined) {
      decls.push(`border-radius: ${roundCss(patch.radius)}px;`);
    }
    const transforms: string[] = [];
    if (Math.abs(node.rotation) > 0.01) {
      transforms.push(`rotate(${roundCss(node.rotation)}deg)`);
    }
    if (patch.translateY !== undefined && Math.abs(patch.translateY) > 0.01) {
      transforms.push(`translateY(${roundCss(patch.translateY)}px)`);
    }
    if (patch.scale !== undefined && Math.abs(patch.scale - 1) > 0.001) {
      transforms.push(`scale(${roundCss(patch.scale)})`);
    }
    if (transforms.length > 0 && (patch.translateY !== undefined || patch.scale !== undefined)) {
      decls.push(`transform: ${transforms.join(' ')};`);
    }
    if (patch.shadowPreset) {
      const shadowVal = resolveShadowPresetCss(patch.shadowPreset);
      if (shadowVal) decls.push(`box-shadow: ${shadowVal};`);
    }
    if (decls.length > 0) {
      const stateSelector =
        stateKey === 'disabled'
          ? `${selector}:disabled, ${selector}[aria-disabled="true"]`
          : `${selector}:${stateKey}`;
      rules.push({ selector: stateSelector, declarations: decls });
    }
  }
  return rules;
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
    morphNodeIds?: ReadonlySet<string>;
    emittedId?: string;
  },
): string[] {
  const {
    parent,
    isChildOfAutoLayout,
    isInstanceChild,
    hasRootAutoLayout,
    originOffset,
    nodeById,
    maskPrefix,
    morphNodeIds,
    emittedId,
  } = options;
  const declarations: string[] = [];

  if (!node.visible) {
    declarations.push('display: none;');
  } else if (node.layout && node.layout.mode === 'flex') {
    declarations.push('display: flex;');
    declarations.push(`flex-direction: ${node.layout.direction};`);
    if (node.layout.wrap === 'wrap') {
      declarations.push('flex-wrap: wrap;');
      declarations.push('align-content: flex-start;');
    }
    declarations.push(`justify-content: ${mapJustifyContent(node.layout.justifyContent)};`);
    declarations.push(`align-items: ${mapAlignItems(node.layout.alignItems)};`);
    const gapVar = resolveTokenCssVar(tokens, node.tokenBindings?.gap);
    if (gapVar) {
      declarations.push(`gap: ${gapVar};`);
    } else {
      const rowGap = roundCss(node.layout.rowGap ?? node.layout.gap);
      const colGap = roundCss(node.layout.columnGap ?? node.layout.gap);
      const rowUnit = node.layout.rowGapUnit ?? node.layout.gapUnit ?? 'px';
      const colUnit = node.layout.columnGapUnit ?? node.layout.gapUnit ?? 'px';
      declarations.push(
        rowGap === colGap && rowUnit === colUnit
          ? `gap: ${rowGap}${rowUnit};`
          : `gap: ${rowGap}${rowUnit} ${colGap}${colUnit};`,
      );
    }
    const padVar = resolveTokenCssVar(tokens, node.tokenBindings?.padding);
    declarations.push(
      `padding: ${padVar ?? formatPaddingWithUnit(node.layout.padding, node.layout.paddingUnit ?? 'px')};`,
    );
    emitOverflowAndScrollSnap(node.layout, declarations);
  } else if (node.layout && node.layout.mode === 'grid') {
    declarations.push('display: grid;');
    const colMode = node.layout.gridColumnsMode ?? 'fixed';
    if (colMode === 'auto-fit') {
      const minW = formatCssLengthValue(node.layout.gridMinColumnWidth ?? { value: 220, unit: 'px' });
      declarations.push(`grid-template-columns: repeat(auto-fit, minmax(${minW}, 1fr));`);
    } else if (colMode === 'custom' && node.layout.gridTemplateColumns && isSafeCssGridTemplate(node.layout.gridTemplateColumns)) {
      declarations.push(`grid-template-columns: ${node.layout.gridTemplateColumns.trim()};`);
    } else {
      const cols = Math.max(1, Math.round(node.layout.gridColumns ?? 2));
      declarations.push(`grid-template-columns: repeat(${cols}, minmax(0, 1fr));`);
    }

    if (node.layout.gridRowsMode === 'fixed' && node.layout.gridRows && node.layout.gridRows >= 1) {
      declarations.push(`grid-template-rows: repeat(${Math.round(node.layout.gridRows)}, minmax(0, 1fr));`);
    } else if (
      node.layout.gridRowsMode === 'custom'
      && node.layout.gridTemplateRows
      && isSafeCssGridTemplate(node.layout.gridTemplateRows)
    ) {
      declarations.push(`grid-template-rows: ${node.layout.gridTemplateRows.trim()};`);
    } else {
      declarations.push('align-content: start;');
    }

    if (node.layout.justifyContent && node.layout.justifyContent !== 'start') {
      const gridJustifyItems = mapGridJustifyItems(node.layout.justifyContent);
      if (gridJustifyItems) {
        declarations.push(`justify-items: ${gridJustifyItems};`);
      } else {
        declarations.push(`justify-content: ${mapJustifyContent(node.layout.justifyContent)};`);
      }
    }
    if (node.layout.alignItems && node.layout.alignItems !== 'stretch') {
      declarations.push(`align-items: ${mapAlignItems(node.layout.alignItems)};`);
    }

    const gapVar = resolveTokenCssVar(tokens, node.tokenBindings?.gap);
    if (gapVar) {
      declarations.push(`gap: ${gapVar};`);
    } else {
      const rowGap = roundCss(node.layout.rowGap ?? node.layout.gap);
      const colGap = roundCss(node.layout.columnGap ?? node.layout.gap);
      const rowUnit = node.layout.rowGapUnit ?? node.layout.gapUnit ?? 'px';
      const colUnit = node.layout.columnGapUnit ?? node.layout.gapUnit ?? 'px';
      declarations.push(
        rowGap === colGap && rowUnit === colUnit
          ? `gap: ${rowGap}${rowUnit};`
          : `gap: ${rowGap}${rowUnit} ${colGap}${colUnit};`,
      );
    }
    const padVar = resolveTokenCssVar(tokens, node.tokenBindings?.padding);
    declarations.push(
      `padding: ${padVar ?? formatPaddingWithUnit(node.layout.padding, node.layout.paddingUnit ?? 'px')};`,
    );
    emitOverflowAndScrollSnap(node.layout, declarations);
  } else if (node.layout && node.layout.mode === 'none') {
    emitOverflowAndScrollSnap(node.layout, declarations);
  }

  const explicitPosition = node.layoutChild?.position;
  const isOutOfFlowInAutoLayout =
    isChildOfAutoLayout && (explicitPosition === 'absolute' || explicitPosition === 'fixed');
  const resolvedFixedWidth = node.layoutChild?.widthValue
    ? formatCssLengthValue(node.layoutChild.widthValue)
    : `${roundCss(node.width)}px`;
  const resolvedFixedHeight = node.layoutChild?.heightValue
    ? formatCssLengthValue(node.layoutChild.heightValue)
    : `${roundCss(node.height)}px`;

  const emitBoundsAndPositionExtras = () => {
    const cfg = node.layoutChild;
    if (!cfg) return;
    if (cfg.minWidthValue) declarations.push(`min-width: ${formatCssLengthValue(cfg.minWidthValue)};`);
    else if (cfg.minWidth !== undefined) declarations.push(`min-width: ${roundCss(cfg.minWidth)}px;`);
    if (cfg.maxWidthValue) declarations.push(`max-width: ${formatCssLengthValue(cfg.maxWidthValue)};`);
    else if (cfg.maxWidth !== undefined) declarations.push(`max-width: ${roundCss(cfg.maxWidth)}px;`);
    if (cfg.minHeightValue) declarations.push(`min-height: ${formatCssLengthValue(cfg.minHeightValue)};`);
    else if (cfg.minHeight !== undefined) declarations.push(`min-height: ${roundCss(cfg.minHeight)}px;`);
    if (cfg.maxHeightValue) declarations.push(`max-height: ${formatCssLengthValue(cfg.maxHeightValue)};`);
    else if (cfg.maxHeight !== undefined) declarations.push(`max-height: ${roundCss(cfg.maxHeight)}px;`);
    if (cfg.aspectRatio) {
      const normalized = normalizeCssAspectRatio(cfg.aspectRatio);
      if (normalized && normalized !== 'auto') {
        declarations.push(`aspect-ratio: ${normalized};`);
      }
    }
    if (cfg.scrollSnapAlign && cfg.scrollSnapAlign !== 'none') {
      declarations.push(`scroll-snap-align: ${cfg.scrollSnapAlign};`);
    }
  };

  const emitExplicitInsets = () => {
    const inset = node.layoutChild?.inset;
    if (!inset) return false;
    let hasInset = false;
    if (inset.top) { declarations.push(`top: ${formatCssLengthValue(inset.top)};`); hasInset = true; }
    if (inset.right) { declarations.push(`right: ${formatCssLengthValue(inset.right)};`); hasInset = true; }
    if (inset.bottom) { declarations.push(`bottom: ${formatCssLengthValue(inset.bottom)};`); hasInset = true; }
    if (inset.left) { declarations.push(`left: ${formatCssLengthValue(inset.left)};`); hasInset = true; }
    return hasInset;
  };

  const transformParts: string[] = [];
  const hasExplicitMinW = node.layoutChild?.minWidthValue !== undefined || node.layoutChild?.minWidth !== undefined;
  const hasExplicitMinH = node.layoutChild?.minHeightValue !== undefined || node.layoutChild?.minHeight !== undefined;

  if (isChildOfAutoLayout && !isOutOfFlowInAutoLayout) {
    declarations.push(`position: ${explicitPosition === 'sticky' ? 'sticky' : 'relative'};`);
    if (explicitPosition === 'sticky') {
      if (!emitExplicitInsets()) {
        declarations.push('top: 0px;');
      }
    }
    const parentMode = parent?.layout?.mode ?? 'flex';
    const widthMode = node.layoutChild?.widthMode ?? (parentMode === 'grid' ? 'fill' : 'fixed');
    const heightMode = node.layoutChild?.heightMode ?? 'fixed';
    const parentIsRow =
      parentMode === 'flex'
      && (parent?.layout?.direction === 'row' || parent?.layout?.direction === 'row-reverse' || !parent?.layout?.direction);
    const growWeight = Math.max(1, roundCss(node.layoutChild?.flexGrow ?? 1));

    if (widthMode === 'fill') {
      declarations.push('width: 100%;');
      if (parentIsRow) {
        declarations.push(`flex: ${growWeight} 1 0%;`);
        if (!hasExplicitMinW) declarations.push('min-width: 0;');
      } else if (parentMode === 'flex') {
        declarations.push('align-self: stretch;');
      }
    } else if (widthMode === 'relative') {
      declarations.push(`width: ${roundCss(node.layoutChild?.widthPercent ?? 100)}%;`);
      if (parentIsRow) declarations.push('flex-shrink: 0;');
    } else if (widthMode === 'hug') {
      declarations.push('width: fit-content;');
      if (parentIsRow) declarations.push('flex-shrink: 0;');
    } else {
      declarations.push(`width: ${resolvedFixedWidth};`);
      if (parentIsRow) declarations.push('flex-shrink: 0;');
    }

    if (heightMode === 'fill') {
      declarations.push('height: 100%;');
      if (!parentIsRow && parentMode === 'flex') {
        declarations.push(`flex: ${growWeight} 1 0%;`);
        if (!hasExplicitMinH) declarations.push('min-height: 0;');
      } else {
        declarations.push('align-self: stretch;');
      }
    } else if (heightMode === 'relative') {
      declarations.push(`height: ${roundCss(node.layoutChild?.heightPercent ?? 100)}%;`);
      if (!parentIsRow && parentMode === 'flex') declarations.push('flex-shrink: 0;');
    } else if (heightMode === 'hug') {
      declarations.push('height: fit-content;');
      if (!parentIsRow && parentMode === 'flex') declarations.push('flex-shrink: 0;');
    } else if (node.type === 'text') {
      declarations.push(`min-height: ${resolvedFixedHeight};`);
      if (!parentIsRow && parentMode === 'flex') declarations.push('flex-shrink: 0;');
    } else {
      declarations.push(`height: ${resolvedFixedHeight};`);
      if (!parentIsRow && parentMode === 'flex') declarations.push('flex-shrink: 0;');
    }

    if (parentMode === 'grid') {
      if (node.layoutChild?.gridColumnSpanFull) {
        declarations.push('grid-column: 1 / -1;');
      } else if (node.layoutChild?.gridColumnSpan && node.layoutChild.gridColumnSpan > 1) {
        declarations.push(`grid-column: span ${Math.round(node.layoutChild.gridColumnSpan)};`);
      }
      if (node.layoutChild?.gridRowSpan && node.layoutChild.gridRowSpan > 1) {
        declarations.push(`grid-row: span ${Math.round(node.layoutChild.gridRowSpan)};`);
      }
    }
    emitBoundsAndPositionExtras();
    if (node.layoutChild?.alignSelf && node.layoutChild.alignSelf !== 'auto') {
      declarations.push(`align-self: ${mapAlignItems(node.layoutChild.alignSelf)};`);
    }
    if (node.layoutChild?.zIndex !== undefined) {
      declarations.push(`z-index: ${Math.round(node.layoutChild.zIndex)};`);
    }
  } else {
    void hasRootAutoLayout;
    const parentWorldRot = parent && parent.type !== 'group' && !isChildOfAutoLayout
      ? (parent.rotation || 0)
      : 0;
    let relX = roundCss(node.x - originOffset.x);
    let relY = roundCss(node.y - originOffset.y);
    if (parent && Math.abs(parentWorldRot) > 0.01) {
      const borderInset = getNodeBorderInset(parent);
      const pcx = parent.x + parent.width / 2;
      const pcy = parent.y + parent.height / 2;
      const ccx = node.x + node.width / 2;
      const ccy = node.y + node.height / 2;
      const dx = ccx - pcx;
      const dy = ccy - pcy;
      const rad = (parentWorldRot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const localDx = dx * cos + dy * sin;
      const localDy = -dx * sin + dy * cos;
      relX = roundCss((parent.width / 2 - borderInset.left) + localDx - node.width / 2);
      relY = roundCss((parent.height / 2 - borderInset.top) + localDy - node.height / 2);
    }
    const isExplicitRelative = !parent && !isInstanceChild && explicitPosition === 'relative';
    const pos = isExplicitRelative
      ? 'relative'
      : explicitPosition === 'fixed' || explicitPosition === 'sticky'
        ? explicitPosition
        : 'absolute';
    declarations.push(`position: ${pos};`);
    const hasExplicitInsets = emitExplicitInsets();
    const constraints = isOutOfFlowInAutoLayout ? node.layoutChild?.constraints : undefined;
    const parentPad = parent?.layout?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const pinnedHStretch = Boolean(constraints?.horizontal === 'left-right' && !hasExplicitInsets);
    const pinnedVStretch = Boolean(constraints?.vertical === 'top-bottom' && !hasExplicitInsets);

    if (!hasExplicitInsets && pos !== 'relative') {
      if (constraints?.horizontal === 'left') {
        declarations.push(`left: ${roundCss(parentPad.left)}px;`);
      } else if (constraints?.horizontal === 'right') {
        declarations.push(`right: ${roundCss(parentPad.right)}px;`);
      } else if (constraints?.horizontal === 'left-right') {
        declarations.push(`left: ${roundCss(parentPad.left)}px;`);
        declarations.push(`right: ${roundCss(parentPad.right)}px;`);
      } else if (constraints?.horizontal === 'center') {
        declarations.push('left: 50%;');
        transformParts.push('translateX(-50%)');
      } else {
        declarations.push(`left: ${relX}px;`);
      }

      if (constraints?.vertical === 'top') {
        declarations.push(`top: ${roundCss(parentPad.top)}px;`);
      } else if (constraints?.vertical === 'bottom') {
        declarations.push(`bottom: ${roundCss(parentPad.bottom)}px;`);
      } else if (constraints?.vertical === 'top-bottom') {
        declarations.push(`top: ${roundCss(parentPad.top)}px;`);
        declarations.push(`bottom: ${roundCss(parentPad.bottom)}px;`);
      } else if (constraints?.vertical === 'center') {
        declarations.push('top: 50%;');
        transformParts.push('translateY(-50%)');
      } else {
        declarations.push(`top: ${relY}px;`);
      }
    } else if (pos === 'sticky' && !hasExplicitInsets) {
      declarations.push('top: 0px;');
    }

    if (pinnedHStretch) {
      declarations.push('width: auto;');
    } else if (node.layoutChild?.widthMode === 'relative') {
      declarations.push(`width: ${roundCss(node.layoutChild.widthPercent ?? 100)}%;`);
    } else if (node.layoutChild?.widthMode === 'hug') {
      declarations.push('width: fit-content;');
    } else if (node.layoutChild?.widthMode === 'fill') {
      declarations.push('width: 100%;');
    } else {
      declarations.push(`width: ${resolvedFixedWidth};`);
    }

    if (pinnedVStretch) {
      declarations.push('height: auto;');
    } else if (node.layoutChild?.heightMode === 'relative') {
      declarations.push(`height: ${roundCss(node.layoutChild.heightPercent ?? 100)}%;`);
    } else if (node.layoutChild?.heightMode === 'hug') {
      declarations.push('height: fit-content;');
    } else if (node.layoutChild?.heightMode === 'fill') {
      declarations.push('height: 100%;');
    } else if (node.type !== 'text') {
      declarations.push(`height: ${resolvedFixedHeight};`);
    }
    emitBoundsAndPositionExtras();
    if (node.layoutChild?.zIndex !== undefined) {
      declarations.push(`z-index: ${Math.round(node.layoutChild.zIndex)};`);
    }
  }

  const effectiveParentWorldRot =
    parent && parent.type !== 'group' && !isChildOfAutoLayout ? (parent.rotation || 0) : 0;
  const effectiveNodeWorldRot = node.type === 'group' ? 0 : (node.rotation || 0);
  const localRotation = roundCss(effectiveNodeWorldRot - effectiveParentWorldRot);
  if (Math.abs(localRotation) > 0.01) {
    transformParts.push(`rotate(${localRotation}deg)`);
  }
  if (transformParts.length > 0) {
    declarations.push(`transform: ${transformParts.join(' ')};`);
  }
  if (node.opacity < 0.999) {
    declarations.push(`opacity: ${roundCss(node.opacity)};`);
  }
  if (node.cursor && node.cursor !== 'default') {
    declarations.push(`cursor: ${node.cursor};`);
  }
  if (node.pointerEvents === 'none') {
    declarations.push('pointer-events: none;');
  }
  if (node.userSelect === 'none') {
    declarations.push('user-select: none;');
  }
  const transitionCss = buildNodeTransitionCss(node.transition);
  if (transitionCss) {
    declarations.push(`transition: ${transitionCss};`);
  }

  const isMorphRenderedAsSvg =
    (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') &&
    Boolean(morphNodeIds?.has(emittedId ?? node.id));

  if ((node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') && !isMorphRenderedAsSvg) {
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
    const emittedPerSide = node.style.borderSides
      ? emitBorderSidesCss(node.style.borderSides, declarations)
      : false;
    if (!emittedPerSide && node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
      const strokeVal = strokeVar ?? sanitizeCssValue(node.style.stroke, 'transparent');
      const borderStyle = node.style.strokeStyle ?? resolveCssBorderStyle(node.style.strokeDasharray);
      const sw = roundCss(node.style.strokeWidth);
      const swUnit = node.style.strokeWidthUnit ?? 'px';
      if (node.style.strokeAlign === 'outside') {
        declarations.push(`outline: ${sw}${swUnit} ${borderStyle} ${strokeVal};`);
        declarations.push('outline-offset: 0;');
      } else if (node.style.strokeAlign === 'inside') {
        declarations.push('box-sizing: border-box;');
        declarations.push(`border: ${sw}${swUnit} ${borderStyle} ${strokeVal};`);
      } else {
        declarations.push(`border: ${sw}${swUnit} ${borderStyle} ${strokeVal};`);
      }
    }
    if (node.type === 'ellipse') {
      declarations.push('border-radius: 50%;');
    } else if (radiusVar) {
      declarations.push(`border-radius: ${radiusVar};`);
    } else if (node.style.cornerRadii) {
      declarations.push(`border-radius: ${formatCornerRadiiCss(node.style.cornerRadii, node.style.radiusUnit ?? 'px')};`);
    } else if (node.style.radius !== undefined && node.style.radius > 0) {
      declarations.push(`border-radius: ${roundCss(node.style.radius)}${node.style.radiusUnit ?? 'px'};`);
    }
    const frameClipsChildren =
      node.type === 'frame'
      && !node.layout?.overflow
      && node.clipContent === true;
    if (frameClipsChildren) {
      declarations.push('overflow: hidden;');
    }
  } else if (node.type === 'image') {
    const strokeVar = resolveTokenCssVar(tokens, node.tokenBindings?.stroke);
    const radiusVar = resolveTokenCssVar(tokens, node.tokenBindings?.radius);
    declarations.push('display: block;');
    declarations.push(`object-fit: ${node.style.fit};`);
    const emittedPerSide = node.style.borderSides
      ? emitBorderSidesCss(node.style.borderSides, declarations)
      : false;
    const imgStrokeWidth = node.style.strokeWidth ?? 0;
    if (!emittedPerSide && imgStrokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
      const strokeVal = strokeVar ?? sanitizeCssValue(node.style.stroke, 'transparent');
      const dasharray =
        'strokeDasharray' in node.style && typeof node.style.strokeDasharray === 'string'
          ? node.style.strokeDasharray
          : undefined;
      const borderStyle = node.style.strokeStyle ?? resolveCssBorderStyle(dasharray);
      const swUnit = node.style.strokeWidthUnit ?? 'px';
      declarations.push(`border: ${roundCss(imgStrokeWidth)}${swUnit} ${borderStyle} ${strokeVal};`);
    }
    if (radiusVar) {
      declarations.push(`border-radius: ${radiusVar};`);
    } else if (node.style.cornerRadii) {
      declarations.push(`border-radius: ${formatCornerRadiiCss(node.style.cornerRadii, node.style.radiusUnit ?? 'px')};`);
    } else if (node.style.radius !== undefined && node.style.radius > 0) {
      declarations.push(`border-radius: ${roundCss(node.style.radius)}${node.style.radiusUnit ?? 'px'};`);
    }
  } else if (node.type === 'text') {
    const fillVar = resolveTokenCssVar(tokens, node.tokenBindings?.fill);
    const fontSizeVar = resolveTokenCssVar(tokens, node.tokenBindings?.fontSize);
    const fsUnit = node.style.fontSizeUnit ?? 'px';
    const lhUnit = node.style.lineHeightUnit ?? '';
    const lsUnit = node.style.letterSpacingUnit ?? 'px';
    declarations.push(`color: ${fillVar ?? sanitizeCssValue(node.style.fill, '#111827')};`);
    declarations.push(`font-family: ${sanitizeCssValue(node.style.fontFamily, 'system-ui, sans-serif')};`);
    declarations.push(`font-size: ${fontSizeVar ?? `${roundCss(node.style.fontSize)}${fsUnit}`};`);
    declarations.push(`font-weight: ${Math.round(node.style.fontWeight)};`);
    declarations.push(`line-height: ${roundCss(node.style.lineHeight)}${lhUnit};`);
    if (Math.abs(node.style.letterSpacing) > 0.001) {
      declarations.push(`letter-spacing: ${roundCss(node.style.letterSpacing)}${lsUnit};`);
    }
    const resolvedTag = resolveSemanticTag(node);
    if (node.style.textAlign && node.style.textAlign !== 'left') {
      declarations.push(`text-align: ${node.style.textAlign};`);
    } else if (resolvedTag === 'button') {
      declarations.push('text-align: left;');
    }
    if (node.style.verticalAlign === 'middle' || node.style.verticalAlign === 'bottom') {
      declarations.push('display: flex;');
      declarations.push('flex-direction: column;');
      declarations.push(`justify-content: ${node.style.verticalAlign === 'middle' ? 'center' : 'flex-end'};`);
      const hMode = node.layoutChild?.heightMode;
      if (!hMode || hMode === 'fixed') {
        declarations.push(`height: ${roundCss(node.height)}px;`);
      }
    } else if (node.visible && (resolvedTag === 'span' || resolvedTag === 'a')) {
      declarations.push('display: block;');
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
  } else if (node.type === 'group') {
    declarations.push('overflow: visible;');
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
  assetMode?: 'bundle' | 'inline' | 'portable';
}

export function compilePageHtmlCss(
  inputProject: FolioProject,
  page: FolioPage,
  options: CompilePageHtmlCssOptions = {},
): CompiledPageArtifacts {
  const project = sanitizeProjectNetworkSecrets(inputProject);
  const assetMode = options.assetMode ?? 'bundle';
  const tokens = getProjectDesignTokens(project);
  const morphNodeIds = collectPageMorphNodeIds(project, page);
  const slug = toPageFileSlug(page.route, page.name);
  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );
  const assetsById = new Map<string, AssetReference>(
    project.assets.map((asset) => [asset.id, asset]),
  );

  const solvedNodes = page.document.nodes.some((n) => n.layout && n.layout.mode !== 'none')
    ? applyAutoLayoutToNodes(page.document.nodes, undefined, tokens)
    : page.document.nodes;

  const { roots, childrenByParent, nodeById } = buildChildrenMap(solvedNodes);
  const htmlBodyLines: string[] = [];
  const htmlMappings: CodeMappingEntry[] = [];
  const cssLines: string[] = [
    `/* Mapped by FOLIO Code Engine — Page "${sanitizeCommentLabel(page.name)}" (${sanitizeCommentLabel(page.route)}) */`,
    '/* Structured AST layout, typography, semantic classes, and responsive rules. */',
    '',
  ];
  const cssMappings: CodeMappingEntry[] = [];
  const tabletRules: string[] = [];
  const mobileRules: string[] = [];

  const pageClass = `folio-page-${slug}`;
  const docWidth = Math.max(1, roundCss(page.document.width));
  const docHeight = Math.max(1, roundCss(page.document.height));
  const hasExplicitBreakpoints = solvedNodes.some((node) => Boolean(node.responsive?.tablet || node.responsive?.mobile));
  const hasAllResponsiveRoots =
    roots.length > 0
    && roots.every(
      (node) =>
        Boolean(node.layout && node.layout.mode !== 'none')
        || node.layoutChild?.widthMode === 'fill'
        || node.layoutChild?.widthMode === 'relative',
    );
  const hasFullWidthFluidRoot = roots.some(
    (node) =>
      (Boolean(node.layout && node.layout.mode !== 'none') && node.width >= docWidth * 0.85)
      || node.layoutChild?.widthMode === 'fill'
      || node.layoutChild?.widthMode === 'relative',
  );
  const hasResponsiveDesign = hasExplicitBreakpoints || hasAllResponsiveRoots || hasFullWidthFluidRoot;
  const hasRootAutoLayout = false;

  pushCssRule(
    cssLines,
    `.${pageClass}, .${pageClass} *, .${pageClass} *::before, .${pageClass} *::after`,
    ['box-sizing: border-box;'],
  );

  pushCssRule(cssLines, `.${pageClass}`, [
    'position: relative;',
    hasResponsiveDesign ? 'width: 100%;' : `width: ${docWidth}px;`,
    `max-width: ${docWidth}px;`,
    `min-height: ${docHeight}px;`,
    'margin: 0 auto;',
    `background: ${sanitizeCssValue(page.document.background, '#ffffff')};`,
    'overflow-x: clip;',
  ]);

  const pushMultilineHtml = (value: string) => {
    if (!value.includes('\n')) {
      htmlBodyLines.push(value);
      return;
    }
    for (const part of value.split('\n')) {
      htmlBodyLines.push(part);
    }
  };

  const emitNodeCss = (
    node: DesignNode,
    className: string,
    parent: DesignNode | null,
    isChildOfAutoLayout: boolean,
    isInstanceChild: boolean,
    originOffset: { x: number; y: number },
    activeNodeById: ReadonlyMap<string, DesignNode>,
    maskPrefix: string,
    emittedId: string,
  ) => {
    const selector = `.${className}`;
    const declarations = buildNodeCssDeclarations(node, tokens, {
      parent,
      isChildOfAutoLayout,
      isInstanceChild,
      hasRootAutoLayout,
      originOffset,
      nodeById: activeNodeById,
      maskPrefix,
      morphNodeIds,
      emittedId,
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

    const pseudoRules = buildNodePseudoStateCssRules(node, selector);
    for (const rule of pseudoRules) {
      pushCssRule(cssLines, rule.selector, rule.declarations);
    }

    const restoreDisplay =
      node.layout?.mode === 'flex' ? 'flex' : node.layout?.mode === 'grid' ? 'grid' : 'block';

    const isRootAutoLayoutContainer =
      !parent && !isInstanceChild && Boolean(node.layout && node.layout.mode !== 'none');

    const tDecls: string[] = [];
    if (node.responsive?.tablet) {
      const t = node.responsive.tablet;
      if (t.visible === false) tDecls.push('display: none;');
      else if (t.visible === true && !node.visible) tDecls.push(`display: ${restoreDisplay};`);
      if (t.width !== undefined) tDecls.push(`width: ${roundCss(t.width)}px;`);
      if (t.height !== undefined) tDecls.push(`min-height: ${roundCss(t.height)}px;`);
      if (t.layoutDirection) tDecls.push(`flex-direction: ${t.layoutDirection};`);
      if (t.gridColumns !== undefined) tDecls.push(`grid-template-columns: repeat(${Math.max(1, Math.round(t.gridColumns))}, minmax(0, 1fr));`);
      if (t.gap !== undefined) tDecls.push(`gap: ${roundCss(t.gap)}px;`);
      if (t.padding) tDecls.push(`padding: ${formatPadding(t.padding)};`);
    }
    if (
      isRootAutoLayoutContainer
      && node.responsive?.tablet?.width === undefined
      && node.layoutChild?.widthMode !== 'fill'
      && node.layoutChild?.widthMode !== 'relative'
      && node.layoutChild?.widthMode !== 'hug'
      && (node.width > 768 - 32 || node.x + node.width > 768)
    ) {
      const clampedLeft = Math.min(Math.max(0, roundCss(node.x)), 16);
      tDecls.push(`left: ${clampedLeft}px;`);
      tDecls.push(`width: calc(100% - ${clampedLeft * 2}px);`);
    }
    if (tDecls.length > 0) {
      tabletRules.push(`  ${selector} { ${tDecls.join(' ')} }`);
    }

    const mDecls: string[] = [];
    if (node.responsive?.mobile) {
      const m = node.responsive.mobile;
      if (m.visible === false) mDecls.push('display: none;');
      else if (m.visible === true && !node.visible) mDecls.push(`display: ${restoreDisplay};`);
      if (m.width !== undefined) mDecls.push(`width: ${roundCss(m.width)}px;`);
      if (m.height !== undefined) mDecls.push(`min-height: ${roundCss(m.height)}px;`);
      if (m.layoutDirection) mDecls.push(`flex-direction: ${m.layoutDirection};`);
      if (m.gridColumns !== undefined) mDecls.push(`grid-template-columns: repeat(${Math.max(1, Math.round(m.gridColumns))}, minmax(0, 1fr));`);
      if (m.gap !== undefined) mDecls.push(`gap: ${roundCss(m.gap)}px;`);
      if (m.padding) mDecls.push(`padding: ${formatPadding(m.padding)};`);
    }
    if (
      isRootAutoLayoutContainer
      && node.responsive?.mobile?.width === undefined
      && node.layoutChild?.widthMode !== 'fill'
      && node.layoutChild?.widthMode !== 'relative'
      && node.layoutChild?.widthMode !== 'hug'
      && (node.width > 390 - 32 || node.x + node.width > 390)
    ) {
      const clampedLeft = Math.min(Math.max(0, roundCss(node.x)), 16);
      mDecls.push(`left: ${clampedLeft}px;`);
      mDecls.push(`width: calc(100% - ${clampedLeft * 2}px);`);
    }
    if (mDecls.length > 0) {
      mobileRules.push(`  ${selector} { ${mDecls.join(' ')} }`);
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
    activeNodeById: ReadonlyMap<string, DesignNode>,
    idPrefix: string,
    visitedComponentIds: ReadonlySet<string>,
    componentDepth: number,
  ) => {
    const indent = '  '.repeat(depth);
    const emittedId = idPrefix ? `${idPrefix}${node.id}` : node.id;
    const className = toCssClassName('f', node.name, emittedId);
    const maskPrefix = idPrefix ? `${slug}-${idPrefix}` : slug;
    emitNodeCss(
      node,
      className,
      parent,
      isChildOfAutoLayout,
      isInstanceChild,
      originOffset,
      activeNodeById,
      maskPrefix,
      emittedId,
    );

    const tag = resolveSemanticTag(node);
    const extraClass = node.className?.trim() && isSafeHtmlClassName(node.className.trim())
      ? ` ${node.className.trim()}`
      : '';
    const attrs: string[] = [];
    if (node.htmlId?.trim() && isSafeHtmlId(node.htmlId.trim())) {
      attrs.push(`id="${escapeAttr(node.htmlId.trim())}"`);
    }
    attrs.push(
      `class="${escapeAttr(`${className}${extraClass}`)}"`,
      `data-folio-id="${escapeAttr(emittedId)}"`,
    );
    if (node.ariaLabel?.trim()) {
      attrs.push(`aria-label="${escapeAttr(node.ariaLabel.trim())}"`);
    }
    if (tag === 'a') {
      const safeHref = sanitizeHref(node.href);
      attrs.push(`href="${escapeAttr(safeHref ?? '#')}"`);
      if (node.linkTarget === '_blank') {
        attrs.push('target="_blank"');
        attrs.push('rel="noopener noreferrer"');
      }
    }
    if (tag === 'button') {
      attrs.push('type="button"');
    }
    if (node.type === 'component-instance') {
      attrs.push(`data-folio-component="${escapeAttr(node.componentId)}"`);
    }

    const startLine = htmlLineOffset + htmlBodyLines.length + 1;

    if (node.type === 'text') {
      if (tag === 'input') {
        pushMultilineHtml(
          `${indent}<input ${attrs.join(' ')} type="text" value="${escapeAttr(node.text)}" readonly />`,
        );
      } else if (tag === 'img') {
        pushMultilineHtml(
          `${indent}<img ${attrs.join(' ')} src="" alt="${escapeAttr(node.text || node.ariaLabel || node.name)}" />`,
        );
      } else {
        pushMultilineHtml(`${indent}<${tag} ${attrs.join(' ')}>${escapeHtml(node.text)}</${tag}>`);
      }
    } else if (node.type === 'image') {
      const asset = assetsById.get(node.assetId);
      const src = asset
        ? assetMode === 'portable'
          ? (resolvePortableAssetUrl(asset) ?? '')
          : assetMode === 'inline'
            ? (resolveAssetDisplayUrl(asset) ?? '')
            : `../${getAssetBundlePath(asset)}`
        : '';
      const alt = node.alt ?? node.name;
      htmlBodyLines.push(
        `${indent}<img ${attrs.join(' ')} src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`,
      );
    } else if (node.type === 'path') {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      htmlBodyLines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      htmlBodyLines.push(...buildInlineSvgMarkup(node, tokens, `${indent}  `, morphNodeIds.has(emittedId)));
      htmlBodyLines.push(`${indent}</${wrapperTag}>`);
    } else if (
      (node.type === 'ellipse' || node.type === 'rect' || node.type === 'frame') &&
      morphNodeIds.has(emittedId)
    ) {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      const snap = extractMorphSnapshotFromNode(node);
      const projected = snap ? applyMorphGeometryToDesignNode(node, snap) : null;
      htmlBodyLines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      if (projected && projected.type === 'path') {
        htmlBodyLines.push(...buildInlineSvgMarkup(projected, tokens, `${indent}  `, true));
      }
      htmlBodyLines.push(`${indent}</${wrapperTag}>`);
    } else if (node.type === 'component-instance') {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      const master = componentsById.get(node.componentId);
      if (master && !visitedComponentIds.has(master.id) && componentDepth < MAX_COMPONENT_RENDER_DEPTH) {
        const nextVisited = new Set(visitedComponentIds);
        nextVisited.add(master.id);
        const resolvedRaw = resolveComponentInstanceNodes(node, master, tokens);
        const resolvedChildren = resolvedRaw.some((child) => child.layout && child.layout.mode !== 'none')
          ? applyAutoLayoutToNodes(resolvedRaw, undefined, tokens)
          : resolvedRaw;
        const childMap = buildChildrenMap(resolvedChildren);
        const masterW = Math.max(1, master.document.width);
        const masterH = Math.max(1, master.document.height);
        const scaleX = node.width / masterW;
        const scaleY = node.height / masterH;
        const needsScale = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
        const childPrefix = `${emittedId}__`;
        const childMaskDefs = buildVectorMaskDefsLines(
          resolvedChildren,
          `${slug}-${childPrefix}`,
          false,
          needsScale ? `${indent}    ` : `${indent}  `,
        );
        htmlBodyLines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
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
          if (childMaskDefs.length > 0) {
            htmlBodyLines.push(...childMaskDefs);
          }
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
              childMap.nodeById,
              childPrefix,
              nextVisited,
              componentDepth + 1,
            );
          }
          htmlBodyLines.push(`${indent}  </div>`);
        } else {
          if (childMaskDefs.length > 0) {
            htmlBodyLines.push(...childMaskDefs);
          }
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
              childMap.nodeById,
              childPrefix,
              nextVisited,
              componentDepth + 1,
            );
          }
        }
        htmlBodyLines.push(`${indent}</${wrapperTag}>`);
      } else {
        htmlBodyLines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}></${wrapperTag}>`);
      }
    } else {
      const children = activeChildrenByParent.get(node.id) ?? [];
      const selfIsAutoLayout = Boolean(node.layout && node.layout.mode !== 'none');
      if (children.length === 0) {
        if (tag === 'input') {
          htmlBodyLines.push(`${indent}<input ${attrs.join(' ')} type="text" />`);
        } else if (tag === 'img') {
          htmlBodyLines.push(
            `${indent}<img ${attrs.join(' ')} src="" alt="${escapeAttr(node.ariaLabel ?? node.name)}" />`,
          );
        } else {
          htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}></${tag}>`);
        }
      } else {
        const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
        htmlBodyLines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
        const borderInset = getNodeBorderInset(node);
        const nextOrigin = { x: node.x + borderInset.left, y: node.y + borderInset.top };
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
            activeNodeById,
            idPrefix,
            visitedComponentIds,
            componentDepth,
          );
        }
        htmlBodyLines.push(`${indent}</${wrapperTag}>`);
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
    const safePath = sanitizeRelativeModulePath(mod.path);
    if (!safePath) continue;
    htmlPreambleLines.push(`  <link rel="stylesheet" href="../${escapeAttr(safePath)}" />`);
  }

  htmlPreambleLines.push(
    '</head>',
    '<body>',
    `  <main class="${escapeAttr(pageClass)}" data-folio-page="${escapeAttr(page.id)}">`,
  );

  const htmlLineOffset = htmlPreambleLines.length;
  const pageMaskDefs = buildVectorMaskDefsLines(solvedNodes, slug, false, '    ');
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
      nodeById,
      '',
      emptyVisited,
      0,
    );
  }

  if (!hasResponsiveDesign && docWidth > 320) {
    cssLines.push(`@media (max-width: ${Math.max(320, Math.floor(docWidth) - 1)}px) {`);
    cssLines.push(`  .${pageClass} {`);
    cssLines.push(`    width: ${docWidth}px;`);
    cssLines.push('    max-width: none;');
    cssLines.push('    margin: 0;');
    cssLines.push('    transform-origin: top left;');
    cssLines.push(`    zoom: tan(atan2(100vw, ${docWidth}px));`);
    cssLines.push('  }');
    cssLines.push('  @supports not (zoom: 1) {');
    cssLines.push(`    .${pageClass} {`);
    cssLines.push(`      transform: scale(tan(atan2(100vw, ${docWidth}px)));`);
    cssLines.push('    }');
    cssLines.push('  }');
    cssLines.push('}');
    cssLines.push('');
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
  /** 'inline' uses fast in-tab blob/data URLs for Live Preview iframe; 'portable' emits self-contained data URIs for standalone HTML export. */
  assetMode?: 'inline' | 'portable';
}

export const LIVE_PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; script-src 'unsafe-inline'; img-src data: blob:; font-src data: blob: https://fonts.gstatic.com;";

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

  const effectiveAssetMode = options.assetMode ?? 'inline';
  const tokensCss = compileTokensCssFile(project, { assetMode: effectiveAssetMode }).content;
  const compiledPage = compilePageHtmlCss(project, page, { assetMode: effectiveAssetMode });
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
  const morphScript = buildLivePreviewMorphScript(project, page);

  const customJsBlocks = options.includeCustomScripts
    ? modules
        .filter((mod) => mod.language === 'js' && (!mod.targetPageId || mod.targetPageId === page.id))
        .map((mod) => `/* Custom Script: ${sanitizeCommentLabel(mod.path)} */\n${sanitizeJsText(mod.content)}`)
    : [];

  const allScriptBlocks = [
    ...(morphScript ? [morphScript] : []),
    ...(logicScript ? [logicScript] : []),
    ...customJsBlocks,
  ];

  const pageBg = sanitizeCssValue(page.document.background, '');
  const bodyBg = pageBg && pageBg !== 'transparent' && pageBg !== '#00000000'
    ? pageBg
    : 'var(--surface-canvas, #f5f2ec)';

  const baseResetCss = [
    '*, *::before, *::after { box-sizing: border-box; }',
    `html, body { margin: 0; padding: 0; min-height: 100%; overflow-x: hidden; background: ${bodyBg}; color: var(--text-primary, #1d1f28); font-family: system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }`,
    'a { color: inherit; text-decoration: none; }',
    'button { font: inherit; text-align: inherit; cursor: pointer; background: none; border: none; padding: 0; }',
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
