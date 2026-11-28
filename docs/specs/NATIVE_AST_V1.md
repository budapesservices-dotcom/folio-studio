# Native AST v1 — Specification Draft

**Document ID:** FOLIO-AST-001  
**Specification version:** 0.1 — Draft  
**Target contract:** Native AST v1  
**Status:** Proposed; not implemented or verified  
**Related:** [FOLIO Architecture Blueprint](../FOLIO_ARCHITECTURE_BLUEPRINT.md)

> Native AST v1 is a semantic contract version. It is **not** the same thing as the existing .flop formatVersion 1 or formatVersion 2.

## Related migration plan

Read [Native AST Compatibility & Migration Plan](NATIVE_AST_COMPATIBILITY_MIGRATION.md) before changing persisted project data, node identity, layer ordering, component references, or the existing .flop schema. The proposed [Native AST Compatibility API](NATIVE_AST_COMPATIBILITY_API.md) defines the first read-only facade over the current model.

## 1. Purpose

The Native AST is the canonical semantic structure for content that FOLIO expects to understand and edit across workspaces.

The same node identity and meaning must be understood by:
- Design Canvas and Layers
- Component Canvas and Component Instances
- Node Logic and Motion
- Code Mapping and code generation
- Preview, history, and collaboration

A workspace may display the project differently, but it must not invent a competing representation of the same native object.

## 2. Separate the four concepts

These concepts must not be confused:

| Concept | Responsibility |
|---|---|
| **Unified Project Model** | The complete in-memory project aggregate and its relationships |
| **Native AST** | Semantic document/component structure and persistent object identity |
| **.flop Project Container** | The on-disk format that stores the complete project |
| **Generated Application Output** | Compiled HTML/CSS/JS or supported framework output; not the source of truth |

The project model owns applications, documents, components, design resources, logic graphs, code modules, assets, and configuration. AST nodes are one important part of that model.

## 3. Current repository baseline

The current branch implements a JSON-based FolioProjectV2 schema in src/core/document/types.ts.

Current structure:
- FolioProjectV2: metadata, active page, pages, component definitions, logic graphs, and asset references.
- FolioPage: page ID, name, route, and a FolioDocument.
- FolioDocument: document ID, name, dimensions, background, and nodes.
- DesignNode: a discriminated union of group, rect, ellipse, text, and component-instance.
- NodeBase: ID, name, geometry, rotation, opacity, visibility, lock state, optional parent ID, canvas placement, layer color, and clipping reference.
- ComponentInstanceNode: component definition reference and a currently limited override record.
- LogicGraph: reserved graph data with node and connection IDs.

The current document node list is flat. Layer parentage is represented with parentId, not duplicated nested child arrays. The current validator checks node IDs within a document and validates parent references/cycles. The current project format is version 2 and is still the existing JSON .flop representation.

### Current limitations to preserve honestly

The repository does not yet implement:
- Multi-Application ownership inside the project model.
- The complete Native Component Contract.
- A typed property schema or property-level stable IDs.
- A complete Design System/token reference model.
- A Code Mapping model or round-trip compiler.
- A full Node Logic runtime and Motion engine.
- An archive/container-based .flop format.
- A general unknown-node preservation mechanism.

These are target capabilities, not existing features.

## 4. Target semantic hierarchy

The intended relationship is:

- Project
  - Application
    - Document
      - Native AST nodes
  - Application-local components
- Project-wide components
- Project-wide design tokens and themes
- Logic graphs and motion data that reference native entities
- Code modules and mapping metadata that reference native entities
- Assets and configuration

A component definition owns a native document/structure under the same AST rules. A component instance references that definition; it does not copy the definition into the consuming document.

This hierarchy is the target model. The current pages[] project schema must remain compatible while the multi-application model is designed and migrated deliberately.

## 5. Node contract

Every native node uses a discriminated type (type) and stable identity (id). Node-specific data is validated against its type schema.

### 5.1 Common semantic properties

The target common node contract covers:

- **Identity:** stable node ID and node type.
- **Naming:** editable display name; never used as identity.
- **Hierarchy:** optional parent reference within the same document/component scope.
- **Order:** deterministic sibling stacking/layer order, independent of names and geometry.
- **Transform:** position, dimensions, rotation, and future transform extensions.
- **Presentation:** opacity and visibility.
- **Interaction state:** lock state and editor placement flags where relevant.
- **Capabilities:** whether the node supports selection, editing, children, rendering, or other operations.
- **Extensions:** explicitly namespaced extension data where a built-in schema does not own the data.

The current NodeBase already contains most of the initial geometry and editor-state fields. This specification does not require renaming or moving every existing field immediately.

### 5.2 Initial native node families

| Node type | Purpose | Current status |
|---|---|---|
| group | Hierarchy/container node for layers | Implemented |
| rect | Rectangle geometry with shape style | Implemented |
| ellipse | Ellipse geometry with shape style | Implemented |
| text | Text content and typography style | Implemented |
| component-instance | Reference to a reusable component definition | Implemented, limited contract |
| path / vector geometry | Editable vector path and bezier data | Planned |
| image | Asset-backed image node | Planned |
| frame | Layout/container boundary with its own canvas bounds | Planned |
| slot / component part | Explicit component content insertion point | Planned |

New node types must be added through typed schemas and validation. Do not represent unrelated native types as arbitrary unvalidated records.

### 5.3 Hierarchy invariants

Target invariants:
1. Each node appears exactly once in its owning document structure.
2. A node's parentId resolves within the same document/component scope, or is null for a root node.
3. Parent relationships cannot contain cycles.
4. Only node types declaring container capability may own children.
5. Sibling order is explicit and deterministic.
6. Reparenting is a validated operation and cannot create a cycle.
7. Removing a container must use an explicit policy: remove its subtree, move children to the parent, or cancel. Never silently lose children.
8. Clipping/masking references are separate from parent-child hierarchy and must resolve to compatible targets.

The current implementation validates parent existence and cycles, but the full container capability and removal policies are future requirements.

## 6. Identity and references

- A persistent ID is generated once and remains stable through rename, reorder, transform, save, reopen, and supported migration.
- Names, array indexes, coordinates, CSS selectors, and generated source positions are not identity.
- IDs must not be regenerated during rendering or serialization.
- Node IDs must be unique inside their owning document. The broader project-wide ID policy must be finalized before multi-application and cross-document references are implemented.
- Cross-scope references must include enough context to resolve the intended entity unambiguously (entity type and owning project/document/component as required).
- A deleted entity must not leave dangling component, logic, code-map, or asset references. Reference resolution must be validated before commit.
- Renaming an entity must not break any reference.

The current model uses string IDs and document-local node validation. A stronger typed/reference policy is a proposed extension and must be migrated without breaking existing .flop files.

## 7. Component AST relationship

A component definition owns its canonical internal AST. An instance stores a reference to the definition and its own identity/placement.

The target instance contract includes:
- Definition ID and compatible definition version.
- Stable identity for the instance.
- Overrides keyed by stable internal node ID and typed property path.
- Slot assignments and supported variants.
- Explicit reset-to-definition behavior.
- Detach as a deliberate conversion to independent native structure.

Definition updates must preserve compatible overrides. If a definition change invalidates an override or slot assignment, FOLIO must show the conflict and provide a resolution path rather than silently discarding it.

The current override type is limited to fill/text fields. Rich typed overrides are not yet implemented.

## 8. Relationships with Design System, Node Logic, and Code

### Design System

AST properties may contain either literal values or typed references to Design System tokens. Token identity must be stable; the AST must not depend only on a token's editable name. Token resolution and theme selection belong to the Design System model.

A literal value must not be silently converted into a token reference.

### Node Logic and Motion

Logic graphs and motion tracks live in their own typed models. They reference AST entities by stable IDs; they do not duplicate the visual node as a second source of truth.

A reference must be validated when its target is changed, detached, deleted, or migrated.

User-facing filters, effects, animation, events, conditions, variables, state, API requests, and data binding are authored in Node Logic/Motion workflows. Canvas tools remain focused on direct object manipulation.

### Code Mapping

Code mapping is a related model, not arbitrary fields scattered across UI components. It associates native entities/properties with owned source regions and declares mapping capability.

Required mapping categories:
- **Generated Code**
- **Mapped Code**
- **Custom Code**
- **Extension / Override**

A mapping must declare ownership and scope before FOLIO updates generated output. Unknown or unmapped code must be preserved and shown honestly as custom/unresolved where appropriate.

## 9. Validation and safe evolution

Validation is performed at native command/import boundaries, not only in the visual renderer.

The target validator must check:
- Valid node type and required typed properties.
- Stable IDs and duplicate IDs within the defined scope.
- Parent and cross-entity references.
- Hierarchy cycles and container capabilities.
- Component definitions, instance references, overrides, slots, and variants.
- Token references and compatible value types.
- Logic and motion references.
- Code mapping ownership and source-range integrity.
- Unknown extension data preservation.

### Versioning

The Native AST schema version is a separate concept from .flop container/file format version.

A future project manifest should identify the AST schema version explicitly. Do not retrofit a breaking AST version change into the current .flop v2 JSON format without a deliberate migration design.

Migrations must:
1. Be explicit and deterministic.
2. Preserve IDs wherever the semantic entity still exists.
3. Preserve custom and unknown data.
4. Be testable using representative legacy project fixtures.
5. Leave the original project recoverable if migration fails.

Unsupported nodes or extensions must not be silently dropped. A future tolerant import path should preserve unknown records as unresolved/read-only content when safe; this behavior is not yet implemented by the current strict validator.

## 10. Commands and history

Workspaces must not mutate shared AST state through hidden, untracked side effects.

The target mutation path is:

1. Workspace creates an intent using a typed FOLIO command.
2. Native command layer validates permissions, schema, IDs, references, and constraints.
3. The project model applies the mutation as a coherent transaction.
4. History records the semantic operation and its inverse/recovery data.
5. Synchronization notifies dependent workspaces, preview, code mapping, and collaboration.

Examples of future command families: create node, update properties, transform, reorder, reparent, group, ungroup, create/delete component instance, update override, detach instance, and resolve reference.

Command-based history is a target architecture. The current editor's snapshot history must not be described as command-based until replaced and verified.

## 11. Acceptance criteria for Native AST v1

The specification is ready for implementation when:
1. All persistent node types have typed schemas and stable identity rules.
2. Hierarchy, ordering, container, and clipping semantics are unambiguous.
3. Component definition/instance/override references are defined.
4. Logic, Motion, Design System, and Code Mapping reference the same native entities.
5. Project format versioning and AST schema versioning are explicitly separated.
6. Unknown/custom data preservation and migration behavior are defined.
7. A representative legacy .flop v2 fixture can be migrated without losing node identity or content.
8. Unit tests cover valid/invalid nodes, duplicate IDs, dangling references, cycles, reparenting, ordering, and migration behavior.

## 12. Status and next steps

**Agreed foundation:** one Unified Project Model, stable identity, Native Engine First, explicit code mapping, custom-code preservation, and workspace interoperability.

**Proposed in this draft:** the detailed node contract, hierarchy invariants, reference policy, tolerant unknown-node handling, and command boundary.

**Implemented baseline:** the existing TypeScript document/project types and validator in src/core/document/.

**Not yet implemented or verified:** this full Native AST v1 contract.

Next steps:
1. Review and agree this specification.
2. Compare it against current reducers, layer operations, component behavior, and tests.
3. Produce a field-by-field compatibility/migration plan.
4. Only then implement the smallest AST foundation change with tests.

Do not begin a breaking AST refactor from this draft alone.
