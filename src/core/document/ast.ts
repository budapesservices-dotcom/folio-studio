import type { FolioDocument, DesignNode } from './types';
import {
  getLayerAncestorIds,
  getLayerDescendantIds,
  getLayerPanelRows,
  getLayerRenderOrder,
  type LayerPanelRow,
} from './layers';

/**
 * Identifies the owner scope of a document in the current project model.
 * Node IDs are only guaranteed to be unique inside one document.
 */
export type DocumentOwnerRef =
  | Readonly<{ kind: 'page'; id: string }>
  | Readonly<{ kind: 'component'; id: string }>;

/** Stable address for a page or component-definition document. */
export interface DocumentAddress {
  readonly projectId: string;
  readonly owner: DocumentOwnerRef;
  readonly documentId: string;
}

/** A node reference that cannot be confused with the same ID in another document. */
export interface NativeNodeRef {
  readonly document: DocumentAddress;
  readonly nodeId: string;
}

/**
 * Read-only compatibility facade over the current flat FolioDocument model.
 * It derives indexes from nodes[] and parentId without mutating or serializing
 * a second AST representation.
 */
export interface NativeAstDocumentView {
  readonly address: DocumentAddress;

  getNode(nodeId: string): DesignNode | null;
  getNodeRef(nodeId: string): NativeNodeRef | null;

  getParent(nodeId: string): DesignNode | null;
  getChildren(parentId: string | null): readonly DesignNode[];
  getAncestors(nodeId: string): readonly DesignNode[];
  getDescendants(nodeId: string): readonly DesignNode[];

  getStorageIndex(nodeId: string): number | null;
  getSiblingIndex(nodeId: string): number | null;

  getPaintOrder(): readonly DesignNode[];
  getRenderOrder(): readonly DesignNode[];
  getLayerPanelRows(collapsedIds?: readonly string[]): readonly LayerPanelRow[];
}

/**
 * Build a document-scoped read view over a validated FolioDocument.
 *
 * The view is tied to the immutable document value passed here. Rebuild it
 * after a reducer mutation returns a new document. Duplicate IDs are rejected
 * because a map lookup would otherwise resolve an arbitrary node.
 */
export function createDocumentAstView(
  document: FolioDocument,
  address: DocumentAddress,
): NativeAstDocumentView {
  const owner = address.owner;
  if (!address.projectId.trim() || !address.documentId.trim() || !owner.id.trim()) {
    throw new Error('A native AST document address requires project, owner and document IDs.');
  }
  if (document.id !== address.documentId) {
    throw new Error(
      `Cannot create a native AST view: address document ID "${address.documentId}" does not match document "${document.id}".`,
    );
  }
  if (owner.kind !== 'page' && owner.kind !== 'component') {
    throw new Error('A native AST document address has an unsupported owner kind.');
  }

  const stableAddress: DocumentAddress = Object.freeze({
    projectId: address.projectId,
    owner: Object.freeze({ kind: owner.kind, id: owner.id }),
    documentId: address.documentId,
  });

  const nodeById = new Map<string, DesignNode>();
  const storageIndexById = new Map<string, number>();

  document.nodes.forEach((node, index) => {
    if (nodeById.has(node.id)) {
      throw new Error(`Cannot create a native AST view: duplicate node ID "${node.id}".`);
    }
    nodeById.set(node.id, node);
    storageIndexById.set(node.id, index);
  });

  // Match the current layer helpers: missing and self-parent references are
  // treated as roots by read traversal. Valid project imports reject them.
  const parentIdByNodeId = new Map<string, string | null>();
  const childrenByParentId = new Map<string | null, DesignNode[]>();

  for (const node of document.nodes) {
    const candidate = node.parentId ?? null;
    const parentId = candidate && candidate !== node.id && nodeById.has(candidate)
      ? candidate
      : null;

    parentIdByNodeId.set(node.id, parentId);
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(parentId, siblings);
  }

  const getNode = (nodeId: string): DesignNode | null => nodeById.get(nodeId) ?? null;

  return {
    address: stableAddress,

    getNode,

    getNodeRef(nodeId) {
      return nodeById.has(nodeId)
        ? Object.freeze({ document: stableAddress, nodeId })
        : null;
    },

    getParent(nodeId) {
      const parentId = parentIdByNodeId.get(nodeId);
      return parentId ? getNode(parentId) : null;
    },

    getChildren(parentId) {
      return [...(childrenByParentId.get(parentId) ?? [])];
    },

    getAncestors(nodeId) {
      return [...getLayerAncestorIds(document.nodes, nodeId)]
        .map((ancestorId) => nodeById.get(ancestorId))
        .filter((node): node is DesignNode => node !== undefined);
    },

    getDescendants(nodeId) {
      return [...getLayerDescendantIds(document.nodes, nodeId)]
        .map((descendantId) => nodeById.get(descendantId))
        .filter((node): node is DesignNode => node !== undefined);
    },

    getStorageIndex(nodeId) {
      return storageIndexById.get(nodeId) ?? null;
    },

    getSiblingIndex(nodeId) {
      if (!nodeById.has(nodeId)) return null;
      const parentId = parentIdByNodeId.get(nodeId) ?? null;
      const siblings = childrenByParentId.get(parentId) ?? [];
      const index = siblings.findIndex((node) => node.id === nodeId);
      return index >= 0 ? index : null;
    },

    getPaintOrder() {
      return [...document.nodes];
    },

    getRenderOrder() {
      return getLayerRenderOrder(document.nodes);
    },

    getLayerPanelRows(collapsedIds = []) {
      return getLayerPanelRows(document.nodes, collapsedIds);
    },
  };
}
