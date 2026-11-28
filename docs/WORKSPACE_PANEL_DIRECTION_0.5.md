# FOLIO Workspace Panel Direction 0.5

**Status:** Superseded. The first floating-window implementation has been removed in preparation for a clean, unified Window System.

## Current decision

FOLIO will not keep the previous collection of independently implemented Canvas, Logic Nodes, Component Rack, Component Canvas and Code View windows.

The old panel toggles, floating-window controls, drag/resize handlers, minimize/maximize state, and drawer behavior have been removed from the application shell. The Canvas editor remains as the central workspace, but it is no longer a draggable or independently closable window.

## Rebuild principle

A new Window System will be designed as one shared foundation before individual window types are reintroduced.

The future system must define consistent behavior for:
- window frame and titlebar;
- open, close, minimize and maximize/restore;
- drag coordinates and movement boundaries;
- resize constraints;
- stacking and focus;
- responsive behavior and persistence.

Individual windows may differ in content and initial geometry, but not in their interaction model.

## Preserved application foundations

- Global application menu row and project identity.
- Browser Fullscreen control.
- Layers and Inspector docks.
- Central Canvas editor and its drawing/selection tools.
- Project document model, local autosave and .flop persistence.
- Undo/redo, alignment, distribution and zoom controls.

This document records the retired implementation and the direction for the next Window System. It does not claim the replacement system has been implemented.
