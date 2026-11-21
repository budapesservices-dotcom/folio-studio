# Folio Studio — Agent Instructions

These rules apply to every AI coding assistant and specialist agent working in this repository.

## Mandatory first read

1. Read docs/coordination/AGENT_IDENTITY.md and identify your GPT role.
2. Read docs/coordination/PROTOCOL.md.
2a. If you are GPT0, read docs/coordination/GPT0_MANDATE.md before coordinating or dispatching work.
3. Read docs/coordination/RECOVERY_PROTOCOL.md when restoring a new conversation.
4. Read docs/coordination/TASK_BOARD.md.
5. Read docs/coordination/AGENT_STATE.md as a navigation/status index.
6. Read the complete assigned task file under docs/coordination/tasks/.
7. Read relevant architecture/specification documents before touching implementation.

## Starting a task

When the CEO says MULAI or LAKSANAKAN in a GPT1–GPT4 conversation:

1. Identify yourself using AGENT_IDENTITY.md.
2. Read the Task Board from the repository default branch.
3. Find exactly one DISPATCHED task assigned to your GPT role.
4. Open the task file and validate its base SHA and dependencies.
5. If exactly one valid task is found, reply: DITERIMA — TASK-ID — mulai dikerjakan. Then execute only that task.
6. If zero or multiple matching tasks exist, the base is stale, a dependency is unmet, or GitHub cannot be accessed, stop and reply BLOCKED with the reason. Never guess.

## Recovering after a chat change

When a new conversation receives PULIHKAN GPT1, PULIHKAN GPT2, PULIHKAN GPT3, or PULIHKAN GPT4:

1. Follow docs/coordination/RECOVERY_PROTOCOL.md in full.
2. Reconstruct role, task status, scope, and latest durable checkpoint from GitHub.
3. Resume only a uniquely identified ACCEPTED or IN_PROGRESS task; a DISPATCHED task still requires MULAI/LAKSANAKAN.
4. Never claim to remember the previous chat or any work that is not present in repository evidence.
5. If recovery is ambiguous or evidence is inaccessible, report BLOCKED and state what is missing.

## Non-negotiable rules

- Work only on the assigned Task ID, mode, scope, and paths.
- Do not silently expand scope or combine unrelated tasks.
- Specialists must not commit directly to main or another protected/base branch. GPT0 has a narrow standing exception only for coordination files (TASK_BOARD.md, task packet files under docs/coordination/tasks/, AGENT_REPORTS.md, and AGENT_STATE.md) after the CEO adopts the protocol; see PROTOCOL.md. This exception never covers application code, tests, or deployment configuration.
- Do not merge PRs, deploy, delete project data, rotate secrets, or change repository settings unless separately authorized by the CEO.
- Use a dedicated implementation branch and PR for code/docs changes.
- Keep changes small, reviewable, and consistent with Folio architecture.
- Run the exact checks required by the task. Never claim a test passed unless it actually ran.
- Put detailed evidence and durable checkpoints in the GitHub PR or Issue specified by the task packet.
- Do not edit docs/coordination/TASK_BOARD.md, another agent's task file, docs/coordination/AGENT_REPORTS.md, or docs/coordination/AGENT_STATE.md unless you are GPT0.
- If access, context, a dependency, or an acceptance criterion is missing, stop and report BLOCKED.

## Chat communication

Chat is only for short status signals. Do not paste long technical reports in the specialist chat.

- Start: DITERIMA — TASK-ID — mulai dikerjakan.
- Finish: SELESAI — TASK-ID — PR/ISSUE LINK — menunggu GPT0.
- Blocked: BLOCKED — TASK-ID — ONE-LINE BLOCKER.
- New conversation recovery: PULIH — GPTN — TASK-ID/IDLE — checkpoint/status.

A SELESAI response means READY_FOR_REVIEW only. It does not mean approved or merged.

---

## Folio-specific product and implementation guidance

The repository coordination, identity, dispatch, permission, status, and evidence rules above remain canonical. This section supplements them with Folio product and engineering requirements; it does not grant additional permissions or override the assigned task packet or CEO decisions.

### Mandatory FOLIO architecture context

Before every task that inspects, plans, edits, reviews, or generates code for FOLIO, read:

1. `docs/FOLIO_ARCHITECTURE_BLUEPRINT.md` — product vision, agreed principles, target architecture, and long-term rules.
2. `docs/ARCHITECTURE.md` — current repository architecture and implementation reality.
3. `docs/ACCEPTANCE_TESTS.md` — current verification expectations for the relevant stage.
4. For AST, document, layer, component, or identity work, also read `docs/specs/NATIVE_AST_V1.md`, `docs/specs/NATIVE_AST_COMPATIBILITY_MIGRATION.md`, and `docs/specs/NATIVE_AST_COMPATIBILITY_API.md`.

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
