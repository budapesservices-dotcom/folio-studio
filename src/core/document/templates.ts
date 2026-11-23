import { createEmptyDocument } from './factory';
import { createComponentInstance } from './components';
import { createPolygonPathPoints, createStarPathPoints } from './vector';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  EllipseNode,
  FolioDocument,
  FrameNode,
  PathNode,
  RectNode,
  TextNode,
  VectorAnchorPoint,
} from './types';

export type TemplateCategory = 'ui' | 'sections' | 'vectors';
export type TemplateInsertMode = 'nodes' | 'component';
export type TemplateWorkspaceScope = 'main' | 'component';
export type TemplateIdFactory = (prefix: string) => string;

export interface StudioTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly previewSurface: 'light' | 'dark';
  readonly recommendedWorkspaces: readonly TemplateWorkspaceScope[];
  readonly buildNodes: (origin: { x: number; y: number }, makeId: TemplateIdFactory) => DesignNode[];
}

let fallbackTemplateSeq = 1;

export function createDefaultTemplateId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}-${random}`;
  fallbackTemplateSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackTemplateSeq.toString(36)}`;
}

function makeFrame(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: { fill: string; stroke: string; strokeWidth: number; radius?: number },
  opts: { parentId?: string; clipContent?: boolean; isSection?: boolean; opacity?: number } = {},
): FrameNode {
  return {
    id,
    type: 'frame',
    name,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: opts.opacity ?? 1,
    visible: true,
    locked: false,
    clipContent: opts.clipContent ?? false,
    ...(opts.isSection !== undefined ? { isSection: opts.isSection } : {}),
    style,
  };
}

function makeRect(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: { fill: string; stroke: string; strokeWidth: number; radius?: number },
  parentId?: string,
): RectNode {
  return {
    id,
    type: 'rect',
    name,
    ...(parentId ? { parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style,
  };
}

function makeEllipse(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: { fill: string; stroke: string; strokeWidth: number },
  parentId?: string,
): EllipseNode {
  return {
    id,
    type: 'ellipse',
    name,
    ...(parentId ? { parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    style,
  };
}

function makeText(
  id: string,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: {
    fill: string;
    fontSize: number;
    fontWeight?: number;
    fontFamily?: string;
    letterSpacing?: number;
    lineHeight?: number;
  },
  parentId?: string,
): TextNode {
  return {
    id,
    type: 'text',
    name,
    ...(parentId ? { parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text,
    style: {
      fill: style.fill,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight ?? 500,
      fontFamily: style.fontFamily ?? 'Plus Jakarta Sans, system-ui, sans-serif',
      letterSpacing: style.letterSpacing ?? 0,
      lineHeight: style.lineHeight ?? 1.35,
    },
  };
}

function makePath(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  points: VectorAnchorPoint[],
  closed: boolean,
  style: PathNode['style'],
  opts: { parentId?: string; pathKind?: PathNode['pathKind']; shapeMeta?: PathNode['shapeMeta'] } = {},
): PathNode {
  return {
    id,
    type: 'path',
    name,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed,
    points,
    style,
    ...(opts.pathKind ? { pathKind: opts.pathKind } : {}),
    ...(opts.shapeMeta ? { shapeMeta: opts.shapeMeta } : {}),
  };
}

function anchor(
  id: string,
  x: number,
  y: number,
  pointType: VectorAnchorPoint['pointType'] = 'corner',
  handles?: { handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number } },
): VectorAnchorPoint {
  return {
    id,
    x,
    y,
    pointType,
    ...(handles?.handleIn ? { handleIn: handles.handleIn } : {}),
    ...(handles?.handleOut ? { handleOut: handles.handleOut } : {}),
  };
}

export const STUDIO_TEMPLATE_CATALOG: readonly StudioTemplateDefinition[] = Object.freeze([
  // ── UI Components (6) ──────────────────────────────────────────────
  {
    id: 'ui-primary-button',
    name: 'Primary Button',
    category: 'ui',
    summary: 'High-contrast action button with label and directional arrow.',
    keywords: ['button', 'cta', 'action', 'submit', 'ui'],
    width: 192,
    height: 48,
    previewSurface: 'dark',
    recommendedWorkspaces: ['main', 'component'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Primary Button', x, y, 192, 48, {
          fill: '#5b50ec',
          stroke: '#7e75ff',
          strokeWidth: 1,
          radius: 10,
        }),
        makeText(makeId('text'), 'Button Label', 'Get Started', x + 28, y + 13, 112, 22, {
          fill: '#ffffff',
          fontSize: 15,
          fontWeight: 600,
        }, rootId),
        makePath(
          makeId('path'),
          'Arrow Icon',
          x + 150,
          y + 18,
          16,
          12,
          [
            anchor(makeId('pt'), 0, 6),
            anchor(makeId('pt'), 15, 6),
          ],
          false,
          {
            fill: 'none',
            stroke: '#ffffff',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            arrowEnd: true,
          },
          { parentId: rootId, pathKind: 'arrow' },
        ),
      ];
    },
  },
  {
    id: 'ui-input-field',
    name: 'Input Field',
    category: 'ui',
    summary: 'Labeled form input with crisp dark border and placeholder copy.',
    keywords: ['input', 'form', 'field', 'email', 'text', 'ui'],
    width: 320,
    height: 76,
    previewSurface: 'light',
    recommendedWorkspaces: ['main', 'component'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Input Field', x, y, 320, 76, {
          fill: 'none',
          stroke: 'none',
          strokeWidth: 0,
        }),
        makeText(makeId('text'), 'Field Label', 'Work email', x, y, 160, 20, {
          fill: '#1e293b',
          fontSize: 13,
          fontWeight: 600,
        }, rootId),
        makeRect(makeId('rect'), 'Input Surface', x, y + 26, 320, 46, {
          fill: '#ffffff',
          stroke: '#cbd5e1',
          strokeWidth: 1.5,
          radius: 8,
        }, rootId),
        makeText(makeId('text'), 'Placeholder', 'you@company.com', x + 14, y + 39, 240, 20, {
          fill: '#94a3b8',
          fontSize: 14,
          fontWeight: 400,
        }, rootId),
      ];
    },
  },
  {
    id: 'ui-kpi-card',
    name: 'Metric KPI Card',
    category: 'ui',
    summary: 'Dashboard stat card with revenue figure, delta, and trend line.',
    keywords: ['kpi', 'stat', 'metric', 'dashboard', 'card', 'analytics'],
    width: 288,
    height: 156,
    previewSurface: 'light',
    recommendedWorkspaces: ['main', 'component'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Metric KPI Card', x, y, 288, 156, {
          fill: '#ffffff',
          stroke: '#e2e8f0',
          strokeWidth: 1.5,
          radius: 14,
        }, { clipContent: true }),
        makeText(makeId('text'), 'Metric Label', 'Monthly Recurring Revenue', x + 20, y + 18, 220, 18, {
          fill: '#64748b',
          fontSize: 12,
          fontWeight: 600,
        }, rootId),
        makeText(makeId('text'), 'Metric Value', '$48,920', x + 20, y + 46, 170, 38, {
          fill: '#0f172a',
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: -0.5,
        }, rootId),
        makeText(makeId('text'), 'Delta', '+18.4% vs last 30 days', x + 20, y + 90, 200, 18, {
          fill: '#15803d',
          fontSize: 12,
          fontWeight: 600,
        }, rootId),
        makePath(
          makeId('path'),
          'Trend Sparkline',
          x + 20,
          y + 114,
          248,
          26,
          [
            anchor(makeId('pt'), 0, 22, 'smooth', { handleOut: { x: 24, y: 22 } }),
            anchor(makeId('pt'), 62, 16, 'smooth', { handleIn: { x: 40, y: 20 }, handleOut: { x: 84, y: 12 } }),
            anchor(makeId('pt'), 128, 19, 'smooth', { handleIn: { x: 104, y: 20 }, handleOut: { x: 152, y: 18 } }),
            anchor(makeId('pt'), 188, 8, 'smooth', { handleIn: { x: 168, y: 14 }, handleOut: { x: 210, y: 4 } }),
            anchor(makeId('pt'), 248, 2, 'smooth', { handleIn: { x: 226, y: 4 } }),
          ],
          false,
          {
            fill: 'none',
            stroke: '#5b50ec',
            strokeWidth: 2.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          { parentId: rootId, pathKind: 'curvature' },
        ),
      ];
    },
  },
  {
    id: 'ui-feature-card',
    name: 'Feature Card',
    category: 'ui',
    summary: 'Structured feature highlight card with icon emblem and copy.',
    keywords: ['card', 'feature', 'bento', 'content', 'ui'],
    width: 312,
    height: 216,
    previewSurface: 'light',
    recommendedWorkspaces: ['main', 'component'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Feature Card', x, y, 312, 216, {
          fill: '#ffffff',
          stroke: '#e2e8f0',
          strokeWidth: 1.5,
          radius: 14,
        }),
        makeRect(makeId('rect'), 'Icon Container', x + 22, y + 22, 42, 42, {
          fill: '#eef2ff',
          stroke: '#c7d2fe',
          strokeWidth: 1,
          radius: 10,
        }, rootId),
        makePath(
          makeId('path'),
          'Feature Emblem',
          x + 31,
          y + 31,
          24,
          24,
          createStarPathPoints(24, 24, 5, 0.45),
          true,
          { fill: '#5b50ec', stroke: 'none', strokeWidth: 0 },
          { parentId: rootId, pathKind: 'star', shapeMeta: { kind: 'star', spikes: 5, innerRatio: 0.45 } },
        ),
        makeText(makeId('text'), 'Card Heading', 'Unified Design & Code', x + 22, y + 80, 260, 26, {
          fill: '#0f172a',
          fontSize: 18,
          fontWeight: 700,
        }, rootId),
        makeText(
          makeId('text'),
          'Card Copy',
          'Edit vector artwork, responsive layouts, and reusable masters in one native project.',
          x + 22,
          y + 112,
          268,
          52,
          { fill: '#475569', fontSize: 13, fontWeight: 400, lineHeight: 1.5 },
          rootId,
        ),
        makeText(makeId('text'), 'Card Action', 'Learn more ->', x + 22, y + 176, 130, 20, {
          fill: '#5b50ec',
          fontSize: 13,
          fontWeight: 600,
        }, rootId),
      ];
    },
  },
  {
    id: 'ui-navbar',
    name: 'Navigation Bar',
    category: 'ui',
    summary: 'Three-zone header bar with brand mark, 4 nav links, and CTA.',
    keywords: ['navbar', 'header', 'navigation', 'menu', 'topbar'],
    width: 960,
    height: 72,
    previewSurface: 'light',
    recommendedWorkspaces: ['main', 'component'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Navigation Bar', x, y, 960, 72, {
          fill: '#ffffff',
          stroke: '#e2e8f0',
          strokeWidth: 1,
          radius: 12,
        }),
        makeRect(makeId('rect'), 'Brand Emblem', x + 24, y + 20, 32, 32, {
          fill: '#0f172a',
          stroke: 'none',
          strokeWidth: 0,
          radius: 8,
        }, rootId),
        makeText(makeId('text'), 'Brand Name', 'Atelier Studio', x + 68, y + 24, 150, 24, {
          fill: '#0f172a',
          fontSize: 16,
          fontWeight: 700,
        }, rootId),
        makeText(makeId('text'), 'Nav Link 1', 'Product', x + 320, y + 26, 70, 20, {
          fill: '#334155',
          fontSize: 14,
          fontWeight: 500,
        }, rootId),
        makeText(makeId('text'), 'Nav Link 2', 'Templates', x + 412, y + 26, 84, 20, {
          fill: '#334155',
          fontSize: 14,
          fontWeight: 500,
        }, rootId),
        makeText(makeId('text'), 'Nav Link 3', 'Pricing', x + 518, y + 26, 68, 20, {
          fill: '#334155',
          fontSize: 14,
          fontWeight: 500,
        }, rootId),
        makeText(makeId('text'), 'Nav Link 4', 'Docs', x + 606, y + 26, 56, 20, {
          fill: '#334155',
          fontSize: 14,
          fontWeight: 500,
        }, rootId),
        makeRect(makeId('rect'), 'Header CTA Background', x + 812, y + 16, 124, 40, {
          fill: '#0f172a',
          stroke: 'none',
          strokeWidth: 0,
          radius: 8,
        }, rootId),
        makeText(makeId('text'), 'Header CTA Label', 'Start Free', x + 838, y + 26, 76, 20, {
          fill: '#ffffff',
          fontSize: 13,
          fontWeight: 600,
        }, rootId),
      ];
    },
  },
  {
    id: 'ui-alert-banner',
    name: 'Alert Banner',
    category: 'ui',
    summary: 'Inline notification banner with status icon and clear message.',
    keywords: ['alert', 'banner', 'notice', 'toast', 'callout', 'ui'],
    width: 460,
    height: 68,
    previewSurface: 'light',
    recommendedWorkspaces: ['main', 'component'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Alert Banner', x, y, 460, 68, {
          fill: '#f8fafc',
          stroke: '#cbd5e1',
          strokeWidth: 1.5,
          radius: 10,
        }),
        makeEllipse(makeId('ellipse'), 'Alert Icon Circle', x + 16, y + 20, 28, 28, {
          fill: '#e0e7ff',
          stroke: '#818cf8',
          strokeWidth: 1.5,
        }, rootId),
        makeText(makeId('text'), 'Alert Title', 'Design tokens synchronized', x + 56, y + 14, 340, 20, {
          fill: '#0f172a',
          fontSize: 14,
          fontWeight: 600,
        }, rootId),
        makeText(
          makeId('text'),
          'Alert Description',
          'All 14 component instances now reflect the latest typography scale.',
          x + 56,
          y + 36,
          388,
          20,
          { fill: '#475569', fontSize: 12, fontWeight: 400 },
          rootId,
        ),
      ];
    },
  },

  // ── Page Sections (4) ──────────────────────────────────────────────
  {
    id: 'section-hero',
    name: 'Hero Section',
    category: 'sections',
    summary: 'Split landing hero with display headline, dual CTAs, and UI stage.',
    keywords: ['hero', 'landing', 'header', 'section', 'above the fold'],
    width: 960,
    height: 440,
    previewSurface: 'dark',
    recommendedWorkspaces: ['main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Hero Section', x, y, 960, 440, {
          fill: '#0f172a',
          stroke: '#1e293b',
          strokeWidth: 1,
          radius: 16,
        }, { clipContent: true, isSection: true }),
        makeText(makeId('text'), 'Hero Headline', 'Build interfaces at the speed of thought.', x + 48, y + 72, 430, 128, {
          fill: '#f8fafc',
          fontSize: 42,
          fontWeight: 700,
          letterSpacing: -1,
          lineHeight: 1.12,
        }, rootId),
        makeText(
          makeId('text'),
          'Hero Subtitle',
          'Compose responsive pages, craft crisp vector masters, and ship clean production architecture from one visual workspace.',
          x + 48,
          y + 216,
          420,
          68,
          { fill: '#94a3b8', fontSize: 15, fontWeight: 400, lineHeight: 1.55 },
          rootId,
        ),
        makeRect(makeId('rect'), 'Primary CTA', x + 48, y + 308, 168, 46, {
          fill: '#6366f1',
          stroke: '#818cf8',
          strokeWidth: 1,
          radius: 10,
        }, rootId),
        makeText(makeId('text'), 'Primary CTA Text', 'Launch Studio', x + 80, y + 321, 112, 22, {
          fill: '#ffffff',
          fontSize: 14,
          fontWeight: 600,
        }, rootId),
        makeRect(makeId('rect'), 'Secondary CTA', x + 230, y + 308, 152, 46, {
          fill: '#1e293b',
          stroke: '#334155',
          strokeWidth: 1.5,
          radius: 10,
        }, rootId),
        makeText(makeId('text'), 'Secondary CTA Text', 'Explore Docs', x + 260, y + 321, 100, 22, {
          fill: '#e2e8f0',
          fontSize: 14,
          fontWeight: 600,
        }, rootId),
        // Right preview stage
        makeRect(makeId('rect'), 'Hero Visual Frame', x + 516, y + 54, 396, 332, {
          fill: '#1e293b',
          stroke: '#334155',
          strokeWidth: 1.5,
          radius: 14,
        }, rootId),
        makeRect(makeId('rect'), 'Preview Card Top', x + 544, y + 84, 340, 128, {
          fill: '#0f172a',
          stroke: '#475569',
          strokeWidth: 1,
          radius: 10,
        }, rootId),
        makeRect(makeId('rect'), 'Preview Card Bottom Left', x + 544, y + 230, 162, 126, {
          fill: '#312e81',
          stroke: '#4f46e5',
          strokeWidth: 1,
          radius: 10,
        }, rootId),
        makeRect(makeId('rect'), 'Preview Card Bottom Right', x + 722, y + 230, 162, 126, {
          fill: '#0f172a',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 10,
        }, rootId),
      ];
    },
  },
  {
    id: 'section-feature-grid',
    name: '3-Column Feature Grid',
    category: 'sections',
    summary: 'Section heading paired with three evenly balanced capability cards.',
    keywords: ['features', 'grid', 'columns', 'bento', 'section'],
    width: 960,
    height: 332,
    previewSurface: 'light',
    recommendedWorkspaces: ['main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      const items = [
        { title: 'Native Vector Craft', body: 'Precision Bezier paths, boolean Pathfinder, and Shape Builder.', accent: '#5b50ec' },
        { title: 'Linked Components', body: 'Edit a master once and propagate updates to every page.', accent: '#0d9488' },
        { title: 'Deterministic Output', body: 'Every layer maps cleanly to typed structure and export.', accent: '#d97706' },
      ];
      const nodes: DesignNode[] = [
        makeFrame(rootId, 'Feature Grid Section', x, y, 960, 332, {
          fill: '#f8fafc',
          stroke: '#e2e8f0',
          strokeWidth: 1,
          radius: 16,
        }, { isSection: true }),
        makeText(makeId('text'), 'Section Title', 'Built for precision teams', x + 36, y + 32, 420, 34, {
          fill: '#0f172a',
          fontSize: 26,
          fontWeight: 700,
        }, rootId),
        makeText(makeId('text'), 'Section Subtitle', 'Everything you need from wireframe to interactive system.', x + 36, y + 68, 520, 22, {
          fill: '#64748b',
          fontSize: 14,
          fontWeight: 400,
        }, rootId),
      ];
      items.forEach((item, index) => {
        const cardX = x + 36 + index * 304;
        const cardY = y + 112;
        nodes.push(
          makeRect(makeId('rect'), `Feature Card ${index + 1}`, cardX, cardY, 280, 184, {
            fill: '#ffffff',
            stroke: '#e2e8f0',
            strokeWidth: 1.5,
            radius: 12,
          }, rootId),
          makeEllipse(makeId('ellipse'), `Feature Dot ${index + 1}`, cardX + 22, cardY + 22, 32, 32, {
            fill: item.accent,
            stroke: 'none',
            strokeWidth: 0,
          }, rootId),
          makeText(makeId('text'), `Feature Heading ${index + 1}`, item.title, cardX + 22, cardY + 70, 236, 24, {
            fill: '#0f172a',
            fontSize: 16,
            fontWeight: 700,
          }, rootId),
          makeText(makeId('text'), `Feature Copy ${index + 1}`, item.body, cardX + 22, cardY + 100, 236, 56, {
            fill: '#475569',
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.5,
          }, rootId),
        );
      });
      return nodes;
    },
  },
  {
    id: 'section-pricing',
    name: 'Pricing Section',
    category: 'sections',
    summary: 'Three-tier SaaS pricing layout with highlighted Pro tier.',
    keywords: ['pricing', 'plans', 'tiers', 'saas', 'billing', 'section'],
    width: 960,
    height: 388,
    previewSurface: 'light',
    recommendedWorkspaces: ['main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      const tiers = [
        { name: 'Starter', price: '$0', desc: 'For solo creators testing prototypes.', cta: 'Start Free', featured: false },
        { name: 'Studio Pro', price: '$29', desc: 'For product teams shipping full apps.', cta: 'Choose Pro', featured: true },
        { name: 'Enterprise', price: '$99', desc: 'For organizations with custom SSO.', cta: 'Contact Sales', featured: false },
      ];
      const nodes: DesignNode[] = [
        makeFrame(rootId, 'Pricing Section', x, y, 960, 388, {
          fill: '#ffffff',
          stroke: '#e2e8f0',
          strokeWidth: 1,
          radius: 16,
        }, { isSection: true }),
        makeText(makeId('text'), 'Pricing Heading', 'Simple, transparent pricing', x + 36, y + 28, 420, 34, {
          fill: '#0f172a',
          fontSize: 26,
          fontWeight: 700,
        }, rootId),
      ];
      tiers.forEach((tier, idx) => {
        const cx = x + 36 + idx * 304;
        const cy = y + 84;
        nodes.push(
          makeRect(makeId('rect'), `${tier.name} Plan Card`, cx, cy, 280, 268, {
            fill: tier.featured ? '#0f172a' : '#f8fafc',
            stroke: tier.featured ? '#6366f1' : '#e2e8f0',
            strokeWidth: tier.featured ? 2 : 1.5,
            radius: 14,
          }, rootId),
          makeText(makeId('text'), `${tier.name} Title`, tier.name, cx + 24, cy + 24, 180, 22, {
            fill: tier.featured ? '#e2e8f0' : '#0f172a',
            fontSize: 16,
            fontWeight: 700,
          }, rootId),
          makeText(makeId('text'), `${tier.name} Price`, `${tier.price} / mo`, cx + 24, cy + 62, 180, 42, {
            fill: tier.featured ? '#ffffff' : '#0f172a',
            fontSize: 32,
            fontWeight: 700,
          }, rootId),
          makeText(makeId('text'), `${tier.name} Summary`, tier.desc, cx + 24, cy + 118, 232, 48, {
            fill: tier.featured ? '#94a3b8' : '#475569',
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.5,
          }, rootId),
          makeRect(makeId('rect'), `${tier.name} CTA`, cx + 24, cy + 198, 232, 42, {
            fill: tier.featured ? '#6366f1' : '#0f172a',
            stroke: 'none',
            strokeWidth: 0,
            radius: 8,
          }, rootId),
          makeText(makeId('text'), `${tier.name} CTA Label`, tier.cta, cx + 82, cy + 209, 130, 20, {
            fill: '#ffffff',
            fontSize: 13,
            fontWeight: 600,
          }, rootId),
        );
      });
      return nodes;
    },
  },
  {
    id: 'section-footer',
    name: 'Site Footer',
    category: 'sections',
    summary: 'Clean dark footer with brand column, link columns, and copyright.',
    keywords: ['footer', 'links', 'sitemap', 'bottom', 'section'],
    width: 960,
    height: 210,
    previewSurface: 'dark',
    recommendedWorkspaces: ['main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Site Footer', x, y, 960, 210, {
          fill: '#0f172a',
          stroke: '#1e293b',
          strokeWidth: 1,
          radius: 14,
        }, { isSection: true }),
        makeText(makeId('text'), 'Footer Brand', 'Atelier Studio', x + 40, y + 34, 180, 24, {
          fill: '#f8fafc',
          fontSize: 18,
          fontWeight: 700,
        }, rootId),
        makeText(makeId('text'), 'Footer Tagline', 'Visual-first web engineering.', x + 40, y + 66, 240, 20, {
          fill: '#94a3b8',
          fontSize: 13,
          fontWeight: 400,
        }, rootId),
        makeText(makeId('text'), 'Col 1 Heading', 'Product', x + 380, y + 34, 120, 20, {
          fill: '#f8fafc',
          fontSize: 13,
          fontWeight: 600,
        }, rootId),
        makeText(makeId('text'), 'Col 1 Links', 'Canvas\nComponents\nExport', x + 380, y + 62, 120, 68, {
          fill: '#94a3b8',
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.7,
        }, rootId),
        makeText(makeId('text'), 'Col 2 Heading', 'Resources', x + 560, y + 34, 120, 20, {
          fill: '#f8fafc',
          fontSize: 13,
          fontWeight: 600,
        }, rootId),
        makeText(makeId('text'), 'Col 2 Links', 'Documentation\nChangelog\nTemplates', x + 560, y + 62, 130, 68, {
          fill: '#94a3b8',
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.7,
        }, rootId),
        makeText(makeId('text'), 'Col 3 Heading', 'Company', x + 740, y + 34, 120, 20, {
          fill: '#f8fafc',
          fontSize: 13,
          fontWeight: 600,
        }, rootId),
        makeText(makeId('text'), 'Col 3 Links', 'About\nPrivacy\nContact', x + 740, y + 62, 120, 68, {
          fill: '#94a3b8',
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.7,
        }, rootId),
        makeRect(makeId('rect'), 'Footer Divider', x + 40, y + 154, 880, 1, {
          fill: '#1e293b',
          stroke: 'none',
          strokeWidth: 0,
        }, rootId),
        makeText(makeId('text'), 'Copyright', '© 2026 Atelier Studio. All rights reserved.', x + 40, y + 168, 320, 20, {
          fill: '#64748b',
          fontSize: 12,
          fontWeight: 400,
        }, rootId),
      ];
    },
  },

  // ── Vector Starter Kits (5 — Component Canvas / VECTOR mode ready) ─
  {
    id: 'vector-emblem-badge',
    name: 'Star Emblem Badge',
    category: 'vectors',
    summary: 'Layered ring, 8-point star path, and core emblem for vector icons.',
    keywords: ['vector', 'star', 'emblem', 'badge', 'seal', 'icon'],
    width: 160,
    height: 160,
    previewSurface: 'dark',
    recommendedWorkspaces: ['component', 'main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Star Emblem Badge', x, y, 160, 160, {
          fill: 'none',
          stroke: 'none',
          strokeWidth: 0,
        }),
        makeEllipse(makeId('ellipse'), 'Outer Ring', x + 8, y + 8, 144, 144, {
          fill: '#1e1b4b',
          stroke: '#e59a4c',
          strokeWidth: 3,
        }, rootId),
        makePath(
          makeId('path'),
          'Star Crest',
          x + 28,
          y + 28,
          104,
          104,
          createStarPathPoints(104, 104, 8, 0.54),
          true,
          { fill: '#e59a4c', stroke: '#fef3c7', strokeWidth: 2, strokeLinejoin: 'round' },
          { parentId: rootId, pathKind: 'star', shapeMeta: { kind: 'star', spikes: 8, innerRatio: 0.54 } },
        ),
        makeEllipse(makeId('ellipse'), 'Center Core', x + 60, y + 60, 40, 40, {
          fill: '#1e1b4b',
          stroke: '#fde68a',
          strokeWidth: 2,
        }, rootId),
      ];
    },
  },
  {
    id: 'vector-logo-mark',
    name: 'Geometric Logo Kit',
    category: 'vectors',
    summary: 'Overlapping hexagon and circle paths ready for Pathfinder or Shape Builder.',
    keywords: ['vector', 'logo', 'boolean', 'pathfinder', 'hexagon', 'shape builder'],
    width: 180,
    height: 140,
    previewSurface: 'dark',
    recommendedWorkspaces: ['component', 'main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Geometric Logo Kit', x, y, 180, 140, {
          fill: 'none',
          stroke: 'none',
          strokeWidth: 0,
        }),
        makePath(
          makeId('path'),
          'Hexagon Base',
          x + 12,
          y + 16,
          108,
          108,
          createPolygonPathPoints(108, 108, 6),
          true,
          { fill: '#6366f1', stroke: '#c7d2fe', strokeWidth: 2, strokeLinejoin: 'round' },
          { parentId: rootId, pathKind: 'polygon', shapeMeta: { kind: 'polygon', sides: 6 } },
        ),
        makeEllipse(makeId('ellipse'), 'Intersecting Orbit', x + 72, y + 22, 96, 96, {
          fill: '#e59a4c',
          stroke: '#fde68a',
          strokeWidth: 2,
        }, rootId),
        makePath(
          makeId('path'),
          'Accent Cut',
          x + 48,
          y + 42,
          84,
          56,
          [
            anchor(makeId('pt'), 0, 56),
            anchor(makeId('pt'), 84, 0),
          ],
          false,
          { fill: 'none', stroke: '#ffffff', strokeWidth: 4, strokeLinecap: 'round' },
          { parentId: rootId, pathKind: 'line' },
        ),
      ];
    },
  },
  {
    id: 'vector-icon-frame',
    name: 'App Icon Frame',
    category: 'vectors',
    summary: 'Squircle app icon shell with layered Bezier diamond glyph.',
    keywords: ['vector', 'icon', 'app', 'squircle', 'glyph'],
    width: 128,
    height: 128,
    previewSurface: 'dark',
    recommendedWorkspaces: ['component', 'main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'App Icon Frame', x, y, 128, 128, {
          fill: '#18181b',
          stroke: '#3f3f46',
          strokeWidth: 2,
          radius: 28,
        }, { clipContent: true }),
        makePath(
          makeId('path'),
          'Outer Prism',
          x + 24,
          y + 24,
          80,
          80,
          [
            anchor(makeId('pt'), 40, 0),
            anchor(makeId('pt'), 80, 40),
            anchor(makeId('pt'), 40, 80),
            anchor(makeId('pt'), 0, 40),
          ],
          true,
          { fill: '#5b50ec', stroke: '#a5b4fc', strokeWidth: 2, strokeLinejoin: 'round' },
          { parentId: rootId, pathKind: 'pen' },
        ),
        makePath(
          makeId('path'),
          'Inner Facet',
          x + 42,
          y + 42,
          44,
          44,
          createPolygonPathPoints(44, 44, 4),
          true,
          { fill: '#f8fafc', stroke: 'none', strokeWidth: 0 },
          { parentId: rootId, pathKind: 'polygon', shapeMeta: { kind: 'polygon', sides: 4 } },
        ),
      ];
    },
  },
  {
    id: 'vector-callout-arrow',
    name: 'Callout Arrow Ribbon',
    category: 'vectors',
    summary: 'Directional vector callout ribbon with editable anchor points.',
    keywords: ['vector', 'arrow', 'ribbon', 'callout', 'pointer', 'banner'],
    width: 240,
    height: 72,
    previewSurface: 'dark',
    recommendedWorkspaces: ['component', 'main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Callout Arrow Ribbon', x, y, 240, 72, {
          fill: 'none',
          stroke: 'none',
          strokeWidth: 0,
        }),
        makePath(
          makeId('path'),
          'Arrow Ribbon Path',
          x + 4,
          y + 8,
          232,
          56,
          [
            anchor(makeId('pt'), 0, 10),
            anchor(makeId('pt'), 182, 10),
            anchor(makeId('pt'), 182, 0),
            anchor(makeId('pt'), 232, 28),
            anchor(makeId('pt'), 182, 56),
            anchor(makeId('pt'), 182, 46),
            anchor(makeId('pt'), 0, 46),
          ],
          true,
          { fill: '#e59a4c', stroke: '#fde68a', strokeWidth: 2, strokeLinejoin: 'round' },
          { parentId: rootId, pathKind: 'pen' },
        ),
        makeText(makeId('text'), 'Ribbon Text', 'NEW RELEASE', x + 24, y + 26, 150, 20, {
          fill: '#1c1917',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.6,
        }, rootId),
      ];
    },
  },
  {
    id: 'vector-wave-divider',
    name: 'Bezier Wave Accent',
    category: 'vectors',
    summary: 'Dual smooth cubic Bezier curves for decorative dividers and strokes.',
    keywords: ['vector', 'wave', 'curve', 'bezier', 'divider', 'stroke'],
    width: 340,
    height: 92,
    previewSurface: 'dark',
    recommendedWorkspaces: ['component', 'main'],
    buildNodes: ({ x, y }, makeId) => {
      const rootId = makeId('frame');
      return [
        makeFrame(rootId, 'Bezier Wave Accent', x, y, 340, 92, {
          fill: 'none',
          stroke: 'none',
          strokeWidth: 0,
        }),
        makePath(
          makeId('path'),
          'Primary Wave',
          x + 10,
          y + 14,
          320,
          64,
          [
            anchor(makeId('pt'), 0, 46, 'smooth', { handleOut: { x: 46, y: 6 } }),
            anchor(makeId('pt'), 108, 22, 'smooth', { handleIn: { x: 70, y: 6 }, handleOut: { x: 146, y: 38 } }),
            anchor(makeId('pt'), 214, 52, 'smooth', { handleIn: { x: 178, y: 64 }, handleOut: { x: 252, y: 40 } }),
            anchor(makeId('pt'), 320, 14, 'smooth', { handleIn: { x: 286, y: 6 } }),
          ],
          false,
          { fill: 'none', stroke: '#818cf8', strokeWidth: 4, strokeLinecap: 'round' },
          { parentId: rootId, pathKind: 'curvature' },
        ),
        makePath(
          makeId('path'),
          'Secondary Wave',
          x + 10,
          y + 24,
          320,
          58,
          [
            anchor(makeId('pt'), 0, 44, 'smooth', { handleOut: { x: 52, y: 12 } }),
            anchor(makeId('pt'), 112, 26, 'smooth', { handleIn: { x: 74, y: 14 }, handleOut: { x: 150, y: 38 } }),
            anchor(makeId('pt'), 218, 48, 'smooth', { handleIn: { x: 182, y: 58 }, handleOut: { x: 256, y: 36 } }),
            anchor(makeId('pt'), 320, 18, 'smooth', { handleIn: { x: 288, y: 12 } }),
          ],
          false,
          { fill: 'none', stroke: '#e59a4c', strokeWidth: 2.5, strokeLinecap: 'round', strokeDasharray: '6 5' },
          { parentId: rootId, pathKind: 'curvature' },
        ),
      ];
    },
  },
]);

export function getStudioTemplate(templateId: string): StudioTemplateDefinition | undefined {
  return STUDIO_TEMPLATE_CATALOG.find((item) => item.id === templateId);
}

export function instantiateTemplateNodes(
  template: StudioTemplateDefinition,
  origin: { x: number; y: number },
  idFactory: TemplateIdFactory = createDefaultTemplateId,
): DesignNode[] {
  return template.buildNodes(origin, idFactory);
}

/**
 * Computes a clean, deterministic placement origin inside the target document
 * with a gentle cascade offset for consecutive insertions.
 */
export function computeTemplateInsertionOrigin(
  document: FolioDocument,
  template: StudioTemplateDefinition,
  staggerIndex = 0,
): { x: number; y: number } {
  const step = (staggerIndex % 6) * 24;
  const baseX = Math.max(24, Math.round((document.width - template.width) / 2));
  const baseY = Math.max(24, Math.round((document.height - template.height) / 3));
  const maxX = Math.max(16, document.width - Math.min(template.width, document.width - 16));
  const maxY = Math.max(16, document.height - Math.min(template.height, document.height - 16));
  return {
    x: Math.min(maxX, baseX + step),
    y: Math.min(maxY, baseY + step),
  };
}

/**
 * Builds a deterministic, immutable FolioDocument for live SVG preview rendering.
 */
export function buildTemplatePreviewDocument(template: StudioTemplateDefinition): FolioDocument {
  let seq = 0;
  const deterministicId: TemplateIdFactory = (prefix) => {
    seq += 1;
    return `tpl-preview-${template.id}-${prefix}-${seq}`;
  };
  const doc = createEmptyDocument(template.name, template.width, template.height);
  doc.id = `tpl-preview-doc-${template.id}`;
  doc.background = 'transparent';
  doc.nodes = template.buildNodes({ x: 0, y: 0 }, deterministicId);
  return doc;
}

/**
 * Builds a reusable Master ComponentDefinition + linked ComponentInstanceNode
 * from a template so both can be committed in one atomic Native Command transaction.
 */
export function buildTemplateComponentAndInstance(
  template: StudioTemplateDefinition,
  origin: { x: number; y: number },
  existingComponentNames: readonly string[],
  idFactory: TemplateIdFactory = createDefaultTemplateId,
): { component: ComponentDefinition; instance: ComponentInstanceNode } {
  const existing = new Set(existingComponentNames.map((n) => n.trim().toLowerCase()));
  let componentName = template.name;
  let suffix = 2;
  while (existing.has(componentName.trim().toLowerCase())) {
    componentName = `${template.name} ${suffix}`;
    suffix += 1;
  }

  const now = new Date().toISOString();
  const doc = createEmptyDocument(componentName, template.width, template.height);
  doc.id = idFactory('comp-doc');
  doc.background = '#00000000';
  doc.nodes = template.buildNodes({ x: 0, y: 0 }, idFactory);

  const component: ComponentDefinition = {
    id: idFactory('component'),
    name: componentName,
    document: doc,
    createdAt: now,
    updatedAt: now,
  };

  const instance: ComponentInstanceNode = {
    ...createComponentInstance(component, origin.x, origin.y),
    id: idFactory('instance'),
  };

  return { component, instance };
}

export interface TemplateCategoryMeta {
  readonly id: TemplateCategory;
  readonly label: string;
  readonly shortLabel: string;
}

export const TEMPLATE_CATEGORY_META: readonly TemplateCategoryMeta[] = Object.freeze([
  { id: 'ui', label: 'UI Components', shortLabel: 'UI' },
  { id: 'sections', label: 'Page Sections', shortLabel: 'Sections' },
  { id: 'vectors', label: 'Vector Starter Kits', shortLabel: 'Vectors' },
]);

export const TEMPLATE_CATEGORY_LABELS: Readonly<Record<TemplateCategory, string>> = Object.freeze({
  ui: 'UI Components',
  sections: 'Page Sections',
  vectors: 'Vector Starter Kits',
});

export function tokenizeTemplateSearch(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of normalized.split(/\s+/)) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    tokens.push(part);
  }
  return tokens;
}

export function scoreTemplateMatch(
  template: StudioTemplateDefinition,
  tokens: readonly string[],
  rawQuery = '',
): number {
  if (tokens.length === 0) return 1;

  const nameLower = template.name.toLowerCase();
  const nameWords = nameLower.split(/[\s\-_/]+/);
  const summaryLower = template.summary.toLowerCase();
  const categoryLower = template.category.toLowerCase();
  const categoryLabelLower = TEMPLATE_CATEGORY_LABELS[template.category].toLowerCase();
  const keywordsLower = template.keywords.map((kw) => kw.toLowerCase());

  let totalScore = 0;
  for (const token of tokens) {
    let tokenScore = 0;

    if (nameLower === token) {
      tokenScore = Math.max(tokenScore, 120);
    } else if (nameLower.startsWith(token)) {
      tokenScore = Math.max(tokenScore, 80);
    } else if (nameWords.some((word) => word.startsWith(token))) {
      tokenScore = Math.max(tokenScore, 60);
    } else if (nameLower.includes(token)) {
      tokenScore = Math.max(tokenScore, 45);
    }

    for (const kw of keywordsLower) {
      if (kw === token) {
        tokenScore = Math.max(tokenScore, 35);
      } else if (kw.startsWith(token)) {
        tokenScore = Math.max(tokenScore, 28);
      } else if (kw.includes(token)) {
        tokenScore = Math.max(tokenScore, 20);
      }
    }

    if (categoryLower === token || categoryLabelLower.includes(token)) {
      tokenScore = Math.max(tokenScore, 16);
    }

    if (summaryLower.includes(token)) {
      tokenScore = Math.max(tokenScore, 10);
    }

    if (tokenScore === 0) return 0;
    totalScore += tokenScore;
  }

  const normalizedQuery = rawQuery.trim().toLowerCase();
  if (normalizedQuery.length > 0 && nameLower.includes(normalizedQuery)) {
    totalScore += 40;
  }

  return totalScore;
}

export function filterStudioTemplates(
  templates: readonly StudioTemplateDefinition[],
  query: string,
  category: 'all' | TemplateCategory = 'all',
): StudioTemplateDefinition[] {
  const scoped = category === 'all'
    ? templates
    : templates.filter((item) => item.category === category);
  const tokens = tokenizeTemplateSearch(query);
  if (tokens.length === 0) {
    return [...scoped];
  }

  const scored: Array<{ template: StudioTemplateDefinition; score: number; index: number }> = [];
  for (let index = 0; index < scoped.length; index += 1) {
    const template = scoped[index];
    const score = scoreTemplateMatch(template, tokens, query);
    if (score > 0) {
      scored.push({ template, score, index });
    }
  }

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((entry) => entry.template);
}

export function countMatchingTemplatesByCategory(
  templates: readonly StudioTemplateDefinition[],
  query: string,
): Record<'all' | TemplateCategory, number> {
  const tokens = tokenizeTemplateSearch(query);
  const counts: Record<'all' | TemplateCategory, number> = {
    all: 0,
    ui: 0,
    sections: 0,
    vectors: 0,
  };

  for (const template of templates) {
    if (tokens.length === 0 || scoreTemplateMatch(template, tokens, query) > 0) {
      counts.all += 1;
      counts[template.category] += 1;
    }
  }

  return counts;
}

export interface TemplateCategoryGroup<T extends { readonly template: StudioTemplateDefinition }> {
  readonly category: TemplateCategory;
  readonly label: string;
  readonly items: readonly T[];
}

export function groupTemplatesByCategory<T extends { readonly template: StudioTemplateDefinition }>(
  items: readonly T[],
): TemplateCategoryGroup<T>[] {
  const buckets: Record<TemplateCategory, T[]> = {
    ui: [],
    sections: [],
    vectors: [],
  };

  for (const item of items) {
    buckets[item.template.category].push(item);
  }

  const groups: TemplateCategoryGroup<T>[] = [];
  for (const meta of TEMPLATE_CATEGORY_META) {
    if (buckets[meta.id].length > 0) {
      groups.push({
        category: meta.id,
        label: meta.label,
        items: buckets[meta.id],
      });
    }
  }
  return groups;
}

export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

export function splitHighlightSegments(text: string, tokens: readonly string[]): HighlightSegment[] {
  if (!text || tokens.length === 0) {
    return [{ text, match: false }];
  }
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    if (!token) continue;
    let startIndex = 0;
    while (startIndex < lower.length) {
      const found = lower.indexOf(token, startIndex);
      if (found === -1) break;
      ranges.push([found, found + token.length]);
      startIndex = found + token.length;
    }
  }

  if (ranges.length === 0) {
    return [{ text, match: false }];
  }

  ranges.sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  const merged: Array<[number, number]> = [ranges[0]];
  for (let i = 1; i < ranges.length; i += 1) {
    const [start, end] = ranges[i];
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
}

