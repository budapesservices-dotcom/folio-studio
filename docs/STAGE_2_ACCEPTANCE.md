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
8. Try Undo once after a drag, resize, or alignment. Each complete gesture should be a single history step. Redo should restore it.
9. Verify a locked layer cannot be dragged or resized.
10. Refresh the browser and confirm the final geometry is restored by autosave.

Do not begin the next engine until these checks pass in the target browser.
