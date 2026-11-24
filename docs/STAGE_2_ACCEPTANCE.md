# Stage 2 — Canvas Engine Acceptance

Run the checks from the repository root:

```bash
npm run check && npm run test && npm run build
```

## Pointer and selection checks

1. Drag one unlocked rectangle, ellipse, or text object on the artboard. Its inspector coordinates should update after release.
2. Drag a selected object and verify nearby artboard edges, center lines, and other visible object edges produce purple alignment guides and snap into place.
3. Shift-click or Ctrl/Cmd-click a second object. Both layer rows should remain highlighted and a shared selection outline should surround them.
4. Drag a multi-selection. All selected unlocked objects should move together while maintaining their relative positions.
5. Resize a single object from each of the eight handles. The opposite edge should remain anchored.
6. Resize a multi-selection from a corner or edge. The selected objects should scale together as one group.
7. Use the six alignment controls to align left, horizontal center, right, top, vertical center, and bottom.
8. Select at least three objects and use **Distribute horizontally** or **Distribute vertically**. The outermost edges should remain fixed, gaps should become equal, and object sizes/order should remain unchanged.
9. Verify distribute controls are disabled with fewer than three selected objects.
10. Hold **Space** and drag the canvas to pan. Repeat with the middle mouse button. The gesture must not move or select artwork.
11. Release the pan gesture and verify regular selection, object dragging and resize still work. Space must remain usable in text inputs and buttons.
12. Try Undo once after a drag, resize, alignment, or distribution. Each complete gesture should be a single history step. Redo should restore it.
13. Verify a locked layer cannot be dragged or resized.
14. Refresh the browser and confirm the final geometry is restored by autosave.

## Browser fullscreen checks

- The Fullscreen API toggle is exposed in the right-side workspace group of `GlobalToolbar` (`src/app/workspace/GlobalToolbar.tsx`). Status: **Implemented**; human manual browser acceptance remains **pending**.
- Do not treat browser F11 as FOLIO's Fullscreen API implementation; it is browser-managed fullscreen.
- Verify entry through direct user click on the toolbar fullscreen toggle, browser chrome hiding, Escape exit, toolbar active-state synchronization, and graceful fallback when the Fullscreen API is unavailable.

## Regression gate

- Existing snapping guides and selection behavior continue to work.
- Canvas pan does not alter document geometry or create an undo history entry.
- Distribution changes position only; dimensions and appearance remain unchanged.
- Do not begin the next engine until the automated checks and manual checks pass in the target browser. See also the [Consolidated Manual Browser Acceptance Checklist](ACCEPTANCE_TESTS.md#consolidated-manual-browser-acceptance-checklist-pr-17-readiness).

