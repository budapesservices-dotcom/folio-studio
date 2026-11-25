# Folio Studio — Architecture

> **Document scope:** This document records the current repository architecture and implementation reality. For FOLIO product vision and long-term agreed architecture, read [FOLIO Architecture Blueprint](FOLIO_ARCHITECTURE_BLUEPRINT.md). Keep both documents aligned, and keep **Implemented** capabilities strictly distinct from **Planned** engines not yet present on disk.

## Product direction

Folio is a browser-based, visual-first full-stack web development studio designed around a single native project aggregate (`.flop` v2) and multiple independent workspaces. Main Canvas, Component Canvas, Node Logic, Code & Preview Studio, Component Rack, and Pages Rack are views over shared project data, never isolated project silos.

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
  - `components.ts`: Master component extraction (`buildComponentDefinitionFromNodes`), linked instance creation (`createComponentInstance`), instance detaching (`detachComponentInstance`), Variant Axes & Named Slots factories/pruning (`createComponentVariantAxis`, `createComponentSlot`, `pruneComponentContractForDocument`), and deterministic override resolution (`Master -> Variants -> Slots -> Local Overrides -> Tokens`) with overridden token-binding stripping so Canvas, Component Preview, HTML/CSS, and React compilers stay identical.
  - `tokens.ts`: Project-level Design Tokens & Themes (`createDefaultDesignTokens`, `resolveDesignTokenValue` with cycle/type-mismatch/bounds detection, CSS injection-safe color validation `isSafeCssColorValue`, `validateDesignTokenCollection`, `validateNodeTokenBindings`, `resolveNodeWithTokens`, `findTokenUsages`, `generateDesignTokensCss`).
  - `vector.ts`: Deterministic SVG cubic Bezier serialization, bounding-box normalization, anchor/handle scaling, polygon/star/line generators, Catmull-Rom curvature fitting, Ramer-Douglas-Peucker simplification, smooth brush relaxation, segment insertion, corner/smooth toggling, scissors splitting, shape-to-path conversion, flipping, and Pathfinder entry points (`applyPathfinderOperation`).
  - `src/core/document/planarBoolean.ts`: Planar polygon/curve subdivision and boolean solver backing Illustrator-style Pathfinder operations (`unite`, `subtract`, `intersect`, `exclude`), Shape Builder regions, and Paint Bucket closed-region detection (`buildPlanarFacesFromSegments`).
  - `vectorDrawing.ts`: 100% vector-native drawing engine (stabilized simplified Vector Brush presets, planar-boolean/segment-splitting Vector Eraser, and Paint Bucket live fill with gap-closing smart region detection), dynamically code-split into the lazy `vector-drawing-engine` Vite chunk.
  - `validation.ts`: Runtime `.flop` v1 and v2 schema, hierarchy, node, web layout/semantics, design tokens (including token-to-node relationship validation across all pages and component masters), component variants/slots, logic graph, and asset validation, plus deeply-frozen WeakSet/WeakMap incremental fast-path (`freezeImmutableGraph`, `isDeeplyFrozenGraph`, `validateProjectIncremental`) that skips re-validating untouched immutable pages/components while preserving 100% full validation on unfrozen or mutated subtrees.
  - `networkSecrets.ts`: Single source of truth for network credential validation and hard-gate sanitization (`SENSITIVE_HEADER_NAMES`, `isSafeSecretRef`, `isSafeHeaderPlaceholder`, `containsRawSecretPattern`, `sanitizeGlobalHeadersForPersistence`, `sanitizeProjectNetworkSecrets`, `sanitizeLogicGraphNetworkSecrets`, `sanitizeLogicNodeDataRecord`, `sanitizeUrlCredentials`). Enforces case-insensitive blocking/stripping of sensitive headers (`authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `x-auth-token`, `cookie`, `set-cookie`) and raw token/credential patterns (`Bearer`, `Basic`, `Token`, JWT `eyJ...`, `sk-...`, `pk_live_...`, `gh*_...`, `AIza...`, `xox*-...`, `AKIA...`, `glpat-...`, `npm_...`, `hf_...`, PEM private keys, embedded `user:pass@` URL credentials, malformed non-JSON fail-closed clearing) unless using an explicit safe placeholder (`env:VAR_NAME`, `{{VAR_NAME}}`). Applied centrally across semantic validation, `.flop` v2 serialization, legacy migration, IndexedDB persistence, Live Preview payload generation, and HTML/CSS/React/ZIP code export.
  - `migrations.ts`: Deterministic `migrateProjectV1ToV2` upgrade path preserving IDs, document content, and unknown extension fields while sanitizing legacy network credentials.
  - `equality.ts`: Structural equality checks for documents and projects.
- **`src/core/kernels/`**
  - `types.ts`, `spatialIndex.ts`, `index.ts`: Pluggable, WASM-ready Compute Kernel Ports (`SpatialIndexKernel`, `VectorGeometryKernel`, `LayoutComputeKernel`, `getComputeKernels`, `registerComputeKernel`, `resetComputeKernels`) backed by optimized pure-TypeScript defaults including `FlatGridSpatialIndex` (flat `Float64Array` AABB buffer + cell grid hash + oversized fallback) for viewport culling and snap-candidate queries.
- **`src/core/commands/`**
  - `types.ts`: Native Command v1 envelope, 14 frozen Phase 2 commands (`NATIVE_COMMAND_REGISTRY`), 28 P1.1+ extended commands (`EXTENDED_NATIVE_COMMAND_REGISTRY`, including `tokens.update`, `component.update-contract`, `code.update-modules`, `asset.upsert`, `logic.create-graph` / `logic.update-graph` / `logic.delete-graph`, `animation.create-clip` / `animation.update-clip` / `animation.delete-clip`, and `selection.deselect` / `selection.invert` / `selection.select-similar`, **42 total** in `ALL_NATIVE_COMMAND_REGISTRY`), target descriptors, result/error unions, and `NativeChangeEvent` contracts.
  - `validation.ts`: Closed own-key allowlist and finite-budget runtime validation for all Native Commands.
- **`src/core/tools/`**
  - `operationContract.ts`: Versioned `folio.tool-operation` v1 `ToolOperation` contract, `ToolOperationBatch`, `ToolOptionsChange`, `ToolFeedbackMessage`, `ValidatedToolOperation` sealed boundary types, and `extractToolOperationsFromTransition`.
- **`src/core/persistence/`**
  - `indexedDb.ts`: IndexedDB v2 persistence (`projects` store keyed by `metadata.id` plus `app-state` store for active-project pointer), revision-fenced saves (`saveProjectIfRevisionCurrent`), atomic import+activation (`saveProjectAndActivate`), per-project write locks (`withProjectWriteLock`), and mandatory network-secret hard-gate sanitization (`sanitizeProjectNetworkSecrets`) before write.
  - `projectFile.ts`: `.flop` UTF-8 JSON v2 file reading, parsing, validation/migration, and download serialization with mandatory network-secret hard-gate sanitization (`serializeProjectToFlopJson`). Note: `.flop` is currently a versioned UTF-8 JSON v2 file, not an archive/ZIP container.

### `src/engines/canvas` — Canvas renderer, geometry engine & studio tools (Implemented)

- `Canvas.tsx`: Interactive SVG viewport for both Main Canvas (`PAGE` mode) and Component Canvas (`VECTOR` mode), pointer/keyboard event routing, inline text editing, spatial viewport culling (`CANVAS_VIEWPORT_CULL_THRESHOLD = 250`), and tool-session orchestration.
- `CanvasSceneLayer.tsx`: Memoized static SVG scene layer (`<defs>`, artboard background, and `<MaskedNodeArtwork>` list) decoupled from high-frequency pointer/marquee/snapping overlays.
- `CanvasOverlays.tsx`: Interactive selection boxes, resize/rotation/smart/Bezier anchor handles, hover redlines, Shape Builder face overlays, eyedropper loupe, and snap guides.
- `canvasHelpers.ts`: Pointer-event normalization (`buildCanvasPointerInput`), SVG coordinate mapping (`toCanvasPoint`), spatial index construction (`buildSpatialIndexForNodes`), overscanned viewport rect computation, and dependency-preserving viewport culling (`cullVisibleRenderNodes`).
- `artwork.tsx`: Shared Preact-safe kebab-case SVG node renderer with scoped `<mask id>` generation (`buildMaskElementId`) reused across Main Canvas, Component Canvas, Component Instances, and Component Rack thumbnails.
- `canvas.css`: Canvas viewport, guide, handle, and overlay styling.
- `geometry.ts`: Bounding boxes, snapping, alignment (`alignNodes`), distribution (`distributeNodes`), hit-testing, and coordinate transforms.
- `geometryEngine.ts`: Mandatory validation and calculation gate (`evaluateToolOperation`, `evaluateToolOperationBatch`) between Studio Tools and the Native Command Engine. Enforces finite geometry, lock checks, ID uniqueness, zero-delta no-op filtering, inline text/eyedropper sanitization, and runtime-private symbol sealing (`ValidatedToolOperation`).
- `tools/` (15 modules):
  - `types.ts`: Tool context, pointer/keyboard input, transition, options, and preview state contracts.
  - `registry.ts`: Wave 1 `canvasToolRegistry` (preserved for contract compatibility).
  - `studioRegistry.ts`: Workspace-aware 29-tool registry supporting Main Canvas (`PAGE` mode) and Component Canvas (`VECTOR` mode) groups and shortcuts.
  - `select.ts`: Selection, multi-selection, marquee, drag with snapping, 8-handle resize, rotation, and Direct Selection (`A`).
  - `draw-tools.ts`: Frame (`F`), Section (`Shift+S`), Rectangle (`R`), Ellipse (`O`), Line (`L`), Arrow (`Shift+L`), Polygon (`G`), Star (`Shift+G`), and Text (`T`).
  - `drawing-tools.ts` & `vectorDrawingLoader.ts`: 100% Vector-Native Brush (`B`), Vector Eraser (`E`), and Paint Bucket (`J`) tools backed by lazy-loaded `vectorDrawing.ts`.
  - `vector-tools.ts`: Pen (`P`), Curvature (`U`), Anchor Point (`Shift+C`), Pencil (`N`), Smooth (`Shift+N`), and Scissors (`C`).
  - `utility-tools.ts`: Scale (`K`), Rotate (`Shift+R`), alpha-aware Eyedropper (`I`) with magnifier loupe, and Precision Measure (`M`).
  - `hand.ts`, `scrubby-zoom.ts`, `lasso-selection.ts`, `magic-wand.ts`, `shape-builder.ts`, and `geometry.ts` (tool-local geometry helpers).

### `src/engines/layout` — Deterministic Auto-Layout & Responsive Solver (Implemented)

- `autoLayout.ts`: Pure framework-independent Flex (`row`/`column`, `wrap`, `justifyContent`, `alignItems`, `gap`, `padding`, `fixed`/`hug`/`fill` child sizing) and Grid (`gridColumns`, `columnGap`, `rowGap`) solver, Desktop -> Tablet (`768px`) -> Mobile (`390px`) responsive override inheritance (`resolveEffectiveNodeForBreakpoint`), non-destructive preview computation (`computeAutoLayoutNodes`), and canonical AST commit helper (`applyAutoLayoutToNodes`).

### `src/engines/codegen` — Deterministic Code Engine & Live Preview (Implemented)

- `types.ts`, `sanitize.ts`: Strict HTML/attribute escaping, URL protocol allowlist (`http:`, `https:`, `mailto:`, `/`, `#` — rejecting `javascript:`/`data:`/`vbscript:`), CSS/JS breakout neutralization, and traceable `CodeMappingEntry` contracts.
- `htmlCssCompiler.ts`: Deterministic AST-to-Semantic HTML5, Auto-Layout Flex/Grid CSS, Design Token `var(--token)` bindings, `@media (max-width: 768px)` / `(max-width: 390px)` responsive rules, nested `component-instance` hierarchy with proportional scaling wrappers, inline vector `<svg>`, and sandboxed Live Preview document assembly (`buildLivePreviewHtml`) with strict `Content-Security-Policy` (`LIVE_PREVIEW_CSP`) and CSS/JS comment-breakout neutralization. Shared CSS declaration helpers (`buildNodeCssDeclarations`, `buildChildrenMap`, `resolveTokenCssVar`) are reused by `reactCompiler.ts`.
- `reactCompiler.ts`: Compiles Master Components into typed React + TypeScript JSX (`src/components/*.tsx`) paired with dedicated stylesheets (`src/components/*.css`) containing base layout/typography/token `var()` rules and `[data-variant-*]` override selectors, enforcing canonical precedence (`Master -> Variants -> Slots -> Local Overrides -> Tokens`), slot visibility/fill/content props, nested hierarchies, inline JSX `<svg>`, deterministic identifier deduplication, and multi-page bundles (`src/pages/*.tsx`, `src/styles/*.css`, `src/styles/tokens.css`, `src/App.tsx`).
- `mappedSync.ts`, `index.ts`: Explicit 4-category code classification (`generated`, `mapped`, `custom`, `extension`), safe Code → AST mapped synchronization (`applyMappedNodeEdit`) with honest capability reporting, and Custom/Extension module preservation inside `.flop` v2 `codeModules`.
- `zipArchive.ts`: Zero-dependency deterministic PKZIP 2.0 Store-mode archive builder/parser (`buildZipArchive`, `parseZipArchive`, `computeCrc32`, `normalizeArchiveEntryPath`) with UTF-8 flag (`0x0800`), fixed DOS timestamps, and strict path traversal / duplicate entry rejection.
- `projectBundle.ts`: Runnable multi-file project scaffolder (`buildCompiledProjectBundle`) packaging all compiled pages/styles/components plus Custom/Extension `codeModules` into either a Vite + React + TypeScript scaffold (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `README.md`) or a static HTML/CSS site bundle (`index.html`, `README.md`) for 1-click **`Export ZIP`** download.
- `a11yAudit.ts`: Built-in WCAG 2.1 AA contrast & semantic HTML audit engine (`parseCssColorToRgba`, `computeContrastRatio`, `suggestAccessibleForegroundColor`, `applyA11yQuickFixToNode`, `auditPageAccessibility`) checking normal (`4.5:1`) and large (`3.0:1`) text contrast against resolved parent/painted backdrop + Design Tokens, heading hierarchy (`MISSING_H1`, `MULTIPLE_H1`, `SKIPPED_HEADING_LEVEL`), interactive `<button>`/`<a>` accessible names, safe `href` protocols, and empty visible text nodes. Surfaced inside Code & Preview Studio's collapsible Accessibility Audit drawer with 1-click **Focus**, per-issue **Fix**, and atomic 1-step Undo **`Fix All`** transactions through the Native Command Engine.

### `src/engines/diagnostics` — Studio Scene Profiler & Project Health (Implemented — Stage 9)

- `studioProfiler.ts`: Pure framework-independent structural health analyzer (`analyzeProjectHealth`) and on-demand micro-profiler (`runLiveSceneProfile`) computing active/total layer counts, node-type distribution, max hierarchy nesting depth, cross-studio health checks (`.flop v2` incremental schema validation, WCAG 2.1 AA score, Node Logic semantic validation, Motion keyframe target integrity, Canvas spatial culling status), and real wall-clock timings (`ms`) across 8 runtime stages (`AST Document View`, `Layer Tree Derivation`, `Auto-Layout Solver`, `FlatGrid Spatial Index`, `WCAG 2.1 AA Audit`, `HTML / CSS Compiler`, `React TSX Compiler`, `Incremental Project Validation`). Surfaced via lazy-loaded `src/app/workspace/DiagnosticsModal.tsx` (`Help -> Scene Profiler & Health`).

### `src/engines/history` — Structural Delta History Engine (Implemented)

- `deltaHistory.ts`, `index.ts`: O(changed nodes) structural diff/apply history engine (`computeProjectDelta`, `applyProjectDelta`, `isProjectDeltaEntry`, `createDeltaHistoryTimeline`, `pushProjectDelta`, `commitDeltaCoalesceGroup`, `undoProjectDelta`, `redoProjectDelta`, `countDeltaTouchedNodes`) tracking pages, components, tokens, code modules, logic graphs, and animation clips across 200-step Undo/Redo timelines (`DEFAULT_DELTA_HISTORY_LIMIT = 200`) and coalescing without duplicating untouched pages/components. Wired directly into production `editorReducer.ts`, `editorStore.ts`, and `nativeCommandExecutor.ts`.

### `src/engines/prototype` — Node Logic Engine, Component-Scoped Execution, Scoped Pipeline & Smart Logic Frames (`Verified` locally; network/timer caveats below)

- `catalog.ts`: Framework-independent **31 primary node** catalog organized across **7 categories** (`sources`: 3, `events`: 8, `state`: 3, `logic`: 5, `actions`: 6, `flow`: 3, `network`: 3) plus **13 hidden deprecated legacy v1 nodes** retained strictly for `.flop` v2 backward compatibility (paired with lossless `migrateLegacyLogicNode` migration and 1-click inspector upgrade). Enforces a strict **2-wire contract** (`LogicWireKind = 'execution' | 'data'`, `getLogicWireKind`, `areLogicPortTypesCompatible`) — layer/component bindings remain **Target References** (`targetNodeId` or `targetMode: 'pipeline'` / `Inherit from Pipeline`), never a third wire kind.
- `componentScope.ts`: Per-instance expansion engine for `scope: 'component'` graphs (`resolveApplicableGraphsForPage`, `collectPageComponentInstances`, `COMPONENT_INSTANCE_NODE_SEP = '__'`). Expands component-scoped graphs dynamically at runtime/compile time (never written back into `.flop` JSON) for every active page `ComponentInstanceNode` whose master has `nodeLogicEnabled: true` (including nested instances). Remaps internal layer targets to `<instanceId>__<localNodeId>`, scopes local component variables to `<instanceId>::<variableId>` while sharing global variables, preserves canonical precedence (`Master -> Variants -> Slots -> Local Overrides -> Tokens`), and injects `instanceId` into private memory keys (`<instanceId>:<frameId>:<nodeId>:<originLayerId>`).
- `pipeline.ts`: Scoped Data Pipeline (`PipelineContext`) accumulating lightweight `origin` layer/group/component-instance references (`layerId`, `instanceId`, `children`, `animationIds`) and per-step upstream outputs along a wire path without cross-branch leakage, plus node-owned / target-bound private memory (`privateState`) so local interactions like `state.toggle` and `once` guards stay isolated per target and per component instance.
- `frames.ts`: Smart Logic Frames & Function Baking (`bakeLogicFrame`, `unbakeLogicFrame`, `validateFrameBakeable`, `instantiateLogicFramePreset`, `createLogicFramePresetFromFrame`) compiling sub-graphs into self-contained baked blocks with detected `exposedInputs`/`exposedOutputs`, pre-computed topological `compiledPlan`, and user-pinned `exposedParams` persisted inside `.flop` v2 `LogicGraph.frames`.
- `networkSecrets.ts`: Re-exports canonical `src/core/document/networkSecrets.ts` validators/sanitizers (`authSecretRef` + `globalHeaders` hard-gate) and provides an in-memory session-only store (`setSessionNetworkTestToken` / `getSessionNetworkTestToken`) for temporary local testing tokens that are cleared on page reload and never written to `.flop`, IndexedDB, Live Preview, or Code Export.
- `validator.ts`: Semantic graph validator (`validateLogicGraphSemantics`, `validateProjectLogicGraphs`, `auditOrphanLogicReferences`, `pruneLogicGraphsForDeletedComponent`) enforcing port compatibility, acyclic dataflow DAGs, AST/variant/theme/route/animation-clip cross-checks (`MISSING_ANIMATION_CLIP`, component-scoped self/pipeline `action.set-variant` validation, `COMPONENT_NOT_ENABLED_FOR_LOGIC`), CSS/URL injection guards, network credential hygiene (`UNSAFE_AUTH_SECRET_REF`, `HARDCODED_SECRET_HEADER`), honest unsupported-metadata warnings (`UNSUPPORTED_VARIABLE_PERSIST`, `UNSUPPORTED_COMPUTED_VARIABLE`), and non-fatal `UNSUPPORTED_NODE_TYPE` warnings preserving unknown/future `.flop` v2 nodes.
- `runtime.ts`: Deterministic, zero-DOM, zero-`eval` headless `PrototypeRuntime` (`createPrototypeRuntime`, `interpolateLogicTemplate`) with finite step budgets (`MAX_LOGIC_EXECUTION_STEPS = 256`), component-scoped instance isolation, Scoped Data Pipeline propagation, private per-instance+frame+target memory, baked frame execution, `urlParams` / `keyCombo` simulation, typed state transitions, visual/variant overrides, route/theme state, `playedAnimations`, and execution traces.
- `parity.ts`: Single canonical shared compiler payload (`compilePageLogicRuntimeConfig`, `discoverDynamicReactTargets`, `sanitizeNodeDataForRuntime`) consumed by Headless `PrototypeRuntime`, Live Preview, and React TSX Codegen, paired with two explicit machine-tested capability matrices:
  - **`NODE_RUNTIME_PARITY_MATRIX` (31 primary nodes):**
    - **26 nodes `full` across all 3 runtimes (Headless, Live Preview, React TSX):** `source.element`, `source.context`, all 8 `event.*` nodes, all 3 `state.*` nodes, all 5 `logic.*` nodes, all 6 `action.*` nodes, `flow.control`, and `network.json`.
    - **2 nodes `full` in Live Preview / `simulated` in Headless & React TSX:** `flow.delay` (real `setTimeout` in Live Preview; synchronous deterministic pass-through in Headless & React TSX) and `flow.loop-timer` (`for-each` full in all 3; interval timer real in Live Preview, single-tick deterministic in Headless & React TSX).
    - **3 nodes `simulated` across all 3 runtimes:** `source.external`, `network.http`, and `network.socket` (deterministic structured payloads with zero persisted secrets; no live backend execution).
  - **`RUNTIME_FEATURE_PARITY_MATRIX`:**
    - **`full` across all 3 runtimes:** `component.scoped-logic`, `pipeline.scoped-context`, `frame.baked`, `legacy.v1-migration`.
    - **`unsupported` across all 3 runtimes:** `variable.persist` (metadata-only; browser storage blocked in sandboxed `<iframe sandbox="allow-scripts">` Live Preview and inactive at runtime) and `variable.computed` (metadata-only; runtime expression evaluation inactive under FOLIO's zero-`eval` security policy). Both emit validator warnings and are labeled *"Metadata only"* in the Inspector.
- `codegen.ts`, `index.ts`: Live Preview sandbox-safe micro-runtime compiler (`buildLivePreviewLogicScript` — zero `eval`, zero `innerHTML`, `</script` escape, zero embedded secrets, component-scoped `action.set-variant` with canonical precedence + clean revert, full 31-node + Baked Frame + Scoped Pipeline execution) and React Compiler hook/handler planner (`buildReactPageLogicPlan` emitting strict-TypeScript `useState`/`useRef`/`useEffect` hooks with synchronous ref-backed state avoiding stale closures, component-scoped instance isolation + nested variant prop forwarding, `click-outside` / `input` / `drag` / `scroll-view` / `key-down`+`key-up` modifiers / `resize` / `page-load` wiring, dynamic `visible`/`text`/`fill`/`opacity`/`transform`/`imageUrl`/`disabled`/`transition`/`variant` overrides, safe zero-`dangerouslySetInnerHTML` toast stack, `SAFE_HREF` navigation/image guards, theme switching, and animation triggers).

### `src/engines/animation` — Motion & Animation Engine (Implemented — Stage 8)

- `easing.ts`: Analytical easing evaluator (`evaluateEasing`) supporting `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` (cubic-Bezier Newton-Raphson solver), and normalized underdamped `spring` curves, plus deterministic CSS timing-function emitter (`toCssTimingFunction`).
- `evaluator.ts`: Pure keyframe track & clip interpolator (`evaluateTrackAtTime`, `evaluateClipAtTime`, `interpolateHexColor`) across `x`, `y`, `opacity`, `rotation`, `scale`, and `fill`, non-destructive Main Canvas pose overlay (`applyAnimatedPosesToDocument`), immutable clip/track/keyframe CRUD helpers, 3 built-in motion presets (`Hero Entrance`, `Orbit Float`, `Pulse Glow`), and starter page `Hero Entrance` clip factory (`createStarterHeroEntranceClip`).
- `codegen.ts`, `index.ts`: Deterministic CSS `@keyframes` compiler (`compilePageAnimationsCss`) emitting `[data-folio-id="..."]` animation rules, autoplay & Node Logic trigger classes (`getClipCssClassName`, `buildLivePreviewAnimationPayload`), and mandatory `@media (prefers-reduced-motion: reduce)` guards automatically propagated into compiled HTML/CSS, React stylesheets, and Live Preview.

### `src/app` — Application shell, command orchestration & workspace UI (Implemented)

- **State & Native Command Engine:**
  - `editorStore.ts`: `CanonicalEditorStore` for `'main'` and `'component'` workspaces with deep-frozen state snapshots, monotonic `projectRevision`, `ProjectDelta` history validation & 200-entry bounds (`EDITOR_HISTORY_LIMIT`), and `NativeChangeEvent` publication.
  - `editorReducer.ts`: Internal pure state transition implementation invoked exclusively by `nativeCommandExecutor.ts` (no direct production bypasses), storing compact O(changed nodes) `ProjectDelta[]` stacks in `past`/`future` with baseline-rebased coalescing.
  - `nativeCommandRegistry.ts`: Closed static handler registry mapping all **42 commands** across project, page, document, node, component, design token, code module (with optional `coalesceKey` Undo grouping for editor typing), asset upsert, logic graph, animation clip, selection, and history scopes.
  - `nativeCommandExecutor.ts`: Validates commands, resolves targets through `createDocumentAstView`, enforces workspace isolation, component CAS guards (`COMPONENT_CONFLICT`), lock/hierarchy preconditions, atomic multi-command transactions (`executeNativeCommandTransaction`) collapsing multi-step edits into one atomic `ProjectDelta`, and executor-authenticated rollbacks (`executeNativeSnapshotRollback`).
  - `mainCanvasCommandClient.ts`: Typed `WorkspaceCommandClient` adapters (`createMainCanvasCommandClient`, `createComponentCanvasCommandClient`) exposing 100% Native Command Engine dispatch for both workspaces.
  - `toolOperationExecutor.ts`: Consumes sealed `ValidatedToolOperation` items from `geometryEngine.ts` and dispatches them through `WorkspaceCommandClient`.
- **Workspace shell, hooks & modular panels (`src/app/workspace/`):**
  - `App.tsx`: Lean top-level workspace orchestrator (< 1,200 lines) composing controller hooks, Native Command clients, lazy-loaded feature bundles (`LazyCodeWorkspace`, `NodeLogicWorkspace`, `TokensPanel`, `MotionTimelinePanel`, `DiagnosticsModal`, `KeyboardShortcutsModal`, `TemplateLibraryPopover`, dynamic `templates.ts` and `visualExport.ts`), and modular workspace UI components, bootstrapping fresh workspaces via `createInteractiveStarterProject`.
  - `workspace/layerOperations.ts`, `workspace/canvasViewState.ts`, `workspace/globalMenuActions.ts`, `workspace/nodeLogicGraphHelpers.ts`, `workspace/quickInteractions.ts`: Pure domain-adjacent helpers for layer rename/collision rules, drag-drop hit placement, context-menu capability derivation, subtree multi-selection, clamped popover coordinates, canvas zoom/view state parsing, active export target resolution, canonical 6-menu action wiring (`File`, `Edit`, `View`, `Tools`, `Option`, `Help`), Node Logic graph geometry/Bezier wiring/cycle checks/starter & preset builders, and **Quick Interaction Management** (`quickInteractions.ts`: bidirectional Inspector ↔ Node Logic flow derivation, creation, editing, and deletion for `on-click`/`on-hover`/`on-submit` triggers and `visibility`/`navigate`/`set-variant`/`set-layer-property`/`show-toast` actions routed strictly through `logic.create-graph` / `logic.update-graph` Native Commands with Undo/Redo and jump-to-graph focus).
  - `workspace/useWorkspaceWindows.ts`, `workspace/useWorkspaceChromeEffects.ts`, `workspace/usePanelResizeController.ts`, `workspace/useComponentMasterLifecycle.ts`, `workspace/useWorkspaceShortcuts.ts`, `workspace/useLayerPanelController.ts`, `workspace/useSelectionAndVectorActions.ts`, `workspace/useProjectFileLifecycle.ts`, `workspace/usePageAndTemplateActions.ts`, `workspace/useDesignSystemActions.ts`, `workspace/useCodeWorkspace.ts`: Cohesive workspace hooks managing floating/docked window layout & persistence, chrome lifecycle effects (toast timers, outside-click/Escape menu & tool-rack dismissal, viewport resize recovery, shortcuts modal focus trapping), throttled side-panel resizing, Component Canvas bidirectional sync & durable deletion/recovery, global keyboard shortcuts, layer panel interactions, selection/vector/clipboard commands, project hydration/autosave/export, page/template/component insertion, Design Tokens / Auto-Layout / Component Contract actions, and Code Engine, Accessibility Audit, multi-file ZIP Export & Live Preview studio state (including direct `Test in Live Preview` targeting).
  - `workspace/GlobalToolbar.tsx`, `workspace/ToolRail.tsx`, `workspace/LayersPanel.tsx`, `workspace/LayerPopovers.tsx`, `workspace/CanvasWindows.tsx`, `workspace/NodeLogicWorkspace.tsx`, `workspace/NodeLogicInspector.tsx`, `workspace/InspectorInteractionsSection.tsx`, `workspace/PagesRackPanel.tsx`, `workspace/ComponentRackPanel.tsx`, `workspace/TokensPanel.tsx`, `workspace/InspectorWebLayoutSection.tsx`, `workspace/InspectorComponentContractSection.tsx`, `workspace/LazyCodeWorkspace.tsx`, `workspace/CodeWorkspacePanel.tsx`, `workspace/LivePreviewPane.tsx`, `workspace/StatusBar.tsx`, `workspace/ComponentDeletionDialog.tsx`, `workspace/StudioIcon.tsx`: Focused, presentation-first workspace components keeping pure panels decoupled from canvas engine and store internals, including the complete 6-menu Application Menu Bar (`File`, `Edit`, `View`, `Tools`, `Option`, `Help`), Inspector Quick Interactions (`InspectorInteractionsSection.tsx` bridged directly to Node Logic graphs via Native Commands), and the lazy-loaded Visual Node Logic Graph Editor (`NodeLogicWorkspace` + 4-tab `NodeLogicInspector`).
  - `InspectorPanel.tsx`, `ToolOptionsBar.tsx`, `ToolbarHintBar.tsx`, `TemplateLibraryPopover.tsx`, `KeyboardShortcutsModal.tsx`: Property inspector, context-sensitive tool/Pathfinder options bar, shortcut hint bar, lazy-loaded template library popover, and lazy-loaded searchable keyboard shortcuts cheat sheet modal.
  - `FloatingWindow.tsx`, `windowManager.ts`, `panelResize.ts`, `workspacePreferences.ts`, `modalFocus.ts`, `editorContext.ts`, `keyboardShortcuts.ts`: Window z-index layering, docked/floating geometry persistence, throttled resizable panels, focus trapping, shortcut catalog/filtering, and active workspace resolution.
  - `ComponentThumbnail.tsx`: Live SVG component thumbnails backed by `src/engines/canvas/artwork.tsx`.
- **Sync, persistence, clipboard & export orchestration:**
  - `componentCanvasSync.ts`: Bidirectional master component edit session, buffer protection, and CAS reconciliation between Main Canvas and Component Canvas.
  - `componentDeletion.ts`: Durable component deletion, recovery, and snapshot rollback orchestration.
  - `debouncedAutosave.ts`: Revision-fenced debounced IndexedDB autosave controller.
  - `projectFileActions.ts`, `projectExport.ts`, `visualExport.ts`, `nodeClipboard.ts`: Atomic `.flop` open/export (25 MB size guard + prototype-safe JSON reviver, overlaying live Component Canvas edits without mutating canonical state), dynamically imported SVG/PNG visual export (with `computeAutoLayoutNodes`, Design Token + active theme resolution, active breakpoint width, and cyclic component recursion guard), multi-tab `navigator.locks` + `BroadcastChannel` sync & `QuotaExceededError` recovery notices, and subtree clipboard copy/paste.

### `scripts/` & `tests/` — Quality, benchmarks & verification (Implemented)

- `scripts/studioBenchmark.ts` & `scripts/run-benchmark.mjs` (`npm run benchmark`): Reproducible performance benchmark measuring full scene render (`AST + Layers + SVG`), Hand pan (60 frames), Scrubby zoom (40 frames), single-node & 25-node drag (30 snap frames + Native Command commit/undo), Pathfinder boolean operations (`unite`, `subtract`, `intersect`, `exclude`, compound 4-shape union), spatial viewport-culling + snap queries, and structural Delta History round-trips on multi-page realistic projects (`small`, `medium`, `large`, `xlarge` up to 5 pages / 1,500 active-page nodes / 16 master components).
- `tests/`: Unit and integration Vitest suites (`npm run test:unit`) covering AST, document validation/migrations, incremental validation equivalence (`tests/incrementalValidation.test.ts`), Delta History timelines (`tests/deltaHistory.test.ts`), Compute Kernel Ports & spatial culling (`tests/computeKernels.test.ts`), layers, vector/planar boolean math, components/overrides/variants/slots/sync/deletion, web semantics/Auto-Layout/responsive breakpoints (`tests/webSemanticsAndLayout.test.ts`), design tokens & themes (`tests/designTokensAndComponentContract.test.ts`), workspace module pure logic & modularity boundaries (`tests/workspaceModules.test.ts`), P0.1–P0.3 tool & subsystem boundary contracts, P1.1 Native Command zero-bypass enforcement, P1.2 lockfile & benchmark checks, plus headless Chromium browser acceptance tests (`npm run test:browser`).

### Planned & Open capabilities (Not implemented on disk)

The following capabilities from the target blueprint are **not yet implemented** and must not be claimed as complete:

- **Multi-Application projects & application-scoped Local Components** (`Agreed (Roadmap)`): Current `.flop` v2 projects support multiple `FolioPage` documents and project-wide components, not multiple independent applications.
- **Archive-based `.flop` ZIP container** (`Agreed (Roadmap)`): Current `.flop` files are versioned UTF-8 JSON v2 documents. Code Studio's `Export ZIP` packages runnable HTML/CSS or Vite+React build output only, not `.flop` project containers.
- **Full arbitrary third-party code visual round-trip** (`Open`): Code synchronization supports explicitly mapped FOLIO structures (`generated` / `mapped`) while preserving `custom` / `extension` modules read-only with respect to canvas visual editing.
- **Real backend execution, server functions, database/auth runtime & live network secret injection** (`Agreed (Roadmap)`): Current `network.http`, `network.socket`, and `source.external` nodes are **Implemented (Simulated)** with zero persisted credentials.
- **Runtime execution for `variable.persist` and `variable.computed`** (`Open`): Stored as `.flop` v2 metadata only (`unsupported` across Headless, Live Preview, and React TSX).
- **Plugin runtime, AI project control, collaborative multiplayer presence, cloud project sync, and hosted backend/deployment adapters** (`Agreed (Roadmap)`).

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

- **42 typed commands (`ALL_NATIVE_COMMAND_REGISTRY`):**
  - **14 frozen Phase 2 commands (`NATIVE_COMMAND_REGISTRY`):** `project.rename`, `node.create`, `node.replace`, `node.transform`, `node.set-properties`, `node.rename`, `node.delete`, `node.set-canvas-state`, `layer.move`, `layer.move-many`, `layer.group`, `layer.ungroup`, `layer.create-clipping-mask`, `layer.remove-clipping-mask`.
  - **28 extended P1.1+ commands (`EXTENDED_NATIVE_COMMAND_REGISTRY`):** `project.replace`, `page.create`, `page.set-active`, `component.create`, `component.sync-document`, `component.rename`, `component.delete`, `component.update-contract`, `tokens.update`, `code.update-modules`, `asset.upsert`, `logic.create-graph`, `logic.update-graph`, `logic.delete-graph`, `animation.create-clip`, `animation.update-clip`, `animation.delete-clip`, `node.replace-many`, `node.split`, `node.update-many`, `node.edit`, `selection.set`, `selection.deselect`, `selection.invert`, `selection.select-similar`, `history.commit-edit`, `history.undo`, `history.redo`.
- **Workspace isolation & concurrency:** Main Canvas (`workspace: 'main'`) and Component Canvas (`workspace: 'component'`) run independent `CanonicalEditorStore` instances. Master component sync uses expected revision / CAS checks (`COMPONENT_CONFLICT`), atomic transactions collapse multi-step operations into a single Undo entry, and failed transactions roll back completely.
- **Event & revision semantics:** Project-mutating commands increment `projectRevision` monotonically and emit immutable `NativeChangeEvent` payloads. Editor-only commands (`selection.set`, `selection.deselect`, `selection.invert`, `selection.select-similar`, `history.commit-edit`) update editor state without bumping `projectRevision` or emitting project change events.

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

- **Reproducible dependency graph:** Direct runtime and dev dependencies in `package.json` are pinned to exact versions (`preact@10.29.8`, `typescript@5.9.3`, `vite@8.3.8`, `vitest@4.1.12`) and locked by a canonical `lockfileVersion: 3` `package-lock.json` with SHA-512 integrity hashes (`packageManager: "npm@10.9.9"`, `engines.node: ">=22.12.0 <27"`). `.nvmrc`, GitHub Actions (`ci.yml`, `deploy.yml`), and `.devcontainer/devcontainer.json` are aligned on `npm ci`.
- **Verification commands:**
  - `npm run check`: Strict TypeScript check (`tsc --noEmit`) across `src`, `tests`, `scripts`, and `vite.config.ts`.
  - `npm run test:unit`: Fast Vitest unit/integration suite (`60` test files / `629` tests on current HEAD).
  - `npm run test:browser`: Deterministic serialized Chromium browser acceptance suites (`vitest run --fileParallelism=false .browser.test.mjs`, `4` test files / `11` tests).
  - `npm test`: Complete Vitest suite (unit + browser).
  - `npm run benchmark`: Reproducible large-project rendering & interaction benchmark (`--scale=small|medium|large|xlarge|monster`, `--json`), including 10,000-node Hybrid GPU pack/cull, WASM linear-memory spatial queries, and Compute Worker dispatch.
  - `npm run build`: Production Vite bundle (`dist/`) with architectural Rollup `manualChunks` (`vendor-preact`, `core-engine`, `canvas-engine`, `studio-engines`) and lazy code-splitting (`vector-drawing-engine`, `LazyCodeWorkspace`, `codegen`, `DiagnosticsModal`, `NodeLogicWorkspace`, `MotionTimelinePanel`, `TemplateLibraryPopover`, `TokensPanel`, `KeyboardShortcutsModal`, `visualExport`), keeping emitted JS chunks modular.

## Roadmap stages & current status

Statuses strictly distinguish **Verified (local)**, **Implemented (Simulated/Partial)**, **Agreed (Roadmap)**, and **Open** (external GitHub CI on pushed commits and human manual browser acceptance remain tracked in [Acceptance Tests](ACCEPTANCE_TESTS.md)):

1. **Foundation (`Verified` locally):** Application shell, AST, SVG canvas, IndexedDB v2 persistence, and `.flop` v2 UTF-8 JSON file I/O with central network-secret sanitization.
2. **Canvas & studio tools (`Verified` locally):** Dual-mode `PAGE` / `VECTOR` 29-tool registry, native cubic Bezier vector math, planar Pathfinder booleans, Vector-Native Brush/Eraser/Paint Bucket/Eyedropper drawing suite, selection, resize, rotation, snapping, alignment, distribution, pan, zoom, and strict P0.3 unidirectional tool boundaries.
3. **Unified project v2 & Native Command Engine (`Verified` locally):** Multi-page project aggregate, migrations, deterministic hydration, reusable master components/instances/overrides, dual-workspace sync, durable deletion, cross-studio reference cleanup (`logicGraphs`, `animations`, and non-destructive `codeModules` extension anchor detachment with atomic Undo), and **42-command** zero-bypass Native Command Engine (P1.1+).
4. **Long-term quality foundation (`Verified` locally — P1.2):** Reproducible npm `lockfileVersion: 3` `package-lock.json` (`packageManager: "npm@10.9.9"`), CI configuration, automated rendering/interaction benchmark suite, and synchronized architecture documentation.
5. **Web Layout, Design Tokens, Component Contract & Code Engine (`Verified` locally; arbitrary full code round-trip remains `Open`):** Auto-Layout Flex/Grid & responsive breakpoints (`Desktop`/`Tablet`/`Mobile`), hardened Design Tokens with CSS injection protection and node binding validation, unified Component Contract precedence (`Master -> Variants -> Slots -> Local Overrides -> Tokens`) across Canvas/HTML/CSS/React, 4-category Code Mapping (`generated`/`mapped`/`custom`/`extension`), coalesced Code Editor Undo history, deterministic multi-file React/HTML ZIP export, and React TSX + CSS compilation with Live Preview.
6. **Engine Performance, Scalability & Architectural Hygiene (`Verified` locally):** Incremental project validation, O(changed nodes) Delta History Engine (`src/engines/history`), WASM-ready Compute Kernel Ports (`src/core/kernels`) with `FlatGridSpatialIndex` viewport culling, modular `App.tsx` (`useWorkspaceChromeEffects`) & `Canvas.tsx` decomposition, and Vite architectural chunk splitting (zero `> 500 kB` chunk warnings).
7. **Prototype / Node Logic Studio, Component-Scoped Logic & Quick Interactions (`Verified` locally for 26 `full` nodes & component-instance parity; `Implemented (Simulated/Partial)` for `source.external`/`network.http`/`network.socket` and Headless/React `flow.delay`/`flow.loop-timer`; `Open` for `variable.persist`/`variable.computed`):** `.flop` v2-compatible `LogicGraph` with typed `variables`, `frames`, and hard-gated secret-safe `networkSettings` (`authSecretRef` + sanitized `globalHeaders` across `.flop`, IndexedDB, Live Preview, and Export); 31 primary nodes across 7 categories + 13 hidden legacy v1 nodes with lossless migration; strict 2-wire contract (`execution` | `data`) plus Target Reference (`targetNodeId` / `Inherit from Pipeline`); per-instance Component-Scoped Node Logic expansion honoring `nodeLogicEnabled` and canonical component precedence; Scoped Data Pipeline (`PipelineContext`) & isolated per-instance+frame+target private memory; Smart Logic Frames & Function Baking with reusable frame presets; Quick Interaction Management (`InspectorInteractionsSection` ↔ Node Logic via Native Commands); shared compiler payload (`parity.ts`) across Headless `PrototypeRuntime`, Live Preview micro-runtime, and React TSX codegen; interactive Visual Node Logic Graph Editor (`NodeLogicWorkspace.tsx` + 4-tab `NodeLogicInspector.tsx`); and complete 6-menu Application Menu Bar (`File`, `Edit`, `View`, `Tools`, `Option`, `Help`).
8. **Motion & Animation Engine (`Verified` locally — Stage 8):** `.flop` v2 `animations?: AnimationClip[]` schema, cubic-Bezier & spring easing, keyframe interpolation (`x`, `y`, `opacity`, `rotation`, `scale`, `fill`), non-destructive Main Canvas pose playback, CSS `@keyframes` + `@media (prefers-reduced-motion: reduce)` codegen, `animation.create-clip` / `animation.update-clip` / `animation.delete-clip` Native Commands, `action.media-animation` / legacy `action.play-animation` triggers, and dockable Motion Timeline Studio.
9. **Professional workflows, Visual Styling & Hybrid GPU / WASM Engine (`Implemented (Simulated/Partial)` — core features `Verified` locally; `Agreed (Roadmap)` for remainder):** Built-in WCAG 2.1 AA Accessibility Audit with atomic Native Command Auto-Fix (`a11yAudit.ts`), runnable multi-file React/HTML ZIP export with binary asset packaging (`projectBundle.ts`, `zipArchive.ts`), Scene Profiler & Project Health diagnostics (`studioProfiler.ts`, `DiagnosticsModal.tsx`), Nested Component Instances with 3-color DFS anti-cycle DAG validation, `ImageNode` & SHA-256 deduplicated binary asset store (`assetStore.ts`), Modern Styling & Typography Engine, Hybrid GPU Viewport (`Auto | GPU | SVG`), and WASM Linear-Memory Spatial Kernel + Compute Web Worker are implemented and verified locally. Multi-Application projects, archive-based `.flop` ZIP containers, real backend execution, plugin runtime, AI project control, and real-time multiplayer collaboration remain **Agreed (Roadmap)**.

