# Folio Studio — New-Chat Recovery Protocol

**Purpose:** restore an agent's identity, assignment, and last recorded work after a chat reaches its limit or a new conversation is opened.
**Repository:** budapesservices-dotcom/folio-studio

## 1. One-line recovery trigger

In a newly opened conversation, the CEO sends the matching one-line trigger:

- **PULIHKAN GPT1 — REPOSITORY: https://github.com/budapesservices-dotcom/folio-studio**
- **PULIHKAN GPT2 — REPOSITORY: https://github.com/budapesservices-dotcom/folio-studio**
- **PULIHKAN GPT3 — REPOSITORY: https://github.com/budapesservices-dotcom/folio-studio**
- **PULIHKAN GPT4 — REPOSITORY: https://github.com/budapesservices-dotcom/folio-studio**

The repository URL in the trigger tells a fresh conversation where to begin. The CEO does not need to paste the previous conversation, task packet, long report, or technical history. The new conversation must retrieve the current information from the repository and the task's GitHub evidence.

This is a recovery request, not permission to select a new task or expand scope.

## 2. Mandatory read sequence

The agent must read these files from the repository default branch:

1. [Canonical Agent Identity](AGENT_IDENTITY.md)
2. [Repository Agent Instructions](../../AGENTS.md)
3. [Coordination Protocol](PROTOCOL.md)
4. [Task Board](TASK_BOARD.md)
5. [Persistent Agent State](AGENT_STATE.md)

Then, if the agent has an active task:

6. Read its complete task packet under [tasks/](tasks/README.md).
7. Open the linked PR/Issue and inspect the latest comments, commits, checks, and evidence.
8. Confirm the task's exact base SHA, branch, dependencies, allowed paths, and current status before continuing.

If GitHub or any required file/evidence destination cannot be accessed, the agent must report BLOCKED. Do not pretend that context was restored.

## 3. Source-of-truth order

Use each source for the facts it owns:

1. **AGENT_IDENTITY.md** — GPT number and canonical role.
2. **AGENTS.md and PROTOCOL.md** — rules, authority, and workflow.
3. **TASK_BOARD.md and the task packet** — assignment, dispatch status, scope, dependencies, and acceptance criteria.
4. **GitHub branch, commits, PR/Issue, comments, and checks** — actual work completed and latest durable checkpoint.
5. **AGENT_STATE.md** — a concise index maintained by GPT0; useful for navigation but never stronger than live task evidence.

If these sources conflict, stop, explain the exact conflict, and ask GPT0 to reconcile it. Never resolve a material conflict by guessing.

## 4. What to do after reading

First verify that the role in the trigger matches the canonical identity file.

Then locate tasks assigned to that GPT:

- Exactly one **DISPATCHED** task: report that it is ready to start; wait for the CEO's separate **MULAI** or **LAKSANAKAN** signal.
- Exactly one **ACCEPTED** or **IN_PROGRESS** task: inspect the latest GitHub checkpoint and resume only the remaining work within the original scope.
- Exactly one **BLOCKED** task: restore the blocker and wait for GPT0's resolution. Do not resume on assumptions.
- Exactly one **READY_FOR_REVIEW** task: do not repeat the work; point GPT0 to the existing evidence and wait for review.
- **APPROVED**, **MERGED**, or **CANCELLED**: do not resume that task.
- No active task: restore the role and report IDLE.
- More than one plausible active task, an inaccessible task packet, stale base SHA, unmet dependency, or missing evidence: stop and report BLOCKED.

Do not create a new task, change the Task Board, or take another specialist's work during recovery.

## 5. Recovery response

After a successful read, reply with one concise line:

- Active work resumed: **PULIH — GPT2 — TASK-ID — checkpoint: LINK — melanjutkan.**
- Ready but not started: **PULIH — GPT2 — TASK-ID — DISPATCHED — menunggu MULAI.**
- Waiting for review: **PULIH — GPT2 — TASK-ID — READY_FOR_REVIEW — menunggu GPT0.**
- No active assignment: **PULIH — GPT2 — IDLE — menunggu DISPATCHED.**
- Cannot restore safely: **BLOCKED — GPT2 — alasan singkat dan spesifik.**

Replace GPT2 with the actual role.

## 6. Durable checkpoint requirements

Chat history is not the team's persistent work store. To make recovery useful:

- Implementation agents must commit meaningful progress to their task branch regularly. When practical, open a draft PR early so progress and review context are available in GitHub.
- QA, architecture, and audit agents must place meaningful interim findings in the task's designated Issue/PR, not only in chat.
- A checkpoint should state the current commit or evidence link, what is complete, what remains, validation performed (if any), and the next safe action.
- Do not claim uncommitted local edits or private chat reasoning were saved.
- Do not claim tests passed unless the exact commands actually ran and their results are recorded.

If the previous chat ended before its latest work was recorded, recover the last durable GitHub checkpoint and explicitly disclose anything that is missing. Recovery cannot resurrect unsaved text, local files, or inaccessible conversation history.

## 7. Limits and truthful behavior

This protocol does not make separate ChatGPT conversations communicate automatically and does not guarantee that a new chat can access GitHub. The CEO still sends one short recovery trigger to the new conversation. The agent must use whatever GitHub access is actually available in that conversation and report a blocker if it cannot read or write the required evidence.

A successful recovery means the agent reconstructed the task from repository-backed sources. It does not mean that the new chat has recovered the old chat transcript or hidden internal reasoning.
