# Folio CEO Quick Guide — GPT Task Inbox

## One-time setup (do this once per GPT1–GPT4)

After the protocol PR is merged, send each specialist the matching role-specific message from [SPECIALIST_ONBOARDING.md](SPECIALIST_ONBOARDING.md). This is needed because repository instructions are not automatically injected into every separate Custom GPT conversation. Once activated, the daily start trigger is only one word.

## When GPT0 says a specialist is ready

Example GPT0 message:

GPT2 SIAP MULAI — FOLIO-20261121-CANVAS-001. Buka chat GPT2 dan kirim: MULAI.

## What the CEO does

1. Open the GPT2 conversation.
2. Send only: MULAI (or LAKSANAKAN).
3. GPT2 reads its assigned DISPATCHED task from the repository and replies: DITERIMA — TASK-ID — mulai dikerjakan.
4. Optionally tell GPT0: GPT2 mulai, so the Task Board can reflect the start immediately.
5. When GPT2 finishes, it stores evidence in GitHub and replies with one short SELESAI line.
6. Tell GPT0: GPT2 selesai. GPT0 performs the review and updates the CEO report.

Do not copy the task packet or technical report between chats.

## If GPT says BLOCKED

Do not improvise or choose another task. Send the one-line blocker to GPT0 so it can repair the packet or access problem.

## The three links to remember

- Task Board: TASK_BOARD.md
- Task packet folder: tasks/
- CEO report: AGENT_REPORTS.md
