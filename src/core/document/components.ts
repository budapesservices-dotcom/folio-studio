import type { ComponentDefinition, ComponentInstanceNode, DesignNode, FolioDocument } from './types';

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
    rotation: 0, opacity: 1, visible: true, locked: false, overrides: {},
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
      id: createNodeId(instance.id, sourceNode.id),
      name: sourceNode.name,
      x: rotatedX - width / 2,
      y: rotatedY - height / 2,
      width, height,
      rotation: sourceNode.rotation + instance.rotation,
      opacity: sourceNode.opacity * instance.opacity,
      visible: sourceNode.visible && instance.visible,
      locked: sourceNode.locked || instance.locked,
    } as DesignNode;
  });
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
