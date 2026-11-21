# Folio Studio — GPT Task Board

**Coordinator and sole editor:** GPT0  
**Protocol:** [GPT Team Coordination Protocol](PROTOCOL.md)  
**Task template:** [Task File Template](TASK_PACKET_TEMPLATE.md)  
**CEO report:** [Agent Reports](AGENT_REPORTS.md)

> GPT0 creates task files under tasks/ and manages this board. Specialists only read it. Do not start a task unless its status is READY and it is assigned to your GPT role.

## Current work cycle

| Field | Value |
|---|---|
| Cycle ID | NOT_STARTED |
| CEO objective | Awaiting CEO instruction |
| Default branch | To be verified by GPT0 |
| Baseline SHA | To be verified by GPT0 |
| Last updated | Not started |

## Ready to start

| Agent | Task ID | Task file | Priority | Status | Depends on |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## In progress

| Agent | Task ID | Task file | Accepted | Current note |
|---|---|---|---|---|
| — | — | — | — | — |

## Waiting / blocked

| Agent | Task ID | Task file | Status | Blocker / dependency |
|---|---|---|---|---|
| — | — | — | — | — |

## Ready for GPT0 review

| Agent | Task ID | Evidence PR / Issue | Submitted SHA | Review status |
|---|---|---|---|---|
| — | — | — | — | — |

## Recently verified

| Task ID | Agent | Status | Evidence |
|---|---|---|---|
| — | — | — | — |

---

## Board rules

1. GPT0 is the only editor of this file.
2. Every READY or DISPATCHED row must link to one complete task file under tasks/.
3. Publish a task file to the default branch before setting it to READY.
4. READY means the packet is published but not yet released to the specialist. GPT0 must switch it to DISPATCHED before announcing the start trigger.
5. Keep at most one READY, DISPATCHED, ACCEPTED, or IN_PROGRESS task per specialist so MULAI is unambiguous.
6. Use WAITING for dependent work. Never invite a specialist to start it early.
7. GPT0 updates this board when it dispatches work, when the CEO relays a start/finish signal, or when GitHub evidence is verified.
8. A specialist's SELESAI changes the task to READY_FOR_REVIEW, not APPROVED.
9. Record APPROVED only after GPT0 checks the evidence and acceptance criteria.
10. Record MERGED only after GitHub confirms a CEO-authorized merge.
11. Never delete task history; move completed tasks to Recently verified and preserve their task files.
