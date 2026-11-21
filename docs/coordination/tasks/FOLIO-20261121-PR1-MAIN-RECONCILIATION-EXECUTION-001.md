# FOLIO STUDIO — GPT2
## PR #1 MAIN → FOUNDATION RECONCILIATION EXECUTION

**Task ID:** `FOLIO-20261121-PR1-MAIN-RECONCILIATION-EXECUTION-001`  
**Assigned agent:** GPT2 — Engineer  
**Mode:** IMPLEMENTATION — controlled integration branch only  
**Status:** READY  
**Priority:** P0  
**Cycle ID:** `FOLIO-CYCLE-20261121-001`

**Repository:** `budapesservices-dotcom/folio-studio`  
**Task file:** `docs/coordination/tasks/FOLIO-20261121-PR1-MAIN-RECONCILIATION-EXECUTION-001.md`  
**Evidence destination:** New draft PR targeting `feat/canvas-pan-distribute` (the head branch of PR #1); include this Task ID and packet link in its title/body.  
**Target branch:** `feat/canvas-pan-distribute`  
**Exact target/base SHA:** `89780034f32b1809cc49640e83bac5c817d88a91`  
**Pinned main snapshot to merge:** `df08c279f9ddc77b3fed180bcd9913e641ddfe2d`  
**Integration branch:** `agent/GPT2/FOLIO-20261121-PR1-MAIN-RECONCILIATION-EXECUTION-001`

> Status READY means published but not released. Do not start until GPT0 sets DISPATCHED and the CEO sends MULAI/LAKSANAKAN in the GPT2 conversation. A separate explicit CEO authorization for branch synchronization is also required before any branch creation, push, or merge-commit work.

### Objective
Create a reviewable two-parent merge candidate that brings the pinned main snapshot into PR #1's foundation branch, manually resolving only the two preflight-confirmed add/add conflicts while preserving the active GPT coordination protocol and Folio-specific engineering guardrails. Do not merge the resulting PR into the foundation branch.

### Context and authoritative references
- GPT0-approved read-only preflight: [PR #1 report](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059413863).
- PR #1 foundation HEAD at task preparation: `89780034f32b1809cc49640e83bac5c817d88a91`.
- Pinned main source snapshot: `df08c279f9ddc77b3fed180bcd9913e641ddfe2d`.
- Verified merge-base: `cce72029e35b902c2ccd1644ec762d269c7ff97e`.
- Main changes since the pinned product comparison snapshot touch only `docs/coordination/**`. Relative to the common merge-base, main also contributes `.github/ISSUE_TEMPLATE/agent-task.yml` and `.github/PULL_REQUEST_TEMPLATE.md` as main-only additions, plus the two expected add/add conflicts. Preserve the templates and coordination files from pinned main.
- Feature `.github/workflows/ci.yml` includes both `main` and `feat/canvas-pan-distribute` push triggers. Preserve it.
- Main `.github/workflows/deploy.yml` adds `cache: npm` under `actions/setup-node@v4 > with`; feature deploy configuration is otherwise the desired configuration.
- Main `AGENTS.md` owns current GPT identities, dispatch, task status, permissions, evidence, and no-unapproved-merge/deploy rules. Feature `AGENTS.md` owns Folio-specific product architecture, engineering guardrails, source-of-truth distinctions, execution rules, and task summaries. Compose both without contradictory duplicate authority.

### Dependencies
- Depends on `FOLIO-20261121-PR1-MAIN-RECONCILIATION-PREFLIGHT-001` — APPROVED by GPT0.
- PR #1 remains the common foundation parent. Do not retarget or synchronize PR #4/#5/#7.
- Start only after GPT0 dispatches this task, the CEO sends MULAI/LAKSANAKAN, and a separate explicit CEO authorization for this branch synchronization is recorded. If authorization is absent, stop BLOCKED before any branch mutation.

### Scope and allowed paths
- Create the named integration branch from the exact PR #1 target SHA.
- Merge the exact pinned main SHA into that branch with a normal two-parent merge commit.
- Manually resolve only:
  - `AGENTS.md`
  - `.github/workflows/deploy.yml`
- Verification-only: `.github/workflows/ci.yml`. Confirm the feature push trigger and Node 26 check/test/build steps remain; do not edit it. An unexpected CI conflict is a stop condition.
- Carry the pinned main snapshot's `docs/coordination/**` changes as normal merge content; do not rewrite or selectively drop coordination history.

**Out of scope:** application source, tests, product docs, package manifests/lockfiles, any other manually edited path, PR #4/#5/#7, rebase, squash, force-push, cherry-pick, direct push to the foundation branch, PR merge, deployment, repository settings, secrets, Phase 2, and GPT2's remediation-reserve work.

### Required work
1. Verify live PR #1 is open, draft, unmerged and still at exact head `89780034f32b1809cc49640e83bac5c817d88a91`. Verify pinned main commit `df08c279f9ddc77b3fed180bcd9913e641ddfe2d` is available and ancestry matches the approved preflight. If either ref differs, stop BLOCKED; GPT0 must refresh the packet.
2. Verify the separate CEO authorization before creating/pushing any branch or merge commit.
3. Create the named integration branch from the exact PR #1 base SHA, not from main.
4. Merge the pinned main SHA into the integration branch using a normal non-fast-forward merge commit. No rebase or cherry-pick.
5. Resolve `AGENTS.md`: retain all current main coordination authority and incorporate Folio-specific product/engineering rules from the feature branch. Avoid duplicate or contradictory role, dispatch, permission, and status instructions.
6. Resolve `deploy.yml`: preserve feature branch trigger, Pages permissions, concurrency, build/upload/deploy steps; add `cache: npm` beside `node-version: 24`.
7. Verify `ci.yml` retains both push branches and the existing Node 26 type-check/test/build steps.
8. Inspect the full merge diff. It must contain pinned main's coordination-only history plus the two intentional conflict resolutions, with no unrelated product edits/deletions.
9. Run the exact checks below on the merge candidate and record actual results.
10. Push only the named integration branch and open a **draft PR** targeting `feat/canvas-pan-distribute`. Include both merge parents, candidate SHA, conflict summary, changed-path summary, and actual validation evidence. Do not merge.
11. Post the durable report/checkpoint in that draft PR. Chat reply must be the one-line completion signal.

### Acceptance criteria
- [ ] PR #1 head and pinned main source match this packet before work begins.
- [ ] Separate CEO authorization verified before branch synchronization.
- [ ] Integration branch starts at exact PR #1 SHA and has a normal two-parent merge of exact pinned main SHA, in that parent order.
- [ ] Only the two expected files need manual conflict resolution; any other conflict stops the task.
- [ ] Final `AGENTS.md` preserves main coordination authority and Folio-specific guardrails without contradiction.
- [ ] Final `deploy.yml` preserves feature deployment behavior and includes `cache: npm`.
- [ ] Final `ci.yml` preserves the feature push trigger and existing verification steps.
- [ ] Main-only `.github/ISSUE_TEMPLATE/agent-task.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, and `docs/coordination/**` are preserved unchanged from the pinned source; no unrelated manual source/test/product-doc changes.
- [ ] Local checks pass on exact candidate and GitHub CI is green on exact draft PR HEAD.
- [ ] Draft PR is open against the foundation branch; no merge or deployment occurred.
- [ ] Draft PR contains Task ID, parent SHAs, candidate SHA, resolution summary, changed paths, and actual check evidence.

### Validation
```bash
npm install --no-audit --no-fund
npm run check
npm run test
npm run build
```

Also verify:
- `git show --no-patch --pretty=raw HEAD` has exactly two parents: PR #1 base SHA first, pinned main SHA second.
- `git diff --check <PR1_BASE_SHA>...HEAD` has no whitespace errors.
- Inspect `git diff --name-status <PR1_BASE_SHA>...HEAD` and the full diff; explain expected main-side coordination files and confirm no unexpected product paths.
- GitHub Actions checks are green on the exact draft PR HEAD.

Browser/manual Stage 1 and Stage 2 acceptance are not part of GPT2's implementation claim. GPT0 will arrange separate QA and independent audit before any CEO merge decision.

### Constraints and permissions
- No merge of the draft integration PR or PR #1.
- No deploy, preview publication, or release.
- No push to `main` or directly to `feat/canvas-pan-distribute`; push only the named integration branch.
- No rebase, force-push, cherry-pick, or history rewrite.
- No changes outside the two manual conflict-resolution paths.
- Do not edit Task Board, Agent State, Agent Reports, or any other task packet.
- Do not change PR #1/#4/#5/#7 metadata or bases.
- Do not start Phase 2 or GPT2 remediation-reserve work.
- Never claim a check, browser test, CI run, or deployment succeeded unless its exact result is visible.

### Stop conditions
Stop and report BLOCKED if:
- PR #1 head differs from the pinned target SHA;
- pinned main is unavailable or ancestry no longer matches the approved preflight;
- separate CEO branch-synchronization authorization is absent;
- any conflict appears outside `AGENTS.md` and `.github/workflows/deploy.yml`;
- either expected conflict requires product code, tests, dependency files, or unrelated configuration changes;
- the two AGENTS rule sets cannot be composed without contradiction;
- deployment workflow behavior cannot be preserved;
- validation fails, the draft PR cannot be opened, or exact-head evidence is unavailable.

### Final chat response
Start: `DITERIMA — FOLIO-20261121-PR1-MAIN-RECONCILIATION-EXECUTION-001 — mulai dikerjakan.`  
Finish: `SELESAI — FOLIO-20261121-PR1-MAIN-RECONCILIATION-EXECUTION-001 — PR LINK — menunggu GPT0.`  
Blocker: `BLOCKED — FOLIO-20261121-PR1-MAIN-RECONCILIATION-EXECUTION-001 — alasan spesifik.`

---

## GPT0 pre-publication checklist
- [x] Repository default branch, current Task Board, Protocol, task template, AGENTS.md, and role definitions inspected live.
- [x] Exact PR #1 target SHA pinned from approved preflight.
- [x] Exact main source snapshot pinned to last fully inspected main commit before this packet.
- [x] Both expected conflict files and workflow differences re-inspected.
- [x] Manual edit scope limited to two files; CI workflow is verification-only.
- [x] Dependencies and PR #4/#5/#7 no-touch constraints recorded.
- [x] Evidence destination and validation commands specified.
- [x] Separate CEO authorization gate made explicit; READY does not grant execution permission.
- [x] No branch, PR, application code, test, or deployment configuration was modified by GPT0.


### GPT0 SHA correction note — 2026-11-21

GPT1's preflight comment contains a transcription error in the PR #1 HEAD string. The live GitHub PR API and commit endpoint independently confirm the actual PR #1 head is `89780034f32b1809cc49640e83bac5c817d88a91`. GPT0 reran the exact-ref comparison and the merge-base changed-path intersection against that actual commit. The result remains: merge-base `cce72029e35b902c2ccd1644ec762d269c7ff97e`, PR #1 is 310 commits ahead / 78 behind the pinned main snapshot, and the only intersection of paths changed on both sides is `AGENTS.md` and `.github/workflows/deploy.yml`. The execution packet pins the corrected exact PR #1 SHA.
