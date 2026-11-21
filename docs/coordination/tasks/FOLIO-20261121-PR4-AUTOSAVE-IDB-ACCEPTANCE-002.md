# FOLIO STUDIO — GPT2
## PR #4 BASE REFRESH + AUTOSAVE / NATIVE INDEXEDDB ACCEPTANCE

**Task ID:** FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-002  
**Assigned agent:** GPT2 — Engineer  
**Mode:** IMPLEMENTATION  
**Status:** APPROVED  
**Priority:** P1  
**Cycle ID:** FOLIO-CYCLE-20261121-001

Repository: budapesservices-dotcom/folio-studio  
Task file: docs/coordination/tasks/FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-002.md  
Evidence destination: https://github.com/budapesservices-dotcom/folio-studio/pull/4  
Implementation branch: feat/native-command-core-phase1  
Exact starting PR #4 HEAD: 9730fdc02f5ee331c17de61c443a0f0d35782c56  
Exact foundation sync target: feat/canvas-pan-distribute @ edb0cc155d87c7580e6d5713935b873402a5182f

### Objective

Preserve PR #4's implementation, refresh it against the latest approved foundation with an ancestry-preserving two-parent merge commit, and close the actionable App-mounted autosave / real-browser IndexedDB evidence gap without starting later Native Commands phases.

### Authoritative preflight / current refs

- GPT0 fresh exact-ref preflight report is posted on PR #4: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7061699937
- Foundation branch `feat/canvas-pan-distribute` currently resolves to `edb0cc155d87c7580e6d5713935b873402a5182f`.
- PR #4 branch `feat/native-command-core-phase1` currently resolves to `9730fdc02f5ee331c17de61c443a0f0d35782c56`.
- PR #4 remains open and unmerged.
- Exact comparison foundation `edb0cc1...` → PR #4 `9730fdc...`: DIVERGED, PR #4 side 98 ahead / foundation side 96 ahead, merge-base `89780034f32b1809cc49640e83bac5c817d88a91`.
- GitHub's current PR #4 API reports `mergeable=true`, `mergeable_state=clean`.
- The foundation delta contains 21 changed paths; PR #4 contains 26. Their changed-path intersection is empty. The foundation delta is coordination/agent-template/AGENTS content, not product source or tests.
- PR #4 / PR #5 overlap is exactly `src/app/App.tsx` and `src/styles/global.css`. PR #5 and PR #7 must remain untouched until PR #4's remediation and QA gate are complete.
- PR #1 stays open/draft/unmerged to main. No merge of PR #4 into the foundation is authorized by this task.

### Accepted QA findings to close

GPT4 independent audit report: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7058959718

1. **P2 — Mounted App autosave effect:** the actual `App.tsx` Main Canvas autosave schedules after 450 ms and fences callbacks, but existing tests cover the adapter and generic debounce independently. There is no App-mounted test verifying the actual Preact effect/dependency sequence across a revision change, including while a save is pending.
2. **P2 — Native IndexedDB behavior:** current race tests use a custom fake IndexedDB. They model staged writes, rollback, durable commit and delayed completion-event delivery, but do not prove native browser transaction timing or durable reads.
3. **Separate QA gate — Component deletion/recovery browser acceptance:** the actual App browser scenarios for Cancel, save-as-new, discard, CAS staleness, failure/retry, and modal/background focus remain pending. Make the acceptance checklist explicit for GPT4. Do not claim those scenarios pass in this implementation task.

### Dependencies / release

- GPT0 has completed a fresh read-only preflight and recorded **APPROVE SYNC WITH CONDITIONS** in the linked PR #4 comment.
- The CEO sent `LANJUT` in the GPT0 coordinator conversation. GPT0 has therefore released this exact packet as DISPATCHED.
- GPT2 may start after receiving the short `MULAI` signal in the GPT2 specialist conversation. Do not wait for the superseded GPT1 packet 002; its foundation SHA `d585bc3...` became stale when the authorized deploy workflow fix advanced the foundation to `edb0cc1...`. GPT0 performed and posted the refreshed exact-ref preflight instead.
- If any exact branch ref has moved since this packet was written, stop before writing and report BLOCKED.

### Scope

Allowed implementation paths:
- `src/app/App.tsx`
- `src/app/debouncedAutosave.ts`
- `src/core/persistence/indexedDb.ts`
- `tests/nativePersistence.browser.test.mjs` (new)
- `tests/indexedDb.test.ts`
- `docs/ACCEPTANCE_TESTS.md`

The base-refresh merge commit may import the already-approved foundation tree as a separate two-parent integration commit. No additional unrelated path edits are permitted.

Out of scope:
- PR #5 / PR #7 synchronization or edits.
- Phase 2 document/layer commands, Phase 3 Component Command Bridge, batch commands, UI command migration, Node Logic, Multi-Application, .flop v2, IndexedDB schema/version changes, new project stores, and unrelated refactors.
- Changes to package dependencies, package scripts, CI workflows, source paths outside the allowlist, or deployment configuration.
- PR merge, main update, deployment, or direct product-branch merge.

### Required implementation

#### A. Safe base refresh

1. Immediately re-fetch the live refs for `feat/native-command-core-phase1` and `feat/canvas-pan-distribute`.
2. Require exact start refs `9730fdc02f5ee331c17de61c443a0f0d35782c56` and `edb0cc155d87c7580e6d5713935b873402a5182f`.
3. Create a normal two-parent merge commit on the existing PR #4 branch, with **first parent = PR #4 start HEAD 9730fdc...** and **second parent = foundation edb0cc1...**. Preserve all PR #4 history. Do not squash, rebase, cherry-pick, force-push, retarget the PR, or sync PR #5.
4. Use a lease/expected-head guard when updating the branch. If either ref moved, Git reports a conflict, GitHub's clean mergeability changed, or the resulting tree contains unexpected paths, stop and report BLOCKED. Do not improvise conflict resolution.

#### B. Mounted App autosave integration

5. Add a real Chromium browser test which mounts the actual Preact `App`, not only the autosave helper. Verify the Main Canvas 450 ms effect/dependency sequence and save status.
6. Cover a canonical revision change while the debounce is pending and a newer canonical revision while a save is pending. Verify that only the latest canonical snapshot is eventually durable and an old callback cannot replace the current `saving` / `saved` / `error` status.
7. Keep Component Canvas autosave isolated from the canonical Main Canvas revision fence.

#### C. Native-browser IndexedDB check

8. Use real Chromium IndexedDB (not the fake implementation) for a durable read-after-reload check after an App autosave.
9. Exercise deterministic stale-revision behavior during transaction activity/completion where native-browser timing allows. Distinguish an abort before durable commit from a revision change after durable commit; never claim an already committed transaction can be rolled back.
10. Retain existing fake IndexedDB race tests and their explicit staged-write / commit semantics. Do not describe fake tests as native-browser evidence.
11. Reuse the dependency-free Vite / Node / Chromium / CDP pattern from `tests/workspaceGeometry.browser.test.mjs` as a design reference, but add only `tests/nativePersistence.browser.test.mjs` on PR #4. Do not copy or modify PR #5 files. The test must actually run; a skip or unavailable Chromium must be reported as NOT RUN, never PASS.

#### D. Manual QA checklist handoff

12. Review `docs/ACCEPTANCE_TESTS.md` and ensure GPT4's separate manual App/browser acceptance scenarios are explicit:
   - Cancel preserves original master and local buffer.
   - Save-as-new durably stores the recovery component before CAS deletion.
   - Stale CAS keeps both recovery copy and original master.
   - Failed recovery persistence never attempts deletion.
   - Failed deletion persistence never clears the local buffer.
   - Discard clears the buffer only after durable deletion.
   - Modal focus trap, background inertness, Escape/Tab behavior and focus return.
13. Do not claim that these manual Component deletion/recovery cases passed; GPT4 owns that independent acceptance gate after implementation.

#### E. Preserve invariants and verify

14. Preserve: accepted project mutation increments `projectRevision` exactly once; stale/no-op/rejected changes do not; canonical Main Canvas store is the only project mutation authority; Component Canvas remains a local buffer; IndexedDB stays v2; no silent stale overwrite; history remains bounded at 60.
15. On the exact final PR #4 HEAD, run `npm run check`, `npm run test`, and `npm run build`. Confirm the focused browser test really executed.
16. Post GPT2's full implementation report as a top-level PR #4 comment with exact before/after SHAs, two-parent ancestry, changed files, test results (including executed/skipped browser status), CI run, and remaining GPT4 manual acceptance items.

### Acceptance criteria

- [ ] Live refs re-confirmed immediately before writing.
- [ ] Safe two-parent refresh: first parent `9730fdc...`, second parent `edb0cc1...`; no history rewrite.
- [ ] Actual Preact App autosave path mounted and exercised in Chromium.
- [ ] Revision changes during the 450 ms delay and while a write is pending cannot persist stale state or let stale callbacks override current status.
- [ ] Real native-browser IndexedDB durability/read-after-reload check performed; unsupported race coverage explicitly separated as a manual gate.
- [ ] Existing fake IndexedDB race tests retained and not misrepresented.
- [ ] Component deletion/recovery manual acceptance steps remain explicit for GPT4; no browser success is fabricated.
- [ ] `npm run check`, `npm run test`, and `npm run build` pass on exact final PR #4 HEAD; browser execution status recorded honestly.
- [ ] Changes remain within the allowlist; PR #4 stays open and unmerged.

### Validation

On the exact final PR #4 HEAD:
- `npm run check`
- `npm run test`
- `npm run build`
- Confirm `tests/nativePersistence.browser.test.mjs` actually executed under Chromium.
- Inspect complete diff/scope and verify the two-parent merge ancestry.

### Stop conditions

Stop and report BLOCKED if an exact ref moved, mergeability changes, the sync conflicts, unexpected files enter the merge tree, browser testing needs an out-of-scope dependency/script/workflow change, or the task cannot satisfy the invariants. No PR merge, main update, deployment, PR #5/#7 sync, history rewrite, or Native Commands Phase 2/3.

### Final chat response

Start: DITERIMA — FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-002 — mulai dikerjakan.  
Finish: SELESAI — FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-002 — PR #4 COMMENT LINK — menunggu GPT0.  
Blocker: BLOCKED — FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-002 — ONE-LINE BLOCKER.


## GPT0 implementation review disposition — 2026-11-21

**APPROVED as an implementation deliverable; PR #4 is not approved for merge.** GPT0 independently verified:
- Exact final HEAD `4555a46160fe7c57342e976e06b26a8f8859ed77` and current PR #4 open/unmerged status.
- Two-parent sync commit `94bd1aeeeacde491c4ae0ce40e67138e3595e5ff` with the required parent order: PR #4 start `9730fdc...` first, approved foundation `edb0cc1...` second.
- Exactly two post-sync changed paths: `tests/nativePersistence.browser.test.mjs` and `docs/ACCEPTANCE_TESTS.md`; no production source, manifest, script, dependency or workflow changes.
- Exact-head CI run #539 succeeded; 17 files / 239 tests and exact job log shows 1 native Chromium test executed (~21.1s), not skipped; build passed.

Review comment: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7061990741

GPT4's independent manual browser gate remains open for Component Canvas delete/recovery and modal behavior. No PR merge, deploy, PR #5/#7 sync, or Native Commands Phase 2/3 is authorized by this approval.
