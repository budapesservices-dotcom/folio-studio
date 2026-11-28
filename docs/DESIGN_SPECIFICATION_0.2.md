# FOLIO Design Specification 0.2

**Product:** FOLIO  
**Application:** Folio Studio  
**Specification version:** 0.2  
**Date:** 2026-11-18  
**Status:** Approved direction; implementation specification  
**Applies to:** Desktop editor shell, workspace layout, navigation, panels, visual system and interaction conventions

> This is a product/UI specification, not an application release or a claim that every described feature is already implemented. Existing functionality and future requirements are identified separately.

---

## 1. Product design decisions

The following decisions are confirmed and should be treated as the design baseline until explicitly changed.

| Dimension | Decision |
|---|---|
| Workspace density | **Professional** |
| Theme | **Dark** |
| Workspace model | **Adaptive** |
| Product direction | Hybrid visual design, prototyping, animation and visual-to-code |
| Native project format | `.flop` |
| Design data source of truth | Versioned JSON AST |

### 1.1 What the decisions mean

**Professional density**

FOLIO should expose a rich set of useful controls and contextual information without making the interface feel crowded or reducing readability. Common operations should be discoverable and close to the canvas. Rare or destructive operations may live in menus or context menus. Professional density does not mean using tiny text or showing every possible option at once.

**Dark theme**

The primary and initially supported visual direction is a dark editor interface. Canvas/artboard colors remain document-controlled and are not forced to use the dark application theme. A light theme is outside this specification.

**Adaptive workspace**

The editor panels must be resizable, collapsible and movable between defined docking zones. Panel arrangements should be able to form tab groups. The first implementation should use predictable docking zones rather than unrestricted floating windows. Floating panels can be considered later if real workflows require them.

---

## 2. Product experience principles

1. **Canvas-first:** the design surface receives the largest practical share of the workspace.
2. **Contextual controls:** the Inspector changes according to the current selection and editing context.
3. **User-controlled workspace:** users can resize, collapse and rearrange panels without losing access to essential tools.
4. **Discoverable depth:** common tools are visible; advanced operations remain reachable through menus, context menus and command search.
5. **Consistent interaction:** the same action should behave consistently in the toolbar, menu, shortcut and context menu.
6. **Readable professional density:** compact spacing is balanced with clear labels, hit targets and visual hierarchy.
7. **Document/UI separation:** workspace preferences must not be confused with design content stored in the `.flop` document.
8. **Progressive capability:** future modes must extend the same document model and application shell rather than becoming disconnected mini-applications.

---

## 3. Application information architecture

### 3.1 Main application regions

The desktop editor is composed of these regions:

1. **Application bar:** identity, menus, project identity, save state and primary file actions.
2. **Tool rail:** selection, creation and navigation tools.
3. **Left dock:** contextual navigation panels such as Pages, Layers and Assets.
4. **Canvas workspace:** artboard, rulers, guides, viewport controls and selection feedback.
5. **Right dock / Inspector:** contextual properties and object controls.
6. **Bottom dock:** optional contextual workspace such as animation timeline, code/diagnostic output or other future tools.
7. **Status bar:** concise document and workspace status.

The canvas workspace remains the primary central region. Docks must not permanently consume excessive canvas width.

### 3.2 Proposed desktop layout

```text
┌─────────────────────────────────────────────────────────────────────┐
│ FOLIO  File Edit View Object Arrange Plugins Help   Project  Saved   │
├──────┬──────────────────┬───────────────────────────┬────────────────┤
│      │ Pages Layers     │ Design Prototype Animate  │ Inspector      │
│ Tool │ Assets           ├───────────────────────────┤ contextual     │
│ rail │                  │                           │ properties     │
│      │ Navigation dock  │       Canvas / Artboard   │                │
│      │                  │                           │                │
│      │                  │                           │                │
├──────┴──────────────────┴───────────────────────────┴────────────────┤
│ Optional bottom dock: Timeline / Code / Diagnostics / other panels  │
├─────────────────────────────────────────────────────────────────────┤
│ Status: selection · dimensions · zoom · save state                   │
└─────────────────────────────────────────────────────────────────────┘
```

This is a structural diagram, not a pixel-perfect mockup. The bottom dock is contextual and may remain closed when not needed.

### 3.3 Workspace modes

The application should be prepared for four work modes:

- **Design:** visual object creation, layout, styling and assets.
- **Prototype:** connections, events, overlays, navigation and preview.
- **Animate:** timeline, tracks, keyframes, easing and playback.
- **Code:** generated code, inspection and visual-to-code workflow.

Mode switching changes the relevant contextual tools and panels. It must not replace the active project or create a separate document state.

Only Design is part of the current functional MVP. The other modes are future capabilities and must not be shown as working features until implemented.

---

## 4. Adaptive panel system

### 4.1 Docking zones

The first adaptive implementation supports three docking zones:

- **Left dock:** Pages, Layers, Assets and related navigation panels.
- **Right dock:** Inspector and contextual property panels.
- **Bottom dock:** Timeline, Code, Diagnostics and future contextual panels.

Panels may be resized, collapsed and moved between these zones. Multiple panels may share a dock as tabs. A user can restore a panel from the panel menu when it is closed or collapsed.

Unrestricted floating windows are not required for the first adaptive release.

### 4.2 Panel behavior

- Dragging a panel tab or header shows valid docking targets.
- Dropping on a valid target docks the panel in that zone.
- Dropping onto an existing panel group creates or joins a tab group.
- Dock splitters resize neighboring panels.
- Collapse preserves the panel's state and provides a clear way to reopen it.
- Closing a panel hides it; it does not delete data or disable its engine.
- The application provides **Reset Workspace** to restore the default panel arrangement.
- Panel layout changes must not modify the active `.flop` document.

### 4.3 Initial sizing guidance

These are starting values for desktop implementation and should be tuned after browser testing.

| Region | Default | Suggested minimum | Suggested maximum |
|---|---:|---:|---:|
| Tool rail | 52 px | 44 px | 64 px |
| Left dock | 260 px | 200 px | 380 px |
| Right dock | 300 px | 240 px | 420 px |
| Bottom dock | 220 px high when open | 140 px | 45% of workspace height |
| Application bar | 64 px total target | — | — |
| Status bar | 24 px | — | — |

The canvas receives all remaining space. Panel resizing must enforce minimum canvas width and must not cause the application to overflow horizontally at supported desktop widths.

### 4.4 Workspace persistence

Panel arrangement, open tabs, collapsed state and panel dimensions are user workspace preferences, not document content. Store them separately from the `.flop` AST so that opening a design file does not unexpectedly replace the user's preferred editor layout.

The initial default workspace should be deterministic. A reset action must always recover it.

---

## 5. Application bar and navigation

### 5.1 Application bar

The application bar should provide:

- FOLIO identity and application name.
- Menus: **File, Edit, View, Object, Arrange, Plugins, Help**.
- Current project name and native extension indicator.
- Clear save state: Saving, Saved, Save error.
- Primary file actions: New, Open and Export.
- Workspace mode entry points when the mode system is introduced.

Do not show duplicate commands in multiple permanent locations if they compete for attention. Primary commands may appear in the bar and also in the relevant menu/shortcut.

### 5.2 Menu responsibilities

| Menu | Responsibility |
|---|---|
| File | New, Open, Save, Save As, Import, Export, project settings |
| Edit | Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Preferences |
| View | Zoom, fit, rulers, grid, guides, panels, reset workspace |
| Object | Group, Ungroup, Lock, Unlock, Hide, Show, object operations |
| Arrange | Align, distribute, order, spacing and positioning |
| Plugins | Installed plugins and plugin management (future) |
| Help | Shortcuts, documentation, feedback and About |

Commands that are not implemented must remain hidden or clearly marked unavailable; they must not be presented as functional.

### 5.3 Project identity and save state

- The project name is editable.
- The native extension is displayed as identity/context, not as an editable suffix.
- Save state must use text as well as color; color alone is insufficient.
- A save error must offer a useful recovery message.
- New/Open actions that could discard unsaved work must eventually use a dirty-state guard.

---

## 6. Tool rail

The tool rail is a compact, persistent entry point to creation and navigation tools. Tools are grouped conceptually, even if some groups expand through flyouts.

### 6.1 Planned tool groups

| Group | Tools |
|---|---|
| Selection | Select, Direct Select (future), Hand/Pan |
| Layout | Frame |
| Shapes | Rectangle, Ellipse, Line, Polygon and other vector primitives |
| Vector | Pen, Pencil and node editing (future) |
| Content | Text, Image |
| Reuse | Components and Assets (future) |

The current Select, Rectangle, Ellipse and Text tools remain part of the MVP. Other tools are planned, not implemented.

### 6.2 Tool behavior

- Active tool state must be visually distinct.
- Every icon button must have a tooltip and accessible name.
- Related tools may share a flyout to preserve rail space.
- Keyboard shortcuts should be shown in tooltips where assigned.
- Temporary Hand/Pan behavior must coexist with the Space-drag and middle-mouse canvas pan gesture.
- A tool must not appear active unless its behavior is implemented.

---

## 7. Left dock: Pages, Layers and Assets

### 7.1 Panel organization

The left dock should provide tabbed access to:

- **Pages:** document/page navigation and page-level actions (multi-page document support is future work).
- **Layers:** object hierarchy and selection.
- **Assets:** reusable styles, components and imported media (future work).

For the current one-page document model, Pages should show the active page clearly without implying multi-page functionality is already supported.

### 7.2 Layers panel requirements

Each layer row should expose:

- A type icon.
- Editable layer name.
- Visibility toggle with a real independent click target.
- Lock toggle with a real independent click target.
- Selection state.
- Drag affordance for reordering when the document model supports the required ordering behavior.

Additional requirements:

- Double-click or an explicit rename command edits a layer name.
- Right-click opens a context menu.
- Multi-selection is clear and consistent with canvas selection.
- Hidden layers remain available in the panel.
- Locked layers remain selectable in Layers for inspection but cannot be transformed on the canvas.
- Group hierarchy must be represented by nesting when groups are implemented.
- Empty state offers useful insertion actions.

**Important current-code audit:** the eye glyph currently shown on layer rows is not an independent visibility control; clicking the row selects the layer. The current implementation therefore does not yet meet this specification. The Inspector has visibility and lock toggles for a selected node. This must be corrected before the Layers panel is considered professionally complete.

### 7.3 Layer ordering

Layer order must have a documented relationship with canvas stacking order. Reordering should use one clear convention and must be reflected immediately in the canvas. Do not add drag-reordering until ordering, selection and history behavior have tests.

---

## 8. Canvas workspace

### 8.1 Canvas presentation

The canvas workspace should include:

- A neutral dark work area separate from the artboard background.
- Optional rulers.
- Optional grid and guides.
- Clear artboard/page identity and dimensions.
- Selection outlines and transform handles.
- Snapping guides.
- Zoom controls and zoom-to-fit.
- Pan using Space-drag, middle mouse or the Hand tool.
- View controls that do not alter document geometry.

The artboard should remain visually distinct from the surrounding workspace. The document's own background color belongs to the document model.

### 8.2 Canvas toolbar

The canvas contextual toolbar should provide the most common viewport and arrangement controls:

- Undo and Redo.
- Zoom out, zoom percentage, zoom in.
- Zoom to Fit.
- Zoom to Selection.
- Toggle rulers.
- Toggle grid.
- Snap settings.
- Selection alignment and distribution when the selection supports those actions.

Controls must be contextual: alignment requires at least two selected objects; distribution requires at least three.

### 8.3 Selection and transformation

- Single selection displays the selected object's bounds and relevant handles.
- Multi-selection displays shared bounds and clearly communicates the number of selected objects.
- Transform preview is separate from committed document changes.
- A completed drag/resize gesture creates one history step.
- Pan and zoom do not create document history entries.
- Locked objects cannot be transformed from the canvas.
- Selection changes must remain synchronized between canvas and Layers.

### 8.4 Viewport behavior

- Panning moves the viewport, not the document objects.
- Zoom should use a consistent reference point and preserve a predictable view.
- Zoom-to-fit must fit the active artboard within the visible canvas region with sensible margins.
- Rulers, grid and guides are view aids and must not silently become document objects.
- Canvas overflow is clipped within the workspace; the entire application should not gain accidental page scrolling.

---

## 9. Right dock: contextual Inspector

The Inspector must never be a mostly empty panel when there is useful context to show. Its content changes with the current selection.

### 9.1 No selection: page/canvas context

Show relevant page-level properties, such as:

- Page name.
- Width and height.
- Background color.
- Grid and ruler preferences.
- Export area/settings when available.

Do not display object-only controls when no object is selected.

### 9.2 Single object selected

Organize object properties into clear sections:

1. **Identity:** layer name and object type.
2. **Transform:** X, Y, width, height, rotation, and proportional resize behavior.
3. **Appearance:** fill, stroke, opacity, corner radius where applicable.
4. **Typography:** text content, font family, font size, weight, line height, letter spacing and alignment for text objects.
5. **Layout:** constraints and sizing behavior when the layout engine exists.
6. **Effects:** effects when the rendering model supports them.
7. **Layer options:** visibility and lock.

Sections may collapse, but the most frequently used sections should be easy to reach.

### 9.3 Multiple objects selected

Show common operations:

- Selection count.
- Shared transform/bounds where appropriate.
- Align and distribute.
- Shared appearance properties only when compatible.
- Group and ungroup when supported.
- Lock, unlock, hide and show.
- Clear selection.

Do not show misleading single-object fields when several objects with different values are selected.

### 9.4 Property editing behavior

- Numeric fields must allow precise entry.
- Invalid values must be normalized or rejected with useful feedback.
- Color controls should show both swatch and readable color value.
- A property edit must update the canvas immediately.
- History should group continuous edits sensibly rather than recording every keystroke as a separate undo step.
- Changes must flow through the document model and existing command/reducer boundary.

---

## 10. Bottom dock and future workspaces

The bottom dock is contextual and closed by default in the Design MVP.

Future uses include:

- **Animate:** timeline, layers/tracks, keyframes, playback and easing controls.
- **Code:** generated source, code inspection and diagnostics.
- **Prototype:** interaction/flow inspection or test output where appropriate.

The dock must be resizable and collapsible. Opening it must reduce the canvas area without covering or corrupting document content.

Do not create empty permanent panels simply to advertise features that do not exist.

---

## 11. Visual design system

These tokens are the proposed starting palette for implementation. They are not a requirement to replace every existing color without checking contrast and component states.

### 11.1 Color tokens

| Token | Proposed value | Usage |
|---|---|---|
| App background | `#101319` | Outer workspace |
| Application chrome | `#171B24` | Top and status bars |
| Panel | `#1B202B` | Docks and panels |
| Raised surface | `#222938` | Inputs, hover surfaces and menus |
| Border | `#303847` | Panel and control boundaries |
| Primary text | `#EDF0F6` | Main labels and headings |
| Secondary text | `#A0A9B8` | Supporting labels |
| Muted text | `#7E8899` | Low-priority metadata |
| Accent | `#9485FF` | Selection, active tools and primary accent |
| Success | `#70C99B` | Saved/ready states |
| Warning | `#E8BD72` | Saving/warning states |
| Error | `#ED7777` | Errors and destructive feedback |

The accent should be used for meaningful active states and primary actions, not every decorative element. Statuses must also use words/icons, not color alone.

### 11.2 Typography

- Primary UI family: Inter with system sans-serif fallbacks.
- Panel headings: 14–16 px.
- Standard controls and layer names: 12–13 px.
- Secondary metadata: 10–11 px.
- Status/shortcut hints: 10–11 px.
- Dense labels must remain readable at normal desktop viewing scale.
- Use tabular numerals for coordinates, dimensions and percentages.

### 11.3 Spacing and shape

- Base spacing unit: 4 px.
- Common spacing steps: 4, 8, 12, 16, 20 and 24 px.
- Small control radius: 5–6 px.
- Panel/card radius: 7–9 px.
- Separators should be subtle but visible.
- Icon stroke and sizing should be consistent across the application.
- Hover, pressed, focus, selected, disabled and destructive states must be designed deliberately.

### 11.4 Hit targets and accessibility

- Common toolbar and panel controls should target at least 28–32 px in desktop UI where practical.
- Every icon-only control needs an accessible name and tooltip.
- Keyboard focus must be visible.
- Text and interactive states must have sufficient contrast.
- Do not rely only on color to communicate selection, save state, visibility or errors.
- Tooltips must not be the only way to discover a critical operation.

---

## 12. Keyboard shortcut conventions

These are proposed target shortcuts. Implement them with platform-aware modifier handling and show the actual shortcut in menus/tooltips. Avoid capturing Space when the user is typing in an input, textarea, editable field or button.

| Action | Proposed shortcut |
|---|---|
| Select tool | V |
| Hand tool | H |
| Rectangle | R |
| Ellipse | O |
| Text | T |
| Frame | F |
| Temporary pan | Space + drag |
| Undo | Ctrl/Cmd + Z |
| Redo | Ctrl/Cmd + Shift + Z |
| Duplicate | Ctrl/Cmd + D |
| Group | Ctrl/Cmd + G |
| Ungroup | Ctrl/Cmd + Shift + G |
| Delete selection | Delete / Backspace |
| Zoom in/out | Ctrl/Cmd + plus/minus |
| Zoom to fit | Ctrl/Cmd + 0 |
| Deselect | Escape |

Shortcuts must not conflict with normal text editing. Group, frame and other future shortcuts remain unavailable until the associated feature exists.

---

## 13. Responsive behavior

FOLIO is desktop-first because precision visual design workflows require substantial working space.

| Available width | Expected behavior |
|---|---|
| 1440 px and above | Full tool rail, left dock, canvas and right Inspector |
| 1024–1439 px | Full functionality with collapsible docks and adjustable widths |
| Below 1024 px | Focus mode: allow one or both docks to collapse; keep canvas and essential tools usable |
| Mobile widths | Not a target for the professional editing MVP; do not claim full desktop-equivalent editing |

The design should be tested at 1366 × 768 and 1920 × 1080, in addition to the developer's current browser size. The current screenshot at approximately 1366 × 727 highlights the need to preserve vertical working space and readable panel text.

---

## 14. Product states and feedback

The UI must define consistent behavior for:

- Initial loading.
- Empty document.
- No selection.
- Single selection.
- Multi-selection.
- Hidden and locked layers.
- Saving.
- Saved.
- Save error.
- Invalid file import.
- Unsupported project version.
- Empty Pages, Layers and Assets panels.
- Missing or unavailable future engines.

Use inline context where possible and unobtrusive status/toast feedback for completed actions. Destructive actions such as delete should be undoable. Import failures must preserve the currently open project.

---

## 15. Implementation priorities

Implement in small, verifiable slices. Do not rebuild the document engine to achieve a UI change.

### Phase A — UI foundation

- Establish visual tokens and shared control styles.
- Rework application bar and menu hierarchy.
- Establish consistent panel headers, dividers, tooltips and focus states.
- Preserve current document model and canvas rendering.

### Phase B — Adaptive docks

- Implement resizable left and right docks.
- Implement collapse/reopen.
- Add tab groups and docking targets.
- Add reset workspace.
- Persist workspace preferences separately from `.flop` documents.
- Add bottom dock infrastructure without requiring a full timeline implementation.

### Phase C — Contextual Inspector

- Add page/canvas context when nothing is selected.
- Improve single-object property grouping.
- Add multi-selection context.
- Ensure edits use existing document state/history pathways.

### Phase D — Professional Layers

- Fix independent visibility and lock actions.
- Add robust rename and context menu.
- Add tested reordering and group hierarchy only when supported by the document model.
- Keep Layers and Canvas selection synchronized.

### Phase E — Canvas controls and productivity

- Add zoom-to-fit and zoom-to-selection.
- Add ruler/grid visibility and snap controls.
- Add command search/command palette after core menu actions are stable.
- Complete shortcut handling and browser interaction tests.

### Phase F — Future engines

After the shell and current Canvas & Layout stage meet their acceptance criteria, continue with Frames and Constraints, then Design System, Prototype, Animation and Visual-to-Code according to the architecture roadmap.

---

## 16. Acceptance criteria for Design Specification 0.2

The specification is considered implemented when the following are verified in the target browser:

### Workspace and navigation

- [ ] Application bar has clear menu hierarchy, project identity and save state.
- [ ] Tool rail has clear active, hover, disabled and focus states.
- [ ] Left and right docks can resize and collapse.
- [ ] Panels can be moved between supported docking zones and grouped as tabs.
- [ ] Reset Workspace restores the defined default.
- [ ] Workspace preferences do not modify the active `.flop` document.
- [ ] Canvas remains the largest practical region at supported desktop sizes.

### Layers and Inspector

- [ ] Layer visibility and lock are independent clickable controls.
- [ ] Layer selection remains synchronized with canvas selection.
- [ ] No-selection Inspector shows page/canvas properties.
- [ ] Single-selection Inspector shows relevant object properties.
- [ ] Multi-selection Inspector shows relevant shared operations without misleading fields.
- [ ] Property edits remain undoable and autosave correctly.

### Canvas and productivity

- [ ] Pan and zoom do not mutate document geometry.
- [ ] Zoom-to-fit and view toggles work.
- [ ] Alignment and distribution are contextual and tested.
- [ ] Keyboard shortcuts do not interfere with text editing.
- [ ] Existing drag, resize, snapping, selection, undo/redo, import/export and autosave behavior does not regress.

### Quality gate

- [ ] `npm run check` passes.
- [ ] `npm run test` passes.
- [ ] `npm run build` passes.
- [ ] Manual browser checks pass at 1366 × 768 and 1920 × 1080.
- [ ] No placeholder control is presented as a working feature.

---

## 17. Explicit non-goals for this specification

This specification does not authorize or imply that the following are already implemented:

- Light theme.
- Unrestricted floating windows.
- Full mobile editing parity.
- Multi-page document schema.
- Frames and constraints engine.
- Group/nested group schema.
- Component and variant engine.
- Prototype engine.
- Animation/timeline engine.
- Visual-to-code compiler.
- Cloud collaboration or cloud persistence.

These require their own functional specifications, schema decisions where applicable, tests and staged implementation.

---

## 18. Relationship to existing project architecture

This specification changes the product experience and application shell; it does not change the core architectural rules:

- The JSON AST remains the design source of truth.
- `src/core` remains independent of Preact and view components.
- Engines remain independent modules communicating through typed document data and commands.
- IndexedDB remains a replaceable local persistence adapter.
- The versioned `.flop` format remains separate from user workspace preferences.
- The runtime remains lightweight unless a measured feature justifies a dependency.

**Design baseline:** professional-density dark interface with an adaptive, dock-based workspace.  
**Implementation baseline:** preserve the working foundation and evolve the editor shell incrementally.
