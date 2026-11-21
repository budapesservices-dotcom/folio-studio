# FOLIO Design Direction 0.3 — True Fullscreen

**Product:** FOLIO  
**Application:** Folio Studio  
**Direction version:** 0.3  
**Date:** 2026-11-18  
**Status:** Approved product direction; implementation pending  
**Applies to:** Application display, browser fullscreen behavior and workspace presentation

> This document extends the approved Design Specification 0.2. It records a confirmed product decision; it does not claim that True Fullscreen or the modes described here are already implemented.

---

## 1. Confirmed decision

**FOLIO must support True Fullscreen as a first-class application capability.**

When the user explicitly enters True Fullscreen, FOLIO requests browser fullscreen through the standard Fullscreen API. The browser then hides its normal tab strip and address bar while FOLIO occupies the fullscreen display.

This is a deliberate product requirement, not merely a CSS layout that fills the browser viewport.

### 1.1 Product goals

- Make FOLIO feel like a focused, self-contained creative application.
- Give users the option to remove browser chrome and reclaim the entire display.
- Support both a complete professional editor and a reduced, canvas-focused experience.
- Keep fullscreen behavior predictable, reversible and under user control.
- Preserve the existing lightweight web application architecture.

---

## 2. Terminology: three different concepts

These concepts must not be treated as synonyms.

### 2.1 Full-viewport application

FOLIO fills the available browser viewport using its application shell and responsive layout. The browser tabs and address bar remain visible.

This is the normal fallback when fullscreen is not active.

### 2.2 True Fullscreen — required

FOLIO requests browser-managed fullscreen using the Fullscreen API. The browser hides its tab strip and address bar while the fullscreen session is active.

True Fullscreen can be used with either Studio Mode or Immersive Workspace. It changes the browser display state; it does not decide which FOLIO panels are visible.

### 2.3 Immersive Workspace — separate FOLIO mode

FOLIO reduces or hides its own editor chrome so the canvas receives nearly all available space. Contextual controls can appear as floating controls or temporary overlays.

Immersive Workspace can operate inside the normal browser viewport or inside True Fullscreen.

### 2.4 Presentation / Preview — future mode

A prototype or preview is presented without the editing interface. This is a future Prototype Engine capability and must not be represented as working until implemented.

---

## 3. Display and workspace combinations

True Fullscreen is an application-wide display state. Workspace mode is an independent state.

| Combination | Expected experience |
|---|---|
| Studio + browser window | Full professional editor inside the browser viewport |
| Studio + True Fullscreen | Full professional editor; browser tabs and address bar hidden |
| Immersive + browser window | Canvas-focused editor; browser chrome remains visible |
| Immersive + True Fullscreen | Maximum canvas workspace; browser chrome hidden and FOLIO panels minimized |
| Presentation + True Fullscreen | Future clean prototype playback |

The user must be able to enter or exit True Fullscreen without unexpectedly switching the active workspace mode.

---

## 4. Entering and exiting True Fullscreen

### 4.1 Entry

- Provide a clearly discoverable **Enter Fullscreen** command in the application bar and the View menu.
- The command must be initiated by a direct user action, such as clicking the fullscreen control or activating its keyboard-accessible equivalent.
- Request fullscreen on the FOLIO application root so the whole application shell is displayed.
- Do not automatically call the Fullscreen API during page load, startup, project open or an asynchronous background task.
- If the user has previously chosen fullscreen as their preferred display, FOLIO may show a clear **Enter Fullscreen** prompt after loading. The preference does not authorize an automatic request.

### 4.2 Exit

- Provide an **Exit Fullscreen** command in the same control location.
- Support the browser's standard Escape behavior.
- Listen for the browser fullscreen state change so FOLIO updates its control label and icon when the user exits using Escape or browser UI.
- Exiting fullscreen must not close the project, clear selection, reset zoom, change workspace mode or create a document history entry.

### 4.3 State synchronization

The browser's actual fullscreen state is the source of truth.

Implementation should:
- Feature-detect the standard Fullscreen API before attempting entry.
- Use the application's root element as the fullscreen target.
- Synchronize visible state from document.fullscreenElement.
- Handle fullscreenchange and fullscreenerror events.
- Handle rejected fullscreen requests without leaving the UI in a false "fullscreen active" state.
- Keep the control usable with keyboard and assistive technology.

Do not maintain a separate UI-only boolean that can drift away from the browser's actual fullscreen state.

---

## 5. Browser restrictions and fallback behavior

Browser fullscreen is permission- and user-activation-controlled. FOLIO cannot guarantee entry in every environment.

- A direct user gesture is required to request fullscreen.
- The request may fail because of browser policy, embedding permissions, unsupported browser behavior or user settings.
- When fullscreen is unsupported or rejected, keep FOLIO usable in full-viewport mode and show a concise, non-blocking explanation.
- Do not repeatedly retry a rejected request.
- Do not imitate browser fullscreen by hiding only FOLIO's own header and claim that the browser tabs/address bar are hidden.
- Embedded deployments must have the appropriate fullscreen permission from their host.
- Browser security indicators or temporary browser overlays may still appear; FOLIO must not attempt to suppress browser-controlled UI.

The FOLIO UI must always provide a visible and accessible way to leave its own immersive state. The browser retains control over ending the True Fullscreen session.

---

## 6. Control placement and interaction

### 6.1 Application bar

Add a fullscreen toggle near other global view/workspace controls.

- When inactive: label/tooltip **Enter Fullscreen**.
- When active: label/tooltip **Exit Fullscreen**.
- Use a recognizable expand/contract icon.
- Provide an accessible name and visible keyboard focus.
- Do not rely on icon shape or color alone to communicate state.

### 6.2 View menu

The View menu includes:
- Enter Fullscreen / Exit Fullscreen.
- Studio / Immersive workspace selection when implemented.
- Panel visibility and canvas view controls.

### 6.3 Immersive Workspace controls

When Immersive Workspace is implemented:
- Use a minimal floating toolbar for frequent canvas actions.
- Provide a predictable way to reveal Layers, Inspector and other panels.
- Allow panels to appear as overlays or temporary edge-reveal surfaces.
- Preserve access to exit fullscreen and restore the normal editor interface.
- Avoid hiding critical commands with no discoverable recovery path.

The fullscreen toggle must remain independent of panel visibility.

---

## 7. Startup and persistence rules

- The application must not force True Fullscreen on initial page load.
- The user's preferred workspace mode may be remembered separately from the .flop document.
- The user's preference for fullscreen may be remembered as an intention, but browser fullscreen must still require a fresh user action after a page load or browser exit.
- If the app starts and fullscreen is not active, display a small, dismissible entry prompt only when the user has explicitly opted into that preference.
- Workspace and display preferences remain outside the versioned JSON AST and .flop project content.

The default startup workspace mode (Studio, Immersive or Remember Last Workspace) is a separate product decision and is not decided by this document.

---

## 8. Accessibility and keyboard behavior

- All fullscreen actions must be keyboard accessible.
- Focus must remain predictable when entering or exiting fullscreen.
- The fullscreen toggle's accessible label must reflect the actual browser state.
- Escape must continue to work as the browser's standard fullscreen exit behavior; FOLIO must not block it.
- Do not capture browser-reserved shortcuts such as F11 as a replacement for the Fullscreen API.
- Do not require pointer-only interaction to enter, exit or restore the editor UI.

---

## 9. Implementation notes

This is a design requirement, not an instruction to add a large fullscreen dependency.

Expected implementation approach:
1. Add a small application-level fullscreen controller around the native Fullscreen API.
2. Use the application root element as the requested fullscreen element.
3. Expose actual fullscreen state to the application bar and View menu.
4. Add CSS for the fullscreen root and its child layout so the editor uses the full available display area.
5. Add fallback and error feedback.
6. Add browser-level interaction tests for enter, exit, Escape synchronization and failed requests.

Keep browser-specific behavior isolated from src/core. Fullscreen is an application-shell concern and must not alter the JSON AST, document history, .flop schema or engine interfaces.

---

## 10. Acceptance criteria

- [ ] FOLIO fills the browser viewport even when True Fullscreen is unavailable.
- [ ] A user action enters browser True Fullscreen where the browser permits it.
- [ ] Browser tabs and address bar are hidden during an active True Fullscreen session.
- [ ] The fullscreen control reflects the actual browser fullscreen state.
- [ ] The user can exit through FOLIO's control.
- [ ] Escape exits fullscreen and FOLIO synchronizes its UI state.
- [ ] A rejected or unsupported request leaves the application usable and displays useful feedback.
- [ ] FOLIO never forces fullscreen automatically on page load.
- [ ] Entering/exiting fullscreen does not mutate the document, selection, viewport transform or undo history.
- [ ] Fullscreen state and workspace mode remain independent.
- [ ] Fullscreen controls are keyboard accessible and have accessible names.
- [ ] The feature is manually verified in the supported desktop browsers and at the target desktop resolutions.
- [ ] npm run check, npm run test and npm run build pass after implementation.

---

## 11. Explicit non-goals

This direction does not imply that the following are implemented:

- Automatic browser fullscreen on launch.
- Suppression of browser-controlled security indicators or overlays.
- PWA installation or standalone app packaging.
- Immersive Workspace panel behavior.
- Prototype Presentation / Preview mode.
- Mobile-equivalent editor behavior.

These capabilities require their own implementation and acceptance checks.

---

## 12. Relationship to Design Specification 0.2

Design Specification 0.2 remains the baseline for Professional density, Dark theme, Adaptive workspace, panels, canvas, Inspector and design system.

This 0.3 direction adds the confirmed **True Fullscreen** requirement and clarifies its relationship with Immersive Workspace.

**Confirmed display direction:** True Fullscreen through the browser Fullscreen API, initiated by explicit user action.  
**Important separation:** browser fullscreen state and FOLIO workspace mode are independent.  
**Implementation status:** not implemented yet.
