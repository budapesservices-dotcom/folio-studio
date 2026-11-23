import { createDocumentAstView, type DocumentAddress, type NativeAstDocumentView, type NativeNodeRef } from '../core/document/ast';
import { getActivePage } from '../core/document/project';
import type { LayerDropPosition } from '../core/document/layers';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioDocument,
  FolioPage,
  FolioProject,
} from '../core/document/types';
import type {
  NativeCommandContext,
  NativeCommandEnvelope,
  NativeCommandResult,
  NativeCommandTarget,
  NativeCommandTransactionResult,
  NativeNodeTransform,
  NativePermission,
} from '../core/commands/types';
import type { CanonicalEditorStore, CanonicalEditorStoreWorkspace } from './editorStore';
import { executeNativeCommand, executeNativeCommandTransaction } from './nativeCommandExecutor';

export const WORKSPACE_USER_CAPABILITIES: readonly NativePermission[] = Object.freeze([
  'project.read',
  'project.rename',
  'project.replace',
  'page.create',
  'page.switch',
  'document.read',
  'node.create',
  'node.update',
  'node.transform',
  'node.reorder',
  'node.delete',
  'component.read',
  'component.create',
  'component.update',
  'component.delete',
  'selection.update',
  'history.execute',
]);

let fallbackCommandSequence = 1;

function createCommandId(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  const suffix = (fallbackCommandSequence++).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

/**
 * Strip explicit undefined-valued optional properties so in-memory DesignNodes
 * and Folio documents serialize cleanly through the strict Native Command wire validator.
 */
export function stripUndefinedEntries<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedEntries(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) {
        clean[key] = stripUndefinedEntries(entry);
      }
    }
    return clean as unknown as T;
  }
  return value;
}

/**
 * Determines whether updating `current` -> `next` carries style, text, opacity,
 * or vector path changes beyond plain affine bounds (`x`, `y`, `width`, `height`,
 * `rotation`, `onCanvas`), requiring `node.replace` / `node.update-many` instead
 * of `node.transform`.
 */
export function hasExtendedNodeChange(current: DesignNode | undefined, node: DesignNode): boolean {
  if (!current) return false;
  if (current.opacity !== node.opacity) return true;
  if (node.type === 'text' && current.type === 'text') {
    return (
      current.text !== node.text ||
      current.style.fontSize !== node.style.fontSize ||
      current.style.fill !== node.style.fill ||
      current.style.fontFamily !== node.style.fontFamily ||
      current.style.fontWeight !== node.style.fontWeight ||
      current.style.lineHeight !== node.style.lineHeight ||
      current.style.letterSpacing !== node.style.letterSpacing
    );
  }
  if (node.type === 'path' && current.type === 'path') {
    return (
      current.width !== node.width ||
      current.height !== node.height ||
      current.closed !== node.closed ||
      current.points !== node.points ||
      current.shapeMeta !== node.shapeMeta ||
      current.style.fill !== node.style.fill ||
      current.style.stroke !== node.style.stroke ||
      current.style.strokeWidth !== node.style.strokeWidth ||
      current.style.strokeDasharray !== node.style.strokeDasharray ||
      current.style.arrowStart !== node.style.arrowStart ||
      current.style.arrowEnd !== node.style.arrowEnd
    );
  }
  if ((node.type === 'rect' || node.type === 'frame') && current.type === node.type) {
    return (
      current.style.fill !== node.style.fill ||
      current.style.stroke !== node.style.stroke ||
      current.style.strokeWidth !== node.style.strokeWidth ||
      current.style.radius !== node.style.radius
    );
  }
  if (node.type === 'ellipse' && current.type === 'ellipse') {
    return (
      current.style.fill !== node.style.fill ||
      current.style.stroke !== node.style.stroke ||
      current.style.strokeWidth !== node.style.strokeWidth
    );
  }
  return false;
}

export interface MainCanvasCommandClientOptions {
  actorId?: string;
  onRejected?: (result: NativeCommandResult) => void;
}

export interface MainCanvasCommandClient {
  readonly workspace: CanonicalEditorStoreWorkspace;
  getActiveAstView(): NativeAstDocumentView;
  createEnvelope<TType extends string, TPayload>(
    type: TType,
    target: NativeCommandTarget,
    payload: TPayload,
    description?: string,
    transactionId?: string,
  ): NativeCommandEnvelope<TType, TPayload>;
  executeTransaction(
    commands: readonly NativeCommandEnvelope<string, unknown>[],
    mutationLease?: object,
  ): NativeCommandTransactionResult;
  renameProject(name: string): NativeCommandResult;
  replaceProject(project: FolioProject, description?: string): NativeCommandResult;
  createPage(page: FolioPage, description?: string): NativeCommandResult;
  setActivePage(pageId: string, description?: string): NativeCommandResult;
  createComponent(
    component: ComponentDefinition,
    description?: string,
    mutationLease?: object,
  ): NativeCommandResult;
  createComponentWithInstance(
    component: ComponentDefinition,
    instance: ComponentInstanceNode,
    description?: string,
  ): NativeCommandTransactionResult;
  syncComponentDocument(
    args: {
      componentId: string;
      document: FolioDocument;
      updatedAt: string;
      expectedUpdatedAt: string;
      expectedMasterDocument: FolioDocument;
    },
    description?: string,
  ): NativeCommandResult;
  renameComponent(
    args: {
      componentId: string;
      name: string;
      expectedUpdatedAt: string;
      expectedMasterDocument: FolioDocument;
    },
    description?: string,
  ): NativeCommandResult;
  deleteComponent(
    args: {
      componentId: string;
      expectedUpdatedAt: string;
      expectedMasterDocument: FolioDocument;
    },
    description?: string,
    mutationLease?: object,
  ): NativeCommandResult;
  createNodes(nodes: readonly DesignNode[], description?: string): NativeCommandResult;
  replaceNode(node: DesignNode, description?: string): NativeCommandResult;
  replaceNodes(
    removeIds: readonly string[],
    insertNodes: readonly DesignNode[],
    description?: string,
    selectIds?: readonly string[],
  ): NativeCommandResult;
  replaceNodeWithNodes(nodeId: string, nodes: readonly DesignNode[], description?: string): NativeCommandResult;
  transformNodes(nodes: readonly DesignNode[], description?: string): NativeCommandResult;
  editNode(node: DesignNode, coalesceKey: string, description?: string): NativeCommandResult;
  setNodesProperties(
    nodeIds: readonly string[],
    properties: { visible?: boolean; locked?: boolean; layerColor?: string | null },
    description?: string,
  ): NativeCommandResult;
  renameNodes(updates: ReadonlyArray<{ nodeId: string; name: string }>, description?: string): NativeCommandResult;
  deleteNodes(nodeIds: readonly string[], description?: string): NativeCommandResult;
  setNodesCanvasState(nodeIds: readonly string[], onCanvas: boolean, description?: string): NativeCommandResult;
  selectNodes(nodeIds: readonly string[], description?: string): NativeCommandResult;
  commitEdit(description?: string): NativeCommandResult;
  undo(description?: string): NativeCommandResult;
  redo(description?: string): NativeCommandResult;
  moveLayer(nodeId: string, targetId: string, position: LayerDropPosition): NativeCommandResult;
  moveLayers(nodeIds: readonly string[], targetId: string, position: LayerDropPosition): NativeCommandResult;
  groupLayers(nodeIds: readonly string[]): NativeCommandResult;
  ungroupLayers(nodeIds: readonly string[]): NativeCommandResult;
  createClippingMask(nodeId: string): NativeCommandResult;
  removeClippingMask(nodeId: string): NativeCommandResult;
}

export type WorkspaceCommandClient = MainCanvasCommandClient;

/**
 * Modular UI-to-Engine adapter for all workspace mutations (Main Canvas and Component Canvas).
 *
 * Uses the Read-Only Native AST Facade to construct exact DocumentAddress and
 * NativeNodeRef targets, submits versioned Native Commands through the
 * Canonical Editor Store, and reports structured rejections to the shell.
 */
export function createWorkspaceCommandClient(
  store: CanonicalEditorStore,
  workspace: CanonicalEditorStoreWorkspace,
  options: MainCanvasCommandClientOptions = {},
): WorkspaceCommandClient {
  const actorId = options.actorId ?? (workspace === 'main' ? 'local-main-user' : 'local-component-user');

  const getActiveAstView = (): NativeAstDocumentView => {
    const project = store.getSnapshot().editorState.project;
    const page = getActivePage(project);
    const address: DocumentAddress = {
      projectId: project.metadata.id,
      owner: { kind: 'page', id: page.id },
      documentId: page.document.id,
    };
    return createDocumentAstView(page.document, address);
  };

  const buildContext = (): NativeCommandContext => ({
    projectId: store.getSnapshot().editorState.project.metadata.id,
    principal: { kind: 'user', id: actorId },
    capabilities: WORKSPACE_USER_CAPABILITIES,
    workspace,
  });

  const makeNodeRef = (astView: NativeAstDocumentView, nodeId: string): NativeNodeRef =>
    astView.getNodeRef(nodeId) ?? { document: astView.address, nodeId };

  const createEnvelope = <TType extends string, TPayload>(
    type: TType,
    target: NativeCommandTarget,
    payload: TPayload,
    description?: string,
    transactionId?: string,
  ): NativeCommandEnvelope<TType, TPayload> => {
    const snapshot = store.getSnapshot();
    return {
      protocol: 'folio.native-command',
      protocolVersion: 1,
      commandId: createCommandId(),
      type,
      commandVersion: 1,
      issuedAt: new Date().toISOString(),
      source: {
        workspace,
        actor: { kind: 'user', actorId },
      },
      target,
      payload,
      preconditions: {
        expectedProjectRevision: snapshot.projectRevision,
      },
      ...(transactionId ? { transactionId } : {}),
      ...(description ? { metadata: { description } } : {}),
    };
  };

  const submit = <TType extends string, TPayload>(
    type: TType,
    target: NativeCommandTarget,
    payload: TPayload,
    description?: string,
    mutationLease?: object,
  ): NativeCommandResult => {
    const envelope = createEnvelope(type, target, payload, description);
    const result = executeNativeCommand(store, envelope, buildContext(), mutationLease);
    if (result.status === 'rejected') {
      options.onRejected?.(result);
    }
    return result;
  };

  const makeNoOpResult = (message: string, address?: DocumentAddress): NativeCommandResult => {
    const snapshot = store.getSnapshot();
    return {
      protocolVersion: 1,
      commandId: createCommandId(),
      status: 'no-op',
      code: 'NO_OP',
      message,
      projectId: snapshot.editorState.project.metadata.id,
      projectRevisionBefore: snapshot.projectRevision,
      projectRevisionAfter: snapshot.projectRevision,
      changed: false,
      affectedDocuments: address ? [address] : [],
      affectedNodes: [],
      warnings: [],
    };
  };

  return {
    workspace,
    getActiveAstView,
    createEnvelope,

    executeTransaction(commands, mutationLease) {
      const result = executeNativeCommandTransaction(store, commands, buildContext(), mutationLease);
      if (result.status === 'rejected' && result.commandResults.length > 0) {
        const failed = result.commandResults[result.failedCommandIndex ?? result.commandResults.length - 1];
        if (failed) options.onRejected?.(failed);
      }
      return result;
    },

    renameProject(name) {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit('project.rename', { kind: 'project', projectId }, { name }, 'Rename project');
    },

    replaceProject(project, description = 'Replace project') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'project.replace',
        { kind: 'project', projectId },
        { project: stripUndefinedEntries(project) },
        description,
      );
    },

    createPage(page, description = 'Create page') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'page.create',
        { kind: 'project', projectId },
        { page: stripUndefinedEntries(page) },
        description,
      );
    },

    setActivePage(pageId, description = 'Switch active page') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'page.set-active',
        { kind: 'project', projectId },
        { pageId },
        description,
      );
    },

    createComponent(component, description = 'Create component', mutationLease) {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'component.create',
        { kind: 'project', projectId },
        { component: stripUndefinedEntries(component) },
        description,
        mutationLease,
      );
    },

    createComponentWithInstance(component, instance, description = 'Insert template as component') {
      const astView = getActiveAstView();
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      const transactionId = createCommandId();
      const commands = [
        createEnvelope(
          'component.create',
          { kind: 'project', projectId },
          { component: stripUndefinedEntries(component) },
          description,
          transactionId,
        ),
        createEnvelope(
          'node.create',
          { kind: 'document', address: astView.address },
          { nodes: [stripUndefinedEntries(instance)] },
          description,
          transactionId,
        ),
      ];
      const result = executeNativeCommandTransaction(store, commands, buildContext());
      if (result.status === 'rejected' && result.commandResults.length > 0) {
        const failed = result.commandResults[result.failedCommandIndex ?? result.commandResults.length - 1];
        if (failed) options.onRejected?.(failed);
      }
      return result;
    },

    syncComponentDocument(args, description = 'Sync component master document') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'component.sync-document',
        { kind: 'project', projectId },
        {
          componentId: args.componentId,
          document: stripUndefinedEntries(args.document),
          updatedAt: args.updatedAt,
          expectedUpdatedAt: args.expectedUpdatedAt,
          expectedMasterDocument: stripUndefinedEntries(args.expectedMasterDocument),
        },
        description,
      );
    },

    renameComponent(args, description = 'Rename component') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'component.rename',
        { kind: 'project', projectId },
        {
          componentId: args.componentId,
          name: args.name,
          expectedUpdatedAt: args.expectedUpdatedAt,
          expectedMasterDocument: stripUndefinedEntries(args.expectedMasterDocument),
        },
        description,
      );
    },

    deleteComponent(args, description = 'Delete component', mutationLease) {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit(
        'component.delete',
        { kind: 'project', projectId },
        {
          componentId: args.componentId,
          expectedUpdatedAt: args.expectedUpdatedAt,
          expectedMasterDocument: stripUndefinedEntries(args.expectedMasterDocument),
        },
        description,
        mutationLease,
      );
    },

    createNodes(nodes, description = 'Create nodes') {
      const astView = getActiveAstView();
      if (nodes.length === 0) return makeNoOpResult('No nodes were supplied to create.', astView.address);
      const cleanNodes = nodes.map((node) => stripUndefinedEntries(node));
      return submit('node.create', { kind: 'document', address: astView.address }, { nodes: cleanNodes }, description);
    },

    replaceNode(node, description = 'Replace node') {
      const astView = getActiveAstView();
      const ref = makeNodeRef(astView, node.id);
      return submit('node.replace', { kind: 'node', ref }, { node: stripUndefinedEntries(node) }, description);
    },

    replaceNodes(removeIds, insertNodes, description = 'Replace nodes', selectIds) {
      const astView = getActiveAstView();
      if (removeIds.length === 0 && insertNodes.length === 0) {
        return makeNoOpResult('No nodes were supplied to replace.', astView.address);
      }
      const cleanInsert = insertNodes.map((node) => stripUndefinedEntries(node));
      return submit(
        'node.replace-many',
        { kind: 'document', address: astView.address },
        {
          removeIds: [...removeIds],
          insertNodes: cleanInsert,
          ...(selectIds !== undefined ? { selectIds: [...selectIds] } : {}),
        },
        description,
      );
    },

    replaceNodeWithNodes(nodeId, nodes, description = 'Replace node with nodes') {
      const astView = getActiveAstView();
      if (nodes.length === 0) {
        return makeNoOpResult('No replacement nodes were supplied.', astView.address);
      }
      const cleanNodes = nodes.map((node) => stripUndefinedEntries(node));
      return submit(
        'node.split',
        { kind: 'document', address: astView.address },
        { nodeId, nodes: cleanNodes },
        description,
      );
    },

    transformNodes(nodes, description = 'Transform nodes') {
      const astView = getActiveAstView();
      if (nodes.length === 0) return makeNoOpResult('No nodes were supplied to transform.', astView.address);

      // Canvas resizes (scaled text fontSize, PathNode anchor scaling, or Scale
      // tool K stroke/radius scaling) carry style/point changes beyond x/y/w/h.
      // Single-node updates route through node.replace; multi-node updates route
      // through node.update-many while preserving atomic single-step undo history.
      const hasExtendedGeometryOrStyleChange = nodes.some((node) =>
        hasExtendedNodeChange(astView.getNode(node.id), node),
      );
      if (hasExtendedGeometryOrStyleChange) {
        if (nodes.length === 1) {
          return submit(
            'node.replace',
            { kind: 'node', ref: makeNodeRef(astView, nodes[0].id) },
            { node: stripUndefinedEntries(nodes[0]) },
            description,
          );
        }
        return submit(
          'node.update-many',
          { kind: 'document', address: astView.address },
          { nodes: nodes.map((node) => stripUndefinedEntries(node)) },
          description,
        );
      }

      const entries = nodes.map((node) => {
        const current = astView.getNode(node.id);
        const transform: NativeNodeTransform = {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
          ...(node.onCanvas !== undefined && node.onCanvas !== current?.onCanvas ? { onCanvas: node.onCanvas } : {}),
        };
        return { ref: makeNodeRef(astView, node.id), transform };
      });
      return submit('node.transform', { kind: 'document', address: astView.address }, { nodes: entries }, description);
    },

    editNode(node, coalesceKey, description = 'Edit node properties') {
      const astView = getActiveAstView();
      return submit(
        'node.edit',
        { kind: 'document', address: astView.address },
        { node: stripUndefinedEntries(node), coalesceKey },
        description,
      );
    },

    setNodesProperties(nodeIds, properties, description = 'Update layer properties') {
      const astView = getActiveAstView();
      const uniqueIds = [...new Set(nodeIds)];
      if (uniqueIds.length === 0) return makeNoOpResult('No layers selected for property update.', astView.address);
      const cleanProperties: { visible?: boolean; locked?: boolean; layerColor?: string | null } = {};
      if (properties.visible !== undefined) cleanProperties.visible = properties.visible;
      if (properties.locked !== undefined) cleanProperties.locked = properties.locked;
      if ('layerColor' in properties) cleanProperties.layerColor = properties.layerColor ?? null;
      return submit(
        'node.set-properties',
        { kind: 'document', address: astView.address },
        {
          nodes: uniqueIds.map((id) => makeNodeRef(astView, id)),
          properties: cleanProperties,
        },
        description,
      );
    },

    renameNodes(updates, description = 'Rename layers') {
      const astView = getActiveAstView();
      if (updates.length === 0) return makeNoOpResult('No layers selected for rename.', astView.address);
      return submit(
        'node.rename',
        { kind: 'document', address: astView.address },
        {
          updates: updates.map((entry) => ({ ref: makeNodeRef(astView, entry.nodeId), name: entry.name })),
        },
        description,
      );
    },

    deleteNodes(nodeIds, description = 'Delete layers') {
      const astView = getActiveAstView();
      const uniqueIds = [...new Set(nodeIds)];
      if (uniqueIds.length === 0) return makeNoOpResult('No layers selected for deletion.', astView.address);
      return submit(
        'node.delete',
        { kind: 'document', address: astView.address },
        { nodes: uniqueIds.map((id) => makeNodeRef(astView, id)) },
        description,
      );
    },

    setNodesCanvasState(nodeIds, onCanvas, description = 'Update canvas placement') {
      const astView = getActiveAstView();
      const uniqueIds = [...new Set(nodeIds)];
      if (uniqueIds.length === 0) return makeNoOpResult('No layers selected for canvas placement.', astView.address);
      return submit(
        'node.set-canvas-state',
        { kind: 'document', address: astView.address },
        { nodes: uniqueIds.map((id) => makeNodeRef(astView, id)), onCanvas },
        description,
      );
    },

    selectNodes(nodeIds, description = 'Select layers') {
      const astView = getActiveAstView();
      return submit(
        'selection.set',
        { kind: 'document', address: astView.address },
        { nodeIds: [...nodeIds] },
        description,
      );
    },

    commitEdit(description = 'Commit coalesced edit') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit('history.commit-edit', { kind: 'project', projectId }, {}, description);
    },

    undo(description = 'Undo') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit('history.undo', { kind: 'project', projectId }, {}, description);
    },

    redo(description = 'Redo') {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit('history.redo', { kind: 'project', projectId }, {}, description);
    },

    moveLayer(nodeId, targetId, position) {
      const astView = getActiveAstView();
      return submit(
        'layer.move',
        { kind: 'document', address: astView.address },
        {
          node: makeNodeRef(astView, nodeId),
          target: makeNodeRef(astView, targetId),
          position,
        },
        'Move layer',
      );
    },

    moveLayers(nodeIds, targetId, position) {
      const astView = getActiveAstView();
      const uniqueIds = [...new Set(nodeIds)];
      if (uniqueIds.length === 0) return makeNoOpResult('No layers selected to move.', astView.address);
      if (uniqueIds.length === 1) {
        return submit(
          'layer.move',
          { kind: 'document', address: astView.address },
          {
            node: makeNodeRef(astView, uniqueIds[0]),
            target: makeNodeRef(astView, targetId),
            position,
          },
          'Move layer',
        );
      }
      return submit(
        'layer.move-many',
        { kind: 'document', address: astView.address },
        {
          nodes: uniqueIds.map((id) => makeNodeRef(astView, id)),
          target: makeNodeRef(astView, targetId),
          position,
        },
        'Move layers',
      );
    },

    groupLayers(nodeIds) {
      const astView = getActiveAstView();
      const uniqueIds = [...new Set(nodeIds)];
      if (uniqueIds.length === 0) return makeNoOpResult('No layers selected to group.', astView.address);
      return submit(
        'layer.group',
        { kind: 'document', address: astView.address },
        { nodes: uniqueIds.map((id) => makeNodeRef(astView, id)) },
        'Group layers',
      );
    },

    ungroupLayers(nodeIds) {
      const astView = getActiveAstView();
      const uniqueIds = [...new Set(nodeIds)];
      if (uniqueIds.length === 0) return makeNoOpResult('No layers selected to ungroup.', astView.address);
      return submit(
        'layer.ungroup',
        { kind: 'document', address: astView.address },
        { nodes: uniqueIds.map((id) => makeNodeRef(astView, id)) },
        'Ungroup layers',
      );
    },

    createClippingMask(nodeId) {
      const astView = getActiveAstView();
      return submit(
        'layer.create-clipping-mask',
        { kind: 'document', address: astView.address },
        { node: makeNodeRef(astView, nodeId) },
        'Create clipping mask',
      );
    },

    removeClippingMask(nodeId) {
      const astView = getActiveAstView();
      return submit(
        'layer.remove-clipping-mask',
        { kind: 'document', address: astView.address },
        { node: makeNodeRef(astView, nodeId) },
        'Remove clipping mask',
      );
    },
  };
}

export function createMainCanvasCommandClient(
  store: CanonicalEditorStore,
  options: MainCanvasCommandClientOptions = {},
): MainCanvasCommandClient {
  return createWorkspaceCommandClient(store, 'main', options);
}

export function createComponentCanvasCommandClient(
  store: CanonicalEditorStore,
  options: MainCanvasCommandClientOptions = {},
): WorkspaceCommandClient {
  return createWorkspaceCommandClient(store, 'component', options);
}
