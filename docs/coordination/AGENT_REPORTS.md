# Folio Studio — Agent Reports (CEO Dashboard)

**Cycle:** FOLIO-CYCLE-20261121-001  
**Coordinator / editor:** GPT0  
**Product-code baseline:** main @ 49761cd8ca0cd719beb9b84a6becc03dbd2b431f  
**PR #1 pinned main comparison snapshot:** 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1  
**Overall status:** THREE INDEPENDENT AUDITS SUBMITTED — READY_FOR_REVIEW; implementation held  
**Last verified:** 2026-11-21, live GitHub inspection of task packets, PR metadata, comments and compare results

## CEO summary

The cycle's three specialist reports are now present on GitHub and their audited SHAs match the exact SHAs pinned in their task packets and current PR metadata.

| Workstream | Specialist verdict | Evidence | GPT0 disposition |
|---|---|---|---|
| PR #1 foundation | **NOT READY** — GPT3 | [Full report](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059122585) | Keep open as candidate parent; no merge |
| PR #4 Native Command Core Phase 1 | **READY WITH CONDITIONS** — GPT4 | [Full report](https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7058959718) | Preserve implementation; close QA gaps and combined integration |
| PR #5 Workspace Window Management | **READY WITH CONDITIONS** — GPT4 | [Full report](https://github.com/budapesservices-dotcom/folio-studio/pull/5#issuecomment-7058960294) | Preserve implementation; close live drag/resize and harness gaps |
| PR #7 Workspace Preferences V1 | **COMPATIBLE WITH CONDITIONS** — GPT1 | [Full report](https://github.com/budapesservices-dotcom/folio-studio/pull/7#issuecomment-7058956383) | Helper API compatible, but model/persistence adoption blocked; no sync |

All four PRs remain open and unmerged. PR #1 is draft and non-mergeable. None of the specialist verdicts is merge approval. GPT2's remediation reserve remains WAITING, and Native Commands Phase 2 is not authorized.

## Exact-ref reconciliation

| PR | Live HEAD | Task-packet HEAD | Base / dependency | Verified state |
|---|---|---|---|---|
| #1 | `89780034f32b1809cc49640e83bac5c817d88a91` | Same | main; pinned comparison `8d8571cb13da23fb2f39c57cc3d34f556dbf10c1` | Match; open, draft, `mergeable=false` |
| #4 | `9730fdc02f5ee331c17de61c443a0f0d35782c56` | Same | PR #1 @ `89780034...` | Match; open, unmerged; CI #362 pass on exact head |
| #5 | `a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900` | Same | PR #1 @ `89780034...` | Match; open, unmerged; CI #360 pass on exact head |
| #7 | `76eb40426059ed21ce93156c5065835ea3717467` | Same | old PR #5 base `b2d7e9045a150a49852b1f266f95b7424986b64d` | Match; open, unmerged; diverged from latest PR #5 |

Additional live compare confirms PR #7 → latest PR #5 is DIVERGED: merge-base `b2d7e904...`, 23 commits on the PR #5 side and 4 commits on the PR #7 side. The report and task's no-synchronization condition agree.

## Audit findings and remaining gates

### PR #1 — foundation: NOT READY

- The unified project / .flop / AST / Layers / Canvas foundation is directionally aligned with Folio's accepted architecture.
- Confirmed P1 risks at the audited base: Component Canvas master deletion can discard an active local buffer; whole-component synchronization lacks stale-master protection. PR #4 contains the later remediation, but is not integrated into PR #1.
- Main-side same-path additions collide at `AGENTS.md` and `.github/workflows/deploy.yml`; retain main's coordination protocol and reconcile product guidance deliberately.
- Exact-HEAD combined status and PR workflow runs were not found; historical CI and Cloudflare deployment are not exact-head acceptance. Manual browser acceptance is pending.
- PR #4/#5 are both children of this exact PR #1 head and overlap on `src/app/App.tsx` and `src/styles/global.css`.
- GPT3 found and corrected a factual error in its own task packet: PR #2, #3 and #6 merged into `feat/canvas-pan-distribute`, not `main`. Their merge chain culminates at PR #1 HEAD `89780034...`; they are included in the feature branch. PR #8 and #9 are the coordination/recovery PRs merged to main.

**Disposition:** preserve PR #1 as the common candidate parent while GPT0/CEO selects a foundation reconciliation route. Do not merge it as-is.

### PR #4 — Native Command Core Phase 1: READY WITH CONDITIONS

- GPT4 verified CI run #362 on exact HEAD: type-check, 16 test files / 238 tests, and production build passed.
- The report verifies queued and post-open revision fences, before/after durable commit race handling, quota error preservation, write-queue/barrier behavior and callback fencing. Fake IndexedDB tests distinguish staged writes from durable commit and delayed completion.
- Remaining P2 gates: mount the actual App and test the 450 ms autosave effect across a revision change; add real-browser IndexedDB integration evidence for native transaction timing/durable reads; perform App browser acceptance of component delete/recovery flows and actual modal/background behavior.
- PR #4 and #5 independently modify `App.tsx` and `global.css`; their separate green CI does not validate combined integration.

**Disposition:** retain its canonical store, guarded component synchronization and durable recovery changes. Address the explicit QA gaps, then integrate before PR #5 so the shared App/CSS areas can be reconciled deliberately.

### PR #5 — Workspace Window Management: READY WITH CONDITIONS

- GPT4 verified CI run #360 on exact HEAD: type-check, 12 test files / 141 tests and production build passed. The Chromium workflow ran the actual Vite-served Preact App, not only fixture CSS, and checked Rack behavior, focus restoration, inert/ARIA, scrolling, geometry at 1280×800 / 360×280 / 240×180, and Main/Component Canvas stacking.
- Remaining P2/P3 gates: live App drag/resize coverage for edges/corners and viewport changes during pointer sessions; assert the Chromium process-group cleanup result; replace remaining fixed sleeps with condition polling.
- The audit did not independently claim a visual pass on the Cloudflare preview.

**Disposition:** integrate after PR #4, preserving panel/window identities, stacking, focus and compact-viewport work. Manually reconcile App/CSS and run combined tests/browser acceptance.

### PR #7 — Workspace Preferences V1: COMPATIBLE WITH CONDITIONS

- GPT1 confirms its imported window-manager helper APIs remain compatible with PR #5 HEAD.
- Persistence-model conditions remain: shared stack targets include panels while the adapter's stack order records windows only; focused stack target differs from active editor context; minimized-window semantics require a decision; Inspector visibility is outside current adapter coverage.
- App adoption is blocked until the legacy localStorage readers/writers are retired as part of the same coordinated hydration/reconciliation change. Supply the real viewport; do not rely on the 1280×800 fallback.
- V1 cross-tab policy is last successful write wins, not CAS; keep this limitation explicit.
- PR #7 is still based on old PR #5 SHA `b2d7e904...` and is diverged from latest PR #5. No branch synchronization is authorized.

**Disposition:** leave PR #7 untouched until PR #5 is accepted and its base is settled. Then prepare a separate schema/behavior integration packet before any sync or App adoption.

## Recommended resolution plan

1. **CEO foundation decision first.** Choose whether to keep PR #1 as the common parent and reconcile it in place, or supersede/split it into a smaller promotion candidate. GPT3 recommends keeping it open as the parent while reconciling; its non-mergeable status and main-side file collisions mean the route must be explicit.
2. **Foundation reconciliation.** Preserve the PR #1 product work and the merged-into-feature specs from PR #2/#3/#6; retain current main coordination instructions in `AGENTS.md`; reconcile the deploy workflow; update the PR description/spec-status records. Produce one exact candidate SHA and rerun exact-head CI plus manual product acceptance.
3. **Close PR #4 QA gaps.** Add the App-mounted autosave revision-race test, native IndexedDB race/durability evidence, and actual browser acceptance of deletion/recovery and dialog behavior. Keep changes narrowly scoped to PR #4.
4. **Integrate PR #4 before PR #5.** Preserve canonical store/persistence and Component Canvas safety. Do not let PR #5's Rack changes overwrite these semantics.
5. **Integrate PR #5 on top of the selected parent + PR #4.** Manually reconcile shared `App.tsx` and `global.css`; add live App drag/resize and viewport-session browser coverage; harden process-group cleanup and polling. Run a combined check/test/build and real-browser regression suite.
6. **Only after PR #4/#5 combined acceptance, reopen PR #7 integration planning.** First settle panel/window stack serialization, focused target vs editor context, minimized-window shells, Inspector visibility, real viewport and legacy-key retirement. Then authorize a normal merge of the approved PR #5 line into PR #7 (GPT1 recommends merge commit rather than rebase/force-push), followed by adapter/App integration tests.
7. **GPT2 remains WAITING.** GPT0 must publish a finding-specific revised task packet naming the exact finding, target branch/PR, allowed paths, start SHA, regression tests and acceptance checks before changing GPT2 to DISPATCHED. Phase 2 stays prohibited.

## Specialist next instructions

| Agent | Instruction now |
|---|---|
| GPT1 | Audit submitted; await GPT0/CEO direction. Do not synchronize PR #7 or start App integration. |
| GPT2 | Remain WAITING. No code/tests, no Phase 2, and do not self-select a finding. |
| GPT3 | Audit submitted; hold. Re-audit only when GPT0 supplies a new exact candidate SHA and packet. |
| GPT4 | Audit submitted; hold. Perform follow-up QA only against an explicitly pinned integrated PR #4/#5 candidate. |

## CEO decisions required

1. **Foundation route:** retain PR #1 as the common parent and reconcile it, or supersede/split it into a smaller promotion candidate.
2. **Preferences scope:** confirm whether Inspector visibility belongs in Workspace Preferences V1 and define persisted focus semantics for panels vs active editor, alongside minimized-window behavior.
3. **Engineering authorization:** after selecting the route, authorize GPT0 to issue narrow GPT2 remediation packets for the PR #4 and #5 QA gaps. This does not authorize Phase 2 or merge.

## Repository actions and authority

- GPT0 updated only coordination records: corrected the PR #1 audit task packet, and synchronized `TASK_BOARD.md`, `AGENT_STATE.md`, and this CEO dashboard.
- GPT0 did not change product source/tests, PR bases, branch refs, merge status, approvals or deployments.
- No merge, deploy, Phase 2 implementation or GPT2 start is authorized by these reports.
- Each `READY_FOR_REVIEW` item remains pending GPT0's final review. Do not mark APPROVED or MERGED until the relevant criteria and CEO authority are satisfied.
