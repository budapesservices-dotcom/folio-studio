# FOLIO Repository Instructions for AI Agents

Before every task that inspects, plans, edits, reviews, or generates code for FOLIO, read:

1. `docs/FOLIO_ARCHITECTURE_BLUEPRINT.md` — product vision, agreed principles, target architecture, and long-term rules.
2. `docs/ARCHITECTURE.md` — current repository architecture and implementation reality.
3. `docs/ACCEPTANCE_TESTS.md` — current verification expectations for the relevant stage.

Also inspect the relevant source files, tests, current branch, and working-tree changes before editing.

## Source-of-truth rules

- The product blueprint is authoritative for **product intent and agreed architectural direction**.
- Current source code, tests, and `docs/ARCHITECTURE.md` describe **what is actually implemented today**.
- Never describe a proposed or agreed design as implemented unless the code exists.
- Never describe code as verified unless the relevant checks or acceptance tests have actually passed.
- When the blueprint and current implementation differ, preserve the implementation's known reality and treat the blueprint as the target direction. Do not silently make a breaking migration to force alignment.
- When documentation conflicts, identify the conflict and update the appropriate document deliberately. Do not erase useful implementation history.
- Keep these statuses distinct: **Agreed**, **Proposed**, **Open**, **Implemented**, and **Verified**.

## Product and architecture guardrails

- FOLIO is the **Visual-First Full-Stack Web Development Studio**: visual design, behavior, code, backend, runtime, deployment, AI, and collaboration are parts of one connected product.
- Follow the **Native Engine First** direction. FOLIO owns its native project contracts, IDs, commands, project model, AST, synchronization, and compiler orchestration. External libraries are implementation aids, not project truth.
- Preserve one **Unified Project Model** across independent Designer and Developer workspaces. Both may have different workflows, but interoperable content must follow FOLIO contracts.
- Treat the native AST and stable IDs as the shared semantic foundation for Canvas, Components, Node Logic, Code Mapping, and future Motion tools.
- Respect code mapping categories: Generated Code, Mapped Code, Custom Code, and Extension/Override. Preserve unmapped/custom code; never claim arbitrary code is fully visually editable.
- Preserve component Definition, Instance, and Instance Override relationships. Do not flatten or duplicate linked structures without an explicit user action.
- Respect project-wide Global Components and application-scoped Local Components.
- The long-term native project extension is `.flop`. Preserve existing file compatibility; format changes require explicit versioning and migrations.
- Node Logic is the authoring workspace for user-facing effects, filters, animation, events, conditions, variables, state, API requests, and data binding. Canvas interaction tools focus on direct canvas manipulation.
- Do not introduce a second source of truth or workspace-specific project silo.

## Execution rules

- Make the smallest coherent change that advances the requested milestone.
- Do not start later roadmap waves or unrelated engines without explicit authorization.
- Preserve existing behavior unless the task explicitly changes it.
- Use typed contracts, validation, stable IDs, and tests for domain changes.
- Add or update tests for changed behavior. Run the relevant checks and report exact results.
- Do not claim CI, deployment, browser testing, or manual acceptance succeeded unless verified from its actual result.
- Flag architectural conflicts, data-loss risks, compatibility issues, and unresolved assumptions before making high-impact changes.
- Keep user-facing UI labels, tooltips, errors, and notifications in English.
- Update architecture and acceptance documentation when implementation changes the actual system.

## Required task summary

At the end of each implementation task, report:
1. What changed (with file paths).
2. Which milestone/status it advances.
3. Checks actually run and their results.
4. What remains unimplemented, unverified, or blocked.

Do not use this instruction file as a substitute for reading the architecture blueprint and current implementation documents.