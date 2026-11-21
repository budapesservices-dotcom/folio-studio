# Folio Studio — Agent Instructions

These rules apply to every AI coding assistant and specialist agent working in this repository.

## Mandatory first read

1. Read docs/coordination/PROTOCOL.md.
2. Read docs/coordination/SPECIALIST_ONBOARDING.md when setting up a specialist conversation.
3. Read docs/coordination/TASK_BOARD.md.
3. If assigned a task, read the complete task file under docs/coordination/tasks/.
4. Read the relevant architecture/specification documents before touching implementation.

## Starting a task

When the user says MULAI or LAKSANAKAN in a GPT1–GPT4 conversation:

1. Identify your GPT role.
2. Read the Task Board from the repository default branch.
3. Find exactly one DISPATCHED task assigned to your GPT role.
4. Open the task file and validate its base SHA and dependencies.
5. If exactly one valid task is found, reply: DITERIMA — TASK-ID — mulai dikerjakan. Then execute only that task.
6. If zero or multiple matching tasks exist, the base is stale, a dependency is unmet, or GitHub cannot be accessed, stop and reply BLOCKED with the reason. Never guess.

## Non-negotiable rules

- Work only on the assigned Task ID, mode, scope, and paths.
- Do not silently expand scope or combine unrelated tasks.
- Specialists must not commit directly to main or another protected/base branch. GPT0 has a narrow standing exception only for coordination files (TASK_BOARD.md, task packet files under docs/coordination/tasks/, and AGENT_REPORTS.md) after the CEO adopts the protocol; see PROTOCOL.md. This exception never covers application code, tests, or deployment configuration.
- Do not merge PRs, deploy, delete project data, rotate secrets, or change repository settings unless separately authorized by the CEO.
- Use a dedicated implementation branch and PR for code/docs changes.
- Keep changes small, reviewable, and consistent with Folio architecture.
- Run the exact checks required by the task. Never claim a test passed unless it actually ran.
- Put detailed evidence in the GitHub PR or Issue specified by the task packet.
- Do not edit docs/coordination/TASK_BOARD.md, another agent's task file, or docs/coordination/AGENT_REPORTS.md. GPT0 owns these shared coordination files.
- If access, context, a dependency, or an acceptance criterion is missing, stop and report BLOCKED.

## Chat communication

Chat is only for short status signals. Do not paste long technical reports in the specialist chat.

- Start: DITERIMA — TASK-ID — mulai dikerjakan.
- Finish: SELESAI — TASK-ID — PR/ISSUE LINK — menunggu GPT0.
- Blocked: BLOCKED — TASK-ID — ONE-LINE BLOCKER.

A SELESAI response means READY_FOR_REVIEW only. It does not mean approved or merged.
