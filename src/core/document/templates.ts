import { createEmptyDocument } from './factory';
import { createComponentInstance } from './components';
import { UI_COMPONENT_TEMPLATES } from './templatesUi';
import { SECTION_TEMPLATES } from './templatesSections';
import { PAGE_TEMPLATES } from './templatesPages';
import { VECTOR_STARTER_TEMPLATES } from './templatesVectors';
import type {
  StudioTemplateDefinition,
  TemplateBuiltBundle,
  TemplateCategory,
  TemplateIdFactory,
  TemplateInsertMode,
  TemplateOrigin,
  TemplateWorkspaceScope,
} from './templatesHelpers';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioDocument,
  FolioPage,
  LogicGraph,
} from './types';

export type {
  StudioTemplateDefinition,
  TemplateBuiltBundle,
  TemplateCategory,
  TemplateIdFactory,
  TemplateInsertMode,
  TemplateOrigin,
  TemplateWorkspaceScope,
};

let fallbackTemplateSeq = 1;

export function createDefaultTemplateId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}-${random}`;
  fallbackTemplateSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackTemplateSeq.toString(36)}`;
}

export const STUDIO_TEMPLATE_CATALOG: readonly StudioTemplateDefinition[] = Object.freeze([
  ...UI_COMPONENT_TEMPLATES,
  ...SECTION_TEMPLATES,
  ...PAGE_TEMPLATES,
  ...VECTOR_STARTER_TEMPLATES,
]);

export function getStudioTemplate(templateId: string): StudioTemplateDefinition | undefined {
  return STUDIO_TEMPLATE_CATALOG.find((item) => item.id === templateId);
}

/**
 * Ensures decorative overlay labels/knobs that sit over sibling interactive button
 * rects pass pointer events through to the button in Live Preview & HTML exports,
 * while remaining fully selectable on the Studio Canvas.
 */
function applyClickThroughOverlays(nodes: DesignNode[], logicGraph: LogicGraph | null): DesignNode[] {
  const interactiveIds = new Set<string>();
  if (logicGraph) {
    for (const ln of logicGraph.nodes) {
      const targetId = typeof ln.data?.targetNodeId === 'string' ? ln.data.targetNodeId : null;
      if (targetId && ln.type.startsWith('event.')) {
        interactiveIds.add(targetId);
      }
    }
  }

  const interactiveRects: DesignNode[] = [];
  for (const node of nodes) {
    if (
      node.type === 'rect' &&
      (interactiveIds.has(node.id) || node.semanticTag === 'button')
    ) {
      interactiveRects.push(node);
    }
  }
  if (interactiveRects.length === 0) return nodes;

  return nodes.map((node) => {
    if (node.pointerEvents || interactiveIds.has(node.id)) return node;
    if (node.type !== 'text' && node.type !== 'ellipse') return node;
    if (node.semanticTag === 'button' || node.semanticTag === 'input' || node.semanticTag === 'a') {
      return node;
    }
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const sitsOverSiblingButton = interactiveRects.some(
      (btn) =>
        btn.id !== node.id &&
        btn.parentId === node.parentId &&
        cx >= btn.x - 4 &&
        cx <= btn.x + btn.width + 4 &&
        cy >= btn.y - 4 &&
        cy <= btn.y + btn.height + 4,
    );
    if (!sitsOverSiblingButton) return node;
    return { ...node, pointerEvents: 'none' };
  });
}

export interface InstantiatedTemplateBundle {
  readonly nodes: DesignNode[];
  readonly logicGraph: LogicGraph | null;
  readonly logicNodeCount: number;
}

export function instantiateTemplateBundle(
  template: StudioTemplateDefinition,
  origin: TemplateOrigin,
  logicTarget?: { scope: 'page' | 'component'; targetId: string },
  idFactory: TemplateIdFactory = createDefaultTemplateId,
): InstantiatedTemplateBundle {
  if (template.buildBundle) {
    const built = template.buildBundle(origin, idFactory, logicTarget);
    const nodes = applyClickThroughOverlays(built.nodes, built.logicGraph);
    return {
      nodes,
      logicGraph: built.logicGraph,
      logicNodeCount: built.logicGraph?.nodes.length ?? 0,
    };
  }
  const nodes = template.buildNodes(origin, idFactory);
  return {
    nodes,
    logicGraph: null,
    logicNodeCount: 0,
  };
}

export function instantiateTemplateNodes(
  template: StudioTemplateDefinition,
  origin: TemplateOrigin,
  idFactory: TemplateIdFactory = createDefaultTemplateId,
): DesignNode[] {
  return instantiateTemplateBundle(template, origin, undefined, idFactory).nodes;
}

const LOGIC_COUNT_CACHE = new Map<string, number>();

export function getTemplateLogicNodeCount(template: StudioTemplateDefinition): number {
  const cached = LOGIC_COUNT_CACHE.get(template.id);
  if (cached !== undefined) return cached;
  if (!template.buildBundle) {
    LOGIC_COUNT_CACHE.set(template.id, 0);
    return 0;
  }
  let seq = 0;
  const deterministicId: TemplateIdFactory = (prefix) => {
    seq += 1;
    return `tpl-meta-${template.id}-${prefix}-${seq}`;
  };
  const built = template.buildBundle(
    { x: 0, y: 0 },
    deterministicId,
    { scope: 'page', targetId: 'meta-preview-page' },
  );
  const count = built.logicGraph?.nodes.length ?? 0;
  LOGIC_COUNT_CACHE.set(template.id, count);
  return count;
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
  if (template.category === 'pages' && document.nodes.length === 0) {
    return { x: 0, y: 0 };
  }
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
  doc.background = template.pageBackground ?? 'transparent';
  doc.nodes = template.buildNodes({ x: 0, y: 0 }, deterministicId);
  return doc;
}

/**
 * Builds a reusable Master ComponentDefinition + linked ComponentInstanceNode
 * + optional component-scoped LogicGraph so everything commits in one atomic transaction.
 */
export function buildTemplateComponentAndInstance(
  template: StudioTemplateDefinition,
  origin: TemplateOrigin,
  existingComponentNames: readonly string[],
  idFactory: TemplateIdFactory = createDefaultTemplateId,
): {
  component: ComponentDefinition;
  instance: ComponentInstanceNode;
  componentLogicGraph: LogicGraph | null;
} {
  const existing = new Set(existingComponentNames.map((n) => n.trim().toLowerCase()));
  let componentName = template.name;
  let suffix = 2;
  while (existing.has(componentName.trim().toLowerCase())) {
    componentName = `${template.name} ${suffix}`;
    suffix += 1;
  }

  const now = new Date().toISOString();
  const componentId = idFactory('component');
  const built = instantiateTemplateBundle(
    template,
    { x: 0, y: 0 },
    { scope: 'component', targetId: componentId },
    idFactory,
  );

  const doc = createEmptyDocument(componentName, template.width, template.height);
  doc.id = idFactory('comp-doc');
  doc.background = '#00000000';
  doc.nodes = built.nodes;

  const component: ComponentDefinition = {
    id: componentId,
    name: componentName,
    document: doc,
    ...(built.logicGraph ? { nodeLogicEnabled: true } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const instance: ComponentInstanceNode = {
    ...createComponentInstance(component, origin.x, origin.y),
    id: idFactory('instance'),
  };

  return {
    component,
    instance,
    componentLogicGraph: built.logicGraph,
  };
}

/**
 * Builds a complete, standalone FolioPage + page-scoped LogicGraph from a template
 * (ideal for Full Page templates or building a dedicated showcase page in one click).
 */
export function buildTemplatePageBundle(
  template: StudioTemplateDefinition,
  existingPages: readonly FolioPage[],
  idFactory: TemplateIdFactory = createDefaultTemplateId,
): { page: FolioPage; logicGraph: LogicGraph | null } {
  const existingNames = new Set(existingPages.map((p) => p.name.trim().toLowerCase()));
  const existingRoutes = new Set(existingPages.map((p) => p.route.trim().toLowerCase()));

  let pageName = template.name;
  let suffix = 2;
  while (existingNames.has(pageName.trim().toLowerCase())) {
    pageName = `${template.name} ${suffix}`;
    suffix += 1;
  }

  const baseSlug =
    pageName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `page-${existingPages.length + 1}`;
  let route = `/${baseSlug}`;
  let routeSuffix = 2;
  while (existingRoutes.has(route)) {
    route = `/${baseSlug}-${routeSuffix}`;
    routeSuffix += 1;
  }

  const pageId = idFactory('page');
  const built = instantiateTemplateBundle(
    template,
    { x: 0, y: 0 },
    { scope: 'page', targetId: pageId },
    idFactory,
  );

  const doc = createEmptyDocument(pageName, template.width, template.height);
  doc.id = idFactory('page-doc');
  doc.background = template.pageBackground ?? (template.previewSurface === 'dark' ? '#090D16' : '#FFFFFF');
  doc.nodes = built.nodes;

  return {
    page: {
      id: pageId,
      name: pageName,
      route,
      document: doc,
    },
    logicGraph: built.logicGraph,
  };
}

export interface TemplateCategoryMeta {
  readonly id: TemplateCategory;
  readonly label: string;
  readonly shortLabel: string;
}

export const TEMPLATE_CATEGORY_META: readonly TemplateCategoryMeta[] = Object.freeze([
  { id: 'ui', label: 'Interactive UI', shortLabel: 'UI' },
  { id: 'sections', label: 'Page Sections', shortLabel: 'Sections' },
  { id: 'pages', label: 'Ready-to-Use Pages', shortLabel: 'Pages' },
  { id: 'vectors', label: 'Vector Starter Kits', shortLabel: 'Vectors' },
]);

export const TEMPLATE_CATEGORY_LABELS: Readonly<Record<TemplateCategory, string>> = Object.freeze({
  ui: 'Interactive UI',
  sections: 'Page Sections',
  pages: 'Ready-to-Use Pages',
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
  const highlightsLower = (template.logicHighlights ?? []).map((hl) => hl.toLowerCase());

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

    if (highlightsLower.some((hl) => hl.includes(token))) {
      tokenScore = Math.max(tokenScore, 14);
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
    pages: 0,
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
    pages: [],
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
