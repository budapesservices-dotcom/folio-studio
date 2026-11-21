# Folio Studio — Agent Instructions

These rules apply to every AI coding assistant and specialist agent working in this repository.

## Primary operating model

For normal Folio repository work, the CEO's primary interface is the local
**Codex coordinator** in the repository workspace. The coordinator uses native
child subagents and the reusable GPT1–GPT4 specialist profiles described in
[CODEX_ORCHESTRATION_V1.md](docs/coordination/CODEX_ORCHESTRATION_V1.md).

GPT1–GPT4 are role profiles for those native children; they are not, by
default, separate CEO-managed chats. The historic GPT0 Chief-of-Staff and
separate-GPT-chat process is a legacy fallback only. It is documented in
`PROTOCOL.md` and must not be used as a parallel default workflow.

## Mandatory first read

1. Read docs/coordination/AGENT_IDENTITY.md and identify your GPT role.
2. Read docs/coordination/PROTOCOL.md.
2a. If you are GPT0, read docs/coordination/GPT0_MANDATE.md before coordinating or dispatching work.
3. Read docs/coordination/RECOVERY_PROTOCOL.md when restoring a new conversation.
4. Read docs/coordination/TASK_BOARD.md.
5. Read docs/coordination/AGENT_STATE.md as a navigation/status index.
6. Read the complete assigned task file under docs/coordination/tasks/.
7. Read relevant architecture/specification documents before touching implementation.
8. For normal native orchestration, read
   docs/coordination/CODEX_ORCHESTRATION_V1.md.

## Default: native Codex task execution

The local Codex coordinator validates the repository, scope, base SHA,
dependencies, and permissions before it delegates. It selects a reusable
specialist profile and gives a native child one bounded assignment. Native
children inherit the parent session's permissions; no child may elevate them.

- Use one writer for a writable scope/worktree at a time.
- Branch from the packet's exact base SHA and change only allowed paths.
- Freeze the exact candidate SHA before independent read-only QA.
- QA inspects that frozen SHA, never a moving branch, and cannot approve its
  own implementation.
- Keep commits, PR/Issue evidence, checks, and limitations durable in GitHub.
- Stop for a stale base, unmet dependency, forbidden path, failed required
  check, or a reserved CEO decision.

The coordinator, not the CEO, performs ordinary task dispatch and handoff. The
CEO is asked only for reserved decisions such as merges, deployment, settings,
secrets, destructive actions, or material product/architecture changes.

## Legacy fallback: separate GPT-chat task execution

Use this procedure only when native Codex orchestration is unavailable and the
CEO explicitly chooses the fallback. It is not an alternative default.

When the CEO says MULAI or LAKSANAKAN in a GPT1–GPT4 conversation:

1. Identify yourself using AGENT_IDENTITY.md.
2. Read the Task Board from the repository default branch.
3. Find exactly one DISPATCHED task assigned to your GPT role.
4. Open the task file and validate its base SHA and dependencies.
5. If exactly one valid task is found, reply: DITERIMA — TASK-ID — mulai dikerjakan. Then execute only that task.
6. If zero or multiple matching tasks exist, the base is stale, a dependency is unmet, or GitHub cannot be accessed, stop and reply BLOCKED with the reason. Never guess.

## Legacy fallback: recovering after a GPT-chat change

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

## Legacy fallback: GPT-chat communication

In the fallback workflow, chat is only for short status signals. Do not paste
long technical reports in the specialist chat. Native child completion is
reported to the Codex coordinator directly and recorded as GitHub evidence.

- Start: DITERIMA — TASK-ID — mulai dikerjakan.
- Finish: SELESAI — TASK-ID — PR/ISSUE LINK — menunggu GPT0.
- Blocked: BLOCKED — TASK-ID — ONE-LINE BLOCKER.
- New conversation recovery: PULIH — GPTN — TASK-ID/IDLE — checkpoint/status.

A SELESAI response means READY_FOR_REVIEW only. It does not mean approved or merged.
