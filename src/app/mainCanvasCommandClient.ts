import { createDocumentAstView, type DocumentAddress, type NativeAstDocumentView, type NativeNodeRef } from '../core/document/ast';
import { getActivePage } from '../core/document/project';
import type { LayerDropPosition } from '../core/document/layers';
import type { DesignNode } from '../core/document/types';
import type {
  NativeCommandContext,
  NativeCommandEnvelope,
  NativeCommandResult,
  NativeCommandTarget,
  NativeNodeTransform,
  NativePermission,
} from '../core/commands/types';
import type { CanonicalEditorStore } from './editorStore';
import { executeNativeCommand } from './nativeCommandExecutor';

const MAIN_CANVAS_USER_CAPABILITIES: readonly NativePermission[] = Object.freeze([
  'project.read',
  'project.rename',
  'document.read',
  'node.create',
  'node.update',
  'node.transform',
  'node.reorder',
  'node.delete',
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
 * serialize cleanly through the strict Native Command wire validator.
 */
function stripUndefinedEntries<T>(value: T): T {
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

export interface MainCanvasCommandClientOptions {
  actorId?: string;
  onRejected?: (result: NativeCommandResult) => void;
}

export interface MainCanvasCommandClient {
  getActiveAstView(): NativeAstDocumentView;
  renameProject(name: string): NativeCommandResult;
  createNodes(nodes: readonly DesignNode[], description?: string): NativeCommandResult;
  replaceNode(node: DesignNode, description?: string): NativeCommandResult;
  transformNodes(nodes: readonly DesignNode[], description?: string): NativeCommandResult;
  setNodesProperties(
    nodeIds: readonly string[],
    properties: { visible?: boolean; locked?: boolean; layerColor?: string | null },
    description?: string,
  ): NativeCommandResult;
  renameNodes(updates: ReadonlyArray<{ nodeId: string; name: string }>, description?: string): NativeCommandResult;
  deleteNodes(nodeIds: readonly string[], description?: string): NativeCommandResult;
  setNodesCanvasState(nodeIds: readonly string[], onCanvas: boolean, description?: string): NativeCommandResult;
  moveLayer(nodeId: string, targetId: string, position: LayerDropPosition): NativeCommandResult;
  moveLayers(nodeIds: readonly string[], targetId: string, position: LayerDropPosition): NativeCommandResult;
  groupLayers(nodeIds: readonly string[]): NativeCommandResult;
  ungroupLayers(nodeIds: readonly string[]): NativeCommandResult;
  createClippingMask(nodeId: string): NativeCommandResult;
  removeClippingMask(nodeId: string): NativeCommandResult;
}

/**
 * Modular UI-to-Engine adapter for Main Canvas mutations.
 *
 * Uses the Read-Only Native AST Facade to construct exact DocumentAddress and
 * NativeNodeRef targets, submits versioned Native Commands through the
 * Canonical Editor Store, and reports structured rejections to the shell.
 */
export function createMainCanvasCommandClient(
  store: CanonicalEditorStore,
  options: MainCanvasCommandClientOptions = {},
): MainCanvasCommandClient {
  const actorId = options.actorId ?? 'local-main-user';

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
    capabilities: MAIN_CANVAS_USER_CAPABILITIES,
    workspace: 'main',
  });

  const makeNodeRef = (astView: NativeAstDocumentView, nodeId: string): NativeNodeRef =>
    astView.getNodeRef(nodeId) ?? { document: astView.address, nodeId };

  const submit = <TType extends string, TPayload>(
    type: TType,
    target: NativeCommandTarget,
    payload: TPayload,
    description?: string,
  ): NativeCommandResult => {
    const snapshot = store.getSnapshot();
    const envelope: NativeCommandEnvelope<TType, TPayload> = {
      protocol: 'folio.native-command',
      protocolVersion: 1,
      commandId: createCommandId(),
      type,
      commandVersion: 1,
      issuedAt: new Date().toISOString(),
      source: {
        workspace: 'main',
        actor: { kind: 'user', actorId },
      },
      target,
      payload,
      preconditions: {
        expectedProjectRevision: snapshot.projectRevision,
      },
      ...(description ? { metadata: { description } } : {}),
    };
    const result = executeNativeCommand(store, envelope, buildContext());
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
    getActiveAstView,

    renameProject(name) {
      const projectId = store.getSnapshot().editorState.project.metadata.id;
      return submit('project.rename', { kind: 'project', projectId }, { name }, 'Rename project');
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

    transformNodes(nodes, description = 'Transform nodes') {
      const astView = getActiveAstView();
      if (nodes.length === 0) return makeNoOpResult('No nodes were supplied to transform.', astView.address);

      // Canvas resizes (scaled text fontSize, PathNode anchor scaling, or Scale
      // tool K stroke/radius scaling) carry style/point changes beyond x/y/w/h.
      // Single-node updates route through node.replace; multi-node updates preserve
      // atomic single-step undo history.
      const hasExtendedGeometryOrStyleChange = nodes.some((node) => {
        const current = astView.getNode(node.id);
        if (!current) return false;
        if (node.type === 'text' && current.type === 'text') {
          return current.style.fontSize !== node.style.fontSize || current.style.fill !== node.style.fill;
        }
        if (node.type === 'path' && current.type === 'path') {
          return current.width !== node.width || current.height !== node.height ||
            current.points !== node.points || current.shapeMeta !== node.shapeMeta ||
            current.style.fill !== node.style.fill || current.style.stroke !== node.style.stroke ||
            current.style.strokeWidth !== node.style.strokeWidth;
        }
        if ((node.type === 'rect' || node.type === 'frame') && (current.type === node.type)) {
          return current.style.fill !== node.style.fill || current.style.stroke !== node.style.stroke ||
            current.style.strokeWidth !== node.style.strokeWidth || current.style.radius !== node.style.radius;
        }
        if (node.type === 'ellipse' && current.type === 'ellipse') {
          return current.style.fill !== node.style.fill || current.style.stroke !== node.style.stroke ||
            current.style.strokeWidth !== node.style.strokeWidth;
        }
        return false;
      });
      if (hasExtendedGeometryOrStyleChange) {
        if (nodes.length === 1) {
          return submit(
            'node.replace',
            { kind: 'node', ref: makeNodeRef(astView, nodes[0].id) },
            { node: stripUndefinedEntries(nodes[0]) },
            description,
          );
        }
        const beforeSnapshot = store.getSnapshot();
        const transition = store.dispatchLegacyAction({ type: 'transform-nodes', nodes: [...nodes] });
        const afterSnapshot = transition.snapshot;
        const changed = afterSnapshot.projectRevision !== beforeSnapshot.projectRevision;
        return {
          protocolVersion: 1,
          commandId: createCommandId(),
          status: changed ? 'applied' : 'no-op',
          code: changed ? 'APPLIED' : 'NO_OP',
          message: changed ? 'Transformed multi-selection.' : 'The requested transform produced no changes.',
          projectId: afterSnapshot.editorState.project.metadata.id,
          projectRevisionBefore: beforeSnapshot.projectRevision,
          projectRevisionAfter: afterSnapshot.projectRevision,
          changed,
          affectedDocuments: [astView.address],
          affectedNodes: nodes.map((node) => makeNodeRef(astView, node.id)),
          warnings: [],
        };
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
