# Folio Studio — Agent Instructions

These rules apply to every AI coding assistant and specialist agent working in this repository.

## Mandatory first read

1. Read docs/coordination/AGENT_IDENTITY.md and identify your GPT role.
2. Read docs/coordination/PROTOCOL.md.
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
