# FOLIO STUDIO — GPT2
## COMPONENT CANVAS DELETION / RECOVERY — REAL APP CHROMIUM ACCEPTANCE

**Task ID:** FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001  
**Assigned agent:** GPT2 — Engineer  
**Mode:** TEST IMPLEMENTATION ONLY  
**Status:** DISPATCHED  
**Priority:** P0  
**Cycle ID:** FOLIO-CYCLE-20261121-001

Repository: budapesservices-dotcom/folio-studio  
Task file: docs/coordination/tasks/FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001.md  
Evidence destination: https://github.com/budapesservices-dotcom/folio-studio/pull/4  
Implementation branch: feat/native-command-core-phase1  
Exact starting PR #4 HEAD: 4555a46160fe7c57342e976e06b26a8f8859ed77  
Exact foundation: feat/canvas-pan-distribute @ edb0cc155d87c7580e6d5713935b873402a5182f

### Objective

The previous GPT4 manual browser audit is complete but BLOCKED because both supplied Cloudflare preview hosts could not be resolved/opened from its isolated QA environment. GPT0 also attempted to open both exact preview URLs; they were inaccessible through the available web inspection path.

Do not weaken the acceptance gate or infer a pass from source/unit tests. Instead, add a deterministic **actual-App / real-Chromium / native-IndexedDB end-to-end test** that exercises the Component Canvas deletion and recovery UI locally in the same CI environment where the native Main Canvas persistence browser test already runs. This creates a reproducible alternative to the unreachable external preview and allows GPT4 to independently audit one exact SHA.

### Authoritative evidence

- GPT4 blocked audit report: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7062150965
- GPT0 GPT2 implementation review: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7061990741
- Current exact PR #4 HEAD: `4555a46160fe7c57342e976e06b26a8f8859ed77`.
- Current foundation: `edb0cc155d87c7580e6d5713935b873402a5182f`.
- Exact CI on existing head: run #539, 17 files / 239 tests; native browser test ran (not skipped).
- Existing actual-App browser harness and design reference: `tests/nativePersistence.browser.test.mjs`.
- Actual UI entry points at current SHA:
  - Component Rack toggle: `button[aria-label="Open Component Rack"]`
  - Create a master: Component Rack button title `Create a new master component`
  - Component Canvas open: `button[aria-label="Open Component Canvas"]` when closed
  - Create menu: `button[aria-label="Create tools"]`, menu `.tool-rack-menu button[role="menuitem"]`
  - Component Rack card: `.component-rack-card`; Edit Master button title `Edit <component name> master`; Delete button `button[aria-label="Delete <component name>"]`
  - Recovery dialog: `.component-deletion-dialog` with buttons `Cancel`, `Save buffer as a new component`, `Discard buffer and delete`, and retry labels as applicable.
- App implementation reviewed by GPT0 at exact SHA: `src/app/componentDeletion.ts`, `src/app/App.tsx`, `src/app/modalFocus.ts`.

### Dependencies and dispatch

- GPT4's audit task is complete as a report and its verdict is BLOCKED, not READY. GPT0 reviewed the report and independently confirmed both preview URLs are inaccessible via the available web inspection path.
- This GPT2 task is dispatched now against the unchanged exact PR #4 HEAD above.
- Before writing, re-fetch the live branch and PR refs. If PR #4 HEAD is not exactly `4555a46160fe7c57342e976e06b26a8f8859ed77`, stop and report BLOCKED for a refreshed packet.

### Allowed paths

- `tests/componentRecovery.browser.test.mjs` (new)
- `docs/ACCEPTANCE_TESTS.md` (update only the relevant QA gate to record which browser scenarios are now automatically verified and which remain manual)

No other paths are allowed.

### Forbidden

- No changes to application source, production code, persistence adapters, modal code, test helpers outside the new test file, package manifest, lockfile, dependencies, package scripts, CI workflows, Cloudflare configuration, or deployment settings.
- No production behavior changes or test-only runtime hooks added to shipped source.
- No changes to GPT4's task/report or shared coordination files.
- No PR #5/#7 synchronization, PR retarget, rebase, force-push, merge, main merge, deployment, or Native Commands Phase 2/3.

### Required implementation

1. Reuse the dependency-free Node / Vite / headless Chromium / CDP pattern from `tests/nativePersistence.browser.test.mjs`. A small local copy of its isolated browser lifecycle helpers in the new test file is acceptable; do not change the existing test file merely to share helpers.
2. Each browser case must launch a fresh disposable Chromium profile and a fresh Vite App origin, clear only that origin's storage, and close Chromium/Vite plus remove temp files in `finally`. Never use a user browser profile.
3. Mount the actual Preact App. Create a disposable master component via Component Rack UI. Open/Edit Master, make a local Component Canvas edit via the actual Create tools UI, then trigger Delete from the actual Component Rack card. Do not call internal module functions instead of UI event handlers.
4. Use native Chromium IndexedDB v2 (`folio-studio`) to assert durable project records and Component Canvas buffer records. Clearly distinguish the root project record from the reserved component buffer project.
5. Cover these actual UI flows wherever deterministically reachable:
   - Dirty active master → Delete → Cancel. Verify original master and component buffer remain durable, UI remains in Component Canvas, and retrying the Delete action can reopen the recovery dialog.
   - Dirty active master → Save buffer as a new component. Verify the recovery component exists durably, contains the edited buffer graph, and original master deletion plus buffer cleanup occur only after the recovery transaction completes.
   - Dirty active master → Discard buffer and delete. Verify original master is durably removed and the Component Canvas buffer is reset only after durable deletion/cleanup.
   - Clean active master deletion. Verify both project deletion and Component Canvas cleanup barriers complete before the App closes/resets the active Component Canvas.
   - Recovery-copy transaction failure. Intercept only the targeted native IndexedDB transaction in the test page and abort it deterministically; verify no original-master deletion is persisted, original master remains, buffer remains recoverable, and UI reports failure/retry state.
   - Canonical deletion transaction failure after recovery copy is durable. Abort only the deletion transaction; verify original + recovery remain durable, buffer remains, UI offers retry. Then allow retry and verify deletion completes without creating a duplicate recovery component.
   - Cleanup transaction failure after master deletion is durable. Verify recovery + deletion remain durable, component buffer is not cleared, cleanup-pending dialog remains; retry cleanup and verify only buffer cleanup is committed.
6. Use deterministic page-side wrappers around native `IDBObjectStore.prototype.put` or transaction events to inject failures. The wrappers must be test-only, installed in the isolated page before the action, filtered to the precise project record/transaction phase, restored or discarded with the browser profile, and observable through an explicit probe object. Do not claim native transaction failure coverage based only on the fake IndexedDB unit harness.
7. Add a real browser accessibility check on the actual dialog:
   - initial focus enters the dialog;
   - Tab and Shift+Tab stay within it;
   - Escape selects safe Cancel when available;
   - background controls are inert/non-interactive while the dialog is open;
   - focus returns to the invoking Delete button when Cancel closes the dialog.
8. Test stale-master/CAS behavior at the actual App layer if a deterministic race can be induced without production hooks. If not safely inducible because the canonical mutation lease serializes the operation, report that limitation explicitly and cite the existing componentDeletion unit test that covers stale CAS; do not fake a pass.
9. Test failure/retry followed by App reload in the same disposable origin. Confirm the last durable canonical project and Component Canvas buffer are restored from native IndexedDB without silent loss.
10. Each scenario must produce a structured result/assertion. Never convert an unavailable Chromium binary to a passing skip. The test must fail with a clear diagnostic in CI if a required browser scenario is skipped or not executed.
11. The test suite must stay deterministic and avoid long fixed sleeps; use observable DOM, IDB transaction events and bounded polling. Ensure CDP, Chromium process-group, Vite and temp profile cleanup on success and failure.
12. Update `docs/ACCEPTANCE_TESTS.md` to separate:
   - browser-automated component recovery scenarios that have actually been implemented and run;
   - stale-CAS limitation if uninjectable at App level;
   - any still-manual or unsupported cases.
13. Post a GPT2 implementation report on PR #4 with exact start/final SHAs, changed paths, list of actual browser scenarios, Chromium test count/duration, native IndexedDB evidence, exact CI run, all NOT RUN/limited scenarios, and remaining GPT4 independent review needs.

### Validation

Run on the exact final PR #4 HEAD:
- `npm run check`
- `npm run test`
- `npm run build`

Inspect GitHub Actions logs and explicitly confirm `tests/componentRecovery.browser.test.mjs` ran. If the CI environment lacks Chromium, stop and report BLOCKED; do not make it pass by skipping.

### Acceptance criteria

- [ ] Exact PR #4 starting HEAD and foundation are re-fetched and match this packet.
- [ ] The real Preact App is mounted in headless Chromium from Vite.
- [ ] Component Rack / Component Canvas actions use actual UI controls and real event handlers.
- [ ] Native IndexedDB v2 record assertions confirm recovery, delete and buffer durability ordering.
- [ ] Recovery failure, deletion failure/retry, cleanup failure/retry are tested with deterministic native transaction aborts.
- [ ] Cancel, save-as-new, discard, clean deletion, and modal keyboard/focus/inert behavior are covered.
- [ ] Stale CAS is tested at App layer or explicitly recorded as not deterministically injectable; existing unit coverage must be cited.
- [ ] Reload recovery uses the same real browser origin and native IndexedDB.
- [ ] Browser test is genuinely executed in exact-head CI; no silent skip.
- [ ] Only the two allowlisted paths are changed.
- [ ] PR #4 remains open and unmerged; no deployment or other branch changes.

### Stop conditions

Stop and report BLOCKED if actual UI flows cannot be made deterministic without modifying production code, the exact ref moved, native IndexedDB evidence cannot be observed, or Chromium is unavailable in CI. Do not widen scope, add dependencies/scripts/workflows, modify production source, or claim untested manual behavior.

### Final chat response

Start: DITERIMA — FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001 — mulai dikerjakan.  
Finish: SELESAI — FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001 — PR #4 COMMENT LINK — menunggu GPT0.  
Blocker: BLOCKED — FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001 — ONE-LINE BLOCKER.
