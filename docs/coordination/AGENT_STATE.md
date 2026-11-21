# Folio Studio — Persistent Agent State

**Coordinator / sole editor:** GPT0
**Purpose:** compact, repository-backed pointers to each agent's current task and latest durable checkpoint.
**Important:** this dashboard is a status index, not a transcript and not a substitute for task packets or GitHub evidence.

## Current cycle

| Field | Value |
|---|---|
| Cycle ID | NOT_STARTED |
| Last verified | Not started |
| Default branch / baseline SHA | To be verified by GPT0 |

## Agent state

| Agent | Role | Activation | Current task | Task status | Working branch / PR / Issue | Latest durable checkpoint | Next action / blocker | Last updated |
|---|---|---|---|---|---|---|---|---|
| GPT0 | Coordinator / Chief of Staff | ACTIVE | — | IDLE | — | — | Await CEO objective | Not started |
| GPT1 | Architect / Preflight | NOT_ACTIVATED | — | IDLE | — | — | Await one-time activation or recovery trigger in a new chat | Not started |
| GPT2 | Engineer | NOT_ACTIVATED | — | IDLE | — | — | Await one-time activation or recovery trigger in a new chat | Not started |
| GPT3 | QA / UI / Regression | NOT_ACTIVATED | — | IDLE | — | — | Await one-time activation or recovery trigger in a new chat | Not started |
| GPT4 | Independent Auditor | NOT_ACTIVATED | — | IDLE | — | — | Await one-time activation or recovery trigger in a new chat | Not started |

## How this record works

1. GPT0 is the only editor of this file. Specialists must not update it directly.
2. GPT0 updates the relevant row when an agent is activated, accepts a task, becomes blocked, submits evidence, or has a result verified.
3. A chat signal such as **GPT2 mulai** may prompt GPT0 to inspect and update the record, but the signal alone is not proof of progress or completion.
4. The "Latest durable checkpoint" must link to a GitHub commit, PR comment, Issue comment, or other task-approved evidence that actually exists.
5. For implementation work, durable progress belongs on the task's dedicated branch and/or PR. Commit meaningful work regularly; create a draft PR when useful to preserve a reviewable checkpoint.
6. For read-only, QA, or audit work, put checkpoint notes and findings in the task's designated GitHub Issue/PR.
7. Do not put secrets, credentials, private user data, or long raw logs in this file.
8. If a chat disappears before work was committed or recorded in GitHub, that unrecorded work cannot be reconstructed from this dashboard. Report the gap honestly; never fabricate a checkpoint.

## Status vocabulary

- **NOT_ACTIVATED:** the specialist has not completed initial setup.
- **IDLE:** no active task is assigned.
- **DISPATCHED:** one task is released; the specialist has not yet acknowledged it.
- **ACCEPTED:** specialist acknowledged the task.
- **IN_PROGRESS:** work is underway and must have a durable checkpoint link when one exists.
- **BLOCKED:** work cannot safely continue; record the blocker and what GPT0 must resolve.
- **READY_FOR_REVIEW:** specialist submitted evidence; GPT0 review is pending.
- **APPROVED:** GPT0 verified the task against its acceptance criteria.
- **MERGED:** GitHub confirms a CEO-authorized merge.
- **CANCELLED:** CEO/GPT0 cancelled the task.

## Reconciliation rules

- The Task Board and task packet are authoritative for assignment and dispatch.
- GitHub commits, PRs, Issues, and their comments are authoritative for actual work and evidence.
- This dashboard is a convenience index. When it conflicts with live GitHub evidence, GPT0 must investigate and correct the dashboard; specialists must not guess.
- Preserve meaningful history in task packets and evidence destinations. This table should remain concise and reflect the latest verified state.
