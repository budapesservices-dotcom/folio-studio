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

Automated verification (2026-11-20): GitHub Actions run [#44683500588](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44683500588) completed successfully on Node.js 26 for this revision. `npm run check`, `npm run test` and `npm run build` all passed, including the IndexedDB transaction-abort rollback and export timestamp consistency tests.

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