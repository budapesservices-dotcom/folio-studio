# Folio Studio — GPT Team Coordination Protocol

**Version:** 1.1  
**Status:** Proposed; active after PR approval and merge  
**Repository:** budapesservices-dotcom/folio-studio  
**Team:** CEO + GPT0 + GPT1–GPT4

## 1. Purpose

The CEO should only carry short start/finish signals between conversations—not technical task packets or long reports.

GPT0 writes each assignment to the repository Task Inbox. The CEO opens the named specialist chat and types only MULAI or LAKSANAKAN. The specialist reads its own task from GitHub, acknowledges it briefly, performs the work, and stores its detailed evidence in GitHub. GPT0 reviews that evidence and maintains the one CEO report.

This is intentionally a human-assisted handoff. Separate ChatGPT conversations do not automatically message or invoke one another. The short CEO trigger is the handoff mechanism.

## 2. The repository is the shared workspace

| Location | Purpose | Owner |
|---|---|---|
| docs/coordination/TASK_BOARD.md | Current task queue and status for all specialists | GPT0 only |
| docs/coordination/tasks/TASK-ID.md | Full, authoritative assignment packet for one task | GPT0 creates/updates; specialists read |
| docs/coordination/AGENT_REPORTS.md | Consolidated CEO-facing results | GPT0 only |
| GitHub PRs | Implementation changes, diffs, test evidence, technical handoff | Assigned specialist |
| GitHub Issue or related PR comment | QA, audit, and read-only findings when no implementation PR exists | Assigned specialist |

A task packet is the source of truth for the assignment. The chat trigger is only a request to locate and start that packet; it is not a replacement for the packet.

## 3. Team roles

| Agent | Default role | Responsibility |
|---|---|---|
| GPT0 | Coordinator / Chief of Staff | Understand CEO intent, inspect repository state, divide work, publish task packets, manage the task board, review evidence, consolidate results, brief CEO |
| GPT1 | Architect / Preflight | Architecture, design decisions, dependency analysis, implementation preflight, compatibility review, technical plans |
| GPT2 | Engineer | Implement assigned code or documentation, add/update tests, prepare a reviewable PR |
| GPT3 | QA / UI / Regression | Test planning, regression coverage, acceptance checks, UI verification, test/CI review |
| GPT4 | Independent Auditor | Independently inspect scope, architecture, regressions, test evidence, PR compatibility, and hidden risks |

GPT4 must remain independent from the implementation it audits. Do not ask an agent to approve its own implementation.

## 4. Task dispatch: no more copying long instructions

### 4.1 GPT0 publishes tasks

For each work cycle, GPT0 must:

1. Inspect the live repository, default branch, open PRs, current commits, approved specifications, and relevant risks.
2. Create one task file per specialist at docs/coordination/tasks/TASK-ID.md.
3. Add each task to docs/coordination/TASK_BOARD.md with status READY.
4. Ensure the task file is committed and readable from the repository's default branch before announcing that it is ready. If a task is only on an unmerged branch, GPT0 must say so and provide the branch link; it must not claim that the task is on the default branch.
5. Set the task file and board status to DISPATCHED, then tell the CEO exactly which specialist may start, with a short link and trigger instruction. Example: "GPT2 SIAP MULAI — FOLIO-20261121-CANVAS-001. Buka chat GPT2 dan kirim: MULAI."

GPT0 should publish all currently independent tasks together. Dependent tasks must remain WAITING and must not be announced as ready before their prerequisites are approved.

### 4.2 CEO starts the specialist

The CEO opens the named specialist conversation and sends only:

- MULAI
- or LAKSANAKAN

The CEO does not copy the long task packet.

### 4.3 Specialist reads and accepts its task

When a specialist receives MULAI or LAKSANAKAN, it must:

1. Identify its own role (GPT1, GPT2, GPT3, or GPT4).
2. Read docs/coordination/TASK_BOARD.md from the repository's default branch.
3. Find exactly one task assigned to that GPT with status DISPATCHED.
4. Open and read the complete task file before doing any work.
5. Verify that its dependency and exact base SHA still match.
6. Respond in chat with one line: "DITERIMA — GPT2 — TASK-ID — mulai dikerjakan."
7. Update no shared coordination file. It performs work only within the task's permission and scope.

If there is no DISPATCHED task, more than one DISPATCHED task for that specialist, no GitHub access, an inaccessible task file, a stale base SHA, or an unmet dependency, the specialist must stop and respond BLOCKED. It must not guess which task GPT0 intended.

### 4.4 Completion and CEO handoff

When done, the specialist stores its full evidence in the linked PR or Issue and replies in chat with one line:

"SELESAI — TASK-ID — PR #PR NUMBER OR LINK — menunggu review GPT0"

or, for read-only work:

"SELESAI — TASK-ID — laporan tersimpan di ISSUE/PR LINK — menunggu review GPT0"

The CEO tells GPT0 only "GPT2 selesai" (or includes the Task ID if there is more than one active task). GPT0 retrieves the evidence directly from GitHub. The CEO never transports the technical report.

## 5. GPT0 task creation and task board ownership

GPT0 is the sole writer of TASK_BOARD.md and task packet files under docs/coordination/tasks/.

After this protocol is approved and merged, the CEO grants GPT0 standing, narrow permission to commit task queue changes directly to the default branch when repository rules allow, limited strictly to:
- creating/updating docs/coordination/tasks/TASK-ID.md;
- updating docs/coordination/TASK_BOARD.md;
- updating docs/coordination/AGENT_REPORTS.md.

This is a coordination-only exception. It does not permit GPT0 or any specialist to push application code, tests, deployment configuration, or unrelated files directly to the default branch. If branch protection or repository policy blocks a direct coordination update, GPT0 must use one coordination branch/PR and clearly tell the CEO that the task is not available on the default branch until that PR is merged.

Specialists must never edit the task board or another agent's task packet. If a task needs a correction, they report it to GPT0 and wait for an updated packet.

## 6. Task packet requirements

Every task packet must be self-contained and contain:

- unique Task ID: FOLIO-YYYYMMDD-AREA-NNN;
- assigned specialist and role;
- task mode: READ-ONLY, IMPLEMENTATION, QA, AUDIT, or DOCS;
- status and priority;
- objective and measurable expected outcome;
- repository, target branch, and exact base commit SHA;
- related PRs/commits and authoritative specifications;
- dependencies and start condition;
- exact allowed paths and forbidden/out-of-scope paths;
- required deliverables and measurable acceptance criteria;
- exact validation commands or review checks;
- evidence destination: target PR or GitHub Issue;
- permissions, stop conditions, and no-merge/no-deploy instruction.

Use TASK_PACKET_TEMPLATE.md as the file structure. GPT0 fills every field before setting a task to READY.

## 7. Parallel work and conflict prevention

- Default: no more than one READY, DISPATCHED, ACCEPTED, or IN_PROGRESS task per specialist at a time. This makes the simple MULAI trigger unambiguous.
- GPT0 may publish multiple tasks for different specialists in parallel only when dependencies are satisfied and write scopes do not overlap.
- If two tasks need the same files or depend on the same changing foundation, GPT0 must sequence them.
- Each implementation task uses its own branch based on the exact SHA in its packet.
- A specialist must not start a WAITING task.
- GPT0 alone updates the shared Task Board and CEO report. This prevents concurrent-write conflicts.

## 8. GitHub work and evidence

### Implementation / documentation task

- Create a dedicated branch: agent/GPT-NUMBER/TASK-ID-SLUG.
- Branch from the exact base SHA in the task file.
- Change only allowed paths.
- Run required checks and record actual command results.
- Open one PR against the target branch named in the task file.
- Include the Task ID and task packet link in the PR title/body.
- Do not merge or deploy.
- Use .github/PULL_REQUEST_TEMPLATE.md.

### Read-only / QA / audit task

- Do not modify production code unless remediation is explicitly authorized.
- Place the full report as a comment on the evidence Issue/PR named in the task packet, or create the specified GitHub Issue if the packet directs it.
- Each finding includes severity, affected path/line or commit, reproducible evidence, impact, and recommended action.
- If write access is unavailable, mark BLOCKED. Never claim a report was saved when it was not.

### One CEO report

docs/coordination/AGENT_REPORTS.md is the sole consolidated specialist report for the CEO.

- GPT0 reads and verifies specialist evidence, then updates the report with result, checks/CI, risks, and source links.
- Specialists must never edit this file.
- GPT0 uses one coordination/report branch and one report PR per work cycle when direct updates are not permitted. It updates that same PR sequentially; it does not create a report PR for every specialist.
- GPT0 never copies unverified claims into the report.

## 9. Status definitions

| Status | Meaning |
|---|---|
| NOT_ASSIGNED | No task exists for this agent |
| DRAFT | GPT0 is still preparing the task; do not start |
| WAITING | Task depends on another task; do not start |
| READY | Task is published on the default branch but GPT0 has not dispatched it yet; do not start |
| DISPATCHED | GPT0 announced the task to the CEO; the assigned GPT may start after receiving the CEO's MULAI/LAKSANAKAN trigger |
| ACCEPTED | Specialist has acknowledged the task |
| IN_PROGRESS | Work is underway |
| BLOCKED | Work cannot safely continue; blocker is recorded |
| READY_FOR_REVIEW | Specialist submitted GitHub evidence; GPT0 review is pending |
| CHANGES_REQUESTED | GPT0 found a gap and issued a correction |
| APPROVED | GPT0 verified the task against acceptance criteria |
| MERGED | CEO-authorized merge is confirmed on GitHub |
| CANCELLED | CEO/GPT0 cancelled the task |

SELESAI means READY_FOR_REVIEW only. It never means APPROVED or MERGED.

## 10. Chat response protocol

Specialist chat must stay short:

- On start: DITERIMA — TASK-ID — mulai dikerjakan.
- On completion: SELESAI — TASK-ID — PR/ISSUE LINK — menunggu GPT0.
- On blocker: BLOCKED — TASK-ID — ONE-LINE BLOCKER.

GPT0's start announcement to the CEO should stay short:

- GPT2 SIAP MULAI — TASK-ID — TASK FILE LINK. Kirim MULAI ke chat GPT2.
- GPT4 MENUNGGU — depends on TASK-ID.
- GPT1–GPT4 SIAP — NUMBER OF TASKS task(s) ready. The CEO may start each named specialist.

No long technical report in specialist chat unless GPT0 explicitly requests it.

## 11. GPT0 review checklist

When the CEO says an agent is done, GPT0 must:

1. Identify the active Task ID from TASK_BOARD.md.
2. Open the linked Issue/PR and verify the specialist, Task ID, branch, target, and exact base SHA.
3. Inspect changed paths and diff against the allowed scope.
4. Check each acceptance criterion.
5. Verify the actual test commands/results and CI for the exact PR HEAD SHA.
6. Check for unrelated changes, regressions, missing tests, unresolved review comments, and dependency gaps.
7. For QA/audit tasks, verify that findings are specific, reproducible, and evidence-backed.
8. Set the appropriate status and update TASK_BOARD.md and AGENT_REPORTS.md.
9. Send the CEO a short Indonesian digest and only ask for decisions that require CEO authority.

A chat message saying SELESAI is not evidence of a successful implementation. If the Issue/PR cannot be found or evidence is incomplete, keep the task READY_FOR_REVIEW or BLOCKED and explain why.

## 12. CEO report format

GPT0 reports in Indonesian and keeps routine updates concise:

- Kondisi: overall work-cycle status.
- Selesai: tasks verified by GPT0.
- Berjalan: active tasks and owners.
- Kendala: material blockers only.
- Butuh keputusan CEO: one clear decision, only when necessary.
- Berikutnya: next tasks or start instructions.

Do not dump specialist logs, raw test output, or long technical explanations into the CEO chat unless requested.

## 13. Safety and authority boundaries

- Specialists may not merge PRs or deploy without explicit CEO authorization.
- No specialist may alter secrets, credentials, billing, repository access, branch protections, or production configuration without separate authorization.
- No destructive migration, broad refactor, dependency upgrade, or architecture reversal without an explicit task and acceptance plan.
- If instructions conflict with approved Folio architecture/specifications, stop and report the conflict to GPT0.
- Preserve the Folio identity, .flop extension, and accepted architecture decisions unless the CEO changes them.
- Never fabricate task status, commits, test results, CI status, links, or repository writes.

## 14. Adoption

This protocol becomes active only after this documentation PR is reviewed and merged by the CEO. Until then, it is a proposed operating contract.
