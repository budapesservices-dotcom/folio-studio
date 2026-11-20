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

Implementation status: the File menu workflow is implemented. Verification remains pending until the automated checks and manual browser steps below have actually passed.

- File → Open Project selects a .flop file and delegates parsing, v1 migration and v2 validation to the existing persistence adapter. The active main project is replaced only after successful validation.
- Cancelled selection and failed parsing/migration/validation do not dispatch project replacement. The picker value is cleared after every selected file so the same file can be selected again.
- File → Export Project passes the complete active project aggregate to downloadProject, retaining project metadata, pages, documents, nodes, component definitions, logic graph reservations and asset references.
- tests/projectFile.test.ts covers v2 import, v1 migration, invalid JSON, unsupported versions, failed imports, extension-field preservation and full-aggregate export. tests/document.test.ts covers reducer replacement history reset and imported metadata preservation.

### Manual browser acceptance

1. **Export:** choose File → Export Project and confirm a named .flop file downloads.
2. **Format:** inspect the exported file and confirm format is folio-project and formatVersion is 2.
3. **Import:** open the exported file and confirm the project, active page, page/document/node IDs, components, logic graph reservations and asset references are restored.
4. **Legacy import:** open a supported v1 single-document file and confirm migration to v2 preserves its document ID, node IDs and extension data.
5. **Invalid import:** select invalid JSON, an invalid project or an unsupported format version. Folio must show an English error and keep the active project unchanged.
6. **Retry:** after a failed import, select the same file again. The file picker must accept the repeated selection.
7. **Cancellation:** open the picker and cancel. The active project and its undo/redo state must remain unchanged.
8. **History reset:** after a successful import, confirm Undo and Redo do not restore history from the previously open project.
9. **Round trip:** export → import → export and compare project semantics, IDs, component references, logic graph reservations, asset references and layer order.

Do not mark native file workflow acceptance as verified until the automated checks and manual browser checks above pass.
Do not start Stage 2 until the Stage 1 automated checks and manual browser checks above pass on the target Windows 10 laptop and intended browser.