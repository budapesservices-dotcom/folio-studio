# Folio CEO Quick Guide — Codex Coordinator

## Default: work through the local Codex coordinator

For normal repository work, open the local Codex session attached to Folio and
state the outcome you want. The Codex coordinator is the CEO's primary and
default repository interface.

The coordinator verifies the live repository, scope, exact base SHA,
dependencies, and risks. It then invokes reusable native specialist profiles
when useful:

- **GPT1 — Architect / Preflight** for architecture and compatibility work.
- **GPT2 — Engineer** for a bounded implementation or documentation change.
- **GPT3 — QA / UI / Regression** for read-only validation of an exact SHA.
- **GPT4 — Independent Auditor** for independent evidence and risk review.

These are profiles for native child subagents, not separate chats that the CEO
must open or wake. The coordinator owns ordinary dispatch, status collection,
and technical handoff; it keeps the evidence in the task's GitHub Issue or PR.

## What remains a CEO decision

The coordinator proceeds with ordinary, low-risk work within an approved
scope. It stops and asks before a merge, preview/production deployment,
repository or Cloudflare setting change, secret/access change, destructive
action, material architecture/product decision, or other high-impact risk.

No candidate is treated as approved merely because a child says it is done.
The coordinator checks the exact diff, branch ancestry, frozen candidate SHA,
required checks, and independent QA evidence first.

## The normal candidate lifecycle

1. One native writer changes only the allowed paths on a dedicated branch from
   the exact base SHA.
2. The coordinator inspects the commit and freezes its exact SHA.
3. A different, read-only native QA child reviews that exact SHA, not a moving
   branch.
4. If correction is needed, the same writer produces a new candidate; the
   coordinator freezes it and obtains fresh independent QA.
5. Only then does the coordinator open/update the authorized draft PR and
   record evidence. No merge or deployment follows without CEO approval.

## Legacy fallback: separate GPT chats

The old GPT0 Chief-of-Staff / Task Inbox workflow is retained only if native
Codex orchestration is unavailable and the CEO explicitly selects this fallback.
It is not the normal way to operate Folio.

In that fallback, GPT0 publishes a task packet and the CEO may open the named
GPT1–GPT4 chat and send `MULAI` or `LAKSANAKAN`. A replacement fallback chat
uses `PULIHKAN GPTN — REPOSITORY: https://github.com/budapesservices-dotcom/folio-studio`.
The specialist reads the packet, stores evidence in GitHub, and returns a
short status signal. Never copy technical reports between chats.

## Working links

- [Native Codex orchestration](CODEX_ORCHESTRATION_V1.md)
- [Protocol](PROTOCOL.md)
- [Task Board](TASK_BOARD.md)
- [Agent State](AGENT_STATE.md)
- [CEO report](AGENT_REPORTS.md)
