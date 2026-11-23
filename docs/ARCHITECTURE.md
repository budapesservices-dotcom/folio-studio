# Folio Studio — Architecture

> **Document scope:** This document records the current repository architecture and implementation reality. For FOLIO product vision and long-term agreed architecture, read [FOLIO Architecture Blueprint](FOLIO_ARCHITECTURE_BLUEPRINT.md). Keep both documents aligned, and keep **Implemented** capabilities strictly distinct from **Planned** engines not yet present on disk.

## Product direction

Folio is a browser-based, visual-first full-stack web development studio designed around a single native project aggregate (`.flop` v2) and multiple independent workspaces. Main Canvas, Component Canvas, Component Rack, Pages Rack, and the future Node Logic workspace are views over shared project data, never isolated project silos.

## Architectural rules

1. **The project AST is the source of truth.** Renderers, inspectors, reusable components, history, and future logic/codegen engines consume or transform the same project aggregate via `NativeAstDocumentView` (`src/core/document/ast.ts`).
2. **Project identity is separate from page identity.** A project owns many `FolioPage` records; each page owns one `FolioDocument` and route.
3. **UI is not the domain model.** `src/core` must not import Preact or depend on browser view components.
4. **Strict unidirectional tool-to-engine boundary (P0.3).** Studio Tools emit versioned `ToolOperation` envelopes (`src/core/tools/operationContract.ts`) -> Geometry Engine validates and seals them (`src/engines/canvas/geometryEngine.ts`) -> Tool Operation Executor (`src/app/toolOperationExecutor.ts`) dispatches through the Native Command Engine. Studio Tools have zero direct imports from UI panels, legacy reducers, or Native Engine internals.
5. **Zero-bypass Native Command Engine (P1.1).** Every project and editor mutation across Main Canvas, Component Canvas, Inspector, Layers, Pages, Components/Instances, durable deletion/recovery, and Undo/Redo flows through the Native Command Engine (`src/app/nativeCommandExecutor.ts`). Direct `editorReducer` or `commitEditorTransition` bypasses in production `src/` are forbidden and statically tested.
6. **Persistence is replaceable.** IndexedDB (`src/core/persistence/indexedDb.ts`) is the current local adapter; `.flop` file I/O (`src/core/persistence/projectFile.ts`) serializes the complete project aggregate.
7. **Native files are versioned.** Every `.flop` file carries `format: "folio-project"` and `formatVersion`. Schema changes require explicit migrations (`src/core/document/migrations.ts`).
8. **Legacy split storage is not authoritative.** Pages, active page, and component definitions live inside the project aggregate. Workspace window geometry and panel widths remain local UI preferences outside `.flop` files.

## Implemented repository structure

### `src/core` — Framework-independent domain & contracts (Implemented)

- **`src/core/document/`**
  - `types.ts`: Canonical `.flop` v2 project, page, document, layer, `FrameNode`, `RectNode`, `EllipseNode`, `PathNode` (cubic Bezier anchors, handles, compound subpaths, shape metadata), `TextNode`, `GroupNode`, `ComponentInstanceNode`, `ComponentDefinition` (with named Variant Axes & Slots), web semantic attributes (`semanticTag`, `ariaLabel`, `href`), Auto-Layout (`layout`, `layoutChild`), per-breakpoint responsive overrides (`responsive`), node `tokenBindings`, project `designTokens`, logic graph, and asset types.
  - `ast.ts`: Read-only `NativeAstDocumentView` facade with deterministic node lookup, parent/child traversal, and descendant queries.
  - `factory.ts`: Project, page, document, and typed node factories (attaching default Light/Dark `designTokens` to new projects).
  - `project.ts`: Active-page / active-document resolution helpers with stale-reference fallback.
  - `layers.ts`: Layer hierarchy traversal, effective lock/visibility state computation, render ordering, clipping mask base resolution, and layer panel row derivation.
  - `components.ts`: Master component extraction (`buildComponentDefinitionFromNodes`), linked instance creation (`createComponentInstance`), instance detaching (`detachComponentInstance`), Variant Axes & Named Slots factories/pruning (`createComponentVariantAxis`, `createComponentSlot`, `pruneComponentContractForDocument`), and deterministic override resolution (`Master -> Variants -> Slots -> Local Overrides -> Design Tokens`).
  - `tokens.ts`: Project-level Design Tokens & Themes (`createDefaultDesignTokens`, `resolveDesignTokenValue` with cycle/type-mismatch detection, `resolveNodeWithTokens`, `findTokenUsages`, `generateDesignTokensCss`).
  - `vector.ts`: Deterministic SVG cubic Bezier serialization, bounding-box normalization, anchor/handle scaling, polygon/star/line generators, Catmull-Rom curvature fitting, Ramer-Douglas-Peucker simplification, smooth brush relaxation, segment insertion, corner/smooth toggling, scissors splitting, shape-to-path conversion, flipping, and Pathfinder entry points (`applyPathfinderOperation`).
  - `src/core/document/planarBoolean.ts`: Planar polygon/curve subdivision and boolean solver backing Illustrator-style Pathfinder operations (`unite`, `subtract`, `intersect`, `exclude`) and Shape Builder regions.
  - `validation.ts`: Runtime `.flop` v1 and v2 schema, hierarchy, node, web layout/semantics, design tokens, component variants/slots, logic graph, and asset validation.
  - `migrations.ts`: Deterministic `migrateProjectV1ToV2` upgrade path preserving IDs, document content, and unknown extension fields.
  - `equality.ts`: Structural equality checks for documents and projects.
- **`src/core/commands/`**
  - `types.ts`: Native Command v1 envelope, 14 frozen Phase 2 commands (`NATIVE_COMMAND_REGISTRY`), 18 P1.1+ extended commands (`EXTENDED_NATIVE_COMMAND_REGISTRY`, including `tokens.update`, `component.update-contract`, and `code.update-modules`, 32 total in `ALL_NATIVE_COMMAND_REGISTRY`), target descriptors, result/error unions, and `NativeChangeEvent` contracts.
  - `validation.ts`: Closed own-key allowlist and finite-budget runtime validation for all Native Commands.
- **`src/core/tools/`**
  - `operationContract.ts`: Versioned `folio.tool-operation` v1 `ToolOperation` contract, `ToolOperationBatch`, `ToolOptionsChange`, `ToolFeedbackMessage`, `ValidatedToolOperation` sealed boundary types, and `extractToolOperationsFromTransition`.
- **`src/core/persistence/`**
  - `indexedDb.ts`: IndexedDB v2 persistence (`projects` store keyed by `metadata.id` plus `app-state` store for active-project pointer), revision-fenced saves (`saveProjectIfRevisionCurrent`), atomic import+activation (`saveProjectAndActivate`), and per-project write locks (`withProjectWriteLock`).
  - `projectFile.ts`: `.flop` UTF-8 JSON file reading, parsing, validation/migration, and download serialization.

### `src/engines/canvas` — Canvas renderer, geometry engine & studio tools (Implemented)

- `Canvas.tsx`: Interactive SVG viewport for both Main Canvas (`PAGE` mode) and Component Canvas (`VECTOR` mode), pointer/keyboard event routing, selection marquee, transform/rotation/Bezier handle overlays, inline text editing, and snapping guides.
- `artwork.tsx`: Shared Preact-safe kebab-case SVG node renderer with scoped `<mask id>` generation (`buildMaskElementId`) reused across Main Canvas, Component Canvas, Component Instances, and Component Rack thumbnails.
- `canvas.css`: Canvas viewport, guide, handle, and overlay styling.
- `geometry.ts`: Bounding boxes, snapping, alignment (`alignNodes`), distribution (`distributeNodes`), hit-testing, and coordinate transforms.
- `geometryEngine.ts`: Mandatory validation and calculation gate (`evaluateToolOperation`, `evaluateToolOperationBatch`) between Studio Tools and the Native Command Engine. Enforces finite geometry, lock checks, ID uniqueness, zero-delta no-op filtering, inline text/eyedropper sanitization, and runtime-private symbol sealing (`ValidatedToolOperation`).
- `tools/` (13 modules):
  - `types.ts`: Tool context, pointer/keyboard input, transition, options, and preview state contracts.
  - `registry.ts`: Wave 1 `canvasToolRegistry` (preserved for contract compatibility).
  - `studioRegistry.ts`: Workspace-aware 26-tool registry supporting Main Canvas (`PAGE` mode) and Component Canvas (`VECTOR` mode) groups and shortcuts.
  - `select.ts`: Selection, multi-selection, marquee, drag with snapping, 8-handle resize, rotation, and Direct Selection (`A`).
  - `draw-tools.ts`: Frame (`F`), Section (`Shift+S`), Rectangle (`R`), Ellipse (`O`), Line (`L`), Arrow (`Shift+L`), Polygon (`G`), Star (`Shift+G`), and Text (`T`).
  - `vector-tools.ts`: Pen (`P`), Curvature (`U`), Anchor Point (`Shift+C`), Pencil (`N`), Smooth (`Shift+N`), and Scissors (`C`).
  - `utility-tools.ts`: Scale (`K`), Rotate (`Shift+R`), Eyedropper (`I`), and Precision Measure (`M`).
  - `hand.ts`, `scrubby-zoom.ts`, `lasso-selection.ts`, `magic-wand.ts`, `shape-builder.ts`, and `geometry.ts` (tool-local geometry helpers).

### `src/engines/layout` — Deterministic Auto-Layout & Responsive Solver (Implemented)

- `autoLayout.ts`: Pure framework-independent Flex (`row`/`column`, `wrap`, `justifyContent`, `alignItems`, `gap`, `padding`, `fixed`/`hug`/`fill` child sizing) and Grid (`gridColumns`, `columnGap`, `rowGap`) solver, Desktop -> Tablet (`768px`) -> Mobile (`390px`) responsive override inheritance (`resolveEffectiveNodeForBreakpoint`), non-destructive preview computation (`computeAutoLayoutNodes`), and canonical AST commit helper (`applyAutoLayoutToNodes`).

### `src/engines/codegen` — Deterministic Code Engine & Live Preview (Implemented)

- `types.ts`, `sanitize.ts`: Strict HTML/attribute escaping, URL protocol allowlist (`http:`, `https:`, `mailto:`, `/`, `#` — rejecting `javascript:`/`data:`/`vbscript:`), CSS/JS breakout neutralization, and traceable `CodeMappingEntry` contracts.
- `htmlCssCompiler.ts`: Deterministic AST-to-Semantic HTML5, Auto-Layout Flex/Grid CSS, Design Token `var(--token)` bindings, `@media (max-width: 768px)` / `(max-width: 390px)` responsive rules, inline vector `<svg>`, and sandboxed Live Preview document assembly (`buildLivePreviewHtml`).
- `reactCompiler.ts`: Compiles Master Components (Variants & Slots) into typed React + TypeScript JSX (`src/components/*.tsx`) and Pages (`src/pages/*.tsx`, `src/App.tsx`).
- `mappedSync.ts`, `index.ts`: Explicit 4-category code classification (`generated`, `mapped`, `custom`, `extension`), safe Code → AST mapped synchronization (`applyMappedNodeEdit`) with honest capability reporting, and Custom/Extension module preservation inside `.flop` v2 `codeModules`.

### `src/app` — Application shell, command orchestration & workspace UI (Implemented)

- **State & Native Command Engine:**
  - `editorStore.ts`: `CanonicalEditorStore` for `'main'` and `'component'` workspaces with deep-frozen state snapshots, monotonic `projectRevision`, history bounds, and `NativeChangeEvent` publication.
  - `editorReducer.ts`: Internal pure state transition implementation invoked exclusively by `nativeCommandExecutor.ts` (no direct production bypasses).
  - `nativeCommandRegistry.ts`: Closed static handler registry mapping all 32 commands across project, page, document, node, component, design token, code module, selection, and history scopes.
  - `nativeCommandExecutor.ts`: Validates commands, resolves targets through `createDocumentAstView`, enforces workspace isolation, component CAS guards (`COMPONENT_CONFLICT`), lock/hierarchy preconditions, atomic multi-command transactions (`executeNativeCommandTransaction`) with single-step Undo collapse and rollback, and executor-authenticated rollbacks (`executeNativeSnapshotRollback`).
  - `mainCanvasCommandClient.ts`: Typed `WorkspaceCommandClient` adapters (`createMainCanvasCommandClient`, `createComponentCanvasCommandClient`) exposing 100% Native Command Engine dispatch for both workspaces.
  - `toolOperationExecutor.ts`: Consumes sealed `ValidatedToolOperation` items from `geometryEngine.ts` and dispatches them through `WorkspaceCommandClient`.
- **Workspace shell, hooks & modular panels (`src/app/workspace/`):**
  - `App.tsx`: Lean top-level workspace orchestrator composing hooks, Native Command clients, and modular workspace UI components.
  - `workspace/layerOperations.ts`, `workspace/canvasViewState.ts`: Pure domain-adjacent helpers for layer rename/collision rules, drag-drop hit placement, context-menu capability derivation, subtree multi-selection, clamped popover coordinates, canvas zoom/view state parsing, and active export target resolution.
  - `workspace/useWorkspaceWindows.ts`, `workspace/usePanelResizeController.ts`, `workspace/useComponentMasterLifecycle.ts`, `workspace/useWorkspaceShortcuts.ts`, `workspace/useDesignSystemActions.ts`, `workspace/useCodeWorkspace.ts`: Cohesive workspace hooks managing floating/docked window layout & persistence, throttled side-panel resizing, Component Canvas bidirectional sync & durable deletion/recovery, global keyboard shortcuts, Design Tokens / Auto-Layout / Component Contract actions, and Code Engine & Live Preview studio state.
  - `workspace/GlobalToolbar.tsx`, `workspace/ToolRail.tsx`, `workspace/LayersPanel.tsx`, `workspace/LayerPopovers.tsx`, `workspace/CanvasWindows.tsx`, `workspace/PagesRackPanel.tsx`, `workspace/ComponentRackPanel.tsx`, `workspace/TokensPanel.tsx`, `workspace/InspectorWebLayoutSection.tsx`, `workspace/InspectorComponentContractSection.tsx`, `workspace/CodeWorkspacePanel.tsx`, `workspace/LivePreviewPane.tsx`, `workspace/StatusBar.tsx`, `workspace/ComponentDeletionDialog.tsx`, `workspace/StudioIcon.tsx`: Focused, presentation-first workspace components keeping pure panels decoupled from canvas engine and store internals.
  - `InspectorPanel.tsx`, `ToolOptionsBar.tsx`, `ToolbarHintBar.tsx`, `TemplateLibraryPopover.tsx`, `KeyboardShortcutsModal.tsx`: Property inspector, context-sensitive tool/Pathfinder options bar, shortcut hint bar, template library popover, and searchable keyboard shortcuts cheat sheet modal.
  - `FloatingWindow.tsx`, `windowManager.ts`, `panelResize.ts`, `workspacePreferences.ts`, `modalFocus.ts`, `editorContext.ts`, `keyboardShortcuts.ts`: Window z-index layering, docked/floating geometry persistence, throttled resizable panels, focus trapping, shortcut catalog/filtering, and active workspace resolution.
  - `ComponentThumbnail.tsx`: Live SVG component thumbnails backed by `src/engines/canvas/artwork.tsx`.
- **Sync, persistence, clipboard & export orchestration:**
  - `componentCanvasSync.ts`: Bidirectional master component edit session, buffer protection, and CAS reconciliation between Main Canvas and Component Canvas.
  - `componentDeletion.ts`: Durable component deletion, recovery, and snapshot rollback orchestration.
  - `debouncedAutosave.ts`: Revision-fenced debounced IndexedDB autosave controller.
  - `projectFileActions.ts`, `projectExport.ts`, `visualExport.ts`, `nodeClipboard.ts`: Atomic `.flop` open/export (overlaying live Component Canvas edits without mutating canonical state), SVG/PNG visual export, and subtree clipboard copy/paste.

### `scripts/` & `tests/` — Quality, benchmarks & verification (Implemented)

- `scripts/studioBenchmark.ts` & `scripts/run-benchmark.mjs` (`npm run benchmark`): Reproducible performance benchmark measuring full scene render (`AST + Layers + SVG`), Hand pan (60 frames), Scrubby zoom (40 frames), single-node & 25-node drag (30 snap frames + Native Command commit/undo), and Pathfinder boolean operations (`unite`, `subtract`, `intersect`, `exclude`, compound 4-shape union) on multi-page realistic projects (`small`, `medium`, `large` up to 5 pages / 650 active-page nodes / 1,738 total nodes / 16 master components).
- `tests/`: Unit and integration Vitest suites (`npm run test:unit`) covering AST, document validation/migrations, layers, vector/planar boolean math, components/overrides/variants/slots/sync/deletion, web semantics/Auto-Layout/responsive breakpoints (`tests/webSemanticsAndLayout.test.ts`), design tokens & themes (`tests/designTokensAndComponentContract.test.ts`), workspace module pure logic & modularity boundaries (`tests/workspaceModules.test.ts`), P0.1–P0.3 tool & subsystem boundary contracts, P1.1 Native Command zero-bypass enforcement, P1.2 lockfile & benchmark checks, plus headless Chromium browser acceptance tests (`npm run test:browser`).

### Planned engines (Not yet implemented on disk)

The following engine directories from the target blueprint do **not** exist in `src/engines/` yet and remain planned for later milestones:

- `src/engines/prototype`: Node Logic authoring graph, ports, connections, state/API execution, and preview runtime.
- `src/engines/animation`: Timeline, tracks, keyframes, easing, and playback.
- `src/engines/history`: Scalable delta/command-log history engine (currently `CanonicalEditorStore` + `editorReducer` manage bounded immutable snapshot history).

## Core architectural flows

### 1. Unidirectional tool & geometry pipeline (P0.3)

```text
Pointer / Keyboard Input
  -> Studio Tool (src/engines/canvas/tools/*) [local gesture & preview state only]
  -> ToolOperation v1 Envelope (src/core/tools/operationContract.ts)
  -> Geometry Engine Gate (src/engines/canvas/geometryEngine.ts) [finite math, locks, no-op filter, sealed ValidatedToolOperation]
  -> Tool Operation Executor (src/app/toolOperationExecutor.ts)
  -> WorkspaceCommandClient (src/app/mainCanvasCommandClient.ts)
  -> Native Command Executor (src/app/nativeCommandExecutor.ts)
  -> CanonicalEditorStore (src/app/editorStore.ts) [revision++, NativeChangeEvent]
```

### 2. Native Command Engine & dual-workspace isolation (P1.1)

- **29 typed commands (`ALL_NATIVE_COMMAND_REGISTRY`):**
  - **14 frozen Phase 2 commands (`NATIVE_COMMAND_REGISTRY`):** `node.create`, `node.update`, `node.move`, `node.resize`, `node.rotate`, `node.delete`, `node.duplicate`, `node.reorder`, `node.group`, `node.ungroup`, `node.set-visibility`, `node.set-lock`, `document.update`, `page.update`.
  - **15 P1.1 commands (`EXTENDED_NATIVE_COMMAND_REGISTRY`):** `project.replace`, `page.create`, `page.set-active`, `component.create`, `component.sync-document`, `component.rename`, `component.delete`, `node.replace-many`, `node.split`, `node.update-many`, `node.edit`, `selection.set`, `history.commit-edit`, `history.undo`, `history.redo`.
- **Workspace isolation & concurrency:** Main Canvas (`workspace: 'main'`) and Component Canvas (`workspace: 'component'`) run independent `CanonicalEditorStore` instances. Master component sync uses expected revision / CAS checks (`COMPONENT_CONFLICT`), atomic transactions collapse multi-step operations into a single Undo entry, and failed transactions roll back completely.
- **Event & revision semantics:** Project-mutating commands increment `projectRevision` monotonically and emit immutable `NativeChangeEvent` payloads. Editor-only commands (`selection.set`, `history.commit-edit`) update editor state without bumping `projectRevision` or emitting project change events.

### 3. Native `.flop` v2 format, migration & persistence

```json
{
  "format": "folio-project",
  "formatVersion": 2,
  "appVersion": "0.1.0",
  "metadata": {
    "id": "project-id",
    "name": "Project name",
    "createdAt": "ISO-8601 timestamp",
    "updatedAt": "ISO-8601 timestamp"
  },
  "activePageId": "page-main",
  "pages": [
    {
      "id": "page-main",
      "name": "Main Page",
      "route": "/",
      "document": {
        "id": "document-id",
        "name": "Main Page",
        "width": 1440,
        "height": 900,
        "background": "#F5F2EC",
        "nodes": []
      }
    }
  ],
  "components": [],
  "logicGraphs": [],
  "assets": []
}
```

- **Migration & validation:** Version 1 files and IndexedDB records migrate via `migrateProjectV1ToV2` (wrapping the legacy document in `Main Page` at route `/` while retaining IDs and unknown extension fields). Version 2 validation verifies metadata, page/route uniqueness, active page, node hierarchy/styles, component documents, logic graphs, and assets.
- **Atomic IndexedDB & File Menu workflow:** `File -> Open Project` (`src/app/projectFileActions.ts`) validates/migrates the file and writes the project record plus the `app-state` active-project pointer in one IndexedDB read-write transaction before dispatching `project.replace`. The reserved `folio-component-canvas` workspace ID is never treated as a root project.
- **Immutable export:** `File -> Export Project` (`src/app/projectExport.ts`) overlays the live Component Canvas buffer onto the matching component definition in an immutable snapshot before validating and serializing `.flop` v2 JSON.

### 4. Workspace layering, preferences & shared SVG artwork

- **Z-index bands (`src/app/windowManager.ts`, `src/app/FloatingWindow.tsx`):** Workspace windows (`main-canvas`, `component-canvas`, `node-logic`) stay in `120..125`; overlay racks (`pages-rack-panel`, `component-rack-panel`) at `300`; toolbar/tool rail at `1200`; dropdown menus at `1400`; toast at `1500`; root-mounted layer popovers at `1600`; hydration overlay at `2000`; modal hosts at `10000`.
- **Local UI preferences (`src/app/workspacePreferences.ts`, `src/app/panelResize.ts`):** Window geometry, docked/floating mode, panel visibility, and resizable panel widths persist outside `.flop` files with schema validation, corrupt-storage recovery, and viewport clamping.
- **Shared SVG renderer (`src/engines/canvas/artwork.tsx`, `src/app/ComponentThumbnail.tsx`):** Single kebab-case SVG rendering pipeline with scoped `<mask id>` prefixes (`buildMaskElementId`) preventing DOM ID collisions across nested instances and thumbnails.

## Build, dependency & quality foundation (P1.2)

- **Reproducible dependency graph:** Direct runtime and dev dependencies in `package.json` are pinned to exact versions and locked by a canonical `lockfileVersion: 3` `package-lock.json` with SHA-512 integrity hashes (`packageManager: "npm@10.9.8"`, `engines.node: ">=22.12.0 <27"`). `.nvmrc`, GitHub Actions (`ci.yml`, `deploy.yml`), and `.devcontainer/devcontainer.json` are aligned on `npm ci`.
- **Verification commands:**
  - `npm run check`: Strict TypeScript check (`tsc --noEmit`) across `src`, `tests`, `scripts`, and `vite.config.ts`.
  - `npm run test:unit`: Fast Vitest unit/integration suite.
  - `npm run test:browser`: Chromium browser acceptance suites (`tests/*.browser.test.mjs`).
  - `npm test`: Complete Vitest suite (unit + browser).
  - `npm run benchmark`: Reproducible large-project rendering & interaction benchmark (`--scale=small|medium|large`, `--json`).
  - `npm run build`: Production Vite bundle (`dist/`).

## Roadmap stages & current status

1. **Foundation (Implemented & Verified):** Application shell, AST, SVG canvas, IndexedDB persistence, and `.flop` v2 file I/O.
2. **Canvas & studio tools (Implemented & Verified):** Dual-mode `PAGE` / `VECTOR` 26-tool registry, native cubic Bezier vector math, planar Pathfinder booleans, selection, resize, rotation, snapping, alignment, distribution, pan, zoom, and strict P0.3 unidirectional tool boundaries.
3. **Unified project v2 & Native Command Engine (Implemented & Verified):** Multi-page project aggregate, migrations, deterministic hydration, reusable master components/instances/overrides, dual-workspace sync, durable deletion, and 29-command zero-bypass Native Command Engine (P1.1).
4. **Long-term quality foundation (Implemented — P1.2):** Reproducible npm lockfile/CI configuration, automated rendering/interaction benchmark suite, and synchronized architecture documentation.
5. **Prototype / Node Logic (Planned):** Typed graph nodes, ports, connections, events, state, API requests, and runtime preview.
6. **Layout & Animation (Planned):** Auto-layout constraints engine, timeline, tracks, keyframes, easing, and playback.
7. **Visual-to-Code (Planned):** Deterministic HTML/CSS/React generation preserving Generated/Mapped/Custom/Extension code categories.
8. **Professional workflows (Planned):** Accessibility audits, profiling, plugins, collaboration, and scalable command history.
