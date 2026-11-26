# Folio Product Goals

**Document ID:** FOLIO-PRODUCT-004  
**Status:** Agreed product outcomes; delivery is staged by the roadmap  
**Product:** FOLIO Studio  
**Native project format:** .flop

This document translates the Folio Manifesto, Vision, and Mission into durable product outcomes. It is not a feature-completion report or a substitute for implementation specifications and acceptance tests.

## Goal 1 — Reduce the facility barrier to creating high-quality digital work

FOLIO should be efficient and resource-conscious by design. Prefer lightweight foundations, modular loading and execution, incremental updates, and workflows that scale capabilities with the user's needs. Advanced functionality should not force every user to load every engine.

**Evidence of progress:** measured startup, memory and interaction performance; documented minimum supported environments; performance regression tests for critical workflows and realistic low-resource devices.

## Goal 2 — Provide a professional visual design and vector environment

FOLIO should offer a dense, adaptive creative workspace with a powerful Canvas, vector geometry, reusable components, page organization, layers, inspectors, responsive layout, typography, and design systems. Its interaction model may draw inspiration from professional creative applications without copying any single application.

**Evidence of progress:** stable canvas manipulation, vector editing, selection, hierarchy, reusable components, keyboard interaction, workspace layout, accessibility, and browser acceptance.

## Goal 3 — Preserve full-stack developer agency

Developers must be able to inspect and refine code, application structure, and logic directly. FOLIO must communicate which code is generated, mapped, custom, or an extension/override, and preserve work outside FOLIO's declared ownership.

**Evidence of progress:** explicit code mapping metadata, safe custom-code preservation, reliable import/export, tested visual/code round trips for supported structures, and clear runtime/backend boundaries.

## Goal 4 — Make motion and animation a first-class discipline

FOLIO should support expressive timelines, keyframes, easing, playback, interaction-driven animation, and reliable motion export. Its longer-term direction includes native geometry Morph: one object changes its shape through geometry keyframes while retaining the same stable identity.

**Evidence of progress:** deterministic timeline behavior, keyframe editing and interpolation, reduced-motion handling, object identity preservation, geometry matching tests, and format-specific export tests. Geometry Morph remains roadmap until its engine and acceptance tests exist.

## Goal 5 — Build a capable, non-destructive video and media workflow

FOLIO should grow toward a dedicated video and media workspace with source asset management, multitrack timelines, clip trimming, video and audio tracks, transitions, effects, compositing, preview, and export. The editing workflow must preserve source media and store editable decisions separately from rendered outputs.

**Evidence of progress:** media import and validation, stable asset references, non-destructive edit data, reliable timeline operations, audio/video synchronization, proxy or cache strategy, memory benchmarks, and export acceptance tests. Existing animation/video export does not by itself satisfy this goal.

## Goal 6 — Maintain one coherent project across creative workspaces

Design, Node Logic, Code, Backend, Motion, Media, Runtime, and future workspaces must operate on a Unified Project Model. Workspaces may have independent presentation and specialized engines, but must not create competing project truth.

**Evidence of progress:** stable IDs, typed native contracts, validated commands, explicit asset references, synchronization tests, conflict handling, and cross-workspace integration tests.

## Goal 7 — Build a dependable Native Engine First foundation

FOLIO should own its project model, command contracts, identity graph, AST, synchronization rules, asset references, and compiler orchestration. Engines must remain modular and evolve without forcing unrelated systems to be rewritten.

**Evidence of progress:** documented engine boundaries, versioned contracts, deterministic mutations, undo/redo and rollback behavior, compatibility tests, and modular extension points.

## Goal 8 — Make .flop projects durable and portable

A .flop project should be an editable, versioned project container rather than an undocumented data dump. File operations and migrations must preserve supported structure, identity, assets, media references, and relationships.

**Evidence of progress:** format specification, schema/version validation, migration coverage, corruption/error handling, and round-trip tests that verify semantic preservation.

## Goal 9 — Make AI and collaboration project-aware

AI and collaboration capabilities should work with the actual project model, repository rules, and authorized commands. They should preserve context, explain changes, and expose conflicts rather than silently making assumptions.

**Evidence of progress:** mandatory AI onboarding context, bounded task permissions, project-aware tools, traceable changes, and reproducible verification reports.

## Goal 10 — Earn trust through verifiable quality

FOLIO should favor correctness, recoverability, accessibility, and honest capability claims over superficial feature counts. Critical workflows must be tested at the appropriate unit, integration, browser, media, and target-device levels.

**Evidence of progress:** acceptance criteria, regression coverage, documented known issues, successful CI, manual acceptance records, and clear implemented-versus-planned status.

## Product experience principles

- Professional-density workspace; dark theme as the current agreed design baseline; adaptive layout.
- A creative, multi-panel and multi-window environment inspired by professional workstations, not a clone of any single product.
- Design, Code, Motion, and Media are specialized workspaces over shared project state, never independent project databases.
- Each discipline may own a different editor and engine while sharing stable identities, assets, commands, history, and explicit integration contracts.
- Cross-workspace workflows should be non-destructive and preserve editable source data wherever supported.
- Designers, developers, animators, and video creators retain direct control of their respective craft.
- AI augments human creativity and engineering judgment; it does not replace product ownership.

## Non-goals and boundaries

- Replacing developers or hiding the underlying implementation from them.
- Copying Figma, FL Studio, Premiere, DaVinci Resolve, or another application feature-for-feature.
- Building a proprietary browser, JavaScript engine, or programming language merely to claim native ownership.
- Turning every creative discipline into one monolithic engine or one universal timeline data structure.
- Claiming all arbitrary code can be losslessly converted into editable visual structures.
- Treating motion export as proof that a full video editor exists.
- Promising every advanced workflow will run on every low-spec device without measured constraints.
- Treating long-term product goals as implemented features.

## How to use this document

Use these goals to evaluate product and architecture proposals. Use the [FOLIO Creative Studio Direction](FOLIO_CREATIVE_STUDIO_DIRECTION.md) for cross-discipline boundaries and staged direction, the Architecture Blueprint for target-system decisions, the current Architecture document for implementation reality, the roadmap for sequencing, and acceptance tests for release evidence.
