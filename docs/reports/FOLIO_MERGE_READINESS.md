# Folio Studio — Merge Readiness Report (`FOLIO-MERGE-READINESS-001`)

**Date:** 2026-11-22  
**Target Integration Branch:** `codex/pr1-main-reconciliation-20261122` (PR #17 → `main`)  
**Repository:** `https://github.com/budapesservices-dotcom/folio-studio`  
**Verdict:** **NOT READY TO MERGE** *(Code implementation and local automated/browser verification are COMPLETE and PASSING — 23/23 test files, 310/310 tests, production build green — but final merge readiness is externally blocked until these workspace changes are committed and pushed to `codex/pr1-main-reconciliation-20261122`, GitHub Actions CI passes on the new pushed HEAD, and human manual browser acceptance is signed off.)*

---

## 1. Executive Summary

This engineering completion effort reconciled the diverged **PR #5 (`feat/workspace-window-management`)** workspace window management and preferences features into the **PR #17 (`codex/pr1-main-reconciliation-20261122`)** foundation, resolved all **14 Folio QA findings (`WEB-01` through `WEB-14`)**, and fixed critical Preact/SVG rendering, clipping-mask, layer-stacking, and runtime stability bugs discovered during live technical audit.

All existing Folio architectural invariants were preserved without compromise:
- **Preact 10.28.2 + TypeScript 5.9 + Vite 8** (zero new npm dependencies added).
- **Unified Project Model & `.flop` v2 format** compatibility preserved (including v1 migration, IndexedDB v2 `app-state` pointer, `CanonicalEditorStore`, and Native Command Core Phase 1).
- **PR #17 Component Canvas durability & recovery** (`componentDeletion.ts`, `componentCanvasSync.ts`, `componentRecovery.browser.test.mjs`) preserved intact.
- **PR #5 Workspace Window Management & Preferences** (`workspacePreferences.ts`, `WINDOW_LAYERING`, adaptive small-viewport clamping, `FloatingWindow` live viewport tracking, `workspaceGeometry.browser.test.mjs`) integrated cleanly alongside PR #17.

---

## 2. Source Baseline & Git Environment Status

- **Authoritative GitHub Baseline Verified via GitHub API:**
  - PR #17 (`codex/pr1-main-reconciliation-20261122`, base `main`): HEAD `615a84c667aefecffb6c4034734e7e635188eb0b`
  - PR #5 (`feat/workspace-window-management`, base `feat/canvas-pan-distribute`): HEAD `f4178af81d6f60d7e5b931c5a0ab0e87ebe3b028`
  - PR #1 (`feat/canvas-pan-distribute`, base `main`): HEAD `30f6b6e21738bf2cd1201eb42198e9f405779071`
- **Local Workspace Limitation (Honest Disclosure):**
  - The AI Studio workspace (`/app/applet`) was imported without a `.git` directory and has no Git push credentials configured.
  - Cryptographic local `git rev-parse HEAD` / `git diff` verification and remote push to GitHub could not be executed from this sandbox.
  - **Final Commit SHA:** *Pending external commit & push from this workspace onto `codex/pr1-main-reconciliation-20261122`.*
  - No PRs were merged or closed, no branches were deleted, and no deployments were triggered.

---

## 3. Branch & PR Integration Strategy

| PR / Branch | Role | Action Taken | Post-Merge / Next Action |
|---|---|---|---|
| **PR #17** (`codex/pr1-main-reconciliation-20261122` → `main`) | Primary integration candidate | Applied all PR #5 reconciliations, `WEB-01..WEB-14` fixes, SVG/mask/component fixes, and new regression tests directly onto PR #17's workspace files. | Commit & push workspace diff to PR #17 branch, confirm green GitHub CI, complete human QA, then merge PR #17 into `main` (with CEO approval). |
| **PR #5** (`feat/workspace-window-management`) | Unique workspace window & preferences features (49 ahead / 84 behind PR #17) | Inspected full branch archive (`f4178af81d6f60d7e5b931c5a0ab0e87ebe3b028`); selectively integrated all unique modules, CSS tokens, focus-return/inert behavior, and tests without blindly merging/rebasing or overwriting PR #17 durability code. | Left open untouched per boundaries; can be superseded/closed by maintainer only after PR #17 merges. |
| **PR #1** (`feat/canvas-pan-distribute`) | Legacy foundation path | Preserved all canvas pan/zoom/align/distribute behavior inside PR #17. | Left open untouched per boundaries; can be superseded/closed by maintainer after PR #17 merges. |

---

## 4. PR #5 Feature Integration Matrix

| PR #5 Artifact / Capability | Status | Integration Details |
|---|---|---|
| `src/app/workspacePreferences.ts` | **Integrated** | Full V1 local workspace layout/visibility persistence, schema normalization, legacy migration, and corrupt-storage recovery with confirmation banner. |
| `src/app/windowManager.ts` (`WINDOW_LAYERING`, `getWorkspaceWindowIds`, `getWorkspacePanelIds`, small-viewport recovery) | **Integrated** | Unified z-index band architecture (`WORKSPACE_WINDOWS: 120`, `RACKS: 300`, `APPLICATION_TOOLBAR: 1200`, `GLOBAL_MENU: 1400`, `TOAST: 1500`, `CONTEXT_MENU: 1600`, `HYDRATION_OVERLAY: 2000`, `MODAL_HOST: 10000`) plus adaptive window recovery. |
| `src/app/FloatingWindow.tsx` | **Integrated** | Live `.app-shell` viewport reads, `onFocusCapture`, `data-window-floating`, `data-window-minimized`, `data-window-drag-handle`, `data-window-no-drag`, pointer-capture cleanup. |
| Rack focus return & `inert` panels (`App.tsx`) | **Integrated** | `pagesRackRef`, `componentRackRef`, `pagesRackToggleRef`, `componentRackToggleRef`, `closePagesRack`, `closeComponentRack`, `inert={!pagesRackOpen}` / `inert={!componentRackOpen}`. |
| Responsive narrow-viewport CSS (`global.css`) | **Integrated** | `@media (max-width: 700px)` rules, rack height/width clamping, `.workspace-preferences-recovery` banner styling. |
| PR #5 Test Suites (`workspacePreferences.test.ts`, `FloatingWindow.test.tsx`, `windowManager.test.ts`, `workspaceGeometry.browser.test.mjs`) | **Integrated & Passing** | All 4 test files ported and passing in Vitest + real Chromium alongside PR #17's newer `componentRecovery.browser.test.mjs`. |
| PR #17 Durability & Store (`componentDeletion.ts`, `componentCanvasSync.ts`, `editorStore.ts`, `nativeCommandExecutor.ts`) | **Preserved** | Zero regressions; all PR #17 unit and Chromium durability tests pass. |

---

## 5. Complete Acceptance Matrix (`WEB-01`..`WEB-14` & Technical Audit Findings)

| ID | Issue / Finding | Root Cause | Files Modified | Fix Summary | Automated Test | Browser Verified | Result |
|---|---|---|---|---|---|---|---|
| **WEB-01** | Component Rack overlapped/occluded by Main Canvas | Component Rack lacked explicit `--z-component-rack` stacking above floating/docked canvas windows. | `src/styles/global.css`, `src/app/windowManager.ts`, `src/app/App.tsx` | Placed `.component-rack-panel` at `z-index: var(--z-component-rack)` (`300`), strictly above workspace windows (`120..125`). | `workspaceGeometry.browser.test.mjs`, `mergeReadiness.browser.test.mjs` | Yes (CDP `elementFromPoint` + `playwright-cli`) | **PASS** |
| **WEB-02** | Header `View` button misaligned; menu dismissal & placeholder states unclear | Inconsistent button box model on `.global-menu-item`; no click-outside/Escape handler; planned menus looked active. | `src/app/App.tsx`, `src/styles/global.css` | Unified `.global-menu-item` alignment/height; added `useLayoutEffect` outside-click & Escape dismissal; marked planned menus (`Edit`, `Tools`, `Option`, `Help`) `is-disabled` + `aria-disabled="true"`. | `mergeReadiness.browser.test.mjs` | Yes (bounding-box alignment + Esc/outside click) | **PASS** |
| **WEB-03** | Pages Rack drops behind Main Canvas on canvas interaction | Inline `style={{ zIndex: getWindowZIndex(windowOrder, 'pages') }}` pushed `.pages-rack-panel` into the `120..125` window band. | `src/app/App.tsx`, `src/styles/global.css` | Removed inline window z-index override so `.pages-rack-panel` uses `var(--z-pages-rack)` (`300`), staying above Main Canvas even after canvas clicks; added `.inspector-hidden` width expansion. | `workspaceGeometry.browser.test.mjs`, `mergeReadiness.browser.test.mjs` | Yes (CDP click-canvas + `elementFromPoint` + `playwright-cli`) | **PASS** |
| **WEB-04** | Default bright OS scrollbars clash with dark studio UI | Missing dark custom scrollbar styling across panels and workspace containers. | `src/styles/global.css` | Added unified dark scrollbar tokens and `scrollbar-color` / `::-webkit-scrollbar` rules. | `mergeReadiness.browser.test.mjs` (visual/CSS check) | Yes (`playwright-cli` 1440×900 inspection) | **PASS** |
| **WEB-05** | Harsh bright white `.canvas-workspace` surround | `.canvas-workspace` rendered with light/white background contrasting harshly against dark chrome. | `src/styles/global.css` | Replaced surround with refined dark dot-grid studio backdrop (`#121620` with subtle grid dots) and dark checkerboard for transparent Component Canvas artboards. | `mergeReadiness.browser.test.mjs` | Yes (`playwright-cli` screenshots) | **PASS** |
| **WEB-06** | Unorganized right-side top toolbar toggles | 8 icon toggles rendered in one undifferentiated flat row. | `src/app/App.tsx`, `src/styles/global.css` | Grouped into 4 semantic sections (`Racks` \| `Side panels` \| `Workspace windows` \| `Fullscreen`) separated by `.global-panel-group-divider`. | `mergeReadiness.browser.test.mjs` | Yes (`playwright-cli` screenshots) | **PASS** |
| **WEB-07** | Tool Rack flyout hidden/clipped behind Canvas when Layers sidebar is hidden | `.tool-rail` sat below Main Canvas stacking context when `layers-hidden` collapsed the sidebar column. | `src/styles/global.css`, `src/app/App.tsx` | Elevated `.tool-rail` to `z-index: var(--z-application-toolbar)` (`1200`) and added `useLayoutEffect` outside-click & Escape dismissal for `.tool-rack-menu`. | `mergeReadiness.browser.test.mjs` | Yes (CDP `elementFromPoint` with `layers-hidden` + `playwright-cli`) | **PASS** |
| **WEB-08** | Intrusive floating `.canvas-hint` text cluttering bottom of canvases | Static instructional `.canvas-hint` banner rendered over Main Canvas and Component Canvas viewports. | `src/app/App.tsx` | Removed `.canvas-hint` overlays from Main Canvas and Component Canvas (contextual guidance remains in the top hint bar). | `mergeReadiness.browser.test.mjs` | Yes (`playwright-cli` screenshots) | **PASS** |
| **WEB-09** | Saving from Component Canvas accidentally duplicated components | Toolbar save button always created a new component instead of updating the active master in place. | `src/app/App.tsx` | Added `saveComponentCanvasMaster` (`.component-master-save-button`) to update/sync the active master in place without duplication (respecting conflict/recovery guards), plus a distinct secondary `.component-save-new-button` (`copyPlus` icon) for explicit Save-Selection-as-New. | `mergeReadiness.browser.test.mjs`, `componentCanvasSync.test.ts` | Yes (count stays 1 on master save, increments to 2 on explicit Save-as-New) | **PASS** |
| **WEB-10** | New shapes created off-canvas / oversized inside `420×280` Component Canvas | `createNode()` used desktop `1440×900` coordinates and font sizes regardless of target artboard dimensions. | `src/core/document/factory.ts`, `src/app/App.tsx` | Added `createNodeForDocument(type, document)` which centers and scales `rect`, `ellipse`, and `text` strictly inside compact artboards (`420×280`) and uses high-contrast light ink (`#F3F5FA`) on transparent dark artboards, while preserving desktop `1440×900` placement. | `mergeReadiness.test.ts`, `mergeReadiness.browser.test.mjs` | Yes (exact SVG bounds verified + Round-2 `playwright-cli` screenshot) | **PASS** |
| **WEB-11** | Component Rack showed fake static placeholder shapes instead of real previews | Cards rendered hardcoded CSS `.component-preview-shape` spans. | `src/app/ComponentThumbnail.tsx`, `src/app/App.tsx`, `src/styles/global.css` | Built live proportional SVG `<ComponentThumbnail>` powered by shared `DocumentArtworkContent` with computed bounding `viewBox` and thumbnail-scoped mask IDs. | `mergeReadiness.browser.test.mjs` | Yes (live SVG shapes + masks verified in DOM & screenshot) | **PASS** |
| **WEB-12** | Clipping masks broken inside Component Instances and on Detach; DOM mask ID collisions | `Canvas.tsx` omitted `<defs><mask>` inside `component-instance`; global `folio-clip-mask-*` IDs collided across Main Canvas, Component Canvas, instances, and thumbnails; `detachComponentInstance` dropped `clipMaskBaseId`. | `src/engines/canvas/artwork.tsx`, `src/engines/canvas/Canvas.tsx`, `src/core/document/components.ts` | Created shared `artwork.tsx` renderer with document/instance/thumbnail-scoped mask IDs (`buildMaskElementId`), full clipping-mask rendering inside `component-instance`, and `clipMaskBaseId` remapping in `detachComponentInstance`. | `mergeReadiness.test.ts`, `mergeReadiness.browser.test.mjs` | Yes (instance `<mask>` verified + zero duplicate DOM `[id]`s) | **PASS** |
| **WEB-13** | Saving selection with nested Groups & Clipping Masks lost hierarchy or left dangling references | Inline component-save logic did not recursively expand selected groups or sanitize external `parentId` / `clipMaskBaseId`; validation did not check `clipMaskBaseId`. | `src/core/document/components.ts`, `src/core/document/validation.ts`, `src/app/App.tsx` | Added `buildComponentDefinitionFromNodes` (expands groups, preserves internal `parentId` + `clipMaskBaseId`, strips only external dangling refs); hardened `isCommonNode` + `isValidLayerHierarchy` to reject self/dangling `clipMaskBaseId`. | `mergeReadiness.test.ts`, `document.test.ts`, `layers.test.ts` | Yes (`.flop` round-trip & undo/redo verified) | **PASS** |
| **WEB-14** | Workspace window & panel preferences lost across sessions / inconsistent recovery | PR #5 preference persistence was not yet reconciled into PR #17. | `src/app/workspacePreferences.ts`, `src/app/windowManager.ts`, `src/app/FloatingWindow.tsx`, `src/app/App.tsx` | Integrated PR #5 V1 workspace preference persistence, schema validation, legacy migration, recovery banner, and viewport clamping. | `workspacePreferences.test.ts`, `windowManager.test.ts`, `FloatingWindow.test.tsx`, `workspaceGeometry.browser.test.mjs` | Yes | **PASS** |
| **AUDIT-01** | Preact SVG camelCase attributes ignored (`fontSize`, `fontWeight`, `strokeWidth`, `pointerEvents`, etc.) | Preact renders SVG attributes verbatim; camelCase props became invalid SVG attributes so hero typography fell back to `16px`. | `src/engines/canvas/artwork.tsx`, `src/engines/canvas/Canvas.tsx` | Converted all SVG attributes to valid kebab-case (`font-size`, `font-family`, `font-weight`, `letter-spacing`, `dominant-baseline`, `stroke-width`, `stroke-dasharray`, `pointer-events`). | `mergeReadiness.browser.test.mjs` | Yes (Hero title computes `92px`, weight `700`) | **PASS** |
| **AUDIT-02** | Multiline SVG text collapsed onto 1 line | `node.text.split('\\n')` split on literal backslash-n instead of newline characters. | `src/engines/canvas/artwork.tsx` | Fixed to `node.text.split(/\r?\n/)`. | `mergeReadiness.browser.test.mjs` | Yes (`['Ideas become', 'interfaces.']` rendered as 2 `<tspan>`s) | **PASS** |
| **AUDIT-03** | Layer Context Menu & Layer Color Palette clipped by Layers panel (`z-index: 70`) | Both popovers rendered inside `<aside class="layers-panel">`. | `src/app/App.tsx`, `src/styles/global.css` | Moved both overlays to root `.app-shell` with `z-index: var(--z-context-menu)` (`1600`). | `mergeReadiness.browser.test.mjs` | Yes (`elementFromPoint` hit-tested past `x > 298` over Main Canvas) | **PASS** |
| **AUDIT-04** | Uncaught `TypeError: target?.matches is not a function` on window-level `keydown` | Global `onKeyDown` cast `event.target` to `HTMLElement` without `instanceof Element` check. | `src/app/App.tsx` | Guarded with `event.target instanceof Element`. | `mergeReadiness.browser.test.mjs` (`pageErrors === []`) | Yes (0 console errors, 0 uncaught exceptions) | **PASS** |
| **AUDIT-05** | Closing Component Canvas left Layers/Inspector pointed at hidden Component Canvas | Closing/minimizing Component Canvas did not return `activeEditorId` to `'main'`. | `src/app/App.tsx` | Switched `activeEditorId` back to `'main'` and focused `'main-canvas'` on Component Canvas close/minimize. | Visual Round-2 check | Yes (`playwright-cli` Round-2 screenshot confirms Inspector returns to `MAIN PAGE`) | **PASS** |
| **INFRA-01** | AI Studio Preview blocked by Vite `allowedHosts` (`403 Forbidden`) | `vite.config.ts` only listed `['.app.github.dev']`. | `vite.config.ts` | Updated narrow allowlist to `['.app.github.dev', '.run.app']` (without `allowedHosts: true`). | `curl` Host header check | Yes (`.run.app` → `200`, `.app.github.dev` → `200`, untrusted → `403`) | **PASS** |

---

## 6. Files Changed

### Modified
- `vite.config.ts` — Narrow `allowedHosts: ['.app.github.dev', '.run.app']` for AI Studio Preview and Codespaces.
- `src/app/App.tsx` — Integrated PR #5 preferences/rack focus/inert handling, fixed stacking/popovers/menus/tool-rack dismissal (`useLayoutEffect`), added `saveComponentCanvasMaster` (`WEB-09`), live `<ComponentThumbnail>` (`WEB-11`), grouped right toolbar (`WEB-06`), removed `.canvas-hint` (`WEB-08`), fixed `onKeyDown` target guard, returned editor focus on Component Canvas close.
- `src/app/FloatingWindow.tsx` — Reconciled PR #5 live shell viewport measurement, focus capture, data attributes, and pointer cleanup.
- `src/app/windowManager.ts` — Reconciled PR #5 `WINDOW_LAYERING` constants, window/panel ID helpers, and small-viewport clamping/recovery.
- `src/engines/canvas/Canvas.tsx` — Delegated SVG node/mask rendering to shared `artwork.tsx`, fixed kebab-case `pointer-events`, document-scoped mask prefixes.
- `src/core/document/factory.ts` — Added `createNodeForDocument` for compact transparent artboard placement and contrast (`WEB-10`).
- `src/core/document/components.ts` — Added `buildComponentDefinitionFromNodes` (`WEB-12`/`WEB-13`) and remapped `clipMaskBaseId` in `detachComponentInstance` (`WEB-12`).
- `src/core/document/validation.ts` — Hardened `isCommonNode` (`layerColor`, `onCanvas`, `clipMaskBaseId`) and `isValidLayerHierarchy` (non-self, existing `clipMaskBaseId`).
- `src/styles/global.css` — Added `:root` dark & z-index tokens, dark scrollbars (`WEB-04`), dark dot-grid canvas surround & transparent checkerboard (`WEB-05`), menu/toolbar group alignment (`WEB-02`/`WEB-06`), PR #5 responsive rack clamping & recovery banners, live thumbnail styles, `.inspector-hidden` rack expansion, CSS conflict cleanup.
- `tests/windowManager.test.ts` — Reconciled PR #5 window layering & recovery assertions.
- `docs/ARCHITECTURE.md` & `docs/ACCEPTANCE_TESTS.md` — Synced implementation reality notes.

### Created
- `src/app/workspacePreferences.ts` — PR #5 workspace preference V1 schema, persistence, migration, and recovery.
- `src/engines/canvas/artwork.tsx` — Single-source-of-truth Preact-safe SVG node, multiline text, and namespaced clipping-mask renderer.
- `src/app/ComponentThumbnail.tsx` — Live proportional SVG Component Rack thumbnail renderer.
- `tests/workspacePreferences.test.ts` — PR #5 workspace preference unit tests (37 tests).
- `tests/FloatingWindow.test.tsx` — PR #5 FloatingWindow component tests (8 tests).
- `tests/workspaceGeometry.browser.test.mjs` — PR #5 Chromium layout/stacking/tab-order browser test.
- `tests/mergeReadiness.test.ts` — Unit regression tests for `WEB-10`, `WEB-12`, `WEB-13`, validation, `.flop` round-trip, undo/redo, and mask ID namespacing (6 tests).
- `tests/mergeReadiness.browser.test.mjs` — End-to-end Chromium CDP regression test verifying `WEB-01`..`WEB-14`, Preact SVG typography/multiline `<tspan>`, root-stacked layer popovers, live thumbnails, instance clipping masks, zero duplicate DOM IDs, and zero console/page errors.
- `docs/reports/FOLIO_MERGE_READINESS.md` — This merge-readiness report.

---

## 7. Automated Checks & Build Evidence

All checks were executed locally in `/app/applet`:

1. **TypeScript Check:**
   - Command: `npm run check` (`tsc --noEmit`)
   - Result: **PASS** (0 errors)
2. **Full Vitest Suite (Unit + 4 Real Chromium Browser Suites):**
   - Command: `CHROMIUM_BIN=/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell npm run test`
   - Result: **PASS — 23/23 test files passed, 310/310 tests passed** (duration ~28.4s):
     - `tests/mergeReadiness.browser.test.mjs` (1 passed)
     - `tests/nativePersistence.browser.test.mjs` (1 passed)
     - `tests/workspaceGeometry.browser.test.mjs` (1 passed)
     - `tests/componentRecovery.browser.test.mjs` (5 passed)
     - `tests/mergeReadiness.test.ts` (6 passed)
     - `tests/workspacePreferences.test.ts` (37 passed)
     - `tests/FloatingWindow.test.tsx` (8 passed)
     - `tests/windowManager.test.ts` (17 passed)
     - `tests/nativeCommandCore.test.ts` (60 passed)
     - `tests/layers.test.ts` (35 passed), `tests/document.test.ts` (33 passed), `tests/indexedDb.test.ts` (18 passed), `tests/componentDeletion.test.ts` (18 passed), `tests/componentCanvasSync.test.ts` (13 passed), `tests/canvas-tools.test.ts` (12 passed), `tests/canvas.test.ts` (9 passed), `tests/projectFile.test.ts` (9 passed), `tests/ast.test.ts` (7 passed), `tests/projectExport.test.ts` (5 passed), `tests/debouncedAutosave.test.ts` (5 passed), `tests/modalFocus.test.ts` (5 passed), `tests/componentOverrides.test.ts` (3 passed), `tests/editorContext.test.ts` (2 passed).
3. **Production Build:**
   - Command: `npm run build` (`tsc --noEmit && vite build`)
   - Result: **PASS** in 390ms (`dist/index.html` 0.64 kB, `dist/assets/index-*.css` 48.33 kB / 9.95 kB gzip, `dist/assets/index-*.js` 238.05 kB / 63.83 kB gzip).
4. **Production Preview & Host Allowlist Verification:**
   - `vite preview --host 127.0.0.1 --port 4173`: HTTP **200**, serves `/folio-studio/` with `<title>Folio Studio</title>` and built `/folio-studio/assets/*`.
   - Vite dev server Host allowlist checks:
     - `Host: preview-test.run.app` → **HTTP 200**
     - `Host: test-3000.app.github.dev` → **HTTP 200**
     - `Host: evil.example.com` → **HTTP 403**
5. **Live Headless Chromium Visual Verification (`playwright-cli` at `1440×900`):**
   - Verified default dark studio workspace, 92px 2-line hero typography, grouped right toolbar, aligned `File`/`View` menus, Component Canvas transparent checkerboard with readable centered shapes, live SVG Component Rack thumbnails, Pages Rack and Tool Rack flyout stacking above Main Canvas with Layers hidden, and **0 console errors / 0 console warnings**.

---

## 8. GitHub CI Workflow Status & External Blocker

- **Baseline CI Status:** GitHub Actions workflow `FOLIO verification` passed on baseline commit `615a84c667aefecffb6c4034734e7e635188eb0b`.
- **Current Revision CI Status:** **NOT YET EXECUTED ON GITHUB** — because this sandbox does not contain `.git` or GitHub push credentials, these completed workspace files have not yet been committed or pushed to `codex/pr1-main-reconciliation-20261122`.
- **Required Unblock Action:**
  1. Export/apply these workspace changes onto a local checkout of `codex/pr1-main-reconciliation-20261122` (based on `615a84c667aefecffb6c4034734e7e635188eb0b`).
  2. Commit and push to `origin/codex/pr1-main-reconciliation-20261122`.
  3. Confirm GitHub Actions `FOLIO verification` passes on the new pushed HEAD (all 23 test files / 310 tests + build).

---

## 9. Remaining Limitations, Risks & Manual Acceptance Checklist

1. **Planned Top-Bar Menus (`Edit`, `Tools`, `Option`, `Help`):** Intentionally marked disabled (`aria-disabled="true"`) until their command surfaces are implemented in subsequent milestones; they no longer appear broken or ambiguous.
2. **Nested Component Instances Inside Component Masters:** `buildComponentDefinitionFromNodes` excludes `component-instance` nodes when saving a selection into a new master definition to prevent cyclic component graphs (consistent with existing architecture).
3. **Human Manual Acceptance Still Required Before Final Merge:**
   - Interactive drag/resize/pan/zoom/marquee/lasso feel check in target desktop Chrome/Edge on Windows 10.
   - Native `.flop` File → Export Project & File → Open Project round-trip with nested groups, clipping masks, and components.
   - Multi-page switching + reload persistence check in IndexedDB and localStorage workspace preferences.
   - Active Component Canvas master deletion recovery flow (`Cancel`, `Save buffer as a new component`, `Discard buffer and delete`) visual/keyboard walkthrough.
   - Visual sign-off on dark theme contrast, Component Rack live SVG previews, and narrow-window responsive clamping.

---

## 10. Final Verdict

**VERDICT: `NOT READY TO MERGE` (Pending Git Commit/Push, GitHub CI on Pushed HEAD, and Human Sign-Off)**

- **Codebase & Local Verification Status:** **COMPLETE & PASSING** (`tsc --noEmit` 0 errors, 23/23 Vitest suites / 310/310 tests passing including 4 real Chromium browser suites, production `vite build` & `vite preview` passing, 0 console/runtime errors).
- Once these changes are pushed to `codex/pr1-main-reconciliation-20261122`, GitHub CI turns green on the pushed commit, and the human manual checks above pass, PR #17 is ready for CEO merge authorization into `main`.
