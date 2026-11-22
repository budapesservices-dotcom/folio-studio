import type { EditorAction } from './editorReducer';
import type { DesignNode, FolioDocument } from '../core/document/types';
import {
  validateLayerClippingMaskPayload,
  validateLayerGroupPayload,
  validateLayerMoveManyPayload,
  validateLayerMovePayload,
  validateLayerUngroupPayload,
  validateNodeCreatePayload,
  validateNodeDeletePayload,
  validateNodeRenamePayload,
  validateNodeReplacePayload,
  validateNodeSetCanvasStatePayload,
  validateNodeSetPropertiesPayload,
  validateNodeTransformPayload,
  validateProjectRenamePayload,
  type ValidationOutcome,
} from '../core/commands/validation';
import type {
  NativeCommand,
  NativeCommandPayload,
  NativePermission,
} from '../core/commands/types';

export interface NativeCommandAdapterContext {
  document?: FolioDocument;
  /** Resolved from the addressed document in payload order when applicable. */
  resolvedNodes: readonly DesignNode[];
}

interface NativeCommandDefinition {
  type: NativeCommand['type'];
  commandVersion: 1;
  allowedTargets: readonly ('project' | 'document' | 'node')[];
  requiredPermission: NativePermission;
  validatePayload(value: unknown): ValidationOutcome<NativeCommandPayload>;
  toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[];
}

/**
 * Static compatibility registry. It is deliberately closed: command callers
 * cannot register handlers or supply reducer actions.
 */
export const NATIVE_COMMAND_REGISTRY = Object.freeze({
  'project.rename': Object.freeze({
    type: 'project.rename' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'project.rename',
    validatePayload: validateProjectRenamePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'project.rename') return [];
      return [{ type: 'rename-project', name: command.payload.name }];
    },
  }),
  'node.create': Object.freeze({
    type: 'node.create' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.create',
    validatePayload: validateNodeCreatePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.create') return [];
      return [{ type: 'add-nodes', nodes: command.payload.nodes }];
    },
  }),
  'node.replace': Object.freeze({
    type: 'node.replace' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['node'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeReplacePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.replace') return [];
      return [{ type: 'replace-node', node: command.payload.node }];
    },
  }),
  'node.transform': Object.freeze({
    type: 'node.transform' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.transform',
    validatePayload: validateNodeTransformPayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'node.transform') return [];
      const nodes = context.resolvedNodes.map((node, index) => ({
        ...node,
        ...command.payload.nodes[index].transform,
      }));
      return [{ type: 'transform-nodes', nodes }];
    },
  }),
  'node.set-properties': Object.freeze({
    type: 'node.set-properties' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeSetPropertiesPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.set-properties') return [];
      const requested = command.payload.properties;
      const properties: Extract<EditorAction, { type: 'set-nodes-properties' }>['properties'] = {};
      if (requested.visible !== undefined) properties.visible = requested.visible;
      if (requested.locked !== undefined) properties.locked = requested.locked;
      if ('layerColor' in requested) properties.layerColor = requested.layerColor ?? undefined;
      return [{
        type: 'set-nodes-properties',
        nodeIds: command.payload.nodes.map((ref) => ref.nodeId),
        properties,
      }];
    },
  }),
  'node.rename': Object.freeze({
    type: 'node.rename' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeRenamePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.rename') return [];
      return [{
        type: 'rename-nodes',
        updates: command.payload.updates.map((entry) => ({ nodeId: entry.ref.nodeId, name: entry.name })),
      }];
    },
  }),
  'node.delete': Object.freeze({
    type: 'node.delete' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.delete',
    validatePayload: validateNodeDeletePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.delete') return [];
      return [{ type: 'delete-nodes', nodeIds: command.payload.nodes.map((ref) => ref.nodeId) }];
    },
  }),
  'node.set-canvas-state': Object.freeze({
    type: 'node.set-canvas-state' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeSetCanvasStatePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.set-canvas-state') return [];
      return [{
        type: 'set-nodes-canvas-state',
        nodeIds: command.payload.nodes.map((ref) => ref.nodeId),
        onCanvas: command.payload.onCanvas,
      }];
    },
  }),
  'layer.move': Object.freeze({
    type: 'layer.move' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.reorder',
    validatePayload: validateLayerMovePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'layer.move') return [];
      return [{
        type: 'move-layer',
        nodeId: command.payload.node.nodeId,
        targetId: command.payload.target.nodeId,
        position: command.payload.position,
      }];
    },
  }),
  'layer.move-many': Object.freeze({
    type: 'layer.move-many' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.reorder',
    validatePayload: validateLayerMoveManyPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'layer.move-many') return [];
      return [{
        type: 'move-layers',
        nodeIds: command.payload.nodes.map((ref) => ref.nodeId),
        targetId: command.payload.target.nodeId,
        position: command.payload.position,
      }];
    },
  }),
  'layer.group': Object.freeze({
    type: 'layer.group' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.reorder',
    validatePayload: validateLayerGroupPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'layer.group') return [];
      return [{ type: 'group-layers', nodeIds: command.payload.nodes.map((ref) => ref.nodeId) }];
    },
  }),
  'layer.ungroup': Object.freeze({
    type: 'layer.ungroup' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.reorder',
    validatePayload: validateLayerUngroupPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'layer.ungroup') return [];
      return [{ type: 'ungroup-layers', nodeIds: command.payload.nodes.map((ref) => ref.nodeId) }];
    },
  }),
  'layer.create-clipping-mask': Object.freeze({
    type: 'layer.create-clipping-mask' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.reorder',
    validatePayload: validateLayerClippingMaskPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'layer.create-clipping-mask') return [];
      return [{ type: 'mask-layer', nodeId: command.payload.node.nodeId }];
    },
  }),
  'layer.remove-clipping-mask': Object.freeze({
    type: 'layer.remove-clipping-mask' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.reorder',
    validatePayload: validateLayerClippingMaskPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'layer.remove-clipping-mask') return [];
      return [{ type: 'unmask-layer', nodeId: command.payload.node.nodeId }];
    },
  }),
} satisfies Record<NativeCommand['type'], NativeCommandDefinition>);
