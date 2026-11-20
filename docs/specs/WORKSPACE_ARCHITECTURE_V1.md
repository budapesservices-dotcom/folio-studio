# FOLIO Studio — Workspace & Engine Integration Architecture v1

**Document ID:** FOLIO-ARCH-002  
**Specification version:** 1.0  
**Status:** Architecture baseline — coordinator review required  
**Repository:** budapesservices-dotcom/folio-studio  
**Base branch:** feat/canvas-pan-distribute  
**Audited base SHA:** d8a773bfa12a38915c88ed416b79fda580450a4e  
**Native Command Core reference:** 52b59ca5a08e255db9faab4960abaff90be2c7ff (PR #4; open and unmerged at inspection)  
**Document path:** docs/specs/WORKSPACE_ARCHITECTURE_V1.md

> This is a documentation-only architecture specification. It distinguishes code present at the audited base from the separate, unmerged Native Command Core reference and from future target contracts. It does not implement or authorize a source-code migration.

## 1. Purpose, scope, and status vocabulary

This document defines how FOLIO workspaces, windows, the Native Engine, reusable components, future Node Logic, and persistence integrate as one product. It provides GPT0, GPT2, and GPT3 with shared module boundaries and data contracts so parallel work does not create competing project stores, duplicated domain rules, or incompatible UI/engine interfaces.

This document is subordinate to and must remain consistent with:

- [FOLIO Architecture Blueprint](../FOLIO_ARCHITECTURE_BLUEPRINT.md) — product intent and target architecture.
- [Repository Architecture](../ARCHITECTURE.md) — current repository responsibilities and implementation reality.
- [Native Commands v1](NATIVE_COMMANDS_V1.md) — authoritative command, canonical-store, revision, history, and incremental-adoption rules.
- [Native AST v1](NATIVE_AST_V1.md), [Native AST Compatibility API](NATIVE_AST_COMPATIBILITY_API.md), and [Native AST Compatibility & Migration Plan](NATIVE_AST_COMPATIBILITY_MIGRATION.md) — semantic identity and document addressing.

### 1.1 Status vocabulary

Use these labels precisely:

| Status | Meaning |
|---|---|
| **Existing and verified** | Present in the audited base source and supported by code/tests or repository checks. |
| **Partially implemented** | A concrete foundation exists, but the complete target contract is not present. |
| **Planned** | Identified in an approved or existing roadmap, but not implemented at the audited base. |
| **Proposed** | A target contract or recommendation introduced here; it still requires GPT0 review and/or a later implementation task. |

A source file, placeholder UI, reserved type, or architecture document is not proof that a complete feature exists. Code on a separate unmerged branch is not part of the base.

### 1.2 Scope and non-goals

This specification covers:

- Workspace/window identity, geometry, lifecycle, focus, stacking, responsive behavior, and recovery.
- The boundary between workspace interaction code and the Native Engine.
- Canonical project ownership, EditorState, Native Commands, commit, revision, history, and rejection.
- Component definitions, instances, overrides, Component Canvas buffer isolation, synchronization, and Component Rack.
- Future Node Logic authoring/runtime contracts, without implementing a runtime.
- Project files, IndexedDB, workspace preferences, recovery, Multi-Document, and Multi-Application.
- Integration responsibilities and prohibited bypasses for GPT2 and GPT3.

This specification does not:

- Rewrite the current reducer, project model, or window manager.
- Implement Node Logic, collaboration, remote execution, or a plugin SDK.
- Change .flop format v2, IndexedDB database version 2, or Native Commands v1 rules.
- Expand GPT2 Revision Task 04 or GPT3 Window Management task.
- Give GPT3 ownership of project data or GPT2 ownership of workspace presentation.
- Introduce a Multi-Application schema change into the current v2 project model.

## 2. Architecture overview

### 2.1 Fixed architectural principles

The following principles constrain all FOLIO implementation work:

1. **Native Engine First.** FOLIO owns its project model, identity, AST semantics, validation, command rules, and serialization contracts. External libraries may help implement them but do not become the canonical source of project meaning.
2. **Unified Project Model.** Main Canvas, Component Canvas, Node Logic, Code, Preview, and future workspaces are views or specialized tools over one logical project.
3. **Native AST as shared semantic source.** Cross-workspace references use stable, scoped identities. A second independently serialized AST is not allowed.
4. **One canonical project owner.** There is one accepted in-memory authority for canonical project transitions and project revision. UI mirrors, render caches, local edit buffers, and persistence copies are not canonical stores.
5. **Workspace isolation is presentation isolation.** A workspace may own tool selection, selection state, zoom, pan, dock/float mode, geometry, focus, and temporary drafts. It may not own a competing version of canonical project data.
6. **Component Definition / Instance / Override.** Definitions are reusable source content; instances reference definitions; overrides express declared instance-local differences. Detach is an explicit conversion to ordinary independent nodes.
7. **Component Canvas isolation.** Its buffer is a local working/recovery surface. It is not the canonical component definition and does not own projectRevision.
8. **Native Commands v1 owns project mutation.** Command-aware paths and legacy compatibility paths converge on the same canonical commit boundary. Workspace UI must not bypass that boundary.
9. **.flop v2 compatibility.** Existing v2 files remain readable and writable under the current schema. An incompatible project-model change requires an explicit format migration.
10. **Project data and workspace preferences are different data classes.** Window positions, focus, open panels, zoom, and layout are not project content and do not advance projectRevision.

### 2.2 Logical architecture

The target design separates five responsibilities:

- **Workspace Shell:** window lifecycle, layout, focus, responsive geometry, panels, menus, and workspace routing.
- **Workspace Interaction Adapters:** convert UI gestures into editor-local state changes or typed Native Commands.
- **Native Engine:** project model, Native AST facade, validation, command registry/execution, component semantics, change classification, history compatibility, and canonical store.
- **Persistence Adapters:** validated .flop import/export, IndexedDB project records, autosave, and separate workspace-preference storage.
- **Specialized Engines:** Canvas rendering/geometry today; future Node Logic, layout, animation, code generation, preview, and build capabilities.

The Workspace Shell may subscribe to immutable canonical snapshots and derived selectors. It does not receive permission to mutate project objects directly.

~~~mermaid
flowchart TB
  subgraph Workspace["Workspace Shell and UI"]
    MC["Main Canvas"]
    CC["Component Canvas"]
    NL["Node Logic"]
    CR["Component Rack"]
    PR["Pages Rack"]
    WM["Workspace / Window Manager"]
  end
  subgraph Adapters["Workspace Interaction Adapters"]
    UIState["Editor-only state"]
    CmdUI["Native Command client"]
    Buffer["Component local edit buffer"]
  end
  subgraph Engine["Native Engine — one canonical project owner"]
    Facade["Project selectors and Native AST facade"]
    Validator["Project and command validation"]
    Registry["Closed Native Command registry"]
    Store["Canonical Editor Store"]
    History["Snapshot Undo / Redo compatibility"]
    Components["Component Definition / Instance / Override"]
  end
  subgraph Specialized["Specialized Engines"]
    CanvasEngine["Canvas renderer and geometry"]
    LogicEngine["Future Node Logic engine"]
    OtherEngines["Future Layout / Animation / Codegen"]
  end
  subgraph Persistence["Persistence"]
    Flop[".flop project adapter"]
    IDB["IndexedDB project records"]
    Prefs["Workspace preferences"]
  end
  MC --> UIState
  CC --> Buffer
  NL --> CmdUI
  CR --> Facade
  PR --> Facade
  WM --> Prefs
  MC --> CanvasEngine
  CC --> CanvasEngine
  UIState --> Facade
  CmdUI --> Validator
  Validator --> Registry
  Registry --> Store
  Store --> History
  Store --> Components
  Facade --> Store
  Store --> Flop
  Store --> IDB
  Store --> CanvasEngine
  Store --> LogicEngine
  Store --> OtherEngines
  Buffer -. "guarded synchronization only" .-> CmdUI
  Prefs -. "never project content" .-> WM
~~~

### 2.3 Canonical data ownership

The canonical project is the validated project aggregate held by the canonical editor store. Documents and their relationships are the semantic source consumed by workspaces and engines. A renderer may cache a derived representation; a workspace may stage a local edit; IndexedDB may hold a durable copy; a .flop file may carry a portable copy. None of those copies may independently accept canonical mutations.

The canonical project is not a server, window, Preact component, Canvas instance, or per-workspace reducer. It is the validated logical project value accepted through the Native Engine commit boundary.

## 3. Current source architecture assessment

### 3.1 Exact references and branch separation

The source baseline is exactly:

- Base commit: [d8a773bfa12a38915c88ed416b79fda580450a4e](https://github.com/budapesservices-dotcom/folio-studio/commit/d8a773bfa12a38915c88ed416b79fda580450a4e)
- Base branch: feat/canvas-pan-distribute
- This base is the merge commit for PR #2, which introduced the Native Commands v1 architecture document.

The Native Command Core code reference is separately:

- Reference commit: [52b59ca5a08e255db9faab4960abaff90be2c7ff](https://github.com/budapesservices-dotcom/folio-studio/commit/52b59ca5a08e255db9faab4960abaff90be2c7ff)
- PR: [#4 — feat: implement Native Command Core Phase 1](https://github.com/budapesservices-dotcom/folio-studio/pull/4)
- At inspection, PR #4 was open, not merged, with this exact head SHA and the specified base SHA. Therefore, its source is **partially implemented on an unmerged reference branch**, not part of the audited base.

No behavior described as existing at base is inferred from PR #4.

### 3.2 Source assessment matrix

| Area | Status at base SHA | Verified source reality and boundary |
|---|---|---|
| Unified project model | **Existing and verified** | FolioProjectV2 in src/core/document/types.ts contains metadata, activePageId, pages, components, logicGraphs, and assets. Pages and component definitions are inside the same project aggregate. |
| Native AST facade | **Existing and verified** | src/core/document/ast.ts builds a read-only NativeAstDocumentView over nodes[] and parentId. It provides DocumentAddress and NativeNodeRef; it does not create a second persisted AST. |
| Project validation | **Existing and verified** | src/core/document/validation.ts validates the project envelope and page/document/component/logic/asset relationships at import and persistence boundaries. |
| Main Canvas editor state | **Existing and verified, transitional** | App.tsx creates a useReducer(editorReducer) state for Main Canvas. Legacy UI interactions dispatch EditorAction values directly at the audited base. |
| Component Canvas editor state | **Existing and verified, transitional** | App.tsx creates a second useReducer(editorReducer) for Component Canvas. Its buffer uses the reserved project ID folio-component-canvas. |
| Component Canvas synchronization | **Partially implemented** | Opening a master copies its document into the Component Canvas buffer. An effect dispatches update-component into the Main Canvas reducer. It is not a Native Command or canonical-store commit boundary at the base. |
| Component Canvas recovery | **Existing and verified** | The reserved buffer is loaded and saved as a FolioProject-shaped record under its reserved ID. Root-project selection excludes it. This is workspace recovery, not a second canonical project. |
| Component export consistency | **Existing and verified** | createProjectExportSnapshot overlays a changed open master buffer into an immutable export snapshot, validates it, and does not mutate the canonical project object. |
| Component Definition / Instance / Override | **Partially implemented** | ComponentDefinition and component-instance exist. Current override values support fill and text keyed by child node ID. Helpers resolve, apply overrides, and detach. Slots, variants, broad typed property overrides, and global/local scopes are not fully represented in the current model. |
| Component Rack | **Existing and verified, project-scoped** | The Rack reads state.project.components and provides create, save selection, insert linked instance, edit master, rename, duplicate, and delete flows. It is not a separate canonical library store. |
| Window geometry helpers | **Existing and verified** | src/app/windowManager.ts contains WindowLayout, viewport clamping, default layouts, resizing, and z-index helpers. |
| Floating window interaction | **Existing and verified, partial lifecycle** | src/app/FloatingWindow.tsx implements pointer drag/resize, focus callback, eight resize handles, and cleanup on pointer end/cancel, blur, and hidden document. |
| Workspace lifecycle | **Partially implemented** | App.tsx manages Main Canvas, Component Canvas, and Node Logic visibility, minimization, close, dock/float mode, and an in-memory window order. A single lifecycle state machine for all surfaces is not present. |
| Window persistence | **Partially implemented** | Main/Component/Node Logic geometry and dock/float mode are stored in localStorage; Main and Component Canvas view transforms are stored separately. Stacking order, focus, closed/minimized state, and a versioned full layout snapshot are not persisted together. |
| Maximize / restore | **Partially implemented / proposed** | Browser fullscreen exists. Explicit per-window maximize with remembered restore geometry is not established at the audited base. |
| Node Logic UI | **Partially implemented** | A Node Logic window and placeholder surface exist. The window is not a graph editor or runtime at the audited base. |
| Node Logic project schema | **Partially implemented** | LogicGraph, LogicNode, and LogicConnection types exist in FolioProjectV2. LogicNode remains generic; these types are not a typed node registry or execution model. |
| Native Command Core | **Planned at base; partially implemented on PR #4 reference** | NATIVE_COMMANDS_V1.md defines the architecture. At reference SHA 52b, CanonicalEditorStore, commitEditorTransition, projectRevision, a closed registry, executor, validators, and node.transform / node.set-properties exist on the unmerged reference branch. |
| Canonical store at base | **Planned at base** | Main and Component Canvas are separate reducer states in App.tsx. Base does not provide CanonicalEditorStore, commitEditorTransition, or projectRevision. |
| .flop serialization | **Existing and verified** | src/core/persistence/projectFile.ts validates and serializes the FolioProject JSON as UTF-8 JSON. Native project format version is 2. |
| IndexedDB | **Existing and verified** | src/core/persistence/indexedDb.ts uses database version 2, a projects store keyed by metadata.id, and app-state for the active-project pointer. saveProjectAndActivate writes the project and pointer in one transaction. |
| Multi-Document | **Existing and verified at page/component level** | A v2 project has multiple pages, each with a document, and component definitions also own documents. This is not yet a general Multi-Application hierarchy. |
| Multi-Application | **Planned / proposed** | The Architecture Blueprint defines a project containing multiple applications. FolioProjectV2 does not yet have an applications collection. |

### 3.3 Window behavior verified at base

The audited source has a real but application-local window foundation:

- Managed window IDs include main-canvas, component-canvas, node-logic, and pages.
- Main Canvas, Component Canvas, and Node Logic have individual geometry and dock/floating mode.
- Component Rack and Pages Rack are panels/side surfaces in the current App UI, not independent floating windows.
- Focus moves a known window ID to the end/top of an in-memory order array; z-index is derived from that order.
- FloatingWindow listens for pointer events and uses windowManager geometry helpers.
- Resize handles cover north, south, east, west, and four corners.
- Geometry recovery clamps layout within viewport chrome. Current helper calculations use a 56px header and 27px footer.
- A resize listener calls recoverWindow for the three managed workspace windows.
- Per-workspace geometry/mode is persisted in localStorage. Main and Component Canvas view transforms are stored separately.
- Node Logic opens as an empty placeholder surface.
- Window order, focus, closed/minimized state, and a full workspace-layout record are not persisted as one manager-owned snapshot.
- There is no explicit per-window maximize/restore geometry state.

These are useful foundations; they are not evidence that the complete target window manager already exists.

### 3.4 Native Command reference assessment

At reference SHA 52b59ca5a08e255db9faab4960abaff90be2c7ff, PR #4 contains:

- CanonicalEditorStoreSnapshot with editorState and projectRevision.
- A store commit interface checking expectedProjectRevision and expectedEditorState identity.
- A shared commitEditorTransition entry point and legacy-action dispatch adapter.
- A ComponentSyncCommitGuard type carrying component identity and expected master baseline information.
- Native command types, trusted host context, static closed registry, executor, and runtime validation.
- node.transform and node.set-properties command families.
- Bounded runtime-input validation.

These are reference-branch capabilities only. They are not part of the audited base SHA and are not by themselves an approval to merge PR #4.

## 4. Target system architecture and module responsibilities

### 4.1 Responsibility matrix

| Module / boundary | Owns | May mutate | Must not own or bypass |
|---|---|---|---|
| src/core/document | Project/page/document/node/component/logic/asset types, identity, immutable helpers, validation, migration, AST facade | Pure validated project transformations and domain values | Preact, DOM, window geometry, localStorage, workspace UI |
| src/core/commands | Command envelope/types, payload validators, permission identifiers, result/change schemas | No canonical state; defines validated intent | Store writes, arbitrary reducer callbacks, UI components |
| Canonical Editor Store | One in-memory canonical EditorState/project snapshot, projectRevision, commit acceptance, notifications | All accepted canonical project transitions through one commit boundary | Window layout, zoom, tool state, local buffer ownership |
| Native Command Registry / Executor | Static allowlist, trusted-context validation, target resolution, reducer/domain adapter | Prepare candidate transitions and request store commit | Dynamic caller-provided handlers or direct persistence of uncommitted candidates |
| Workspace Manager | Window registry, lifecycle, geometry, focus, stacking, panels, workspace activation | Workspace preferences and ephemeral view state | FolioProject, component definitions, projectRevision, history snapshots |
| Main Canvas UI | Rendering, tool gestures, selection intent, Inspector presentation | Editor-only state; issue Native Commands for canonical mutations | Direct project object mutation or a private canonical project reducer |
| Component Canvas UI | Render canonical definition, own isolated edit buffer/session, present conflicts | Local buffer through component editing adapter; submit explicit sync intent | Direct publication to canonical definition or treating buffer as project truth |
| Component Rack UI | Query/present definitions, search/filter, create/insert/edit actions | UI search/filter/selection presentation | Independent component catalogue or duplicate definition store |
| Node Logic UI | Graph canvas, panels, palette, port interaction, debugging presentation | UI state and validated graph-edit requests | Arbitrary code execution or graph mutation outside commands |
| Node Logic authoring engine | Future node schemas, graph validation, port compatibility, graph transformations | Canonical logicGraph changes through Native Commands | Private project copy or runtime side effects during authoring |
| Node Logic runtime | Future execution context, variables, event scheduling, request lifecycle | Runtime-local state and explicitly permitted external effects | Rewriting graph authoring data or silently persisting runtime state |
| Persistence adapters | IndexedDB, .flop read/write, migration, autosave | Durable persistence after validation/accepted state | Command authorization or owning a second live project state |
| Workspace preferences adapter | Device/profile-specific layout, zoom, panel visibility, workspace selection | Workspace preference records | .flop project model or projectRevision |

### 4.2 Dependency direction

- UI depends on app-level workspace contracts and read-only project selectors.
- App-level adapters may depend on core command types, project selectors, and the canonical store.
- src/core/document and src/core/commands remain framework-independent.
- Persistence adapters depend on core project types and validators.
- Core project/command modules must not import App.tsx, FloatingWindow, Canvas UI, Preact hooks, browser DOM, or workspace presentation.

This keeps engine validation and project semantics testable without mounting the UI.

## 5. Workspace and window lifecycle contract

### 5.1 Workspace surfaces

| Surface | Current base presentation | Target responsibility |
|---|---|---|
| Main Canvas | Main workspace window; docked or floating | Visual document editing and project-scoped Canvas interactions |
| Component Canvas | Workspace window; docked or floating | Isolated working buffer for one Component Definition |
| Node Logic | Workspace window; docked or floating placeholder | Future graph authoring and runtime inspection |
| Component Rack | Side panel | Query, browse, insert, and manage project component definitions |
| Pages Rack | Side panel | Navigate and manage project pages |
| Inspector / Layers | Docked side panels | Present properties and hierarchy; submit mutation intent through engine boundary |

A workspace surface is a tool/view, not a project owner. A panel being docked does not make it a separate project.

### 5.2 Window identity and state

**Proposed target contract.** Separate workspace kind from window instance so future Multi-Document workflows may display multiple documents without creating multiple project stores.

~~~typescript
type WorkspaceKind =
  | 'main-canvas'
  | 'component-canvas'
  | 'node-logic'
  | 'code'
  | 'preview';

type WindowPresentation = 'docked' | 'floating';
type WindowVisibility = 'open' | 'minimized' | 'closed';

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorkspaceWindowRecord {
  windowInstanceId: string;
  workspace: WorkspaceKind;
  targetDocumentAddress?: DocumentAddress;
  visibility: WindowVisibility;
  presentation: WindowPresentation;
  geometry: WindowGeometry;
  restoreGeometry?: WindowGeometry;
  maximized: boolean;
  stackOrder: number;
}
~~~

windowInstanceId identifies a visible window instance. workspace identifies the tool. targetDocumentAddress binds a document-aware workspace to an explicit project document. None of these values is project entity identity.

One window instance per workspace kind is acceptable for the current milestone. The type must not assume that remains true after Multi-Document support.

### 5.3 Lifecycle transitions

| Action | Preconditions | State transition | Required behavior |
|---|---|---|---|
| Open | Workspace registered and required project/document context available | closed → open | Allocate or reuse instance; resolve target; apply recovered/default geometry; focus |
| Close | Window exists | open/minimized → closed | Remove from active stack; preserve project data; apply explicit unsaved-buffer policy |
| Focus | Window exists and is not closed | open/minimized → open and front | Restore when user activates a minimized window; move to top; update active workspace context |
| Minimize | Window open | open → minimized | Keep geometry/restore target; hide content but retain recoverable task entry |
| Maximize | Window open | open → maximized | Save previous geometry; fit app work area; preserve window identity |
| Restore | Minimized or maximized | → open, maximized=false | Restore previous geometry or last valid geometry; clamp to viewport |
| Float / Dock | Window open | presentation toggles | Change presentation only; do not recreate or replace project/editor state |

Closing a window is a workspace-visibility action, not project deletion. Deleting a document or component is a separate explicit project command.

~~~mermaid
stateDiagram-v2
  [*] --> Closed
  Closed --> Open: open
  Open --> Minimized: minimize
  Minimized --> Open: restore
  Open --> Maximized: maximize
  Maximized --> Open: restore geometry
  Open --> Closed: close
  Minimized --> Closed: close
  Open --> Open: focus / dock / float
~~~

### 5.4 Geometry and responsive rules

The Workspace Manager owns geometry. UI components render supplied geometry and report pointer intent; they do not each implement their own clamp rules.

Normative target rules:

1. Geometry is expressed in CSS pixels relative to the app-shell work area, not the full browser screen.
2. Every floating window has workspace-appropriate minimum width and height. The current base helper defaults to 280px × 220px.
3. Resize clamps affected edges while preserving the opposite edge whenever possible.
4. Dragging must leave a recoverable titlebar/restore handle inside the work area.
5. On viewport resize, orientation change, or layout restore, geometry is normalized and clamped before render.
6. A narrow viewport may force a full-width docked/single-surface layout instead of preserving unusable overlap.
7. Geometry rejects NaN, Infinity, negative sizes, unsupported coordinates, and malformed persisted records. Invalid preferences fall back safely without invalidating the project.
8. The manager maintains one geometry source per window instance. CSS/local component state is not a second persisted geometry owner.
9. Pointer sessions end on pointerup, pointercancel, window blur, and document visibility loss. Preserve the existing FloatingWindow cleanup behavior.
10. Drag handles must not hijack buttons, links, inputs, selects, textareas, or interactive descendants.

### 5.5 Stacking, focus, and modal layers

Target stacking policy:

- The Workspace Manager owns one ordered list of active window instance IDs.
- Focus moves the selected instance to the top of that order.
- z-index is derived from order, not chosen independently by each workspace component.
- Closed windows are absent from the active stack; minimized windows appear in the task/window switcher layer but do not cover active workspaces.
- Modal dialogs and blocking confirmations use a separate overlay layer above workspace windows.
- A workspace may request focus but cannot assign arbitrary z-index values.
- Focused window and active editor/document context are distinct. Focusing Node Logic need not change Main Canvas selection; focusing Component Canvas resolves its own component session.

### 5.6 Workspace layout recovery and persistence

A complete layout is a versioned workspace preference, not project content.

**Proposed preference shape:**

~~~typescript
interface WorkspaceLayoutV1 {
  schemaVersion: 1;
  layoutId: string;
  windows: WorkspaceWindowRecord[];
  stackOrder: string[];
  activeWindowInstanceId: string | null;
  activeWorkspace: WorkspaceKind;
  panelVisibility: Record<string, boolean>;
  updatedAt: string;
}
~~~

Recovery sequence:

1. Load the current device/profile's workspace layout.
2. Validate schema version, known workspace IDs, instance-ID uniqueness, finite geometry, minimum sizes, and stack references.
3. Drop unknown/duplicate window records rather than failing project hydration.
4. Reconcile records with currently registered workspace kinds.
5. Clamp geometry against the current work area.
6. Recompute valid stack order and active window.
7. Use defaults if the record is missing, invalid, or incompatible.
8. Persist normalized state only after reconciliation completes.

At the base, per-window geometry/mode and Canvas view state are already stored in localStorage. A complete versioned layout record and stack/focus persistence are proposed. Moving preferences to another IndexedDB store is a later persistence decision and must not be bundled into the active GPT3 task without GPT0 approval.

### 5.7 Maximize versus browser fullscreen

Per-window maximize and browser fullscreen are different:

- **Window maximize** expands one workspace window to the app-shell work area and remembers prior geometry.
- **Browser fullscreen** expands the application to the browser fullscreen surface.
- A per-window maximize action must not call browser fullscreen as a substitute.
- Browser fullscreen exists at base; per-window maximize/restore geometry does not.

**Recommendation — GPT0 review:** preserve the scope of the active GPT3 Window Management task. Treat a complete versioned layout record, multi-instance identity, explicit maximize/restore, and broader breakpoint behavior as architecture recommendations for a later task unless GPT0 explicitly re-scopes the current one.

## 6. Native Engine and UI integration contract

### 6.1 State categories

| State category | Examples | Owner | Advances projectRevision? | Serialized in .flop? |
|---|---|---|---:|---:|
| Canonical project data | Pages, documents, nodes, component definitions, instances, overrides, logic graphs, assets, project metadata | Canonical Editor Store / Native Engine | Yes, on accepted project mutation | Yes |
| Editor-only state | Selection, active tool, history coalescing session, transient Inspector draft | Editor/workspace adapter | No, unless committed as project data | No |
| Workspace preferences | Window geometry, dock/float, panel visibility, focused window, zoom, pan | Workspace Manager / preference adapter | No | No |
| Component working buffer | Unsynced working copy of a definition | Component Canvas session | No until canonical sync is accepted | Not as an independent project |
| Renderer/runtime cache | Canvas render objects, derived indexes, hit-test caches | Specialized engine | No | No |
| Node Logic runtime state | Variable values, running event queue, API request state, debug session | Future Node Logic runtime | No | No |
| Durable project state | Last accepted canonical snapshot | Persistence adapter stores it | No additional revision | Yes |

metadata.updatedAt is a project timestamp, not a revision number. projectRevision is not derived from it.

### 6.2 Canonical Native Engine boundary

The Canonical Editor Store is the sole authority to accept canonical project transitions. It exposes a read-only snapshot and one commit boundary.

Native Commands v1 remains authoritative for exact revision semantics:

- One accepted project mutation increments projectRevision exactly once.
- Undo, Redo, and accepted project replacement increment projectRevision exactly once.
- No-op, rejection, selection-only, and viewport-only transitions do not increment projectRevision.
- The counter is monotonic in memory and is not serialized to .flop or IndexedDB project records.
- The store derives project-mutation classification from the immutable before/after project transition. A caller-supplied boolean is not authoritative.
- A candidate is checked against its captured baseProjectRevision and editor snapshot at commit time.
- Rejected or stale transitions change neither live project state nor history.
- Legacy reducer actions and Native Commands use the same commit boundary during coexistence.
- A future successful batch is one atomic commit and one revision increment under the Native Commands v1 batch contract.

### 6.3 UI-to-engine command flow

A workspace interaction expresses intent. It must not manually reconstruct the canonical project graph and assign it into a local project state.

~~~mermaid
sequenceDiagram
  participant User
  participant UI as Workspace UI
  participant Client as Command Client
  participant Exec as Native Command Executor
  participant Store as Canonical Editor Store
  participant Persist as Persistence Adapter
  User->>UI: Gesture / Inspector edit
  UI->>Client: Typed command + scoped target
  Client->>Exec: Envelope + host-issued context
  Exec->>Exec: Validate envelope, permission, payload, refs, preconditions
  Exec->>Store: Prepare candidate against current snapshot
  Store->>Store: Recheck revision and editor-state identity
  alt Accepted canonical transition
    Store->>Store: Commit project, history, revision atomically
    Store-->>Exec: Committed snapshot and immutable change
    Exec-->>Client: Applied result
    Store->>Persist: Accepted snapshot for autosave
    Client-->>UI: Update selectors / success status
  else No-op
    Store-->>Exec: No-op
    Exec-->>Client: No-op; no revision
  else Rejected or stale
    Store-->>Exec: Conflict / rejection
    Exec-->>Client: Structured rejection; no state/history mutation
    Client-->>UI: Validation or conflict feedback
  end
~~~

### 6.4 Command envelope and validation

A command-aware UI adapter supplies:

- Protocol and command versions.
- Unique command ID.
- Command type and allowlisted payload.
- Explicit project/document/node target.
- Source workspace attribution.
- Preconditions such as expectedProjectRevision.
- Correlation metadata where supported.

The executor obtains trusted identity and permissions from host context. source.actor, source.workspace, and UI labels are attribution metadata; they do not grant authorization.

Before candidate creation, the engine validates:

1. Envelope shape, protocol version, command version, timestamp, IDs, and resource limits.
2. Caller authorization against a host-provided principal/capability set.
3. Command type and target-kind compatibility against a closed static registry.
4. Full target identity: project, owner kind, owner ID, document ID, and node ID as applicable.
5. Payload allowlists, value types, numeric bounds, collection lengths, and runtime-object constraints.
6. Target existence, uniqueness, scope, lock rules, and expected revision.
7. Candidate project invariants after translation.

UI callers cannot supply arbitrary reducer functions, command handlers, or direct project references for mutation. Unknown command types fail closed.

### 6.5 Commit, results, rejection, and notifications

The command client consumes discriminated outcomes:

~~~typescript
type CommandOutcome =
  | { status: 'applied'; commandId: string; projectRevision: number; change: NativeChangeSet }
  | { status: 'no-op'; commandId: string; projectRevision: number }
  | { status: 'rejected'; commandId: string; code: string; message: string }
  | { status: 'conflict'; commandId: string; code: string; currentProjectRevision: number };
~~~

This illustrates target result classes; exact Native Commands v1 result names and fields remain authoritative in NATIVE_COMMANDS_V1.md.

Rules:

- Preparation is not proof of commit. Only the store confirms an applied transition.
- Rejection is structured and user-actionable, with stable machine-readable codes and human-readable messages.
- Validation rejection, permission rejection, missing target, stale revision, component conflict, and persistence failure are distinct error classes.
- Persistence failure is visible as unsaved/error state. It must not retroactively report an already committed in-memory transition as rejected.
- Change events publish only after successful commit. They are immutable/detached from mutable caller data and carry project ID, committed revision, source, and scoped affected-entity information.
- Subscribers may update UI projections and schedule persistence. They may not mutate the event or commit from inside notification delivery.
- No-op and rejection do not emit canonical project-change events.

### 6.6 Legacy reducer coexistence

editorReducer remains a compatibility adapter during incremental adoption; it must not become a second write boundary.

Target flow:

1. Canonical store captures its current snapshot.
2. Reducer calculates a candidate EditorState using existing semantics.
3. Store validates candidate shape and project invariants.
4. Store classifies project mutation by comparing immutable before/after project roots.
5. Store accepts or rejects and advances revision/history once as required.
6. Native Command-prepared candidates use the same store path.

This avoids maintaining different mutation algorithms in every workspace. The base source dispatches directly to two reducer instances; unification is implementation work, not an existing base behavior.

### 6.7 Undo/Redo and history

At the audited base, editorReducer stores complete FolioProject snapshots in past/future, bounded to 60 entries. Repeated edit-node mutations with the same coalesceKey can share a history group until commit-edit. Selection is editor state, not part of project snapshots. Page add/switch currently resets history according to reducer behavior.

Native Commands v1 preserves snapshot history during the first command-core phases:

- Do not replace it with inverse-command history or event sourcing as part of this architecture task.
- Accepted project edits append a snapshot according to existing reducer grouping semantics.
- A new mutation clears redo future.
- Undo/Redo restore project content, but live projectRevision continues monotonically; it is not restored from the historical snapshot.
- Selection is revalidated against the restored active document.
- A future project-wide/per-document history change requires a separate architecture decision and parity tests.

## 7. Component system architecture and data flow

### 7.1 Canonical entities

The project aggregate owns Component Definitions. A definition has a stable component ID, name, document ID/content, and timestamps. Future scope, variants, slots, and typed override declarations require explicit schema decisions.

A Component Instance is a node inside a page or another supported document. It references a definition by stable componentId and stores instance-level placement and override data. It is not an independent copy of the definition.

A Component Override is an allowlisted difference from the referenced definition. Each override must resolve to a valid child node and a property declared overridable by the definition schema.

**Existing at base:** ComponentInstanceNode has componentId and an overrides record keyed by child node ID. Current override values support fill and text. components.ts resolves the instance, applies those overrides, and detaches an instance into ordinary nodes. This is a narrow implementation, not the complete Global/Local, variants, slots, or generic property model in the Architecture Blueprint.

### 7.2 Definition, instance, override, and rack ownership

- Canonical Component Definitions belong to project.components in the audited v2 model.
- Component Rack is a UI projection over those definitions, not a second database/library.
- Component Instance is stored within its owning document and refers to a definition by stable ID.
- Instance Overrides are stored on the instance and validated against supported override contracts.
- Renderers resolve effective content from definition plus overrides; they do not persist a separately mutable rendered tree.
- Detach is an explicit mutation that materializes independent nodes and ends the definition link for that instance.

The Architecture Blueprint establishes future Global/Local Component direction. Current FolioProjectV2 does not distinguish those scopes as separate collections. Preserve the current v2 shape until GPT0 approves an application-local component model and migration.

### 7.3 Component Canvas buffer isolation

Component Canvas edits one Component Definition through an isolated working buffer. It must not create another canonical project owner.

**Proposed target session contract:**

~~~typescript
interface ComponentCanvasSession {
  projectId: string;
  componentId: string;
  baseProjectRevision: number;
  baseDefinitionUpdatedAt: string;
  baseDocumentId: string;
  baseDocumentSnapshot: FolioDocument;
  localBuffer: FolioDocument;
  localBufferRevision: number;
  dirty: boolean;
  syncState: 'clean' | 'dirty' | 'syncing' | 'conflicted' | 'orphaned';
}
~~~

This is a target contract, not an assertion that this exact type exists at base.

At the audited base:

1. Opening a master copies its document into a temporary project-shaped buffer.
2. The buffer uses the reserved ID folio-component-canvas.
3. The buffer autosaves separately through the IndexedDB projects store.
4. A synchronization effect dispatches update-component into the Main Canvas reducer.
5. Export builds a validated immutable project snapshot and overlays the changed buffer document when that master is open.
6. The reserved buffer is excluded from root-project selection.

Native Commands v1 fixes the ownership boundary: the buffer is a workspace editing/recovery surface, not a canonical component or revision owner. The owning project definition remains the single shared project truth.

### 7.4 Component synchronization contract

**Proposed target contract; align with Native Commands v1 Phase 3.**

A buffer-to-definition write uses an atomic compare-and-set guard at the canonical commit boundary. It carries:

- Canonical project ID and component ID.
- Expected base project revision.
- Expected base definition/document identity or immutable baseline token.
- Local buffer revision and candidate document.
- Trusted host context and component-update capability.

The store checks that the canonical component still matches the expected baseline. A stale UI closure, outdated effect, old session, or duplicate event cannot overwrite a newer definition.

~~~mermaid
sequenceDiagram
  participant CC as Component Canvas UI
  participant Buffer as Local Component Buffer
  participant Sync as Component Sync Adapter
  participant Store as Canonical Editor Store
  participant Def as Canonical Component Definition
  CC->>Buffer: Edit master document
  Buffer->>Buffer: Update local buffer revision and dirty state
  Buffer->>Sync: Request sync with base revision and baseline
  Sync->>Sync: Validate component, document, session and permission
  Sync->>Store: Commit with expected revision and definition baseline
  Store->>Def: Compare current definition with expected baseline
  alt Baseline matches
    Store->>Def: Atomically replace definition document
    Store-->>Sync: Committed; projectRevision +1
    Sync-->>Buffer: Mark clean and advance baseline
  else Stale baseline or definition changed
    Store-->>Sync: Conflict; no canonical mutation
    Sync-->>Buffer: Preserve dirty buffer; mark conflicted
  end
~~~

Synchronization requirements:

1. Canonical comparison occurs at commit time, not only in a UI effect before dispatch.
2. A component write addresses the owning project and component definition. The reserved buffer ID is never a canonical command target.
3. A successful document change increments projectRevision once and creates one history transition.
4. A semantic no-op does not change updatedAt, history, or projectRevision.
5. On conflict, keep the local buffer intact and pause automatic overwrite.
6. Offer explicit recovery: compare/reload canonical, keep local as recoverable draft, or apply a user-approved merge.
7. Deleting a master while its buffer is dirty creates an orphan/recovery state. Redo/restoration must not silently replace the buffer.
8. Switching components must commit, retain a named draft, or explicitly discard after user intent; it must not silently retarget a dirty buffer.
9. Export must identify which version is exported. A dirty buffer may be overlaid into an immutable export snapshot only under an explicit policy; export overlay is not canonical commit.
10. Tests cover stale writes, clean/no-op sync, dirty conflicts, master deletion/recovery, rapid edits, Undo/Redo, reload, and export while dirty/conflicted.

The existing effect synchronization and export overlay are transitional base behavior. The explicit guarded sync contract is the target for the later Component Canvas bridge.

### 7.5 Component Rack integration contract

Component Rack queries canonical definitions through selectors. It may own search query, filtering, sorting, preview hover, and selection presentation state.

Create definition, save selection, insert instance, rename, duplicate, delete, edit master, and detach actions submit typed project mutation intent through the Native Engine. The Rack does not keep a writable copy of the component catalogue.

Delete semantics must be explicit. If definitions are referenced by instances, the engine either rejects with a reference-conflict code or performs a documented atomic conversion such as detach-before-delete. It must not leave dangling componentId references. Existing reducer/helper behavior remains the compatibility baseline until the relevant command family is implemented and tested.

## 8. Future Node Logic architecture

### 8.1 Current status and scope

**Partially implemented at base:** FolioProjectV2 reserves logicGraphs. LogicGraph has scope, targetId, nodes, connections, and timestamps. LogicNode currently has id, type:string, x/y, and scalar data. LogicConnection stores source/target node IDs and port IDs. The Node Logic window is a placeholder only.

**Not implemented at base:** node registry, typed ports, graph editor, variable/state execution, event scheduler, condition engine, binding resolver, API request executor, effects runtime, animation runtime, debug engine, and sandbox.

This section defines future contracts only. It does not authorize or implement Node Logic runtime.

### 8.2 Authoring model

A future graph authoring model should define:

- Graph ID and schema version.
- Scope: project, page, or component.
- Explicit target ID for page/component scope.
- Stable node IDs independent of display position or node type.
- Node type ID and definition version from a closed registry.
- Typed input/output ports with stable port IDs.
- Connections by node ID and port ID.
- Typed node configuration validated by its node definition.
- Graph-level variables/state declarations and declared effects/capabilities.
- Optional layout metadata for node position/grouping, separated from execution semantics where practical.

The current LogicNode/LogicConnection types are a minimal reserved schema. Extending them requires versioning and validation; do not silently reinterpret generic type/data as a complete runtime protocol.

### 8.3 Node categories and ownership

| Category | Authoring responsibility | Runtime responsibility | Boundary |
|---|---|---|---|
| Events / Triggers | Declare user, lifecycle, timer, or application events | Emit typed event payloads | Event source is registered and permission-checked |
| Conditions | Define boolean predicates and branch outputs | Evaluate against typed runtime context | Predicates have no implicit side effects |
| Variables / State | Declare typed identity, defaults, and scope | Hold ephemeral run/session values | Persistent user data needs an explicit data service |
| Flow / Control | Connect sequencing, branch, loop, and cancellation semantics | Schedule deterministic execution | Loops/recursion require bounds and cancellation |
| Data Binding | Bind typed outputs to supported document/property targets | Resolve values and update declared targets | Uses scoped Native AST/document references |
| API Requests | Configure method, endpoint policy, input and response mapping | Execute through permission-aware request service | Credentials are external secrets, never .flop data |
| Effects | Author visible state/effect actions | Emit approved effect instructions | No arbitrary DOM access or hidden project mutation |
| Animation | Author tracks, values, timing, and trigger semantics | Schedule playback/interpolation | Animation definitions are project data; playback state is transient |

### 8.4 Graph and port validation

Before graph mutation, the authoring engine validates:

1. Node type exists in the static node-definition registry and schema version is supported.
2. Node configuration conforms to its type schema and resource budgets.
3. Every connection references existing source/target nodes and declared output/input ports.
4. Port direction and data types are compatible or use an explicit conversion node.
5. Node IDs and connection IDs are unique in graph scope.
6. Scope references resolve: project graphs have no page/component target; page/component graphs resolve the exact owner.
7. Connections cannot cross project boundaries.
8. Required inputs, cardinality, cycle rules, and execution constraints are validated.
9. Unsupported node definitions are preserved as opaque compatible data when safe but are not executed.
10. Invalid edits are rejected atomically; the graph is not left half-connected.

Cycle policy is explicit by node category. Pure data-flow cycles are rejected unless the graph type explicitly supports them. Intentional loops use bounded control-flow nodes with maximum iteration/time limits.

### 8.5 Native AST and data-binding integration

A binding references a specific document and semantic target, not a CSS selector or rendered DOM coordinate.

The target contract contains:

- Project/document/owner/node scoped reference.
- Stable property path or declared binding key.
- Expected value type.
- Source graph/node/port identity.
- Default/fallback behavior.
- Read/write permission declaration.
- Cycle and dependency validation.

The binding resolver consumes read-only Native AST/project selectors. If a binding produces a canonical project change, it uses an authorized command/write boundary; it cannot mutate AST node objects from a renderer callback.

### 8.6 Runtime execution boundary

The future runtime consumes a validated immutable graph snapshot and runtime context. It does not directly edit the authored graph.

**Proposed runtime contract:**

~~~typescript
interface NodeLogicRuntimeInput {
  projectId: string;
  graphId: string;
  graphRevision: number;
  validatedGraph: Readonly<LogicGraph>;
  event: { type: string; payload: unknown };
  capabilities: readonly string[];
}

interface NodeLogicRuntimeResult {
  status: 'completed' | 'cancelled' | 'failed';
  outputs: Readonly<Record<string, unknown>>;
  diagnostics: readonly { code: string; message: string; nodeId?: string }[];
}
~~~

Runtime rules:

- Execution state, variable values, pending timers, event queues, API response caches, and debug traces are ephemeral by default.
- Runtime output does not rewrite LogicGraph authoring data.
- A runtime-triggered canonical mutation is an explicit authorized Native Command or narrowly defined host effect.
- Node definitions are registered and versioned; unknown definitions fail closed and are not dynamically evaluated.
- No eval, Function constructor, arbitrary script string, or untrusted code execution is implicit in a node.
- API requests use a controlled host service with origin/method/capability allowlists, cancellation, timeout, response-size budgets, and secret redaction.
- Secrets/tokens live in a secure environment/configuration service and are referenced by opaque IDs. They are never embedded in project data or .flop.
- Execution limits cover graph size, depth, step count, loop iterations, retained memory, concurrency, and wall-clock duration.
- Errors carry graph ID, node ID, execution ID, stable code, and safe message. Secrets/sensitive response bodies are not placed in diagnostics.
- Stopping a workspace or preview cancels associated execution and pending request work.
- Deterministic scheduling and replayable fixtures are preferred for preview; nondeterministic external effects are explicitly marked.

### 8.7 Node Logic workspace relationship

Node Logic is an independent workspace window over the same project. It may own node selection, zoom, pan, palette, debug panel, and active graph presentation state. Those are editor/workspace state.

Graph creation and mutation are canonical project data and use Native Commands. The UI may stage a connection gesture locally, but only a validated graph command commits it.

**Recommendation — GPT0 review:** graph schema, command families, runtime capabilities, and API-secret storage should be separate approval milestones. The active GPT3 window task may implement the Node Logic window shell without implying graph authoring or runtime is included.

## 9. Persistence and project serialization contract

### 9.1 Data-class boundaries

| Data | Current location at base | Target rule |
|---|---|---|
| Canonical project aggregate | Main Canvas EditorState in memory; persisted in IndexedDB projects store | One canonical in-memory owner; IndexedDB is a durable adapter |
| Component working buffer | Separate Component Canvas EditorState; reserved buffer record in projects store | Remains non-canonical and excluded from root selection |
| Active root project pointer | IndexedDB app-state store, key active-project | Outside project metadata and .flop |
| Workspace window geometry/mode | localStorage keys folio.canvas-window, folio.component-canvas-window, folio.node-logic-window | Versioned workspace preference record, not project data |
| Canvas zoom/pan | localStorage keys folio.main-canvas-view and folio.component-canvas-view | Workspace preference state, not project data |
| Window order/focus | In-memory App state | Persist only in validated workspace layout record |
| Project revision | Absent at audited base; Native Commands v1 defines store-owned in-memory revision | Never serialized to .flop or IndexedDB project records |
| Node Logic runtime state | Not implemented | Ephemeral by default; durable user data requires an explicit service contract |

### 9.1.1 Project and workspace persistence boundary

The project adapter and workspace-preferences adapter are deliberately separate. Project persistence accepts only validated project snapshots. Workspace persistence accepts only layout/view preferences. Neither adapter can write into the other's data class.

~~~mermaid
flowchart LR
  subgraph ProjectData["Canonical project data"]
    Store["Canonical Editor Store"]
    Validate["Project validation"]
    Flop[".flop v2 JSON"]
    IDBProjects["IndexedDB projects store"]
    Store --> Validate
    Validate --> Flop
    Validate --> IDBProjects
  end
  subgraph WorkspaceData["Workspace-only preferences"]
    Manager["Workspace Manager"]
    Layout["Window layout / focus / panels"]
    View["Canvas zoom / pan"]
    LocalPrefs["localStorage or future preference adapter"]
    Manager --> Layout
    Manager --> View
    Layout --> LocalPrefs
    View --> LocalPrefs
  end
  subgraph Recovery["Separate recovery surface"]
    Buffer["Component Canvas local buffer"]
    BufferStore["Reserved buffer record"]
    Buffer --> BufferStore
  end
  IDBProjects --> Recovery
  Manager -. "never writes project data" .-> Store
  LocalPrefs -. "never changes projectRevision" .-> Store
~~~

### 9.2 .flop v2 compatibility

At the audited base, .flop is UTF-8 JSON with format folio-project and formatVersion 2. The v2 aggregate includes:

- metadata
- activePageId
- pages and their documents
- components and their definition documents
- logicGraphs
- assets

The project-file adapter validates before export and serializes the project object. Import parses JSON and migrates supported v1 data to v2, then validates.

The following must not be added to the .flop v2 root as workspace state:

- Window instances, positions, z-order, dock/float, or maximize state.
- Open panel state, selected tool, zoom, pan, active window, or focus.
- Component Canvas session metadata, dirty flag, or buffer bookkeeping as a second project root.
- projectRevision or transient runtime execution state.
- Auth tokens, API secrets, private environment values, or local browser/session identifiers.

The current export path may overlay a changed Component Canvas buffer into a newly constructed immutable export snapshot before validation/serialization. This compatibility behavior does not permit persisting the reserved buffer as another canonical project.

A future Multi-Application schema, component scope, or richer Node Logic model must not silently change v2 semantics. It requires:

1. A separately approved format version or compatible extension policy.
2. Deterministic migration from v2.
3. Round-trip tests for existing v2 files and extension fields.
4. Recovery behavior for interrupted migration.
5. Clear backward/forward compatibility policy.
6. Tests proving IDs, routes, component links, overrides, logic graphs, and assets survive migration.

### 9.3 IndexedDB responsibilities

At the audited base:

- Database name: folio-studio.
- Database version: 2.
- projects store uses keyPath metadata.id.
- app-state store uses keyPath key.
- Active root project selection is stored separately as active-project.
- saveProjectAndActivate writes the validated project and active pointer in the same read-write transaction.
- The reserved component buffer can be stored in projects but is excluded from root-project selection.
- loadProjectById migrates supported stored project versions and can save the migrated v2 project.
- Legacy workspace data is read from localStorage at migration boundaries.

Target responsibilities:

- Persistence stores validated canonical project snapshots and performs atomic project/pointer operations where required.
- Persistence does not accept arbitrary UI patches or decide command permissions.
- Canonical store owns accepted in-memory transitions; database records are durable/recovery copies.
- Autosave observes accepted canonical snapshots and reports saving/saved/error status.
- Failed writes remain observable and recoverable; they do not silently discard the last successful durable version.
- Reserved buffer recovery remains clearly namespaced and excluded from root project identity.
- Workspace preferences remain separate from project records.

A dedicated workspace-preferences IndexedDB store may be considered later for larger or synced layouts, but requires a separate database schema/migration decision. The current localStorage behavior remains until such a decision is approved.

### 9.4 Project recovery and import/export

Project hydration:

1. Load the active project pointer or apply the existing root-project fallback.
2. Read and migrate the selected project record.
3. Validate the complete project aggregate.
4. Normalize/recover activePageId only according to current v2 migration/validation rules.
5. Initialize the canonical store once.
6. Load Component Canvas recovery buffer separately; never activate it as the root project.
7. Enable project mutations only after required hydration completes.

Project import:

1. Read file text and parse JSON.
2. Validate recognized format/version and migrate explicitly.
3. Validate candidate project and references.
4. Persist imported project and active pointer atomically where supported.
5. Replace canonical editor state through the approved replacement boundary.
6. Clear/reconcile editor-only selections and history according to Native Commands v1.
7. Preserve the prior active project on parse, validation, or persistence failure.

Project export:

1. Capture one immutable canonical project snapshot.
2. Apply only the documented open-component export policy, if applicable.
3. Validate the exact snapshot.
4. Serialize the complete .flop aggregate.
5. Keep layout, buffer bookkeeping, runtime state, and secrets outside the file.

### 9.5 Project versus workspace recovery

Project backup and workspace-layout backup are separate concerns. A corrupted layout must never block project recovery. A valid project still loads if localStorage is unavailable, quota is exceeded, or a layout preference belongs to a newer schema. If a Component Canvas buffer cannot be restored, surface a recoverable buffer error without replacing or corrupting the canonical project.

## 10. Multi-Document and Multi-Application roadmap

### 10.1 Multi-Document status

**Existing and verified:** FolioProjectV2 supports multiple pages. Each page has a stable page ID, route, and FolioDocument. Components also own documents. The Native AST compatibility facade uses explicit document addresses with project ID, owner kind/ID, and document ID.

Use explicit scoped references. A bare node ID is never sufficient for a cross-workspace or cross-document mutation.

Current page-level limitation: existing reducer actions resolve the active document for many operations. Native Commands v1 requires the command adapter to validate that the addressed document matches the action's actual scope. Commands reject unsupported inactive-page targets rather than accidentally mutating the active page. Later page-scoped actions may be added deliberately.

### 10.2 Multi-Application target

The Architecture Blueprint describes one .flop project containing multiple applications, each with its own documents/routes and application-local configuration, while sharing project-level resources.

**Proposed conceptual hierarchy:**

~~~text
FolioProject
├── Project metadata and settings
├── Global component definitions
├── Shared assets and design resources
├── Shared logic / backend connection references
└── Applications[]
    ├── Application ID and configuration
    ├── Application-local components
    ├── Documents / pages / routes
    ├── Application-level logic graphs
    └── Build / preview targets
~~~

This is target direction, not the current FolioProjectV2 interface. Do not add an applications collection to v2 without a migration decision.

### 10.3 Multi-window / Multi-Document relationship

A workspace window holds a view context, not a project copy. A Main Canvas window may target one page; another document window may target a different page/document; Component Canvas may target a component definition. All windows resolve against the same canonical project snapshot.

The window manager stores target document addresses in workspace-window records. It must not create a private canonical project per window.

When two windows target the same document, they share canonical data and revision. Independent selection/viewport state is allowed. Independent project copies are not.

### 10.4 Scoped identity evolution

Current DocumentAddress includes projectId, owner kind/ID, and documentId. Multi-Application will likely require application scope in some addresses. Do not silently redefine the existing reference type or reinterpret an existing page owner.

**Recommendation — GPT0 review:** choose a versioned extension strategy for document addressing before Multi-Application mutation commands are introduced. Existing project/page/component refs must continue resolving for v2 projects.

### 10.5 Build and runtime isolation

A project may eventually contain multiple applications with independently configured preview/build targets. Portable build configuration belongs to project/application model only when required to reproduce the application. Local development ports, user credentials, machine paths, and workspace preferences remain outside .flop or are represented as external environment references.

## 11. Security and data-integrity boundaries

### 11.1 Trust zones

| Zone | Trust level | Rule |
|---|---|---|
| Workspace UI input | Untrusted | Treat gesture, field, drag/drop, and pasted values as untrusted |
| Native Command envelope | Untrusted until validated | Validate schema, size, target, version, and permission before candidate preparation |
| Host execution context | Trusted host input | Derive principal/capabilities from host; never trust command self-declared actor |
| Native Command registry | Trusted static code | Closed allowlist; no arbitrary caller-supplied adapter |
| Canonical Editor Store | Authoritative | Sole owner of accepted project transition and revision |
| IndexedDB / imported .flop | Untrusted persisted input | Parse, migrate, validate, then hydrate/replace |
| Component Canvas buffer | Untrusted local draft | Never overwrite canonical definition without guarded compare-and-set |
| Node Logic graph | Untrusted authored data | Validate node types, ports, connections, scope, resource budgets, capabilities |
| Node Logic external effects | Capability-gated | API/effects go through controlled host services |

### 11.2 Required safeguards

- Use static command and node-definition registries; reject unknown types.
- Use trusted host permissions and explicit capability checks.
- Validate exact target scope and entity references.
- Validate candidate project invariants before commit.
- Enforce expected revision and expected snapshot identity at commit.
- Prevent stale Component Canvas writes with a commit-time baseline guard.
- Treat change notifications as immutable data.
- Do not expose a mutation-capable project object to UI components.
- Do not serialize secrets, session tokens, or local credentials to .flop or project records in IndexedDB.
- Bound runtime payload size, graph depth, array lengths, node counts, command size/batch size, API response size, and execution duration.
- Reject cycles or malformed object graphs in untrusted command payloads according to Native Commands v1 runtime validation.
- Do not use eval/Function or execute arbitrary graph data as source code.
- Keep plugin/AI capabilities disabled until a separately reviewed permission/execution model exists.

### 11.3 Atomicity invariants

For every canonical command:

- Validate fully before commit.
- Do not partially apply multi-target edits.
- Recheck freshness at commit.
- Commit project root, history effect, revision, and change notification as one accepted transition.
- If rejected/conflicted, preserve live project and history.
- A subscriber/UI callback cannot convert a committed command into a reported rejection or mutate the accepted change record.
- A successful command result and published event describe the state actually committed.

For Component Canvas synchronization, a check performed only in a UI effect is not an atomic write guard.

## 12. Failure, conflict, and recovery behavior

| Failure | Expected result | Recovery behavior |
|---|---|---|
| Invalid command envelope/payload | Reject before candidate commit | Stable error code; preserve project/history/revision |
| Missing or wrong-scope node/document | Reject; never fall back to active document | Refresh selectors or request correct target |
| Insufficient capability | Reject without mutation | Show permission/availability feedback |
| Stale project revision | Conflict; no commit | Re-read snapshot; require rebase/retry |
| Stale Component Canvas baseline | Mark session conflicted; retain buffer | Compare/reload/keep-local/merge |
| Master component removed | Buffer becomes orphaned/recoverable | Preserve draft until explicit save-as, discard, or reattach choice |
| Invalid .flop JSON/schema | Do not replace active project | Show import error; preserve current project |
| Migration failure | Do not partially persist migration | Preserve original record/file; report unsupported/corrupt data |
| IndexedDB blocked/unavailable | Do not claim durable save | Keep in-memory project available; surface error and retry/recovery |
| Autosave failure | Mark project dirty/unsaved | Retry and offer explicit export/backup |
| Workspace layout corrupted | Ignore invalid layout only | Restore defaults; do not block project hydration |
| Component buffer recovery failure | Preserve canonical project | Open a clean buffer only with explicit notice |
| Node Logic graph invalid | Reject graph mutation or disable unsafe execution | Preserve safe opaque data; show node/connection diagnostics |
| Node Logic runtime failure | Stop/cancel affected execution | Keep authoring graph intact; expose safe diagnostics |

Persistence must distinguish “canonical transition accepted in memory” from “durable save completed”. User-facing status must not conflate them.

## 13. Team integration contracts

This section defines interfaces and ownership. It does not rewrite active task prompts. GPT0 remains the authority for sequencing and scope.

### 13.1 Canonical project read model

| Field | Contract |
|---|---|
| Owning module | Native Engine / canonical project store and selectors |
| Input | Project ID and optional scoped DocumentAddress / NativeNodeRef |
| Output | Immutable snapshot, read-only AST view, or derived selector |
| State ownership | Canonical store owns live project; UI owns presentation state |
| Mutation permissions | Read-only; selectors cannot mutate canonical data |
| Validation | Validate address scope; return missing/invalid target rather than silently choosing active document |
| Error behavior | Structured not-found / scope-mismatch result |
| Required tests | Same node ID in two documents resolves correctly; invalid address rejected; selectors cannot mutate source; derived caches refresh after new snapshot |

### 13.2 Native Command client and executor

| Field | Contract |
|---|---|
| Owning module | GPT2 / Native Engine: core command types, validators, registry, executor |
| Input | Versioned envelope, scoped target, payload, preconditions, trusted host context |
| Output | Applied, no-op, rejected, or conflict outcome; accepted change event only after commit |
| State ownership | Executor prepares candidates; canonical store owns acceptance/revision |
| Mutation permissions | Only registered commands with host-issued capabilities prepare project mutations |
| Validation | Envelope, runtime-object budget, schema, permission, target, payload, refs, locks, candidate project |
| Error behavior | Stable result code; no state/history/revision change on rejection/conflict |
| Required tests | Valid command; invalid envelope; wrong scope; missing target; duplicate refs; permission denial; stale revision; no-op; atomic multi-target failure; legacy parity |

### 13.3 Canonical commit boundary

| Field | Contract |
|---|---|
| Owning module | GPT2 / Native Engine integration |
| Input | Expected revision, expected editor snapshot identity, candidate state, optional trusted sync guard |
| Output | Committed snapshot/event or typed conflict/failure |
| State ownership | Sole owner of canonical in-memory project and projectRevision |
| Mutation permissions | All canonical writes, including legacy compatibility and future Node Logic writes, converge here |
| Validation | Freshness checks, project validity, immutable graph rules, before/after mutation classification |
| Error behavior | Revision/editor/component conflict or validation failure without partial commit |
| Required tests | One increment per accepted project change; none on editor-only/no-op; Undo/Redo monotonicity; rejected commit preserves state/history; re-entrant writes rejected; event immutability |

### 13.4 Workspace Manager API

| Field | Contract |
|---|---|
| Owning module | GPT3 / Workspace and Interface |
| Input | Open/close/focus/minimize/maximize/restore/dock/float/drag/resize intents; viewport dimensions |
| Output | New immutable workspace-layout state and render props |
| State ownership | Workspace Manager owns window geometry, order, visibility, panel state, and view-only preferences |
| Mutation permissions | Workspace preferences only; cannot mutate FolioProject or projectRevision |
| Validation | Known window IDs, finite geometry, min/max dimensions, valid stack refs, viewport clamp |
| Error behavior | Invalid preferences rejected/normalized to defaults; project remains available |
| Required tests | Lifecycle transitions, z-order/focus, min/max constraints, pointer cleanup, resize recovery, corrupt-layout recovery, preference schema validation, responsive viewport behavior |

### 13.5 Component Canvas session and synchronization adapter

| Field | Contract |
|---|---|
| Owning module | Native Engine owns canonical definition/guarded commit; GPT3 owns UI/session presentation; GPT2 implements engine-side store/command support |
| Input | Project/component IDs, buffer revision, candidate document, base project revision, expected canonical baseline |
| Output | Committed/clean, no-op, conflict, missing-definition, or validation failure |
| State ownership | Canonical definition belongs to project; local buffer belongs to Component Canvas session |
| Mutation permissions | UI edits local buffer; sync adapter requests canonical write; store performs atomic compare-and-set |
| Validation | Session identity, component existence, document ID, schema, revision, expected baseline |
| Error behavior | Preserve local buffer on conflict; never silently replace dirty/orphaned buffer |
| Required tests | Clean sync, semantic no-op, rapid edit, stale action rejection, Undo/Redo rebase, dirty conflict, master deletion/reappearance, reload, export snapshot |

### 13.6 Component Rack

| Field | Contract |
|---|---|
| Owning module | GPT3 owns presentation; Native Engine owns component selectors/mutation commands |
| Input | Search/filter request and typed create/insert/rename/duplicate/delete/edit actions |
| Output | Read-only component cards and command outcomes |
| State ownership | Canonical definitions are in project; rack query/filter state is local UI |
| Mutation permissions | No direct array mutation; actions go through command client |
| Validation | Definition IDs, instance refs, document validity, override compatibility |
| Error behavior | Prevent dangling references; return conflict when delete/update invalidates dependents |
| Required tests | Rack as projection; linked-instance insertion; definition propagation; override preservation or explicit invalidation; delete/detach atomicity |

### 13.7 Node Logic authoring/runtime seam

| Field | Contract |
|---|---|
| Owning module | GPT2 / Native Engine for graph model/validation/commands; GPT3 for graph UI; future runtime module owns execution |
| Input | Versioned graph edits, typed node configs, port connections, scoped targets, runtime events |
| Output | Validated graph transition or runtime diagnostics/results |
| State ownership | Authoring graph is canonical project data; runtime state is ephemeral |
| Mutation permissions | Graph edits via Native Commands; runtime effects only through explicit capabilities/host services |
| Validation | Node registry, typed ports, scope, connection integrity, cycle/resource budgets, permissions |
| Error behavior | Reject invalid graph atomically; stop unsafe execution without modifying authoring graph |
| Required tests | Node/schema versions, invalid ports, cross-scope refs, cycles, missing nodes, execution limits, API cancellation, secret redaction, runtime cannot mutate graph |

### 13.8 Persistence adapters

| Field | Contract |
|---|---|
| Owning module | GPT2 / Native Engine persistence integration |
| Input | Validated canonical project snapshot; explicit project ID/activation intent |
| Output | Durable saved/loaded project or structured persistence error |
| State ownership | IndexedDB stores durable copies; canonical store owns live accepted state |
| Mutation permissions | Persist accepted snapshots only; import/replace through validation and commit boundary |
| Validation | Format version, project schema, migration, ID integrity, reserved workspace ID rules |
| Error behavior | Failed write remains visible; invalid import never replaces current project |
| Required tests | Atomic save+activate, v1-to-v2 migration, v2 round-trip, corrupt input, blocked IndexedDB, reserved buffer filtering, import rollback |

### 13.9 GPT2 and GPT3 responsibility summary

**GPT2 — Core Engine may own:**

- Core project/AST/schema and immutable transformation helpers.
- Native Command protocol, validators, static registry, executor, trusted permission checks, and canonical commit integration.
- Project revision, history compatibility, project validation, Component sync guard, and persistence adapters.
- Future Node Logic graph schema, validation, command families, and runtime implementation when separately tasked.

**GPT2 must never:**

- Put Preact/DOM/window presentation logic into src/core.
- Create a second canonical project or AST store.
- Let UI callers supply arbitrary reducer callbacks or command handlers.
- Accept caller-supplied projectMutation flags or let updatedAt drive projectRevision.
- Treat the Component Canvas buffer as canonical component definition.
- Add arbitrary Node Logic code execution or persist runtime secrets in project files.

**GPT3 — Product and Interface may own:**

- Workspace Shell, FloatingWindow UI, panel/window lifecycle presentation, layout controls, responsive behavior, window preferences, and workspace interaction design.
- Canvas/Component Canvas/Node Logic UI state and rendering.
- Local component-buffer editing experience, conflict prompts, and Component Rack presentation.
- Read-only selectors and command-client integration from UI.

**GPT3 must never:**

- Keep a separate writable canonical FolioProject for a workspace/window.
- Bypass Native Commands/canonical commit boundary for project mutations once integrated.
- Mutate project objects directly inside UI components.
- Advance projectRevision or implement independent project history.
- Save workspace geometry/panel state into .flop project data.
- Auto-overwrite a canonical Component Definition from a stale buffer or UI closure.
- Execute Node Logic graphs in the UI layer or store API secrets in component/graph data.

### 13.10 Active-task protection and coordinator decisions

This document does not expand, replace, or silently amend:

- GPT2's active Revision Task 04.
- GPT3's active Window Management task.

Recommendations affecting those tasks are **for GPT0 review**:

- Full versioned layout record, maximize/restore behavior, multi-instance identity, and broader breakpoint behavior are architecture target recommendations, not retroactive acceptance criteria for the active GPT3 task.
- Component Canvas guarded compare-and-set is the target Native Commands Phase 3 direction; it is not silently added to GPT2 Revision Task 04.
- Native Command UI adoption remains incremental and follows the phase boundaries in NATIVE_COMMANDS_V1.md. The active command-core task does not become a requirement to migrate every Canvas gesture.
- Multi-Application schema and application-scoped component collections require GPT0 approval and a separate migration/task plan.

## 14. Architecture Decision Records

### ADR-001 — One Unified Project Model

**Status:** Agreed  
**Decision:** All project-semantic content belongs to one logical project aggregate. Workspaces are views/tools over that model.  
**Rationale:** Prevents disconnected Designer/Developer/Node Logic copies, lost updates, and ambiguous project ownership.  
**Consequence:** Every mutation resolves to a canonical project/document address and passes through the engine.

### ADR-002 — Canonical Store Owns Project Revision

**Status:** Agreed by Native Commands v1  
**Decision:** One canonical store accepts project transitions and owns monotonic in-memory projectRevision.  
**Rationale:** One authority prevents different workspaces from issuing incompatible revisions or accepting stale candidates.  
**Consequence:** UI, renderers, buffers, and persistence cannot advance revision. Do not serialize it.

### ADR-003 — UI State and Project State Are Separate

**Status:** Agreed  
**Decision:** Window geometry, open/closed state, focus, selection, tools, pan/zoom, and panel visibility are workspace/editor state, not project content.  
**Rationale:** A project opens consistently without importing another user's machine-specific window arrangement.  
**Consequence:** Workspace preferences use a separate adapter and never change projectRevision or .flop output.

### ADR-004 — Component Canvas Is a Non-Canonical Buffer

**Status:** Agreed by Native Commands v1  
**Decision:** Component Canvas stages/recovers local document edits, but the owning project's Component Definition remains canonical.  
**Rationale:** Allows isolated editing and recovery without a competing source of truth.  
**Consequence:** Buffer sync needs a commit-time expected-baseline guard; export overlay is a snapshot policy, not a canonical write.

### ADR-005 — .flop v2 Remains Compatible

**Status:** Agreed  
**Decision:** This architecture does not change the current .flop v2 schema.  
**Rationale:** Existing projects and deployments remain readable while the engine evolves.  
**Consequence:** Multi-Application and richer Node Logic data require explicit format/migration planning.

### ADR-006 — Workspace Manager Owns Window Lifecycle

**Status:** Proposed  
**Decision:** One Workspace Manager owns window instances, geometry, presentation, visibility, stacking, focus, and layout recovery.  
**Rationale:** Avoids independent per-window state logic and inconsistent z-index/resize behavior.  
**Consequence:** Workspace UI renders manager state and does not create independent layout persistence mechanisms.

### ADR-007 — Native Commands Are the Project Write Boundary

**Status:** Agreed by Native Commands v1  
**Decision:** Command-aware paths and legacy reducer compatibility paths converge on one canonical commit boundary.  
**Rationale:** Preserves reducer behavior while centralizing validation, stale-write protection, history, and change publication.  
**Consequence:** UI cannot mutate canonical project directly; legacy actions remain adapters until parity is proven.

### ADR-008 — Component Overrides Are Declared and Validated

**Status:** Proposed extension of current component model  
**Decision:** Overrides are restricted to definition-declared properties and stable child IDs.  
**Rationale:** Definition changes must not make instances ambiguous or silently discard customizations.  
**Consequence:** Structural definition edits require compatibility validation and explicit conflict handling.

### ADR-009 — Node Logic Authoring Data and Runtime State Are Separate

**Status:** Proposed  
**Decision:** Graphs and typed configuration are project data; execution state and queues are ephemeral runtime state.  
**Rationale:** Keeps .flop portable and allows validation independent of execution.  
**Consequence:** Runtime effects require capability-gated host APIs and cannot mutate graph authoring data directly.

### ADR-010 — Multi-Application Is a Versioned Project Evolution

**Status:** Planned direction / proposed schema  
**Decision:** Applications eventually live inside the project aggregate, but are not added to v2 by this document.  
**Rationale:** Supports the product blueprint without breaking current page/component addressing or .flop compatibility.  
**Consequence:** GPT0 approves the application schema and address migration before implementation.

## 15. Phased implementation roadmap

This roadmap aligns with Native Commands v1 and the existing team split. It does not change current task scope.

| Phase | Focus | Primary ownership | Exit criteria |
|---|---|---|---|
| 0 — Architecture review | Review this document; resolve decisions affecting active work | GPT0 | Architecture baseline accepted; task scopes remain explicit |
| 1 — Native Command Core | Minimal command core and one Main Canvas family; canonical store/revision/commit boundary | GPT2 | Legacy/command parity; stale commit rejection; one revision per accepted project mutation; no-op/rejection invariants |
| 2 — Workspace window foundation | Consolidate lifecycle, geometry, stacking, responsive recovery, and preference interface using current helpers | GPT3, coordinated by GPT0 | Window lifecycle tests; no project ownership in window manager; layout-corruption recovery |
| 3 — Component bridge | Canonical component target, guarded buffer sync, conflict and recovery states | GPT2 engine + GPT3 UI | CAS guard; clean/no-op/dirty-conflict tests; no silent stale overwrite; buffer recovery |
| 4 — Incremental workspace command adoption | Migrate supported Main/Component Canvas UI interactions at approved time | GPT2 + GPT3 | UI command parity and no bypasses for migrated operation families |
| 5 — Node Logic authoring model | Versioned graph schema, node registry, ports, validation, graph commands, editor UI | GPT2 engine + GPT3 UI | Validated graph persistence; atomic graph editing; no runtime side effects in authoring |
| 6 — Node Logic runtime | Capability-gated scheduler, events, variables/state, bindings, API requests, effects, animation | Separate GPT0-approved task | Execution limits, cancellation, deterministic tests, secrets outside project |
| 7 — Multi-Document / Multi-Application | App hierarchy, scoped addresses, local/global components, build targets, format migration | GPT0 architecture + GPT2 engine + GPT3 UI | Approved schema; .flop migration/round-trip tests; one canonical store across windows/apps |

### 15.1 Sequencing guardrails

- Do not combine Native Commands Phase 1 with full Designer UI adoption.
- Do not bundle Component Canvas Phase 3 into Native Command Phase 1 unless GPT0 re-scopes the task.
- Do not make a window-management UI milestone depend on Node Logic runtime.
- Do not add a second project store for multiple windows or applications.
- Do not change .flop v2, IndexedDB schema, AST identity, or projectRevision rules without a separate decision and migration plan.
- Opening a window or changing its size is not a project mutation.

## 16. Acceptance criteria and architecture risks

### 16.1 Acceptance criteria

**Workspace/window**
- All managed windows have stable instance identity and manager-owned geometry/state.
- Open/close/focus/minimize/maximize/restore/dock/float transitions have explicit tests.
- Focus and stack order are deterministic.
- Drag/resize respects minimums, app-shell bounds, and pointer-session cleanup.
- Invalid/stale layout preferences recover to defaults without blocking project load.
- Window lifecycle does not change project data, history, or projectRevision.

**Native Engine/UI**
- One canonical store owns accepted project transitions and projectRevision.
- Legacy and command-aware paths use the same commit boundary during coexistence.
- UI reads immutable snapshots/selectors and cannot bypass validation.
- Target scope and permission are checked before candidate commit.
- No-op/rejection/stale conflicts preserve project/history/revision.
- Undo/Redo restore snapshot content and keep live revision monotonic.
- Change notifications describe accepted commits only and are immutable.

**Components**
- Component Rack is a projection over canonical definitions.
- Instance references resolve by stable component ID.
- Override targets and values are validated.
- Component Canvas buffer never becomes canonical project state.
- Stale sync cannot overwrite a newer canonical definition.
- Dirty/orphaned buffers survive conflicts and require explicit recovery/discard.
- Export snapshot behavior is explicit, validated, and non-mutating.

**Node Logic**
- Authoring graphs are versioned project data.
- Nodes and ports are static-registry typed and validated.
- Connections and scoped targets resolve correctly.
- Runtime state is separate from authoring graph/project state.
- API/effect capabilities are explicit, bounded, cancellable, and secret-safe.
- Invalid graphs cannot partially mutate project data or execute unsafe effects.

**Persistence / Multi-Application**
- .flop v2 remains compatible and workspace preferences are excluded.
- IndexedDB project persistence contains validated snapshots, plus clearly reserved recovery records where required.
- Failed import never replaces the active project.
- Failed persistence is visible and recoverable.
- Multi-Application requires explicit schema migration and versioned document-address decision.
- Multiple windows/documents/apps share the same canonical project owner.

### 16.2 Key architecture risks

| Risk | Impact | Mitigation / gate |
|---|---|---|
| Separate Main/Component reducers remain independent canonical-looking stores | Divergent revisions and stale synchronization | Complete Native Commands canonical-store migration; keep Component Canvas a local buffer |
| Effect-based Component sync writes stale snapshots | Lost canonical changes | Commit-time compare-and-set guard and conflict tests |
| Window manager duplicates per-window state | Geometry/focus inconsistency | One manager-owned layout state and pure geometry helpers |
| Window preferences enter .flop | Portability/privacy problems | Separate workspace preference adapter |
| UI dispatches directly to project reducer after command boundary exists | Security/validation bypass | Migrate operation families incrementally; enforce boundary in tests/review |
| Multi-Application added to v2 without migration | Existing file compatibility break | Explicit format migration and round-trip suite |
| Generic LogicNode grows into implicit runtime protocol | Unsafe/incompatible graph behavior | Versioned node registry, typed ports, schema validation |
| Node Logic API nodes store credentials in project | Secret leakage | Opaque references to external secret service; redact diagnostics |
| Runtime state is saved into authoring graph | Non-portable/corrupted authoring state | Keep runtime context ephemeral and separate |
| Active GPT2/GPT3 work is re-scoped implicitly | Rework and integration conflict | GPT0 approves task changes; recommendations remain labeled |

### 16.3 Important unresolved questions for GPT0

1. Should workspace preferences remain in localStorage for the first window-manager milestone, or move to a dedicated IndexedDB workspace-state store later?
2. Should layouts be global per browser profile, per project, per application, or named user-selectable presets?
3. Is one instance per workspace sufficient in the near term, or should multi-instance support be introduced early for Multi-Document?
4. What is the conflict UX for a dirty Component Canvas buffer when its definition is deleted or changed by another workspace?
5. Should successful Component Canvas sync be automatic per edit, explicit on save/close, or a configurable hybrid? The commit-time guard is required regardless.
6. Which component properties are overridable, and how should future Global versus Application-local definitions be represented?
7. What versioned DocumentAddress extension will Multi-Application require?
8. Which graph node categories/value types belong in the first Node Logic authoring schema?
9. Which host service stores API credentials and grants request capabilities to Node Logic?
10. Should project-wide history eventually span page changes, or should current page/history reset behavior remain until a separate history design?
11. Is per-window maximize required in the current GPT3 window milestone or deferred? This document recommends deferral unless GPT0 decides otherwise.
12. Which persistence events trigger autosave, and what UI affordance is needed when canonical in-memory state is newer than IndexedDB's durable copy?

## 17. Source evidence and inspected references

### 17.1 Base-branch source

All entries below were inspected at commit d8a773bfa12a38915c88ed416b79fda580450a4e.

- [App.tsx](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/app/App.tsx) — Main/Component reducer setup, Component Canvas initialization/recovery/autosave, master open/sync, Component Rack actions, window controls and localStorage preferences.
- [windowManager.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/app/windowManager.ts) — Window IDs, focus order, z-index, geometry clamping, resize, defaults, recovery.
- [FloatingWindow.tsx](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/app/FloatingWindow.tsx) — Pointer drag/resize, focus, resize handles, cleanup.
- [editorReducer.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/app/editorReducer.ts) — Existing project/editor state, mutation actions, snapshot history, edit coalescing, Undo/Redo.
- [document/types.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/core/document/types.ts) — FolioProjectV2, page/document, component, logic graph, and asset contracts.
- [document/ast.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/core/document/ast.ts) — Read-only AST facade, DocumentAddress, NativeNodeRef.
- [document/components.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/core/document/components.ts) — Instance creation, override resolution, detach, linked-instance replacement.
- [document/validation.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/core/document/validation.ts) — Project/document/component/graph validation.
- [persistence/indexedDb.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/core/persistence/indexedDb.ts) — IndexedDB v2 projects/app-state stores, active pointer, reserved buffer behavior, migrations.
- [persistence/projectFile.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/core/persistence/projectFile.ts) — .flop JSON validation, serialization, v1/v2 migration entry.
- [projectExport.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/src/app/projectExport.ts) — Immutable export snapshot and open Component Canvas buffer overlay.
- [windowManager.test.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/tests/windowManager.test.ts) — Geometry/recovery constraint tests.
- [Repository Architecture](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/docs/ARCHITECTURE.md) and [Architecture Blueprint](https://github.com/budapesservices-dotcom/folio-studio/blob/d8a773bfa12a38915c88ed416b79fda580450a4e/docs/FOLIO_ARCHITECTURE_BLUEPRINT.md) — Existing architectural direction.

### 17.2 Native Command implementation reference (unmerged)

The following files were inspected at 52b59ca5a08e255db9faab4960abaff90be2c7ff, the open PR #4 head at inspection:

- [editorStore.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/52b59ca5a08e255db9faab4960abaff90be2c7ff/src/app/editorStore.ts)
- [nativeCommandExecutor.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/52b59ca5a08e255db9faab4960abaff90be2c7ff/src/app/nativeCommandExecutor.ts)
- [nativeCommandRegistry.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/52b59ca5a08e255db9faab4960abaff90be2c7ff/src/app/nativeCommandRegistry.ts)
- [commands/types.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/52b59ca5a08e255db9faab4960abaff90be2c7ff/src/core/commands/types.ts)
- [commands/validation.ts](https://github.com/budapesservices-dotcom/folio-studio/blob/52b59ca5a08e255db9faab4960abaff90be2c7ff/src/core/commands/validation.ts)
- [PR #4](https://github.com/budapesservices-dotcom/folio-studio/pull/4)

These references inform the integration contract but do not change the audited base assessment.

---

**Architecture V1 — documented for GPT0 coordinator review.**  
This document defines target contracts and source status; implementation remains owned by the relevant engineering tasks and must follow the sequencing gates above.
