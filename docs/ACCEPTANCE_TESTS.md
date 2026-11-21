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

### GPT4 manual browser acceptance gate — Component Canvas deletion and recovery

The following App-level scenarios are a separate manual acceptance gate. They are not covered by the automated Main Canvas autosave / native IndexedDB test and must not be reported as passed until GPT4 exercises them against the actual application:

1. **Cancel:** make the active Component Canvas buffer dirty, request deletion of its master, choose Cancel, and verify the master, buffer contents, history, active session, and canonical project revision remain unchanged.
2. **Save as new:** choose Save buffer as a new component and verify the recovery component's complete document is durably committed before the original master's compare-and-swap (CAS) deletion is attempted.
3. **Stale CAS:** change the canonical master after the recovery copy is durable but before deletion. Verify both the recovery copy and original master remain, and the local buffer is preserved.
4. **Recovery persistence failure:** force the recovery-copy IndexedDB write to fail. Verify the original master deletion is never attempted, the original master remains, and the local buffer remains editable and recoverable.
5. **Deletion persistence failure:** allow the recovery copy to become durable, then force the canonical deletion write to fail. Verify the original master and local buffer are not cleared; retry must not create a duplicate recovery copy.
6. **Discard ordering:** choose Discard buffer and delete. Verify the local buffer is cleared only after the canonical deletion transaction has completed durably.
7. **Clean active-master deletion:** verify canonical deletion and Component Canvas cleanup each reach their required IndexedDB completion barriers before the Component Canvas closes or resets.
8. **Modal accessibility:** verify initial focus is placed inside the dialog; Tab and Shift+Tab remain trapped; Escape maps to the safe Cancel action; background content is inert and cannot be activated; focus returns to the invoking control after close.
9. **Failure and retry:** reload after each injected failure and verify the last durable canonical project and Component Canvas buffer are restored without silent data loss.

GPT4 must record each scenario as PASS, FAIL, or NOT RUN with reproducible observations. These manual deletion/recovery and modal scenarios remain pending until independently verified; passing the automated Chromium autosave test does not close this gate.
