# Folio CEO Quick Guide — GPT Task Inbox

## Default: Codex coordinator

For repository work, start with one Codex coordinator. Give it the goal and relevant context; it reads the task packet and live GitHub state, verifies the exact base SHA and dependencies, creates bounded assignments, and delegates GPT1–GPT4 specialist profiles as native subagents. It tracks status, gathers evidence and reports, and keeps one CEO-facing summary. Separate GPT1–GPT4 chats and their wake/recovery commands below are a fallback when native delegation is unavailable.

Every task must name its goal, unique ID, exact base SHA, allowed and forbidden paths, dependencies, evidence destination, checks, and stop conditions. Subagents are assumed to inherit the coordinator's effective permissions, so assignments stay least-privilege and explicitly bounded. GitHub is the durable record; chat-only state is not recoverable.

Allow one repository writer at a time until isolated worktrees are proven safe. The coordinator waits for the writer to stop, checks the diff and freezes the exact candidate SHA, then starts one independent read-only QA/audit review against that SHA. If changes are needed, return them to the writer and freeze a new SHA before another review. Independent read-only analysis may run in parallel within actual session capacity; there is no fixed concurrency promise.

CEO approval is still required for product PR merges, production deployment, repository settings/secrets changes, destructive data actions, and material product-direction changes. See [Codex Orchestration V1](CODEX_ORCHESTRATION_V1.md).

## GPT conversation fallback

## One-time setup (once for each existing GPT1–GPT4 conversation)

After the coordination protocol is merged, open each existing specialist chat and send its matching activation command:

- GPT1 chat: **AKTIFKAN GPT1 DARI REPOSITORY FOLIO — https://github.com/budapesservices-dotcom/folio-studio**
- GPT2 chat: **AKTIFKAN GPT2 DARI REPOSITORY FOLIO — https://github.com/budapesservices-dotcom/folio-studio**
- GPT3 chat: **AKTIFKAN GPT3 DARI REPOSITORY FOLIO — https://github.com/budapesservices-dotcom/folio-studio**
- GPT4 chat: **AKTIFKAN GPT4 DARI REPOSITORY FOLIO — https://github.com/budapesservices-dotcom/folio-studio**

The specialist reads its identity, workflow, Task Board, and recovery instructions from GitHub. This setup does not need to be repeated in that same conversation.

## If a chat reaches its limit or you must open a new chat

Open a new conversation for that same GPT and send only the matching one-line recovery command:

- New GPT1 chat: **PULIHKAN GPT1 — https://github.com/budapesservices-dotcom/folio-studio**
- New GPT2 chat: **PULIHKAN GPT2 — https://github.com/budapesservices-dotcom/folio-studio**
- New GPT3 chat: **PULIHKAN GPT3 — https://github.com/budapesservices-dotcom/folio-studio**
- New GPT4 chat: **PULIHKAN GPT4 — https://github.com/budapesservices-dotcom/folio-studio**

The new chat reads the current assignment and latest saved checkpoint from GitHub. If the task was IN_PROGRESS, it resumes from the last durable checkpoint. If only DISPATCHED, send MULAI separately. If GitHub evidence is missing or inconsistent, the specialist must report BLOCKED.

**Important:** only work recorded in GitHub can be restored. Uncommitted edits and details that existed only in the old chat cannot be recovered automatically.

## When GPT0 says a specialist is ready

Example GPT0 message:

GPT2 SIAP MULAI — FOLIO-20261121-CANVAS-001. Buka chat GPT2 dan kirim: MULAI.

## What the CEO does

1. Open the named GPT conversation.
2. Send only: MULAI (or LAKSANAKAN).
3. GPT2 reads its assigned DISPATCHED task from the repository and replies: DITERIMA — TASK-ID — mulai dikerjakan.
4. Tell GPT0 **GPT2 mulai — TASK-ID** so it can update the agent/task status after checking the repository.
5. When GPT2 finishes, it stores evidence in GitHub and replies with one short SELESAI line.
6. Tell GPT0 **GPT2 selesai — TASK-ID**. GPT0 performs the review and updates the CEO report.

Do not copy the task packet or technical report between chats.

## If GPT says BLOCKED

Do not improvise or choose another task. Send the one-line blocker to GPT0 so it can repair the packet or access problem.

## The three working links to remember

- [Task Board](TASK_BOARD.md)
- [Agent State](AGENT_STATE.md)
- [CEO report](AGENT_REPORTS.md)

The full protocol and recovery rules are in [PROTOCOL.md](PROTOCOL.md) and [RECOVERY_PROTOCOL.md](RECOVERY_PROTOCOL.md).
