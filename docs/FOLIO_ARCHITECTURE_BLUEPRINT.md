# FOLIO Architecture Blueprint

**Document ID:** FOLIO-ARCH-001  
**Version:** 0.2 — Working Draft  
**Status:** In progress  
**Product:** FOLIO Studio  
**Positioning:** The Unified Creative Development Studio  
**Native project format:** \`.flop\`

> This document is the canonical reference for FOLIO's agreed target architecture. Product identity, founding purpose, vision, mission, and durable product outcomes are defined in the linked product charter documents below. This blueprint is not evidence that every described capability has already been implemented.

## Product charter — read before architecture work

The product intent behind this architecture is documented in four companion documents:

- [Folio Manifesto](FOLIO_MANIFESTO.md) — why Folio exists and the spirit it must preserve.
- [Folio Vision](FOLIO_VISION.md) — the desired future product.
- [Folio Mission](FOLIO_MISSION.md) — how Folio pursues that future.
- [Folio Product Goals](FOLIO_PRODUCT_GOALS.md) — durable outcomes, experience principles, and boundaries.
- [FOLIO Creative Studio Direction](FOLIO_CREATIVE_STUDIO_DIRECTION.md) — cross-discipline workspace boundaries, Morph direction, media editing direction, and staged integration.

These documents define product intent; this blueprint translates that intent into target system architecture. The current [Architecture](ARCHITECTURE.md) remains the record of implementation reality. All AI agents and contributors must read the product charter before proposing or implementing material product or architecture changes.

## 1. Purpose and status language

This blueprint guides technical specifications, implementation tasks, code reviews, migrations, and acceptance tests. A feature is not architecturally complete merely because it works in one workspace; it must respect the shared project model and FOLIO integration rules.

Use these statuses precisely:

- **Agreed** — direction explicitly accepted by the product owner.
- **Proposed** — recommended design awaiting detailed validation or a specific decision.
- **Open** — requires investigation or a future decision.
- **Implemented** — present in the repository source code.
- **Verified** — tested against explicit acceptance criteria.

Never label a proposal as implemented, or an implementation as verified, based on documentation alone.

## 2. Product definition

FOLIO is a **Unified Creative Development Studio**: one visual-first environment for design, vector creation, code and full-stack development, interactive behavior, motion and animation, and the long-term addition of non-destructive video and media editing.

FOLIO is not a collection of unrelated applications placed behind one launcher. It is one native project environment with multiple specialized workspaces and engines operating on shared project truth. The product should feel like a creative instrument while retaining the precision, transparency, and control expected from professional engineering software.

**Product promise:** Create visually. Develop freely. Animate expressively. Produce media. Keep everything connected.

FOLIO must enable, over its staged roadmap:

1. Designers and visual creators to compose interfaces, vector artwork, typography, layouts, design systems, and reusable components.
2. Developers to work directly with source code, application structure, behavior, backend integrations, runtime, and deployment.
3. Animators to create expressive timelines, keyframes, easing, and eventually geometry Morph where one object changes shape while retaining its identity.
4. Video and media creators to arrange source assets on non-destructive video and audio timelines, apply effects and transitions, and produce final media.
5. Users to move supported objects, assets, and outputs between disciplines without rebuilding the same work or losing declared relationships.
6. One project to contain applications, pages, reusable components, logic, motion, media assets, code modules, and shared resources through explicit contracts.
7. AI and collaboration to operate on the actual project model, not merely generate disconnected suggestions.

**All-in-one does not mean monolithic.** Each discipline may have its own editor, timeline, data model, rendering strategy, and specialist engine. The shared project layer provides identity, asset references, commands, history, versioning, and interoperability contracts. Specialized engines remain modular and are loaded or used when needed.

The detailed workspace and engine boundaries are recorded in [FOLIO Creative Studio Direction](FOLIO_CREATIVE_STUDIO_DIRECTION.md). This blueprint describes the target architecture; it is not evidence that every capability has already been implemented.

## 3. Core architectural principles

### 3.1 Native Engine First — Agreed

FOLIO owns its native project model, engine contracts, identifiers, commands, synchronization rules, AST, and compiler orchestration. External libraries may provide rendering, parsing, layout, collaboration, and other capabilities, but they are implementation tools—not the source of truth for a FOLIO project.

FOLIO does not need to create its own browser, JavaScript engine, or programming language.

### 3.2 One Unified Project Model — Agreed

All workspaces operate on one logical project model. They may present different interfaces and specialized tools, but they must not maintain disconnected copies of project truth.

### 3.3 Independent Workspaces, Shared Rules — Agreed

Designer and Developer are free to use their own workflows, panels, shortcuts, and tools. Their freedom is bounded by FOLIO integration contracts whenever they create or modify content expected to interoperate with other workspaces.

### 3.4 Visual and code fidelity — Agreed direction

FOLIO must not claim every arbitrary line of code can be represented visually. It must classify code by mapping capability:

- **Generated Code** — produced by FOLIO from native project structures.
- **Mapped Code** — authored or imported code associated with editable native structures.
- **Custom Code** — valid user code not fully represented on the visual canvas.
- **Extension / Override** — deliberate custom behavior or implementation layered onto a compatible native structure.

Unmapped code must be preserved. FOLIO must not silently delete it, rewrite it beyond declared ownership, or falsely label it visually editable.

### 3.5 Stable identity

Documents, nodes, components, instances, properties, assets, logic nodes, and persistent entities require stable IDs. Identity must not depend solely on display names, array positions, or generated output order.

### 3.6 Explicit synchronization

Synchronization must be deterministic, traceable, and conflict-aware. A visual edit and a code edit must not silently overwrite each other when both affect the same underlying meaning.

### 3.7 Safe evolution

Project formats, AST schemas, component contracts, and engine capabilities must be versioned. Migrations must be explicit, recoverable where practical, and must not silently discard project data.

## 4. Workspace model

FOLIO workspaces are different views and specialist tools over the same project—not separate projects.

| Workspace | Main responsibility |
|---|---|
| **Design & Vector** | Visual composition, Canvas, vector geometry, shape editing, layers, responsive layout, typography, reusable components, design system |
| **Node Logic** | Events, conditions, variables, state, interactions, API requests, data binding, user-facing behavior and animation triggers |
| **Code & Full-Stack** | HTML/CSS/JS/TS and supported framework code, application structure, debugging, terminal, Git, backend integration |
| **Motion & Animation** | Motion timelines, keyframes, easing, playback, interaction-driven animation, and the future geometry Morph workflow |
| **Video & Media** | Long-term dedicated media editing: source media, video/audio tracks, clips, trimming, transitions, effects, compositing, preview, and export |
| **Backend** | API connections, authentication, database access, CRUD, server functions, environment configuration |
| **Runtime & Deployment** | Preview, responsive testing, build, optimization, project export, deployment |
| **AI & Collaboration** | Project-aware assistance, shared presence, comments, coordinated editing, history |

A workspace may own its own presentation and specialized interaction model. Anything expected to appear, run, or remain editable elsewhere must use shared FOLIO project contracts. Not every workspace or engine is implemented today; see the current Architecture and the creative studio direction document for status.

### 4.1 Shared creative foundation

The shared layer is responsible for project identity, stable object and asset IDs, asset references, typed native commands, history and undo/redo semantics, project versioning, synchronization, and cross-workspace capability metadata.

Where an object is represented natively in more than one workspace, those representations must refer to the same canonical identity or to an explicit derived relationship. A workspace must not silently clone an object and pretend the clone remains linked to its source.

### 4.2 Specialist engines and timelines

FOLIO should share useful infrastructure—time units, playhead transport, markers, scheduling, keyframe primitives, media asset references, cache interfaces, and history integration—without forcing every timeline into one universal track model.

Motion and animation timelines primarily describe changes to FOLIO objects and their properties over time. A video/media timeline describes editorial arrangements of source footage, audio, clips, tracks, transitions, and effects. They may interoperate through explicit references and renderable outputs, but their specialist semantics remain separate.

The detailed Morph and video/media editing direction, including current implementation boundaries, is documented in [FOLIO Creative Studio Direction](FOLIO_CREATIVE_STUDIO_DIRECTION.md).

## 5. High-level system architecture

The target architecture is:

1. **Workspaces** present focused tools for each role.
2. **Native Project APIs & Commands** validate project queries and mutations.
3. **Unified Project Model** owns in-memory project state and relationships.
4. **Native AST & Identity Graph** own canonical semantic structure for editable interface content.
5. **Specialized models** represent Design System, Components, Logic, Motion, Video/Media, Code Modules, Applications, Documents, Assets, and Configuration.
6. **Synchronization & Change Coordination** maintain mappings, propagate changes, and surface conflicts.
7. **Compiler / Build Orchestration** converts project state into runnable application output.
8. **Runtime / Preview / Deployment** execute and publish built applications.
9. **The .flop Project Container** persists the project; it is not the in-memory engine itself.

Workspace UIs must not become independent sources of project truth. Mutations should flow through typed native commands and validation boundaries.

## 6. Project and application model — Agreed direction

A single \`.flop\` project can contain multiple Applications. Each Application can contain multiple Documents and routes. Project-wide resources can be shared across applications.

Conceptual hierarchy:

- **Project**
  - Project Design System
  - Global Components
  - Shared Assets
  - Backend Connections
  - Project Settings
  - **Applications**
    - Application Design Overrides
    - Local Components
    - Documents / Pages
    - Routes
    - Application Configuration
  - Shared Logic, Code Modules, and other resources

### Multi-Document

Each document has a stable Document ID, its own AST/document structure, and route association. Example pages: Home, About, Products, Contact, Login.

### Multi-Application

One project may hold independent applications such as Storefront, Admin Dashboard, and Customer Portal. Each application has its own documents and routing while reusing project-level resources and backend services. Applications can be previewed and built independently.

### Hybrid Components — Agreed direction

- **Global Components** can be reused throughout the project.
- **Local Components** are scoped to a particular application.
- A **Component Definition** is the reusable blueprint.
- A **Component Instance** references a definition; it is not an unrelated duplicate.
- **Instance Overrides** store intentional local differences.
- **Slots** allow controlled content insertion.
- **Variants** represent supported component alternatives.
- **Detach** converts an instance into an independent editable structure.

Definition updates must preserve valid instance overrides. Structural changes that would invalidate overrides must be surfaced for resolution rather than silently destroying them.

## 7. Designer–Developer integration rules — Agreed

1. **One source of project truth.** Workspaces cannot create competing canonical versions of the same project object.
2. **Stable references.** Cross-workspace relationships use persistent IDs and explicit references.
3. **Declared ownership.** FOLIO must know which system owns a value or code region before updating it.
4. **Mapping transparency.** Every code-to-visual relationship has a known mapping status and scope.
5. **Preserve custom work.** Unknown or unmapped code and data are retained unless the user explicitly chooses to remove them.
6. **Validated mutations.** Changes go through native commands/APIs that validate schema, permissions, references, and compatibility.
7. **Conflict visibility.** Ambiguous or conflicting edits are reported and resolved; they are not silently guessed.
8. **Round-trip safety.** Supported native structures should survive Design → Code → Design cycles without losing their meaning or supported properties.
9. **Consistent history.** Undo/Redo and project history must account for cross-workspace changes as coherent operations.
10. **Capability honesty.** Workspaces clearly show when an object or code region is read-only, partially mapped, custom, unresolved, or unsupported.

## 8. Native Component Contract — Agreed direction

The component contract covers:

- Identity and version
- Structure and internal part identity
- Typed properties and their editability (editable, read-only, hidden, locked)
- Layout behavior and constraints
- Slots and Variants
- Exposed events and behavior
- Code mapping and implementation ownership
- Capabilities and compatibility status

The component implementation may contain custom internals. Designer users should see the public properties, slots, variants, and events intentionally exposed by its contract.

Compatibility should be explicit (for example: Native Compatible, Extension Compatible, or Unresolved). FOLIO must not silently lose component code or data during import, update, or migration.

## 9. Native .flop Project Container — Agreed direction

\`.flop\` is intended to be a native project container, not merely a renamed JSON file.

Proposed logical sections (the exact physical layout remains open):

- \`manifest.json\` — format identity, versions, project identity, engine compatibility, applications/documents, modules, assets, settings.
- \`project.ast\` — canonical project structure and references.
- \`applications/\` — applications, documents, and routes.
- \`design/\` — tokens, themes, and design resources.
- \`components/\` — definitions, instances, overrides, slots, variants.
- \`logic/\` and \`motion/\` — graph and motion project data.
- \`code/\` — source modules and mapping metadata.
- \`assets/\` — project assets.
- \`config/\` — application and runtime configuration.

The **Project Container** is the persisted file format. The **Unified Project Model** is the live in-memory representation loaded from and saved to that container. These concepts must not be conflated.

The manifest is read first. Format migrations must be explicit and must not silently modify the only copy of a project.

**Compatibility note:** the repository currently documents an existing JSON-based .flop format. That current implementation must remain supported until a deliberate versioned container migration is designed, implemented, and verified. Do not break current files merely to match the long-term target.

## 10. FOLIO Design System Model — Proposed v1

The Design System is a project-level source of reusable design decisions. Designer manages it visually; Developer uses the same values in code; components and runtime resolve the same token references.

### Token layers

- **Primitive tokens** — raw foundational values, such as a color, spacing unit, font family, or radius.
- **Semantic tokens** — purpose-based values such as \`text.primary\`, \`surface.canvas\`, \`border.subtle\`, or \`action.primary\`.
- **Component tokens** — optional values for a specific reusable component when it needs a controlled public design surface.

Semantic tokens are the main contract shared between Designer and Developer.

### Initial token categories

Color, Typography, Spacing, Sizing, Border, Radius, Shadow, Opacity, Breakpoints, and Motion.

Values must retain type and units. For example, \`16px\`, \`1rem\`, and \`16\` must not be treated as interchangeable without an explicit conversion rule.

### Scope and themes

Token scope is Project, Application, and optionally Component. Resolution for explicitly overridden tokens is Component → Application → Project. Application overrides must not leak into other applications.

Themes are named value sets (such as Light and Dark) for stable semantic token identities. The active application theme resolves each token to its appropriate value.

### Responsive values and identity

Breakpoints are centrally managed and configurable. Responsive values are typed values attached to relevant properties or tokens, not a token for every screen width.

Every token has a stable ID independent of its editable name. Renaming must not break references. Deleting a referenced token must require replacing or resolving references. Cyclic or type-incompatible aliases must be rejected.

### Designer and Developer behavior

- Designer can create, edit, organize, preview, and apply tokens visually.
- Developer can use the same tokens in code and inspect where they are defined and used.
- Web output initially targets CSS custom properties.
- A literal hard-coded value is not silently converted into a token. FOLIO may suggest tokenization; the user chooses.
- Local one-off values remain allowed and can later be promoted to tokens.

**Status:** Project-level Primitive/Semantic Design Tokens, Light/Dark themes, CSS custom-property output, and token-binding validation are **Implemented & Verified locally** (`src/core/document/tokens.ts`); Application-level token overrides and Multi-Application token scopes remain **Agreed (Roadmap)**.

## 11. AI and collaboration guardrails

AI must understand the actual FOLIO project context: project identity, applications, documents, AST objects, components, Node Logic, code mappings, assets, constraints, and current implementation state.

AI should operate through official FOLIO commands/APIs and native project contracts rather than bypassing them with untracked direct mutations. It must inspect the relevant source and tests before code changes.

AI must:
- Read this blueprint and current architecture instructions before every repository task.
- Separate product intent from implemented reality.
- Preserve custom code and project data.
- Explain mapping limitations and conflicts honestly.
- Ask for confirmation before destructive, irreversible, or production-impacting actions.
- Never silently change an agreed product direction.
- Report actual checks and verification evidence.

Realtime collaboration should eventually support presence, shared selection, synchronized project changes, comments, history, and conflict handling. Collaboration must use the same identity and mutation contracts as local work.

## 12. Decisions and roadmap

### Agreed product / architecture direction

- FOLIO is a Visual-First Full-Stack Web Development Studio.
- Native Engine First.
- Unified Project Model.
- Independent Designer and Developer workspaces governed by shared integration rules.
- Native AST and stable IDs as the shared semantic foundation.
- Code mapping categories and preservation of unmapped code.
- Native Component Model with definitions, instances, overrides, slots, and variants.
- \`.flop\` as the native project container target, with backward-compatible versioned evolution.
- Multi-Document and Multi-Application projects.
- Global and application-local components.
- Node Logic is the authoring home for user-facing effects, filters, animation, events, conditions, variables, state, API requests, and data binding.
- Motion & Animation and Video & Media are distinct creative disciplines that integrate through shared project identity and asset contracts; their specialized timelines and engines must not be collapsed into one monolith.
- Geometry Morph is an agreed product direction for Motion: one object changes its geometry across keyframes while retaining its stable identity. The matching/interpolation algorithm and full path-topology support remain open design work, and Morph is not currently implemented.
- A dedicated non-destructive multitrack Video & Media Editing workspace is an agreed long-term product direction. Current motion/video export functionality must not be mistaken for a full source-media editing timeline.
- Canvas interaction tools focus on direct SVG Canvas interaction.

### Required architecture specifications

1. Design System Model.
2. Native AST Specification.
3. Code Mapping Contract.
4. Native Component Contract v1.
5. Command & History System.
6. Synchronization Model.
7. Runtime & Compiler Contract.
8. Technology Selection based on the agreed native contracts and constraints.

### Implementation roadmap (high-level target)

1. Architecture Foundation.
2. Native Project Engine and versioned project container.
3. Native AST Engine and identity graph.
4. Component Engine.
5. Design Engine and Design System.
6. Code Engine and Code Mapping.
7. Node Logic and Motion Engine.
8. Synchronization and History.
9. Runtime, Compiler, and Preview.
10. Full-Stack integrations, AI, Collaboration, and Deployment.

Milestones must be implemented and verified incrementally. Do not begin a later implementation wave merely because it appears in this roadmap; follow the task authorization and acceptance gates for the repository.

### Creative media and advanced Morph direction

- **Native geometry Morph — Agreed product direction / detailed design Open:** Morph must animate geometry on one stable object identity. Automatic path correspondence, topology changes, Bézier interpolation, manual point correction, and runtime/export parity require dedicated specifications and acceptance tests. Morph is not currently implemented.
- **Video & Media Editing — Agreed Roadmap:** A dedicated non-destructive source-media editor with multitrack video/audio clips, trimming, transitions, effects, compositing, audio mixing, proxy/cache management, and editorial rendering is not currently implemented as a full editor. Existing Motion Export encodes rendered animation; it is not equivalent to editing source footage on a multitrack timeline.

## 13. Current implementation reality

The repository contains an evolving implementation on a TypeScript, Vite, Preact, DOM/SVG (+ optional Hybrid GPU) stack with a versioned UTF-8 JSON `.flop` v2 persistence model documented in [Architecture](ARCHITECTURE.md). That document, current source code, and [Acceptance Tests](ACCEPTANCE_TESTS.md) describe the actual implementation.

As of the current repository revision (2026-11-24):

- **Verified (local automated & Chromium suites):** Unified `.flop` v2 multi-page project aggregate, 42-command zero-bypass Native Command Engine, Delta History Engine, dual-workspace Main/Component Canvas with Variants/Slots/Local Overrides/Nested Instances, Project-level Design Tokens & Auto-Layout, 4-category Code Engine (HTML/CSS, React TSX, Live Preview, WCAG 2.1 AA audit, runnable output ZIP export), Stage 8 Motion Timeline (`@keyframes` + `prefers-reduced-motion`), and Node Logic Studio (31 primary nodes + 13 backward-compatible legacy v1 nodes, Component-Scoped per-instance logic execution, Smart Logic Frames, Quick Interactions via Native Commands, and hard-gated `authSecretRef`/`globalHeaders` credential sanitization across `.flop`, IndexedDB, Preview, and Export).
- **Implemented (Simulated/Partial):** `source.external`, `network.http`, and `network.socket` execute as deterministic zero-secret simulations across all 3 runtimes; `flow.delay` and `flow.loop-timer` run live timers in Live Preview and deterministic synchronous simulation in Headless and React TSX; Code → AST editing covers mapped FOLIO structures while preserving `custom`/`extension` modules without claiming full arbitrary code visual round-trip.
- **Open:** Runtime execution for `variable.persist` and `variable.computed` (currently stored as `.flop` v2 metadata only, marked `unsupported` in `RUNTIME_FEATURE_PARITY_MATRIX` with validator warnings and zero `eval`/storage) and arbitrary third-party code visual round-trip.
- **Agreed (Roadmap — not implemented):** Multi-Application projects, application-scoped Local Components, archive-based `.flop` ZIP containers, real backend/database/auth runtime execution, plugin runtime, realtime multiplayer collaboration, AI project control, and hosted backend deployment infrastructure.

When target direction and current source differ, document the gap and plan a deliberate migration. Never silently replace working behavior or project files.

---

**Next architecture milestone:** [Native AST v1 Specification](specs/NATIVE_AST_V1.md) — define canonical document/node structures, stable identity, typed properties, relationships, capabilities, and schema evolution so Canvas, Components, Node Logic, and Code share the same meaning.
