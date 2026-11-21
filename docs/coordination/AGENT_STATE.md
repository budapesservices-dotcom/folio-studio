# Folio Studio — Persistent Agent State

**Coordinator / sole editor:** GPT0  
**Purpose:** concise repository-backed pointers to each agent's current task and latest durable checkpoint.

## Current cycle

| Field | Value |
|---|---|
| Cycle ID | FOLIO-CYCLE-20261121-001 |
| Last verified | 2026-11-21, live GitHub inspection by GPT0 |
| Product-code baseline | main @ 49761cd8ca0cd719beb9b84a6becc03dbd2b431f |
| PR #1 comparison snapshot | main @ 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 |
| Post-snapshot main changes | GPT0 coordination-only updates under docs/coordination/**; no non-coordination changes observed |

## Agent state

| Agent | Role | Activation | Current task | Task status | Working branch / PR / Issue | Latest durable checkpoint | Next action / blocker | Last updated |
|---|---|---|---|---|---|---|---|---|
| GPT0 | Coordinator / Chief of Staff | ACTIVE | FOLIO-CYCLE-20261121-001 | IN_PROGRESS | main coordination records | Refreshed GPT3 PR #1 audit packet and board/state/report updated; see Task Board and CEO Report | Verify specialist findings and sequence integration; no merge/deploy authority used | 2026-11-21 |
| GPT1 | Architect / Preflight | ACTIVE — latest specialist activation confirmed in conversation; reconciled by GPT0 | FOLIO-20261121-PR7-DEPENDENCY-001 | DISPATCHED | Read-only: PR #7 feat/workspace-preferences-v1; compare with PR #5 | PR #7 HEAD 76eb40426059ed21ce93156c5065835ea3717467; PR #5 HEAD a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900 | Wait for CEO MULAI; do not rebase or synchronize PR #7 | 2026-11-21 |
| GPT2 | Engineer | ACTIVE — latest specialist activation confirmed in conversation; reconciled by GPT0 | FOLIO-20261121-PR4-PR5-REMEDIATION-RESERVE-001 | WAITING | PR #4 / PR #5 future finding-specific remediation only | PR #4 HEAD 9730fdc02f5ee331c17de61c443a0f0d35782c56; CI #362 success | No start or code changes; await GPT4 final QA and a revised packet from GPT0 | 2026-11-21 |
| GPT3 | QA / UI / Regression | ACTIVE — latest specialist activation confirmed in conversation; reconciled by GPT0 | FOLIO-20261121-PR1-FOUNDATION-AUDIT-002 | DISPATCHED | Read-only: PR #1 feat/canvas-pan-distribute | Refreshed task packet on main; exact PR #1 HEAD 89780034f32b1809cc49640e83bac5c817d88a91; pinned main comparison 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1; 310 ahead / 41 behind | Await CEO MULAI, then rerun full audit and publish complete evidence to PR #1; old task 001 is superseded | 2026-11-21 |
| GPT4 | Independent Auditor | ACTIVE — latest specialist activation confirmed in conversation; reconciled by GPT0 | FOLIO-20261121-PR4-PR5-QA-001 | DISPATCHED | Read-only: PR #4 feat/native-command-core-phase1 and PR #5 feat/workspace-window-management | PR #4 HEAD 9730fdc02f5ee331c17de61c443a0f0d35782c56 / CI #362; PR #5 HEAD a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900 / CI #360 | Wait for CEO MULAI; issue independent reports on both PRs; no code, merge, or deploy | 2026-11-21 |

## Reconciliation notes

- PR #8 and PR #9 are confirmed merged; Task Inbox and recovery files exist on main.
- Previous AGENT_STATE and TASK_BOARD content still said NOT_STARTED / NOT_ACTIVATED and was stale relative to specialist-chat activation acknowledgements. GPT0 has reconciled activation as ACTIVE, while task authorization is governed only by the DISPATCHED / WAITING status above.
- Previous work reports in chat were not themselves durable Task Board entries. This cycle's assignments are persisted as task packets on main.
- GPT3 task 001 was superseded because its comparison baseline was stale and no durable audit report or review was present on PR #1. No audit verdict was inferred from the chat-only completion signal.
- GPT3 task 002 now pins PR #1 HEAD and main comparison snapshot, tolerating later GPT0 coordination-only commits under docs/coordination/**.
- Current live open PRs: #1, #4, #5, #7. Closed merged PRs verified in this pass: #2, #3, #6, #8, #9.
- No merge or deployment was performed in this cycle.

## Status vocabulary

- NOT_ACTIVATED: specialist has not completed initial setup.
- IDLE: no active task is assigned.
- DISPATCHED: one task is released; specialist has not acknowledged it.
- ACCEPTED: specialist acknowledged the task; work is not assumed to have started until recorded.
- IN_PROGRESS: work is underway and has a durable checkpoint when one exists.
- BLOCKED: work cannot safely continue; blocker is recorded.
- READY_FOR_REVIEW: specialist submitted evidence; GPT0 review is pending.
- APPROVED: GPT0 verified the task against acceptance criteria.
- MERGED: GitHub confirms a CEO-authorized merge.
- CANCELLED: GPT0 cancelled a task.

## Reconciliation rules

1. Task Board and task packet are authoritative for assignment and dispatch.
2. GitHub commits, PRs, Issues, comments and checks are authoritative for actual work and evidence.
3. This dashboard is a convenience index. When it conflicts with live GitHub evidence, GPT0 investigates and corrects it.
4. Activation is separate from task authorization: an ACTIVE specialist still needs a unique DISPATCHED task and the CEO's MULAI/LAKSANAKAN signal.
5. Keep this file concise and do not store secrets, credentials, private data, or raw logs.
