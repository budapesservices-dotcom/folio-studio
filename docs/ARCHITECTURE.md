# Folio Studio — Architecture

## Product direction

Folio is a browser-based visual web builder designed around a single native project and multiple independent workspaces. Its interaction model takes inspiration from DAWs: Main Canvas, Component Canvas, Component Rack, Pages Rack and Node Logic are views over project data, not independent project silos.

## Architectural rules

1. **The project AST is the source of truth.** Renderers, inspectors, reusable components, logic graphs, history and code generation consume or transform the same project aggregate.
2. **Project identity is separate from page identity.** A project owns many pages; each page owns one document and route.
3. **UI is not the domain model.** `src/core` must not import Preact or depend on browser view components.
4. **Engines are independent modules.** Canvas, layout, prototype, animation and code generation communicate through typed project/document data and commands.
5. **Persistence is replaceable.** IndexedDB is the current local adapter. `.flop` import/export serializes the complete project aggregate.
6. **Native files are versioned.** Every `.flop` file carries a format identifier and `formatVersion`. Schema changes require explicit migrations.
7. **Legacy split storage is not authoritative.** Pages, active page and component definitions live in the project aggregate. Workspace window layout may remain local UI preference state.

## Repository responsibilities

- `src/app`: application shell, editor state and orchestration.
- `src/core/document`: framework-independent AST types, factories, active-page helpers, validation and migrations.
- `src/core/persistence`: IndexedDB and `.flop` file I/O adapters.
- `src/engines/canvas`: SVG renderer, selection and geometry behavior.
- `src/engines/layout`: future layout calculation and constraints.
- `src/engines/prototype`: future interaction graph and preview runtime.
- `src/engines/animation`: future timeline, tracks and keyframes.
- `src/engines/history`: future command batching and scalable history implementation. The first release currently keeps snapshot history in the app reducer.
- `src/engines/codegen`: future AST-to-HTML/CSS/JS compiler.
- `tests`: domain, migration, geometry and reducer tests that do not require a browser.

## Native `.flop` format — version 2

Version 2 is UTF-8 JSON. The project is the aggregate root; it contains the active page, all pages, reusable component definitions, reserved logic graph data and asset references.

```json
{
  "format": "folio-project",
  "formatVersion": 2,
  "appVersion": "0.1.0",
  "metadata": {
    "id": "project-id",
    "name": "Project name",
    "createdAt": "ISO-8601 timestamp",
    "updatedAt": "ISO-8601 timestamp"
  },
  "activePageId": "page-main",
  "pages": [
    {
      "id": "page-main",
      "name": "Main Page",
      "route": "/",
      "document": {
        "id": "document-id",
        "name": "Main Page",
        "width": 1440,
        "height": 900,
        "background": "#F5F2EC",
        "nodes": []
      }
    }
  ],
  "components": [],
  "logicGraphs": [],
  "assets": []
}
```

### Project aggregate contracts

- `metadata` identifies and versions the whole project.
- `activePageId` must resolve to a page in `pages`. Restore falls back to the first page if an imported v2 project has a stale active-page reference.
- Each `FolioPage` owns a unique route and a `FolioDocument`.
- Each `ComponentDefinition` owns a document and stable identity within the project.
- `logicGraphs` reserves typed nodes, connections and scope for the Node Logic milestone.
- `assets` reserves project-scoped references. Embedded/binary asset packaging is a future extension.

## Migration and persistence

- Version 1 files and IndexedDB records are accepted at migration boundaries.
- `migrateProjectV1ToV2` wraps the legacy single document in `Main Page` at route `/`, preserving document ID, dimensions, background and all nodes.
- Version 2 validation checks page/route identity, active page, component documents, graph references and asset references.
- IndexedDB keeps the existing object-store key path `metadata.id`; no destructive database rebuild is required.
- The active document is always resolved explicitly from `pages` using `activePageId`, falling back to `pages[0]` when recovering a stale v2 reference.
- Autosave and native file export persist the complete project aggregate.

## Acceptance criteria for the unified project foundation

- A new project starts with `Main Page` at route `/`.
- Every page and component definition is stored inside the project aggregate.
- Switching pages changes `activePageId` without swapping project identity.
- Undoable page/component mutations update the aggregate.
- Version 1 project data migrates without losing document content.
- Version 2 import validates before replacing editor state.
- IndexedDB hydration completes before workspace controls can mutate project state.
- Type checking, unit tests and production build pass.

## Planned stages

1. **Foundation:** application shell, AST, SVG canvas, local persistence and native file I/O.
2. **Canvas & layout:** pointer selection, drag, eight resize handles, multi-selection, snapping, alignment, distribution, pan, zoom and interaction hardening.
3. **Unified project v2:** multi-page project aggregate, component definitions, migrations, deterministic hydration and consolidated persistence.
4. **Reusable component system:** master definitions, linked instances, properties and overrides.
5. **Prototype / Node Logic:** typed graph nodes, ports, connections, events and runtime preview.
6. **Animation:** timeline, tracks, keyframes, easing and playback.
7. **Visual-to-Code:** deterministic HTML/CSS/React generation and route/logic compilation.
8. **Professional workflows:** accessibility, performance profiling, plugins, collaboration and version history.

Each stage must pass its acceptance tests before the next stage is considered complete.
