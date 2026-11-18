# Folio Studio — Architecture

## Product direction

Folio is a hybrid visual editor for interface design, prototyping, animation and visual-to-code workflows. The project is designed around a document model rather than a canvas that owns the design state.

## Architectural rules

1. **JSON AST is the source of truth.** Renderers, inspectors, history and code generation consume or transform the same document model.
2. **UI is not the domain model.** `src/core` must not import Preact or depend on browser view components.
3. **Engines are independent modules.** Canvas, layout, prototype, animation, history and code generation communicate through typed document data and commands.
4. **Persistence is replaceable.** IndexedDB is the current local adapter. Future cloud or file-system adapters must not change the document schema.
5. **Native files are versioned.** Every `.flop` file carries a format identifier and `formatVersion`. Schema changes require explicit migrations.
6. **Keep the runtime lean.** Avoid heavyweight component libraries, canvas frameworks and runtime dependencies unless a measured feature requires them.

## Repository responsibilities

- `src/app`: application shell, editor state and orchestration.
- `src/core/document`: framework-independent AST types, factories and validation.
- `src/core/persistence`: IndexedDB and `.flop` file I/O adapters.
- `src/engines/canvas`: SVG/DOM renderer and selection behavior.
- `src/engines/layout`: future layout calculation and constraints.
- `src/engines/prototype`: future interaction graph and preview runtime.
- `src/engines/animation`: future timeline, tracks and keyframes.
- `src/engines/history`: future command batching and scalable history implementation. The first release currently keeps a small snapshot reducer in `src/app`.
- `src/engines/codegen`: future AST-to-HTML/CSS/JS compiler.
- `tests`: domain and reducer tests that do not require a browser.

## Native `.flop` format — version 1

Version 1 is UTF-8 JSON with this envelope:

```json
{
  "format": "folio-project",
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "metadata": {
    "id": "project-id",
    "name": "Project name",
    "createdAt": "ISO-8601 timestamp",
    "updatedAt": "ISO-8601 timestamp"
  },
  "document": {
    "id": "document-id",
    "name": "Page 1",
    "width": 1440,
    "height": 900,
    "background": "#F5F2EC",
    "nodes": []
  }
}
```

The v1 format stores vector/text nodes only. Binary assets, multiple pages, nested groups, component definitions and external resources are future schema additions. They must be introduced with a documented migration path rather than silently changing v1 semantics.

## Stage 1 acceptance criteria

- App starts in a modern desktop browser.
- A starter document renders in the SVG artboard.
- Users can add rectangle, ellipse and text nodes.
- Layers can be selected and edited through the inspector.
- Visibility, lock, deletion, undo and redo work.
- The active document autosaves in IndexedDB and reloads after refresh.
- `.flop` export downloads a valid versioned JSON project.
- `.flop` import validates the format before replacing the active document.
- Type checking, production build and unit tests pass.

## Planned stages

1. **Foundation (current):** application shell, AST v1, SVG canvas, local persistence, native file import/export, basic history.
2. **Canvas & layout:** zoom/pan model, pointer selection, resize handles, snapping, align/distribute, frames and constraints.
3. **Design system:** reusable styles, variables/tokens, components, variants and assets.
4. **Prototype engine:** links, events, overlays, navigation and preview mode.
5. **Animation engine:** timeline, tracks, keyframes, easing and playback.
6. **Visual-to-code:** deterministic HTML/CSS/JS generation, responsive layout mapping and code inspection.
7. **Professional workflows:** plugins, collaboration, version history, accessibility and performance profiling.

Each stage must pass its own acceptance tests before the next stage is started.
