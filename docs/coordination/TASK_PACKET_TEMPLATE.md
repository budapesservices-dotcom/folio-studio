# Folio Task File Template

GPT0 creates one file per specialist task at:

docs/coordination/tasks/FOLIO-YYYYMMDD-AREA-NNN.md

The task file is the canonical assignment. GPT0 must publish it and add it to TASK_BOARD.md before telling the CEO that the specialist is ready.

---

# FOLIO STUDIO — GPTN
## TASK TITLE

Task ID: FOLIO-YYYYMMDD-AREA-NNN
Assigned agent: GPTN — ROLE
Mode: READ-ONLY | IMPLEMENTATION | QA | AUDIT | DOCS
Status: DRAFT | WAITING | READY | DISPATCHED | ACCEPTED | IN_PROGRESS | BLOCKED | READY_FOR_REVIEW | CHANGES_REQUESTED | APPROVED | MERGED | CANCELLED
Priority: P0 | P1 | P2 | P3
Cycle ID: FOLIO-CYCLE-YYYYMMDD-NNN

Repository: budapesservices-dotcom/folio-studio
Task file: docs/coordination/tasks/TASK-ID.md
Evidence destination: GITHUB ISSUE OR RELATED PR URL
Target branch: BRANCH
Exact base SHA: FULL SHA

### Objective
ONE MEASURABLE OUTCOME.

### Context and authoritative references
- APPROVED SPECIFICATION / ADR / PR / COMMIT
- VERIFIED CURRENT REPOSITORY FACTS

### Dependencies
- Depends on: NONE OR TASK IDS
- Start condition: READY immediately / WAIT FOR TASK ID

### Scope
Allowed paths:
- EXPLICIT PATHS

Out of scope:
- EXPLICIT OUT-OF-SCOPE PATHS AND UNRELATED WORK

### Required work
1. SPECIFIC ACTION
2. SPECIFIC ACTION

### Acceptance criteria
- [ ] OBSERVABLE CRITERION
- [ ] OBSERVABLE CRITERION
- [ ] Required tests/review checks are recorded with actual results.
- [ ] GitHub evidence is posted to the specified Issue/PR.

### Validation
- EXACT COMMAND OR REVIEW PROCEDURE

### Constraints and permissions
- Do not merge.
- Do not deploy.
- Do not push implementation changes to main.
- Do not modify paths outside the allowed scope.
- Do not edit TASK_BOARD.md or AGENT_REPORTS.md.
- OTHER TASK-SPECIFIC CONSTRAINTS

### Stop conditions
Stop and report BLOCKED if:
- the exact base SHA is stale;
- a dependency is unmet;
- the evidence destination is missing or inaccessible;
- an acceptance criterion is ambiguous;
- safe completion requires out-of-scope changes;
- evidence contradicts an approved Folio architecture decision.

### Final chat response
Start: DITERIMA — TASK-ID — mulai dikerjakan.
Finish: SELESAI — TASK-ID — PR/ISSUE LINK — menunggu GPT0.
Blocker: BLOCKED — TASK-ID — ONE-LINE BLOCKER.

---

## GPT0 pre-publication checklist

- [ ] Repository and default branch inspected live.
- [ ] Exact base SHA recorded.
- [ ] One task per agent (unless the CEO explicitly approves more).
- [ ] Dependencies and non-overlapping file scopes checked.
- [ ] Evidence destination provided.
- [ ] All acceptance criteria and validation commands are measurable.
- [ ] Task file committed and reachable from default branch before READY is announced.
- [ ] TASK_BOARD.md updated with a link and READY status.
