import type { EditorAction } from './editorReducer';
import type { DesignNode, FolioDocument } from '../core/document/types';
import { computeInvertedSelectionIds, computeSimilarSelectionIds } from '../core/document/selectionQueries';
import {
  validateAnimationCreateClipPayload,
  validateAnimationDeleteClipPayload,
  validateAnimationUpdateClipPayload,
  validateAnimationUpdateCustomEasingsPayload,
  validateAssetUpsertPayload,
  validateCodeUpdateModulesPayload,
  validateComponentCreatePayload,
  validateComponentDeletePayload,
  validateComponentRenamePayload,
  validateComponentSyncDocumentPayload,
  validateComponentUpdateContractPayload,
  validateDocumentSetBackgroundPayload,
  validateDocumentSetSizePayload,
  validateEmptyCommandPayload,
  validateLayerClippingMaskPayload,
  validateLayerGroupPayload,
  validateLayerMoveManyPayload,
  validateLayerMovePayload,
  validateLayerUngroupPayload,
  validateLogicCreateGraphPayload,
  validateLogicDeleteGraphPayload,
  validateLogicUpdateGraphPayload,
  validateNodeCreatePayload,
  validateNodeDeletePayload,
  validateNodeEditPayload,
  validateNodeRenamePayload,
  validateNodeReplaceManyPayload,
  validateNodeReplacePayload,
  validateNodeSetCanvasStatePayload,
  validateNodeSetPropertiesPayload,
  validateNodeSplitPayload,
  validateNodeTransformPayload,
  validateNodeUpdateManyPayload,
  validatePageCreatePayload,
  validatePageSetActivePayload,
  validateProjectRenamePayload,
  validateProjectReplacePayload,
  validateSelectionSelectSimilarPayload,
  validateSelectionSetPayload,
  validateTokensUpdatePayload,
  type ValidationOutcome,
} from '../core/commands/validation';
import type {
  ExtendedNativeCommand,
  NativeCommand,
  NativeCommandPayload,
  NativePermission,
  Phase2NativeCommand,
} from '../core/commands/types';

export interface NativeCommandAdapterContext {
  document?: FolioDocument;
  /** Resolved from the addressed document in payload order when applicable. */
  resolvedNodes: readonly DesignNode[];
  /** Current selected node IDs in the editor state (used by selection.invert / selection.select-similar). */
  selectedNodeIds?: readonly string[];
  /** Live canonical component master document reference verified by CAS before reducer execution. */
  liveComponentMasterDocument?: FolioDocument;
}

export interface NativeCommandDefinition {
  type: NativeCommand['type'];
  commandVersion: 1;
  allowedTargets: readonly ('project' | 'document' | 'node')[];
  requiredPermission: NativePermission;
  /** False for non-project-mutating state commands such as selection.set and history.commit-edit. */
  mutatesProject?: boolean;
  /** True for project.replace where the project ID itself may transition. */
  allowsProjectIdChange?: boolean;
  /** True when the command resets undo/redo stacks (page.create, page.set-active, project.replace). */
  resetsHistory?: boolean;
  validatePayload(value: unknown): ValidationOutcome<NativeCommandPayload>;
  toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[];
}

/**
 * Static Phase 2 compatibility registry (14 commands). Preserved as an immutable
 * closed contract for Phase 2 compatibility tests and callers.
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
} satisfies Record<Phase2NativeCommand['type'], NativeCommandDefinition>);

/**
 * Extended P1.1 static registry covering Page, Project, Component, Multi-Node,
 * Coalesced Inspector Editing, Selection, and Undo/Redo History commands.
 */
export const EXTENDED_NATIVE_COMMAND_REGISTRY = Object.freeze({
  'project.replace': Object.freeze({
    type: 'project.replace' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'project.replace',
    allowsProjectIdChange: true,
    resetsHistory: true,
    validatePayload: validateProjectReplacePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'project.replace') return [];
      return [{ type: 'replace-project', project: command.payload.project }];
    },
  }),
  'page.create': Object.freeze({
    type: 'page.create' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'page.create',
    resetsHistory: true,
    validatePayload: validatePageCreatePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'page.create') return [];
      return [{ type: 'add-page', page: command.payload.page }];
    },
  }),
  'page.set-active': Object.freeze({
    type: 'page.set-active' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'page.switch',
    resetsHistory: true,
    validatePayload: validatePageSetActivePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'page.set-active') return [];
      return [{ type: 'set-active-page', pageId: command.payload.pageId }];
    },
  }),
  'document.set-background': Object.freeze({
    type: 'document.set-background' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateDocumentSetBackgroundPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'document.set-background') return [];
      return [{ type: 'set-document-background', background: command.payload.background }];
    },
  }),
  'document.set-size': Object.freeze({
    type: 'document.set-size' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateDocumentSetSizePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'document.set-size') return [];
      return [{ type: 'set-document-size', width: command.payload.width, height: command.payload.height }];
    },
  }),
  'component.create': Object.freeze({
    type: 'component.create' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'component.create',
    validatePayload: validateComponentCreatePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'component.create') return [];
      return [{ type: 'add-component', component: command.payload.component }];
    },
  }),
  'component.sync-document': Object.freeze({
    type: 'component.sync-document' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'component.update',
    validatePayload: validateComponentSyncDocumentPayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'component.sync-document' || !context.liveComponentMasterDocument) return [];
      return [{
        type: 'sync-component-document',
        componentId: command.payload.componentId,
        document: command.payload.document,
        ...(command.payload.animations !== undefined ? { animations: command.payload.animations } : {}),
        updatedAt: command.payload.updatedAt,
        expectedUpdatedAt: command.payload.expectedUpdatedAt,
        expectedMasterDocument: context.liveComponentMasterDocument,
      }];
    },
  }),
  'component.rename': Object.freeze({
    type: 'component.rename' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'component.update',
    validatePayload: validateComponentRenamePayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'component.rename' || !context.liveComponentMasterDocument) return [];
      return [{
        type: 'rename-component',
        componentId: command.payload.componentId,
        name: command.payload.name,
        expectedUpdatedAt: command.payload.expectedUpdatedAt,
        expectedMasterDocument: context.liveComponentMasterDocument,
      }];
    },
  }),
  'component.delete': Object.freeze({
    type: 'component.delete' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'component.delete',
    validatePayload: validateComponentDeletePayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'component.delete' || !context.liveComponentMasterDocument) return [];
      return [{
        type: 'delete-component',
        componentId: command.payload.componentId,
        expectedUpdatedAt: command.payload.expectedUpdatedAt,
        expectedMasterDocument: context.liveComponentMasterDocument,
      }];
    },
  }),
  'component.update-contract': Object.freeze({
    type: 'component.update-contract' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'component.update',
    validatePayload: validateComponentUpdateContractPayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'component.update-contract' || !context.liveComponentMasterDocument) return [];
      return [{
        type: 'update-component-contract',
        componentId: command.payload.componentId,
        ...(command.payload.variants !== undefined ? { variants: command.payload.variants } : {}),
        ...(command.payload.slots !== undefined ? { slots: command.payload.slots } : {}),
        ...(command.payload.nodeLogicEnabled !== undefined ? { nodeLogicEnabled: command.payload.nodeLogicEnabled } : {}),
        expectedUpdatedAt: command.payload.expectedUpdatedAt,
        expectedMasterDocument: context.liveComponentMasterDocument,
      }];
    },
  }),
  'tokens.update': Object.freeze({
    type: 'tokens.update' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'tokens.update',
    validatePayload: validateTokensUpdatePayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'tokens.update') return [];
      return [{
        type: 'update-design-tokens',
        designTokens: command.payload.designTokens,
        ...(command.payload.unbindTokenIds !== undefined ? { unbindTokenIds: [...command.payload.unbindTokenIds] } : {}),
      }];
    },
  }),
  'code.update-modules': Object.freeze({
    type: 'code.update-modules' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'code.update',
    validatePayload: validateCodeUpdateModulesPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'code.update-modules') return [];
      return [{
        type: 'update-code-modules',
        codeModules: [...command.payload.codeModules],
        ...(command.payload.coalesceKey !== undefined ? { coalesceKey: command.payload.coalesceKey } : {}),
      }];
    },
  }),
  'logic.create-graph': Object.freeze({
    type: 'logic.create-graph' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'logic.update',
    validatePayload: validateLogicCreateGraphPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'logic.create-graph') return [];
      return [{
        type: 'create-logic-graph',
        graph: command.payload.graph,
      }];
    },
  }),
  'logic.update-graph': Object.freeze({
    type: 'logic.update-graph' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'logic.update',
    validatePayload: validateLogicUpdateGraphPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'logic.update-graph') return [];
      return [{
        type: 'update-logic-graph',
        graph: command.payload.graph,
      }];
    },
  }),
  'logic.delete-graph': Object.freeze({
    type: 'logic.delete-graph' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'logic.update',
    validatePayload: validateLogicDeleteGraphPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'logic.delete-graph') return [];
      return [{
        type: 'delete-logic-graph',
        graphId: command.payload.graphId,
      }];
    },
  }),
  'animation.create-clip': Object.freeze({
    type: 'animation.create-clip' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'animation.update',
    validatePayload: validateAnimationCreateClipPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'animation.create-clip') return [];
      return [{
        type: 'create-animation-clip',
        clip: command.payload.clip,
      }];
    },
  }),
  'animation.update-clip': Object.freeze({
    type: 'animation.update-clip' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'animation.update',
    validatePayload: validateAnimationUpdateClipPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'animation.update-clip') return [];
      return [{
        type: 'update-animation-clip',
        clip: command.payload.clip,
        ...(command.payload.coalesceKey !== undefined ? { coalesceKey: command.payload.coalesceKey } : {}),
      }];
    },
  }),
  'animation.delete-clip': Object.freeze({
    type: 'animation.delete-clip' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'animation.update',
    validatePayload: validateAnimationDeleteClipPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'animation.delete-clip') return [];
      return [{
        type: 'delete-animation-clip',
        clipId: command.payload.clipId,
      }];
    },
  }),
  'animation.update-custom-easings': Object.freeze({
    type: 'animation.update-custom-easings' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'animation.update',
    validatePayload: validateAnimationUpdateCustomEasingsPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'animation.update-custom-easings') return [];
      return [{
        type: 'update-custom-easings',
        customEasings: [...command.payload.customEasings],
      }];
    },
  }),
  'asset.upsert': Object.freeze({
    type: 'asset.upsert' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'asset.update',
    validatePayload: validateAssetUpsertPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'asset.upsert') return [];
      return [{
        type: 'upsert-asset',
        asset: command.payload.asset,
      }];
    },
  }),
  'node.replace-many': Object.freeze({
    type: 'node.replace-many' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeReplaceManyPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.replace-many') return [];
      return [{
        type: 'replace-nodes',
        removeIds: [...command.payload.removeIds],
        insertNodes: [...command.payload.insertNodes],
        ...(command.payload.selectIds !== undefined ? { selectIds: [...command.payload.selectIds] } : {}),
      }];
    },
  }),
  'node.split': Object.freeze({
    type: 'node.split' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeSplitPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.split') return [];
      return [{
        type: 'replace-node-with-nodes',
        nodeId: command.payload.nodeId,
        nodes: [...command.payload.nodes],
      }];
    },
  }),
  'node.update-many': Object.freeze({
    type: 'node.update-many' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeUpdateManyPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.update-many') return [];
      return [{
        type: 'transform-nodes',
        nodes: [...command.payload.nodes],
      }];
    },
  }),
  'node.edit': Object.freeze({
    type: 'node.edit' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'node.update',
    validatePayload: validateNodeEditPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'node.edit') return [];
      return [{
        type: 'edit-node',
        node: command.payload.node,
        coalesceKey: command.payload.coalesceKey,
      }];
    },
  }),
  'selection.set': Object.freeze({
    type: 'selection.set' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'selection.update',
    mutatesProject: false,
    validatePayload: validateSelectionSetPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'selection.set') return [];
      return [{ type: 'select-nodes', nodeIds: [...command.payload.nodeIds] }];
    },
  }),
  'selection.deselect': Object.freeze({
    type: 'selection.deselect' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'selection.update',
    mutatesProject: false,
    validatePayload: validateEmptyCommandPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'selection.deselect') return [];
      return [{ type: 'select-nodes', nodeIds: [] }];
    },
  }),
  'selection.invert': Object.freeze({
    type: 'selection.invert' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'selection.update',
    mutatesProject: false,
    validatePayload: validateEmptyCommandPayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'selection.invert' || !context.document) return [];
      const nextIds = computeInvertedSelectionIds(context.document.nodes, context.selectedNodeIds ?? []);
      return [{ type: 'select-nodes', nodeIds: nextIds }];
    },
  }),
  'selection.select-similar': Object.freeze({
    type: 'selection.select-similar' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['document'] as const),
    requiredPermission: 'selection.update',
    mutatesProject: false,
    validatePayload: validateSelectionSelectSimilarPayload,
    toEditorActions(command: NativeCommand, context: NativeCommandAdapterContext): readonly EditorAction[] {
      if (command.type !== 'selection.select-similar' || !context.document) return [];
      const nextIds = computeSimilarSelectionIds(
        context.document.nodes,
        context.selectedNodeIds ?? [],
        command.payload.criterion,
      );
      return [{ type: 'select-nodes', nodeIds: nextIds }];
    },
  }),
  'history.commit-edit': Object.freeze({
    type: 'history.commit-edit' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'history.execute',
    mutatesProject: false,
    validatePayload: validateEmptyCommandPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'history.commit-edit') return [];
      return [{ type: 'commit-edit' }];
    },
  }),
  'history.undo': Object.freeze({
    type: 'history.undo' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'history.execute',
    validatePayload: validateEmptyCommandPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'history.undo') return [];
      return [{ type: 'undo' }];
    },
  }),
  'history.redo': Object.freeze({
    type: 'history.redo' as const,
    commandVersion: 1 as const,
    allowedTargets: Object.freeze(['project'] as const),
    requiredPermission: 'history.execute',
    validatePayload: validateEmptyCommandPayload,
    toEditorActions(command: NativeCommand): readonly EditorAction[] {
      if (command.type !== 'history.redo') return [];
      return [{ type: 'redo' }];
    },
  }),
} satisfies Record<ExtendedNativeCommand['type'], NativeCommandDefinition>);

export const ALL_NATIVE_COMMAND_REGISTRY = Object.freeze({
  ...NATIVE_COMMAND_REGISTRY,
  ...EXTENDED_NATIVE_COMMAND_REGISTRY,
} satisfies Record<NativeCommand['type'], NativeCommandDefinition>);

export function getNativeCommandDefinition(type: string): NativeCommandDefinition | undefined {
  if (!Object.prototype.hasOwnProperty.call(ALL_NATIVE_COMMAND_REGISTRY, type)) {
    return undefined;
  }
  return ALL_NATIVE_COMMAND_REGISTRY[type as keyof typeof ALL_NATIVE_COMMAND_REGISTRY];
}
