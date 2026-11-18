# FOLIO Workspace Panel Direction 0.5

**Status:** Initial interactive panel shell implemented; underlying Logic, Component and Code engines remain planned.

## 1. Global toolbar

The first row keeps the six application menus in order:
**File | Edit | View | Tools | Option | Help**

Immediately after the menus, display the active project filename and `.flop` extension. Align five compact square panel toggles at the right:
1. Canvas
2. Logic Nodes
3. Component Rack
4. Component Canvas
5. Code View

Each toggle has hover feedback and a persistent active appearance while its corresponding panel is open. Clicking an open toggle closes that panel; clicking it again reopens it.

## 2. Floating windows

The Canvas, Logic Nodes, Component Canvas and Code View panels are separate floating windows. Each window has a compact titlebar with small controls in its upper-right corner:
- Minimize: retain the titlebar while hiding panel contents.
- Expand: enlarge the window to the available workspace area; activate again to restore its prior dimensions.
- Close: hide the window. The corresponding global toolbar toggle can reopen it.

The Canvas is open by default. Other floating windows start closed. Opening one window must not implicitly close the others.

## 3. Component Rack drawer

Component Rack is not a floating window. It slides upward from the bottom of the application, above the status bar. Its global toggle controls open/close; the drawer itself has a close affordance.

## 4. Current implementation boundary

The panel open/close, active button state, window minimize/expand/close and bottom drawer presentation are implemented in the application shell.

The Logic Nodes, Component Canvas, Component Rack library contents and Code View currently show presentation placeholders. They do not imply that the respective node engine, component system, library or code generation is complete.

## 5. Workspace and project state

- Panel visibility is application workspace state, not part of the `.flop` document AST.
- Opening and closing a panel must not mutate document content, selection or undo history.
- The existing canvas interactions remain inside the floating Canvas window.
- The existing Layers and Inspector side areas remain separate from the five global panel toggles.
