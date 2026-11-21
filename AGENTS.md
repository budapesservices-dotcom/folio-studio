# Folio — Repository Instructions

These instructions govern repository work. Folio's CEO communicates outcomes directly to the active Codex session.

## Sole operating model

- Codex is the only default coordinator and engineering interface for Folio.
- Do not use a separate numbered-role roster, chat activation/recovery signals, mandatory handoff chain, or specialist task-board workflow.
- Codex may use its available tools or native subagents when they materially improve execution. These are implementation choices, not separate operating authorities or fixed role identities.
- The CEO should not have to relay technical reports or coordinate routine task dispatch between AI sessions.

## Execution default

- Prefer implementation and measurable product progress over repeated audits, planning documents, status checks, or coordination overhead.
- Inspect the live repository, current branch, exact base commit, open PRs, dependencies, and relevant Folio specifications before changing files. Treat stale documents and chat summaries as non-authoritative.
- Choose the smallest high-value, unblocked vertical slice. Implement production behavior and the tests needed to prove it.
- Do not stop after proposing a plan when the task is sufficiently specified and safe to execute.
- Avoid duplicate implementations. Extend existing engine boundaries and preserve the Unified Project Model and Native Engine First direction.
- Keep work bounded, modular, reviewable, and compatible with existing branches. One writer per mutable worktree/scope at a time.

## Git and authority boundaries

- Use a dedicated branch from the verified base SHA for implementation.
- Never force-push, rewrite another branch, overwrite uncommitted work, or silently rebase an existing PR.
- Do not commit product changes directly to `main`.
- Do not modify, rebase, merge, close, or retarget PR #4, #5, or #7 without explicit CEO authorization.
- Do not merge PRs, deploy, change repository or Cloudflare settings, modify secrets/access, or perform destructive data operations without explicit CEO approval.
- Open a draft PR when the candidate is coherent and reviewable. A draft PR is not approval to merge or deploy.

## Validation and reporting

- Run relevant checks at meaningful implementation milestones. Report exact commands and actual results; never claim a check ran when it did not.
- Inspect the final diff, changed paths, branch ancestry, and commit SHA before handoff.
- Add or update regression tests for changed behavior. Keep unrelated findings out of scope unless they create a material safety or correctness risk.
- Report only durable facts: what changed, exact branch/commit/PR, checks actually run, known limitations, and the next concrete action.
- If blocked, state the specific unavailable capability or failed precondition and the smallest action needed to unblock. Do not replace execution with repeated status narration.

## Folio product invariants

- Product name: Folio. Project container extension: `.flop`.
- Preserve Native Engine First, the Unified Project Model, typed engine boundaries, modularity, and the accepted Designer/Developer integration rules.
- Prefer lightweight, incremental implementations and reuse mature foundations where appropriate.
- Do not reverse material product or architecture decisions without CEO direction.
