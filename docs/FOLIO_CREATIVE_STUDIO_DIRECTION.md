# FOLIO Creative Studio Direction

**Document ID:** FOLIO-PRODUCT-005  
**Status:** Agreed product direction; specialist implementation details are staged and partly open  
**Product:** FOLIO Studio  
**Native project format:** .flop

This document explains what "all-in-one creative development studio" means for FOLIO, how its creative disciplines should cooperate, and how the long-term capabilities must remain distinct from what the repository implements today.

## 1. Product intent

FOLIO is intended to support the connected process of creating digital products and the media around them:

- Design and vector creation.
- Code and full-stack development.
- Interactive behavior and Node Logic.
- Motion graphics and animation.
- Video and audio editing.
- Runtime, export, and deployment.

These are not unrelated products bundled together. They are specialist workflows inside one studio, connected through one native project and explicit interoperability contracts.

The product ambition is broad, but the engineering strategy must remain modular. "All-in-one" means that users can move between disciplines without repeatedly rebuilding assets, losing identity, or maintaining disconnected project copies. It does not mean that every tool must share one internal engine.

## 2. Creative workspaces

| Discipline | Intended responsibility | Direction / status |
|---|---|---|
| Design & Vector | Interface design, canvas composition, vector geometry, typography, layout, components, design systems | Substantial foundations implemented; refer to current Architecture |
| Code & Full-Stack | Source editing, code mapping, app structure, backend/runtime integration, build and deployment | Foundations implemented; some full-stack runtime capabilities remain roadmap |
| Node Logic | Events, conditions, variables, state, interactions, API/data behavior | Implemented with documented simulated/partial and open runtime parity |
| Motion & Animation | Object/property animation, timelines, keyframes, easing, playback, export | Motion timeline and export implemented; advanced geometry Morph is roadmap |
| Video & Media | Non-destructive editing of source video/audio, tracks, clips, transitions, effects, compositing and output | Dedicated editing workspace is roadmap; current motion/video encoding export is not a full editor |
| Runtime & Delivery | Preview, responsive validation, build, package, export and deployment | Existing capabilities plus staged roadmap |

This table describes product organization and status boundaries, not a guarantee that every workspace is already present as a complete user-facing application.

## 3. One shared project, specialist engines

The Unified Project Model is the shared foundation. At minimum, cross-workspace integration should preserve:

- Stable project, document, node, component, clip, and asset identities where each concept exists.
- Explicit asset references and ownership.
- Typed Native Commands for durable mutations.
- Shared history semantics and predictable undo/redo.
- Versioned schemas and explicit .flop migrations.
- Capability and compatibility metadata.
- Clear boundaries for generated, mapped, custom, and extension code.
- Non-destructive relationships between source assets and derived outputs.

Each specialist engine owns the data and operations that are unique to its discipline. The Design/Vector engine owns geometry editing semantics; the Code Engine owns code modules and mapping; the Motion Engine owns animation clips and object keyframes; a future Media Engine owns editorial clips, tracks, audio/video timing, transitions, and media effects.

A workspace must not create a competing project database or bypass native mutation contracts. Conversely, the shared project model must not become a dumping ground for editor-specific transient state or force unrelated systems into one universal abstraction.

## 4. Native Geometry Morph — agreed direction, not implemented

FOLIO should support a genuine geometry Morph workflow in which **one object changes from shape A to shape B while retaining the same object identity**.

This is different from moving between two duplicated objects, toggling visibility, or crossfading two images. The geometry itself changes through time.

### Intended user experience

1. Create or select one vector object.
2. Add a geometry keyframe at the starting time.
3. Move the playhead and edit the same object's path into a target shape.
4. FOLIO records another geometry state under the same stable node identity.
5. Play the timeline and see the shape transform continuously.
6. Refine correspondence or easing when automatic matching needs correction.

### Target behavior

- Geometry keyframes belong to the same node identity; they must not be implemented as hidden duplicate objects.
- FOLIO should normalize compatible path representations and attempt automatic point/segment correspondence.
- Users should be able to correct start points, direction, anchor correspondence, and handles when the automatic result is not visually correct.
- Interpolation should account for Bézier anchors and handles, not merely interpolate an object's bounding box.
- Initial support should prioritize predictable simple paths before complex compound geometry, holes, self-intersections, or topology changes.
- Morph must integrate with Motion playback, Native Commands, history, component identity, runtime/code generation, and export only where support is explicit.
- Unsupported cases must be surfaced rather than silently producing broken geometry.

**Open technical work:** path correspondence algorithms, topology changes, compound subpaths, fill-rule behavior, stroke behavior, performance under many animated paths, and runtime/export parity.

**Status:** Agreed product direction / roadmap. The current repository's property keyframes and motion export are not native geometry Morph.

## 5. Video & Media Editing — agreed direction, not implemented as a full editor

FOLIO should grow toward a dedicated Video & Media workspace for editing source media non-destructively.

### Target editing model

- Imported source footage and audio remain managed assets; editing operations refer to them rather than overwriting originals.
- Editorial clips store source references, in/out points, timeline placement, playback rate, transforms, and effect references.
- Tracks provide ordered video, audio, and overlay lanes with explicit timing and compositing rules.
- Transitions, titles, effects, masks, keyframe automation, and audio mixing are editable project data.
- The preview pipeline may use generated proxies, thumbnails, waveforms, and cached render segments, but these are derived resources and must be recoverable or safely invalidated.
- Export/rendering produces a derived output file without replacing the editable timeline or source media.
- Audio/video synchronization, frame-rate conversion, color handling, memory limits, and export failures require explicit acceptance criteria.

### Separation from Motion

Motion & Animation primarily describes how FOLIO objects and interface elements change over time. Video & Media Editing describes how source media is arranged and transformed into an editorial composition.

The two may share useful infrastructure—clock and frame-rate primitives, playhead controls, markers, keyframe interpolation services, asset references, cache interfaces, and export infrastructure—but they must retain separate specialist timeline semantics. A video timeline must not be reduced to a list of interface animation clips.

**Status:** Dedicated multi-track editing, media ingestion, clip trimming, transitions, audio mixing, compositing, and editorial render pipeline are agreed roadmap capabilities. Existing MP4/MOV/WebM and other motion export formats represent rendered-output capability, not a full video editor.

## 6. Cross-discipline workflows

FOLIO should support connected workflows such as:

- **Brand to product:** create vector identity → morph/animate it → use it in reusable components → build the website → export visual and code assets.
- **Prototype to implementation:** design responsive interface → add Node Logic interactions → refine code → preview and package the application.
- **Product to launch media:** reference the same project assets → create motion graphics → arrange video/audio content in a media timeline → render promotional output.
- **Design system to motion:** use shared design tokens and component properties in animation so theme and design changes remain consistent where mappings are supported.

Cross-discipline links must be explicit and testable. If an export creates a flattened or rendered asset, FOLIO must label it as a derived output and preserve the editable source.

## 7. Performance and accessibility principles

All-in-one must not mean all engines are loaded all the time.

- Load specialist workspaces and heavy media capabilities progressively.
- Keep transient playback, render buffers, proxies, and caches separate from canonical project data.
- Use thumbnails, proxies, adaptive preview quality, and bounded caches for media-heavy workflows.
- Prefer incremental recomputation and deterministic invalidation.
- Provide graceful capability fallback where hardware or browser APIs differ.
- Measure memory, startup, interaction latency, export time, and thermal/resource behavior on representative low-resource hardware.
- Preserve keyboard access, understandable tool feedback, and reduced-motion preferences.

No universal minimum-device promise should be made without measurements.

## 8. Staged direction

1. **Protect the foundation.** Stabilize the existing Native Command Engine, project model, assets, Design/Vector, Code, Node Logic, and current Motion workflow.
2. **Advance Motion with Morph.** Specify geometry keyframe contracts and ship a narrow, testable path-to-path Morph slice before expanding to complex topology.
3. **Design the media foundation.** Specify media asset ingestion, source metadata, timeline timebase, clip identity, cache/proxy lifecycle, and non-destructive persistence.
4. **Build a video-editing vertical slice.** Support a small, explicit set of video/audio tracks, source trimming, playback preview, and rendered output with tests before adding advanced effects.
5. **Expand editing capabilities.** Add transitions, titles, effects, audio mixing, compositing, performance controls, and recovery behavior in measured increments.
6. **Connect disciplines.** Add reliable references between design objects, motion clips, components, code, and editorial media while preserving source ownership.

The sequence may be adjusted by evidence, but it must not bypass existing quality and compatibility gates.

## 9. Capability honesty

Use the repository's current Architecture, source code, tests, and acceptance evidence to determine what is implemented and verified.

- Existing vector/design, code, Node Logic, Motion Timeline, and Motion Export capabilities should be described according to their actual current coverage.
- Existing animation/video export must not be marketed as full video editing.
- Property animation must not be marketed as geometry Morph.
- A documented target, mockup, or roadmap item is not implemented functionality.
- Any new capability must gain explicit contracts, tests, performance evidence, and relevant manual acceptance before being described as verified.

This document is product direction. It does not authorize an immediate implementation rewrite, a new language, or a change to the existing .flop format without explicit design, migration, and verification work.
