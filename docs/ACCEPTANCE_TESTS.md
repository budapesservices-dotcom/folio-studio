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
10. **Native export:** choose Export. A `.flop` file should download and contain a JSON object with `format: "folio-project"` and `formatVersion: 1`.
11. **Native import:** choose Open, select the exported `.flop`, and confirm the document returns.
12. **Invalid import:** select a random text/JSON file or a `.flop` with a different version. Folio should show an error and keep the current project intact.

Do not start Stage 2 until the checks above pass on the target Windows 10 laptop and the intended browser.
