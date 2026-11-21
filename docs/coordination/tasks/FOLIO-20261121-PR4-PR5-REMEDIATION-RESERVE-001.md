# FOLIO STUDIO — GPT2
## PR #4 / PR #5 QA FINDING REMEDIATION RESERVE

**Task ID:** FOLIO-20261121-PR4-PR5-REMEDIATION-RESERVE-001  
**Assigned agent:** GPT2 — Engineer  
**Mode:** CONDITIONAL IMPLEMENTATION — NOT AUTHORIZED TO START  
**Status:** WAITING  
**Priority:** P0  
**Cycle ID:** FOLIO-CYCLE-20261121-001

Repository: budapesservices-dotcom/folio-studio  
Task file: docs/coordination/tasks/FOLIO-20261121-PR4-PR5-REMEDIATION-RESERVE-001.md  
Evidence destination: existing PR #4 and/or PR #5 only if GPT0 later authorizes a specific remediation  
Target branches: feat/native-command-core-phase1 and/or feat/workspace-window-management  
Exact baseline refs: PR #4 at 9730fdc02f5ee331c17de61c443a0f0d35782c56; PR #5 at a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900

### Objective
Reserve the engineering response slot for concrete, verified findings from GPT4's independent final QA. No implementation is authorized by this packet.

### Context
- GPT4 QA dependency: FOLIO-20261121-PR4-PR5-QA-001
- PR #4 exact baseline: 9730fdc02f5ee331c17de61c443a0f0d35782c56
- PR #5 exact baseline: a8b28182d939ea6e5c4b40f6e7f3e0ac5e2d8900
- Parent foundation PR #1 remains open/draft and is under a separate read-only audit.
- Native Commands Phase 2 is not authorized.

### Dependencies
- Depends on: FOLIO-20261121-PR4-PR5-QA-001 and GPT0's written review/decision.
- Start condition: GPT4 submits final QA reports; GPT0 identifies a concrete finding, exact affected branch/head, allowed paths and test requirements; GPT0 revises this packet with a new exact base SHA and changes status from WAITING to DISPATCHED.
- Until then, do not accept this task, start work, inspect for remediation, or make commits.

### Scope
Allowed paths: NONE until GPT0 publishes an explicitly scoped revision.

Out of scope:
- Any source/test changes before explicit dispatch.
- Native Commands Phase 2A/2B, Component Command Bridge, architecture expansion, unrelated cleanup, PR synchronization, merge or deployment.

### Required work after re-authorization
1. Read the revised packet and verify exact base SHA.
2. Implement only the specific GPT4/GPT0-approved finding.
3. Add deterministic regression coverage where applicable.
4. Run exact prescribed checks.
5. Commit only to the target PR branch stated in the revised packet.
6. Report exact changed files, starting/final SHAs, tests and CI.

### Acceptance criteria
- [ ] No work begins while status is WAITING.
- [ ] GPT0 publishes a revised packet with finding, paths, branch, base SHA and validation before dispatch.
- [ ] Any later implementation is limited to the approved finding.
- [ ] PRs remain open and unmerged.

### Validation
None while WAITING.

### Constraints and stop conditions
Do not merge, deploy, change code/tests while WAITING, begin Native Commands Phase 2, or rebase/retarget PRs. Do not self-select a fix from an audit report. Remain WAITING until GPT0 revises and dispatches the packet.

### Final chat response
Do not start or reply DITERIMA while this task is WAITING. After explicit re-dispatch, follow the revised packet's start/finish/blocker format.
