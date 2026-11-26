import { getProjectDesignTokens, resolveNodeWithTokens } from '../../core/document/tokens';
import { getVisibleFillPaints } from '../../core/document/styling';
import type {
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  SemanticHtmlTag,
} from '../../core/document/types';
import { applyAutoLayoutToNodes } from '../layout/autoLayout';
import { resolveSemanticTag } from './htmlCssCompiler';
import { sanitizeHref } from './sanitize';

export type A11yIssueSeverity = 'error' | 'warning' | 'info';

export type A11yIssueCode =
  | 'CONTRAST_TOO_LOW'
  | 'MISSING_H1'
  | 'MULTIPLE_H1'
  | 'SKIPPED_HEADING_LEVEL'
  | 'INTERACTIVE_MISSING_NAME'
  | 'LINK_MISSING_OR_UNSAFE_HREF'
  | 'EMPTY_TEXT_NODE';

export interface A11yQuickFix {
  readonly label: string;
  readonly nodeId: string;
  readonly description: string;
  readonly textFill?: string;
  readonly semanticTag?: SemanticHtmlTag;
  readonly ariaLabel?: string;
}

export interface A11yAuditIssue {
  readonly id: string;
  readonly code: A11yIssueCode;
  readonly severity: A11yIssueSeverity;
  readonly nodeId?: string;
  readonly nodeName?: string;
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly fix?: A11yQuickFix;
}

export interface A11yAuditReport {
  readonly pageId: string;
  readonly pageName: string;
  readonly score: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly passedChecks: number;
  readonly issues: readonly A11yAuditIssue[];
}

interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NAMED_COLORS: Record<string, RgbaColor> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

export function parseCssColorToRgba(raw: string | undefined): RgbaColor | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return null;
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed];

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/,
  );
  if (rgbaMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbaMatch[1])));
    const g = Math.min(255, Math.max(0, Number(rgbaMatch[2])));
    const b = Math.min(255, Math.max(0, Number(rgbaMatch[3])));
    const a = rgbaMatch[4] !== undefined ? Math.min(1, Math.max(0, Number(rgbaMatch[4]))) : 1;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a };
  }

  return null;
}

function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const alpha = fg.a;
  if (alpha >= 1) return fg;
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * Computes the WCAG 2.1 contrast ratio (1..21) between foreground and background CSS colors.
 * Returns null if either color cannot be statically parsed.
 */
export function computeContrastRatio(foreground: string, background: string): number | null {
  const fgRaw = parseCssColorToRgba(foreground);
  const bgRaw = parseCssColorToRgba(background);
  if (!fgRaw || !bgRaw) return null;

  const baseWhite: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
  const resolvedBg = compositeOver(bgRaw, baseWhite);
  const resolvedFg = compositeOver(fgRaw, resolvedBg);

  const l1 = relativeLuminance(resolvedFg);
  const l2 = relativeLuminance(resolvedBg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbaToHex(color: RgbaColor): string {
  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function mixRgb(from: RgbaColor, to: RgbaColor, t: number): RgbaColor {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: 1,
  };
}

/**
 * Finds the nearest WCAG-compliant foreground #RRGGBB color to `foreground` over `background`
 * by blending minimally toward black or white while preserving the designer's hue.
 */
export function suggestAccessibleForegroundColor(
  foreground: string,
  background: string,
  minRatio: number,
): string | null {
  const fgRaw = parseCssColorToRgba(foreground);
  const bgRaw = parseCssColorToRgba(background);
  if (!fgRaw || !bgRaw) return null;

  const baseWhite: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
  const resolvedBg = compositeOver(bgRaw, baseWhite);
  const resolvedFg = compositeOver(fgRaw, resolvedBg);
  const targetRatio = minRatio + 0.05;

  const currentRatio = computeContrastRatio(rgbaToHex(resolvedFg), background);
  if (currentRatio !== null && currentRatio >= minRatio) {
    return rgbaToHex(resolvedFg);
  }

  const searchToward = (extreme: RgbaColor): { hex: string; t: number } | null => {
    const extremeHex = rgbaToHex(extreme);
    const maxRatio = computeContrastRatio(extremeHex, background);
    if (maxRatio === null || maxRatio < minRatio) return null;

    let lo = 0;
    let hi = 1;
    let bestHex = extremeHex;
    let bestT = 1;
    for (let step = 0; step < 14; step += 1) {
      const mid = (lo + hi) / 2;
      const candidateHex = rgbaToHex(mixRgb(resolvedFg, extreme, mid));
      const ratio = computeContrastRatio(candidateHex, background);
      if (ratio !== null && ratio >= targetRatio) {
        bestHex = candidateHex;
        bestT = mid;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return { hex: bestHex, t: bestT };
  };

  const towardBlack = searchToward({ r: 0, g: 0, b: 0, a: 1 });
  const towardWhite = searchToward({ r: 255, g: 255, b: 255, a: 1 });

  if (towardBlack && towardWhite) {
    return towardBlack.t <= towardWhite.t ? towardBlack.hex : towardWhite.hex;
  }
  return towardBlack?.hex ?? towardWhite?.hex ?? null;
}

/**
 * Pure helper that applies a typed A11yQuickFix onto a DesignNode without mutating the input.
 */
export function applyA11yQuickFixToNode(node: DesignNode, fix: A11yQuickFix): DesignNode {
  let next: DesignNode = node;

  if (fix.textFill && next.type === 'text') {
    const nextTokenBindings = next.tokenBindings ? { ...next.tokenBindings } : undefined;
    if (nextTokenBindings && 'fill' in nextTokenBindings) {
      delete nextTokenBindings.fill;
    }
    const cleanedBindings =
      nextTokenBindings && Object.keys(nextTokenBindings).length > 0 ? nextTokenBindings : undefined;
    next = {
      ...next,
      style: {
        ...next.style,
        fill: fix.textFill,
      },
      ...(cleanedBindings ? { tokenBindings: cleanedBindings } : { tokenBindings: undefined }),
    };
  }

  if (fix.semanticTag) {
    next = {
      ...next,
      semanticTag: fix.semanticTag,
    };
  }

  if (fix.ariaLabel !== undefined) {
    next = {
      ...next,
      ariaLabel: fix.ariaLabel,
    };
  }

  return next;
}

function nodeContainsCenter(container: DesignNode, target: DesignNode): boolean {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  return (
    cx >= container.x
    && cx <= container.x + container.width
    && cy >= container.y
    && cy <= container.y + container.height
  );
}

function getOpaqueFill(node: DesignNode): string | null {
  if (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') {
    const fills = getVisibleFillPaints(node);
    for (let i = fills.length - 1; i >= 0; i -= 1) {
      const paint = fills[i];
      if (paint.type !== 'solid') continue;
      const parsed = parseCssColorToRgba(paint.color);
      if (!parsed) continue;
      const effectiveAlpha = parsed.a * (paint.opacity ?? 1);
      if (effectiveAlpha > 0.05) {
        if (paint.opacity !== undefined && paint.opacity < 1) {
          return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Math.round(effectiveAlpha * 1000) / 1000})`;
        }
        return paint.color;
      }
    }
  }
  return null;
}

function resolveEffectiveBackdrop(
  node: DesignNode,
  nodeIndex: number,
  resolvedNodes: readonly DesignNode[],
  nodeById: ReadonlyMap<string, DesignNode>,
  pageBackground: string,
): string {
  // 1. Walk explicit parent container chain first
  let parentId = node.parentId;
  let guard = 0;
  while (parentId && guard < 32) {
    guard += 1;
    const parent = nodeById.get(parentId);
    if (!parent) break;
    const parentFill = getOpaqueFill(parent);
    if (parentFill) return parentFill;
    parentId = parent.parentId;
  }

  // 2. Fall back to the nearest earlier painted shape covering this node's center
  for (let i = nodeIndex - 1; i >= 0; i -= 1) {
    const candidate = resolvedNodes[i];
    if (!candidate.visible || candidate.onCanvas === false) continue;
    const fill = getOpaqueFill(candidate);
    if (fill && nodeContainsCenter(candidate, node)) {
      return fill;
    }
  }

  return pageBackground;
}

function hasVisibleDescendantText(
  nodeId: string,
  nodes: readonly DesignNode[],
): boolean {
  const stack = [nodeId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const candidate of nodes) {
      if (candidate.parentId !== current || !candidate.visible || candidate.onCanvas === false) continue;
      if (candidate.type === 'text' && candidate.text.trim().length > 0) return true;
      stack.push(candidate.id);
    }
  }
  return false;
}

const SEVERITY_ORDER: Record<A11yIssueSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Runs a deterministic WCAG 2.1 AA + semantic HTML accessibility audit on a Folio page.
 */
export function auditPageAccessibility(
  project: FolioProject,
  page: FolioPage,
  themeId?: string,
): A11yAuditReport {
  const baseTokens: DesignTokenCollection = getProjectDesignTokens(project);
  const tokens: DesignTokenCollection = themeId
    ? { ...baseTokens, activeThemeId: themeId }
    : baseTokens;

  const laidOutNodes = page.document.nodes.some((node) => node.layout && node.layout.mode !== 'none')
    ? applyAutoLayoutToNodes(page.document.nodes, undefined, tokens)
    : page.document.nodes;
  const resolvedNodes = laidOutNodes.map((node) => resolveNodeWithTokens(node, tokens));
  const nodeById = new Map(resolvedNodes.map((node) => [node.id, node]));
  const pageBg = page.document.background || '#FFFFFF';

  const issues: A11yAuditIssue[] = [];
  let passedChecks = 0;

  const headings: Array<{ level: number; node: DesignNode }> = [];

  for (let i = 0; i < resolvedNodes.length; i += 1) {
    const node = resolvedNodes[i];
    if (!node.visible || node.onCanvas === false) continue;

    const tag = resolveSemanticTag(node);

    // 1. Heading collection
    if (/^h[1-6]$/.test(tag)) {
      headings.push({ level: Number(tag[1]), node });
    }

    // 2. Text contrast & non-empty text
    if (node.type === 'text') {
      if (!node.text.trim()) {
        issues.push({
          id: `empty-text:${node.id}`,
          code: 'EMPTY_TEXT_NODE',
          severity: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          title: 'Empty visible text layer',
          message: `"${node.name}" has no text content.`,
          detail: 'Add meaningful copy or hide decorative placeholder text.',
        });
      } else {
        const backdrop = resolveEffectiveBackdrop(node, i, resolvedNodes, nodeById, pageBg);
        const ratio = computeContrastRatio(node.style.fill, backdrop);
        if (ratio !== null) {
          const isLargeText =
            node.style.fontSize >= 24 || (node.style.fontSize >= 18.67 && node.style.fontWeight >= 700);
          const minRatio = isLargeText ? 3.0 : 4.5;
          if (ratio < minRatio) {
            const suggestedFill = suggestAccessibleForegroundColor(node.style.fill, backdrop, minRatio);
            issues.push({
              id: `contrast:${node.id}`,
              code: 'CONTRAST_TOO_LOW',
              severity: ratio < 3.0 ? 'error' : 'warning',
              nodeId: node.id,
              nodeName: node.name,
              title: 'Low WCAG color contrast',
              message: `"${node.name}" contrast is ${ratio.toFixed(2)}:1 (minimum ${minRatio.toFixed(1)}:1 for ${isLargeText ? 'large' : 'normal'} text).`,
              detail: suggestedFill
                ? `Foreground ${node.style.fill} on ${backdrop} · Suggested ${suggestedFill}.`
                : `Foreground ${node.style.fill} on ${backdrop}.`,
              ...(suggestedFill
                ? {
                    fix: {
                      label: `Fix (${suggestedFill})`,
                      nodeId: node.id,
                      description: `Auto-fix WCAG contrast on ${node.name}`,
                      textFill: suggestedFill,
                    },
                  }
                : {}),
            });
          } else {
            passedChecks += 1;
          }
        }
      }
    }

    // 3. Interactive controls (<button>, <a>) naming & safe href
    if (tag === 'button' || tag === 'a') {
      const hasName =
        Boolean(node.ariaLabel?.trim())
        || (node.type === 'text' && node.text.trim().length > 0)
        || hasVisibleDescendantText(node.id, resolvedNodes);

      if (!hasName) {
        const fallbackLabel = node.name.trim() || (tag === 'a' ? 'Link' : 'Button');
        issues.push({
          id: `interactive-name:${node.id}`,
          code: 'INTERACTIVE_MISSING_NAME',
          severity: 'error',
          nodeId: node.id,
          nodeName: node.name,
          title: `Accessible name missing on <${tag}>`,
          message: `"${node.name}" renders as <${tag}> without visible text or an aria-label.`,
          detail: 'Set an ARIA label in the Inspector Web Semantics section or nest a text label.',
          fix: {
            label: 'Add Label',
            nodeId: node.id,
            description: `Add accessible aria-label to ${node.name}`,
            ariaLabel: fallbackLabel,
          },
        });
      } else {
        passedChecks += 1;
      }

      if (tag === 'a') {
        const safeHref = sanitizeHref(node.href);
        if (!node.href?.trim() || !safeHref) {
          issues.push({
            id: `unsafe-href:${node.id}`,
            code: 'LINK_MISSING_OR_UNSAFE_HREF',
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            title: 'Invalid or missing link destination',
            message: `"${node.name}" renders as <a> with a missing or disallowed href.`,
            detail: 'Use a relative path (/about), anchor (#section), https://, or mailto: URL.',
          });
        } else {
          passedChecks += 1;
        }
      }
    }
  }

  // 4. Page heading hierarchy checks
  const h1List = headings.filter((h) => h.level === 1);
  if (resolvedNodes.some((n) => n.visible && n.onCanvas !== false)) {
    if (h1List.length === 0) {
      issues.push({
        id: `missing-h1:${page.id}`,
        code: 'MISSING_H1',
        severity: 'warning',
        title: 'Page is missing an <h1> heading',
        message: `Page "${page.name}" has no primary <h1> landmark heading.`,
        detail: 'Assign semantic tag "h1" to the main page title for screen-reader navigation.',
      });
    } else if (h1List.length > 1) {
      issues.push({
        id: `multiple-h1:${page.id}`,
        code: 'MULTIPLE_H1',
        severity: 'warning',
        nodeId: h1List[1].node.id,
        nodeName: h1List[1].node.name,
        title: 'Multiple <h1> headings on page',
        message: `Page "${page.name}" defines ${h1List.length} <h1> elements.`,
        detail: 'Prefer a single primary <h1> and use <h2>–<h6> for subsections.',
        fix: {
          label: 'Set <h2>',
          nodeId: h1List[1].node.id,
          description: `Demote duplicate <h1> on ${h1List[1].node.name} to <h2>`,
          semanticTag: 'h2',
        },
      });
    } else {
      passedChecks += 1;
    }

    // Check heading level jumps (visual top-to-bottom order)
    const orderedHeadings = [...headings].sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
    for (let i = 1; i < orderedHeadings.length; i += 1) {
      const prev = orderedHeadings[i - 1];
      const curr = orderedHeadings[i];
      if (curr.level - prev.level > 1) {
        const suggestedLevel = prev.level + 1;
        const suggestedTag: SemanticHtmlTag | undefined =
          suggestedLevel === 2 ? 'h2' : suggestedLevel === 3 ? 'h3' : undefined;
        issues.push({
          id: `skipped-heading:${curr.node.id}`,
          code: 'SKIPPED_HEADING_LEVEL',
          severity: 'info',
          nodeId: curr.node.id,
          nodeName: curr.node.name,
          title: 'Skipped heading level',
          message: `"${curr.node.name}" jumps from <h${prev.level}> to <h${curr.level}>.`,
          detail: 'Keep heading levels sequential for clearer document outlines.',
          ...(suggestedTag
            ? {
                fix: {
                  label: `Set <${suggestedTag}>`,
                  nodeId: curr.node.id,
                  description: `Fix heading hierarchy on ${curr.node.name} to <${suggestedTag}>`,
                  semanticTag: suggestedTag,
                },
              }
            : {}),
        });
      }
    }
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errorCount += 1;
    else if (issue.severity === 'warning') warningCount += 1;
    else infoCount += 1;
  }

  const penalty = errorCount * 20 + warningCount * 8 + infoCount * 3;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    pageId: page.id,
    pageName: page.name,
    score,
    errorCount,
    warningCount,
    infoCount,
    passedChecks,
    issues,
  };
}
