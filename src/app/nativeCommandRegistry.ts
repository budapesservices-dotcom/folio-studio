import type { EditorAction } from './editorReducer';
import type { DesignNode, FolioDocument } from '../core/document/types';
import {
  validateNodeSetPropertiesPayload,
  validateNodeTransformPayload,
  type ValidationOutcome,
} from '../core/commands/validation';
import type {
  NativeCommand,
  NativePermission,
  NodeSetPropertiesPayload,
  NodeTransformPayload,
} from '../core/commands/types';

export interface NativeCommandAdapterContext {
  document: FolioDocument;
  /** Resolved from the addressed document in payload order. */
  resolvedNodes: readonly DesignNode[];
}

interface NativeCommandDefinition {
  type: NativeCommand['type'];
  commandVersion: 1;
  allowedTargets: readonly ('project' | 'document' | 'node')[];
  requiredPermission: NativePermission;
  validatePayload(value: unknown): ValidationOutcome<NodeTransformPayload | NodeSetPropertiesPayload>;
  toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[];
}

/**
 * Static compatibility registry. It is deliberately closed: command callers
 * cannot register handlers or supply reducer actions.
 */
export const NATIVE_COMMAND_REGISTRY = Object.freeze({
  'node.transform': Object.freeze({
    type: 'node.transform',
    commandVersion: 1,
    allowedTargets: ['document'],
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
    type: 'node.set-properties',
    commandVersion: 1,
    allowedTargets: ['document'],
    requiredPermission: 'node.update',
    validatePayload: validateNodeSetPropertiesPayload,
    toEditorActions(command: NativeCommand, _context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'node.set-properties') return [];
      const properties: NodeSetPropertiesPayload['properties'] = { ...command.payload.properties };
      if (properties.layerColor === null) properties.layerColor = undefined;
      return [{
        type: 'set-nodes-properties',
        nodeIds: command.payload.nodes.map((ref) => ref.nodeId),
        properties,
      }];
    },
  }),
} satisfies Record<NativeCommand['type'], NativeCommandDefinition>);
