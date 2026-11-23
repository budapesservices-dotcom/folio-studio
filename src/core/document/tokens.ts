import type {
  DesignNode,
  DesignTokenCategory,
  DesignTokenCollection,
  DesignTokenDefinition,
  DesignTokenUnit,
  DesignTokenValue,
  FolioProject,
} from './types';

export interface ResolvedDesignToken {
  ok: true;
  token: DesignTokenDefinition;
  category: DesignTokenCategory;
  rawValue: string | number;
  unit?: DesignTokenUnit;
  cssValue: string;
  numericValue?: number;
  chain: string[];
}

export interface DesignTokenResolutionError {
  ok: false;
  code: 'TOKEN_NOT_FOUND' | 'CYCLIC_ALIAS' | 'TYPE_MISMATCH' | 'INVALID_VALUE';
  message: string;
}

export type DesignTokenResolution = ResolvedDesignToken | DesignTokenResolutionError;

export interface TokenUsageReference {
  scope: 'page' | 'component' | 'token-alias';
  ownerId: string;
  ownerName: string;
  targetId: string;
  targetName: string;
  property: string;
}

/**
 * Curated default Design Token collection with Primitive & Semantic layers
 * plus Light & Dark themes following FOLIO Blueprint §10.
 */
export function createDefaultDesignTokens(): DesignTokenCollection {
  return {
    activeThemeId: 'theme-light',
    themes: [
      { id: 'theme-light', name: 'Light' },
      { id: 'theme-dark', name: 'Dark' },
    ],
    tokens: [
      // Primitives — Colors
      {
        id: 'tok-color-violet-500',
        name: 'color.violet.500',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#7C6CF6' },
      },
      {
        id: 'tok-color-violet-400',
        name: 'color.violet.400',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#9B8CFF' },
      },
      {
        id: 'tok-color-sand-100',
        name: 'color.sand.100',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#F5F2EC' },
      },
      {
        id: 'tok-color-sand-200',
        name: 'color.sand.200',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#E6DDD0' },
      },
      {
        id: 'tok-color-ink-900',
        name: 'color.ink.900',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#1D1F28' },
      },
      {
        id: 'tok-color-ink-700',
        name: 'color.ink.700',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#2B2E3B' },
      },
      {
        id: 'tok-color-slate-100',
        name: 'color.slate.100',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#F3F5FA' },
      },
      {
        id: 'tok-color-slate-400',
        name: 'color.slate.400',
        layer: 'primitive',
        category: 'color',
        value: { kind: 'literal', value: '#8E96A8' },
      },
      // Semantic — Colors (theme-aware)
      {
        id: 'tok-sem-surface-canvas',
        name: 'surface.canvas',
        layer: 'semantic',
        category: 'color',
        value: { kind: 'alias', tokenId: 'tok-color-sand-100' },
        themeValues: {
          'theme-light': { kind: 'alias', tokenId: 'tok-color-sand-100' },
          'theme-dark': { kind: 'alias', tokenId: 'tok-color-ink-900' },
        },
      },
      {
        id: 'tok-sem-surface-card',
        name: 'surface.card',
        layer: 'semantic',
        category: 'color',
        value: { kind: 'alias', tokenId: 'tok-color-sand-200' },
        themeValues: {
          'theme-light': { kind: 'alias', tokenId: 'tok-color-sand-200' },
          'theme-dark': { kind: 'alias', tokenId: 'tok-color-ink-700' },
        },
      },
      {
        id: 'tok-sem-text-primary',
        name: 'text.primary',
        layer: 'semantic',
        category: 'color',
        value: { kind: 'alias', tokenId: 'tok-color-ink-900' },
        themeValues: {
          'theme-light': { kind: 'alias', tokenId: 'tok-color-ink-900' },
          'theme-dark': { kind: 'alias', tokenId: 'tok-color-slate-100' },
        },
      },
      {
        id: 'tok-sem-accent-primary',
        name: 'accent.primary',
        layer: 'semantic',
        category: 'color',
        value: { kind: 'alias', tokenId: 'tok-color-violet-500' },
        themeValues: {
          'theme-light': { kind: 'alias', tokenId: 'tok-color-violet-500' },
          'theme-dark': { kind: 'alias', tokenId: 'tok-color-violet-400' },
        },
      },
      // Spacing
      {
        id: 'tok-space-sm',
        name: 'space.sm',
        layer: 'primitive',
        category: 'spacing',
        value: { kind: 'literal', value: 8, unit: 'px' },
      },
      {
        id: 'tok-space-md',
        name: 'space.md',
        layer: 'primitive',
        category: 'spacing',
        value: { kind: 'literal', value: 16, unit: 'px' },
      },
      {
        id: 'tok-space-lg',
        name: 'space.lg',
        layer: 'primitive',
        category: 'spacing',
        value: { kind: 'literal', value: 24, unit: 'px' },
      },
      // Radius
      {
        id: 'tok-radius-sm',
        name: 'radius.sm',
        layer: 'primitive',
        category: 'radius',
        value: { kind: 'literal', value: 8, unit: 'px' },
      },
      {
        id: 'tok-radius-md',
        name: 'radius.md',
        layer: 'primitive',
        category: 'radius',
        value: { kind: 'literal', value: 16, unit: 'px' },
      },
      {
        id: 'tok-radius-lg',
        name: 'radius.lg',
        layer: 'primitive',
        category: 'radius',
        value: { kind: 'literal', value: 28, unit: 'px' },
      },
      // Typography
      {
        id: 'tok-type-body',
        name: 'type.body',
        layer: 'semantic',
        category: 'typography',
        value: { kind: 'literal', value: 16, unit: 'px' },
      },
      {
        id: 'tok-type-heading',
        name: 'type.heading',
        layer: 'semantic',
        category: 'typography',
        value: { kind: 'literal', value: 36, unit: 'px' },
      },
    ],
  };
}

export function getProjectDesignTokens(project: FolioProject): DesignTokenCollection {
  return project.designTokens ?? createDefaultDesignTokens();
}

export function toCssVariableName(tokenName: string): string {
  const sanitized = tokenName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `--${sanitized || 'token'}`;
}

function formatCssValue(value: string | number, unit?: DesignTokenUnit): string {
  if (typeof value === 'number') {
    return unit ? `${value}${unit}` : `${value}px`;
  }
  return value;
}

export function resolveDesignTokenValue(
  collection: DesignTokenCollection,
  tokenId: string,
  themeId: string = collection.activeThemeId,
): DesignTokenResolution {
  const byId = new Map(collection.tokens.map((token) => [token.id, token]));
  const start = byId.get(tokenId);
  if (!start) {
    return {
      ok: false,
      code: 'TOKEN_NOT_FOUND',
      message: `Design token "${tokenId}" does not exist.`,
    };
  }

  const visited = new Set<string>();
  const chain: string[] = [];
  let current: DesignTokenDefinition = start;

  while (true) {
    if (visited.has(current.id)) {
      return {
        ok: false,
        code: 'CYCLIC_ALIAS',
        message: `Cyclic design token alias detected at "${current.name}".`,
      };
    }
    visited.add(current.id);
    chain.push(current.id);

    const activeValue: DesignTokenValue = current.themeValues?.[themeId] ?? current.value;
    if (activeValue.kind === 'literal') {
      if (current.category === 'color') {
        if (typeof activeValue.value !== 'string' || !activeValue.value.trim()) {
          return {
            ok: false,
            code: 'INVALID_VALUE',
            message: `Color token "${current.name}" must resolve to a non-empty color string.`,
          };
        }
        return {
          ok: true,
          token: start,
          category: start.category,
          rawValue: activeValue.value,
          cssValue: activeValue.value,
          chain,
        };
      }

      const num = typeof activeValue.value === 'number' ? activeValue.value : Number(activeValue.value);
      if (!Number.isFinite(num)) {
        return {
          ok: false,
          code: 'INVALID_VALUE',
          message: `Numeric token "${current.name}" must resolve to a finite number.`,
        };
      }
      return {
        ok: true,
        token: start,
        category: start.category,
        rawValue: num,
        unit: activeValue.unit ?? 'px',
        numericValue: num,
        cssValue: formatCssValue(num, activeValue.unit ?? 'px'),
        chain,
      };
    }

    const next = byId.get(activeValue.tokenId);
    if (!next) {
      return {
        ok: false,
        code: 'TOKEN_NOT_FOUND',
        message: `Token "${current.name}" aliases missing token "${activeValue.tokenId}".`,
      };
    }
    if (next.category !== start.category) {
      return {
        ok: false,
        code: 'TYPE_MISMATCH',
        message: `Token "${start.name}" (${start.category}) cannot alias "${next.name}" (${next.category}).`,
      };
    }
    current = next;
  }
}

export function validateDesignTokenCollection(
  collection: DesignTokenCollection,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(collection.themes) || collection.themes.length === 0) {
    return { ok: false, error: 'Design token collection requires at least one theme.' };
  }
  const themeIds = new Set<string>();
  for (const theme of collection.themes) {
    if (!theme.id || !theme.name.trim()) {
      return { ok: false, error: 'Every design theme must have an ID and non-empty name.' };
    }
    if (themeIds.has(theme.id)) {
      return { ok: false, error: `Duplicate theme ID "${theme.id}".` };
    }
    themeIds.add(theme.id);
  }
  if (!themeIds.has(collection.activeThemeId)) {
    return { ok: false, error: `Active theme "${collection.activeThemeId}" does not exist.` };
  }

  const tokenIds = new Set<string>();
  for (const token of collection.tokens) {
    if (!token.id || !token.name.trim()) {
      return { ok: false, error: 'Every design token must have a stable ID and non-empty name.' };
    }
    if (tokenIds.has(token.id)) {
      return { ok: false, error: `Duplicate design token ID "${token.id}".` };
    }
    tokenIds.add(token.id);
  }

  for (const token of collection.tokens) {
    for (const theme of collection.themes) {
      const resolved = resolveDesignTokenValue(collection, token.id, theme.id);
      if (!resolved.ok) {
        return { ok: false, error: resolved.message };
      }
    }
  }

  return { ok: true };
}

/**
 * Non-destructively resolves a node's explicit `tokenBindings` against the active theme.
 * Unbound literal values are never altered.
 */
export function resolveNodeWithTokens<T extends DesignNode>(
  node: T,
  collection?: DesignTokenCollection,
  themeId?: string,
): T {
  const bindings = node.tokenBindings;
  if (!collection || !bindings) return node;

  const activeTheme = themeId ?? collection.activeThemeId;
  let next: DesignNode = node;

  const resolveColor = (tokenId?: string): string | undefined => {
    if (!tokenId) return undefined;
    const res = resolveDesignTokenValue(collection, tokenId, activeTheme);
    if (res.ok && res.category === 'color' && typeof res.rawValue === 'string') {
      return res.rawValue;
    }
    return undefined;
  };

  const resolveNumber = (tokenId?: string, allowed: readonly DesignTokenCategory[] = ['spacing', 'radius', 'typography']): number | undefined => {
    if (!tokenId) return undefined;
    const res = resolveDesignTokenValue(collection, tokenId, activeTheme);
    if (res.ok && allowed.includes(res.category) && typeof res.numericValue === 'number') {
      return res.numericValue;
    }
    return undefined;
  };

  const fillColor = resolveColor(bindings.fill);
  const strokeColor = resolveColor(bindings.stroke);
  const radiusNum = resolveNumber(bindings.radius, ['radius']);
  const fontSizeNum = resolveNumber(bindings.fontSize, ['typography']);
  const gapNum = resolveNumber(bindings.gap, ['spacing']);
  const paddingNum = resolveNumber(bindings.padding, ['spacing']);

  if (next.type === 'rect' || next.type === 'ellipse' || next.type === 'frame') {
    if (fillColor !== undefined || strokeColor !== undefined || radiusNum !== undefined) {
      next = {
        ...next,
        style: {
          ...next.style,
          ...(fillColor !== undefined ? { fill: fillColor } : {}),
          ...(strokeColor !== undefined ? { stroke: strokeColor } : {}),
          ...(radiusNum !== undefined && next.type !== 'ellipse' ? { radius: Math.max(0, radiusNum) } : {}),
        },
      };
    }
  } else if (next.type === 'path') {
    if (fillColor !== undefined || strokeColor !== undefined) {
      next = {
        ...next,
        style: {
          ...next.style,
          ...(fillColor !== undefined ? { fill: fillColor } : {}),
          ...(strokeColor !== undefined ? { stroke: strokeColor } : {}),
        },
      };
    }
  } else if (next.type === 'text') {
    if (fillColor !== undefined || fontSizeNum !== undefined) {
      next = {
        ...next,
        style: {
          ...next.style,
          ...(fillColor !== undefined ? { fill: fillColor } : {}),
          ...(fontSizeNum !== undefined ? { fontSize: Math.max(1, fontSizeNum) } : {}),
        },
      };
    }
  }

  if (next.layout && (gapNum !== undefined || paddingNum !== undefined)) {
    const pad = paddingNum !== undefined ? Math.max(0, paddingNum) : undefined;
    next = {
      ...next,
      layout: {
        ...next.layout,
        ...(gapNum !== undefined ? { gap: Math.max(0, gapNum) } : {}),
        ...(pad !== undefined
          ? { padding: { top: pad, right: pad, bottom: pad, left: pad } }
          : {}),
      },
    };
  }

  return next as T;
}

export function findTokenUsages(project: FolioProject, tokenId: string): TokenUsageReference[] {
  const usages: TokenUsageReference[] = [];
  const collection = project.designTokens;

  if (collection) {
    for (const token of collection.tokens) {
      if (token.id === tokenId) continue;
      if (token.value.kind === 'alias' && token.value.tokenId === tokenId) {
        usages.push({
          scope: 'token-alias',
          ownerId: collection.activeThemeId,
          ownerName: 'Design Tokens',
          targetId: token.id,
          targetName: token.name,
          property: 'value',
        });
      }
      if (token.themeValues) {
        for (const [themeId, themeVal] of Object.entries(token.themeValues)) {
          if (themeVal.kind === 'alias' && themeVal.tokenId === tokenId) {
            usages.push({
              scope: 'token-alias',
              ownerId: themeId,
              ownerName: themeId,
              targetId: token.id,
              targetName: token.name,
              property: `theme:${themeId}`,
            });
          }
        }
      }
    }
  }

  const scanNodes = (scope: 'page' | 'component', ownerId: string, ownerName: string, nodes: readonly DesignNode[]) => {
    for (const node of nodes) {
      if (!node.tokenBindings) continue;
      for (const [prop, boundId] of Object.entries(node.tokenBindings)) {
        if (boundId === tokenId) {
          usages.push({
            scope,
            ownerId,
            ownerName,
            targetId: node.id,
            targetName: node.name,
            property: prop,
          });
        }
      }
    }
  };

  for (const page of project.pages) {
    scanNodes('page', page.id, page.name, page.document.nodes);
  }
  for (const component of project.components) {
    scanNodes('component', component.id, component.name, component.document.nodes);
  }

  return usages;
}

/**
 * Generates clean CSS custom properties for the active (or specified) theme
 * suitable for Developer/Code workspace interop.
 */
export function generateDesignTokensCss(
  collection: DesignTokenCollection,
  themeId: string = collection.activeThemeId,
): string {
  const theme = collection.themes.find((item) => item.id === themeId);
  const selector = theme && theme.id !== collection.themes[0]?.id
    ? `:root[data-theme="${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"]`
    : ':root';
  const lines: string[] = [`${selector} {`];
  for (const token of collection.tokens) {
    const resolved = resolveDesignTokenValue(collection, token.id, themeId);
    if (resolved.ok) {
      lines.push(`  ${toCssVariableName(token.name)}: ${resolved.cssValue};`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}
