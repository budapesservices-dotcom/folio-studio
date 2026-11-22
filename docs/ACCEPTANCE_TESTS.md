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
