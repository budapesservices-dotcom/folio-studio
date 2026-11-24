import type {
  ComponentInstanceOverrides,
  DesignNode,
  PathNode,
  PathStyle,
  ShapeStyle,
  VectorAnchorPoint,
  VectorShapeMeta,
  VectorSubpath,
} from './types';

export type NodeChangeKind = 'none' | 'transform' | 'extended';

export interface NodeChangeClassification {
  readonly kind: NodeChangeKind;
  readonly hasTransformChange: boolean;
  readonly hasExtendedChange: boolean;
  readonly hasAnyChange: boolean;
}

export interface NodeChangeClassificationOptions {
  /**
   * Optional numeric tolerance for affine transform deltas (`x`, `y`, `width`,
   * `height`, `rotation`). Geometry Engine uses `0.005` to suppress sub-pixel
   * pointer jitter, while Native Command translation and reducer paths use `0`
   * (exact comparison) so every accepted change reaches canonical state.
   */
  readonly transformTolerance?: number;
}

const NO_CHANGE: NodeChangeClassification = Object.freeze({
  kind: 'none',
  hasTransformChange: false,
  hasExtendedChange: false,
  hasAnyChange: false,
});

function numberChanged(before: number, after: number, tolerance: number): boolean {
  if (tolerance > 0) {
    return Math.abs(before - after) > tolerance;
  }
  return before !== after;
}

function shapeStyleChanged(before: ShapeStyle, after: ShapeStyle): boolean {
  return (
    before.fill !== after.fill ||
    before.stroke !== after.stroke ||
    before.strokeWidth !== after.strokeWidth ||
    before.radius !== after.radius ||
    (before.fills !== after.fills &&
      JSON.stringify(before.fills ?? []) !== JSON.stringify(after.fills ?? []))
  );
}

function pathStyleChanged(before: PathStyle, after: PathStyle): boolean {
  return (
    before.fill !== after.fill ||
    before.stroke !== after.stroke ||
    before.strokeWidth !== after.strokeWidth ||
    before.strokeLinecap !== after.strokeLinecap ||
    before.strokeLinejoin !== after.strokeLinejoin ||
    before.strokeDasharray !== after.strokeDasharray ||
    before.fillRule !== after.fillRule ||
    before.arrowStart !== after.arrowStart ||
    before.arrowEnd !== after.arrowEnd ||
    (before.fills !== after.fills &&
      JSON.stringify(before.fills ?? []) !== JSON.stringify(after.fills ?? []))
  );
}

function shapeMetaChanged(
  before: VectorShapeMeta | undefined,
  after: VectorShapeMeta | undefined,
): boolean {
  if (before === after) return false;
  if (!before || !after) return true;
  if (before.kind !== after.kind) return true;
  if (before.kind === 'polygon' && after.kind === 'polygon') {
    return before.sides !== after.sides;
  }
  if (before.kind === 'star' && after.kind === 'star') {
    return before.spikes !== after.spikes || before.innerRatio !== after.innerRatio;
  }
  return true;
}

function vectorPointsChanged(
  before: readonly VectorAnchorPoint[],
  after: readonly VectorAnchorPoint[],
): boolean {
  if (before === after) return false;
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (
      a.id !== b.id ||
      a.x !== b.x ||
      a.y !== b.y ||
      a.pointType !== b.pointType ||
      Boolean(a.handleIn) !== Boolean(b.handleIn) ||
      Boolean(a.handleOut) !== Boolean(b.handleOut) ||
      a.handleIn?.x !== b.handleIn?.x ||
      a.handleIn?.y !== b.handleIn?.y ||
      a.handleOut?.x !== b.handleOut?.x ||
      a.handleOut?.y !== b.handleOut?.y
    ) {
      return true;
    }
  }
  return false;
}

function pathSubpathsChanged(
  before: readonly VectorSubpath[] | undefined,
  after: readonly VectorSubpath[] | undefined,
): boolean {
  if (before === after) return false;
  const beforeList = before ?? [];
  const afterList = after ?? [];
  if (beforeList.length !== afterList.length) return true;
  for (let i = 0; i < beforeList.length; i += 1) {
    if (
      beforeList[i].closed !== afterList[i].closed ||
      vectorPointsChanged(beforeList[i].points, afterList[i].points)
    ) {
      return true;
    }
  }
  return false;
}

function componentOverridesChanged(
  before: ComponentInstanceOverrides,
  after: ComponentInstanceOverrides,
): boolean {
  if (before === after) return false;
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if (beforeKeys.length !== afterKeys.length) return true;
  for (const key of beforeKeys) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) return true;
    const prev = before[key];
    const next = after[key];
    if (prev.fill !== next.fill || prev.text !== next.text) {
      return true;
    }
  }
  return false;
}

function hasTypeSpecificExtendedChange(before: DesignNode, after: DesignNode): boolean {
  if (before.type !== after.type) return true;

  switch (after.type) {
    case 'group':
      return false;

    case 'frame': {
      if (before.type !== 'frame') return true;
      return (
        before.clipContent !== after.clipContent ||
        before.isSection !== after.isSection ||
        shapeStyleChanged(before.style, after.style)
      );
    }

    case 'rect': {
      if (before.type !== 'rect') return true;
      return shapeStyleChanged(before.style, after.style);
    }

    case 'ellipse': {
      if (before.type !== 'ellipse') return true;
      return shapeStyleChanged(before.style, after.style);
    }

    case 'text': {
      if (before.type !== 'text') return true;
      return (
        before.text !== after.text ||
        before.style.fill !== after.style.fill ||
        before.style.fontSize !== after.style.fontSize ||
        before.style.fontFamily !== after.style.fontFamily ||
        before.style.fontWeight !== after.style.fontWeight ||
        before.style.letterSpacing !== after.style.letterSpacing ||
        before.style.lineHeight !== after.style.lineHeight ||
        before.style.textAlign !== after.style.textAlign ||
        before.style.textWrap !== after.style.textWrap ||
        before.style.textTransform !== after.style.textTransform ||
        before.style.textDecoration !== after.style.textDecoration
      );
    }

    case 'image': {
      if (before.type !== 'image') return true;
      return (
        before.assetId !== after.assetId ||
        before.alt !== after.alt ||
        before.naturalWidth !== after.naturalWidth ||
        before.naturalHeight !== after.naturalHeight ||
        before.style.fit !== after.style.fit ||
        before.style.radius !== after.style.radius ||
        before.style.stroke !== after.style.stroke ||
        before.style.strokeWidth !== after.style.strokeWidth
      );
    }

    case 'path': {
      if (before.type !== 'path') return true;
      const beforePath: PathNode = before;
      return (
        beforePath.closed !== after.closed ||
        beforePath.pathKind !== after.pathKind ||
        pathStyleChanged(beforePath.style, after.style) ||
        shapeMetaChanged(beforePath.shapeMeta, after.shapeMeta) ||
        vectorPointsChanged(beforePath.points, after.points) ||
        pathSubpathsChanged(beforePath.subpaths, after.subpaths)
      );
    }

    case 'component-instance': {
      if (before.type !== 'component-instance') return true;
      return (
        before.componentId !== after.componentId ||
        componentOverridesChanged(before.overrides, after.overrides) ||
        JSON.stringify(before.variantSelection ?? null) !== JSON.stringify(after.variantSelection ?? null) ||
        JSON.stringify(before.slotAssignments ?? null) !== JSON.stringify(after.slotAssignments ?? null)
      );
    }

    default: {
      const exhaustive: never = after;
      return Boolean(exhaustive);
    }
  }
}

/**
 * Unified single-source-of-truth classifier shared by Geometry Engine,
 * Native Command Client, Tool Operation Executor, and Editor Reducer.
 *
 * Guarantees that every valid change to affine transform, structure
 * (`parentId`, `clipMaskBaseId`, `onCanvas`), identity/metadata (`name`,
 * `opacity`, `visible`, `locked`, `layerColor`), web semantics, Auto-Layout,
 * responsive overrides, token bindings, `text`, `frame`, `rect`, `ellipse`,
 * `path`, or `component-instance` is classified identically and never
 * silently dropped during Native Command translation.
 */
export function classifyNodeChange(
  before: DesignNode | null | undefined,
  after: DesignNode,
  options: NodeChangeClassificationOptions = {},
): NodeChangeClassification {
  if (!before) return NO_CHANGE;

  const tolerance = options.transformTolerance ?? 0;

  const widthChanged = numberChanged(before.width, after.width, tolerance);
  const heightChanged = numberChanged(before.height, after.height, tolerance);
  const affineChanged =
    numberChanged(before.x, after.x, tolerance) ||
    numberChanged(before.y, after.y, tolerance) ||
    widthChanged ||
    heightChanged ||
    numberChanged(before.rotation || 0, after.rotation || 0, tolerance);

  const onCanvasChanged = before.onCanvas !== after.onCanvas;
  const onCanvasRepresentableInTransform = onCanvasChanged && typeof after.onCanvas === 'boolean';

  // `node.transform` requires positive width/height when changed and boolean `onCanvas`.
  // Zero-dimension transitions (e.g. flattening a path to a line) or unsetting `onCanvas`
  // must route through full-node replacement (`node.replace` / `node.update-many`).
  const zeroDimensionTransition =
    (widthChanged && after.width === 0) ||
    (heightChanged && after.height === 0);
  const unsetsOnCanvas = onCanvasChanged && after.onCanvas === undefined;

  const hasCommonExtendedChange =
    before.id !== after.id ||
    before.type !== after.type ||
    before.name !== after.name ||
    before.opacity !== after.opacity ||
    (before.blendMode ?? undefined) !== (after.blendMode ?? undefined) ||
    (before.effects !== after.effects &&
      JSON.stringify(before.effects ?? []) !== JSON.stringify(after.effects ?? [])) ||
    before.visible !== after.visible ||
    before.locked !== after.locked ||
    (before.layerColor ?? undefined) !== (after.layerColor ?? undefined) ||
    (before.parentId ?? null) !== (after.parentId ?? null) ||
    (before.clipMaskBaseId ?? undefined) !== (after.clipMaskBaseId ?? undefined) ||
    (before.semanticTag ?? undefined) !== (after.semanticTag ?? undefined) ||
    (before.ariaLabel ?? undefined) !== (after.ariaLabel ?? undefined) ||
    (before.href ?? undefined) !== (after.href ?? undefined) ||
    JSON.stringify(before.layout ?? null) !== JSON.stringify(after.layout ?? null) ||
    JSON.stringify(before.layoutChild ?? null) !== JSON.stringify(after.layoutChild ?? null) ||
    JSON.stringify(before.responsive ?? null) !== JSON.stringify(after.responsive ?? null) ||
    JSON.stringify(before.tokenBindings ?? null) !== JSON.stringify(after.tokenBindings ?? null) ||
    zeroDimensionTransition ||
    unsetsOnCanvas;

  const hasExtendedChange = hasCommonExtendedChange || hasTypeSpecificExtendedChange(before, after);
  const hasTransformChange = affineChanged || onCanvasRepresentableInTransform;
  const hasAnyChange = hasTransformChange || hasExtendedChange;
  const kind: NodeChangeKind = hasExtendedChange ? 'extended' : hasTransformChange ? 'transform' : 'none';

  return {
    kind,
    hasTransformChange,
    hasExtendedChange,
    hasAnyChange,
  };
}

/**
 * Classifies a paired list of before/after nodes using the unified classifier.
 */
export function classifyNodeListChange(
  beforeList: readonly (DesignNode | null | undefined)[],
  afterList: readonly DesignNode[],
  options: NodeChangeClassificationOptions = {},
): NodeChangeClassification {
  if (beforeList.length !== afterList.length) {
    return {
      kind: 'extended',
      hasTransformChange: false,
      hasExtendedChange: true,
      hasAnyChange: true,
    };
  }

  let hasTransformChange = false;
  let hasExtendedChange = false;

  for (let i = 0; i < beforeList.length; i += 1) {
    const result = classifyNodeChange(beforeList[i], afterList[i], options);
    if (result.hasTransformChange) hasTransformChange = true;
    if (result.hasExtendedChange) hasExtendedChange = true;
  }

  const hasAnyChange = hasTransformChange || hasExtendedChange;
  const kind: NodeChangeKind = hasExtendedChange ? 'extended' : hasTransformChange ? 'transform' : 'none';

  return {
    kind,
    hasTransformChange,
    hasExtendedChange,
    hasAnyChange,
  };
}

/**
 * Convenience predicate returning true when updating `before` -> `after`
 * carries changes beyond plain `node.transform` fields and therefore must
 * route through `node.replace` or `node.update-many`.
 */
export function hasExtendedNodeChange(
  before: DesignNode | null | undefined,
  after: DesignNode,
): boolean {
  return classifyNodeChange(before, after).hasExtendedChange;
}
