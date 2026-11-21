# Folio Studio — GPT Task Board

**Coordinator and sole editor:** GPT0  
**Protocol:** [GPT Team Coordination Protocol](PROTOCOL.md) — ACTIVE  
**Agent identity:** [Canonical Agent Identity](AGENT_IDENTITY.md)  
**Recovery:** [New-Chat Recovery Protocol](RECOVERY_PROTOCOL.md)  
**Agent state:** [Persistent Agent State](AGENT_STATE.md)  
**Task template:** [Task File Template](TASK_PACKET_TEMPLATE.md)  
**CEO report:** [Agent Reports](AGENT_REPORTS.md)

> GPT0 creates task files under tasks/ and manages this board. Specialists only read it. DISPATCHED tasks require the CEO's MULAI/LAKSANAKAN signal. A specialist's SELESAI becomes READY_FOR_REVIEW, not APPROVED.

## Current work cycle

| Field | Value |
|---|---|
| Cycle ID | FOLIO-CYCLE-20261121-001 |
| CEO objective | Reconcile independent audits and define safe PR integration; implementation held |
| Default branch | main |
| Product-code baseline | 49761cd8ca0cd719beb9b84a6becc03dbd2b431f |
| PR #1 pinned main comparison snapshot | 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 |
| PR #1 divergence at pinned snapshot | 310 commits ahead / 41 commits behind; diverged |
| Current live PR #1 vs main comparison | 310 ahead / 57 behind; 16 commits since pinned snapshot are docs/coordination/** only |
| CEO-selected integration route | Retain PR #1 as common parent; reconcile main into it after a specific preflight packet; then PR #4, PR #5, and PR #7 in order |
| Last reconciled | 2026-11-21 — GPT0 live GitHub verification and CEO route selection |

## Dispatched — awaiting CEO start signal

| Agent | Task ID | Task file | Priority | Status | Depends on |
|---|---|---|---|---|---|
| — | — | — | — | — | No specialist task remains dispatched in this cycle |

## In progress

| Agent | Task ID | Current note |
|---|---|---|
| GPT0 | FOLIO-CYCLE-20261121-001 | Reconciling submitted reports and defining integration decision; no implementation |

## Waiting / blocked

| Agent | Task ID | Status | Blocker / dependency |
|---|---|---|---|
| GPT2 | FOLIO-20261121-PR4-PR5-REMEDIATION-RESERVE-001 | WAITING | No source/test work until GPT0 publishes a finding-specific revised packet with exact PR, branch, paths, base SHA and tests. Native Commands Phase 2 remains prohibited. |

## Ready for GPT0 review

| Task ID | Agent | Evidence | Audited HEAD(s) | Review status |
|---|---|---|---|---|
| FOLIO-20261121-PR1-FOUNDATION-AUDIT-002 | GPT3 | [PR #1 audit report](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059122585) | PR #1 `89780034f32b1809cc49640e83bac5c817d88a91`; main comparison snapshot `8d8571cb13da23fb2f39c57cc3d34f556dbf10c1` | READY_FOR_REVIEW — report and packet match; verdict NOT READY |
| FOLIO-20261121-PR4-PR5-QA-001 | GPT4 | [PR #4 audit](https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7058959718) · [PR #5 audit](https://github.com/budapesservices-dotcom/folio-studio/pull/5#issuecomment-7058960294) | PR #4 `9730fdc02f5ee331c17de61c443a0f0d35782c56`; PR #5 `a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900`; both base PR #1 `89780034f32b1809cc49640e83bac5c817d88a91` | READY_FOR_REVIEW — both reports and exact heads match; both verdicts READY WITH CONDITIONS |
| FOLIO-20261121-PR7-DEPENDENCY-001 | GPT1 | [PR #7 dependency audit](https://github.com/budapesservices-dotcom/folio-studio/pull/7#issuecomment-7058956383) | PR #7 `76eb40426059ed21ce93156c5065835ea3717467`; PR #5 dependency HEAD `a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900` | READY_FOR_REVIEW — report and exact heads match; verdict COMPATIBLE WITH CONDITIONS |

## CEO route decision

**DECIDED:** retain PR #1 (`feat/canvas-pan-distribute`) as the common foundation parent. Do not recreate/split the foundation at this stage. First prepare a controlled main→PR #1 reconciliation that preserves main's GPT coordination protocol and carefully combines the product-specific AGENTS guidance plus deploy workflow. No source branch has been changed yet. Next, refresh child PR bases and close PR #4 QA gaps before PR #5; PR #7 remains last. See `AGENT_REPORTS.md` for the ordered gate sequence.

## Reconciliation facts

- PR #1 is open, draft, unmerged and `mergeable=false`; retain it as a candidate parent only, not a merge-ready branch.
- PR #2, PR #3 and PR #6 merged into `feat/canvas-pan-distribute`, not `main`. Their merge chain culminates at PR #1 HEAD `89780034...`; their contents are present on the feature branch. PR #8 and PR #9 are the coordination/recovery PRs merged into `main`.
- PR #4 and PR #5 remain open/unmerged and both target PR #1 HEAD `89780034...`. Their independent CI runs do not validate their combined App/CSS changes.
- PR #7 remains stacked on old PR #5 base `b2d7e904...`; comparison against latest PR #5 HEAD `a8b2818...` is diverged (23 commits on PR #5 side / 4 on PR #7 side). No synchronization is authorized.
- GPT3 packet `FOLIO-20261121-PR1-FOUNDATION-AUDIT-002` received a factual correction to its PR #2/#3/#6 merge-target statement on 2026-11-21. The report itself already identified this discrepancy.

## Superseded task history

| Task ID | Agent | Status | Reason / replacement |
|---|---|---|---|
| FOLIO-20261121-PR1-FOUNDATION-AUDIT-001 | GPT3 | SUPERSEDED | Main comparison snapshot and divergence figures were stale; replaced by task 002 |

---

## Board rules

1. GPT0 is the only editor of this file.
2. Every READY or DISPATCHED row must link to one complete task file under tasks/.
3. Publish a task file to the default branch before setting a task to READY.
4. READY means packet published but not released; DISPATCHED authorizes a specialist to begin only after the CEO's start signal.
5. Keep at most one READY, DISPATCHED, ACCEPTED, or IN_PROGRESS task per specialist so MULAI is unambiguous.
6. Use WAITING for dependent work. Never invite it to start early.
7. GPT0 updates this board when dispatching, when receiving specialist start/finish signals, or when GitHub evidence is verified.
8. A specialist's SELESAI changes the task to READY_FOR_REVIEW, not APPROVED.
9. Record APPROVED only after GPT0 checks the evidence and acceptance criteria.
10. Record MERGED only after GitHub confirms a CEO-authorized merge.
11. Never delete task history; preserve completed task files and their evidence.
