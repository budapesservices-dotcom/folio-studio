import { resolveComponentInstanceNodes } from '../../core/document/components';
import { getActivePage } from '../../core/document/project';
import {
  generateDesignTokensCss,
  getProjectDesignTokens,
  toCssVariableName,
  toDesignTokenThemeSlug,
} from '../../core/document/tokens';
import type {
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

export function roundCss(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapJustifyContent(value: NodeLayoutConfig['justifyContent']): string {
  switch (value) {
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'space-between': return 'space-between';
    case 'space-around': return 'space-around';
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
  },
): string[] {
  const { parent, isChildOfAutoLayout, isInstanceChild, hasRootAutoLayout, originOffset } = options;
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
    declarations.push(`gap: ${gapVar ?? `${roundCss(node.layout.gap)}px`};`);
    const padVar = resolveTokenCssVar(tokens, node.tokenBindings?.padding);
    declarations.push(`padding: ${padVar ?? formatPadding(node.layout.padding)};`);
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
  }

  if (isChildOfAutoLayout) {
    declarations.push('position: relative;');
    const widthMode = node.layoutChild?.widthMode ?? 'fixed';
    const heightMode = node.layoutChild?.heightMode ?? 'fixed';
    if (widthMode === 'fill') {
      declarations.push('width: 100%;');
      declarations.push('flex: 1 1 0%;');
    } else if (widthMode === 'hug') {
      declarations.push('width: fit-content;');
    } else {
      declarations.push(`width: ${roundCss(node.width)}px;`);
    }

    if (heightMode === 'fill') {
      declarations.push('height: 100%;');
      declarations.push('align-self: stretch;');
    } else if (heightMode === 'hug') {
      declarations.push('height: fit-content;');
    } else if (node.type !== 'text') {
      declarations.push(`min-height: ${roundCss(node.height)}px;`);
    }

    if (node.layoutChild?.minWidth !== undefined) declarations.push(`min-width: ${roundCss(node.layoutChild.minWidth)}px;`);
    if (node.layoutChild?.maxWidth !== undefined) declarations.push(`max-width: ${roundCss(node.layoutChild.maxWidth)}px;`);
    if (node.layoutChild?.minHeight !== undefined) declarations.push(`min-height: ${roundCss(node.layoutChild.minHeight)}px;`);
    if (node.layoutChild?.maxHeight !== undefined) declarations.push(`max-height: ${roundCss(node.layoutChild.maxHeight)}px;`);
    if (node.layoutChild?.alignSelf && node.layoutChild.alignSelf !== 'auto') {
      declarations.push(`align-self: ${mapAlignItems(node.layoutChild.alignSelf)};`);
    }
  } else if (hasRootAutoLayout && !parent && !isInstanceChild) {
    declarations.push('position: relative;');
    declarations.push('width: 100%;');
    declarations.push(`min-height: ${roundCss(node.height)}px;`);
  } else {
    const relX = roundCss(node.x - originOffset.x);
    const relY = roundCss(node.y - originOffset.y);
    declarations.push('position: absolute;');
    declarations.push(`left: ${relX}px;`);
    declarations.push(`top: ${relY}px;`);
    declarations.push(`width: ${roundCss(node.width)}px;`);
    if (node.type !== 'text') {
      declarations.push(`height: ${roundCss(node.height)}px;`);
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
    const fillVal = fillVar ?? sanitizeCssValue(node.style.fill, 'transparent');
    if (fillVal && fillVal !== 'none') {
      declarations.push(`background: ${fillVal};`);
    }
    if (node.style.strokeWidth > 0 && node.style.stroke && node.style.stroke !== 'none') {
      const strokeVal = strokeVar ?? sanitizeCssValue(node.style.stroke, 'transparent');
      declarations.push(`border: ${roundCss(node.style.strokeWidth)}px solid ${strokeVal};`);
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
    declarations.push('margin: 0;');
    declarations.push('white-space: pre-wrap;');
  } else if (node.type === 'component-instance') {
    declarations.push('overflow: visible;');
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

export function compilePageHtmlCss(
  project: FolioProject,
  page: FolioPage,
): CompiledPageArtifacts {
  const tokens = getProjectDesignTokens(project);
  const slug = toPageFileSlug(page.route, page.name);
  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );

  const { roots, childrenByParent } = buildChildrenMap(page.document.nodes);
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
    } else if (node.type === 'path') {
      htmlBodyLines.push(`${indent}<${tag} ${attrs.join(' ')}>`);
      htmlBodyLines.push(...buildInlineSvgMarkup(node, tokens, `${indent}  `));
      htmlBodyLines.push(`${indent}</${tag}>`);
    } else if (node.type === 'component-instance') {
      const master = componentsById.get(node.componentId);
      if (master) {
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

  const htmlPreambleLines = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${escapeHtml(project.metadata.name)} — ${escapeHtml(page.name)}</title>`,
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
  for (const root of roots) {
    emitNodeHtml(root, null, 2, false, false, { x: 0, y: 0 }, htmlLineOffset, childrenByParent, '');
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
}

/**
 * Compiles a complete, self-contained HTML5 document for Folio's sandboxed
 * Live Preview (`<iframe sandbox="allow-scripts">`).
 *
 * Security guarantees:
 * - All AST text/attributes are HTML-escaped; URLs are protocol-allowlisted.
 * - All CSS blocks neutralize `</style` breakout.
 * - Custom JS is optional and neutralizes `</script` breakout; host iframe
 *   NEVER grants `allow-same-origin`.
 */
export function buildLivePreviewHtml(
  project: FolioProject,
  options: LivePreviewOptions = {},
): string {
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
  const compiledPage = compilePageHtmlCss(project, page);

  const modules: readonly CodeModuleRecord[] = project.codeModules ?? [];
  const customCssBlocks = modules
    .filter((mod) => mod.language === 'css' && mod.mapping === 'custom' && (!mod.targetPageId || mod.targetPageId === page.id))
    .map((mod) => `/* Custom Module: ${mod.path} */\n${sanitizeCssText(mod.content)}`);

  const extensionCssBlocks = modules
    .filter((mod) => mod.language === 'css' && mod.mapping === 'extension' && (!mod.targetPageId || mod.targetPageId === page.id))
    .map((mod) => `/* Node Extension: ${mod.path} */\n${sanitizeCssText(mod.content)}`);

  const customJsBlocks = options.includeCustomScripts
    ? modules
        .filter((mod) => mod.language === 'js' && (!mod.targetPageId || mod.targetPageId === page.id))
        .map((mod) => `/* Custom Script: ${mod.path} */\n${sanitizeJsText(mod.content)}`)
    : [];

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

  const scriptTag = customJsBlocks.length > 0
    ? `\n  <script>\n${customJsBlocks.join('\n\n')}\n  </script>`
    : '';

  return [
    '<!DOCTYPE html>',
    `<html lang="en"${themeAttr}>`,
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${escapeHtml(project.metadata.name)} — ${escapeHtml(page.name)}</title>`,
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
