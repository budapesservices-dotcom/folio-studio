# FOLIO STUDIO — GPT2
## PR #4 AUTOSAVE / NATIVE INDEXEDDB ACCEPTANCE REMEDIATION

**Task ID:** FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-001  
**Assigned agent:** GPT2 — Engineer  
**Mode:** IMPLEMENTATION  
**Status:** WAITING  
**Priority:** P1  
**Cycle ID:** FOLIO-CYCLE-20261121-001

Repository: budapesservices-dotcom/folio-studio  
Task file: docs/coordination/tasks/FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-001.md  
Evidence destination: https://github.com/budapesservices-dotcom/folio-studio/pull/4  
Implementation branch: feat/native-command-core-phase1  
Exact starting PR #4 HEAD: 9730fdc02f5ee331c17de61c443a0f0d35782c56  
Exact required foundation sync target: feat/canvas-pan-distribute @ d585bc3581aadd335cc4d6292a3d13cb2a650253

### Objective

After GPT1 independently approves the base refresh, preserve PR #4's existing implementation, sync it safely with the newly reconciled foundation, and close the actionable App-mounted autosave / real-browser IndexedDB evidence gap without starting later Native Commands phases.

### Context and authoritative findings

- PR #10 was merged into feat/canvas-pan-distribute as commit d585bc3581aadd335cc4d6292a3d13cb2a650253. PR #1 remains open/draft and is not merged to main.
- PR #4's exact starting head is 9730fdc02f5ee331c17de61c443a0f0d35782c56 on feat/native-command-core-phase1.
- Its comparison with new foundation d585bc3 has merge-base 89780034f32b1809cc49640e83bac5c817d88a91 and is DIVERGED (98 PR #4 commits ahead / 95 foundation commits ahead). This is a branch-refresh requirement, not approval to start before GPT1.
- GPT4 audit report: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7058959718
- GPT4's remaining P2 findings:
  1. The actual App.tsx Main Canvas autosave schedules at 450 ms and fences callbacks, but existing tests cover the adapter and generic debounce separately; no test mounts the actual Preact App and verifies the effect/dependency sequence across a revision change and while a save is pending.
  2. Race tests use a custom fake IndexedDB. They deliberately model staged writes, rollback, durable commit and delayed completion-event delivery, but do not prove native browser transaction timing or durable reads.
  3. App browser acceptance for component deletion/recovery and actual modal/background behavior remains pending. GPT4 owns independent final browser acceptance after this implementation; this task must not claim manual browser acceptance.
- The real App can be exercised in a dependency-free Chromium/Vite harness. PR #5 contains a working pattern in tests/workspaceGeometry.browser.test.mjs: create a Vite server, launch local Chromium via Node child_process, connect using Node WebSocket/CDP, mount the actual Preact App, and use browser-native IndexedDB. PR #5 itself must not be merged or modified in this task.
- Current package scripts use Vitest and do not include a dedicated browser script; a new *.test.mjs is automatically in the Vitest test discovery pattern if implemented correctly. Do not silently claim browser execution when Chromium is unavailable or skipped.

### Dependencies

- Depends on: FOLIO-20261121-PR4-BASE-REFRESH-PREFLIGHT-002 with GPT1 verdict APPROVE SYNC or APPROVE WITH CONDITIONS, followed by GPT0's recorded release of this WAITING task.
- Start condition: remain WAITING until GPT0 updates this packet to DISPATCHED after reviewing GPT1 evidence. Do not inspect for implementation, create commits, or modify branch while WAITING.

### Scope

Allowed implementation paths after dispatch:
- src/app/App.tsx
- src/app/debouncedAutosave.ts
- src/core/persistence/indexedDb.ts
- tests/nativePersistence.browser.test.mjs (new)
- tests/indexedDb.test.ts
- docs/ACCEPTANCE_TESTS.md

The base-refresh merge commit may import the already-approved PR #10 tree as a separate two-parent integration commit, but no additional unrelated path edits are permitted.

Out of scope:
- PR #5 / PR #7 synchronization or edits.
- Phase 2 document/layer commands, Phase 3 Component Command Bridge, batch commands, UI command migration, Node Logic, Multi-Application, .flop v2, IndexedDB schema/version changes, new project stores, and unrelated refactors.
- Changes to package dependencies, package scripts, CI workflows, source paths outside the allowlist, or deployment configuration without a separate GPT0 authorization.
- PR merge, main update, deployment, or direct product-branch merge.

### Required work after release

1. Verify PR #4 remains at exact starting HEAD 9730fdc02f5ee331c17de61c443a0f0d35782c56 and the foundation remains at d585bc3581aadd335cc4d6292a3d13cb2a650253. Recheck GPT1's preflight evidence.
2. If and only if GPT1 approves, merge the foundation target into the existing PR #4 branch with a normal two-parent merge commit: first parent the exact PR #4 starting HEAD, second parent the foundation target d585bc3. Do not squash/rebase or rewrite PR #4 history. Use an expected-head guard. If any ref moved or GitHub reports conflicts, stop and report BLOCKED rather than improvising.
3. Add an actual-browser, actual-App integration test that verifies the Main Canvas 450 ms autosave effect/dependency sequence. Cover a revision change while the debounce is pending and a newer canonical revision while a save is pending; verify that only the current snapshot is eventually durable and an old callback cannot replace the current saving/saved status.
4. Add a native-browser IndexedDB check using real Chromium IndexedDB, not the custom fake as evidence. Cover durable read/reload after an App autosave and deterministic stale-revision behavior around transaction activity/completion where the native browser harness permits it. The existing fake tests must remain and must not be described as native browser proof.
5. Reuse the dependency-free Node/Chromium/CDP/Vite approach from PR #5 as a design pattern, but add only tests/nativePersistence.browser.test.mjs on PR #4. Do not copy or modify PR #5 files. A browser skip must be reported as NOT RUN, not PASS.
6. Review docs/ACCEPTANCE_TESTS.md and ensure the manual App-level component deletion/recovery scenarios are explicit for GPT4: Cancel preserves master/buffer; Save-as-new persists recovery before CAS delete; stale CAS preserves recovery and original; failed recovery persistence never attempts deletion; failed deletion persistence never clears buffer; discard clears only after durable delete; modal focus trap, background inertness, Escape/Tab behavior and focus return. Do not claim these browser scenarios passed unless actually exercised.
7. Preserve existing test coverage and invariants: accepted project mutation increments projectRevision exactly once; stale/no-op/rejected changes do not; canonical Main Canvas store remains the only project mutation authority; Component Canvas remains a local buffer; IndexedDB remains v2; no silent stale overwrite; history remains bounded at 60.
8. Post a GPT2 implementation report on PR #4 with exact before/after SHAs, merge parent order, changed files, tests (including browser executed/skipped), CI run, and remaining GPT4 manual acceptance items.

### Acceptance criteria

- [ ] GPT1 preflight approval exists and GPT0 released this task before any write.
- [ ] PR #4 branch refresh preserves original HEAD as first parent and foundation d585bc3 as second parent; no history rewrite.
- [ ] The actual Preact App autosave path is mounted and exercised in Chromium, not merely tested through helper functions.
- [ ] Revision changes during the 450 ms delay and while a write is pending cannot persist stale state or let stale callbacks override current status.
- [ ] At least one native-browser IndexedDB durability/read-after-reload check is performed; any unsupported race check is explicitly recorded as a separate manual QA gate.
- [ ] Existing fake IndexedDB race tests remain unchanged in meaning and are not misrepresented as native-browser tests.
- [ ] Component deletion/recovery and modal manual acceptance steps are clear for GPT4; no browser success is fabricated.
- [ ] npm run check, npm run test, and npm run build pass on the exact final PR #4 head; browser test result and skip reason are recorded.
- [ ] Changes stay within allowed paths; PR #4 remains open/unmerged.

### Validation

Run on the exact final PR #4 HEAD:
- npm run check
- npm run test
- npm run build
- Confirm the focused nativePersistence browser test actually executed with Chromium; otherwise state NOT RUN and preserve the manual QA gate.
- Inspect the final diff for scope and ensure the two-parent refresh ancestry is intact.

### Constraints and stop conditions

Do not start while WAITING. Do not merge PR #4, PR #5, PR #7, or PR #1. Do not deploy. Do not change PR base. Do not rewrite history or force-push. Do not add dependencies/scripts/workflows. Stop and report BLOCKED if GPT1 does not approve, an exact ref moved, branch synchronization conflicts, or real-browser coverage requires out-of-scope dependency/CI changes. Native Commands Phase 2 and Phase 3 remain prohibited.

### Final chat response

Start: DITERIMA — FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-001 — mulai dikerjakan.  
Finish: SELESAI — FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-001 — PR #4 COMMENT LINK — menunggu GPT0.  
Blocker: BLOCKED — FOLIO-20261121-PR4-AUTOSAVE-IDB-ACCEPTANCE-001 — ONE-LINE BLOCKER.
