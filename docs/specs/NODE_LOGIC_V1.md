# Folio Node Logic v1 — Graph, Runtime & Workspace Contract

**Document ID:** FOLIO-LOGIC-001  
**Snapshot:** 2026-11-24  
**Status:** Implemented baseline with explicit runtime/code-generation gaps  
**Persisted project format:** \`.flop\` v2  
**Primary source:** \`src/engines/prototype/*\`

> This document records the implementation present in the repository at the snapshot date. It is not a claim that every catalog node has identical behavior in the simulator, Live Preview, and exported React output. Keep **catalogued**, **validated**, **simulated**, **generated**, and **production-integrated** capabilities distinct.

## 1. Purpose and architecture position

Node Logic is Folio's visual authoring workspace for interface behavior: events, state, conditions, data transformations, actions, flow control, and future network-backed behavior.

It is a specialized workspace over the same \`FolioProject\` and native document model used by Canvas, Components, Code, and Motion. It is not a second project database and must not duplicate visual elements. Logic nodes refer to existing page/component entities through stable IDs and validated scope.

The engine is framework-independent:

- \`src/engines/prototype/catalog.ts\` — node definitions, ports, types, factories, and compatibility.
- \`src/engines/prototype/pipeline.ts\` — execution context, origin/target resolution, and upstream data references.
- \`src/engines/prototype/validator.ts\` — semantic graph validation and reference diagnostics.
- \`src/engines/prototype/runtime.ts\` — deterministic headless Prototype Runtime.
- \`src/engines/prototype/frames.ts\` — Smart Logic Frames, baking, compilation plans, and presets.
- \`src/engines/prototype/codegen.ts\` — Live Preview script and React-page logic planning.
- \`src/app/workspace/NodeLogicWorkspace.tsx\` — visual graph editor.
- \`src/app/workspace/NodeLogicInspector.tsx\` and \`NodeLogicNodeFields.tsx\` — node, variable, simulation, and network inspector UI.
- \`src/app/workspace/nodeLogicGraphHelpers.ts\` — graph geometry, connections, presets, and editor helpers.

## 2. Persistent graph model

The current project model stores logic in the optional project-level \`logicGraphs: LogicGraph[]\` collection. Each graph contains:

| Field | Meaning |
|---|---|
| \`id\`, \`name\` | Stable graph identity and editable label |
| \`scope\` | \`project\`, \`page\`, or \`component\` |
| \`targetId\` | \`null\` for project scope; page or component ID for scoped graphs |
| \`nodes\` | Visual logic nodes with stable IDs, catalog type, editor position, and node data |
| \`connections\` | Directed links between named output/input ports |
| \`variables\` | Optional graph variables; omitted in older v2 projects |
| \`networkSettings\` | Optional graph network defaults |
| \`frames\` | Optional Smart Logic Frames |
| \`createdAt\`, \`updatedAt\` | Graph timestamps |

A \`LogicNode\` currently stores \`id\`, string \`type\`, editor coordinates \`x/y\`, and a primitive \`data\` record. A \`LogicConnection\` stores \`id\`, \`sourceNodeId\`, \`sourcePortId\`, \`targetNodeId\`, and \`targetPortId\`.

The graph model is backward-compatible with the existing JSON \`.flop\` v2 format. Optional graph fields are added without requiring older projects to invent values. There is no independent persisted \`LogicGraph.version\` field today; the enclosing project \`formatVersion: 2\` is the file-format version. Any future breaking graph-schema evolution must be explicit and migration-safe.

### 2.1 Graph scope

- **Project:** intended for logic shared across pages. Project-scope validation resolves native page nodes across the project.
- **Page:** bound to one existing page ID.
- **Component:** bound to one existing component definition ID; component logic is opt-in through \`ComponentDefinition.nodeLogicEnabled\`.

The structural model and semantic validator understand all three scopes. The standard \`getApplicableGraphsForPage()\` runtime selector currently selects project graphs and graphs for the requested page; it does not select component-scoped graphs. Do not claim page-preview execution of component-scoped graphs until that integration has its own implementation and acceptance coverage.

## 3. Catalog and node families

The current catalog exports **31 primary node types across 7 categories**, plus **13 legacy compatibility types**. The legacy types remain in the built-in catalog for old \`.flop\` graphs, but are marked legacy and are not part of the primary palette.

| Category | Primary node types | Count |
|---|---|---:|
| Source | \`source.element\`, \`source.context\`, \`source.external\` | 3 |
| Event | \`event.on-click\`, \`event.on-hover\`, \`event.on-input\`, \`event.on-key-press\`, \`event.on-drag\`, \`event.on-scroll-view\`, \`event.on-lifecycle\`, \`event.on-state-change\` | 8 |
| State | \`state.get\`, \`state.toggle\`, \`state.update\` | 3 |
| Logic | \`logic.branch\`, \`logic.condition\`, \`logic.math\`, \`logic.text\`, \`logic.list\` | 5 |
| Action | \`action.set-layer\`, \`action.set-variant\`, \`action.media-animation\`, \`action.navigate\`, \`action.overlay-toast\`, \`action.system-form\` | 6 |
| Flow | \`flow.delay\`, \`flow.loop-timer\`, \`flow.control\` | 3 |
| Network | \`network.http\`, \`network.json\`, \`network.socket\` | 3 |
| **Primary total** | | **31** |

The 13 legacy compatibility node types are:

- Source: \`source.page\`, \`source.component\`, \`source.theme\`
- Event: \`event.on-page-load\`
- State: \`state.set\`, \`state.increment\`
- Logic: \`logic.compare\`, \`logic.template\`
- Action: \`action.set-visible\`, \`action.set-text\`, \`action.set-fill\`, \`action.set-theme\`, \`action.play-animation\`

The current built-in type union therefore contains 44 entries (31 primary + 13 legacy). Do not use the previous 17-node or 18-node catalog count as the current catalog size. Legacy status also does not mean the old node data should be deleted or rewritten during load.

## 4. Port and connection contract

A port has a direction (\`in\` or \`out\`) and a data type. Current port data types are:

- \`exec\` — control-flow signal.
- \`string\`, \`number\`, \`boolean\`, \`list\`, \`object\` — typed data.
- \`any\` — wildcard data port.

Only output-to-input connections are valid. Execution ports connect only to execution ports. Data ports connect when types match or either side is \`any\`; number and boolean values may also feed string inputs through the documented string coercion rule.

**There are two wire kinds, not three:**

1. **Execution wire** controls which operation runs next.
2. **Data wire** supplies a value to an input.

A target element is a reference, not a third wire kind. Nodes that operate on a Canvas element use stable native node IDs in node data, or resolve a target from the incoming execution context. A UI may provide a convenient target picker, but that is presentation over the reference contract.

The semantic validator rejects malformed direction/type connections, missing graph nodes, duplicate connections, self-connections, and dataflow dependency cycles. Pure data dependencies must form a DAG. Execution flow is separately bounded by the runtime step budget; use explicit Flow nodes rather than relying on unbounded execution.

## 5. Event context, Pipeline, and target resolution

The Pipeline is a central Folio feature. Each execution carries a context with:

- a unique execution ID;
- event kind;
- an optional origin reference (the element that initiated the event);
- outputs produced by earlier nodes in that execution.

Pipeline outputs are addressed by source node and field, so downstream nodes can consume the value emitted by an upstream node without copying data into another project store.

Target resolution supports two modes for target-capable action nodes:

- **Override / explicit:** use the configured \`targetNodeId\`.
- **Pipeline / inherit:** use the incoming origin element. An optional \`pipelineChildId\` can select an eligible child of that origin.

Private toggle state is keyed by logic node, origin element, and optionally baked frame. Thus one reusable interaction can keep independent state for separate target elements. A shared Boolean variable remains available when multiple parts of the graph must observe the same state.

This distinction is important for repeated UI structures: a click on one card should not accidentally toggle every other card unless the graph explicitly uses shared state.

## 6. Variables and state

Current variable value types are \`string\`, \`number\`, \`boolean\`, \`list\`, and \`object\`. A variable definition includes stable ID, name, type, initial value, and optional metadata:

- \`scope: local | global\`
- \`persist: none | local | session\`
- \`computed\` and \`computedExpression\`

The runtime supports typed values and state operations, including set/update, increment, list/object operations, and private per-target Boolean toggles.

**Current implementation boundary:** \`scope\`, \`persist\`, \`computed\`, and \`computedExpression\` are represented and structurally validated in the project model/UI, but the current \`PrototypeRuntime\` does not read \`persist\` or \`computedExpression\`. Do not advertise local/session durable persistence or computed-variable evaluation as implemented behavior until a runtime/storage contract and tests exist.

## 7. Runtime contract

\`createPrototypeRuntime()\` creates a deterministic headless runtime with no DOM dependency and no \`eval\`. Its public API is:

- \`mount()\`
- \`dispatchNodeEvent(nodeId, event, payload?)\`
- \`setVariable(variableId, value)\`
- \`reset()\`
- \`getSnapshot()\`

Supported event kinds at the runtime API include click, hover enter/leave, input, key press, drag, and scroll-view. Runtime snapshots expose page/route/theme state, variables, private memory, visual overrides, played animation IDs, toasts, execution traces, warnings, and step counts.

The default execution budget is 256 steps per run, with a hard configurable cap of 1,024. A bounded runtime prevents runaway graphs from consuming unlimited work.

### 7.1 Important simulator-only behavior

The headless runtime recognizes the current primary catalog, but some integrations are deliberately simulated or placeholders:

- \`source.external\` currently returns an empty list/count placeholder.
- \`network.http\` emits a simulated successful response (status 200 and sample data); it does not issue a real HTTP request.
- \`network.socket\` emits simulated connection/message flow; it does not establish a real WebSocket.
- \`flow.delay\` is recorded as simulated and should not be treated as a production wall-clock scheduler.
- \`network.json\` performs local JSON parse/stringify/path extraction; it is not a network client.

These behaviors are useful for visual authoring and deterministic simulation, but they are not evidence of a production network/backend runtime.

## 8. Semantic validation and native commands

Two levels must remain distinct:

1. **Structural project/command validation** — \`isLogicGraph\` checks graph shape, IDs, node/connection structure, variables, frames, and bounded persisted values as part of \`.flop\` validation and Native Command payload validation.
2. **Semantic graph validation** — \`validateLogicGraphSemantics()\` checks graph meaning against the project: graph scope, port direction/type, connection integrity, dataflow cycles, native element/page/component references, variables, variants, themes, animation clips, node configuration, and unsafe URL/CSS-related values. \`validateProjectLogicGraphs()\` aggregates diagnostics across the project.

Unknown/reserved graph node types are preserved structurally and surfaced as non-fatal \`UNSUPPORTED_NODE_TYPE\` diagnostics by the semantic validator. This is not the same as executing them.

Logic graph mutations use Native Commands:

- \`logic.create-graph\`
- \`logic.update-graph\`
- \`logic.delete-graph\`

These commands require \`logic.update\` permission and participate in the Native Command Engine's project mutation/history flow. The command payload validator checks the structural \`LogicGraph\` shape. The semantic validator is a separate service; consumers must not assume every command commit is automatically a semantic execution gate. Preview/export entry points should validate and surface errors before claiming a graph is runnable.

## 9. Smart Logic Frames and presets

A \`LogicFrame\` groups nodes visually and records its child node IDs and bounds. Baking compiles a selected frame into a deterministic plan with:

- exposed execution/data inputs and outputs;
- internal node/step ordering and routing;
- data-input mappings;
- exposed editable parameters.

Baking is rejected for empty frames, internal cycles, or semantic errors. An unbaked frame can be restored through Unbake/Edit. Exposed parameters let a baked frame present a smaller public editing surface.

Reusable \`LogicFramePreset\` records contain a frame, nodes, and connections. The model supports optional \`logicFramePresets\` in the project. The local preset helper also saves user presets in browser \`localStorage\`; this browser-local library is not a cloud-synced preset service.

## 10. Current Node Logic workspace

The lazy-loaded \`NodeLogicWorkspace\` is a pan/zoom graph editor with:

- searchable palette of the 31 primary nodes and category filtering;
- draggable nodes and Bezier wire editing with port snapping;
- direction/type compatibility and connection validation;
- graph presets and auto-arrange;
- Smart Logic Frame creation, movement, baking, unbaking, and presets;
- graph diagnostics and a \`Test in Live Preview\` entry point.

The inspector currently has four tabs: **Node**, **Variables**, **Simulate**, and **Network**. Frame selection uses a dedicated frame inspector. The editor dispatches graph changes through the Native Command client, so graph updates are saved in the unified project and participate in history.

The component contract includes \`nodeLogicEnabled\` as an opt-in flag for exposing a component to component-related Node Logic workflows.

## 11. Live Preview and React code generation — parity is incomplete

Node Logic has two code-generation paths:

- \`buildLivePreviewLogicScript()\` emits a sandbox-oriented micro-runtime for the current Live Preview page.
- \`buildReactPageLogicPlan()\` plans React hooks and event-handler attributes for exported React pages.

The repository has a tested baseline for the earlier Node Logic interaction set and has added newer catalog/runtime concepts since that baseline. However, the current 31-primary-node catalog must **not** be described as having full one-to-one parity across Prototype Runtime, Live Preview, and React export.

The current codegen source does not provide dedicated parity for several newer catalog entries, including the external-data source, input/key/drag/scroll event bindings, list processing, overlay/toast action, loop/timer flow, and network HTTP/JSON/socket operations. Some nodes such as HTTP and Socket are simulated only in the headless runtime. Maintain an explicit per-node matrix before enabling these node types in production export or presenting them as universally supported.

Acceptance should test the same graph in:
1. headless simulation;
2. Live Preview in the browser;
3. exported React project after build/run.

A passing simulator test alone is not sufficient evidence for codegen parity.

## 12. Security and data handling

- Do not store real long-lived API secrets in \`LogicNetworkSettings.authToken\`. The field is part of graph data persisted in \`.flop\`; a value shipped to a browser cannot be treated as secret.
- Use environment/secret references and a trusted server-side proxy for future authenticated production requests.
- Keep URL protocol validation and safe navigation rules in place.
- Keep CSS values sanitized before writing runtime overrides or generated output.
- Network execution must later define origin allowlists, timeout/abort behavior, payload limits, response size limits, error paths, auth storage, and user-visible permission boundaries.

## 13. Current gaps and recommended next increments

| Priority | Gap | Required evidence before claiming completion |
|---|---|---|
| P0 | Per-node parity matrix across simulator, Live Preview, and React export | Automated fixtures for every primary node and explicit unsupported diagnostics |
| P0 | Browser-level starter graph acceptance | Updated browser assertion for the current inspector/runtime UI and successful CI rerun |
| P1 | Real network runtime | Controlled HTTP/WebSocket adapters, security model, timeout/error tests, and no client-secret leakage |
| P1 | Variable persistence and computed expressions | Defined semantics plus reload/session tests and deterministic dependency handling |
| P1 | Debounce/throttle runtime semantics | Timer/scheduler contract with fake-clock tests; currently values are catalogued/validated but not read by PrototypeRuntime |
| P1 | Component-scoped runtime execution | Define instance context and test the same component graph for multiple instances |
| P2 | Canvas-first Interaction Builder | Generate a simple graph from a selected Canvas element and user-facing choices without hiding advanced graph editing |

For ordinary button interactions, the intended beginner path should remain small: select a Canvas element, choose an event such as **On Click**, choose an action such as **Show / Hide / Toggle**, and select a target element. The editor may create the underlying event/action nodes and Execution wire automatically. Advanced users retain direct graph editing. This is a recommended UX increment, not a claim that the current Canvas-first builder is implemented.

## 14. Source of truth

When this document and code disagree, current source/tests describe implementation reality. Update this specification deliberately when contracts change; do not silently infer full runtime support from a catalog entry.

Key source files:
- [Node catalog](../../src/engines/prototype/catalog.ts)
- [Pipeline](../../src/engines/prototype/pipeline.ts)
- [Semantic validator](../../src/engines/prototype/validator.ts)
- [Prototype Runtime](../../src/engines/prototype/runtime.ts)
- [Frames](../../src/engines/prototype/frames.ts)
- [Code generation](../../src/engines/prototype/codegen.ts)
- [Workspace](../../src/app/workspace/NodeLogicWorkspace.tsx)
- [Inspector](../../src/app/workspace/NodeLogicInspector.tsx)
- [Native project types](../../src/core/document/types.ts)
- [Project validation](../../src/core/document/validation.ts)
- [Acceptance checklist](../ACCEPTANCE_TESTS.md)
- [Current architecture](../ARCHITECTURE.md)
