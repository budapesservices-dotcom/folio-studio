# FOLIO Native Commands v1 — Architecture & Specification

**Document ID:** FOLIO-CMD-001  
**Specification version:** 0.1 — Draft  
**Command protocol:** Native Commands v1  
**Status:** Proposed; not implemented or verified  
**Integration target:** feat/canvas-pan-distribute  
**Audited baseline commit:** 1d53162154f317396087501493e9f07d9558e4c9

**Related documents**
- [FOLIO Architecture Blueprint](../FOLIO_ARCHITECTURE_BLUEPRINT.md)
- [Repository Architecture](../ARCHITECTURE.md)
- [Acceptance Tests](../ACCEPTANCE_TESTS.md)
- [Native AST v1](NATIVE_AST_V1.md)
- [Native AST Compatibility & Migration Plan](NATIVE_AST_COMPATIBILITY_MIGRATION.md)
- [Native AST Compatibility API v1](NATIVE_AST_COMPATIBILITY_API.md)

> This specification defines a proposed write boundary over the existing project model. It is not evidence that a Native Command executor, command registry, transaction engine, command history, plugin API, or AI execution API currently exists.

## 1. Purpose and architectural position

### 1.1 Purpose

FOLIO Native Commands are the typed, validated way to express an intended mutation of the Unified Project Model.

A command represents **what an actor intends to change**, not how a particular workspace happens to update its local UI state. The same semantic command should eventually be usable by a Designer interaction, Developer tool, Node Logic editor, future collaboration client, plugin, or AI agent when that actor has the required permission.

The first version establishes a small boundary that can be introduced without replacing the existing application architecture:

1. Receive a versioned, typed command.
2. Resolve its explicit project and document target.
3. Validate its envelope, authorization, payload, references, and preconditions.
4. Translate its intent into existing project/document helpers and supported editor reducer actions.
5. Publish one immutable state result or reject the operation without changing state.
6. Return a structured result and, after a successful commit, a scoped change notification.

### 1.2 Architectural position

Native Commands sit between workspace interaction code and the existing project mutation path.

~~~text
Designer / Developer / Node Logic / System / Authorized Agent
                           |
                           v
                 Native Command API
                           |
               Envelope + Permission Check
                           |
               Target Resolution + Validation
                           |
                 Command Compatibility Adapter
                           |
             Existing Helpers + editorReducer
                           |
                  EditorState / FolioProject
                           |
              Existing Persistence / Autosave
~~~

The command layer is an API and a small execution boundary. It is **not** a reason to introduce a message broker, distributed command bus, event sourcing, a plugin runtime, or a replacement state store in v1.

The project model remains the only shared project truth. Commands do not create workspace-specific project copies or a second AST representation.

### 1.3 Non-goals

Native Commands v1 does not:

- Replace or rewrite editorReducer.
- Replace snapshot-based Undo/Redo with inverse-command history.
- Change the existing JSON .flop format or IndexedDB schema.
- Turn the read-only AST facade into a mutable AST.
- Add a second persistent project model or a separate source of truth per workspace.
- Implement Node Logic, Motion, compiler, collaboration, or remote synchronization.
- Define a public plugin SDK or permit arbitrary plugin code to mutate project state.
- Make arbitrary Developer-authored source code visually editable.
- Guarantee concurrent multi-user writes or cross-device idempotency.
- Introduce a large command bus, queue, worker, or background service.

### 1.4 Design rules

- **One intent, one validated mutation:** an operation has an explicit command type and typed payload.
- **Explicit scope:** every command targeting a document or node carries a complete scoped address.
- **Validate before publish:** an invalid command cannot partially mutate the project.
- **Delegate before replacing:** v1 reuses existing document helpers and reducer behavior wherever possible.
- **Preserve history semantics:** successful commands create the same user-visible history behavior as their legacy reducer equivalent.
- **Preserve identity:** commands do not use names, array indexes, geometry, or rendered output as entity identity.
- **No hidden writes:** a command result accounts for the complete mutation it claims to have applied.
- **No speculative capabilities:** a command family is not supported until its target model, adapter, validation, and tests exist.

## 2. Status and implementation baseline

Use the repository's status vocabulary precisely:

- **Agreed** — accepted product or architectural direction.
- **Proposed** — contract defined here; implementation or formal approval is still pending.
- **Implemented** — present in repository source code.
- **Verified** — exercised by an actual check or acceptance test.

### 2.1 Agreed architecture

The following principles constrain this specification:

- FOLIO is the Visual-First Web Development Studio.
- Native Engine First.
- One Unified Project Model across independent Designer and Developer workflows.
- Native AST and stable IDs are the shared semantic foundation.
- Workspaces may have different interactions, but interoperable changes obey shared FOLIO contracts.
- .flop is the native project extension.
- Node Logic owns events, conditions, variables, state, effects, animation, API requests, and data binding.
- Shared project data must not become disconnected workspace-specific sources of truth.
- User-facing interface text, validation messages, and notifications are in English.

### 2.2 Existing implementation at the audited baseline

The audited repository baseline is feat/canvas-pan-distribute at commit 1d53162154f317396087501493e9f07d9558e4c9.

| Area | Existing implementation |
|---|---|
| Project types | src/core/document/types.ts defines FolioProjectV2, pages, component definitions, documents, and the DesignNode union. |
| Project access | src/core/document/project.ts resolves the active page/document and updates the active document. |
| Validation | src/core/document/validation.ts validates the v2 project envelope, node types, document-local duplicate IDs, parent references/cycles, page routes, component references/overrides, logic graph records, and asset records. |
| AST facade | src/core/document/ast.ts exposes a read-only NativeAstDocumentView, DocumentAddress, and NativeNodeRef. It derives views over current nodes[] and parentId; it does not mutate or serialize a second AST. |
| Reducer | src/app/editorReducer.ts owns EditorState and the EditorAction union. Document/component mutations are implemented in its switch statement. |
| Layer operations | src/core/document/layers.ts contains existing move, group, ungroup, hierarchy, clipping, and selection helpers. |
| Component operations | src/core/document/components.ts contains component-instance resolution, overrides, and detach helpers. |
| History | editorReducer stores complete FolioProject snapshots in past and future, bounded to 60 snapshots. |
| Persistence | src/core/persistence currently uses IndexedDB and the existing JSON .flop v2 adapter. |

The reducer's current action vocabulary includes node insertion/replacement/editing/transforms, layer property changes, rename, move, group/ungroup, clipping, delete, project rename, page add/switch, component add/update/rename/delete, project replacement, Undo, and Redo.

The reducer currently handles many invalid or absent targets by returning the original state. That behavior is useful for UI resilience but is not a sufficient public command validation contract. The Native Command adapter must distinguish a rejected request from a legitimate no-op before dispatching a legacy action.

### 2.3 Important current workspace boundary

The current application keeps separate EditorState instances for Main Canvas and Component Canvas. The Component Canvas is initialized from a temporary project with the synthetic ID folio-component-canvas. Opening a master component copies its document into that editor buffer. An application effect synchronizes the edited buffer document back to the matching component definition through the main project's update-component action.

This is existing implementation behavior, not the target Unified Project Model.

**Compatibility rule:** do not treat the temporary Component Canvas project's synthetic project ID or its buffer document as the canonical project/component identity. A command targeting a component definition must identify the component in the owning project and must not silently report success merely because the temporary canvas buffer changed.

The first Main Canvas command pilot can use the current project reducer path. Component Canvas adoption requires a deliberate adapter that preserves the current buffer-to-definition synchronization until that workflow is migrated to canonical, project-scoped commands. This specification does not authorize a workspace rewrite.

### 2.4 Proposed contract, not implementation

The command envelope, command registry, command executor, permission checks, result contracts, change notifications, revision checks, batch transaction behavior, and plugin/AI boundaries below are proposals. They must not be represented as existing features until implemented and tested.

## 3. Protocol, identity, and versioning

### 3.1 Three independent version concepts

The following versions have separate meanings and must never be conflated:

| Version | Meaning | v1 rule |
|---|---|---|
| Native Command protocol version | Shape of the common command envelope and execution/result contracts | protocolVersion: 1 |
| Command type version | Payload and semantics of one command type | commandVersion: 1 for each v1 command |
| Native AST schema version | Semantic project/document AST contract | Not introduced by this command specification |
| .flop format version | Persisted project file format | Remains existing format version 2 |

Changing a command payload does not require a .flop migration. Changing the persisted project schema does not happen merely because a command protocol version changes.

An incompatible envelope change requires a new protocol version. An incompatible payload or semantic change to one command requires a new version for that command type. A command type version is not inferred from the protocol version.

### 3.2 Command identity

Every submitted command has a unique commandId.

- Use a UUID generated once when the user or trusted caller creates the command.
- Keep the same ID while validating and executing that one submission.
- A retry of the same logical submission reuses the same ID; a genuinely new user intent gets a new ID.
- The ID is for correlation, result matching, diagnostics, and future deduplication. It is not a project entity ID.
- A command ID must never be used as a node, document, page, component, or logic-node ID.
- The first local implementation may keep a bounded in-memory set of recently completed IDs to reject accidental duplicate submissions in the same editor session. This is not a durable exactly-once guarantee.

V1 does not persist a command journal or promise deduplication after application restart. Cross-session idempotency remains open.

### 3.3 Source workspace and actor

The command source describes where the intent originated. It is attribution metadata, not proof of permission.

~~~typescript
type NativeWorkspace =
  | 'main'
  | 'component'
  | 'node-logic'
  | 'code'
  | 'system'
  | 'plugin'
  | 'ai-agent';

type NativeActor =
  | { kind: 'user'; actorId?: string }
  | { kind: 'system'; actorId: string }
  | { kind: 'plugin'; actorId: string }
  | { kind: 'ai-agent'; actorId: string };

interface NativeCommandSource {
  workspace: NativeWorkspace;
  actor: NativeActor;
  sessionId?: string;
  correlationId?: string;
}
~~~

The source fields must be validated for shape, but authorization uses a trusted execution context supplied by the host. A caller cannot grant itself plugin, system, or AI permissions by writing those values into a command.

A command originating in Node Logic must target a supported logic-graph command family. It must not write visual effects, events, conditions, variables, state, animation, API requests, or bindings through undocumented canvas mutations. Those authored behaviors remain owned by Node Logic.

### 3.4 Target scope and references

V1 uses the scoped references already defined by the Native AST Compatibility API.

~~~typescript
type NativeCommandTarget =
  | {
      kind: 'project';
      projectId: string;
    }
  | {
      kind: 'document';
      address: DocumentAddress;
    }
  | {
      kind: 'node';
      ref: NativeNodeRef;
    };
~~~

DocumentAddress and NativeNodeRef are the existing types from src/core/document/ast.ts:

~~~typescript
type DocumentOwnerRef =
  | { kind: 'page'; id: string }
  | { kind: 'component'; id: string };

interface DocumentAddress {
  projectId: string;
  owner: DocumentOwnerRef;
  documentId: string;
}

interface NativeNodeRef {
  document: DocumentAddress;
  nodeId: string;
}
~~~

Rules:

1. A document target always identifies the project, owner kind, owner ID, and document ID.
2. A node target always contains the full document address and the node ID.
3. Node IDs are currently unique only inside their owning document. A bare nodeId is never an adequate cross-workspace target.
4. A page address resolves through the project's page ID and then verifies the document ID.
5. A component address resolves through the project's component ID and then verifies the component document ID.
6. A target mismatch is rejected. The executor must not fall back to the active document, search another page, or guess based on a matching node ID.
7. The current project does not implement the future Multi-Application ownership model. V1 must not invent an application ID or pretend that application-level scope is already persisted.
8. Future multi-application support may extend the address through a versioned contract. It must not silently change the meaning of existing page/component references.

A command that affects multiple nodes uses a list of NativeNodeRef values. Every reference in one document operation must resolve to the same DocumentAddress, unless the command type explicitly declares a project-wide scope.

## 4. Command envelope and metadata

### 4.1 Common envelope

All v1 commands use the following envelope:

~~~typescript
interface NativeCommandEnvelope<TType extends string, TPayload> {
  protocol: 'folio.native-command';
  protocolVersion: 1;

  commandId: string;
  type: TType;
  commandVersion: 1;

  issuedAt: string;
  source: NativeCommandSource;
  target: NativeCommandTarget;
  payload: TPayload;

  preconditions?: NativeCommandPreconditions;
  transactionId?: string;
  metadata?: {
    description?: string;
    userGestureId?: string;
  };
}

interface NativeCommandPreconditions {
  /**
   * Optional in-memory revision token supplied by the host store.
   * It is not FolioProject.metadata.updatedAt.
   */
  expectedRevision?: number;
}
~~~

Envelope rules:

- protocol and protocolVersion are required exact literals.
- commandId must be non-empty and valid under the host's UUID policy.
- type must exist in the command registry.
- commandVersion must be supported for that type.
- issuedAt must be a valid ISO-8601 timestamp. It is diagnostic metadata; it does not determine execution order.
- source, target, and payload are required and must pass runtime validation. TypeScript types alone are not a trust boundary.
- transactionId, when supplied, groups commands for diagnostics and a transaction result. It does not make a group atomic by itself.
- metadata.description is display-only, is never executed, and must not control validation or authorization.
- Unknown envelope fields are rejected in v1 unless an explicitly namespaced extension rule is later approved. Silent dropping of unknown fields is not allowed.

### 4.2 Registry entry

The registry is a small static allowlist, not a dynamic plugin bus.

~~~typescript
interface NativeCommandDefinition<TCommand> {
  type: string;
  commandVersion: 1;
  allowedTargets: readonly ('project' | 'document' | 'node')[];
  requiredPermission: NativePermission;
  validatePayload(value: unknown): ValidationOutcome<TCommand>;
  toEditorActions(
    command: TCommand,
    context: NativeCommandContext
  ): readonly EditorAction[];
}
~~~

The first registry should be a plain TypeScript map or exhaustive discriminated switch. Do not add runtime discovery, plugin registration, remote handler loading, command queueing, or arbitrary handler injection in v1.

An unsupported type or version must fail with a stable error code. The executor must never guess a handler based on a similar type string.

### 4.3 Illustrative typed command

~~~typescript
type SetNodePropertiesPayload = {
  nodes: NativeNodeRef[];
  properties: {
    visible?: boolean;
    locked?: boolean;
    layerColor?: string | null;
  };
};

type SetNodePropertiesCommand =
  NativeCommandEnvelope<'node.set-properties', SetNodePropertiesPayload>;
~~~

This example intentionally limits the patch to properties already represented in the existing reducer action. It does not expose an arbitrary object merge.

## 5. V1 command families and typed payloads

The initial catalog should cover mutations already supported by the current project model and reducer. The catalog is a proposed contract; each command remains unavailable until its adapter and tests are implemented.

### 5.1 Project commands

| Command | Target | Payload | Legacy compatibility route |
|---|---|---|---|
| project.rename | Project | name: string | rename-project |
| project.replace | Project | Full validated project, restricted to trusted import/recovery flow | replace-project; unavailable to plugins/AI in the initial catalog |

Project replacement is a privileged import/recovery operation, not a general-purpose way for a workspace to overwrite the project. It must validate the full incoming project before any state replacement. It is excluded from ordinary multi-command batches.

### 5.2 Document node commands

| Command | Target | Payload | Legacy compatibility route |
|---|---|---|---|
| node.create | Document | nodes: DesignNode[] | add-node or add-nodes |
| node.replace | Node | node: DesignNode | replace-node |
| node.transform | Document | nodes: { ref: NativeNodeRef; transform: ... }[] | transform-nodes after resolving full nodes |
| node.set-properties | Document | nodes: NativeNodeRef[]; allowlisted common properties | set-nodes-properties |
| node.rename | Document | updates: { ref: NativeNodeRef; name: string }[] | rename-nodes |
| node.delete | Document | nodes: NativeNodeRef[] | delete-nodes |
| node.set-canvas-state | Document | nodes: NativeNodeRef[]; onCanvas: boolean | set-nodes-canvas-state |

For node.transform, the v1 payload is restricted to transform fields supported by the current document model: x, y, width, height, and rotation, plus onCanvas only where the current Canvas interaction explicitly requires it. The adapter resolves each node from the addressed document and constructs a complete typed node for the existing reducer action. It must not accept a caller-supplied replacement that can change node identity or node type through a transform command.

For node.set-properties, the only initial patch keys are visible, locked, and layerColor. Style, text content, hierarchy, component references, and clipping are handled by dedicated typed commands or by a complete typed node replacement subject to validation.

For node.create, IDs must be assigned before the command is submitted. The command must reject IDs that already exist in the target document. V1 retains the current document-local uniqueness rule; it does not claim project-wide uniqueness for internal node IDs.

### 5.3 Layer commands

| Command | Target | Payload | Legacy compatibility route |
|---|---|---|---|
| layer.move | Document | node ref; target ref; position: before, inside, or after | move-layer |
| layer.move-many | Document | node refs; target ref; position | move-layers |
| layer.group | Document | node refs | group-layers |
| layer.ungroup | Document | node refs | ungroup-layers |
| layer.create-clipping-mask | Document | node ref | mask-layer |
| layer.remove-clipping-mask | Document | node ref | unmask-layer |

The adapter must preserve existing layer semantics rather than implement a parallel tree algorithm:

- document.nodes remains a flat array.
- parentId remains the hierarchy reference.
- Array order remains paint order, back-to-front.
- Layers panel sibling order remains reversed relative to the stored array.
- Ordinary visual nodes may currently have children; do not impose a new Group-only parent rule.
- clipMaskBaseId remains a separate clipping relationship, never a parent-child edge.
- Group, ungroup, move, delete, and clip operations preserve existing behavior for nested groups, ordinary visual parents, child promotion, selection roots, and clipping retarget/cleanup.

The current groupLayers helper generates a group ID internally. The v1 adapter must return the actual created group reference by comparing the before/after document and must not infer its ID from display name or array position. Injecting a caller-assigned group ID is a possible small follow-up improvement, not a reason to redesign layer operations now.

### 5.4 Component commands

| Command | Target | Payload | Legacy compatibility route |
|---|---|---|---|
| component.create | Project | Complete validated ComponentDefinition | add-component |
| component.update | Project | Complete validated updated definition | update-component |
| component.rename | Project | componentId and name | rename-component |
| component.delete | Project | componentId plus explicit destructive-action authorization | delete-component |

Component definition document edits must carry a component document address and resolve against the owning project's component ID. A command may not update the component with the same name or an ID from another project.

V1 must retain existing component behavior:

- A component definition owns its document.
- A page instance references the definition by componentId.
- Existing overrides remain keyed by internal node ID and remain limited to fill/text in the current model.
- Nested component instances in master definitions remain rejected by current validation.
- Deleting a definition continues to detach referencing page instances through the existing helper/reducer behavior.
- Detach is a deliberate operation and is not silently substituted for every definition update.

**Component Canvas integration gate:** because the current Component Canvas edits a temporary project buffer and later synchronizes it into the main project, component-document command routing must not be enabled until the adapter can correlate the buffer with the canonical { projectId, componentId, documentId } target and report completion only after the canonical definition update succeeds. Keep the existing workflow intact until that bridge is implemented and tested.

### 5.5 Not in the v1 executable catalog

The following are future command families, not available v1 mutations:

- Node Logic graph, event, condition, variable, state, API request, data-binding, effect, filter, or animation commands.
- Motion tracks, keyframes, playback, or timeline commands.
- Code Mapping, source-region, generated-code, custom-code, or override commands.
- Design System tokens, themes, or style-library commands.
- Multi-Application ownership and cross-application commands.
- Collaboration, remote synchronization, or distributed conflict-resolution commands.
- Arbitrary source-code writes and file-system commands.

Their future commands must use the same project identity, validation, permission, result, and history contracts. They must not create workspace-specific copies of canonical entities.

## 6. Validation and preconditions

Validation has two distinct responsibilities:

1. **Command validation** validates the requested intent and its target.
2. **Project validation** validates the resulting project against the existing project schema.

Both must pass before the candidate state is published.

### 6.1 Validation order

The executor follows this order:

1. Parse the input as untrusted data.
2. Validate protocol name, protocol version, command ID, timestamp, type, and command version.
3. Resolve the registry entry. Reject unknown command types or unsupported versions.
4. Authenticate the caller through trusted host context.
5. Authorize the required permission for this command and target.
6. Resolve the project target by project metadata ID.
7. Resolve the full document/node address, where applicable.
8. Validate every ID and reference against that exact scope.
9. Validate the typed payload, required fields, value ranges, and operation-specific constraints.
10. Check lock/capability rules applicable to that operation.
11. Check preconditions, including expectedRevision when supplied.
12. Build a candidate immutable state using the compatibility adapter.
13. Validate the candidate project using the existing project validator.
14. Publish the candidate state only if every previous step succeeds.

A rejected command must not call a reducer action that can mutate state and then attempt to repair it afterward.

### 6.2 Target and reference validation

- Project ID must exactly match the project being mutated.
- Page owner ID must resolve to a page in that project.
- Component owner ID must resolve to a component definition in that project.
- The addressed document ID must match the resolved owner's current document ID.
- Node references must resolve inside the addressed document only.
- Every node in a multi-node operation must resolve; partial filtering is not permitted.
- Node IDs in create payloads must be unique within the target document and must not duplicate one another in the same payload.
- Component references and override targets must satisfy the current validator.
- A command must never silently retarget an inactive page to the active page.
- Duplicate, missing, stale, or cross-document references return an explicit rejection.

The current AST view can provide scoped lookup and derived hierarchy/order queries. It remains read-only. Mutation and invariant enforcement belong to the command adapter plus project validation.

### 6.3 Payload validation

- Use discriminated TypeScript payload types and runtime validators for every registry entry.
- Reject NaN, Infinity, non-finite geometry, invalid dimensions, empty required IDs, unsupported enum values, and unknown node types.
- Enforce the existing node type schemas in validation.ts.
- Use explicit property allowlists. Do not accept unrestricted Partial<DesignNode>, Record<string, unknown>, JSON Patch paths, executable expressions, or arbitrary object merges as a generic update command.
- Do not allow a transform payload to change id, type, parentId, componentId, overrides, or unrelated style/text data.
- A command that deletes or replaces linked content must validate affected component references and other known references before commit.
- A command that would violate the existing strict project validator must be rejected. Do not weaken validation for convenience.
- Do not introduce stricter future AST constraints (for example, Group-only parent capability) until a compatibility migration is agreed and tested.

### 6.4 Preconditions and revisions

The current FolioProject does not contain a monotonic revision number. metadata.updatedAt is a timestamp used by the existing project model and is not a reliable concurrency token.

V1 therefore defines an **optional host-owned in-memory expectedRevision**:

- The editor store increments its revision after every committed project mutation.
- A command with expectedRevision must match the current store revision.
- A mismatch returns REVISION_CONFLICT without applying anything.
- A command without expectedRevision is allowed only in the current single-editor, synchronous local execution path.
- The revision must not be serialized into .flop v2 or confused with AST schema version.
- If the host cannot verify a supplied revision, it must reject rather than ignore it.

This is a local stale-command guard, not a distributed concurrency protocol. Persistent revisions, remote actor clocks, conflict merging, and collaboration leases remain future work.

### 6.5 Lock and capability checks

The command adapter must apply lock behavior consistently with current workspace rules:

- Commands that transform, move, rename, or delete locked nodes must reject them unless the existing UI flow explicitly provides an authorized unlock/override operation.
- For operations affected by inherited lock state, use the current layer-state helpers rather than checking only the node's local locked flag.
- Visibility/lock toggles are explicit property commands and must not be confused with content edits.
- Do not invent a complete per-property capability system in v1. Capability descriptors belong to a later AST/component contract milestone.

The adapter must not rely on UI controls being hidden or disabled as authorization.

## 7. Atomic project mutation and failure handling

### 7.1 Immutable candidate state

The project mutation flow is copy-on-write:

1. Keep the current EditorState and FolioProject as the unchanged input.
2. Resolve and validate the command against that input.
3. Build the result in a local candidate state using existing immutable helpers and reducer actions.
4. Validate the complete candidate project.
5. Publish exactly one resulting EditorState to the host store.
6. Emit a success result and change notification only after the store accepts the candidate.

Do not mutate an existing project, document, node array, or AST view in place.

### 7.2 Atomicity guarantee

For one command, the guarantee is:

- **Success:** the complete candidate project mutation is published.
- **No-op:** no project mutation is published and no history snapshot is added.
- **Rejected/failed:** the previous project and history remain unchanged.

A command must never partially apply to some selected nodes while silently skipping missing or invalid targets. When a command addresses multiple nodes, all requested targets must validate before the mutation is prepared.

### 7.3 Candidate validation

The compatibility adapter must validate both the intent and final project. The final candidate must pass the existing validateProject contract before publication.

The existing validator is the v1 authority for the current v2 project model. It checks current node schemas, per-document node IDs, hierarchy references/cycles, project page and route identity, component references and override targets, logic graph records, and assets.

Known current validation gaps remain known gaps. In particular, the current audit does not establish complete validation of clipMaskBaseId target existence/scope/compatibility or project-wide uniqueness of every internal node ID. Do not describe these as solved by the command layer until a specific validation change and tests exist.

### 7.4 Failure and rollback

The reducer and document helpers are expected to be used as immutable transformations. If an intermediate candidate fails validation, discard it and retain the original state object.

The command layer must not:

- Undo a failed command by dispatching an inverse mutation.
- Restore an old persisted project after a partial write.
- Save a failed candidate to IndexedDB.
- Emit a success notification before the state store accepts the new state.
- Silently convert a rejection into a no-op.
- Hide a validation failure behind a generic toast.

Persistence remains downstream of the accepted project state and keeps its existing validation boundary. File import/replacement must validate the entire incoming project before replacing the current state.

## 8. Command execution lifecycle

### 8.1 Single-command lifecycle

~~~text
Create typed intent
       |
       v
Parse and validate envelope
       |
       v
Resolve registry + trusted actor permissions
       |
       v
Resolve exact project/document/node targets
       |
       v
Check payload + preconditions
       |
       v
Prepare candidate through compatibility adapter
       |
       v
Validate candidate FolioProject
       |
   +---+---+
   |       |
 invalid  valid
   |       |
 reject   publish once
           |
           v
       result + change event
           |
           v
     existing autosave
~~~

### 8.2 Proposed minimal API surface

The first implementation can be a small framework-independent module under src/core/commands/ or another location chosen to match repository conventions. It must not import Preact, DOM/SVG types, workspace components, browser APIs, or persistence adapters.

A minimal shape is:

~~~typescript
type NativeCommandExecution =
  | {
      status: 'applied';
      nextState: EditorState;
      result: NativeCommandResult;
      change: NativeChangeSet;
    }
  | {
      status: 'no-op';
      nextState: EditorState;
      result: NativeCommandResult;
    }
  | {
      status: 'rejected';
      nextState: EditorState;
      result: NativeCommandResult;
    };

function executeNativeCommand(
  state: EditorState,
  command: NativeCommand,
  context: NativeCommandContext
): NativeCommandExecution;
~~~

This is a proposed contract, not an existing exported function. NativeCommandContext contains the trusted actor/capabilities, the resolved editor/project scope, and the current in-memory revision. It is supplied by the application host and is not accepted from command payload data.

The compatibility adapter may translate a command to one or more existing EditorAction values and call the existing editorReducer in memory to build a candidate. It must not dispatch to a reducer and then mutate project state through a second path.

The application integration must install the returned state through one thin reducer/store integration. The integration must preserve the existing reducer's behavior for legacy EditorAction values. A rejected command must leave the reducer state unchanged and return the structured error through a non-persistent result channel.

The command execution module must be deterministic with respect to its explicit inputs, except for existing helper behavior that generates IDs or timestamps. A future refinement may inject IDs/timestamps into helpers to improve replayability; it is not a prerequisite for changing the entire editor architecture.

### 8.3 Preparation and completion

The following are separate moments:

- **Prepared:** envelope, permission, target, payload, and preconditions passed; the candidate is ready.
- **Committed:** the store accepted the candidate state.
- **Notified:** dependent UI observers received the committed change notification.

The executor must not report applied during preparation. If the host cannot install the candidate, the command is not committed.

A UI notice, preview refresh, or autosave status is not proof that the project mutation committed.

## 9. Command result and change notification contracts

### 9.1 Result

Every command returns one result, including a rejected command.

~~~typescript
type NativeCommandStatus = 'applied' | 'no-op' | 'rejected';

interface NativeCommandResult {
  protocolVersion: 1;
  commandId: string;
  transactionId?: string;
  status: NativeCommandStatus;
  code: string;
  message: string;

  projectId: string;
  revisionBefore: number;
  revisionAfter: number;

  changed: boolean;
  affectedDocuments: DocumentAddress[];
  affectedNodes: NativeNodeRef[];

  warnings: NativeCommandWarning[];
}
~~~

Result rules:

- commandId always echoes the submitted command ID.
- status: applied means the new project state was accepted by the store.
- status: no-op means the command was valid but produced no semantic project change.
- status: rejected means the command was invalid, unauthorized, stale, unsupported, or conflicted.
- changed is true only for applied.
- revisionAfter advances only after a committed project mutation.
- affectedDocuments and affectedNodes use complete scoped references.
- warnings are non-fatal observations and must not conceal errors.
- A result must not expose raw internal exceptions, stack traces, file paths, secrets, or plugin-private data to a user-facing message.

Stable error codes should include at least:

| Code | Meaning |
|---|---|
| INVALID_ENVELOPE | Missing or malformed command envelope |
| UNSUPPORTED_PROTOCOL | Unsupported protocol version |
| UNKNOWN_COMMAND | Command type is not in the registry |
| UNSUPPORTED_COMMAND_VERSION | Command payload version is not supported |
| PERMISSION_DENIED | Trusted actor lacks the required capability |
| PROJECT_NOT_FOUND | Project target cannot be resolved |
| TARGET_NOT_FOUND | Page, component, document, or node target cannot be resolved |
| TARGET_SCOPE_MISMATCH | Supplied address does not match the resolved owner/document |
| INVALID_PAYLOAD | Payload fails its typed schema or operation constraints |
| INVALID_REFERENCE | Missing, duplicate, or cross-scope reference |
| PRECONDITION_FAILED | A command-specific precondition is not satisfied |
| REVISION_CONFLICT | Expected in-memory revision is stale |
| LOCKED_TARGET | Operation is not permitted on the locked target |
| PROJECT_VALIDATION_FAILED | Candidate project fails existing project validation |
| TRANSACTION_ABORTED | A batch was discarded because one member failed |
| DUPLICATE_COMMAND_ID | The same command ID was already completed in the active deduplication window |
| INTERNAL_ERROR | Unexpected internal failure; details remain in trusted diagnostics |

The exact user-facing English message may vary, but callers and tests rely on stable codes rather than matching message strings.

### 9.2 Change set

The change set describes semantic project areas affected by a committed command. It is derived from the command's resolved targets and the before/after candidate state; it is not a second store.

~~~typescript
interface NativeChangeSet {
  projectId: string;
  revision: number;
  transactionId?: string;
  commandIds: string[];

  documents: Array<{
    address: DocumentAddress;
    nodeIds: {
      added: string[];
      updated: string[];
      removed: string[];
    };
  }>;

  componentIds: string[];
  projectMetadataChanged: boolean;
}
~~~

Rules:

- Emit a change set only after commit.
- A rejected command and a no-op command do not emit a mutation event.
- A batch emits one transaction-level change set, not one externally visible partial event per internal action.
- Node IDs in a change set are interpreted within their accompanying document address.
- Selection, hover, canvas pan/zoom, active tool, floating-window layout, and other transient UI state are not project change events.
- A command that changes component definition data identifies the component ID and owning project.
- The initial implementation may produce a conservative affected set from the command payload and actual before/after state. It must not claim a precise semantic diff when it only knows that a document changed.

### 9.3 Change notification

~~~typescript
interface NativeChangeEvent {
  eventId: string;
  projectId: string;
  revision: number;
  commandId: string;
  transactionId?: string;
  source: NativeCommandSource;
  change: NativeChangeSet;
}
~~~

The first implementation may expose a synchronous in-process callback or store subscription. It is not a durable event log, collaboration message, network event, or persistence record.

Subscribers treat the event as notification that the already-committed project state changed. They query the project model/AST facade for current values rather than treating event payloads as a competing source of truth.

Notification handlers must not be allowed to mutate the project re-entrantly during the same commit. Follow-up mutations are new commands.

## 10. Batch commands and transaction boundaries

### 10.1 Purpose

A batch groups related operations that should be accepted or rejected together. A batch is an explicit transaction request; merely assigning the same transactionId to separate commands does not make them atomic.

~~~typescript
interface NativeCommandBatch {
  protocol: 'folio.native-command-batch';
  protocolVersion: 1;
  transactionId: string;
  projectId: string;
  commands: NativeCommand[];
  preconditions?: NativeCommandPreconditions;
}
~~~

### 10.2 V1 transaction rules

- A batch is limited to one project.
- All command targets must resolve within that project.
- Commands execute in declared order against the evolving candidate state.
- Every command is validated against the candidate produced by preceding commands, not only against the original state.
- If any command is rejected or candidate validation fails, discard the complete candidate and leave the original project/history unchanged.
- A successful batch publishes one final state, one history boundary, one revision increment, one result, and one transaction-level change notification.
- No nested batches in v1.
- Empty batches are invalid.
- A batch containing only valid no-op commands returns no-op and creates no history entry.
- A batch with an invalid member returns rejected with TRANSACTION_ABORTED and identifies the failing command result in trusted diagnostic detail.
- The batch size should have a conservative implementation limit (initial proposal: 100 commands). The limit is a safety guard, not a product promise; it may be tuned using tests and payload cost.

### 10.3 Commands excluded from v1 batches

Do not include actions that reset history, replace the entire project, or alter history traversal:

- project.replace
- page.create / page.switch while those retain their current history-reset behavior
- Undo and Redo
- commit-edit
- A nested batch

A later design may define explicit history boundaries for page lifecycle operations. V1 preserves the current reducer behavior rather than changing it to make batching appear uniform.

### 10.4 Mapping a batch onto snapshot history

The legacy reducer normally creates a snapshot for each mutating editor action. A command batch must not leave one Undo entry per internal action.

Proposed adapter behavior:

1. Keep the original EditorState as the transaction base.
2. Apply each translated EditorAction to a private candidate state using editorReducer.
3. Validate the evolving candidate after each command and at the final project boundary.
4. If any step fails, discard the candidate.
5. If the batch changes project data, publish the final candidate with one new history snapshot pointing to the original project, clear future, and clear any open history coalescing group.
6. Preserve the final valid selection state only after filtering it against the final active document.
7. If nothing changed, return the original state and do not add history.

The adapter must not publish intermediate candidate states or emit intermediate change notifications. The 60-snapshot history limit remains in force.

## 11. Compatibility with editorReducer

### 11.1 Compatibility is the v1 strategy

src/app/editorReducer.ts remains the state mutation implementation for the existing editor during the first Native Command milestone.

The command layer provides a typed entry point and validation boundary. Its adapter translates supported commands into existing EditorAction values and relies on existing immutable reducer logic.

This strategy is intentionally incremental. It avoids a second implementation of layer operations and preserves the current application's expected state behavior.

### 11.2 Action mapping

The initial mapping should be explicit and exhaustive:

| Native command intent | Existing reducer action |
|---|---|
| Create one node | add-node |
| Create multiple nodes | add-nodes |
| Replace one complete typed node | replace-node |
| Edit one node with coalescing | edit-node |
| Set common properties for many nodes | set-nodes-properties |
| Rename nodes | rename-nodes |
| Transform nodes | transform-nodes |
| Move one layer | move-layer |
| Move multiple layer roots | move-layers |
| Group selected layers | group-layers |
| Ungroup selected layers | ungroup-layers |
| Create/remove clipping relation | mask-layer / unmask-layer |
| Toggle Canvas placement without deleting the layer | set-nodes-canvas-state |
| Delete nodes | delete-nodes / delete-node |
| Rename project | rename-project |
| Create/update/rename/delete component | Existing component actions |

No generic command may dispatch arbitrary EditorAction data supplied by a plugin or AI caller. The adapter constructs allowed actions from validated typed payloads.

### 11.3 Active-page compatibility limitation

The current node-oriented reducer actions obtain the document from getActiveDocument(state.project). They do not accept an explicit DocumentAddress parameter.

Therefore:

- The v1 page-command adapter must verify that the addressed page is the exact active page in the EditorState receiving the action.
- If the command targets another page, reject it with TARGET_SCOPE_MISMATCH or an explicit inactive-target code. Do not silently apply it to the active page.
- A later adapter may add page-scoped action builders that resolve and update the addressed page without switching the active page.
- Do not duplicate reducer logic in every workspace to work around this limitation.

Component-definition document writes have a related constraint and must pass the Component Canvas integration gate in section 5.4.

### 11.4 Legacy actions remain supported

Existing workspace code may continue dispatching legacy EditorAction values while commands are introduced incrementally.

During coexistence:

- Legacy actions retain their current behavior.
- New command-aware paths perform strict validation before translating to legacy actions.
- Both paths ultimately update the same EditorState/project aggregate used by that editor context.
- Do not create a second mutation implementation for a command just because a matching legacy action exists.
- Migrate one operation family at a time and compare resulting project semantics.

The first adopter should be a bounded Main Canvas operation family, not every workspace and every reducer action in one change.

## 12. Compatibility with snapshot-based Undo/Redo

### 12.1 Existing history contract

The existing reducer currently:

- Stores complete FolioProject snapshots in past and future.
- Caps history at 60 snapshots.
- Creates a snapshot for ordinary undoable mutations through withSnapshot.
- Coalesces repeated edit-node mutations with the same coalesceKey until commit-edit.
- Clears redo history after a new mutation.
- Keeps selection outside the project snapshots.
- Filters selection IDs against the restored active document on Undo/Redo.
- Resets history on add-page and set-active-page in the current implementation.

This is snapshot history. It is not command history or event sourcing.

### 12.2 Required command behavior

For v1:

- One successful, discrete, state-changing command creates one snapshot, following its mapped reducer action.
- A valid no-op creates no snapshot.
- A rejected command creates no snapshot and does not clear future.
- A successful new mutation clears future, matching current reducer behavior.
- Explicit coalescing uses the existing edit-node / coalesceKey / commit-edit semantics. The command adapter must not invent a parallel coalescing store.
- A successful batch creates one snapshot for the entire transaction.
- Undo and Redo remain reducer operations. They do not become inverse Native Commands in v1.
- Selection and canvas-only transient state remain outside project snapshots.
- Page creation/switch history reset behavior is preserved until a separate approved change.

### 12.3 No command log yet

V1 does not persist a command journal, inverse payloads, snapshots per command, or a replay log. The command ID and result are useful for correlation, but they are not history records.

A future command-history engine may store semantic command records, inverse data, checkpoints, or compressed snapshots. It must be separately designed and prove parity with the existing snapshot behavior before replacing it.

## 13. Stable IDs and Native AST integration

### 13.1 Existing identity guarantees

The current project model uses string IDs:

- Project metadata has a project ID.
- Pages and component definitions have IDs.
- Documents have IDs.
- Node IDs are validated as unique inside each document.
- Component instances refer to definitions through componentId.
- Component overrides refer to definition-internal node IDs.

The existing DocumentAddress / NativeNodeRef provide the minimum scope needed to avoid resolving a node in the wrong document.

### 13.2 Command identity versus entity identity

| Identity | Scope and purpose |
|---|---|
| commandId | One command submission; diagnostics and duplicate-submission protection |
| transactionId | One batch/transaction |
| projectId | Project aggregate identity |
| pageId | Page owner identity |
| componentId | Component definition identity |
| documentId | Exact page or component document identity |
| nodeId | Node identity within the owning document |
| NativeNodeRef | Full scoped address for a node |

Never regenerate a node ID when renaming, moving, transforming, grouping around it, saving, reopening, or applying a compatible migration. Do not use a display name or array position as a durable reference.

### 13.3 AST usage

The command adapter uses the AST compatibility API for scoped reads and structural queries where appropriate.

- createDocumentAstView is read-only.
- Rebuild the view after an immutable document replacement.
- The AST facade does not own mutation, transaction, persistence, or history behavior.
- Commands update the current project/document types through the existing mutation path.
- After commit, workspaces build or retrieve a new read view from the committed document.
- Do not serialize the AST view or create a shadow mutable tree.

### 13.4 Current model limits

V1 preserves the existing model instead of pretending future AST capabilities already exist:

- Flat nodes[] with parentId, not nested child arrays.
- Existing array order as paint/sibling storage order.
- Separate clipMaskBaseId relation.
- Existing node union: group, rect, ellipse, text, and component-instance.
- Existing fill/text component overrides.
- Document-local node ID uniqueness.
- Existing .flop v2 JSON structure.

A command protocol change does not authorize a persisted schema or AST rewrite.

## 14. Error handling and conflict prevention

### 14.1 Error categories

Errors are classified as:

- **Malformed:** envelope or payload cannot be parsed.
- **Unsupported:** protocol, command type, or command version is unknown.
- **Unauthorized:** trusted execution context lacks a required permission.
- **Unresolved:** project or target reference cannot be resolved.
- **Invalid:** payload or candidate violates a current schema/invariant.
- **Stale/conflicting:** revision or command-specific precondition no longer holds.
- **Locked:** the operation is not allowed for the current lock state.
- **Internal:** unexpected implementation failure.

Every error returns a stable code, a safe English message, and the command ID. Trusted diagnostics may additionally contain the underlying cause.

### 14.2 Conflict prevention in v1

The first implementation is local and synchronous. It can prevent common stale-target mistakes by:

- Carrying the complete document address.
- Resolving every node inside the addressed document.
- Verifying the target is still present immediately before mutation.
- Using optional host-owned expectedRevision.
- Rejecting stale or cross-document references.
- Validating the final project before publishing.
- Applying a whole multi-node operation or none of it.

This does not solve simultaneous writes from multiple tabs, devices, users, plugins, or remote agents. Do not claim conflict-free collaboration based on local revision checks.

### 14.3 No-op versus rejection

A command is a **no-op** only when the request is valid and already satisfied (for example, setting visibility to its current value).

A command is **rejected** when it requests an invalid or unsupported operation (for example, a missing node, duplicate create ID, inactive page target, incompatible node type, insufficient permission, or stale revision).

Do not use the current reducer's silent-return behavior as the public command result. The command adapter must validate enough context to report the correct category.

### 14.4 Destructive operations

Delete, component definition deletion, detach, project replacement, and future reference-removal operations must declare their destructive scope.

- A workspace may initiate a user-confirmed action.
- The command executor still validates the effect and permission.
- A plugin or AI agent must not bypass the host's confirmation requirement by submitting a command directly.
- Confirmation tokens, when introduced, must be host-issued, scoped to the exact operation, and short-lived.
- A rejected or cancelled operation does not alter the project.

## 15. Security and permission boundaries for future plugins and AI agents

Native Commands are a security boundary, but they are not a sandbox for arbitrary executable code.

### 15.1 Trusted host context

The host supplies a trusted execution context:

~~~typescript
interface NativeCommandContext {
  projectId: string;
  revision: number;
  principal: {
    kind: 'user' | 'system' | 'plugin' | 'ai-agent';
    id: string;
  };
  capabilities: readonly NativePermission[];
  workspace: NativeWorkspace;
}
~~~

The source metadata supplied inside a command must match or be normalized against this trusted context. It cannot grant capabilities.

### 15.2 Capability model

The initial permission model should be small and explicit, for example:

- project.read
- project.rename
- document.read
- node.create
- node.update
- node.transform
- node.reorder
- node.delete
- component.read
- component.update
- component.delete

Permissions are checked for the command type and target scope. A future plugin/AI integration may receive narrower capabilities such as a restricted set of documents, node types, or property categories.

V1 should deny unknown permissions and unknown principals by default.

### 15.3 Input and data protections

- Treat every command from a plugin, extension, remote client, imported file, or AI agent as untrusted input.
- Validate payload size, array length, string length, number range, nesting depth, and supported types.
- Never evaluate code, expressions, shell commands, SQL, JavaScript, or arbitrary function names contained in a payload.
- Do not accept arbitrary file paths, network destinations, credentials, tokens, or environment variables as generic command parameters.
- Do not permit arbitrary direct project-object replacement except through the trusted import/recovery path.
- Keep permission checks out of user-controlled UI labels and source metadata.
- Preserve unmapped/custom code and unknown project data; do not allow a generic mutation to overwrite data the command does not own.
- Record safe audit metadata for privileged operations without logging credentials or private project content unnecessarily.

### 15.4 AI agent boundary

Future AI agents must use the same Native Command contracts as other actors.

- AI output is an intent proposal, not trusted code.
- The host validates and authorizes every command independently.
- The model cannot bypass schema validation, stable references, project scope, or user confirmation.
- Destructive or broad-scope operations require explicit host approval.
- A prompt or tool response cannot manufacture permissions.
- The agent must be told which command types and scopes are actually supported; unsupported work must remain a proposal, not a silent fallback.

A future plugin/AI SDK is a separate milestone. This document does not authorize execution of arbitrary third-party code inside the FOLIO engine.

## 16. Testing and acceptance criteria

Native Commands v1 is not implementation-complete merely because this document exists. Implementation must add focused tests using the repository's existing Vitest conventions.

### 16.1 Envelope and registry tests

- Valid v1 envelope passes.
- Missing/invalid command ID, timestamp, source, target, or payload is rejected.
- Unsupported protocol version is rejected.
- Unknown command type is rejected.
- Unsupported command type version is rejected.
- Unknown envelope fields follow the explicit v1 rejection policy.
- Duplicate command ID is rejected within the configured deduplication window.

### 16.2 Scope and reference tests

- A page command resolves only the addressed page and exact document ID.
- A component command resolves only the addressed component definition and exact document ID.
- A node reference resolves only within its DocumentAddress.
- Same node ID in two different documents is not confused.
- An inactive page target is rejected by the initial reducer adapter rather than applied to the active page.
- A temporary Component Canvas buffer is not mistaken for a canonical component definition.
- Missing, duplicate, stale, and cross-project/cross-document references are rejected before mutation.
- Multi-node commands reject the whole request if any referenced node is invalid.

### 16.3 Payload and project validation tests

- Valid current DesignNode payloads are accepted.
- Invalid node type or node-specific fields are rejected.
- Duplicate IDs in one create payload or against the target document are rejected.
- Non-finite numbers and invalid dimensions are rejected.
- Generic property mutation cannot change identity, type, parent, component reference, or unrelated style data.
- Component references and override targets remain valid.
- Candidate validateProject failure leaves original state unchanged.
- Current compatibility behavior for ordinary visual-node parents, group nesting, clipping, component overrides, and detach is preserved.
- No new project-wide uniqueness or future AST capability rule is assumed.

### 16.4 Reducer parity and history tests

For every supported command, compare the command adapter result with the equivalent legacy action against the same fixture.

- Same resulting project semantics and node order.
- Same expected selection behavior where applicable.
- One Undo restores the state before one discrete command.
- Redo reapplies it.
- Coalesced edits preserve the existing coalesceKey / commit-edit behavior.
- Valid no-op creates no history snapshot.
- Rejected command does not change project, past, future, selection, or historyGroup.
- A successful new edit clears redo history.
- History remains capped at 60 snapshots.
- Existing page-add/page-switch history reset behavior remains unchanged.
- Batch success creates exactly one history entry.
- Batch failure publishes no intermediate state and creates no history entry.

### 16.5 Result and notification tests

- Every command produces one result with the matching commandId.
- Applied, no-op, and rejected statuses are distinguishable.
- Revision advances only after commit.
- Rejected/no-op commands do not emit change events.
- An applied command emits one scoped change event after commit.
- A batch emits one transaction-level event only after the entire transaction commits.
- A subscriber cannot mutate the project re-entrantly as part of the same commit.
- Notifications identify the correct project/document/node scopes.

### 16.6 Permission and security tests

- A user with the required permission can execute the supported command.
- A caller without the required permission is rejected.
- Source metadata cannot elevate privileges.
- Plugins and AI agents cannot use project replacement or destructive commands without the appropriate capability and host confirmation.
- Unknown principals and unknown capabilities are denied.
- Payloads containing executable-looking strings, file paths, network URLs, or arbitrary patch instructions are treated as data and cannot trigger execution.

### 16.7 Required repository verification

When implementation is authorized, run the repository's existing automated checks:

~~~bash
npm run check
npm run test
npm run build
~~~

Also run focused command, reducer, document, layer, AST, component, and history tests. Manual UI acceptance is a separate verification step. Do not report browser tests, Windows-laptop acceptance, CI, or plugin/AI security review as passed unless the corresponding checks actually ran.

### 16.8 V1 exit criteria

Native Commands v1 can be marked **Implemented** only when:

1. The agreed envelope and registry are implemented.
2. At least one end-to-end command family is routed through the validated boundary.
3. Target resolution uses full scoped references.
4. Invalid commands cannot change project state or history.
5. Successful commands preserve reducer output and snapshot Undo/Redo behavior.
6. No-op, rejection, result, and change notification contracts are tested.
7. Batch transactions, if included in the v1 release, are atomic and produce one history entry.
8. Existing .flop v2 and IndexedDB behavior remain unchanged.
9. The legacy reducer path remains compatible during incremental adoption.
10. The required automated checks pass and their results are recorded.

V1 can be marked **Verified** only against the implementation and test evidence above. This documentation-only specification does not satisfy those implementation exit criteria.

## 17. Incremental adoption roadmap

### Phase 0 — Specification review (this task)

- Agree the envelope, target scope, status vocabulary, and compatibility rules.
- Resolve open questions that block the first adapter.
- Keep this deliverable documentation-only.
- Do not change source code, AST behavior, .flop format, or reducer behavior.

**Exit:** Native Commands v1 contract reviewed and approved.

### Phase 1 — Minimal local command core

- Add the smallest framework-independent command types, validators, and static registry.
- Implement one bounded Main Canvas command family first (recommended: node transform and common node properties).
- Translate validated commands into the existing reducer actions.
- Return explicit applied/no-op/rejected results.
- Preserve the existing snapshot history.
- Add scoped address and reducer parity tests.

**Exit:** the pilot command family behaves identically to its legacy reducer equivalent for supported fixtures; failures leave state/history unchanged.

### Phase 2 — Document and layer command coverage

- Add node create/replace/rename/delete, move, group/ungroup, clipping, and Canvas-placement commands.
- Reuse layers.ts, project.ts, ast.ts, and reducer behavior rather than creating parallel mutation algorithms.
- Add candidate project validation and revision preconditions.
- Add batch support only after the single-command path is proven.

**Exit:** supported layer operations pass parity, identity, atomicity, and history tests.

### Phase 3 — Component command bridge

- Formalize how the Component Canvas editing buffer maps to the canonical project component definition.
- Route component document writes through canonical project/component scope.
- Preserve current master/instance/override/detach behavior.
- Prevent a temporary workspace project ID from appearing in canonical command references.
- Add synchronization and failure tests for the buffer-to-definition boundary.

**Exit:** component commands update the owning project definition and notify all dependent views without creating another source of truth.

### Phase 4 — Workspace adoption

- Move Designer interactions onto Native Commands incrementally.
- Adopt the same contracts in Developer and future Node Logic workflows.
- Keep workspace UI state independent while canonical project data remains unified.
- Retain legacy reducer actions during migration and remove duplicate mutation paths only after parity tests pass.

**Exit:** all supported workspace mutations share the command boundary and project/AST semantics.

### Phase 5 — External actors and collaboration

- Define persistent command identity/deduplication, durable revisions, and remote conflict policy.
- Define narrower plugin and AI capability grants and host confirmation UX.
- Design durable audit/history integration and collaboration event transport separately.
- Introduce remote execution only after local command semantics and conflict tests are stable.

**Exit:** external actors use the same validated commands without bypassing FOLIO project rules.

Do not skip phases or combine command rollout with a breaking AST schema, .flop container, component contract, or history rewrite.

## 18. Open questions requiring a deliberate decision

These questions do not block the documentation draft, but must be resolved before the relevant implementation phase:

1. **Command ID policy:** should UUID generation and in-session duplicate detection live in the app store, the command module, or a shared identity service?
2. **Durable idempotency:** when remote collaboration exists, where should processed command IDs and replay outcomes be stored?
3. **Revision ownership:** should the in-memory revision live beside EditorState, in a future project store, or in a unified engine coordinator? It must not be confused with metadata.updatedAt.
4. **Inactive document editing:** should v1 initially reject inactive page targets, or add explicit page-scoped reducer actions that update any addressed page without switching the active page?
5. **Component Canvas model:** when should the temporary component editor buffer be replaced by a canonical component-document editor context? What is the approved synchronization and conflict policy while a master is being edited?
6. **Group ID injection:** should the existing groupLayers helper accept an optional caller-provided group ID so a command can allocate identity before execution and improve replay determinism?
7. **Command naming:** should command type strings remain flat (node.transform) or use another stable namespace convention? The registry must enforce one convention before implementation.
8. **Batch failure reporting:** should public batch results expose a structured list of per-command outcomes, or only the failed command plus one transaction-level result? Internal diagnostics must identify the failure either way.
9. **Lock override:** should privileged system/AI/plugin actors ever be allowed to mutate locked nodes, or must they first submit a separate explicit unlock command?
10. **History and page lifecycle:** should page creation/switch continue to reset history, or should a later history milestone preserve a single project-wide timeline?
11. **Change-set precision:** which consumer first requires property-level diffs instead of the conservative document/node affected set proposed here?
12. **Command compatibility:** what support window is required for older saved command payloads if commands eventually become persisted or exchanged between application versions?

Any decision that changes the current project model, .flop compatibility, AST identity, or workspace ownership must be documented and tested before implementation.

## 19. Final status summary

**Agreed:** Native Engine First, Unified Project Model, stable scoped identity, Native AST as shared semantic foundation, independent workspaces under shared integration rules, .flop as the native project extension, and Node Logic ownership of authored behavior.

**Existing / Implemented at the audited baseline:** editorReducer, immutable project/document helpers, snapshot Undo/Redo, project validation, the flat nodes[] plus parentId model, current component actions, and the read-only AST compatibility facade.

**Proposed by this specification:** Native Command envelope and registry, typed command catalog, trusted execution context, command validation, candidate-state execution, result/change contracts, batch transactions, local revision checks, and future plugin/AI permission boundaries.

**Open:** component buffer-to-canonical command integration, inactive document routing, durable idempotency/revisions, global identity policy, group ID injection, distributed conflict handling, and eventual command-based history.

**Not implemented by this documentation:** no source code, reducer, AST, project file, persistence layer, workspace behavior, plugin API, or Node Logic implementation is changed by this specification.

---

**Next authorized engineering milestone:** implement the minimal local command core for one Main Canvas operation family, prove reducer/history parity, and preserve the existing project and .flop v2 contracts.
