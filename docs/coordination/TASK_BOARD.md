# Folio Studio — GPT Task Board

**Coordinator and sole editor:** GPT0  
**Protocol:** [GPT Team Coordination Protocol](PROTOCOL.md) — ACTIVE  
**Agent identity:** [Canonical Agent Identity](AGENT_IDENTITY.md)  
**Recovery:** [New-Chat Recovery Protocol](RECOVERY_PROTOCOL.md)  
**Agent state:** [Persistent Agent State](AGENT_STATE.md)  
**Task template:** [Task File Template](TASK_PACKET_TEMPLATE.md)  
**CEO report:** [Agent Reports](AGENT_REPORTS.md)

> GPT0 creates task files under tasks/ and manages this board. Specialists only read it. Do not start a task unless its status is DISPATCHED and it is assigned to your GPT role. READY is published but not yet released.

## Current work cycle

| Field | Value |
|---|---|
| Cycle ID | FOLIO-CYCLE-20261121-001 |
| CEO objective | Repository and PR reconciliation; independent audit before any implementation |
| Default branch | main |
| Baseline SHA at cycle start | 49761cd8ca0cd719beb9b84a6becc03dbd2b431f |
| Main comparison snapshot pinned for PR #1 audit | 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 |
| Post-snapshot GPT0 updates | docs/coordination/** only; pinned comparison remains 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 |
| Last updated | 2026-11-21 |

## Dispatched — awaiting CEO start signal

| Agent | Task ID | Task file | Priority | Status | Depends on |
|---|---|---|---|---|---|
| GPT4 | FOLIO-20261121-PR4-PR5-QA-001 | [PR #4 + #5 final independent QA](tasks/FOLIO-20261121-PR4-PR5-QA-001.md) | P0 | DISPATCHED | None |
| GPT1 | FOLIO-20261121-PR7-DEPENDENCY-001 | [PR #7 dependency compatibility audit](tasks/FOLIO-20261121-PR7-DEPENDENCY-001.md) | P1 | DISPATCHED | None for read-only audit |

## In progress

| Agent | Task ID | Accepted | Current note |
|---|---|---|---|
| — | — | — | Awaiting CEO MULAI/LAKSANAKAN signals for dispatched tasks |

## Waiting / blocked

| Agent | Task ID | Status | Blocker / dependency |
|---|---|---|---|
| GPT2 | FOLIO-20261121-PR4-PR5-REMEDIATION-RESERVE-001 | WAITING | Must wait for GPT4 final QA and GPT0's finding-specific revised packet; no implementation or Phase 2 authorization |

## Ready for GPT0 review

| Task ID | Agent | Evidence PR / Issue | Submitted SHA | Review status |
|---|---|---|---|---|
| FOLIO-20261121-PR1-FOUNDATION-AUDIT-002 | GPT3 | [PR #1 audit comment](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059122585) | `89780034f32b1809cc49640e83bac5c817d88a91` | READY_FOR_REVIEW — verdict NOT READY; GPT0 validation pending |

## Recently verified

| Task ID | Agent | Status | Evidence |
|---|---|---|---|
| Previous-cycle implementation tasks | GPT1–GPT4 | Historical checkpoints only; not newly re-verified in this cycle | PR #4 HEAD 9730fdc; PR #5 HEAD a8b2818; PR #7 HEAD 76eb404 |

## Superseded task history

| Task ID | Agent | Status | Reason / replacement |
|---|---|---|---|
| FOLIO-20261121-PR1-FOUNDATION-AUDIT-001 | GPT3 | SUPERSEDED | Main comparison snapshot and divergence figures were stale; no durable audit report was published. Replaced by [task 002](tasks/FOLIO-20261121-PR1-FOUNDATION-AUDIT-002.md) |

---

## Board rules

1. GPT0 is the only editor of this file.
2. Every READY or DISPATCHED row must link to one complete task file under tasks/.
3. Publish a task file to the default branch before setting a task to READY.
4. READY means the packet is published but not yet released to the specialist. GPT0 must switch it to DISPATCHED before announcing the start trigger.
5. DISPATCHED is the only status that authorizes a specialist to begin after receiving MULAI/LAKSANAKAN.
6. Keep at most one READY, DISPATCHED, ACCEPTED, or IN_PROGRESS task per specialist so MULAI is unambiguous.
7. Use WAITING for dependent work. Never invite a specialist to start it early.
8. GPT0 updates this board when dispatching tasks, when the CEO relays a start/finish signal, or when GitHub evidence is verified.
9. A specialist's SELESAI changes the task to READY_FOR_REVIEW, not APPROVED.
10. Record APPROVED only after GPT0 checks the evidence and acceptance criteria.
11. Record MERGED only after GitHub confirms a CEO-authorized merge.
12. Never delete task history; move completed tasks to Recently verified and preserve their task files.
