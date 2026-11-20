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

## Current native project file status

The repository currently contains a native JSON project-file adapter in `src/core/persistence/projectFile.ts`:

- `downloadProject` serializes the current project model and downloads a `.flop` file.
- `readProjectFile` parses the file and passes it through `migrateProjectToV2`, which supports legacy v1 input and the current v2 model.

These adapter functions are not yet wired into the application's File menu. In the current `src/app/App.tsx`, the File menu entry is still a placeholder. Therefore, browser-level Open/Export checks cannot be completed through the current UI and must not be reported as passed.

## Deferred acceptance — native .flop file workflow

Activate these checks once File menu integration is implemented:

1. **Export:** choose Export and confirm a `.flop` file downloads.
2. **Format:** inspect the exported file and confirm `format: "folio-project"` and `formatVersion: 2`.
3. **Import:** open the exported file and confirm the project returns with its page and node IDs intact.
4. **Legacy import:** open a supported v1 single-document file and confirm migration to v2 preserves its document content and node IDs.
5. **Invalid import:** select an invalid JSON file or unsupported format version. Folio must show an error and keep the currently open project unchanged.
6. **Round trip:** export → import → export and compare project semantics, node IDs, component references, and layer order.

Do not mark native file workflow acceptance as verified until the File menu is connected and all deferred checks pass.

Do not start Stage 2 until the Stage 1 automated checks and manual browser checks above pass on the target Windows 10 laptop and intended browser.