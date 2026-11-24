# Native AST Compatibility API v1

**Document ID:** FOLIO-AST-API-001  
**Version:** 0.1 — Draft  
**Status:** Implemented in source; current verification evidence is recorded in docs/ACCEPTANCE_TESTS.md  
**Related specifications:**
- [Native AST v1](NATIVE_AST_V1.md)
- [Native AST Compatibility & Migration Plan](NATIVE_AST_COMPATIBILITY_MIGRATION.md)
- [FOLIO Architecture Blueprint](../FOLIO_ARCHITECTURE_BLUEPRINT.md)

> This is the first compatibility layer, not a new persisted schema. It must read the existing FolioDocument / DesignNode model without changing .flop files, node IDs, parentId, array order, component references, or current editor behavior.

## 1. Goal

Give every FOLIO workspace one consistent way to inspect the native document structure.

The initial API is read-only. It wraps a validated FolioDocument and exposes:
- Node lookup by scoped reference.
- Parent and child relationships.
- Ancestor and descendant traversal.
- Sibling order and document paint order.
- Canvas render order and Layers panel order.
- Typed access to the existing DesignNode data.

It must reuse the current semantic rules rather than independently reimplementing layer behavior in Canvas, Layers, Components, or future Node Logic tools.

## 2. Non-goals for v1

The first API must not:
- Change the .flop file format or IndexedDB structure.
- Replace flat nodes[] with nested children[].
- Add mandatory sibling order fields.
- Generate or rewrite IDs.
- Change group, ungroup, move, clipping, visibility, lock, or component behavior.
- Replace the current editor reducer or snapshot history.
- Promise global uniqueness of node IDs across all documents.
- Introduce a command bus, collaboration protocol, or compiler.

Those capabilities belong to later milestones.

## 3. Scoped identity

The current validator enforces node ID uniqueness inside one document, not across the whole project. Therefore a bare nodeId is insufficient as a durable cross-workspace reference.

Use a scoped address:

\`\`\`ts
type DocumentOwnerRef =
  | { kind: 'page'; id: string }
  | { kind: 'component'; id: string };

interface DocumentAddress {
  projectId: string;
  owner: DocumentOwnerRef;
  documentId: string;
}

interface NativeNodeRef {
  document: DocumentAddress;
  nodeId: string;
}
\`\`\`

Rules:
- A page document address uses the page ID.
- A component definition document address uses the component ID.
- documentId must match the document currently resolved for that owner.
- nodeId is unique only within that document's node collection.
- A rename does not change any ID.
- Switching the active page does not change the address of another page's nodes.

The owner scope deliberately distinguishes page and component definitions. A future Multi-Application model can extend the address with application scope through a versioned contract without changing the meaning of existing node IDs.

## 4. Read API contract

Proposed TypeScript surface:

\`\`\`ts
interface NativeAstDocumentView {
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

function createDocumentAstView(
  document: FolioDocument,
  address: DocumentAddress,
): NativeAstDocumentView;
\`\`\`

This API is implemented and exported in src/core/document/ast.ts as NativeAstDocumentView and createDocumentAstView(). The method table below documents the current implementation contract, not a proposed interface.

### Method semantics

| Method | Required behavior |
|---|---|
| getNode | Find a node by ID in this exact document; return null if absent |
| getNodeRef | Return the complete scoped reference; return null if node absent |
| getParent | Resolve parentId within the same document; return null for root or missing parent |
| getChildren | Return direct children in stored sibling order; null means root siblings |
| getAncestors | Return closest parent first, then its parent; never loop on malformed data |
| getDescendants | Return all nested descendants once each, in deterministic traversal order |
| getStorageIndex | Return the node's current index in document.nodes |
| getSiblingIndex | Return its zero-based index among nodes sharing the same parentId, in paint order |
| getPaintOrder | Return the existing flat document.nodes order unchanged (back-to-front) |
| getRenderOrder | Match the current getLayerRenderOrder behavior: parent before nested children |
| getLayerPanelRows | Match current getLayerPanelRows depth, collapse, and reverse sibling presentation behavior |

The view must distinguish storage/paint order from Layers panel presentation order. They are not interchangeable.

## 5. Compatibility with current layer semantics

The facade must delegate to or share logic with the existing functions in src/core/document/layers.ts wherever possible.

Preserve:
- Flat node storage in document.nodes.
- parentId as the current hierarchy reference.
- The existing support for children under ordinary visual nodes, not only Group nodes.
- Nested Group behavior.
- Current child order and parent-before-child render traversal.
- Reverse sibling presentation in the Layers panel.
- Visibility and lock inheritance.
- Separate clipping relationships through clipMaskBaseId.
- Existing selection expansion and descendant semantics.

Do not use clipMaskBaseId as a parent relationship. Do not insert clipping nodes into the parent/child tree.

## 6. Read-only and lifecycle rules

- A view is a derived, in-memory read model. It is not serialized.
- The view must not mutate the supplied document or any node.
- Returned node values are treated as immutable by callers.
- The view is created from a validated document.
- The view is tied to that immutable document reference. After a reducer mutation returns a new document object, callers must create a new view.
- Do not keep a hidden global cache keyed only by documentId or nodeId.
- If memoization is needed by a workspace, cache by the immutable document object reference and the full DocumentAddress.
- The API must not hold browser APIs, Preact types, DOM elements, or SVG render state.

## 7. Error and malformed data behavior

Normal imported projects must pass the existing project validator before the view is constructed.

For defensive read behavior:
- Missing or null parentId is treated as root, matching current helper behavior.
- A missing parent reference is not followed; return null as parent.
- Self-parent and cycles must not cause infinite traversal.
- Duplicate IDs must not be silently resolved by choosing one arbitrarily. The view factory should fail with a clear validation error or require a validated document boundary that rejects duplicates before construction.
- Invalid cross-document references must never be resolved by searching another document.

Strict project import validation remains owned by src/core/document/validation.ts until a separately tested migration changes that boundary.

## 8. Future write API boundary

The read view is intentionally separated from mutations.

The read view remains read-only. Mutations are handled outside this facade through the Native Command Engine (see docs/ARCHITECTURE.md and src/core/commands/types.ts / src/app/nativeCommandExecutor.ts).

Current command families cover project/page operations, node create/update/transform/delete/rename, layer move/group/ungroup/clipping, component create/sync/rename/delete/contract updates, design-token/code-module/asset updates, logic graph create/update/delete, animation clip create/update/delete, selection, and history. Commands must continue to validate scope and payloads and must remain the authoritative mutation boundary.

The NativeAstDocumentView must not acquire write methods or duplicate the Native Command Engine. Read queries and mutation commands are deliberately separate.

## 9. Acceptance tests

Before implementation is considered complete, tests must prove:

1. getNode resolves by document-scoped ID and does not search another page/component document.
2. Duplicate node IDs are rejected before a view is exposed.
3. Parent and child queries match the current parentId behavior.
4. Ancestor/descendant traversal handles nested groups and ordinary visual parents.
5. Cycles and missing parents cannot cause infinite traversal.
6. Storage index and paint order exactly preserve document.nodes.
7. Render order matches getLayerRenderOrder.
8. Layer panel rows match getLayerPanelRows, including collapsed groups and reversed siblings.
9. clipMaskBaseId never appears as a hierarchy edge.
10. Querying the view does not mutate the source document or its nodes.
11. Rebuilding the view after immutable document replacement returns the new data.
12. Existing .flop v1 → v2 migration and v2 round-trip fixtures remain unchanged.

## 10. Implementation plan

1. Add the read-only facade in src/core/document/ast.ts.
2. Reuse existing layer helpers; do not duplicate their algorithms.
3. Add focused tests using the repository's existing tests/document.test.ts and tests/layers.test.ts conventions.
4. Compare every query against the legacy helper output for representative fixtures.
5. Keep the existing reducer/actions as the only mutation route.
6. Record API adoption per workspace before proceeding to Native Commands.

**Exit gate:** all compatibility tests pass, and the facade produces identical layer/render query results to the existing implementation for all covered fixtures.

## 11. Status

**Implemented in this branch:** src/core/document/ast.ts provides the scoped DocumentAddress / NativeNodeRef and read-only NativeAstDocumentView contract. It derives indexes without mutating or serializing project data and delegates ordering semantics to the existing layer helpers.

**Tests added:** tests/ast.test.ts covers scoped lookup, hierarchy queries, paint/render/panel order, duplicate IDs, document-address mismatch, source immutability, and rebuilding against immutable document updates.

**Verification:** GitHub Actions [run #241](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44667068650) passed for the complete facade and its document-address validation. Type-check, the full test suite, and production build all succeeded.

**Next milestone after this API:** Native Commands v1 — introduce validated write operations without changing persistence or history semantics.
