# Folio Studio — Codex Orchestration V1

**Status:** Operating guidance  
**Scope:** Repository task coordination; this document does not change Folio product architecture.

## Operating model

The CEO's primary interface for repository work is one Codex coordinator. The coordinator owns task intake, reads the task packet and relevant specifications, inspects live GitHub state, verifies the target branch and exact base SHA, checks dependencies, and plans bounded work. It delegates implementation and specialist analysis to native subagents using the GPT1–GPT4 role profiles in [AGENT_IDENTITY.md](AGENT_IDENTITY.md). Separate GPT conversations remain an optional fallback when native delegation is unavailable; the existing wake and recovery procedure is documented in [RECOVERY_PROTOCOL.md](RECOVERY_PROTOCOL.md).

The coordinator tracks status, gathers each agent's report and evidence, checks scope and acceptance criteria, and maintains one concise CEO-facing summary. The CEO does not need to shuttle task packets or technical reports among specialist conversations.

## Task contract and lifecycle

Every task receives a unique ID and a durable GitHub task packet. Before dispatch, the coordinator records:

- a specific goal and measurable result;
- repository, target branch, and exact starting base commit SHA;
- dependencies and conditions to begin;
- exact allowed paths and forbidden paths;
- deliverables, acceptance criteria, and required checks;
- evidence destination, permissions, stop conditions, and no-merge/no-deploy boundary.

The coordinator verifies that the base SHA and dependencies remain valid before work starts. If the base has moved or a dependency is unmet, stop and refresh the task rather than guessing. Each worker reports meaningful progress and completion to the coordinator; the coordinator verifies GitHub evidence before updating the CEO summary. Task state and checkpoints belong in GitHub issues, pull requests, and repository coordination records, never only in chat history.

## Writer and reviewer sequence

Until isolated worktrees are demonstrated to be safe, only one agent may write to the repository at a time. A writer works only on its assigned branch and allowlisted paths. The coordinator waits until the writer has stopped, inspects the diff and changed-path allowlist, verifies ancestry and PR metadata, then freezes and records the candidate commit SHA.

Only after that handoff may the coordinator start an independent QA or audit agent. The reviewer receives the frozen SHA, performs read-only inspection, and records findings against that exact commit. It does not edit files or repair findings. If a correction is needed, the coordinator returns it to the single writer; after the writer finishes, the coordinator freezes the new SHA and requests a fresh independent review. Never review a moving branch or overlap QA with an active writer.

Independent read-only analysis that does not overlap a writer may run in parallel when the actual session capacity permits. Capacity is environment-dependent; this protocol makes no fixed concurrency promise.

## Permissions and approval gates

Assume native subagents inherit the coordinator's effective permissions. Delegation does not create a permission boundary. Give every agent only the task scope it needs, name allowed and forbidden paths, limit external actions, and require it to stop on scope, dependency, or evidence conflicts. The coordinator checks each result before acting on it.

Task dispatch authorizes only the ordinary, explicitly listed actions in that task. CEO approval remains required before product PR merges, production deployment, repository settings or secrets changes, destructive data actions, and material changes to product direction. No task or coordinator workflow may override those gates. Preserve Folio's accepted identity, `.flop` extension, and approved product architecture unless the CEO explicitly changes them.

## Evidence and handoff

Use GitHub as the durable source of task status and work evidence. A checkpoint identifies the task, branch and PR or Issue, exact latest SHA, completed work, remaining work, checks actually performed, and next safe action or blocker. The coordinator records the writer's frozen candidate SHA and the independent review's exact inspected SHA, findings, and evidence links. Report a check as passed only when its result is available. The CEO-facing summary links to the durable record and distinguishes verified results from pending or unverified work.

## GPT specialist profiles and fallback

GPT1 (architect/preflight), GPT2 (engineer), GPT3 (QA/UI/regression), and GPT4 (independent auditor) describe reusable skills and boundaries for native subagents. GPT4's audit remains independent from implementation; no agent approves its own work. If native subagents cannot be used, the coordinator may fall back to the established GPT conversation workflow: publish the task on the default branch, have the CEO send the named chat its short `MULAI`/`LAKSANAKAN` signal, and use `PULIHKAN` for recovery. The fallback retains the same task, SHA, scope, evidence, writer/QA sequence, and CEO approval gates.
