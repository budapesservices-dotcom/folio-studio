import {
  buildFrameClipAncestorMap,
  buildLayerClipMaskMap,
  getEffectiveLayerStates,
  getLayerDescendantIds,
} from '../core/document/layers';
import { getBackdropBlurRadius } from '../core/document/styling';
import { getActiveDocument } from '../core/document/project';
import type {
  AssetReference,
  ComponentDefinition,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  FolioProject,
  ImageNode,
} from '../core/document/types';
import {
  MAX_BINARY_ASSET_BYTES,
  createImageNodeFromAsset,
  ingestImageBytes,
  sanitizeSvgMarkup,
} from '../core/persistence/assetStore';
import { computeAutoLayoutNodes } from '../engines/layout/autoLayout';
import type { EditorTarget } from './editorContext';
import type { MainCanvasCommandClient } from './mainCanvasCommandClient';
import { serializeDocumentToSvgString } from './visualExport';

export interface SvgCropViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CollectedSvgRenderSelection {
  readonly selectedRootNodes: readonly DesignNode[];
  readonly sourceNodeIdsToRemove: readonly string[];
  readonly renderNodeIds: ReadonlySet<string>;
  readonly dependencyNodeIds: ReadonlySet<string>;
  readonly tempDocumentNodeIds: ReadonlySet<string>;
  readonly commonParentId?: string;
}

export interface RenderedSelectionSvgResult {
  readonly svgMarkup: string;
  readonly bytes: Uint8Array;
  readonly bounds: SvgCropViewBox;
  readonly sourceNodeIdsToRemove: readonly string[];
  readonly commonParentId?: string;
  readonly suggestedName: string;
  readonly warnings: readonly string[];
}

export interface RenderedSelectionSvgAssetResult {
  readonly asset: AssetReference;
  readonly imageNode: ImageNode;
  readonly sourceNodeIdsToRemove: readonly string[];
  readonly bounds: SvgCropViewBox;
  readonly svgMarkup: string;
  readonly deduplicated: boolean;
  readonly portabilityWarning?: string;
  readonly warnings: readonly string[];
}

interface BoundsRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function emptyBounds(): BoundsRect {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function isBoundsFinite(bounds: BoundsRect): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}

function mergeBounds(target: BoundsRect, box: BoundsRect): void {
  if (!isBoundsFinite(box)) return;
  if (box.minX < target.minX) target.minX = box.minX;
  if (box.minY < target.minY) target.minY = box.minY;
  if (box.maxX > target.maxX) target.maxX = box.maxX;
  if (box.maxY > target.maxY) target.maxY = box.maxY;
}

function intersectBounds(a: BoundsRect, b: BoundsRect): BoundsRect {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (maxX <= minX || maxY <= minY) return a;
  return { minX, minY, maxX, maxY };
}

function rotatedRectBounds(x: number, y: number, width: number, height: number, rotationDeg: number): BoundsRect {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (!rotationDeg) {
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: readonly [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const out = emptyBounds();
  for (const [px, py] of corners) {
    const dx = px - cx;
    const dy = py - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    if (rx < out.minX) out.minX = rx;
    if (ry < out.minY) out.minY = ry;
    if (rx > out.maxX) out.maxX = rx;
    if (ry > out.maxY) out.maxY = ry;
  }
  return out;
}

function computeStrokeBleed(node: DesignNode): number {
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame') {
    const sw = node.style.strokeWidth ?? 0;
    const stroke = node.style.stroke;
    if (sw <= 0 || !stroke || stroke === 'none' || stroke === 'transparent' || stroke === '#00000000') {
      return 0;
    }
    const align = node.style.strokeAlign ?? 'center';
    if (align === 'inside') return 0;
    if (align === 'outside') return sw;
    return sw / 2;
  }
  if (node.type === 'path') {
    const sw = node.style.strokeWidth ?? 0;
    const stroke = node.style.stroke;
    let bleed = sw > 0 && stroke && stroke !== 'none' && stroke !== 'transparent' && stroke !== '#00000000'
      ? sw / 2
      : 0;
    if (!node.closed && (node.style.arrowStart || node.style.arrowEnd)) {
      const arrowSize = Math.max(10, Math.min(28, (sw || 2) * 3.8));
      bleed = Math.max(bleed, arrowSize * 0.65);
    }
    return bleed;
  }
  if (node.type === 'image') {
    const sw = node.style.strokeWidth ?? 0;
    const stroke = node.style.stroke;
    return sw > 0 && stroke && stroke !== 'none' && stroke !== 'transparent' && stroke !== '#00000000'
      ? sw / 2
      : 0;
  }
  return 0;
}

function computeEffectExpansion(node: DesignNode): { left: number; top: number; right: number; bottom: number } {
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue;
    if (effect.type === 'drop-shadow') {
      const blurPad = Math.max(0, effect.blur) * 2 + Math.max(0, effect.spread ?? 0);
      left = Math.max(left, Math.max(0, -effect.x) + blurPad);
      right = Math.max(right, Math.max(0, effect.x) + blurPad);
      top = Math.max(top, Math.max(0, -effect.y) + blurPad);
      bottom = Math.max(bottom, Math.max(0, effect.y) + blurPad);
    } else if (effect.type === 'layer-blur') {
      const pad = Math.max(0, effect.radius) * 2;
      left = Math.max(left, pad);
      right = Math.max(right, pad);
      top = Math.max(top, pad);
      bottom = Math.max(bottom, pad);
    }
  }
  return { left, top, right, bottom };
}

function computeSingleNodeVisualBounds(node: DesignNode): BoundsRect {
  const base = rotatedRectBounds(node.x, node.y, node.width, node.height, node.rotation || 0);
  const strokeBleed = computeStrokeBleed(node);
  // SVG text uses dominant-baseline="hanging", whose cap-height ascenders extend
  // slightly above node.y in browsers; pad vertically so glyphs never clip at viewBox edges
  // while preserving exact document coordinates inside the cropped viewBox.
  const textTopBleed = node.type === 'text' ? Math.ceil(Math.max(2, node.style.fontSize * 0.25)) : 0;
  const textBottomBleed = node.type === 'text' ? Math.ceil(Math.max(2, node.style.fontSize * 0.15)) : 0;
  return {
    minX: base.minX - strokeBleed,
    minY: base.minY - strokeBleed - textTopBleed,
    maxX: base.maxX + strokeBleed,
    maxY: base.maxY + strokeBleed + textBottomBleed,
  };
}

function computeMaskBaseBounds(
  base: DesignNode,
  nodes: readonly DesignNode[],
  nodeById: ReadonlyMap<string, DesignNode>,
  states: ReadonlyMap<string, { visible: boolean }>,
): BoundsRect | null {
  if (base.type === 'group') {
    const descendants = [...getLayerDescendantIds(nodes, base.id)]
      .map((id) => nodeById.get(id))
      .filter((item): item is DesignNode => item !== undefined && item.type !== 'group' && Boolean(states.get(item.id)?.visible));
    if (descendants.length === 0) {
      return rotatedRectBounds(base.x, base.y, base.width, base.height, base.rotation || 0);
    }
    const merged = emptyBounds();
    for (const child of descendants) {
      mergeBounds(merged, computeSingleNodeVisualBounds(child));
    }
    return isBoundsFinite(merged) ? merged : null;
  }
  return computeSingleNodeVisualBounds(base);
}

/**
 * Resolves the top-level selected roots, descendant layers to remove atomically,
 * visible layers to draw, and any unselected renderer dependencies (clip mask bases,
 * mask base descendants, and ancestor frame/group containers).
 */
export function collectSelectionForSvgRender(
  nodes: readonly DesignNode[],
  selectedIds: readonly string[],
): CollectedSvgRenderSelection {
  const selectedSet = new Set(selectedIds);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const states = getEffectiveLayerStates(nodes);

  const hasSelectedAncestor = (node: DesignNode): boolean => {
    let cursor = node.parentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      if (selectedSet.has(cursor)) return true;
      cursor = nodeById.get(cursor)?.parentId;
    }
    return false;
  };

  const selectedRootNodes = nodes.filter((node) => {
    if (!selectedSet.has(node.id)) return false;
    if (hasSelectedAncestor(node)) return false;
    const effective = states.get(node.id);
    if (!effective || effective.locked || !effective.visible) return false;
    return node.onCanvas !== false;
  });

  const removeSet = new Set<string>();
  const renderNodeIds = new Set<string>();
  for (const root of selectedRootNodes) {
    removeSet.add(root.id);
    renderNodeIds.add(root.id);
    for (const descId of getLayerDescendantIds(nodes, root.id)) {
      removeSet.add(descId);
      renderNodeIds.add(descId);
    }
  }

  // Collect all renderer dependencies needed for masks & frame clips without adding them to removeSet.
  const tempDocumentNodeIds = new Set<string>(renderNodeIds);
  const dependencyNodeIds = new Set<string>();
  const queue: string[] = [...renderNodeIds];
  const processed = new Set<string>();

  const enqueueDependency = (id: string) => {
    if (!nodeById.has(id)) return;
    tempDocumentNodeIds.add(id);
    if (!renderNodeIds.has(id)) {
      dependencyNodeIds.add(id);
    }
    if (!processed.has(id)) {
      queue.push(id);
    }
  };

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    const node = nodeById.get(id);
    if (!node) continue;

    // Ancestors (groups and clipping frames) must exist in the temp document so
    // effective visibility, frame clipping, and inherited clipping masks match live rendering.
    if (node.parentId) {
      enqueueDependency(node.parentId);
    }

    // Clipping mask base + its descendants (if the base is a Group) must exist in the temp document.
    if (node.clipMaskBaseId) {
      enqueueDependency(node.clipMaskBaseId);
      const maskBase = nodeById.get(node.clipMaskBaseId);
      if (maskBase && maskBase.type === 'group') {
        for (const descId of getLayerDescendantIds(nodes, maskBase.id)) {
          enqueueDependency(descId);
        }
      }
    }
  }

  // Preserve original document order for removal list.
  const sourceNodeIdsToRemove = nodes.filter((node) => removeSet.has(node.id)).map((node) => node.id);

  // If all selected roots share the same unselected parent container, keep the rendered SVG inside it.
  let commonParentId: string | undefined;
  if (selectedRootNodes.length > 0) {
    const candidateParent = selectedRootNodes[0].parentId;
    if (
      candidateParent &&
      !removeSet.has(candidateParent) &&
      selectedRootNodes.every((root) => root.parentId === candidateParent)
    ) {
      commonParentId = candidateParent;
    }
  }

  return {
    selectedRootNodes,
    sourceNodeIdsToRemove,
    renderNodeIds,
    dependencyNodeIds,
    tempDocumentNodeIds,
    ...(commonParentId ? { commonParentId } : {}),
  };
}

/**
 * Computes the tight visual bounding box of the selected composition in document coordinates,
 * accounting for rotations, strokes, drop shadows, blurs, frame clipping, and inside clip masks.
 */
export function computeSvgCompositionBounds(
  resolvedNodes: readonly DesignNode[],
  renderNodeIds: ReadonlySet<string>,
): SvgCropViewBox | null {
  const canvasNodes = resolvedNodes.filter((node) => node.onCanvas !== false);
  const nodeById = new Map(canvasNodes.map((node) => [node.id, node]));
  const states = getEffectiveLayerStates(canvasNodes);
  const clipMaskMap = buildLayerClipMaskMap(canvasNodes, nodeById);
  const frameClipMap = buildFrameClipAncestorMap(canvasNodes, nodeById);

  const merged = emptyBounds();

  for (const node of canvasNodes) {
    if (node.type === 'group') continue;
    if (!renderNodeIds.has(node.id)) continue;
    const state = states.get(node.id);
    if (!state?.visible) continue;
    const maskIds = clipMaskMap.get(node.id) ?? [];
    if (!maskIds.every((baseId) => states.get(baseId)?.visible)) continue;

    let box = computeSingleNodeVisualBounds(node);
    const effects = computeEffectExpansion(node);
    box = {
      minX: box.minX - effects.left,
      minY: box.minY - effects.top,
      maxX: box.maxX + effects.right,
      maxY: box.maxY + effects.bottom,
    };

    // Clamp to ancestor clipping frames (when clipped) so cropped viewBox matches visible output.
    for (const frameId of frameClipMap.get(node.id) ?? []) {
      const frame = nodeById.get(frameId);
      if (frame && frame.type === 'frame') {
        const frameBox = rotatedRectBounds(frame.x, frame.y, frame.width, frame.height, frame.rotation || 0);
        box = intersectBounds(box, frameBox);
      }
    }

    // Clamp to inside clipping mask bases so masked artwork does not inflate the SVG with empty space.
    for (const baseId of maskIds) {
      if (node.clipMaskMode === 'outside' && baseId === node.clipMaskBaseId) continue;
      const base = nodeById.get(baseId);
      if (!base) continue;
      const maskBox = computeMaskBaseBounds(base, canvasNodes, nodeById, states);
      if (maskBox) {
        box = intersectBounds(box, maskBox);
      }
    }

    mergeBounds(merged, box);
  }

  if (!isBoundsFinite(merged)) return null;

  const x = Math.floor(merged.minX);
  const y = Math.floor(merged.minY);
  const width = Math.max(1, Math.ceil(merged.maxX) - x);
  const height = Math.max(1, Math.ceil(merged.maxY) - y);
  return { x, y, width, height };
}

function buildSuggestedSvgName(selectedRootNodes: readonly DesignNode[]): string {
  if (selectedRootNodes.length === 0) return 'Rendered SVG';
  const first = selectedRootNodes[0].name.trim();
  if (selectedRootNodes.length === 1 && first) return `${first} SVG`;
  return `Rendered SVG (${selectedRootNodes.length})`;
}

/**
 * Serializes the selected layers (plus renderer dependencies) into a standalone, cropped,
 * transparent-background SVG document using FOLIO's existing `serializeDocumentToSvgString()`.
 */
export function buildRenderedSvgFromSelection(args: {
  doc: FolioDocument;
  selectedIds: readonly string[];
  components?: readonly ComponentDefinition[];
  assets?: readonly AssetReference[];
  designTokens?: DesignTokenCollection;
  name?: string;
}): RenderedSelectionSvgResult {
  const { doc, selectedIds, components = [], assets = [], designTokens, name } = args;

  // Resolve auto-layout against the full document FIRST so selected children inside
  // unselected flex/grid frames keep their exact laid-out positions.
  const laidOutDocNodes = computeAutoLayoutNodes(doc.nodes, {
    breakpoint: 'desktop',
    tokens: designTokens,
    canvasWidth: doc.width,
  });

  const collected = collectSelectionForSvgRender(laidOutDocNodes, selectedIds);
  if (collected.selectedRootNodes.length < 2) {
    throw new Error('Select at least 2 visible, unlocked layers to render to SVG.');
  }

  // Build temporary document containing only selected layers + required mask/frame dependencies.
  // Strip `layout` on unselected ancestor frames so serializeDocumentToSvgString does not re-flow
  // the subset of children away from their live document coordinates.
  const tempNodes: DesignNode[] = laidOutDocNodes
    .filter((node) => collected.tempDocumentNodeIds.has(node.id))
    .map((node) => {
      if (node.type === 'frame' && !collected.renderNodeIds.has(node.id) && node.layout) {
        const { layout: _layout, ...withoutLayout } = node;
        return withoutLayout as DesignNode;
      }
      return node;
    });

  const bounds = computeSvgCompositionBounds(tempNodes, collected.renderNodeIds);
  if (!bounds) {
    throw new Error('The selected layers have no visible artwork to render to SVG.');
  }

  // Detect any effect that sanitized standalone SVG cannot preserve (backdrop-blur uses <foreignObject>).
  const warnings: string[] = [];
  const backdropBlurLayers: string[] = [];
  for (const node of tempNodes) {
    if (!collected.renderNodeIds.has(node.id)) continue;
    if (getBackdropBlurRadius(node) > 0) {
      backdropBlurLayers.push(node.name || node.id);
    }
  }
  if (backdropBlurLayers.length > 0) {
    warnings.push(
      `Backdrop blur on ${backdropBlurLayers.join(', ')} is not supported in sanitized standalone SVG and was omitted.`,
    );
  }

  const suggestedName = name?.trim() || buildSuggestedSvgName(collected.selectedRootNodes);
  const tempDoc: FolioDocument = {
    ...doc,
    id: `${doc.id}-svg-render`,
    name: suggestedName,
    background: 'transparent',
    nodes: tempNodes,
  };

  const rawSvg = serializeDocumentToSvgString(tempDoc, components, {
    title: suggestedName,
    designTokens,
    assets,
    viewBox: bounds,
    renderOnlyNodeIds: collected.renderNodeIds,
  });

  const rawBytes = new TextEncoder().encode(rawSvg);
  if (rawBytes.byteLength > MAX_BINARY_ASSET_BYTES) {
    throw new Error(
      `Rendered SVG exceeds the ${Math.round(MAX_BINARY_ASSET_BYTES / (1024 * 1024))} MB per-asset limit.`,
    );
  }

  const sanitizedSvg = sanitizeSvgMarkup(rawSvg);
  if (!sanitizedSvg || !/<svg\b/i.test(sanitizedSvg)) {
    throw new Error('Rendered SVG could not be validated.');
  }

  const bytes = new TextEncoder().encode(sanitizedSvg);
  if (bytes.byteLength > MAX_BINARY_ASSET_BYTES) {
    throw new Error(
      `Rendered SVG exceeds the ${Math.round(MAX_BINARY_ASSET_BYTES / (1024 * 1024))} MB per-asset limit.`,
    );
  }
  return {
    svgMarkup: sanitizedSvg,
    bytes,
    bounds,
    sourceNodeIdsToRemove: collected.sourceNodeIdsToRemove,
    ...(collected.commonParentId ? { commonParentId: collected.commonParentId } : {}),
    suggestedName,
    warnings,
  };
}

/**
 * End-to-end Render to SVG pipeline: renders selected layers to a cropped transparent SVG,
 * ingests the SVG bytes into FOLIO's deduplicated asset store (`image/svg+xml`), and creates
 * ONE exact-bounds `ImageNode` ready for atomic replacement via the Native Command Engine.
 */
export async function renderSelectionToSvgAssetAndNode(args: {
  doc: FolioDocument;
  selectedIds: readonly string[];
  components?: readonly ComponentDefinition[];
  assets?: readonly AssetReference[];
  designTokens?: DesignTokenCollection;
  name?: string;
  imageNodeId?: string;
}): Promise<RenderedSelectionSvgAssetResult> {
  const rendered = buildRenderedSvgFromSelection(args);
  const ingested = await ingestImageBytes(
    {
      name: `${rendered.suggestedName}.svg`,
      mimeType: 'image/svg+xml',
      bytes: rendered.bytes,
      width: rendered.bounds.width,
      height: rendered.bounds.height,
    },
    args.assets ?? [],
  );

  const imageNode = createImageNodeFromAsset(ingested.asset, {
    x: rendered.bounds.x,
    y: rendered.bounds.y,
    width: rendered.bounds.width,
    height: rendered.bounds.height,
    fit: 'contain',
    name: rendered.suggestedName,
    ...(rendered.commonParentId ? { parentId: rendered.commonParentId } : {}),
    ...(args.imageNodeId ? { id: args.imageNodeId } : {}),
    preserveExactGeometry: true,
  });

  return {
    asset: ingested.asset,
    imageNode,
    sourceNodeIdsToRemove: rendered.sourceNodeIdsToRemove,
    bounds: rendered.bounds,
    svgMarkup: rendered.svgMarkup,
    deduplicated: ingested.deduplicated,
    ...(ingested.portabilityWarning ? { portabilityWarning: ingested.portabilityWarning } : {}),
    warnings: rendered.warnings,
  };
}

export function mergeProjectAssets(
  primaryAssets: readonly AssetReference[],
  secondaryAssets: readonly AssetReference[] = [],
): AssetReference[] {
  const merged: AssetReference[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  for (const asset of [...primaryAssets, ...secondaryAssets]) {
    if (seenIds.has(asset.id)) continue;
    if (asset.sha256 && seenHashes.has(asset.sha256)) continue;
    seenIds.add(asset.id);
    if (asset.sha256) seenHashes.add(asset.sha256);
    merged.push(asset);
  }
  return merged;
}

export type ExecuteRenderSelectionToSvgOutcome =
  | {
      readonly ok: true;
      readonly asset: AssetReference;
      readonly imageNode: ImageNode;
      readonly sourceNodeIdsToRemove: readonly string[];
      readonly bounds: SvgCropViewBox;
      readonly svgMarkup: string;
      readonly deduplicated: boolean;
      readonly portabilityWarning?: string;
      readonly warnings: readonly string[];
      readonly notice: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

/**
 * Atomically executes Render to SVG through the Native Command Engine for either
 * Main Canvas or Component Canvas:
 * - Main Canvas: single atomic transaction (`asset.upsert` + `node.replace-many`).
 * - Component Canvas: atomically updates the Component Canvas buffer (`asset.upsert` +
 *   `node.replace-many`) AND registers the same `AssetReference` into the Main Project's
 *   `assets` via `mainCommandClient.upsertAsset()` (rolling back if main registration fails).
 */
export async function executeRenderSelectionToSvg(args: {
  target: EditorTarget;
  mainProject: FolioProject;
  componentProject?: FolioProject;
  selectedIds: readonly string[];
  mainCommandClient: MainCanvasCommandClient;
  componentCommandClient?: MainCanvasCommandClient;
  name?: string;
  imageNodeId?: string;
}): Promise<ExecuteRenderSelectionToSvgOutcome> {
  const {
    target,
    mainProject,
    componentProject,
    selectedIds,
    mainCommandClient,
    componentCommandClient,
    name,
    imageNodeId,
  } = args;

  const targetProject = target === 'component' ? componentProject : mainProject;
  const targetCommandClient = target === 'component' ? componentCommandClient : mainCommandClient;
  if (!targetProject || !targetCommandClient) {
    return { ok: false, error: 'Target workspace is unavailable for Render to SVG.' };
  }

  const targetDoc = getActiveDocument(targetProject);
  const availableAssets = mergeProjectAssets(mainProject.assets, componentProject?.assets ?? []);

  let rendered: RenderedSelectionSvgAssetResult;
  try {
    rendered = await renderSelectionToSvgAssetAndNode({
      doc: targetDoc,
      selectedIds,
      components: mainProject.components,
      assets: availableAssets,
      designTokens: mainProject.designTokens,
      name,
      imageNodeId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to render selection to SVG.',
    };
  }

  const description = `Render ${rendered.sourceNodeIdsToRemove.length} layers to SVG`;
  const txResult = targetCommandClient.replaceNodesWithAsset(
    rendered.asset,
    rendered.sourceNodeIdsToRemove,
    [rendered.imageNode],
    description,
    [rendered.imageNode.id],
  );

  if (txResult.status !== 'applied') {
    return {
      ok: false,
      error: txResult.message || 'Could not replace selected layers with rendered SVG.',
    };
  }

  if (target === 'component') {
    const mainAlreadyHasAsset = mainProject.assets.some(
      (item) => item.id === rendered.asset.id || (rendered.asset.sha256 && item.sha256 === rendered.asset.sha256),
    );
    if (!mainAlreadyHasAsset) {
      const mainAssetRes = mainCommandClient.upsertAsset(
        rendered.asset,
        `Register rendered SVG asset "${rendered.asset.name}"`,
      );
      if (mainAssetRes.status === 'rejected') {
        targetCommandClient.undo('Rollback Component Canvas Render to SVG');
        return {
          ok: false,
          error: mainAssetRes.message || 'Could not save rendered SVG asset into main project.',
        };
      }
    }
  }

  const suffixParts: string[] = [
    `${rendered.bounds.width}×${rendered.bounds.height}px SVG`,
  ];
  if (rendered.deduplicated) suffixParts.push('deduplicated asset');
  let notice = `Rendered selection to 1 SVG object (${suffixParts.join(', ')}).`;
  if (rendered.warnings.length > 0) {
    notice = `${notice} Notice: ${rendered.warnings.join(' ')}`;
  }
  if (rendered.portabilityWarning) {
    notice = `${notice} Warning: ${rendered.portabilityWarning}`;
  }

  return {
    ok: true,
    asset: rendered.asset,
    imageNode: rendered.imageNode,
    sourceNodeIdsToRemove: rendered.sourceNodeIdsToRemove,
    bounds: rendered.bounds,
    svgMarkup: rendered.svgMarkup,
    deduplicated: rendered.deduplicated,
    ...(rendered.portabilityWarning ? { portabilityWarning: rendered.portabilityWarning } : {}),
    warnings: rendered.warnings,
    notice,
  };
}
