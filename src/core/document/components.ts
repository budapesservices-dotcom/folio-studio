import type {
  ComponentDefinition,
  ComponentInstanceNode,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  ComponentVariantOverride,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  PathNode,
} from './types';
import { createEmptyDocument } from './factory';
import { expandSelectedLayerIds } from './layers';
import { resolveNodeWithTokens } from './tokens';
import { scalePathNodeGeometry } from './vector';

function createNodeId(instanceId: string, childId: string): string {
  return `${instanceId}__${childId}`;
}

export function getEffectiveVariantSelection(
  instance: ComponentInstanceNode,
  component: ComponentDefinition,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const axis of component.variants ?? []) {
    const chosen = instance.variantSelection?.[axis.id];
    const valid = chosen && axis.options.some((opt) => opt.id === chosen);
    result[axis.id] = valid ? chosen : axis.defaultOptionId;
  }
  return result;
}

export function createComponentSlot(
  name: string,
  targetNodeId: string,
  options: { id?: string; description?: string; defaultText?: string } = {},
): ComponentSlotDefinition {
  const id = options.id ?? `slot-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  return {
    id,
    name: name.trim() || 'Slot',
    targetNodeId,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    ...(options.defaultText !== undefined ? { defaultText: options.defaultText } : {}),
  };
}

export function createComponentVariantAxis(
  name: string,
  options?: {
    id?: string;
    optionLabels?: readonly string[];
  },
): ComponentVariantAxis {
  const axisId = options?.id ?? `axis-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  const labels = options?.optionLabels && options.optionLabels.length > 0
    ? options.optionLabels
    : ['Default', 'Secondary'];
  const builtOptions = labels.map((label, index) => ({
    id: `${axisId}-opt-${index + 1}`,
    label: label.trim() || `Option ${index + 1}`,
    overrides: {},
  }));
  return {
    id: axisId,
    name: name.trim() || 'Variant',
    defaultOptionId: builtOptions[0].id,
    options: builtOptions,
  };
}

export function createComponentInstance(
  component: ComponentDefinition,
  x: number,
  y: number,
  id: string = globalThis.crypto?.randomUUID?.() ?? `instance-${Date.now()}`,
): ComponentInstanceNode {
  const defaultVariantSelection: Record<string, string> = {};
  for (const axis of component.variants ?? []) {
    defaultVariantSelection[axis.id] = axis.defaultOptionId;
  }
  return {
    id,
    type: 'component-instance',
    componentId: component.id,
    name: component.name,
    x,
    y,
    width: Math.max(1, component.document.width),
    height: Math.max(1, component.document.height),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
    overrides: {},
    ...(Object.keys(defaultVariantSelection).length > 0 ? { variantSelection: defaultVariantSelection } : {}),
  };
}

export const OVERRIDE_FIELD_ALLOWED_NODE_TYPES: Record<
  'text' | 'fill' | 'stroke' | 'visible',
  ReadonlySet<DesignNode['type']>
> = {
  text: new Set(['text']),
  fill: new Set(['frame', 'rect', 'ellipse', 'path', 'text']),
  stroke: new Set(['frame', 'rect', 'ellipse', 'path', 'image']),
  visible: new Set(['frame', 'rect', 'ellipse', 'path', 'text', 'group', 'image', 'component-instance']),
};

export function isOverrideFieldCompatibleWithNodeType(
  nodeType: DesignNode['type'],
  field: 'text' | 'fill' | 'stroke' | 'visible',
): boolean {
  return OVERRIDE_FIELD_ALLOWED_NODE_TYPES[field].has(nodeType);
}

function applyNodeOverrideFields(node: DesignNode, override: ComponentVariantOverride): DesignNode {
  let next: DesignNode = node;
  if (override.visible !== undefined) {
    next = { ...next, visible: override.visible };
  }
  if (next.type === 'text') {
    if (override.text !== undefined || override.fill !== undefined) {
      next = {
        ...next,
        ...(override.text !== undefined ? { text: override.text } : {}),
        style: {
          ...next.style,
          ...(override.fill !== undefined ? { fill: override.fill } : {}),
        },
      };
    }
    return next;
  }
  if (next.type === 'rect' || next.type === 'ellipse' || next.type === 'frame' || next.type === 'path') {
    if (override.fill !== undefined || override.stroke !== undefined) {
      next = {
        ...next,
        style: {
          ...next.style,
          ...(override.fill !== undefined ? { fill: override.fill } : {}),
          ...(override.stroke !== undefined ? { stroke: override.stroke } : {}),
        },
      };
    }
    return next;
  }
  return next;
}

export function applyComponentOverrides(
  node: DesignNode,
  overrides: ComponentInstanceNode['overrides'],
): DesignNode {
  const override = overrides[node.id];
  if (!override) return node;
  return applyNodeOverrideFields(node, override);
}

/**
 * Deterministically resolves a component instance's internal master nodes with canonical precedence:
 * Master -> Variants -> Slots -> Local Overrides -> Tokens.
 */
export function resolveComponentInstanceNodes(
  instance: ComponentInstanceNode,
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): DesignNode[] {
  if (instance.componentId !== component.id) return [];

  // 1. Collect active variant overrides keyed by master node ID
  const variantOverrideByNodeId = new Map<string, ComponentVariantOverride>();
  const effectiveSelection = getEffectiveVariantSelection(instance, component);
  for (const axis of component.variants ?? []) {
    const selectedOptionId = effectiveSelection[axis.id];
    const option = axis.options.find((opt) => opt.id === selectedOptionId) ?? axis.options[0];
    if (!option) continue;
    for (const [targetId, patch] of Object.entries(option.overrides)) {
      const existing = variantOverrideByNodeId.get(targetId) ?? {};
      variantOverrideByNodeId.set(targetId, { ...existing, ...patch });
    }
  }

  // 2. Collect slot assignments keyed by master node ID
  const slotOverrideByNodeId = new Map<string, ComponentVariantOverride>();
  for (const slot of component.slots ?? []) {
    const assignment = instance.slotAssignments?.[slot.id];
    if (assignment) {
      const existing = slotOverrideByNodeId.get(slot.targetNodeId) ?? {};
      slotOverrideByNodeId.set(slot.targetNodeId, {
        ...existing,
        ...(assignment.text !== undefined ? { text: assignment.text } : {}),
        ...(assignment.fill !== undefined ? { fill: assignment.fill } : {}),
        ...(assignment.visible !== undefined ? { visible: assignment.visible } : {}),
      });
    } else if (slot.defaultText !== undefined) {
      const variantPatch = variantOverrideByNodeId.get(slot.targetNodeId);
      const existing = slotOverrideByNodeId.get(slot.targetNodeId) ?? {};
      if (existing.text === undefined && variantPatch?.text === undefined) {
        slotOverrideByNodeId.set(slot.targetNodeId, { ...existing, text: slot.defaultText });
      }
    }
  }

  // 3. Apply in deterministic precedence order:
  //    Master -> Variants -> Slots -> Local Overrides -> Tokens
  return component.document.nodes.map((masterNode) => {
    let resolved: DesignNode = masterNode;
    const variantPatch = variantOverrideByNodeId.get(masterNode.id);
    if (variantPatch) {
      resolved = applyNodeOverrideFields(resolved, variantPatch);
    }
    const slotPatch = slotOverrideByNodeId.get(masterNode.id);
    if (slotPatch) {
      resolved = applyNodeOverrideFields(resolved, slotPatch);
    }
    resolved = applyComponentOverrides(resolved, instance.overrides);
    if (tokens) {
      resolved = resolveNodeWithTokens(resolved, tokens);
    }
    return resolved;
  });
}

/**
 * Resolves a Master Component's default preview using the exact same contract pipeline:
 * Master -> Default Variants -> Default Slots -> Tokens.
 */
export function resolveComponentDefaultNodes(
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): DesignNode[] {
  const virtualInstance = createComponentInstance(component, 0, 0, `__preview_${component.id}`);
  return resolveComponentInstanceNodes(virtualInstance, component, tokens);
}

export function getComponentOverrideTargets(component: ComponentDefinition): {
  textNode: Extract<DesignNode, { type: 'text' }> | undefined;
  fillNode: Extract<DesignNode, { type: 'rect' | 'ellipse' | 'frame' | 'path' | 'text' }> | undefined;
} {
  const nodes = component.document.nodes;
  return {
    textNode: nodes.find((node): node is Extract<DesignNode, { type: 'text' }> => node.type === 'text'),
    fillNode: nodes.find((node): node is Extract<DesignNode, { type: 'rect' | 'ellipse' | 'frame' | 'path' | 'text' }> =>
      node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame' || node.type === 'path' || node.type === 'text'),
  };
}

/** Converts a linked instance into ordinary page nodes, baking effective variants, slots, and overrides. */
export function detachComponentInstance(
  instance: ComponentInstanceNode,
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): DesignNode[] {
  const source = component.document;
  const scaleX = instance.width / Math.max(1, source.width);
  const scaleY = instance.height / Math.max(1, source.height);
  const centerX = instance.x + instance.width / 2;
  const centerY = instance.y + instance.height / 2;
  const radians = instance.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const resolvedNodes = resolveComponentInstanceNodes(instance, component, tokens);
  const resolvedById = new Map(resolvedNodes.map((node) => [node.id, node]));
  const detachedIds = new Map(source.nodes.map((node) => [node.id, createNodeId(instance.id, node.id)]));

  return source.nodes.map((sourceNode) => {
    const effective = resolvedById.get(sourceNode.id) ?? applyComponentOverrides(sourceNode, instance.overrides);
    const width = effective.width * scaleX;
    const height = effective.height * scaleY;
    const localCenterX = instance.x + effective.x * scaleX + width / 2;
    const localCenterY = instance.y + effective.y * scaleY + height / 2;
    const dx = localCenterX - centerX;
    const dy = localCenterY - centerY;
    const rotatedX = centerX + dx * cos - dy * sin;
    const rotatedY = centerY + dx * sin + dy * cos;
    const baseDetached = {
      ...effective,
      id: detachedIds.get(sourceNode.id)!,
      parentId: sourceNode.parentId ? (detachedIds.get(sourceNode.parentId) ?? instance.parentId) : instance.parentId,
      clipMaskBaseId: sourceNode.clipMaskBaseId ? detachedIds.get(sourceNode.clipMaskBaseId) : undefined,
      name: sourceNode.name,
      x: rotatedX - width / 2,
      y: rotatedY - height / 2,
      width,
      height,
      rotation: effective.rotation + instance.rotation,
      opacity: effective.opacity * instance.opacity,
      visible: effective.visible && instance.visible,
      locked: effective.locked || instance.locked,
      onCanvas: instance.onCanvas !== false && effective.onCanvas !== false,
    };
    if (effective.type === 'path') {
      const pathCandidate: PathNode = {
        ...effective,
        id: baseDetached.id,
        parentId: baseDetached.parentId,
        clipMaskBaseId: baseDetached.clipMaskBaseId,
        name: baseDetached.name,
        rotation: baseDetached.rotation,
        opacity: baseDetached.opacity,
        visible: baseDetached.visible,
        locked: baseDetached.locked,
        onCanvas: baseDetached.onCanvas,
      };
      return scalePathNodeGeometry(
        pathCandidate,
        baseDetached.x,
        baseDetached.y,
        width,
        height,
      );
    }
    return baseDetached as DesignNode;
  });
}

/**
 * Returns true if placing an instance of `childComponentId` inside `parentComponentId`
 * would introduce a circular dependency (direct self-nesting or transitive cycle).
 */
export function wouldCreateComponentCycle(
  components: readonly ComponentDefinition[],
  parentComponentId: string,
  childComponentId: string,
): boolean {
  if (parentComponentId === childComponentId) return true;
  const byId = new Map(components.map((c) => [c.id, c]));
  const visited = new Set<string>();
  const stack = [childComponentId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === parentComponentId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const comp = byId.get(currentId);
    if (!comp) continue;
    for (const node of comp.document.nodes) {
      if (node.type === 'component-instance') {
        stack.push(node.componentId);
      }
    }
  }
  return false;
}

/**
 * Builds a clean, self-contained ComponentDefinition from selected document
 * layers while preserving nested Group hierarchy, nested Component Instances
 * (DAG-safe: excluding self-references), and clipping-mask links.
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
  const candidateId = options.id ?? (globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`);
  const reusableNodes = sourceNodes.filter(
    (node) =>
      expandedIds.has(node.id) &&
      !(node.type === 'component-instance' && node.componentId === candidateId),
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
    id: candidateId,
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

export function replaceComponentInstancesInDocument(
  document: FolioDocument,
  component: ComponentDefinition,
  tokens?: DesignTokenCollection,
): FolioDocument {
  let changed = false;
  const nodes: DesignNode[] = [];
  for (const node of document.nodes) {
    if (node.type === 'component-instance' && node.componentId === component.id) {
      nodes.push(...detachComponentInstance(node, component, tokens));
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

/** Prunes variant overrides and slots on a ComponentDefinition whose master layers were deleted or changed type. */
export function pruneComponentContractForDocument(
  component: ComponentDefinition,
  nextDocument: FolioDocument,
): ComponentDefinition {
  const nodeById = new Map(nextDocument.nodes.map((node) => [node.id, node]));
  let changed = false;

  let nextSlots = component.slots;
  if (component.slots) {
    const cleanedSlots: ComponentSlotDefinition[] = [];
    for (const slot of component.slots) {
      const targetNode = nodeById.get(slot.targetNodeId);
      if (!targetNode) {
        changed = true;
        continue;
      }
      if (slot.defaultText !== undefined && targetNode.type !== 'text') {
        const { defaultText: _removed, ...rest } = slot;
        cleanedSlots.push(rest);
        changed = true;
      } else {
        cleanedSlots.push(slot);
      }
    }
    if (changed) nextSlots = cleanedSlots;
  }

  let nextVariants = component.variants;
  if (component.variants) {
    nextVariants = component.variants.map((axis) => {
      let axisChanged = false;
      const options = axis.options.map((option) => {
        const cleanedOverrides: Record<string, ComponentVariantOverride> = {};
        let optChanged = false;
        for (const [nodeId, patch] of Object.entries(option.overrides)) {
          const targetNode = nodeById.get(nodeId);
          if (!targetNode) {
            optChanged = true;
            continue;
          }
          const cleanedPatch: ComponentVariantOverride = {};
          let patchDroppedField = false;
          if (patch.visible !== undefined) cleanedPatch.visible = patch.visible;
          if (patch.text !== undefined) {
            if (isOverrideFieldCompatibleWithNodeType(targetNode.type, 'text')) cleanedPatch.text = patch.text;
            else patchDroppedField = true;
          }
          if (patch.fill !== undefined) {
            if (isOverrideFieldCompatibleWithNodeType(targetNode.type, 'fill')) cleanedPatch.fill = patch.fill;
            else patchDroppedField = true;
          }
          if (patch.stroke !== undefined) {
            if (isOverrideFieldCompatibleWithNodeType(targetNode.type, 'stroke')) cleanedPatch.stroke = patch.stroke;
            else patchDroppedField = true;
          }
          if (patchDroppedField) optChanged = true;
          if (Object.keys(cleanedPatch).length > 0) {
            cleanedOverrides[nodeId] = patchDroppedField ? cleanedPatch : patch;
          } else {
            optChanged = true;
          }
        }
        if (optChanged) {
          axisChanged = true;
          return { ...option, overrides: cleanedOverrides };
        }
        return option;
      });
      if (axisChanged) {
        changed = true;
        return { ...axis, options };
      }
      return axis;
    });
  }

  if (!changed) return component;
  return {
    ...component,
    ...(nextSlots !== undefined ? { slots: nextSlots } : {}),
    ...(nextVariants !== undefined ? { variants: nextVariants } : {}),
  };
}

/**
 * Atomically prunes orphan or type-incompatible `overrides`, `variantSelection`,
 * and `slotAssignments` from all instances of `component` inside a page document.
 */
export function pruneComponentInstanceContractsInDocument(
  document: FolioDocument,
  component: ComponentDefinition,
): FolioDocument {
  const masterNodeById = new Map(component.document.nodes.map((node) => [node.id, node]));
  const axisById = new Map((component.variants ?? []).map((axis) => [axis.id, axis]));
  const slotById = new Map((component.slots ?? []).map((slot) => [slot.id, slot]));

  let docChanged = false;
  const nodes = document.nodes.map((node) => {
    if (node.type !== 'component-instance' || node.componentId !== component.id) return node;

    let instanceChanged = false;

    // 1. Prune overrides pointing to missing or type-incompatible master nodes
    const nextOverrides: ComponentInstanceNode['overrides'] = {};
    for (const [childId, ov] of Object.entries(node.overrides)) {
      const target = masterNodeById.get(childId);
      if (!target) {
        instanceChanged = true;
        continue;
      }
      const nextOv: { fill?: string; text?: string } = {};
      let fieldPruned = false;
      if (ov.fill !== undefined) {
        if (isOverrideFieldCompatibleWithNodeType(target.type, 'fill')) nextOv.fill = ov.fill;
        else fieldPruned = true;
      }
      if (ov.text !== undefined) {
        if (isOverrideFieldCompatibleWithNodeType(target.type, 'text')) nextOv.text = ov.text;
        else fieldPruned = true;
      }
      if (fieldPruned) instanceChanged = true;
      if (nextOv.fill !== undefined || nextOv.text !== undefined) {
        nextOverrides[childId] = fieldPruned ? nextOv : ov;
      } else {
        instanceChanged = true;
      }
    }

    // 2. Prune variantSelection referencing deleted axes or deleted options
    let nextVariantSelection = node.variantSelection;
    if (node.variantSelection) {
      const cleanedSelection: Record<string, string> = {};
      let selChanged = false;
      for (const [axisId, optionId] of Object.entries(node.variantSelection)) {
        const axis = axisById.get(axisId);
        if (!axis) {
          selChanged = true;
          continue;
        }
        if (axis.options.some((opt) => opt.id === optionId)) {
          cleanedSelection[axisId] = optionId;
        } else {
          // Selected option was deleted -> fall back to axis defaultOptionId
          cleanedSelection[axisId] = axis.defaultOptionId;
          selChanged = true;
        }
      }
      if (selChanged) {
        instanceChanged = true;
        nextVariantSelection = Object.keys(cleanedSelection).length > 0 ? cleanedSelection : undefined;
      }
    }

    // 3. Prune slotAssignments referencing deleted slots or type-incompatible fields
    let nextSlotAssignments = node.slotAssignments;
    if (node.slotAssignments) {
      const cleanedSlots: NonNullable<ComponentInstanceNode['slotAssignments']> = {};
      let slotsChanged = false;
      for (const [slotId, assignment] of Object.entries(node.slotAssignments)) {
        const slot = slotById.get(slotId);
        const target = slot ? masterNodeById.get(slot.targetNodeId) : undefined;
        if (!slot || !target) {
          slotsChanged = true;
          continue;
        }
        const nextAssignment: { text?: string; fill?: string; visible?: boolean } = {};
        let fieldPruned = false;
        if (assignment.visible !== undefined) nextAssignment.visible = assignment.visible;
        if (assignment.text !== undefined) {
          if (isOverrideFieldCompatibleWithNodeType(target.type, 'text')) nextAssignment.text = assignment.text;
          else fieldPruned = true;
        }
        if (assignment.fill !== undefined) {
          if (isOverrideFieldCompatibleWithNodeType(target.type, 'fill')) nextAssignment.fill = assignment.fill;
          else fieldPruned = true;
        }
        if (fieldPruned) slotsChanged = true;
        if (
          nextAssignment.text !== undefined ||
          nextAssignment.fill !== undefined ||
          nextAssignment.visible !== undefined
        ) {
          cleanedSlots[slotId] = fieldPruned ? nextAssignment : assignment;
        } else {
          slotsChanged = true;
        }
      }
      if (slotsChanged) {
        instanceChanged = true;
        nextSlotAssignments = Object.keys(cleanedSlots).length > 0 ? cleanedSlots : undefined;
      }
    }

    if (!instanceChanged) return node;
    docChanged = true;
    const updated: ComponentInstanceNode = {
      ...node,
      overrides: nextOverrides,
    };
    if (nextVariantSelection) updated.variantSelection = nextVariantSelection;
    else delete updated.variantSelection;
    if (nextSlotAssignments) updated.slotAssignments = nextSlotAssignments;
    else delete updated.slotAssignments;
    return updated;
  });

  return docChanged ? { ...document, nodes } : document;
}
