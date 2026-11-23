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



