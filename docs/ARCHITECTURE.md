# Folio Studio — Architecture

> **Document scope:** This document records the current repository architecture and implementation reality. For FOLIO product vision and long-term agreed architecture, read [FOLIO Architecture Blueprint](FOLIO_ARCHITECTURE_BLUEPRINT.md). Keep both documents aligned, but do not describe planned capabilities as implemented.

## Current implementation architecture

## Product direction

Folio is a browser-based visual web builder designed around a single native project and multiple independent workspaces. Its interaction model takes inspiration from DAWs: Main Canvas, Component Canvas, Component Rack, Pages Rack and Node Logic are views over project data, not independent project silos.

## Architectural rules

1. **The project AST is the source of truth.** Renderers, inspectors, reusable components, logic graphs, history and code generation consume or transform the same project aggregate.
2. **Project identity is separate from page identity.** A project owns many pages; each page owns one document and route.
3. **UI is not the domain model.** \`src/core\` must not import Preact or depend on browser view components.
4. **Engines are independent modules.** Canvas, layout, prototype, animation and code generation communicate through typed project/document data and commands.
5. **Persistence is replaceable.** IndexedDB is the current local adapter. \`.flop\` import/export serializes the complete project aggregate.
6. **Native files are versioned.** Every \`.flop\` file carries a format identifier and \`formatVersion\`. Schema changes require explicit migrations.
7. **Legacy split storage is not authoritative.** Pages, active page and component definitions live in the project aggregate. Workspace window layout may remain local UI preference state.

## Repository responsibilities

- \`src/app\`: application shell, editor state, canonical store, Native Command registry/executor, Main Canvas command client adapter (\`src/app/mainCanvasCommandClient.ts\`) and orchestration.
- \`src/core/commands\`: framework-independent Native Command v1 envelopes, Phase 2 command payloads/types and finite-budget runtime validation.
- \`src/core/document\`: framework-independent AST types, read-only \`NativeAstDocumentView\` facade (\`src/core/document/ast.ts\`), factories, active-page helpers, validation and migrations.
- \`src/core/persistence\`: IndexedDB and \`.flop\` file I/O adapters.
- \`src/engines/canvas\`: SVG renderer, selection and geometry behavior.
- \`src/engines/layout\`: future layout calculation and constraints.
- \`src/engines/prototype\`: future interaction graph and preview runtime.
- \`src/engines/animation\`: future timeline, tracks and keyframes.
- \`src/engines/history\`: future command batching and scalable history implementation. The first release currently keeps snapshot history in the app reducer.
- \`src/engines/codegen\`: future AST-to-HTML/CSS/JS compiler.
- \`tests\`: domain, command, migration, geometry, reducer, and local Chromium browser tests.

## Native \`.flop\` format — version 2

Version 2 is UTF-8 JSON. The project is the aggregate root; it contains the active page, all pages, reusable component definitions, reserved logic graph data and asset references.

\`\`\`json
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
\`\`\`

### Project aggregate contracts

- \`metadata\` identifies and versions the whole project.
- \`activePageId\` must resolve to a page in \`pages\`. Restore falls back to the first page if an imported v2 project has a stale active-page reference.
- Each \`FolioPage\` owns a unique route and a \`FolioDocument\`.
- Each \`ComponentDefinition\` owns a document and stable identity within the project.
- \`logicGraphs\` reserves typed nodes, connections and scope for the Node Logic milestone.
- \`assets\` reserves project-scoped references. Embedded/binary asset packaging is a future extension.

## Migration and persistence

- Version 1 files and IndexedDB records are accepted at migration boundaries.
- \`migrateProjectV1ToV2\` wraps the legacy single document in \`Main Page\` at route \`/\`, preserving document ID, dimensions, background and all nodes.
- Version 2 validation checks page/route identity, active page, component documents, graph references and asset references.
- IndexedDB keeps the existing project-store key path \`metadata.id\`; database version 2 adds a separate \`app-state\` store without rebuilding project records.
- The active root project ID is persisted separately from project metadata and .flop files. Saving an imported project and updating this pointer happen in one read-write transaction, so the pointer cannot commit without the project record.
- A missing or invalid active-project pointer falls back to the prior root-project selection by \`metadata.updatedAt\`. The reserved \`folio-component-canvas\` workspace is never considered a root project.
- The active document is always resolved explicitly from \`pages\` using \`activePageId\`, falling back to \`pages[0]\` when recovering a stale v2 reference.
- Autosave persists the canonical project aggregate. Native export validates and serializes an immutable snapshot, including the current Component Canvas buffer when a master component is open.

## Acceptance criteria for the unified project foundation

- A new project starts with \`Main Page\` at route \`/\`.
- Every page and component definition is stored inside the project aggregate.
- Switching pages changes \`activePageId\` without swapping project identity.
- Undoable page/component mutations update the aggregate.
- Version 1 project data migrates without losing document content.
- Version 2 import validates before replacing editor state.
- IndexedDB hydration completes before workspace controls can mutate project state.
- Type checking, unit tests and production build pass.

## Native .flop File Menu Workflow

- File → Open Project uses src/app/projectFileActions.ts and the existing readProjectFile adapter. After validation, the imported project and its active-project pointer are persisted atomically before editor replacement. Cancellation, failed import and failed persistence leave the previous active project untouched.
- The active-project pointer is held in IndexedDB app-state rather than project metadata or native files. Invalid pointers use the legacy updatedAt-based root-project fallback.
- The existing migration and validation functions remain the source of truth for supported v1/v2 formats. The v1 wrapper carries unknown top-level extension fields forward; document and node extension fields are retained by the existing migration copies.
- File → Export Project validates and serializes an immutable aggregate snapshot. While editing a master, the current Component Canvas document buffer is overlaid into the matching component definition before serialization; the canonical project is not mutated and the .flop v2 format is unchanged.
- replace-project creates a fresh editor state, clearing undo/redo and selection while retaining imported project metadata and stable IDs.

## Native Command Core Phase 2 & P1.1 Full Project Mutation Migration

- **Typed command contracts & runtime validation (`src/core/commands/types.ts`, `src/core/commands/validation.ts`):** Maintains the 14 frozen Phase 2 commands (`NATIVE_COMMAND_REGISTRY`) and extends the engine with 15 P1.1 commands (`EXTENDED_NATIVE_COMMAND_REGISTRY`, 29 total in `ALL_NATIVE_COMMAND_REGISTRY`): `project.replace`, `page.create`, `page.set-active`, `component.create`, `component.sync-document`, `component.rename`, `component.delete`, `node.replace-many`, `node.split`, `node.update-many`, `node.edit`, `selection.set`, `history.commit-edit`, `history.undo`, and `history.redo` — each with strict own-key allowlists and finite runtime validation budgets.
- **Closed static registry, atomic transactions & dual-workspace executor (`src/app/nativeCommandRegistry.ts`, `src/app/nativeCommandExecutor.ts`, `src/app/editorStore.ts`):** Resolves targets (`project`, `document`, `node`) through `createDocumentAstView` (`src/core/document/ast.ts`), enforces workspace isolation (`'main'` vs `'component'` `CanonicalEditorStore`), component CAS guards (`COMPONENT_CONFLICT`), effective lock/hierarchy preconditions, atomic multi-command transactions (`executeNativeCommandTransaction`) with single-step Undo collapse and full rollback on failure, and executor-authenticated rollbacks (`executeNativeSnapshotRollback`). Every project mutation increments `projectRevision` monotonically and publishes an immutable `NativeChangeEvent` across pages, components, and metadata; non-project commands (`selection.set`, `history.commit-edit`) update editor state without spurious revision bumps or project events.
- **Zero-bypass workspace clients (`src/app/mainCanvasCommandClient.ts`, `src/app/App.tsx`, `src/app/componentDeletion.ts`, `src/app/toolOperationExecutor.ts`):** Both Main Canvas (`createMainCanvasCommandClient`) and Component Canvas (`createComponentCanvasCommandClient`) route 100% of canvas, tool, Inspector, Layers, Page, Project, Component/Instance, durable deletion/rollback, and Undo/Redo operations through the Native Command Engine. Static enforcement in `tests/p11NativeCommandMigration.test.ts` guarantees zero `dispatchLegacyAction()`, `useReducer(editorReducer, ...)`, direct `editorReducer()`, or raw `commitEditorTransition()` bypasses anywhere in production `src/`.

## Workspace Window Management, Preferences & Shared SVG Artwork

- **Workspace layering & window management (`src/app/windowManager.ts`, `src/app/FloatingWindow.tsx`):** Workspace windows (`main-canvas`, `component-canvas`, `node-logic`) share a bounded z-index band (`120..125`), while overlay racks (`pages-rack-panel`, `component-rack-panel` at `300`), application toolbar / tool rail (`1200`), dropdown menus (`1400`), toast (`1500`), root-mounted layer popovers (`1600`), hydration overlay (`2000`), and modal hosts (`10000`) occupy strictly separated layers.
- **Local workspace preferences (`src/app/workspacePreferences.ts`):** Window geometry, docked/floating mode, and panel visibility persist in versioned local UI preference storage (outside `.flop` project files) with schema validation, legacy migration, corrupt-storage recovery, and small-viewport clamping.
- **Shared SVG artwork & mask pipeline (`src/engines/canvas/artwork.tsx`, `src/app/ComponentThumbnail.tsx`):** Main Canvas, Component Canvas, linked Component Instances, and Component Rack live SVG thumbnails share one Preact-safe kebab-case SVG renderer with scoped `<mask id>` prefixes (`buildMaskElementId`) so clipping masks render inside component instances and thumbnails without DOM ID collisions.

## Dual-Mode Studio Tool System & Native Vector Engine

- **Native Document Primitives (`src/core/document/types.ts`, `src/core/document/vector.ts`, `src/core/document/factory.ts`, `src/core/document/validation.ts`, `src/core/commands/validation.ts`):** Extended the unified `.flop` v2 document model with `FrameNode` (`type: 'frame'`, `clipContent`, `isSection`) and cubic Bezier `PathNode` (`type: 'path'`, anchor points with optional `handleIn`/`handleOut`, `pointType`, open/closed contours, compound `subpaths`, arrowheads, dash/cap/join styles) with full runtime validation and Native Command v1 compatibility.
- **Framework-Independent Vector Math & Pathfinder (`src/core/document/vector.ts`):** Implements deterministic SVG cubic Bezier serialization, bounding-box normalization, anchor/handle scaling, polygon/star/line generators, Catmull-Rom curvature fitting, Ramer-Douglas-Peucker freehand simplification, smooth brush relaxation, segment insertion, corner/smooth toggling, scissors path splitting, shape-to-path conversion (`rect`, rounded `rect`, `ellipse`, `frame`), horizontal/vertical flipping, and Illustrator-style Pathfinder booleans (`unite`, `subtract`, `intersect`, `exclude`).
- **Workspace-Aware Studio Tool Registry (`src/engines/canvas/tools/studioRegistry.ts`, `draw-tools.ts`, `vector-tools.ts`, `utility-tools.ts`, `select.ts`):** Registers 26 studio tools while keeping the Wave 1 `canvasToolRegistry` (`registry.ts`) intact for contract compatibility. Main Canvas operates in Studio Indigo **`PAGE`** mode (Figma-grade Selection `V`, Direct Selection `A`, Scale `K`, Lasso `Q`, Magic Wand `Y`, Frame `F`, Section `Shift+S`, Rectangle `R`, Ellipse `O`, Line `L`, Arrow `Shift+L`, Polygon `G`, Star `Shift+G`, Pen `P`, Pencil `N`, Text `T`, Eyedropper `I`, Precision Measure `M`, Hand `H`, Scrubby Zoom `Z`, corner rotation, and double-click inline text editing). Component Canvas shifts into Warm Craft Amber **`VECTOR`** mode (Adobe Illustrator Vector Craft Studio surfacing Pen `P`, Curvature `U`, Anchor Point `Shift+C`, Pencil `N`, Smooth `Shift+N`, Scissors `C`, Rotate `Shift+R`, Scale `K`, live anchor/Bezier handle overlays, and the dedicated Pathfinder & Vector Craft bar via `src/app/ToolOptionsBar.tsx`).
- **Strict Unidirectional Subsystem Boundary (`src/core/tools/operationContract.ts`, `src/engines/canvas/geometryEngine.ts`, `src/app/toolOperationExecutor.ts`):** Studio Tools own pointer/keyboard gestures and local preview state only, emitting versioned `folio.tool-operation` v1 envelopes (`ToolOperation`). Every commit flows one-way through the Geometry Engine validation gate (`evaluateToolOperation` / `evaluateToolOperationBatch`)—which validates finite geometry, locks, ID uniqueness, zero-delta no-ops, inline text, and eyedropper color updates and seals outputs with a runtime-private symbol (`ValidatedToolOperation`)—before reaching the Native Command Engine adapter (`createToolOperationExecutor` -> `WorkspaceCommandClient` for both Main Canvas and Component Canvas). UI panels (`ToolOptionsBar.tsx`, `InspectorPanel.tsx`) import only contract types from `src/core/tools/operationContract.ts`, and static import-graph tests (`tests/p03SubsystemBoundaries.test.ts`) enforce zero direct coupling between Studio Tools, UI panels, legacy reducers, and Native Engine internals.

## Planned stages

1. **Foundation:** application shell, AST, SVG canvas, local persistence and native file I/O.
2. **Canvas & layout:** pointer selection, drag, eight resize handles, multi-selection, snapping, alignment, distribution, pan, zoom and interaction hardening.
3. **Unified project v2:** multi-page project aggregate, component definitions, migrations, deterministic hydration and consolidated persistence.
4. **Reusable component system:** master definitions, linked instances, properties and overrides.
5. **Prototype / Node Logic:** typed graph nodes, ports, connections, events and runtime preview.
6. **Animation:** timeline, tracks, keyframes, easing and playback.
7. **Visual-to-Code:** deterministic HTML/CSS/React generation and route/logic compilation.
8. **Professional workflows:** accessibility, performance profiling, plugins, collaboration and version history.

Each stage must pass its acceptance tests before the next stage is considered complete.
