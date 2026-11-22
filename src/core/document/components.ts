import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioDocument } from './types';
import { createEmptyDocument } from './factory';
import { expandSelectedLayerIds } from './layers';

function createNodeId(instanceId: string, childId: string): string {
  return `${instanceId}__${childId}`;
}

export function createComponentInstance(
  component: ComponentDefinition,
  x: number,
  y: number,
  id: string = globalThis.crypto?.randomUUID?.() ?? `instance-${Date.now()}`,
): ComponentInstanceNode {
  return {
    id, type: 'component-instance', componentId: component.id, name: component.name,
    x, y, width: Math.max(1, component.document.width), height: Math.max(1, component.document.height),
    rotation: 0, opacity: 1, visible: true, locked: false, onCanvas: true, overrides: {},
  };
}

export function applyComponentOverrides(
  node: DesignNode,
  overrides: ComponentInstanceNode['overrides'],
): DesignNode {
  const override = overrides[node.id];
  if (!override) return node;
  if (node.type === 'text') return {
    ...node,
    ...(override.text !== undefined ? { text: override.text } : {}),
    style: { ...node.style, ...(override.fill !== undefined ? { fill: override.fill } : {}) },
  };
  if (node.type === 'rect' || node.type === 'ellipse') return {
    ...node, style: { ...node.style, ...(override.fill !== undefined ? { fill: override.fill } : {}) },
  };
  return node;
}

export function resolveComponentInstanceNodes(
  instance: ComponentInstanceNode,
  component: ComponentDefinition,
): DesignNode[] {
  if (instance.componentId !== component.id) return [];
  return component.document.nodes.map((node) => applyComponentOverrides(node, instance.overrides));
}

export function getComponentOverrideTargets(component: ComponentDefinition): {
  textNode: Extract<DesignNode, { type: 'text' }> | undefined;
  fillNode: Extract<DesignNode, { type: 'rect' | 'ellipse' | 'text' }> | undefined;
} {
  const nodes = component.document.nodes;
  return {
    textNode: nodes.find((node): node is Extract<DesignNode, { type: 'text' }> => node.type === 'text'),
    fillNode: nodes.find((node): node is Extract<DesignNode, { type: 'rect' | 'ellipse' | 'text' }> =>
      node.type === 'rect' || node.type === 'ellipse' || node.type === 'text'),
  };
}

/** Converts a linked instance into ordinary page nodes, preserving effective geometry and overrides. */
export function detachComponentInstance(instance: ComponentInstanceNode, component: ComponentDefinition): DesignNode[] {
  const source = component.document;
  const scaleX = instance.width / Math.max(1, source.width);
  const scaleY = instance.height / Math.max(1, source.height);
  const centerX = instance.x + instance.width / 2;
  const centerY = instance.y + instance.height / 2;
  const radians = instance.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const detachedIds = new Map(source.nodes.map((node) => [node.id, createNodeId(instance.id, node.id)]));

  return source.nodes.map((sourceNode) => {
    const effective = applyComponentOverrides(sourceNode, instance.overrides);
    const width = sourceNode.width * scaleX;
    const height = sourceNode.height * scaleY;
    const localCenterX = instance.x + sourceNode.x * scaleX + width / 2;
    const localCenterY = instance.y + sourceNode.y * scaleY + height / 2;
    const dx = localCenterX - centerX;
    const dy = localCenterY - centerY;
    const rotatedX = centerX + dx * cos - dy * sin;
    const rotatedY = centerY + dx * sin + dy * cos;
    return {
      ...effective,
      id: detachedIds.get(sourceNode.id)!,
      parentId: sourceNode.parentId ? (detachedIds.get(sourceNode.parentId) ?? instance.parentId) : instance.parentId,
      clipMaskBaseId: sourceNode.clipMaskBaseId ? detachedIds.get(sourceNode.clipMaskBaseId) : undefined,
      name: sourceNode.name,
      x: rotatedX - width / 2,
      y: rotatedY - height / 2,
      width, height,
      rotation: sourceNode.rotation + instance.rotation,
      opacity: sourceNode.opacity * instance.opacity,
      visible: sourceNode.visible && instance.visible,
      locked: sourceNode.locked || instance.locked,
      onCanvas: instance.onCanvas !== false && sourceNode.onCanvas !== false,
    } as DesignNode;
  });
}

/**
 * Builds a clean, self-contained ComponentDefinition from selected document
 * layers while preserving nested Group hierarchy and clipping-mask links.
 * Any parentId or clipMaskBaseId pointing outside the saved subset is safely
 * stripped so the resulting master document always passes hierarchy validation.
 */
export function buildComponentDefinitionFromNodes(
  sourceNodes: readonly DesignNode[],
  selectedNodeIds: readonly string[],
  defaultName: string,
  options: { id?: string; now?: string } = {},
): ComponentDefinition | null {
  const expandedIds = new Set(expandSelectedLayerIds(sourceNodes, selectedNodeIds));
  const reusableNodes = sourceNodes.filter(
    (node) => expandedIds.has(node.id) && node.type !== 'component-instance',
  );
  if (reusableNodes.length === 0) return null;

  const includedIds = new Set(reusableNodes.map((node) => node.id));
  const topLevelNodes = reusableNodes.filter((node) => !node.parentId || !includedIds.has(node.parentId));
  const name = topLevelNodes.length === 1 ? topLevelNodes[0].name : defaultName;

  const minX = Math.min(...reusableNodes.map((node) => node.x));
  const minY = Math.min(...reusableNodes.map((node) => node.y));
  const maxX = Math.max(...reusableNodes.map((node) => node.x + node.width));
  const maxY = Math.max(...reusableNodes.map((node) => node.y + node.height));

  const now = options.now ?? new Date().toISOString();
  const normalizedNodes: DesignNode[] = reusableNodes.map((node) => {
    const nextParentId = node.parentId && includedIds.has(node.parentId) ? node.parentId : undefined;
    const nextClipMaskBaseId = node.clipMaskBaseId && includedIds.has(node.clipMaskBaseId) && node.clipMaskBaseId !== node.id
      ? node.clipMaskBaseId
      : undefined;
    const next: DesignNode = {
      ...node,
      x: node.x - minX,
      y: node.y - minY,
    };
    if (nextParentId) next.parentId = nextParentId;
    else delete next.parentId;
    if (nextClipMaskBaseId) next.clipMaskBaseId = nextClipMaskBaseId;
    else delete next.clipMaskBaseId;
    return next;
  });

  return {
    id: options.id ?? (globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`),
    name,
    document: {
      ...createEmptyDocument(name, Math.max(1, maxX - minX), Math.max(1, maxY - minY)),
      background: '#00000000',
      nodes: normalizedNodes,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function replaceComponentInstancesInDocument(document: FolioDocument, component: ComponentDefinition): FolioDocument {
  let changed = false;
  const nodes: DesignNode[] = [];
  for (const node of document.nodes) {
    if (node.type === 'component-instance' && node.componentId === component.id) {
      nodes.push(...detachComponentInstance(node, component));
      changed = true;
    } else nodes.push(node);
  }
  return changed ? { ...document, nodes } : document;
}


/** Prunes only override keys whose master nodes were removed; surviving keys remain. */
export function pruneComponentInstanceOverridesInDocument(
  document: FolioDocument,
  componentId: string,
  removedNodeIds: ReadonlySet<string>,
): FolioDocument {
  if (removedNodeIds.size === 0) return document;
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.type !== 'component-instance' || node.componentId !== componentId) return node;
    const overrides = { ...node.overrides };
    let instanceChanged = false;
    for (const removedId of removedNodeIds) {
      if (Object.prototype.hasOwnProperty.call(overrides, removedId)) {
        delete overrides[removedId];
        instanceChanged = true;
      }
    }
    if (!instanceChanged) return node;
    changed = true;
    return { ...node, overrides };
  });
  return changed ? { ...document, nodes } : document;
}
