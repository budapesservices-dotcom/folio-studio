# Native AST Compatibility & Migration Plan

**Document ID:** FOLIO-AST-MIG-001  
**Version:** 0.1 — Draft  
**Status:** Repository audit completed; migration strategy proposed  
**Branch audited:** feat/canvas-pan-distribute  
**Scope:** Existing document/layer/component/history/persistence model → Native AST v1

> This plan is a compatibility bridge. It does not authorize a breaking AST rewrite or a .flop format change. Preserve existing projects and behavior while the native contracts are introduced incrementally.

## 1. Goal

Evolve the existing FOLIO project model into the Native AST architecture without losing:
- Existing .flop project files or IndexedDB projects.
- Layer identity, hierarchy, order, clipping, and group behavior.
- Component instances, overrides, and detach results.
- Current undo/redo expectations.
- Custom or legacy data that must remain recoverable.

The migration must be reversible or recoverable at each persisted-format boundary. A project is never silently rewritten just because a new editor version is opened.

## 2. Audit baseline — current implementation

This audit was performed against the feat/canvas-pan-distribute branch and these source files:

- src/core/document/types.ts
- src/core/document/project.ts
- src/core/document/factory.ts
- src/core/document/validation.ts
- src/core/document/migrations.ts
- src/core/document/layers.ts
- src/core/document/components.ts
- src/core/persistence/indexedDb.ts
- src/app/editorReducer.ts

### 2.1 Project and document shape

The persisted project model is FolioProjectV2 (format: "folio-project", formatVersion: 2).

It contains project metadata, activePageId, pages[], components[], reserved logicGraphs[], and assets[].

A FolioDocument currently stores nodes: DesignNode[]. Node identity is a string id, and node type is a discriminated type field.

### 2.2 Existing node types

Implemented node types:
- group
- rect
- ellipse
- text
- component-instance

Common node properties include ID, name, x/y, width/height, rotation, opacity, visible, locked, and optional editor fields such as layerColor, parentId, onCanvas, and clipMaskBaseId.

Do not rename or remove these properties during the first AST migration. Add explicit adapters before changing any public or persisted shape.

### 2.3 Layer storage, hierarchy, and order

**Current source of truth:** one flat document array plus parentId references.

- Children are derived by collecting nodes with a matching parentId.
- Nodes are not serialized as nested children[] arrays.
- The document array is treated as paint order (back-to-front).
- The Layers panel reverses sibling presentation order.
- Canvas render order visits parents before their children.
- Group/move operations splice and reorder the flat array as well as update parent references.
- getParentId defensively treats missing/self parent references as root at runtime; project validation rejects invalid parent chains and cycles.

**Compatibility decision:** retain the flat array and parentId representation for the initial Native AST v1 compatibility layer. Do not convert persisted documents to nested child arrays during this milestone.

The array position is currently semantically meaningful. Any future explicit sibling-order field must be derived from and tested against legacy array order before it becomes authoritative. Never sort nodes by name, ID, geometry, or UI display order.

### 2.4 Important existing layer behavior

The migration must preserve these existing semantics:

1. groupLayers reduces a selection to independent roots, retains selected subtrees, chooses a nearest common ancestor, creates a group, and reparents selected roots.
2. Nested grouping is supported. A selected group can be wrapped in another group.
3. An ordinary visual layer that already owns sublayers can also be wrapped; current hierarchy is not limited to group nodes.
4. ungroupLayers removes selected Group containers and reparents their direct children to the previous parent. For ordinary visual parents, the parent can remain while its children are lifted.
5. Deleting a parent promotes surviving children to the nearest surviving ancestor.
6. Moving layers moves selected roots together with descendants and preserves their internal relationships.
7. Clipping is a separate clipMaskBaseId relationship, not the same as parentId.
8. Grouping may retarget an external clipping relationship from a selected root to the new group.
9. Removing a base layer clears clipping references from surviving nodes that pointed to the removed base.
10. Parent visibility and lock state are inherited by descendants at render/interaction time.

**Do not impose a new “only Group/Frame can own children” validation rule yet.** That would reject existing structures created by the current editor. First introduce explicit container capabilities and a deliberate migration/repair path.

### 2.5 Component definitions and instances

Current component behavior:
- A definition owns a FolioDocument.
- A page instance stores componentId and an overrides record.
- Overrides are keyed by the original internal node ID.
- Current override properties are limited to fill and text.
- Nested component instances in master definitions are currently rejected by project validation.
- Deleting a component detaches its instances in page documents before removing the definition.
- Detach materializes effective visual nodes, transforms them, preserves inherited visibility/lock/opacity behavior, and remaps child IDs using an instance-specific prefix.

**Compatibility decision:** keep the existing component ID, child ID, override key, and detach semantics working until the expanded Component Contract is implemented with explicit migrations. Do not change current override keys to property paths in-place.

### 2.6 Project validation and references

Current validation:
- Validates node type-specific structure and required values.
- Rejects duplicate node IDs within one document.
- Rejects missing parent references and parent cycles.
- Validates page identity/routes and active page.
- Validates component IDs and instance references from page documents.
- Rejects nested component instances in component definitions.
- Validates component override targets against definition internal node IDs.
- Validates reserved logic graph nodes/connections and asset references.

Current gaps:
- clipMaskBaseId is not fully validated for existence, scope, or compatible target.
- There is no explicit project-wide uniqueness policy covering every document and component internal node.
- There is no property-level identity/schema contract.
- Unknown node types are rejected by the current strict validator rather than retained as unresolved/read-only records.

**Compatibility decision:** introduce additional reference validation in an audit/report or warning mode first. Only make it a hard import blocker after existing project data and repair behavior have been tested.

### 2.7 History and reducer behavior

Current editor history is snapshot based:
- past and future hold whole FolioProject snapshots.
- History is capped at 60 snapshots.
- edit-node coalesces repeated updates using a coalesceKey until commit-edit.
- Selection is editor state, not part of project snapshots.
- Most document and component mutations use withSnapshot.
- Adding a page or switching active page currently resets both history stacks.
- Undo/Redo restores project snapshots and filters selection IDs against the restored active document.

**Compatibility decision:** preserve existing Undo/Redo results during the first AST work. A future command-based history engine must be introduced behind compatible command/action behavior and its own migration/tests. Do not mix an AST schema refactor with an unreviewed history rewrite.

### 2.8 Persistence and migrations

Current persistence uses IndexedDB:
- Database: folio-studio.
- Database version: 1.
- Project object store: projects.
- Key path: metadata.id.
- Save validates the current project model before writing.
- Load passes stored data through migrateProjectToV2.
- If the stored format version differs from the migrated version, the migrated project is saved back to IndexedDB.

Current project migration:
- .flop project format v1 is a legacy single-document project.
- v1 → v2 wraps the original document in Main Page at route /.
- The document ID and node data are retained; the document name becomes Main Page.
- v2 projects are validated as v2.
- A stale activePageId is recovered by selecting the first page before validation.

The current .flop v2 remains JSON-based. An archive/container format is a future target and must not be introduced in this AST compatibility milestone.

The editor also calls collapseLegacyCanvasInstances while creating editor state. This is a separate legacy-node normalization step applied to page and component documents. Preserve it and test it until its input legacy shapes are no longer supported.

## 3. Compatibility matrix

| Existing field/behavior | Native AST target | Migration rule |
|---|---|---|
| DesignNode.id | Stable AST entity ID | Preserve exactly |
| DesignNode.type | Discriminated node type | Preserve current type names; add new types additively |
| Flat nodes[] | Canonical document node collection | Keep initially |
| Array position | Current paint/sibling order behavior | Preserve order exactly; derive any future order metadata from it |
| parentId | Parent relationship | Preserve IDs and current permissive parent types initially |
| x, y, width, height, rotation | Transform properties | Preserve values and units |
| opacity, visible, locked | Presentation/editor state | Preserve existing inheritance semantics |
| onCanvas | Editor placement/source state | Preserve missing-value legacy default behavior |
| clipMaskBaseId | Clipping relationship | Keep field; add safe reference auditing before strict enforcement |
| layerColor | Layers-panel metadata | Keep as optional editor-facing metadata until ownership is clarified |
| ComponentDefinition.id | Component definition identity | Preserve exactly |
| componentId | Definition reference | Preserve and validate |
| overrides[childNodeId] | Instance property overrides | Keep legacy form; adapt to typed property paths only through a converter |
| Snapshot history | Future semantic command history | Preserve now; migrate separately |
| .flop v1 | Legacy project input | Continue v1 → v2 migration |
| .flop v2 JSON | Current persisted format | Read/write unchanged until a separately approved file-format migration |

## 4. Known issues and documentation conflicts to resolve

These issues are identified from the current source/docs audit. They are not introduced by the migration plan.

### 4.1 Transform reducer equality check — fix applied; verification pending

The original transform-nodes no-op comparison checked position, size, onCanvas, and text font size, but omitted rotation. A rotation-only transform could therefore be ignored.

**Change applied on this branch:** the comparison now includes rotation, and tests/document.test.ts includes a regression case that checks commit, Undo, and Redo for a rotation-only transform.

**Verification status:** source and test changes are committed to this branch, but automated checks have not yet been run in the local development environment. Await the GitHub Actions result before marking this fix verified.

### 4.2 .flop acceptance and UI integration gap — documentation corrected

The current adapter in src/core/persistence/projectFile.ts implements downloadProject and readProjectFile. It serializes the current v2 project as JSON with a .flop extension, and the reader routes supported input through migrateProjectToV2 (including legacy v1 input).

However, src/app/App.tsx still presents the File menu as a placeholder and does not wire these adapter functions into user-facing Open/Export actions.

**Change applied:** docs/ACCEPTANCE_TESTS.md now separates the Stage 1 checks that can be run in the current UI from the deferred native file workflow checks. The deferred export expectation is formatVersion: 2; legacy v1 import is explicitly tested as a migration path.

**Remaining work:** connect the adapter to File menu actions and implement the deferred browser-level acceptance checks in a separate authorized milestone. Do not describe file workflow UI as complete.

### 4.3 Container capability mismatch

The AST draft proposes container capabilities, but current validation does not restrict parentId to group-only nodes. Ordinary visual nodes with descendants are supported by grouping/ungrouping behavior.

**Action:** keep this compatibility exception until Frame/Container semantics and conversion rules are implemented.

## 5. Recommended migration sequence

### Phase 0 — Freeze and test the current contract

Before AST code changes:
- Capture representative v1 and v2 .flop fixtures.
- Capture fixtures with nested groups, nested visual parents, clipping, hidden/locked descendants, component instances, and overrides.
- Document current paint order and Layers panel order.
- Fix and regression-test the transform reducer equality gap as a separate correctness change. (Change committed; CI verification pending.)
- Reconcile the v1/v2 acceptance expectation and distinguish the existing file adapter from the not-yet-wired File menu. (Documentation corrected.)
- Run and record existing check/test/build results.

**Exit gate:** representative current projects open, save, reopen, and render without semantic changes.

### Phase 1 — Introduce an AST compatibility API without changing stored data

Add a typed internal facade over existing project/document/node structures. The facade should expose stable entity references, node lookup, parent/child traversal, order queries, and typed property access while reading/writing the same existing v2 shape.

- Keep nodes[] and parentId as the persisted representation.
- Preserve current array order.
- Keep current action/reducer behavior behind adapter functions.
- Do not add a mandatory AST schema version to .flop v2.
- Do not rewrite IndexedDB records on read just to normalize field placement.

**Exit gate:** old and new access paths produce equivalent results for all captured fixtures.

### Phase 2 — Route mutations through typed native commands

Introduce command APIs for create, update properties, transform, rename, reorder, reparent, group, ungroup, clipping, delete, component update, and detach.

Initially, commands delegate to existing validated helpers/reducer actions. This is a boundary and consistency improvement, not a wholesale state rewrite.

- Preserve action semantics and Undo/Redo snapshots.
- Ensure command validation prevents duplicate IDs, invalid parent references, dangling component references, and accidental cross-document edits.
- Keep selection/editor-only state outside the persistent AST.

**Exit gate:** command-based tests match legacy reducer outputs and history behavior for the same inputs.

### Phase 3 — Add typed properties and explicit capabilities incrementally

- Introduce typed property descriptors and editability/capability metadata.
- Preserve current node fields through adapters.
- Add explicit container capability only after deciding how legacy non-Group parents map.
- Add new node types (Frame, Path, Image, etc.) one at a time with renderer, inspector, serialization, validation, and migration coverage.
- Do not make old files invalid because they lack newly introduced optional fields.

**Exit gate:** current node types round-trip unchanged; new types are validated and cannot corrupt legacy documents.

### Phase 4 — Upgrade components without breaking old instances

- Add a versioned Component Definition contract.
- Convert old fill/text override records to typed property overrides in memory first.
- Persist the expanded contract only in a deliberate new project/AST schema version.
- Preserve old internal node IDs as override reference targets.
- Add slots, variants, and nested components only with explicit scope/identity/cycle rules.
- Preserve detach as a user-triggered operation and verify its output against pre-migration visual rendering.

**Exit gate:** old instances retain their overrides; definition changes do not silently discard local edits; detach produces equivalent independent nodes.

### Phase 5 — Separate AST schema version from .flop container version

When a persisted schema change is truly required:
- Add a separately named AST schema version in a deliberate versioned project manifest/envelope.
- Keep container/file format version and AST schema version distinct.
- Implement deterministic v2 → next-schema migration.
- Validate the migrated project before writing.
- Retain a recoverable copy or leave the original file untouched if migration fails.
- Add import/export round-trip tests for every supported version.

Do not move to an archive-based .flop container in the same change. Container packaging is a later, separate migration.

**Exit gate:** all supported old projects open safely; newly saved projects carry explicit versions; failed migrations leave original data intact.

## 6. Required compatibility test suite

Create or extend tests in the repository existing Vitest structure. The exact test file placement should follow existing conventions rather than inventing a parallel test layout.

Minimum coverage:

### Project/file compatibility
- v1 single-document .flop migrates to v2 and retains document/node IDs and all supported values.
- v2 load → save → load preserves project semantics and node-array order.
- Invalid imports leave the currently open project unchanged.
- A failed migration never overwrites the original source file.

### Layers and grouping
- Group, nested group, group containing a layer that already has children, and ungroup restore intended hierarchy.
- Group/ungroup preserve relative paint order and layer panel order.
- Moving a selected parent and child moves the subtree once.
- Delete parent promotes children to nearest surviving ancestor.
- Missing parents and cycles are rejected on import.
- Clip relationships survive group/ungroup/move and are cleared safely when their base is removed.
- Visibility and lock inheritance remain unchanged.

### Components
- Instance rendering applies old fill/text overrides.
- Definition rename does not break IDs or overrides.
- Deleting a definition detaches all referencing page instances without broken IDs/references.
- Detach preserves effective geometry, rotation, opacity, visibility, locking, and parent relationships.
- Legacy component documents remain loadable.

### History
- Each relevant legacy action produces the same project result.
- Undo/Redo restores grouping, reparenting, clipping, deletion, component edits, and detach.
- Coalesced edit-node changes remain one history step.
- Page-switch behavior remains explicit until separately redesigned.

### Native AST adapter/commands
- Every supported node is found by stable ID.
- Parent/child queries match legacy helpers.
- Paint order and layer panel order match legacy behavior.
- Invalid mutations are rejected before persistent state changes.
- No-op commands do not create history entries.

## 7. Rollback and safety policy

- Keep the old v2 parser/validator available while a new schema is introduced.
- Migrate in memory first; do not autosave a transformed project until validation passes.
- Preserve original .flop bytes/file or an explicit recovery copy when writing a new format.
- Never drop unknown/custom fields as a side effect of AST normalization.
- Do not regenerate IDs during adapter projection.
- Do not combine file-container migration, component redesign, command-history replacement, and AST schema migration in one release.
- If compatibility tests fail, stop the migration and retain the prior storage format.

## 8. Status

**Audited and documented:**
- Existing v2 type model and flat node collection.
- Parent references, layer order, group/ungroup, move, clipping, and delete behavior.
- Component instance override/detach behavior.
- Snapshot history behavior.
- v1 → v2 project migration and IndexedDB save/load path.
- Known reducer comparison gap and acceptance-document version mismatch.

**Proposed, not implemented:**
- AST compatibility facade.
- Typed native command boundary.
- Expanded typed properties and capabilities.
- New component contract and override migration.
- A future AST schema-version envelope.

**Not changed by this task:**
- Source code.
- Existing .flop format.
- IndexedDB schema.
- Runtime behavior.
- Current reducer/history implementation.

**Next work item:** resolve the two known correctness/documentation issues in Phase 0, then draft the AST compatibility facade API before implementation.
