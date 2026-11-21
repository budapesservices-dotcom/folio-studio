# Folio — Codex Quick Guide

## Normal workflow

1. The CEO gives the desired outcome directly to the active Codex session.
2. Codex checks the live repository, current branch, exact base SHA, relevant PRs, dependencies, and Folio specifications.
3. Codex selects a bounded, high-value implementation slice and executes it. Prefer production code plus focused regression tests over planning-only output.
4. Codex validates the change, reviews its diff and ancestry, commits it on a dedicated branch, pushes it, and opens a draft PR when appropriate.
5. Codex gives the CEO a short factual result with the branch, commit, PR, checks actually run, and any remaining blocker.

## When changing Codex accounts

The second Codex account is additional capacity, not a separate team or coordinator. Before switching accounts, ensure work is committed and pushed. The next session must inspect the repository and exact remote branch HEAD, then continue from that durable state. Never assume uncommitted local changes or chat context transferred between accounts.

## CEO approval gates

Codex may carry out ordinary scoped engineering and validation. It must stop for explicit CEO approval before merging, deploying, changing repository/Cloudflare settings or secrets/access, destructive data operations, or materially reversing product/architecture direction.

## Working references

- Repository-wide rules: [AGENTS.md](../../AGENTS.md)
- Product architecture: [Architecture](../ARCHITECTURE.md)
- Acceptance coverage: [Acceptance tests](../ACCEPTANCE_TESTS.md)
