# FOLIO Workspace Toolbar Direction 0.4

**Status:** Implemented as a visual shell refinement; menu actions remain intentionally unimplemented.

## 1. Two-tier global toolbar

The reserved 56 px global toolbar is divided into two stacked rows:

| Row | Height | Purpose |
| --- | ---: | --- |
| Application menu | 29 px | Global menu labels |
| Context hint strip | 27 px | Pointer context and relevant shortcut hints |

Both rows share the same left alignment and start at 18 px from the viewport edge.

## 2. Application menu row

Display these labels in this exact order:

**File | Edit | View | Tools | Option | Help**

The labels are currently visual menu placeholders. Do not imply that dropdown menus or menu commands are implemented until those workflows are designed and connected.

## 3. Context hint strip

The lower row uses a slightly darker, low-opacity background than the application menu row. It remains visually subtle and uses the same general text scale as the menu labels.

Its content has four parts:
1. Context label identifying the menu or workspace panel under the pointer.
2. A short description of that menu or panel's purpose.
3. A subtle separator.
4. Shortcut key chips for relevant, existing shortcuts.

When no shortcut is available or assigned, show a quiet "SHORTCUTS NOT ASSIGNED" placeholder. Never invent keyboard shortcuts just to fill the space.

## 4. Pointer context

The hint strip responds to pointer movement over:
- File, Edit, View, Tools, Option and Help labels.
- Left tool rail.
- Layers panel.
- Canvas workspace.
- Inspector panel.

Leaving the application workspace restores the default workspace hint.

## 5. Visual treatment

- Keep the menu row slightly lighter than the hint strip.
- Use a translucent dark background for the hint strip rather than a high-contrast solid panel.
- Keep labels and descriptions legible at professional workspace density.
- Use compact shortcut chips with subtle borders and low-opacity accent fill.
- Do not increase the total toolbar height beyond 56 px.
- Preserve the existing canvas contextual toolbar as a separate control area.

## 6. Scope boundary

This direction covers toolbar hierarchy and contextual hint presentation only. Menu dropdowns, commands, shortcut assignment and a complete command system remain later implementation work.
