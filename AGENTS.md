# Folio — Repository Instructions

These instructions govern repository work. Folio's CEO communicates outcomes directly to the active Codex session.

## Sole operating model

- Codex is the only default coordinator and engineering interface for Folio.
- Do not use a separate numbered-role roster, chat activation/recovery signals, mandatory handoff chain, or specialist task-board workflow.
- Codex may use its available tools or native subagents when they materially improve execution. These are implementation choices, not separate operating authorities or fixed role identities.
- The CEO should not have to relay technical reports or coordinate routine task dispatch between AI sessions.

## Execution default

- Prefer implementation and measurable product progress over repeated audits, planning documents, status checks, or coordination overhead.
- Inspect the live repository, current branch, exact base commit, open PRs, dependencies, and relevant Folio specifications before changing files. Treat stale documents and chat summaries as non-authoritative.
- Choose the smallest high-value, unblocked vertical slice. Implement production behavior and the tests needed to prove it.
- Do not stop after proposing a plan when the task is sufficiently specified and safe to execute.
- Avoid duplicate implementations. Extend existing engine boundaries and preserve the Unified Project Model and Native Engine First direction.
- Keep work bounded, modular, reviewable, and compatible with existing branches. One writer per mutable worktree/scope at a time.

## Git and authority boundaries

- Use a dedicated branch from the verified base SHA for implementation.
- Never force-push, rewrite another branch, overwrite uncommitted work, or silently rebase an existing PR.
- Do not commit product changes directly to `main`.
- Do not modify, rebase, merge, close, or retarget PR #4, #5, or #7 without explicit CEO authorization.
- Do not merge PRs, deploy, change repository or Cloudflare settings, modify secrets/access, or perform destructive data operations without explicit CEO approval.
- Open a draft PR when the candidate is coherent and reviewable. A draft PR is not approval to merge or deploy.

## Validation and reporting

- Run relevant checks at meaningful implementation milestones. Report exact commands and actual results; never claim a check ran when it did not.
- Inspect the final diff, changed paths, branch ancestry, and commit SHA before handoff.
- Add or update regression tests for changed behavior. Keep unrelated findings out of scope unless they create a material safety or correctness risk.
- Report only durable facts: what changed, exact branch/commit/PR, checks actually run, known limitations, and the next concrete action.
- If blocked, state the specific unavailable capability or failed precondition and the smallest action needed to unblock. Do not replace execution with repeated status narration.

## Folio product invariants

- Product name: Folio. Project container extension: `.flop`.
- Preserve Native Engine First, the Unified Project Model, typed engine boundaries, modularity, and the accepted Designer/Developer integration rules.
- Prefer lightweight, incremental implementations and reuse mature foundations where appropriate.
- Do not reverse material product or architecture decisions without CEO direction.

---

## Folio-specific product and implementation guidance

The repository coordination, identity, dispatch, permission, status, and evidence rules above remain canonical. This section supplements them with Folio product and engineering requirements; it does not grant additional permissions or override the assigned task packet or CEO decisions.

### Mandatory product and architecture context

Before every task that inspects, plans, edits, reviews, or generates code for FOLIO, read these documents in order:

1. **Product identity and intent**
   - `docs/FOLIO_MANIFESTO.md` — founding purpose and non-negotiable product spirit.
   - `docs/FOLIO_VISION.md` — the future Folio is working toward.
   - `docs/FOLIO_MISSION.md` — how Folio pursues that future.
   - `docs/FOLIO_PRODUCT_GOALS.md` — durable product outcomes and boundaries.
2. **Target architecture**
   - `docs/FOLIO_ARCHITECTURE_BLUEPRINT.md` — agreed principles, target system, and long-term architecture.
3. **Current reality and verification**
   - `docs/ARCHITECTURE.md` — what the repository currently implements.
   - `docs/ACCEPTANCE_TESTS.md` — current verification expectations for the relevant stage.
4. **Specialized contracts**
   - For AST, document, layer, component, or identity work, also read `docs/specs/NATIVE_AST_V1.md`, `docs/specs/NATIVE_AST_COMPATIBILITY_MIGRATION.md`, and `docs/specs/NATIVE_AST_COMPATIBILITY_API.md`.
   - Read any other engine, feature, migration, or acceptance specification directly relevant to the task.

Also inspect relevant source files, tests, current branch, and working-tree changes before editing.
## Source-of-truth rules

Apply this authority hierarchy:

- `FOLIO_MANIFESTO.md` defines Folio's founding purpose and enduring values.
- `FOLIO_VISION.md` defines the desired product future.
- `FOLIO_MISSION.md` defines the product's approach and commitments.
- `FOLIO_PRODUCT_GOALS.md` defines durable outcomes and product boundaries.
- `FOLIO_ARCHITECTURE_BLUEPRINT.md` is authoritative for agreed target architecture and product/engineering direction.
- Current source code, tests, and `docs/ARCHITECTURE.md` describe what is actually implemented today.
- Acceptance specifications define what must be verified for a milestone; CI and test results provide evidence only for the checks that actually ran.

Never describe a proposed or agreed design as implemented unless the code exists. Never describe code as verified unless the relevant checks or acceptance tests have actually passed. When the target direction and current implementation differ, preserve the known implementation reality and treat the blueprint as the target; do not silently make a breaking migration to force alignment. When documentation conflicts, identify the conflict and update the appropriate document deliberately. Do not erase useful implementation history.

Keep these statuses distinct: **Agreed**, **Proposed**, **Open**, **Implemented**, and **Verified**.
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
