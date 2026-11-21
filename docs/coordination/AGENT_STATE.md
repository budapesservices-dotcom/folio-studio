# Folio Studio — Persistent Agent State

**Coordinator / sole editor:** GPT0  
**Purpose:** concise repository-backed pointers to each agent's current task and latest durable checkpoint.

## Current cycle

| Field | Value |
|---|---|
| Cycle ID | FOLIO-CYCLE-20261121-001 |
| Last verified | 2026-11-21, live GitHub inspection by GPT0; main @ `40a7edce7ab6e159f0dd40efeb9d8b7b2acbead4` |
| Product-code baseline | main @ 49761cd8ca0cd719beb9b84a6becc03dbd2b431f |
| PR #1 comparison snapshot | main @ 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 |
| PR #1 delta at pinned snapshot | 310 ahead / 41 behind; diverged |
| Current PR #1 vs main compare | 310 ahead / 72 behind; 31 commits since pinned snapshot touch only docs/coordination/** |
| PR #2/#3/#6 merge target | feat/canvas-pan-distribute, not main |
| Main coordination changes | GPT0 updates are restricted to docs/coordination/** |

## Agent state

| Agent | Role | Activation | Current task | Task status | Working branch / PR / Issue | Latest durable checkpoint | Next action / blocker | Last updated |
|---|---|---|---|---|---|---|---|---|
| GPT0 | Coordinator / Chief of Staff | ACTIVE | FOLIO-CYCLE-20261121-001 | IN_PROGRESS | main coordination records | Reviewed and APPROVED GPT1 PR #1 reconciliation preflight; confirmed PR #1 exact HEAD and current main-only coordination drift | Prepare a narrow execution packet for the two manual conflict resolutions; no branch sync or merge without separate explicit CEO authorization | 2026-11-21 |
| GPT1 | Architect / Preflight | ACTIVE | FOLIO-20261121-PR1-MAIN-RECONCILIATION-PREFLIGHT-001 | APPROVED | [Task packet](tasks/FOLIO-20261121-PR1-MAIN-RECONCILIATION-PREFLIGHT-001.md); [PR #1 preflight report](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059413863); prior PR #7 audit [report](https://github.com/budapesservices-dotcom/folio-studio/pull/7#issuecomment-7058956383) | GPT0 verified exact PR #1 HEAD, 31 coordination-only main commits since snapshot, and the two-path conflict set; task approved | No new GPT1 work until GPT0 publishes the next exact packet; PR #7 remains untouched | 2026-11-21 |
| GPT2 | Engineer | ACTIVE | FOLIO-20261121-PR4-PR5-REMEDIATION-RESERVE-001 | WAITING | No authorized implementation branch changes; reserve references PR #4/#5 | Reserve packet pins PR #4 9730fdc02f5ee331c17de61c443a0f0d35782c56 and PR #5 a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900 | Remain WAITING until GPT0 publishes a finding-specific packet with paths, exact base SHA and tests; Phase 2 prohibited | 2026-11-21 |
| GPT3 | QA / UI / Regression | ACTIVE | FOLIO-20261121-PR1-FOUNDATION-AUDIT-002 | READY_FOR_REVIEW | Read-only audit: PR #1 feat/canvas-pan-distribute | [PR #1 report](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059122585); exact PR #1 HEAD 89780034f32b1809cc49640e83bac5c817d88a91; pinned main snapshot 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 | GPT0 review pending; audit verdict NOT READY; no branch or code changes | 2026-11-21 |
| GPT4 | Independent Auditor | ACTIVE | FOLIO-20261121-PR4-PR5-QA-001 | READY_FOR_REVIEW | Read-only audit: PR #4 and PR #5 | [PR #4 report](https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7058959718); [PR #5 report](https://github.com/budapesservices-dotcom/folio-studio/pull/5#issuecomment-7058960294); exact heads 9730fdc... and a8b2818... | GPT0 review pending; both verdicts READY WITH CONDITIONS; no implementation or merge | 2026-11-21 |

## Reconciliation notes

- PR #1, #4, #5 and #7 remain open and unmerged. PR #1 is draft and non-mergeable.
- GPT3's audit report is posted on PR #1; it confirms NOT READY and identifies the add/add integration collision in AGENTS.md and .github/workflows/deploy.yml, missing exact-head CI/browser acceptance, and the need to preserve PR #4/#5 remediations.
- GPT4's two reports are posted on PR #4 and PR #5. Both audited exact task-packet HEADs and both return READY WITH CONDITIONS. PR #4 retains App-mounted autosave, native IndexedDB and deletion/recovery browser gaps. PR #5 retains live App drag/resize and harness cleanup/flakiness gaps. The reports identify App.tsx and global.css as shared PR #4/#5 integration paths.
- GPT1's report is posted on PR #7. Helper/API compatibility passes, but complete stack/focus semantics, minimized-window policy, Inspector visibility scope, live viewport use and dual persistence-path retirement must be resolved before App adoption. PR #7 is diverged from latest PR #5 and must not be synchronized yet.
- PR #2 Native Commands V1, PR #3 .flop workflow and PR #6 Workspace Architecture V1 were merged into feat/canvas-pan-distribute, not main. Their merge chain ends at PR #1 HEAD 89780034...; their contents are on that feature branch. PR #8 and PR #9 were merged into main.
- PR #1 task packet 002 was corrected on 2026-11-21 to remove the mistaken assertion that PR #2/#3/#6 were merged into main.
- GPT3 task 001 remains SUPERSEDED; task 002 is now READY_FOR_REVIEW. GPT1 task and GPT4 task are also READY_FOR_REVIEW.
- GPT2 reserve task remains WAITING. No Phase 2 work is authorized.
- CEO selected the recommended integration route: keep PR #1 as the common parent, reconcile main into it deliberately, then PR #4, PR #5 and PR #7 in sequence. This is a strategy decision, not evidence that any branch sync was executed.
- Main is currently 31 commits past the pinned PR #1 audit snapshot; a live compare confirms all 31 touch only docs/coordination/**, so GPT3's pinned product-code audit remains valid. Current live comparison reads 310 ahead / 72 behind; main HEAD is `40a7edce7ab6e159f0dd40efeb9d8b7b2acbead4`.
- No merge, deployment, PR-base change, branch synchronization, source-code change or test change was performed as part of this reconciliation.
- The CEO selected PR #1 as the common parent. GPT1 preflight packet FOLIO-20261121-PR1-MAIN-RECONCILIATION-PREFLIGHT-001 is APPROVED by GPT0; report is posted on PR #1. Approval covers the read-only preflight only, not branch synchronization or merge.

## Status vocabulary

- NOT_ACTIVATED: specialist has not completed initial setup.
- IDLE: no active task is assigned.
- DISPATCHED: one task is released; specialist may begin only after the CEO's start signal.
- ACCEPTED: specialist acknowledged the task; work is not assumed to be underway without a recorded checkpoint.
- IN_PROGRESS: work is underway.
- BLOCKED: work cannot safely continue; blocker is recorded.
- READY_FOR_REVIEW: specialist submitted evidence; GPT0 review is pending.
- APPROVED: GPT0 verified the task against its acceptance criteria.
- MERGED: GitHub confirms a CEO-authorized merge.
- CANCELLED: GPT0 cancelled a task.

## Reconciliation rules

1. Task Board and task packet are authoritative for task assignment and dispatch.
2. GitHub commits, PRs, Issues, comments and checks are authoritative for delivered work and evidence.
3. This dashboard is a convenience index. When it conflicts with live GitHub evidence, GPT0 investigates and corrects it.
4. Activation is separate from task authorization. An ACTIVE specialist still needs a unique DISPATCHED task and the CEO's MULAI/LAKSANAKAN signal before starting.
5. Keep this file concise and do not store secrets, credentials, private data, or raw logs.
