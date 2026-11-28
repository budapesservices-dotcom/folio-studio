# Stage 1 — Acceptance Checklist

Run automated checks from the repository root:

```bash
npm run check
npm run test
npm run build
```

Then run `npm run dev` and open `http://127.0.0.1:5173`.

## Manual browser checks

1. **Initial load:** the Folio Studio shell and a cream-colored artboard with sample artwork appear.
2. **Insert:** use the left toolbar to add a rectangle, ellipse and text layer. Each new item appears on the artboard and becomes selected.
3. **Select:** click a shape on the artboard or its row in Layers. The selection outline and inspector should follow the selection.
4. **Edit geometry:** change X, Y, W or H in the inspector. The selected artwork should move or resize immediately.
5. **Edit appearance:** change Fill and, for rectangles, Corner radius. The artboard should update immediately.
6. **Edit text:** select a text layer, change Text content, Font size and Weight.
7. **Visibility and lock:** toggle Visible and Locked. Hidden nodes should disappear; locked nodes should not be selected by clicking them on the artboard, but remain selectable in the Layers panel.
8. **Delete and history:** delete a selected layer, Undo it, then Redo it.
9. **Autosave:** wait for “ALL CHANGES SAVED”, refresh the browser, and confirm the latest project reopens.
10. **Native project files:** export from File → Export Project and confirm a .flop download; open it again through File → Open Project and confirm the imported project is active. Cancel the picker and confirm the current project remains unchanged. After a failed import, select the same file again to confirm the picker permits a retry.

## Native .flop file workflow

Implementation status: the File menu workflow and the FL-01/FL-02 reliability revisions are implemented.

Automated verification (2026-11-20): GitHub Actions run [#44689944984](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44689944984) completed successfully on Node.js 26.13.1 for the grouped-layer revision. `npm run check`, `npm run test` (10 test files, 120 tests) and `npm run build` all passed, including GroupNode validation and grouped page/component-master .flop export/import round-trip coverage.

Manual browser acceptance: pending. The browser workflows below have not been exercised in this revision.

- File → Open Project parses, migrates and validates the selected .flop through the existing adapter, then saves the imported project and active-project pointer in one IndexedDB transaction before replacing editor state. A failed save cannot activate an unsaved project.
- The active-project pointer lives in the IndexedDB app-state store, outside project metadata and the .flop payload. Missing, stale, malformed or reserved-workspace pointers fall back to the existing updatedAt selection. Project metadata and updatedAt are not rewritten to influence selection.
- Cancelled selection and failed parsing, migration, validation or persistence do not dispatch project replacement or change the previous active-project pointer. The picker value is cleared after every selected file so the same file can be selected again.
- File → Export Project validates the export snapshot through the existing v2 validation adapter. When the active master buffer's document content differs from its canonical component document, the snapshot overlays that buffer immutably and gives the edited component and project metadata one shared updatedAt timestamp. An unchanged document does not receive a synthetic timestamp.
- tests/projectFile.test.ts covers .flop import/migration/failure and aggregate export. tests/indexedDb.test.ts covers active pointer persistence, reload selection, fallback, reserved Component Canvas handling, failed/cancelled imports and a staged-write transaction abort with rollback of all writes. tests/projectExport.test.ts covers immediate buffer export, round-trip import, synchronized modification timestamps, no-change exports and canonical/buffer immutability. tests/document.test.ts verifies GroupNode acceptance, shared page/component-master validation, strict common properties, missing parents, cycles and duplicate IDs/routes. tests/projectFile.test.ts exports and re-imports grouped page and component-master documents, asserting group IDs, hierarchy, node order and properties remain intact.

### Manual browser acceptance

1. **Export:** choose File → Export Project and confirm a named .flop file downloads.
2. **Format:** inspect the exported file and confirm format is folio-project and formatVersion is 2.
3. **Component buffer export:** edit a master component, immediately export before waiting for the UI effect/autosave cycle, re-import the file and confirm the latest master document is present. Confirm component.updatedAt and project metadata.updatedAt match, and an unchanged buffer does not cause a timestamp update.
4. **Import:** open the exported file and confirm the project, active page, page/document/node IDs, components, logic graph reservations and asset references are restored.
5. **Older imported project:** keep Project A with a newer updatedAt, import Project B with an older updatedAt, confirm B activates, refresh the browser and confirm B is restored without changing its imported metadata.
6. **Pointer fallback:** remove the active-project pointer or replace its ID with a missing ID, reload and confirm the existing updatedAt-based fallback selects a valid root project.
7. **Legacy import:** open a supported v1 single-document file and confirm migration to v2 preserves its document ID, node IDs and extension data.
8. **Invalid import:** select invalid JSON, an invalid project or an unsupported format version. Folio must show an English error and keep the active project unchanged.
9. **Retry:** after a failed import, select the same file again. The file picker must accept the repeated selection.
10. **Cancellation:** open the picker and cancel. The active project and its undo/redo state must remain unchanged.
11. **History reset:** after a successful import, confirm Undo and Redo do not restore history from the previously open project.
12. **Round trip:** export → import → export and compare project semantics, IDs, component references, logic graph reservations, asset references and layer order.
13. **Grouped layers:** group multiple page layers and nested children, export the .flop file, re-import it, and confirm Group IDs, parent references, layer order and node properties are preserved. Repeat with a grouped component master.

Do not mark native file workflow acceptance as verified until the automated checks and manual browser checks above pass.
Do not start Stage 2 until the Stage 1 automated checks and manual browser checks above pass on the target Windows 10 laptop and intended browser.

## Native Command Core — Phase 1

Implementation scope: Main Canvas only. The initial static registry supports `node.transform` and `node.set-properties`. Command types and runtime validation live under `src/core/commands/`; the reducer compatibility registry and prepare/commit adapter live under `src/app/`.

UI adoption status: Phase 1 verifies the local Native Command core programmatically. Existing Canvas gestures and Inspector edits continue through their legacy reducer paths; this checklist does not claim that real UI interactions submit Native Commands. Incremental Designer/Developer workspace adoption is deferred to Phase 4.

- Main Canvas legacy reducer actions and Native Command candidates share `CanonicalEditorStore.commitEditorTransition`. Component Canvas remains a separate reducer-backed working buffer; its canonical component synchronization continues through the Main Canvas legacy path.
- The store owns `projectRevision` in memory, classifies project mutations from immutable before/after project references, freezes committed editor/project graphs, and rechecks the captured revision at commit.
- Commands require a full page `DocumentAddress` and full `NativeNodeRef`. Phase 1 accepts only the active Main Canvas page document; inactive pages, component definitions and the temporary Component Canvas project are rejected rather than retargeted.
- Runtime envelope and payload validators reject unknown keys, unsupported versions, malformed references, invalid/non-finite geometry, unsupported transform fields and arbitrary property patches. The static registry maps only to the existing `transform-nodes` and `set-nodes-properties` reducer actions.
- Preparation is read-only and returns only a candidate. The host reports `applied` only after the canonical store accepts the candidate. No-op/rejected requests do not create history or advance revisions; Undo, Redo, replacement and accepted legacy project mutations pass through the same revision boundary.
- `tests/nativeCommandCore.test.ts` covers envelope/registry validation, exact addressing, same node IDs across documents, atomic multi-node rejection, lock checks, no-op and rejection, reducer parity, Undo/Redo, revision conflicts, failed commits, replacement, history limits, alias freezing and post-commit notification behavior.

Not included in Phase 1: Component Canvas command bridge, inactive-page mutation, batches, plugin/AI execution, remote execution, Node Logic commands, command-based history, durable revisions or multi-application support.

Automated verification (2026-11-20): GitHub Actions run [#44697833843](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44697833843) passed on Node.js 26.13.1. `npm run check`, `npm run test` (11 test files, 155 tests) and `npm run build` all passed. Manual browser acceptance for Native Command Core: pending; this CI result does not claim a browser-level run.


### Native Command runtime validation resource limits

Runtime input normalization applies these finite limits per input graph: depth **64** (root depth 0), **4,096** object/array nodes, **16,384** own properties, **4,096** aggregate dense array elements, and **1,000** elements per array. Repeated object identity (shared references) is memoized and preserved rather than rejected or recloned; the validator tracks maximum subtree height and checks every traversal path against the depth budget. Circular references, sparse arrays, accessors, symbols, unexpected property descriptors, and reflection failures are structured validation rejections. These implementation resource limits do not change the authoritative Native Commands protocol specification.



### Safe active Component Canvas master deletion

1. Open a component master in Component Canvas, make local edits, then choose Delete for that same master in Component Rack. Confirm the recovery dialog appears and the canonical master remains present.
2. Choose **Cancel**. Confirm the master, local buffer, undo/redo history and project revision remain unchanged. Continue editing to verify the local buffer remains usable.
3. Repeat with a protected buffer and choose **Save buffer as a new component**. Confirm the complete document (all layers, groups, parent relationships, canvas dimensions and background) is saved under a fresh component/document identity before the original master is deleted.
4. Repeat and choose **Discard buffer and delete**. Confirm the original is deleted and the Component Canvas closes/resets only after the canonical deletion commits.
5. Create a synchronization conflict, then attempt to delete the active master. Confirm the recovery choices still appear and no automatic sync replaces the local buffer while the decision is pending.
6. Undo the master deletion so it becomes orphaned, then Redo it. Confirm deletion while editing the returned master still requires an explicit recovery choice.
7. While the recovery dialog is open, change the canonical master through another Main Canvas action or history transition. Choose a recovery action and confirm the stale operation is cancelled safely with a message to review the latest master.
8. Edit one master, then delete a different component from Component Rack. Confirm the active Component Canvas buffer and its synchronization session are untouched.
9. Delete an active master with a clean, current Component Canvas buffer. Confirm the clean-delete progress dialog appears, canonical deletion and Component Canvas cleanup both become durable, and only then the Component Canvas resets.
10. Simulate a stale deletion after saving a recovery copy. Confirm the recovery component remains in Component Rack and retains the full buffer content even though the original master is not deleted.

Manual browser acceptance for safe Component Canvas master deletion remains pending until these scenarios are exercised in the target browser.


### PR #4 Revision Task 07 — deletion durability and accessibility

Automated coverage added for modal focus entry/trapping/restoration and inert background, Component Canvas autosave ordering and retry, recovery-copy/deletion/cleanup persistence failure points, monotonic guarded rollback, retry after durable recovery without duplicate copies, canonical mutation locking, accurate node change sets, and component-instance override pruning. Automated tests do not replace the browser-level gate.

Manual browser acceptance for Task 07 remains **pending**. Verify initial Cancel focus, Tab/Shift+Tab trapping, Escape cancellation, inert background, and focus restoration to the invoking control. Exercise recovery-copy write failure, final deletion write failure, cleanup failure/retry, concurrent user actions during barriers, autosave retry, and discard while a 450ms save is pending. Reload after each injected failure and verify the last durable project and Component Canvas buffer remain intact.


### Durability and serialization notes — Revision Task 07

- Canonical project commits are protected by a runtime mutation lease while the recovery/deletion sequence is pending. Ordinary canonical mutations are rejected during the lease; the lease is released after the operation returns.
- IndexedDB project writes share one in-memory serialized queue. A recovery-copy save resolves only after its read/write transaction fires `oncomplete`; the master is re-read and CAS-checked after that barrier. Deletion is a separate canonical commit and its project transaction completes before the reserved Component Canvas buffer record is cleared.
- Main Canvas autosaves include their captured monotonic `projectRevision`; an older queued autosave is skipped after a newer durable revision. Component Canvas uses an independent single-writer debounce controller; discard/recovery first flushes the current buffer, invalidates pending timers, and waits for any in-flight write before the cleanup barrier.
- Persistence failures keep the local buffer. A failed canonical persistence rolls the in-memory project back to its last durable snapshot through a guarded new commit; the in-memory `projectRevision` therefore continues to increase. IndexedDB schema/database version remains v2; no session journal or new project store is introduced.

### Component Canvas deletion and recovery — actual-App Chromium acceptance

**Automated browser gate: PASS** on exact PR #4 HEAD `4b79550bac1f4562176862ba284d1278f2472e75`.

The new `tests/componentRecovery.browser.test.mjs` mounts the actual Vite-served Preact App in a fresh headless Chromium profile and disposable origin for each case. It clears only the test origin and inspects the native Chromium IndexedDB v2 database `folio-studio`, distinguishing the canonical root project record from the reserved `folio-component-canvas` buffer record. Failure injection wraps native `IDBObjectStore.prototype.put` only inside the isolated browser page, filters to the intended project-write phase, and records the actual IndexedDB transaction `complete` / `abort` events. No production hooks, production source changes, fake IndexedDB, dependencies, or CI workflow changes are used.

Automated App-level browser scenarios (all PASS):

1. **Cancel / retry / save as new:** creates a dirty active Component Canvas buffer through actual Component Rack and Create tools handlers; exercises Delete → Cancel and confirms the master and buffer remain durable, the Component Canvas stays open, and the Delete action can be retried. Then chooses **Save buffer as a new component** and verifies the recovery copy transaction completes before canonical master deletion and buffer cleanup. The recovered component retains the edited node graph, IDs and names, and the final state survives App reload.
2. **Recovery-copy persistence failure:** aborts the native recovery-copy transaction. The original master stays present, no recovery copy is committed, and the local buffer remains durable and recoverable. Retrying through the actual dialog completes recovery, deletion and cleanup without a duplicate recovery copy; reload restores the result.
3. **Canonical deletion persistence failure:** allows the recovery copy to commit, then aborts the canonical deletion transaction. Both the original master and one recovery copy remain durable with the buffer intact. The actual App exposes **Retry deletion using saved recovery**; retry commits only the deletion/cleanup path without creating another recovery copy. Reload restores the final state.
4. **Component Canvas cleanup persistence failure:** allows recovery and canonical deletion to commit, then aborts the reserved buffer cleanup write. The recovery component remains durable, the deleted master stays deleted, and the dirty buffer remains available while the cleanup-pending dialog is shown. **Retry durable cleanup** commits the cleanup barrier; reload confirms the empty buffer and recovery component.
5. **Discard / clean active-master deletion:** verifies Discard buffer and delete commits canonical deletion before Component Canvas cleanup and closes/resets the workspace only after durability. It then creates a clean active master, waits until the root record is durable, and verifies the canonical delete and buffer cleanup barriers both complete.

The actual modal is also browser-tested: initial focus enters the safe dialog action, Tab and Shift+Tab remain trapped, Escape selects Cancel, background siblings become `inert` and `aria-hidden`, and a focus attempt against the background Component Rack control is rejected while focus remains inside the dialog. Cancel restores focus to the invoking Delete control.

**Exact CI evidence:** [FOLIO verification run #44903450815](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44903450815) completed successfully on `4b79550bac1f4562176862ba284d1278f2472e75`. `npm run check`, `npm test` (**18 test files / 244 tests passed**, including the five executed Component Canvas Chromium tests and the Main Canvas native IndexedDB Chromium test), and `npm run build` all passed. The Component Canvas browser file ran for about **28.4 seconds**; it was not skipped.

**Stale-master / CAS limitation:** an App-level competing canonical mutation was not injected into the interval between recovery-copy completion and deletion. The App holds `store.withMutationLock` across the recovery and deletion sequence, so normal same-App canonical actions are intentionally serialized during that interval. This is not claimed as an App-level browser pass. The service-level compare-and-swap behavior is covered by `tests/componentDeletion.test.ts`, test **“retains a durably saved recovery copy when the master CAS changes before retrying deletion”** (lines 447–477): it commits the recovery copy, changes the canonical master after the barrier, retries deletion, and asserts `stale-master` while preserving both the original master and saved recovery component without a duplicate. Initial stale master metadata rejection is separately covered by the unit test at lines 204–229. Cross-tab / external-writer stale-CAS interaction remains outside this browser test.

**Remaining independent review:** an independent reviewer should inspect the browser evidence and the exact final PR #4 SHA before this acceptance record is treated as independently reviewed. These tests use a local Vite-served actual App and real Chromium/IndexedDB; they do not claim that a hosted Cloudflare Pages preview or deployed browser session was verified.

### Merge-Readiness Reconciliation (PR #5 + `WEB-01`..`WEB-14` + SVG/Mask Audit)

- **Local Automated Gate: PASS (2026-11-22)** — `npm run check` (`tsc --noEmit`), `npm run test` (**23 test files / 310 tests passed**, including four real Chromium browser suites: `mergeReadiness.browser.test.mjs`, `workspaceGeometry.browser.test.mjs`, `nativePersistence.browser.test.mjs`, and `componentRecovery.browser.test.mjs`), and `npm run build` all passed locally.
- **Coverage added:** `tests/workspacePreferences.test.ts`, `tests/FloatingWindow.test.tsx`, `tests/workspaceGeometry.browser.test.mjs` (reconciled from PR #5), `tests/mergeReadiness.test.ts`, and `tests/mergeReadiness.browser.test.mjs` verifying `WEB-01`..`WEB-14`, Preact kebab-case SVG typography & multiline `<tspan>` rendering, root-stacked layer popovers, live SVG Component Rack thumbnails, clipping masks inside component instances with zero duplicate DOM IDs, compact `420×280` Component Canvas creation bounds, and zero console/page errors.
- **GitHub CI & Manual Acceptance:** Pending commit/push to `codex/pr1-main-reconciliation-20261122`, green GitHub Actions run on the pushed HEAD, and human manual browser acceptance. Full evidence is recorded in `docs/reports/FOLIO_MERGE_READINESS.md`.

### Native Command Core — Phase 2 & Main Canvas UI Adoption

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-22).
- **Implemented scope:**
  - Expanded `src/core/commands/types.ts`, `src/core/commands/validation.ts`, `src/app/nativeCommandRegistry.ts`, and `src/app/nativeCommandExecutor.ts` to 14 versioned Main Canvas commands (`project.rename`, `node.create`, `node.replace`, `node.transform`, `node.set-properties`, `node.rename`, `node.delete`, `node.set-canvas-state`, `layer.move`, `layer.move-many`, `layer.group`, `layer.ungroup`, `layer.create-clipping-mask`, `layer.remove-clipping-mask`).
  - Integrated `createDocumentAstView` (`src/core/document/ast.ts`) into live command target resolution and Main Canvas command submission.
  - Added modular `src/app/mainCanvasCommandClient.ts` and routed Main Canvas UI actions in `src/app/App.tsx` through versioned Native Commands with `expectedProjectRevision`, effective lock checks, cycle/clipping precondition rejections, and English toast feedback.
  - Kept `.flop` v2 JSON schema, IndexedDB v2 schema, live coalesced Inspector `edit-node` typing, page/component management, and Component Canvas's isolated buffer/guarded sync intact.
- **Local Automated Gate: PASS (2026-11-22):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `CHROMIUM_BIN=... npx vitest run --fileParallelism=false`: **PASS** (**26 test files / 336 tests passed**, including `tests/nativeCommandCore.test.ts` 60/60, new `tests/nativeCommandPhase2.test.ts` 9/9, and all four real Chromium browser suites: `workspaceGeometry.browser.test.mjs`, `componentRecovery.browser.test.mjs`, `nativePersistence.browser.test.mjs`, `mergeReadiness.browser.test.mjs`). Note: running multiple headless Chromium test suites concurrently in the same container can trigger a CDP `Runtime.evaluate` timeout in `workspaceGeometry.browser.test.mjs`; running with `--fileParallelism=false` eliminates that CPU contention cleanly.
  - Live headless Chromium verification (`playwright-cli` against `http://localhost:3000` at `1440×900`): **PASS** — verified initial hydration (`7` sample layers), `node.create` (`+ Rectangle` → `8` layers), `project.rename` (`Phase 2 Verified .flop`), locked-layer protection (`Lock Rectangle` + `Delete` → layer retained and English rejection toast `"A locked layer or one of its locked ancestors cannot be modified."` displayed), `layer.group` (`Ctrl+G` → `Group` with nested `Rectangle` and `Sun`), Undo/Redo, and **0 console errors / 0 warnings**.
  - Production build (`npm run build`): **PASS**.
- **Pending / Not Claimed:**
  - Phase 3 Component Command Bridge (Component Canvas commands, component definition/instance/override commands), Node Logic authoring commands, and Code Engine remain future milestones.
  - Git branch commit/push, GitHub Actions CI run on pushed HEAD, and human manual browser acceptance remain **pending** outside this local workspace.

### Dual-Mode Studio Tool System (Figma Page Studio + Adobe Illustrator Component Vector Studio)

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-22).
- **Implemented scope:**
  - Added native `FrameNode` and cubic Bezier `PathNode` support across `src/core/document/*`, `src/core/commands/validation.ts`, `src/engines/canvas/artwork.tsx`, `src/engines/canvas/geometry.ts`, `src/app/editorReducer.ts`, and `src/app/mainCanvasCommandClient.ts`.
  - Built pure vector geometry & Illustrator Pathfinder boolean operations (`unite`, `subtract`, `intersect`, `exclude`) in `src/core/document/vector.ts`.
  - Added 25 studio tools in `src/engines/canvas/tools/studioRegistry.ts`, `draw-tools.ts`, `vector-tools.ts`, `utility-tools.ts`, and `select.ts`, with per-workspace tool state, single-key shortcuts, live vector anchor & Bezier handle editing, Figma corner rotation, double-click inline text editing, and modular `src/app/ToolOptionsBar.tsx` while keeping Wave 1 `canvasToolRegistry` and quick `Create tools` browser-test compatibility intact.
- **Local Automated Gate: PASS (2026-11-22):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `CHROMIUM_BIN=... npx vitest run --fileParallelism=false`: **PASS** (**27 test files / 349 tests passed**, including new `tests/vectorTools.test.ts` 13/13 and all 4 real Chromium browser suites).
  - Live headless Chromium visual & interactive verification (`playwright-cli` at `1440×900`): **PASS** — verified Main Canvas `PAGE` Studio Indigo tool rack + Shape flyout + interactive `Shift+G` Star creation + Vector Inspector; Component Canvas warm-amber `VECTOR` mode + Illustrator Vector flyout (`Pen`, `Curvature`, `Anchor Point`, `Pencil`, `Smooth`, `Scissors`) + `Curvature (U)` organic closed Bezier path + `Direct Selection (A)` live 5 anchors / 10 Bezier tangent handles + `Pathfinder Subtract` carving a crisp crescent silhouette; **0 console errors / 0 warnings**.
- **Pending / Not Claimed:**
  - External GitHub Actions CI run and human manual browser acceptance remain **pending** outside this local workspace.

### Stabilization & Integration Pass (Component Canvas, Design Tokens, Component Contract Precedence, React Compiler & CI)

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-23).
- **Implemented scope:**
  1. **Component Canvas & panel divider stabilization:** Restored `+ Rectangle` / `+ Text` quick-add controls in Component Canvas empty Inspector (`src/app/InspectorPanel.tsx`), added `acknowledgeComponentCanvasMetadataUpdate` (`src/app/componentCanvasSync.ts`) so intentional contract-only metadata edits never trigger false sync conflict banners, aligned `clampCurrentPanelWidths` / `resetAllPanelWidths` CSS custom property & ARIA sync (`src/app/workspace/usePanelResizeController.ts`), and aligned `tests/mergeReadiness.browser.test.mjs` toolbar divider assertion (`3` dividers separating `4` semantic groups).
  2. **Design Tokens hardening & token-to-node validation:** Added CSS injection-safe color validation (`isSafeCssColorValue`), numeric bounds (`spacing`/`radius >= 0`, `typography > 0`), orphan theme key rejection, duplicate CSS variable & theme slug rejection, and `validateNodeTokenBindings` (`src/core/document/tokens.ts`) enforced inside `validateProject()` across all pages and component masters (`src/core/document/validation.ts`); enabled automatic deleted-token unbinding with Undo/Redo in `editorReducer.ts`; synchronized canonical `designTokens` into Component Canvas buffers (`componentCanvasSync.ts`, `useComponentMasterLifecycle.ts`, `useDesignSystemActions.ts`).
  3. **Canonical Component Contract precedence alignment:** Enforced `Master Baseline -> Design Tokens -> Active Variants -> Slot Assignments -> Direct Instance Overrides` consistently across Canvas (`src/core/document/components.ts`, `src/engines/canvas/artwork.tsx`), HTML/CSS Compiler (`src/engines/codegen/htmlCssCompiler.ts`), and React Compiler (`src/engines/codegen/reactCompiler.ts`), stripping overridden `fill`/`stroke` token bindings while preserving untouched bindings, computing instance Auto-Layout in Canvas, and emitting nested instance hierarchies + proportional scaling wrappers in HTML/CSS.
  4. **React Compiler visual & structural fidelity:** Generated per-component stylesheets (`src/components/*.css`) with base layout/typography/token `var()` rules and `[data-variant-*]` CSS override rules, full slot (`text`/`Visible`/`Fill`) and `overrides` prop resolution, nested Master hierarchy traversal, inline JSX `<svg>` for `PathNode`, multi-page stylesheet emission (`src/styles/*.css`, `src/styles/tokens.css`), correct component-before-page-CSS import ordering, `../../` custom CSS paths, and deterministic PascalCase identifier deduplication.
  5. **Lockfile & CI restoration:** Generated canonical `lockfileVersion: 3` `package-lock.json` with 146 registry-resolved entries and SHA-512 integrity hashes.
- **Local Automated Gate: PASS (2026-11-23):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run test:unit`: **PASS** (**37 test files / 477 tests passed**).
  - Real Chromium browser suites (`CHROMIUM_BIN=... npx vitest run ...`): **PASS** — `componentRecovery.browser.test.mjs` (5/5), `mergeReadiness.browser.test.mjs` (1/1), `nativePersistence.browser.test.mjs` (1/1), and `workspaceGeometry.browser.test.mjs` (1/1).
  - `npm run build`: **PASS** (`dist/` built cleanly).
  - Live headless Chromium visual verification (`playwright-cli` against `http://localhost:3000/folio-studio/` at `1440×900`): **PASS** — verified 0 console errors/warnings, Main Canvas toolbar groups/dividers, Component Canvas Master Contract + restored `+ Rectangle` / `+ Text` quick-add buttons with zero conflict banner, Design Tokens rack, and Code & Preview Studio `React TSX` output (`src/App.tsx`, `src/pages/MainPagePage.tsx`, `src/components/VisualCard.tsx`, `src/components/VisualCard.css`, `src/styles/index.css`, `src/styles/tokens.css`).
- **Pending / Not Claimed:**
  - External GitHub Actions CI run on a pushed branch and human manual browser acceptance remain **pending** outside this local workspace.

### Visual Node Logic Graph Editor (v1.1), Complete Application Menu Bar & Interactive Starter Experience

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-23).
- **Implemented scope:**
  1. **Visual Node Logic Graph Editor (`src/app/workspace/nodeLogicGraphHelpers.ts`, `NodeLogicWorkspace.tsx`, `NodeLogicInspector.tsx`, `CanvasWindows.tsx`):** Lazy-loaded pan/zoom spatial node-wire editor inside `NodeLogicWindow` over Folio's 17-node `src/engines/prototype` engine (`Event`, `State`, `Logic`, `Action`). Supports searchable/filterable 17-node catalog, node dragging, typed Bezier port wiring with direction normalization, type compatibility, duplicate/cycle rejection, 3-tab inspector (`Node`, `Variables`, `Simulate`) with clickable diagnostics and headless `PrototypeRuntime` trigger simulation, 3 one-click presets (`Click Counter`, `Toggle Visibility`, `Theme Switcher`), and direct **`Test in Live Preview`** launch targeting `useCodeWorkspace` / `LazyCodeWorkspace`. All graph mutations dispatch through Native Commands (`logic.create-graph`, `logic.update-graph`, `logic.delete-graph`) with Undo/Redo support.
  2. **Complete 6-Menu Application Menu Bar (`src/app/workspace/GlobalToolbar.tsx`, `globalMenuActions.ts`, `App.tsx`):** Activated `Edit`, `Tools`, and `Option` menus alongside `File`, `View`, and `Help` with canonical commands, active checkmarks, keyboard shortcut badges, honest disabled states, and outside-click / `Escape` dismissal.
  3. **Interactive Starter Experience (`createInteractiveStarterProject` in `nodeLogicGraphHelpers.ts`, `src/engines/prototype/codegen.ts`):** Preserves the starter artboard visually while attaching a valid default `Main Page Interactions` graph (9 nodes, 8 wires: `Visual card` click -> increment `clickCount`, toggle `accentActive`, update `Card caption` to `INTERACTIONS · {{clickCount}}`, branch to alternate `Sun` fill color) and enhancing Live Preview interactive layers with `data-folio-interactive="true"` + pointer cursor. Keeps `createInitialProject()` untouched for unit contract stability.
  4. **Template insertion sync caching (`src/app/workspace/usePageAndTemplateActions.ts`):** Caches the lazy-loaded `templates.ts` module after first load so subsequent template insertions execute synchronously inside Native Command and IndexedDB revision fences without sacrificing Vite code-splitting.
- **Local Automated Gate (2026-11-23):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run test:unit`: **510 / 511 PASSED** across 43 test files (including new `tests/nodeLogicWorkspace.test.ts` 6/6, `tests/nodeLogicEngine.test.ts` 9/9, `tests/workspaceModules.test.ts` 11/11, `tests/p03SubsystemBoundaries.test.ts` 23/23, `tests/p11NativeCommandMigration.test.ts` 9/9, `tests/document.test.ts` 33/33). The single failure is the pre-existing `tests/p12QualityFoundation.test.ts` check for `../package-lock.json` which is absent in this container environment.
  - Real Chromium browser suites (`CHROMIUM_BIN=... npx vitest run --fileParallelism=false ...`):
    - `tests/mergeReadiness.browser.test.mjs`: **PASS (3/3)** — verifies all 6 active application menus (0 disabled placeholders), Visual Node Logic starter graph rendering, inline Simulate execution, and interactive Live Preview HTML click execution (`INTERACTIONS · 1` -> `INTERACTIONS · 2`).
    - `tests/nativePersistence.browser.test.mjs`: **PASS (1/1)**.
    - `tests/componentRecovery.browser.test.mjs`: **PASS (5/5)**.
    - `tests/workspaceGeometry.browser.test.mjs`: Passed earlier (1/1); encountered the known headless-shell CDP `Runtime.evaluate` reload timeout on retry while direct Playwright verification confirmed legacy layout banner restoration in <1.5s with 0 console errors.
  - Live headless Chromium visual QA (`playwright-cli` at `1440×900`): **PASS** — verified `Edit` dropdown alignment, floating and docked `Node Logic` 3-pane workspace with framed 9-node Bezier graph (`Fit`), category icon badges, `Simulate` live state/overrides/trace, and **0 console errors / 0 warnings**.
  - Production build (`npm run build`): **PASS** (`dist/` built cleanly with lazy chunks).
- **Pending / Not Claimed:**
  - External GitHub Actions CI run on a pushed branch, `package-lock.json` lockfile restoration in git, and human manual browser acceptance remain **pending** outside this local workspace.

### Stage 8 — Motion & Animation Engine (`src/engines/animation`) & Interactive Motion Timeline Studio

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-23).
- **Implemented scope:**
  1. **`.flop` v2 Motion Schema & Validation (`src/core/document/types.ts`, `validation.ts`):** Added backward-compatible optional `animations?: AnimationClip[]` with strict duration bounds, keyframe time bounds, duplicate `(targetNodeId, property)` track rejection, page reference checks, CSS injection-safe color validation, and frozen incremental validation caching.
  2. **Pure Motion Engine (`src/engines/animation/easing.ts`, `evaluator.ts`, `codegen.ts`, `index.ts`):** Implemented cubic-Bezier & normalized spring easing curves (`linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `spring`), numeric & hex-color keyframe interpolation (`x`, `y`, `opacity`, `rotation`, `scale`, `fill`), non-destructive Main Canvas pose evaluation (`applyAnimatedPosesToDocument` using `NodeBase.opacity`), 3 built-in presets (`Hero Entrance`, `Orbit Float`, `Pulse Glow`), starter page `Hero Entrance` clip, and deterministic CSS `@keyframes` compilation with `@media (prefers-reduced-motion: reduce)` guards wired into `htmlCssCompiler.ts` and Live Preview.
  3. **Zero-Bypass Native Command Engine & Node Logic Bridge:** Added `animation.create-clip`, `animation.update-clip`, `animation.delete-clip` with `animation.update` permission (total **38** registered commands in `ALL_NATIVE_COMMAND_REGISTRY`) and Undo/Redo support. Added the 18th Node Logic catalog node `action.play-animation` across `catalog.ts`, `validator.ts` (`MISSING_ANIMATION_CLIP`), `runtime.ts` (`playedAnimations`), `codegen.ts`, and `NodeLogicInspector.tsx`.
  4. **Dockable Motion Timeline Studio (`src/app/workspace/useMotionPlayback.ts`, `MotionTimelinePanel.tsx`, `GlobalToolbar.tsx`, `App.tsx`, `global.css`):** Added lazy-loaded bottom drawer docked above `.statusbar` (keeping `App.tsx` under 1,200 lines and `GlobalToolbar` at 3 dividers) with Play/Pause/Stop/Loop/Autoplay transport, scrubbable ruler with 12px edge-safe insets, draggable diamond keyframes, presets popover, keyframe value/easing inspector strip, and direct **`Test in Live Preview`** CTA.
- **Local Automated Gate (2026-11-23):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run build` / `compile_applet`: **PASS** (`dist/` compiled cleanly).
  - `npm run test:unit`: **515 / 516 PASSED** across 44 test files (including new `tests/motionEngine.test.ts` 5/5, `tests/codeEngineAndMapping.test.ts` 9/9, `tests/nodeLogicEngine.test.ts` 9/9, `tests/workspaceModules.test.ts` 11/11). Only pre-existing failure is `tests/p12QualityFoundation.test.ts` checking for absent `package-lock.json` in this sandbox.
  - Real Chromium browser suites (`CHROMIUM_BIN=... npx vitest run ...`):
    - `tests/mergeReadiness.browser.test.mjs`: **PASS (4/4)** — includes Stage 8 Motion Timeline docking, starter `Hero Entrance` tracks, playhead scrubbing, keyframe inspector, and compiled `@keyframes` + `prefers-reduced-motion` in Live Preview with 0 console/page errors.
    - `tests/nativePersistence.browser.test.mjs`: **PASS (1/1)**.
    - `tests/componentRecovery.browser.test.mjs`: **PASS (5/5)**.
  - Live headless Chromium visual QA (`playwright-cli` at `1440×900`, 2 rounds): **PASS** — verified docked Motion Timeline above StatusBar, unclipped 12px-inset `0.0s`..`1.2s` keyframe diamonds & ticks, live non-destructive Canvas pose fade/shift at `0.24s / 1.20s`, Presets dropdown z-index layering, Live Preview handoff, and **0 console errors / 0 warnings**.
- **Pending / Not Claimed:**
  - External GitHub Actions CI run, `package-lock.json` lockfile restoration, and human manual browser acceptance remain **pending** outside this local workspace.

### Priority A (P0) Hardening Pass — Lockfile/CI Parity, Full 18-Node React Codegen, Code Editor Undo Coalescing & `codeModules` Cleanup

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-23).
- **Implemented scope:**
  1. **P0-1 Reproducible Lockfile & CI Parity (`package.json`, `package-lock.json`, `.github/workflows/deploy.yml`):** Restored `"packageManager": "npm@10.9.8"`, serialized `test:browser` (`vitest run --fileParallelism=false .browser.test.mjs`) to avoid concurrent headless Chromium CDP contention, generated canonical `lockfileVersion: 3` `package-lock.json` (146 registry-resolved external entries with SHA-512 integrity hashes, 0 missing), and added `main` branch trigger to `.github/workflows/deploy.yml`.
  2. **P0-2 Full 18-Node Node Logic Parity in React TSX (`src/engines/prototype/codegen.ts`, `src/engines/codegen/reactCompiler.ts`):** Extended `buildReactPageLogicPlan()` and `compileReactProjectFiles()` to emit full support for `event.on-state-change`, `action.set-variant` (with strict TypeScript literal union casts on component variant props), `action.navigate` (with URL allowlist validation and `onNavigate` route state wiring in `src/App.tsx`), `action.set-theme` (`data-theme` switching), and `action.play-animation` (CSS animation class restart).
  3. **P0-3 Coalesced Code Editor Undo History (`src/core/commands/types.ts`, `validation.ts`, `src/app/editorReducer.ts`, `nativeCommandRegistry.ts`, `mainCanvasCommandClient.ts`, `useCodeWorkspace.ts`, `CodeWorkspacePanel.tsx`):** Added optional non-empty `coalesceKey` to `code.update-modules` so consecutive keystrokes in Custom/Extension modules coalesce into one Undo group committed on textarea blur, file switch, or panel close, and removed redundant `codeDraft` local buffer lag in `CodeWorkspacePanel.tsx` so Undo/Redo and reopening reflect canonical content immediately without a 1-frame empty flash.
  4. **P0-4 Cross-Studio Layer Deletion Cleanup for `codeModules` (`src/core/document/nodeReferenceCleanup.ts`, `src/app/workspace/LayerPopovers.tsx`, `src/app/App.tsx`):** Extended pre-delete inspection, context-menu warning badge (`N Code`), atomic deletion cleanup, and toast notice (`Code extension anchor (code preserved)`) so deleting a referenced layer detaches `targetNodeId` without deleting developer custom code and restores `targetNodeId` atomically on 1-step Undo.
  5. **P0-5 Documentation Sync (`docs/ARCHITECTURE.md`, `docs/ACCEPTANCE_TESTS.md`):** Synchronized command counts (`38`), Node Logic catalog counts (`18`), Stage 8 status (**Implemented & Verified locally**), and P0 verification evidence.
- **Local Automated Gate (2026-11-23):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run test:unit`: **PASS** (**45 test files / 527 tests passed**, including `tests/p12QualityFoundation.test.ts` 5/5, `tests/nodeLogicEngine.test.ts` 10/10 with strict `ts.transpileModule` TSX checks, `tests/codeEngineAndMapping.test.ts` 10/10, and `tests/crossStudioHardening.test.ts` 5/5).
  - `npm run build` / `compile_applet`: **PASS** (`dist/` compiled cleanly).
  - Live headless Chromium verification (`playwright-cli` against `http://localhost:3000/folio-studio/` at `1440×900`): **PASS** — verified `React TSX` output (`notifyStateChange`), `+ Ext` creation on `Sun`, 3 consecutive edits coalescing into 1 `Ctrl+Z` Undo step & `Ctrl+Shift+Z` Redo, Layers right-click cross-studio reference badge (`Logic` + `Code`), Delete cleanup toast (`Code extension anchor (code preserved)`), 1-step Undo restoring both `Sun` and its `Code` anchor badge, and **0 console errors / 0 warnings**.
- **Pending / Not Claimed:**
  - External Git commit/push, GitHub Actions CI run on a pushed branch, Cloudflare Pages deploy, and human manual browser acceptance remain **pending** outside this local workspace (no `.git` remote in this sandbox).

### Priority B (P1) Hardening Pass — Bundle Chunk Splitting, Multi-File ZIP Export, WCAG 2.1 AA Accessibility Audit & `App.tsx` Modularity

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-23).
- **Implemented scope:**
  1. **P1-1 Bundle Architecture & Chunk Splitting (`vite.config.ts`):** Added architectural `build.rollupOptions.output.manualChunks` separating `vendor-preact`, `core-engine`, `canvas-engine`, and `studio-engines` alongside lazy workspace chunks, reducing main entry `dist/assets/index-*.js` from `723.63 kB` to `400.82 kB` (`98.18 kB` gzip) with **0 Vite `> 500 kB` chunk-size warnings**.
  2. **P1-2 Zero-Dependency Multi-File ZIP Project Export (`src/engines/codegen/zipArchive.ts`, `projectBundle.ts`, `index.ts`, `useCodeWorkspace.ts`, `CodeWorkspacePanel.tsx`):** Implemented a deterministic PKZIP 2.0 Store-mode archive writer/parser (`buildZipArchive`, `parseZipArchive`, `computeCrc32`) with strict path-traversal and duplicate-entry rejection, plus `buildCompiledProjectBundle()` generating runnable Vite + React + TypeScript scaffolds (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `README.md`, compiled pages/components/styles, custom modules) and static HTML/CSS site bundles via Code & Preview Studio's **`Export ZIP`** button.
  3. **P1-3 Built-In WCAG 2.1 AA Accessibility & Semantic HTML Audit (`src/engines/codegen/a11yAudit.ts`, `CodeWorkspacePanel.tsx`, `useCodeWorkspace.ts`, `src/styles/global.css`):** Implemented pure color-contrast (`4.5:1` normal / `3.0:1` large text against parent/painted backdrop + Design Tokens), heading-hierarchy (`MISSING_H1`, `MULTIPLE_H1`, `SKIPPED_HEADING_LEVEL`), interactive accessible-name, safe `href`, and empty-text auditing surfaced in a collapsible `.code-a11y-drawer` with score, severity badges, and 1-click **Focus** jump-to-canvas.
  4. **P1-4 `App.tsx` Modularity Headroom (`src/app/workspace/useWorkspaceChromeEffects.ts`, `src/app/App.tsx`):** Extracted toast auto-dismiss, menu/tool-rack outside-click & Escape dismissal, viewport resize recovery, and shortcuts modal focus-trapping effects into `useWorkspaceChromeEffects`, reducing `src/app/App.tsx` from `1,184` to `1,110` lines while preserving all `tests/workspaceModules.test.ts` architectural boundary invariants.
- **Local Automated Gate (2026-11-23):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run test:unit`: **PASS** (**46 test files / 531 tests passed**, including new `tests/a11yAudit.test.ts` 3/3, expanded `tests/codeEngineAndMapping.test.ts` 11/11 covering deterministic ZIP output, CRC-32 parsing & path traversal guards, and `tests/workspaceModules.test.ts` 11/11).
  - `npm run build` / `compile_applet`: **PASS** (`dist/` compiled cleanly in ~660ms; largest JS chunk `index-*.js` is `400.82 kB`, 0 chunk-size warnings).
  - Live headless Chromium verification (`playwright-cli` against `http://localhost:3000/folio-studio/` at `1440×900`): **PASS** — verified Code & Preview Studio header layout (`A11y · 2`, `Export ZIP`, zero overflow/clipping), collapsible Accessibility Audit drawer (`Score 89/100`, `WARN` low contrast `4.30:1` on `Eyebrow`, `INFO` skipped heading `h1 -> h3` on `Description`, `Focus` button), real browser `.zip` downloads for both `HTML / CSS` (`first-canvas-html-css.zip`, 5 files) and `React TSX` (`first-canvas-react-ts.zip`, 10 files) validated cleanly with `python3 -m zipfile -t`, and **0 console errors / 0 warnings**.
- **Pending / Not Claimed:**
  - External Git commit/push, GitHub Actions CI run on a pushed branch, Cloudflare Pages deploy, and human manual browser acceptance remain **pending** outside this local workspace.

### Priority C (P2) Professional Polish — Atomic Accessibility Auto-Fix, Studio Scene Profiler & Full Chromium Browser Gate

- **Implementation status:** **Implemented** and **Verified locally** (2026-11-23).
- **Implemented scope:**
  1. **P2-1 Atomic 1-Click WCAG 2.1 AA Auto-Fix (`src/engines/codegen/a11yAudit.ts`, `index.ts`, `useCodeWorkspace.ts`, `CodeWorkspacePanel.tsx`):** Added `suggestAccessibleForegroundColor()` (hue-preserving minimal-drift binary search toward black/white meeting WCAG AA `4.5:1` / `3.0:1`), `applyA11yQuickFixToNode()` (stripping conflicting `fill` token bindings), per-issue **`Fix`** buttons (`Fix (#RRGGBB)`, `Set <h2>`, `Add Label`), and atomic **`Fix All (N)`** via `mainCommandClient.executeTransaction(...)` so all fixes apply and undo in 1 atomic `Ctrl+Z` step.
  2. **P2-2 On-Demand Studio Scene Profiler & Project Health (`src/engines/diagnostics/studioProfiler.ts`, `src/app/workspace/DiagnosticsModal.tsx`, `GlobalToolbar.tsx`, `App.tsx`, `src/styles/global.css`):** Added framework-independent `analyzeProjectHealth()` and `runLiveSceneProfile()` (8 runtime engine stages: AST, Layer Tree, Auto-Layout, FlatGrid Spatial Index, A11y Audit, HTML/CSS Compiler, React TSX Compiler, Incremental Validation) surfaced in a focus-trapped, lazy-loaded modal (`dist/assets/DiagnosticsModal-*.js` ~15.58 kB) accessible via `Help -> Scene Profiler & Health`.
  3. **P2-3 Unit & Regression Coverage (`tests/a11yAudit.test.ts`, `tests/studioProfiler.test.ts`):** Added contrast suggestion, starter-page `100/100` auto-fix round-trip, health check, spatial-culling activation, deep nesting, and 8-stage live profiler tests.
  4. **P2-4 Full Automated Browser Acceptance Gate (`npm run test:browser`):** Executed all 4 real Chromium browser acceptance suites sequentially (`--fileParallelism=false`) with 100% pass rate.
- **Local Automated Gate (2026-11-23):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run test:unit`: **PASS** (**47 test files / 535 tests passed**, including `tests/a11yAudit.test.ts` 4/4, `tests/studioProfiler.test.ts` 3/3, and `tests/workspaceModules.test.ts` 11/11).
  - `CHROMIUM_BIN=... npm run test:browser`: **PASS** (**4 test files / 11 tests passed** in 70.54s — `mergeReadiness.browser.test.mjs` 4/4, `workspaceGeometry.browser.test.mjs` 1/1, `componentRecovery.browser.test.mjs` 5/5, `nativePersistence.browser.test.mjs` 1/1).
  - `npm run build` / `compile_applet`: **PASS** (`dist/` compiled cleanly; `index-*.js` = `401.65 kB` / `98.43 kB` gzip, lazy `DiagnosticsModal` = `15.58 kB`, 0 chunk-size warnings).
  - Live headless Chromium verification (`playwright-cli` against `http://localhost:3000/folio-studio/` at `1440×900`): **PASS** — verified `Fix All (2)` elevating starter page from `Score 89/100` (`A11y · 2`) to `Score 100/100` (`A11y · Pass`), 1-step `Ctrl+Z` atomic Undo restoring `A11y · 2` & `Delta History: 0 / 1`, `Help -> Scene Profiler & Health` modal + **`Run Live Profile`** (`Total pass: 4.20 ms · FAST`, 8 stages), `Escape` clean close, and **0 console errors / 0 warnings**.
- **Pending / Not Claimed:**
  - External Git commit/push, GitHub Actions CI run on a pushed branch, Cloudflare Pages deploy, and human manual browser acceptance remain **pending** outside this local workspace.

---

### Phase 1 & Phase 2 Hardening Pass — Network Secret Hard-Gate, CI Green, Component-Scoped Logic & 3-Runtime Behavioral Parity (2026-11-24)

- **Implementation status:**
  - **Verified (local automated & Chromium suites):**
    1. **Phase 1 — Central Network Credential Hard-Gate (`src/core/document/networkSecrets.ts`, `projectFile.ts`, `indexedDb.ts`, `parity.ts`, `codegen.ts`, `reactCompiler.ts`, `projectBundle.ts`):** Blocks/strips case-insensitive sensitive headers (`authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `x-auth-token`, `cookie`, `set-cookie`), raw secret/token patterns (`Bearer`, `Basic`, `Token`, JWT `eyJ...`, `sk-...`, `pk_live_...`, `gh*_...`, `AIza...`, `xox*-...`, `AKIA...`, `glpat-...`, `npm_...`, `hf_...`, PEM private keys), embedded URL `user:pass@` credentials, legacy `authToken` fields, and malformed non-JSON `globalHeaders` strings (fail-closed) across `.flop` JSON v2 serialization, IndexedDB persistence, Live Preview payloads, and HTML/React/ZIP exports — preserving only explicit safe placeholders (`env:VAR_NAME`, `{{VAR_NAME}}`) and `authSecretRef`.
    2. **Phase 1 — CI Run #638 Root-Cause Fixes (`package.json`, `package-lock.json`, starter Node Logic & Motion Timeline):** Aligned `"packageManager": "npm@10.9.9"` with canonical `lockfileVersion: 3` `package-lock.json`, resolved starter Node Logic interaction regression, and aligned Motion Timeline default tracks.
    3. **Phase 2 — Component-Scoped Per-Instance Node Logic (`src/engines/prototype/componentScope.ts`, `validator.ts`, `runtime.ts`, `parity.ts`, `codegen.ts`, `src/engines/codegen/reactCompiler.ts`):** Per-instance expansion honoring `component.nodeLogicEnabled` and canonical precedence (`Master -> Variants -> Slots -> Local Overrides -> Tokens`), scoped targets (`<instanceId>__<localNodeId>`), isolated per-instance local variables (`<instanceId>::<varId>`) and private memory (`<instanceId>:<frameId>:<nodeId>:<originLayerId>`), accurate `PipelineContext.origin` propagation including nested component instances, component-scoped `action.set-variant` (both pipeline owning-instance fallback and explicit self-target without clobbering Slot/Local overrides), nested child variant prop forwarding even when child `nodeLogicEnabled: false`, and isolated component-scoped `event.on-state-change`. Expanded graphs remain runtime-only and never leak into `.flop` JSON v2.
    4. **Phase 2 — 3-Runtime Behavioral Parity (`tests/helpers/parityRuntimeHarness.ts`, `tests/componentLogicContract.test.ts`, `tests/nodeLogicPhase2Parity.test.ts`):** Real 3-way execution assertions across Headless `PrototypeRuntime`, Live Preview DOM harness, and compiled+executed React TSX VDOM covering Sources, Events (`click`, `double-click`, `click-outside`, `hover`, `input`, `drag`, `key-press` modifiers with zero stale closures, `lifecycle`, `state-change`), State (`get`, `toggle`, `update` including wired `step`), Logic (`branch`, `condition`, `math`, `text`, `list`), Actions (`set-layer` including safe `imageUrl` guard, `set-variant`, `media-animation`, `navigate`, `overlay-toast`, `system-form`), Flow (`control`, `delay`, `loop-timer`), Network (`json`, simulated `http`/`socket`), Legacy v1 migration (13 types), Baked Logic Frames, and Component Instances.
    5. **Quick Interaction Management (`src/app/workspace/quickInteractions.ts`, `src/app/workspace/InspectorInteractionsSection.tsx`):** Verified Inspector ↔ Node Logic authoring routed through `logic.create-graph` / `logic.update-graph` Native Commands with Undo/Redo (`tests/quickInteractions.test.ts`).
  - **Implemented (Simulated/Partial):**
    - `source.external`, `network.http`, and `network.socket` execute as deterministic zero-secret simulations across all 3 runtimes (no real backend execution).
    - `flow.delay` and `flow.loop-timer` run live timers in Live Preview (`full`) and synchronous deterministic simulation in Headless & React TSX (`simulated`), reflected truthfully in `NODE_RUNTIME_PARITY_MATRIX`.
  - **Open:**
    - `variable.persist` and `variable.computed` remain `unsupported` metadata-only across all 3 runtimes (`RUNTIME_FEATURE_PARITY_MATRIX`), emit `UNSUPPORTED_VARIABLE_PERSIST` / `UNSUPPORTED_COMPUTED_VARIABLE` validator warnings, and display *"Metadata only"* hints in `NodeLogicInspector.tsx`.
    - Full arbitrary third-party code visual round-trip, Multi-Application projects, archive-based `.flop` ZIP containers, real backend runtime, AI project control, and multiplayer collaboration remain out of scope / **Agreed (Roadmap)**.
- **Local Automated Gate (2026-11-24):**
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors; strict TypeScript, zero `any`).
  - `npm run test:unit`: **PASS** (**60 test files / 629 tests passed**, including `tests/networkSecretsSecurity.test.ts` 12/12, `tests/componentLogicContract.test.ts` 6/6, `tests/nodeLogicPhase2Parity.test.ts` 11/11, `tests/quickInteractions.test.ts` 4/4, `tests/p12QualityFoundation.test.ts` 5/5).
  - `CHROMIUM_BIN=/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell npm run test:browser`: **PASS** (**4 test files / 11 Chromium tests passed** — `componentRecovery.browser.test.mjs` 5/5, `workspaceGeometry.browser.test.mjs` 1/1, `mergeReadiness.browser.test.mjs` 4/4, `nativePersistence.browser.test.mjs` 1/1).
  - `npm run build` (`tsc --noEmit && vite build`): **PASS** (`dist/` compiled cleanly with 0 chunk-size warnings).
- **Pending / Not Claimed:**
  - External Git commit/push to `codex/pr1-main-reconciliation-20261122`, GitHub Actions CI run on the new pushed HEAD, deployment workflow branch verification, and human manual browser acceptance below remain **pending**.

---

### P0 Stabilization & CI Recovery (2026-11-26)

- **Implementation status:** **Implemented** and **Verified (local)** (2026-11-26).
- **Implemented scope (Categories A–G):**
  1. **Category A — Registry Contract Alignment (`tests/p03SubsystemBoundaries.test.ts`, `tests/precisionTools.test.ts`, `tests/vectorTools.test.ts`, `tests/codeEngineAndMapping.test.ts`):** Audited actual intentional registries (`30` studio tools including `draw-triangle`, `44` Native Commands including `animation.update-custom-easings`, `9` Motion export formats including Animated SVG) and updated exact-count and uniqueness assertions without removing tools, commands, or export formats.
  2. **Category B — Canvas Engine P0.3 Boundary Restoration (`src/shared/shortcutFormatting.ts`, `src/shared/ui/StudioContextMenu.tsx`, `src/engines/canvas/Canvas.tsx`, `src/app/keyboardShortcuts.ts`, `src/app/workspace/StudioContextMenu.tsx`):** Extracted shared shortcut formatting and `StudioContextMenu` into `src/shared/` so `src/engines/canvas/**` has zero imports from `src/app/**` while preserving context-menu interaction, positioning, and callbacks.
  3. **Category C — Motion Timeline Scrub Accuracy & Keyboard Bubbling Fix (`src/app/workspace/motionTimelineMath.ts`, `src/app/workspace/MotionTimelinePanel.tsx`, `tests/motionTimelineScrub.test.ts`, `tests/mergeReadiness.browser.test.mjs`):** Eliminated double-increment keyboard scrub bubbling (`stopPropagation()` + `defaultPrevented` guard + duration clamping + `Home`/`End`), extracted live-bounds scrub coordinate math (`computeTimelineScrubMs`, `computePlayheadPercent`, `resolveTimelineTrackBounds`) measuring `.mt-ruler-track` / `.mt-lane-track` live on `pointerdown`/`pointermove`/resize, guarded `setPointerCapture` against `NotFoundError` with `pointercancel` cleanup, updated browser test to launch Live Preview via `[data-testid="motion-more-btn"] -> Test in Live Preview`, and added unit + browser assertions covering start (`0.00s`), mid (`0.60s`), end (`1.20s`), custom ruler padding (`0 40px`), post-resize (`760px`), and playhead `%` parity.
  4. **Category D — Preact Hooks & `preact/compat` VNode Normalization (`tests/inspectorModularization.test.tsx`, `tests/vectorDrawingTools.test.tsx`, `tests/inspectorSliders.test.tsx`):** Added hoisted `preact/hooks` harnesses for direct VNode rendering of extracted hook-using sections while asserting zero hook calls across all 4 modes of the hook-free `InspectorPanel` root, and aligned slider VNode prop inspection with `preact/compat` normalization (`oninput`/`onfocusout`) while verifying `onChange === undefined` and `oninputCapture === undefined`.
  5. **Category E — Reproducible `package.json` & Canonical `package-lock.json`:** Added `"packageManager": "npm@10.9.9"` to `package.json` and generated a canonical `lockfileVersion: 3` `package-lock.json` with HTTPS `resolved` URLs and `sha512-` integrity hashes passing plain `npm ci --no-audit --no-fund` and `tests/p12QualityFoundation.test.ts` (5/5).
  6. **Category F — `App.tsx` (< 1,200 lines) & `InspectorPanel.tsx` (< 650 lines) Modularization (`src/app/App.tsx`, `src/app/InspectorPanel.tsx`, `src/app/workspace/inspectorPanelTypes.ts`, `useWorkspaceDialogs.ts`, `useAnimatedComponentsClock.ts`, `useWorkspaceMotionBridge.ts`, `useWorkspaceChromeActions.ts`, `canvasContextMenuExtras.ts`, `WorkspaceStudioOverlays.tsx`):** Reduced `App.tsx` to 1,183 lines and `InspectorPanel.tsx` to 556 lines with zero Native Command bypasses and all workspace boundary tests green.
  7. **Category G — WCAG Starter Fixture Alignment (`tests/a11yAudit.test.ts`):** Verified both default transparent starter artboard (`SKIPPED_HEADING_LEVEL` -> `100/100`) and warm `#F5F2EC` artboard (`CONTRAST_TOO_LOW` + `SKIPPED_HEADING_LEVEL` -> `100/100`) auto-fix round-trips.
- **Local Automated Gate (2026-11-26):**
  - `npm ci --no-audit --no-fund`: **PASS** (116 packages).
  - `npm run check` (`tsc --noEmit`): **PASS** (0 errors).
  - `npm run test:unit`: **PASS** (**91 test files / 858 tests passed**, including new `tests/motionTimelineScrub.test.ts` 4/4 and all Morph, Export Parity, P0.3 boundary, P1.2 lockfile, Inspector, and Workspace module suites).
  - `npm run test:browser`: **PASS** (**4 test files / 11 Chromium tests passed** — `mergeReadiness.browser.test.mjs` 4/4, `componentRecovery.browser.test.mjs` 5/5, `workspaceGeometry.browser.test.mjs` 1/1, `nativePersistence.browser.test.mjs` 1/1).
  - `npm run build` (`tsc --noEmit && vite build`): **PASS** (`dist/` compiled cleanly).
  - Live headless Chromium visual QA (`playwright-cli` against `http://localhost:3000/folio-studio/` at `1440×900`): **PASS** — verified initial hydration, Motion Timeline keyboard + pointer scrub, Inspector selected-node rendering, Canvas right-click shared `StudioContextMenu`, and **0 console errors / 0 warnings**.
- **Pending / Not Claimed:**
  - Remote GitHub Actions CI run on a pushed branch and human manual browser acceptance below remain **pending** (this sandbox has no `.git` remote).

---

## Consolidated Manual Browser Acceptance Checklist (PR #17 Readiness)

Execute on the target desktop browser (Chrome/Edge on Windows 10) against a fresh `npm run dev` or `npm run build && npm run preview` session. Record **PASS / FAIL** per item before approving merge of PR #17 into `main`.

### 1. Main Canvas
- [ ] Initial starter project renders cleanly with zero console errors or page exceptions.
- [ ] Create Rectangle (`R`), Ellipse (`O`), Text (`T`), and Vector/Path shapes; verify drag snapping guides, 8-handle resize, multi-selection align/distribute, `Space` + drag pan, and zoom (`Ctrl/Cmd + Wheel` / Scrubby Zoom).
- [ ] Switch responsive breakpoints (`Desktop` / `Tablet` / `Mobile`) and confirm Auto-Layout & breakpoint overrides update without corrupting base desktop geometry.
- [ ] Toggle Canvas renderer mode (`Auto` / `GPU` / `SVG`) on a dense scene (`>= 250` nodes) and confirm crisp overlays, hit-testing, and zero visual glitches.

### 2. Component Canvas
- [ ] Create a Master Component from a multi-layer selection (including a Group or Clipping Mask), verify a live proportional SVG preview appears in Component Rack, and edit the master in Component Canvas (`420×280` centered placement & readable contrast).
- [ ] Update the master in place via the master Save action and confirm Component Rack count does not duplicate; confirm explicit Save-as-New creates a distinct master.
- [ ] Configure a Variant Axis and Named Slot on the master, place an instance on Main Canvas with Slot + Local Override values, and confirm `Master -> Variants -> Slots -> Local Overrides -> Tokens` precedence visually.
- [ ] Test active master deletion with unsaved Component Canvas edits: verify `Cancel`, `Save buffer as a new component`, and `Discard buffer and delete` keyboard focus trapping (`Tab`/`Shift+Tab`/`Escape`) and reload durability.

### 3. Component-Scoped Node Logic (Multi-Instance)
- [ ] Enable `nodeLogicEnabled` on a master component with an internal button + label and create a component-scoped Node Logic graph (`event.on-click` -> `state.toggle` / `state.update` / `action.set-layer` / `action.set-variant`).
- [ ] Place **2+ instances** (Instance A and Instance B) of that master on the same page; apply a Slot text override and Local fill override on Instance B.
- [ ] Launch Live Preview (and inspect Simulate): click Instance A and confirm **only Instance A** updates its state, label, fill, and variant; Instance B remains untouched.
- [ ] Click Instance B and confirm its variant attribute switches without clobbering its Slot text or Local fill override.
- [ ] Place a nested component instance inside an outer master and confirm outer logic targeting the child updates only the clicked outer instance's child.

### 4. Node Logic Studio + Smart Logic Frames + Security
- [ ] Open Node Logic Workspace, drag nodes from the 7-category catalog (31 primary nodes), connect `execution` and `data` wires, and confirm invalid port combinations or dataflow cycles are rejected with clear feedback.
- [ ] Wrap a toggle sub-graph in a Smart Logic Frame, click **Bake**, instantiate it as a reusable Frame Preset on a second target, and verify independent per-frame private memory in Simulate & Live Preview.
- [ ] In Network Settings, enter an `authSecretRef` (`API_TOKEN`) and attempt to paste a raw `Authorization: Bearer sk-live-...` entry into `globalHeaders`; confirm validator flags it AND confirm exported `.flop` JSON, Live Preview HTML, and React TSX contain **zero** raw tokens/sensitive header values.
- [ ] Toggle `persist` or `computed` on a graph variable and confirm the Inspector displays *"Metadata only"* and Diagnostics emits non-fatal warnings without throwing runtime/storage errors.

### 5. Quick Interactions (Inspector ↔ Node Logic)
- [ ] Select a layer on Main Canvas, open the Inspector **Interactions** section, and create a Quick Interaction (e.g., `On Click -> Toggle Visibility` or `Show Toast`).
- [ ] Confirm the generated trigger + action nodes appear in Node Logic Workspace via **Jump to Graph**, edit the Quick Interaction from the Inspector, verify in Live Preview, then press `Ctrl+Z` / `Ctrl+Shift+Z` to confirm clean Undo/Redo through Native Commands.

### 6. Motion Timeline Studio
- [ ] Dock/open Motion Timeline, inspect the starter `Hero Entrance` clip (verifying >= 4 default tracks), scrub the playhead across `0.0s..1.2s`, and confirm live non-destructive Canvas pose updates.
- [ ] Add/edit a keyframe, trigger playback in Live Preview, and confirm compiled CSS includes `@keyframes` and `@media (prefers-reduced-motion: reduce)`.

### 7. Code & Preview Studio / Accessibility / Export ZIP
- [ ] Switch between `HTML / CSS` and `React TSX` tabs, open Live Preview, and confirm interactive behavior matches Headless Simulate.
- [ ] Open the Accessibility Audit drawer, run **`Fix All`**, confirm score improves, and press `Ctrl+Z` to confirm 1-step atomic Undo restores prior state.
- [ ] Edit a Custom/Extension code module, verify consecutive keystrokes coalesce into 1 Undo step, and verify canvas edits preserve the custom module.
- [ ] Click **`Export ZIP`** for both `HTML / CSS` and `React TSX`; extract the React ZIP locally and spot-check `npm install && npm run build` succeeds cleanly.

### 8. `.flop` Save/Reload & Persistence
- [ ] Choose `File -> Export Project` to download a `.flop` file; inspect the JSON to confirm `format: "folio-project"`, `formatVersion: 2`, zero raw credentials in `globalHeaders`/`networkSettings`, and zero leaked expanded component-instance graph IDs (`__inst::` / `inst__child`).
- [ ] Reload the browser and verify IndexedDB restores the latest durable project automatically; open the exported `.flop` via `File -> Open Project`, cancel once (confirm no state change), then import and confirm all pages, components, tokens, animations, code modules, and logic graphs restore identically.

### 9. Undo/Redo & Cross-Studio Integrity
- [ ] Perform sequential edits across Canvas transform, Component Contract, Node Logic, Motion Timeline, and Code Editor; step backward (`Ctrl+Z`) and forward (`Ctrl+Shift+Z`) across all changes and confirm no orphaned references or state drift.
- [ ] Delete a layer referenced by Node Logic, Motion Timeline, and a Code Extension anchor; confirm warning badge/toast appears and 1-step `Ctrl+Z` restores both the layer and all cross-studio references atomically.

### 10. Low-Resource Device Performance Check
- [ ] Test on the target Windows 10 laptop (or Chrome DevTools **4× CPU throttle** + **Slow 3G / cache disabled** cold load): confirm shell boots cleanly with zero uncaught errors and interactive lag stays acceptable during pan/zoom/drag.
- [ ] Open `Help -> Scene Profiler & Health`, click **`Run Live Profile`**, and verify all 8 engine stages report healthy timings without freezing the UI; optionally run `npm run benchmark -- --scale=medium` locally to record baseline numbers.






