# FOLIO Copilot Instructions

Before each task, read the mandatory project context in this order:
- `AGENTS.md` at the repository root.
- `docs/FOLIO_MANIFESTO.md` for the founding purpose and enduring product values.
- `docs/FOLIO_VISION.md` for the desired product future.
- `docs/FOLIO_MISSION.md` for the mission and operating commitments.
- `docs/FOLIO_PRODUCT_GOALS.md` for durable outcomes and product boundaries.
- `docs/FOLIO_ARCHITECTURE_BLUEPRINT.md` for agreed target architecture.
- `docs/ARCHITECTURE.md` for current implementation reality.
- `docs/ACCEPTANCE_TESTS.md` for current acceptance expectations.
- For AST, document, layer, component, or identity work, `docs/specs/NATIVE_AST_V1.md`, `docs/specs/NATIVE_AST_COMPATIBILITY_MIGRATION.md`, and `docs/specs/NATIVE_AST_COMPATIBILITY_API.md`.

Treat these as mandatory project context, not optional background reading.

## Authority and status

The Manifesto defines Folio's founding purpose and values. Vision defines the intended future. Mission defines how Folio works toward it. Product Goals define expected outcomes and boundaries. The Architecture Blueprint defines the agreed target architecture.

Source code, tests, and the current Architecture document define what exists today. Acceptance specifications define expected verification; actual CI, test, and manual acceptance evidence must be checked separately.

Never present a proposal as implemented or an implementation as verified without evidence. When product intent and implementation reality differ, preserve the current implementation's known behavior and identify the target gap; do not silently force a breaking change.

## Core Folio principles

Preserve the FOLIO principles: Native Engine First, one Unified Project Model, independent but interoperable Designer and Developer workspaces, stable native AST identity, explicit code mapping, preservation of custom/unmapped code, versioned .flop compatibility, and validated native commands.

Do not create a separate source of truth for a workspace. Do not bypass FOLIO contracts for project mutations. Do not silently discard custom code, component overrides, IDs, or project data. Treat long-term roadmap items as planned until implemented and verified.

Before editing, inspect relevant source files, tests, branch state, and existing changes. Keep changes scoped to the authorized milestone. Add/update tests and run relevant checks. Report exact paths changed and checks actually executed. User-facing UI labels, tooltips, errors, and notifications must be in English.

For detailed requirements and status rules, follow AGENTS.md.