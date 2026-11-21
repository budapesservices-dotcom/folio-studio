> ARCHIVED HISTORICAL RECORD — not an active instruction, task queue, or source of current status. The former coordination workflow has been retired. Use the repository-root AGENTS.md and live GitHub state for all current work.

# Folio Studio — Persistent Agent State

**Coordinator / sole editor:** GPT0  
**Purpose:** concise repository-backed pointers to each agent's current task and latest durable checkpoint.

## Current cycle

| Field | Value |
|---|---|
| Cycle ID | FOLIO-CYCLE-20261121-001 |
| Last full compare checkpoint | 2026-11-21, comparison main snapshot `c936bbfa6912286e34d7fc8f5fcc40a60c727d8a`; PR #1 is 310 ahead / 93 behind; changed-path intersection only `AGENTS.md` and `.github/workflows/deploy.yml`. Subsequent GPT0 tracking commits on main touch only `docs/coordination/**` |
| Product-code baseline | main @ 49761cd8ca0cd719beb9b84a6becc03dbd2b431f |
| PR #1 comparison snapshot | main @ 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 |
| PR #1 delta at pinned snapshot | 310 ahead / 41 behind; diverged |
| Last PR #1 vs main compare checkpoint | main @ `c936bbfa6912286e34d7fc8f5fcc40a60c727d8a`: 310 ahead / 93 behind; merge-base `cce72029e35b902c2ccd1644ec762d269c7ff97e`; only shared changed paths are `AGENTS.md` and `.github/workflows/deploy.yml` |
| PR #2/#3/#6 merge target | feat/canvas-pan-distribute, not main |
| Main coordination changes | GPT0 updates are restricted to docs/coordination/** |

## Agent state

| Agent | Role | Activation | Current task | Task status | Working branch / PR / Issue | Latest durable checkpoint | Next action / blocker | Last updated |
|---|---|---|---|---|---|---|---|---|
| GPT0 | Coordinator / Chief of Staff | ACTIVE | FOLIO-CYCLE-20261121-001 | IN_PROGRESS | main coordination records | GPT2 PR #4 implementation task approved at `4555a46`; exact CI #539 and Chromium test independently verified; GPT0 review posted | GPT4 post-implementation independent QA dispatched against exact PR #4 HEAD; preserve PR4 → PR5 → PR7 order | 2026-11-21 |
| GPT1 | Architect / Preflight | ACTIVE | — | IDLE | No active task | Prior preflight packet 002 superseded because foundation advanced from `d585bc3` to `edb0cc1` | No work requested; GPT0 performed and recorded fresh exact-ref preflight on PR #4 | 2026-11-21 |
| GPT2 | Engineer | ACTIVE | FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001 | DISPATCHED | [Component recovery browser task](tasks/FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001.md); [PR #4](https://github.com/budapesservices-dotcom/folio-studio/pull/4) | Previous PR #4 task 002 approved; current exact HEAD `4555a46160fe7c57342e976e06b26a8f8859ed77`; CI #539 / native autosave browser test passed | Build actual-App native IndexedDB deletion/recovery/modal browser acceptance; only new browser test + acceptance docs are allowed | 2026-11-21 |
| GPT3 | QA / UI / Regression | ACTIVE | FOLIO-20261121-PR10-CANDIDATE-QA-001 | APPROVED | [QA packet](tasks/FOLIO-20261121-PR10-CANDIDATE-QA-001.md); [PR #10 QA report](https://github.com/budapesservices-dotcom/folio-studio/pull/10#issuecomment-7061223324) | PASS WITH CONDITIONS; exact candidate/CI/scope passed; provider deployment success reported; browser QA NOT RUN because host DNS/page retrieval failed | Report accepted; browser smoke not claimed and remains unverified | 2026-11-21 |
| GPT4 | Independent Auditor | ACTIVE | — | IDLE | No active task | Post-implementation report on PR #4 completed at exact HEAD `4555a46160fe7c57342e976e06b26a8f8859ed77`; verdict NOT READY — BLOCKED because both preview hosts inaccessible | Await new exact-head packet after GPT2 creates actual-App/native IndexedDB browser acceptance tests; then independently review CI and scenario evidence | 2026-11-21 |
| GPT3 | QA / UI / Regression | ACTIVE | FOLIO-20261121-PR1-FOUNDATION-AUDIT-002 | READY_FOR_REVIEW | Read-only audit: PR #1 feat/canvas-pan-distribute | [PR #1 report](https://github.com/budapesservices-dotcom/folio-studio/pull/1#issuecomment-7059122585); exact PR #1 HEAD 89780034f32b1809cc49640e83bac5c817d88a91; pinned main snapshot 8d8571cb13da23fb2f39c57cc3d34f556dbf10c1 | GPT0 review pending; audit verdict NOT READY; no branch or code changes | 2026-11-21 |
| GPT4 | Independent Auditor | ACTIVE | FOLIO-20261121-PR4-PR5-QA-001 | READY_FOR_REVIEW | Read-only audit: PR #4 and PR #5 | [PR #4 report](https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7058959718); [PR #5 report](https://github.com/budapesservices-dotcom/folio-studio/pull/5#issuecomment-7058960294); exact heads 9730fdc... and a8b2818... | GPT0 review pending; both verdicts READY WITH CONDITIONS; no implementation or merge | 2026-11-21 |

## Latest checkpoint — GPT4 manual QA blocked; GPT2 browser-test fallback dispatched

- PR #4 remains OPEN / UNMERGED at `4555a46160fe7c57342e976e06b26a8f8859ed77`; base foundation `edb0cc155d87c7580e6d5713935b873402a5182f`.
- GPT2 implementation task 002 is approved by GPT0. Its exact-head CI #539 passed (17 files / 239 tests), including one native Chromium autosave / IndexedDB browser test actually executed.
- GPT4 report completed against the exact SHA: **NOT READY — BLOCKED**. Both Cloudflare preview URLs failed DNS/navigation in GPT4's isolated environment; GPT0 also could not open either URL using available web inspection.
- All nine manual Component Canvas deletion/recovery/modal scenarios and viewport smoke checks remain **NOT RUN**. No product QA pass is claimed.
- GPT4 assignment is approved as a completed report only; GPT4 is now IDLE. Report: https://github.com/budapesservices-dotcom/folio-studio/pull/4#issuecomment-7062150965.
- GPT2 is DISPATCHED on `FOLIO-20261121-PR4-COMPONENT-RECOVERY-BROWSER-ACCEPTANCE-001` to add a real-App / real-Chromium / native-IndexedDB end-to-end test under the current Vite/CI environment. Allowed paths: new test file and acceptance documentation only; no production code/dependencies/scripts/workflows.
- After GPT2 submits the test, GPT4 must independently inspect its exact-head run and browser evidence. PR #4 stays unmerged; PR #5/#7 remain untouched; Phase 2/3 remain prohibited.

## Historical checkpoint — PR #4 GPT2 implementation accepted; GPT4 QA dispatched

## GPT0 deployment workflow repair — CEO authorized

CEO explicitly authorized the minimal fix after Deploy FOLIO Studio run #62 failed at `actions/setup-node@v4` because `cache: npm` was configured without a lockfile.

Applied on `feat/canvas-pan-distribute`:
- Commit: `edb0cc155d87c7580e6d5713935b873402a5182f`
- File: `.github/workflows/deploy.yml`
- Exact diff: removed only the `cache: npm` line. No dependency, lockfile, build command, deployment target, source, or product code was changed.
- PR #1 remains open/draft/unmerged to `main`.

The expected automatic push workflows have been created for this exact commit:
- [Deploy FOLIO Studio run #63](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44897298913) — SUCCESS; build, artifact upload and deploy all completed.
- [FOLIO verification run #518](https://github.com/budapesservices-dotcom/folio-studio/actions/runs/44897298951) — currently in progress at last check.

Deployment success was verified from completed run #63 and its environment URL.


- PR #10 CLOSED/MERGED into `feat/canvas-pan-distribute` at `d585bc3581aadd335cc4d6292a3d13cb2a650253`; GitHub confirms PR #1 head is now the same SHA. PR #1 remains open/draft/unmerged to main.
- CI run #503 passed on the exact merge commit. Pages Deploy run #62 was triggered by the merge push and failed at `actions/setup-node@v4` because `cache: npm` could not find an npm lockfile; install/build/artifact upload were skipped and the deploy job was skipped. The minimal fix (remove `cache: npm`) is reserved for CEO approval because a fix push will retrigger Pages.
- PR #4 remains at `9730fdc02f5ee331c17de61c443a0f0d35782c56`; PR #5 remains at `a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900`; PR #7 remains stacked on the old PR #5 base. No child PR branch/base updates have occurred.
- GPT1 is DISPATCHED for read-only PR #4 foundation refresh preflight. GPT2's PR #4 autosave/IndexedDB task is published but WAITING on GPT1 and GPT0 release. PR #5 then PR #7 remain later gates; Phase 2/3 remain prohibited.

## Reconciliation notes

> Historical notes below preserve the earlier pre-PR10 checkpoint. Where their PR #1 head, PR #10 state, merge/deploy status, or next-task references conflict with the post-merge checkpoint above, the post-merge checkpoint is authoritative.

- PR #1, #4, #5 and #7 remain open and unmerged. PR #1 is draft and non-mergeable.
- GPT3's audit report is posted on PR #1; it confirms NOT READY and identifies the add/add integration collision in AGENTS.md and .github/workflows/deploy.yml, missing exact-head CI/browser acceptance, and the need to preserve PR #4/#5 remediations.
- GPT4's two reports are posted on PR #4 and PR #5. Both audited exact task-packet HEADs and both return READY WITH CONDITIONS. PR #4 retains App-mounted autosave, native IndexedDB and deletion/recovery browser gaps. PR #5 retains live App drag/resize and harness cleanup/flakiness gaps. The reports identify App.tsx and global.css as shared PR #4/#5 integration paths.
- GPT1's report is posted on PR #7. Helper/API compatibility passes, but complete stack/focus semantics, minimized-window policy, Inspector visibility scope, live viewport use and dual persistence-path retirement must be resolved before App adoption. PR #7 is diverged from latest PR #5 and must not be synchronized yet.
- PR #2 Native Commands V1, PR #3 .flop workflow and PR #6 Workspace Architecture V1 were merged into feat/canvas-pan-distribute, not main. Their merge chain ends at PR #1 HEAD 89780034...; their contents are on that feature branch. PR #8 and PR #9 were merged into main.
- PR #1 task packet 002 was corrected on 2026-11-21 to remove the mistaken assertion that PR #2/#3/#6 were merged into main.
- GPT3 task 001 remains SUPERSEDED; task 002 is now READY_FOR_REVIEW. GPT1 task and GPT4 task are also READY_FOR_REVIEW.
- GPT2 reserve task remains WAITING. No Phase 2 work is authorized.
- CEO selected the recommended integration route: keep PR #1 as the common parent, reconcile main into it deliberately, then PR #4, PR #5 and PR #7 in sequence. This is a strategy decision, not evidence that any branch sync was executed.
- Main is currently 31 commits past the pinned PR #1 audit snapshot; a live compare confirms all 31 touch only docs/coordination/**, so GPT3's pinned product-code audit remains valid. Current live comparison reads 310 ahead / 72 behind; main HEAD is `40a7edce7ab6e159f0dd40efeb9d8b7b2acbead4`.
- No merge, deployment, PR-base change, branch synchronization, source-code change or test change was performed as part of this reconciliation.
- The CEO selected PR #1 as the common parent. GPT1 preflight packet FOLIO-20261121-PR1-MAIN-RECONCILIATION-PREFLIGHT-001 is APPROVED by GPT0; report is posted on PR #1. Approval covers the read-only preflight only, not branch synchronization or merge.

## Status vocabulary

- NOT_ACTIVATED: specialist has not completed initial setup.
- IDLE: no active task is assigned.
- DISPATCHED: one task is released; specialist may begin only after the CEO's start signal.
- ACCEPTED: specialist acknowledged the task; work is not assumed to be underway without a recorded checkpoint.
- IN_PROGRESS: work is underway.
- BLOCKED: work cannot safely continue; blocker is recorded.
- READY_FOR_REVIEW: specialist submitted evidence; GPT0 review is pending.
- APPROVED: GPT0 verified the task against its acceptance criteria.
- MERGED: GitHub confirms a CEO-authorized merge.
- CANCELLED: GPT0 cancelled a task.

## Reconciliation rules

1. Task Board and task packet are authoritative for task assignment and dispatch.
2. GitHub commits, PRs, Issues, comments and checks are authoritative for delivered work and evidence.
3. This dashboard is a convenience index. When it conflicts with live GitHub evidence, GPT0 investigates and corrects it.
4. Activation is separate from task authorization. An ACTIVE specialist still needs a unique DISPATCHED task and the CEO's MULAI/LAKSANAKAN signal before starting.
5. Keep this file concise and do not store secrets, credentials, private data, or raw logs.
