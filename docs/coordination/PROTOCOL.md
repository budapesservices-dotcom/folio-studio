# Folio Studio — Native Codex Coordination Protocol

**Version:** 2.0
**Status:** ACTIVE
**Repository:** budapesservices-dotcom/folio-studio
**Default interface:** local Codex coordinator

## 1. Purpose

The CEO's primary interface for normal Folio repository work is the local
Codex coordinator attached to the repository workspace. The coordinator
inspects state, selects the safe sequence, invokes native child subagents when
needed, verifies evidence, and reports a concise outcome. The CEO supplies
product direction and reserved approvals; it does not have to relay task
packets, wake specialist chats, or transport technical reports.

This protocol preserves Folio's approved architecture and the CEO approval
gates in [GPT0 Executive Mandate](GPT0_MANDATE.md). It does not authorize a
merge, deployment, setting change, secret/access change, destructive action,
or material product/architecture change without the CEO's explicit approval.

## 2. Durable repository evidence

| Location | Purpose | Normal owner |
|---|---|---|
| `AGENTS.md` | Repository-wide rules and native-default notice | Codex coordinator / CEO-controlled |
| `AGENT_IDENTITY.md` | Reusable GPT1–GPT4 profile definitions | Coordinator-managed reference |
| `CODEX_ORCHESTRATION_V1.md` | Native child lifecycle and safeguards | Codex coordinator |
| `TASK_BOARD.md`, `AGENT_STATE.md`, task packets, `AGENT_REPORTS.md` | Durable task indexes and legacy-fallback records | Coordinator only |
| GitHub Issues and PRs | Commits, checks, review evidence, and handoffs | Assigned child within scope |

GitHub commits, PRs, Issues, comments, checks, and exact SHAs are durable
evidence. A chat message or child handoff is a signal, never proof by itself.

## 3. Reusable specialist profiles

GPT1–GPT4 are reusable profiles for native Codex child subagents. They are not
the CEO's default set of separate GPT chats, and their names do not create an
automatic task assignment. The coordinator chooses only the profiles needed
for a bounded task.

| Profile | Native use | Boundary |
|---|---|---|
| GPT1 — Architect / Preflight | Design, compatibility, dependency and base-SHA analysis | Read-only unless a task expressly authorizes a bounded write |
| GPT2 — Engineer | Implementation or documentation on one scoped branch | Does not merge, deploy, or exceed allowlisted paths |
| GPT3 — QA / UI / Regression | Reproducible validation of a frozen exact SHA | Read-only; distinguishes evidence from risk |
| GPT4 — Independent Auditor | Independent review of scope, architecture, and evidence | Never reviews or approves its own implementation |

The old GPT0 Chief-of-Staff / separate-GPT-chat coordinator is a
**legacy/fallback role only**. It is described exclusively in Section 10 and
does not operate alongside the native default.

## 4. Default task dispatch: native Codex lifecycle

### 4.1 Coordinator preflight and authorization

Before delegation, the local Codex coordinator verifies the repository root,
live default branch, exact base SHA, working-tree state, relevant PRs/issues,
accepted Folio architecture, dependencies, and the parent's effective
permission boundary. A child inherits the parent permissions and cannot
elevate them. If write capability, an exact base, or another acceptance
precondition cannot be verified, the coordinator records `BLOCKED` and makes
no repository write.

The coordinator gives the child a self-contained bounded assignment: task ID
when one exists, profile, mode, exact base, branch/PR target, allowed and
forbidden paths, required checks, evidence destination, and stop conditions.
Ordinary execution within that scope is delegated by the coordinator; reserved
CEO decisions remain reserved.

### 4.2 Native child selection and isolation

The coordinator invokes native children from its current local Codex parent
session. It does not substitute an AO/remote worker or a separate GPT chat
when a task requires a native child. The child reports its actual identity and
completion handoff to the coordinator.

Use the smallest safe set of children. Never overlap writers in the same
worktree or mutable scope. A read-only preflight/audit may run only when it
cannot race a writer or inspect a moving candidate. Children must not create
subagents unless the task expressly authorizes it.

### 4.3 Writer lifecycle

One writer creates a dedicated branch directly from the exact authorized base
SHA, changes only allowlisted paths, and leaves unrelated files untouched. It
inspects its complete diff, ancestry, changed paths, commit message, and
required local checks before handoff. The writer does not merge, deploy,
change settings, or self-approve.

The coordinator verifies the writer's handoff independently. It validates the
full diff and scope before a push or draft PR. If a task specifies a commit
prefix or provider stop condition, the coordinator verifies the exact commit
message before push and stops immediately if the provider starts a prohibited
deployment. It does not retry by changing deployment settings or using an
alternate control mechanism.

### 4.4 Exact-SHA freeze and independent QA

After the writer has stopped and the coordinator has inspected the candidate,
the coordinator records one immutable candidate SHA. QA starts only after that
freeze and is given that exact SHA, never a branch name that can move.

QA is a different native child in read-only mode. It verifies scope, lineage,
the requested documents/code, required checks, and relevant acceptance
criteria. It records reproducible, line-specific findings and a clear verdict.
If QA requests changes, the same writer—not QA—creates a new candidate commit;
the coordinator repeats prefix/deployment safeguards, freezes the new SHA, and
obtains fresh independent QA. Writer and QA never overlap.

### 4.5 Evidence, review, and CEO handoff

For each candidate, record actual child identities, branch, base SHA,
candidate SHA, changed paths, commit subject, checks, deployment/status
evidence where applicable, QA verdict, limitations, and next safe action on
the authorized GitHub Issue and draft PR. The coordinator inspects that
evidence before declaring a task ready for review.

The coordinator gives the CEO a concise Indonesian digest: what changed, what
was verified, material risks, and only decisions that require CEO authority.
It must not claim a test, deployment skip, merge, or approval that it did not
verify. A draft PR is a review artifact, not authorization to merge or deploy.

## 5. Task records and status

Use a task packet whenever durable scope, sequencing, or multi-step handoff is
needed. It records the exact base, allowed paths, checks, evidence destination,
permission boundary, and no-merge/no-deploy constraints. The coordinator alone
edits `TASK_BOARD.md`, `AGENT_STATE.md`, task packets, and `AGENT_REPORTS.md`.

`DRAFT`, `WAITING`, `READY`, `DISPATCHED`, `ACCEPTED`, `IN_PROGRESS`,
`BLOCKED`, `READY_FOR_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `MERGED`, and
`CANCELLED` retain their existing meanings. `APPROVED` requires coordinator
verification; `MERGED` requires a CEO-authorized merge confirmed by GitHub.

## 6. Branches, PRs, and checks

- A writable task uses a dedicated branch from its exact base SHA.
- Change only allowlisted paths and stop on an unrelated or forbidden change.
- Use a draft PR against the authorized target branch after candidate and
  evidence requirements are satisfied.
- Run and report only checks that actually ran. Docs-only work does not imply
  product tests ran.
- Do not merge, deploy, change settings, rotate credentials, or alter
  protected branches without explicit CEO authorization.

## 7. Conflict prevention and independence

The coordinator sequences overlapping paths and mutable scopes. It does not
invent parallel work merely to use profiles. An auditor/QA child may not
approve its own implementation or rely solely on the writer's conclusion.
Folio's JSON-AST-first architecture, framework-independent `src/core`, typed
engine boundaries, replaceable persistence, versioned `.flop` schema, and
stage gates remain binding; workflow documentation must not authorize an
architecture reversal.

## 8. Recovery and limitations

Only committed work and GitHub evidence are recoverable. A replacement local
Codex coordinator re-runs preflight, reads the authoritative task/Issue/PR,
and resumes only from a durable exact-SHA checkpoint. It never treats an old
chat transcript or uncommitted files as proof. If the required native child,
permission, source ref, deployment evidence, or independent exact-SHA review
is unavailable, stop and record the precise blocker.

## 9. Safety and CEO authority

The coordinator follows the authority hierarchy: explicit CEO decision,
GPT0 mandate, this protocol and `AGENTS.md`, exact task scope, then approved
Folio specifications. It stops for a stale/missing base, unmet dependency,
forbidden path, failed required check that cannot safely be fixed in scope,
security/privacy/data-loss risk, provider deployment contrary to a task stop
condition, or a reserved CEO decision.

## 10. Legacy fallback: separate GPT-chat handoff

This section is **fallback-only**. Use it only when native local Codex
orchestration is unavailable and the CEO explicitly chooses it. It is not a
second default dispatch process.

In that fallback, the historic GPT0 coordinator may publish packets and update
the Task Board; the CEO may open a named GPT1–GPT4 chat and send `MULAI` or
`LAKSANAKAN`; the specialist validates one `DISPATCHED` packet, responds with a
short acceptance, works only in scope, stores evidence in GitHub, and sends a
short completion signal. A replacement fallback chat uses the documented
`PULIHKAN GPTN` recovery signal and reconstructs work only from durable GitHub
evidence. The CEO does not copy task packets or technical reports between
chats. These legacy signals never override CEO approval gates, frozen-SHA QA,
least privilege, or one-writer discipline.

## 11. Adoption

Version 2.0 makes native local Codex orchestration the sole default workflow.
It retains the historical GPT-chat procedure only as a labelled fallback while
preserving Folio's approval gates, evidence standards, and architecture.
