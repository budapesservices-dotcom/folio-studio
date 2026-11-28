# Folio Product Goals

**Document ID:** FOLIO-PRODUCT-004  
**Status:** Agreed product outcomes; delivery is staged by the roadmap  
**Product:** Folio  
**Native project format:** .flop

This document translates the Folio Manifesto, Vision, and Mission into durable product outcomes. It is not a feature-completion report or a substitute for implementation specifications and acceptance tests.

## Goal 1 — Reduce the facility barrier to creating high-quality digital products

Folio should be efficient and resource-conscious by design. Prefer lightweight foundations, modular loading and execution, incremental updates, and workflows that scale capabilities with the user's needs.

**Evidence of progress:** measured startup, memory and interaction performance; documented minimum supported environments; performance regression tests for critical workflows.

## Goal 2 — Provide a professional visual creation environment

Folio should offer a dense, adaptive, creative workspace with a powerful Canvas, reusable components, page organization, layers, inspectors, and specialized tools. Its interaction model may draw inspiration from digital audio workstations and other professional creative applications without copying them.

**Evidence of progress:** stable canvas manipulation, selection, hierarchy, reusable components, keyboard interaction, workspace layout, accessibility, and browser acceptance.

## Goal 3 — Preserve full developer agency

Developers must be able to inspect and refine code and logic directly. Folio must communicate which code is generated, mapped, custom, or an extension/override, and preserve work outside Folio's declared ownership.

**Evidence of progress:** explicit code mapping metadata, safe custom-code preservation, reliable import/export, and tested visual/code round trips for supported structures.

## Goal 4 — Maintain one coherent project across workspaces

Design, Node Logic, Code, Backend, Runtime, and future workspaces must operate on a Unified Project Model. Workspaces may have independent presentation and tools, but must not create competing project truth.

**Evidence of progress:** stable IDs, typed native contracts, validated commands, synchronization tests, conflict handling, and cross-workspace integration tests.

## Goal 5 — Build a dependable Native Engine First foundation

Folio should own its project model, command contracts, identity graph, AST, synchronization rules, and compiler orchestration. Engines must remain modular and evolve without forcing unrelated systems to be rewritten.

**Evidence of progress:** documented engine boundaries, versioned contracts, deterministic mutations, undo/redo and rollback behavior, compatibility tests, and modular extension points.

## Goal 6 — Make .flop projects durable and portable

A .flop project should be an editable, versioned project container rather than an undocumented data dump. File operations and migrations must preserve supported structure, identity, assets, and relationships.

**Evidence of progress:** format specification, schema/version validation, migration coverage, corruption/error handling, and round-trip tests that verify semantic preservation.

## Goal 7 — Make AI and collaboration project-aware

AI and collaboration capabilities should work with the actual project model, repository rules, and authorized commands. They should preserve context, explain changes, and expose conflicts rather than silently making assumptions.

**Evidence of progress:** mandatory AI onboarding context, bounded task permissions, project-aware tools, traceable changes, and reproducible verification reports.

## Goal 8 — Earn trust through verifiable quality

Folio should favor correctness, recoverability, accessibility, and honest capability claims over superficial feature counts. Critical workflows must be tested at the appropriate unit, integration, browser, and target-device levels.

**Evidence of progress:** acceptance criteria, regression coverage, documented known issues, successful CI, manual acceptance records, and clear implemented-versus-planned status.

## Product experience principles

- Professional-density workspace; dark theme as the current agreed design baseline; adaptive layout.
- A creative, multi-panel and multi-window environment inspired by professional workstations, not a clone of any single product.
- Canvas and other workspaces are views over project state, never independent project databases.
- Designers and developers retain different but interoperable workflows.
- AI augments human creativity and engineering judgment; it does not replace product ownership.

## Non-goals and boundaries

- Replacing developers or hiding the underlying implementation from them.
- Copying Figma, FL Studio, or another application feature-for-feature.
- Building a proprietary browser, JavaScript engine, or programming language merely to claim native ownership.
- Claiming all arbitrary code can be losslessly converted into editable visual structures.
- Promising every advanced workflow will run on every low-spec device without measured constraints.
- Treating long-term product goals as implemented features.

## How to use this document

Use these goals to evaluate product and architecture proposals. Use the Architecture Blueprint for target-system decisions, the current Architecture document for implementation reality, the roadmap for sequencing, and acceptance tests for release evidence.