# Folio Native Codex Orchestration V1

**Status:** ACTIVE — default for normal Folio repository work
**Coordinator:** local Codex parent session attached to the Folio workspace
**Companion protocol:** [PROTOCOL.md](PROTOCOL.md)

## 1. Default model

The CEO works through the local Codex coordinator. The coordinator is the
primary repository interface and uses actual native child subagents for bounded
work. GPT1–GPT4 are reusable specialist profiles, not separate CEO-managed
chats by default:

| Profile | Use |
|---|---|
| GPT1 — Architect / Preflight | Read repository state, architecture, dependencies, and exact bases |
| GPT2 — Engineer | Make one bounded implementation/documentation change on a dedicated branch |
| GPT3 — QA / UI / Regression | Read-only checks of a frozen candidate SHA |
| GPT4 — Independent Auditor | Independent read-only audit of candidate and evidence |

The former GPT0 Chief-of-Staff and GPT-chat task-inbox method is a
legacy/fallback route only. It may be used only when native orchestration is
unavailable and the CEO explicitly selects it.

## 2. Parent and child permissions

The coordinator verifies its local workspace, effective permissions, repository
remote, clean tree, live default branch, exact base SHA, and relevant open PRs
before any write. A child inherits the parent's permissions and cannot elevate
them. If a native child cannot perform its bounded assignment under that
permission boundary, stop and record the actual error; do not relabel an
AO/remote worker or separate GPT chat as a native child.

## 3. Single-writer candidate lifecycle

1. The coordinator gives one native writer a bounded scope, exact base SHA,
   branch name, allowed/forbidden paths, checks, evidence destination, and
   stop conditions.
2. The writer alone creates a dedicated branch from that exact SHA, edits only
   allowed paths, validates the complete diff, commits, and hands back its
   actual identity, branch, base/candidate SHAs, changed paths, and checks.
3. The coordinator independently checks lineage, complete diff, path scope,
   commit subject, and required checks. It pushes only what the task permits
   and creates a draft PR only when its evidence is ready.
4. The coordinator freezes the exact candidate SHA. Branch names are not a
   substitute for a freeze because they can move.
5. One different native QA child then reviews that frozen SHA in read-only
   mode. Writer and QA never overlap.
6. If QA requests a correction, the same writer creates the next candidate;
   the coordinator repeats the inspection, freeze, and fresh independent QA.

No child self-approves, merges, deploys, changes settings, or changes a
protected/default branch.

## 4. Deployment and provider stop conditions

If a task requires a deployment-skip commit prefix, the writer and coordinator
verify the exact prefix before push. The coordinator then uses actual provider
or GitHub deployment/status evidence to confirm the result; a missing check by
itself is not proof of a skip. If a prohibited preview or production deployment
starts, stop immediately. Do not push another commit, modify provider settings,
or try a workaround without a new CEO instruction.

## 5. Evidence and approval gates

Record on the authorized Issue and draft PR: child identities and handoffs,
base/candidate SHA, branch, changed paths, commit subject, exact checks and
results, deployment/status evidence if relevant, QA verdict, limitations, and
next safe action. The coordinator must distinguish confirmed facts from
unverified risks.

CEO approval remains mandatory for merges, deployments, repository/Cloudflare
settings, secrets/access, destructive actions, material architecture or product
direction changes, and other high-impact decisions. Folio's architecture and
stage gates remain unchanged by this workflow.

## 6. Native-child stop conditions

Stop before a repository write when the exact base is stale, the tree is dirty,
the permitted branch/scope cannot be established, native-child capability or
permissions cannot be verified, or an instruction conflicts with the approved
architecture. Stop after a write when a forbidden path appears, required
validation fails outside scope, provider deployment violates a task stop
condition, candidate SHA cannot be frozen, or independent exact-SHA QA cannot
be performed.

## 7. Legacy GPT-chat fallback

This section is not the normal workflow. When explicitly selected by the CEO
because native local Codex orchestration is unavailable, the old GPT0 task
publication, CEO `MULAI`/`LAKSANAKAN` wake signal, specialist acceptance and
completion handoff, and `PULIHKAN GPTN` recovery procedure may be used. It must
still preserve one writer, least privilege, exact-SHA QA, durable GitHub
evidence, and all CEO approval gates.
