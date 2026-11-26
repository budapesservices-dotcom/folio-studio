import { describe, expect, it } from 'vitest';
import { createServer as createViteServer } from 'vite';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  createComponentSlot,
  createComponentVariantAxis,
} from '../src/core/document/components';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import { buildLivePreviewHtml } from '../src/engines/codegen';
import {
  findChromium,
  launchChromiumHtml,
  launchChromiumSession,
} from './helpers/chromiumHarness.mjs';

const chromium = findChromium();

async function launchChromium(url) {
  return launchChromiumSession(url, {
    chromiumBin: chromium,
    profilePrefix: 'folio-merge-readiness-profile-',
    initialViewport: { width: 1440, height: 900 },
  });
}

describe('Folio Merge Readiness browser QA regressions (WEB-01..WEB-14 + SVG)', () => {
  it(
    'verifies stacking, menus, tool rack, SVG typography, component workflow, thumbnails, masks, and zero console errors',
    async () => {
      expect(chromium, 'Chromium binary is required to run browser acceptance tests').toBeTruthy();

      const server = await createViteServer({
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      });
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') {
        await server.close();
        throw new Error('Failed to bind Vite test server');
      }
      const url = `http://127.0.0.1:${address.port}/folio-studio/`;
      const browser = await launchChromium(url);

      try {
        // Wait for initial app hydration
        await browser.evalJs(`
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            if (document.querySelector('.app-shell') && !document.querySelector('.project-hydration-overlay')) break;
            await new Promise((r) => setTimeout(r, 40));
          }
          if (!document.querySelector('.app-shell')) throw new Error('App shell did not mount');
        `);

        // 1. Preact SVG Typography & Multiline Text + WEB-05 dark surround + WEB-08 no canvas-hint + WEB-06 grouped right toolbar
        const baseline = await browser.evalJs(`
          const heroText = Array.from(document.querySelectorAll('.canvas-stage svg text'))
            .find((el) => el.textContent && el.textContent.includes('Ideas become'));
          const heroStyle = heroText ? getComputedStyle(heroText) : null;
          const heroTspans = heroText ? Array.from(heroText.querySelectorAll('tspan')).map((t) => t.textContent) : [];

          const canvasWorkspace = document.querySelector('.canvas-workspace');
          const canvasBg = canvasWorkspace ? getComputedStyle(canvasWorkspace).backgroundColor : '';

          const hints = document.querySelectorAll('.canvas-hint').length;

          // WEB-02: All 6 top-bar menus (File, Edit, View, Tools, Option, Help) active & aligned
          const menuButtons = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger'));
          const menuLabels = menuButtons.map((b) => b.textContent?.trim());
          const menuRects = menuButtons.map((b) => {
            const r = b.getBoundingClientRect();
            return { top: r.top, height: r.height };
          });
          const disabledPlaceholders = Array.from(document.querySelectorAll('.global-menu-item.is-disabled'))
            .map((el) => ({ text: el.textContent?.trim(), ariaDisabled: el.getAttribute('aria-disabled') }));

          // WEB-06: Right-side panel toggle groups
          const panelGroups = Array.from(document.querySelectorAll('.global-panel-toggles .global-panel-group'))
            .map((g) => g.getAttribute('aria-label'));
          const panelDividers = document.querySelectorAll('.global-panel-toggles .global-panel-group-divider').length;

          return {
            heroFontSize: heroStyle?.fontSize,
            heroFontWeight: heroStyle?.fontWeight,
            heroTspans,
            canvasBg,
            hints,
            menuLabels,
            menuRects,
            disabledPlaceholders,
            panelGroups,
            panelDividers,
          };
        `);

        expect(baseline.heroFontSize).toBe('92px');
        expect(baseline.heroFontWeight).toBe('700');
        expect(baseline.heroTspans).toEqual(['Ideas become', 'interfaces.']);
        expect(baseline.canvasBg).not.toBe('rgb(255, 255, 255)');
        expect(baseline.hints).toBe(0);
        expect(baseline.menuLabels).toEqual(['File', 'Edit', 'View', 'Tools', 'Option', 'Help']);
        for (const rect of baseline.menuRects) {
          expect(Math.abs(rect.top - baseline.menuRects[0].top)).toBeLessThanOrEqual(1);
          expect(Math.abs(rect.height - baseline.menuRects[0].height)).toBeLessThanOrEqual(1);
        }
        expect(baseline.disabledPlaceholders).toEqual([]);
        expect(baseline.panelGroups).toEqual(['Racks', 'Side panels', 'Workspace windows', 'Utilities']);
        expect(baseline.panelDividers).toBe(3);

        // 2. WEB-02 Menu open, above-tool-rail stacking, & Escape / outside-click dismissal
        const menuDismissal = await browser.evalJs(`
          const fileBtn = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger')).find((b) => b.textContent?.trim() === 'File');
          fileBtn.click();
          await new Promise((r) => setTimeout(r, 40));
          const exportItem = Array.from(document.querySelectorAll('.global-menu-dropdown [role="menuitem"]')).find((b) => b.textContent?.trim().startsWith('Export Project'));
          const exportRect = exportItem?.getBoundingClientRect();
          const exportLeftHit = exportRect
            ? document.elementFromPoint(exportRect.left + 8, exportRect.top + exportRect.height / 2)
            : null;
          const fileDropdownAboveToolRail = Boolean(exportItem && exportLeftHit && exportItem.contains(exportLeftHit));
          const toolbarZOpen = Number(getComputedStyle(document.querySelector('.global-toolbar-slot')).zIndex);
          const toolRailZ = Number(getComputedStyle(document.querySelector('.tool-rail')).zIndex);

          const viewBtn = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger')).find((b) => b.textContent?.trim() === 'View');
          viewBtn.click();
          await new Promise((r) => setTimeout(r, 40));
          const opened = Boolean(document.querySelector('.global-menu-dropdown'));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
          const closedAfterEsc = !document.querySelector('.global-menu-dropdown');

          viewBtn.click();
          await new Promise((r) => setTimeout(r, 40));
          const reopened = Boolean(document.querySelector('.global-menu-dropdown'));
          document.querySelector('.canvas-workspace').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
          const closedAfterOutside = !document.querySelector('.global-menu-dropdown');
          return {
            fileDropdownAboveToolRail,
            toolbarAboveToolRailWhenOpen: toolbarZOpen > toolRailZ,
            opened,
            closedAfterEsc,
            reopened,
            closedAfterOutside,
          };
        `);
        expect(menuDismissal).toEqual({
          fileDropdownAboveToolRail: true,
          toolbarAboveToolRailWhenOpen: true,
          opened: true,
          closedAfterEsc: true,
          reopened: true,
          closedAfterOutside: true,
        });

        // 3. WEB-03 Pages Rack stays above Main Canvas even after clicking Main Canvas + Inspector-hidden expansion
        const pagesRackCheck = await browser.evalJs(`
          const pagesToggle = document.querySelector('.pages-rack-header-toggle');
          pagesToggle.click();
          await new Promise((r) => setTimeout(r, 80));
          const rack = document.querySelector('.pages-rack-panel');
          await Promise.all(rack.getAnimations().map((a) => a.finished.catch(() => {})));
          await new Promise((r) => setTimeout(r, 40));

          const mainToolbar = document.querySelector('[data-window-id="main-canvas"] .workspace-toolbar');
          mainToolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 80 }));
          await new Promise((r) => setTimeout(r, 80));

          const rackRect = rack.getBoundingClientRect();
          const hitAtCenter = document.elementFromPoint(rackRect.left + rackRect.width / 2, rackRect.top + rackRect.height / 2);
          const rackAboveCanvas = Boolean(hitAtCenter && rack.contains(hitAtCenter));

          // Hide inspector and verify Pages Rack right edge expands closer to viewport right
          const rightBefore = rackRect.right;
          const inspectorToggle = document.querySelector('button[aria-label="Hide Inspector"], button[title="Hide Inspector"]');
          inspectorToggle.click();
          await new Promise((r) => setTimeout(r, 80));
          const rightAfter = rack.getBoundingClientRect().right;
          // Restore inspector and close Pages Rack
          const showInspector = document.querySelector('button[aria-label="Show Inspector"], button[title="Show Inspector"]');
          showInspector.click();
          pagesToggle.click();
          await new Promise((r) => setTimeout(r, 60));

          return { rackAboveCanvas, rightBefore, rightAfter };
        `);
        expect(pagesRackCheck.rackAboveCanvas).toBe(true);
        expect(pagesRackCheck.rightAfter).toBeGreaterThan(pagesRackCheck.rightBefore + 200);

        // 4. WEB-07 Tool Rack flyout remains strictly above Main Canvas when Layers sidebar is hidden
        //    and real-time search dynamically filters UI Components, Page Sections, and Vector Starter Kits
        const toolRackCheck = await browser.evalJs(`
          const layersToggle = document.querySelector('button[aria-label="Show or hide Layers sidebar"]');
          layersToggle.click();
          await new Promise((r) => setTimeout(r, 60));

          const templatesBtn = document.querySelector('button[aria-label="Template library"]');
          templatesBtn.click();
          let menu = null;
          let searchInput = null;
          for (let attempt = 0; attempt < 50; attempt += 1) {
            menu = document.querySelector('.template-library-popover');
            searchInput = menu?.querySelector('input.template-library-search') ?? null;
            if (menu && searchInput && menu.querySelector('.template-card-primary')) break;
            await new Promise((r) => setTimeout(r, 40));
          }
          const firstItem = menu?.querySelector('.template-card-primary');
          const rect = firstItem?.getBoundingClientRect();
          const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
          const flyoutClickable = Boolean(hit && menu.contains(hit));

          const initialSections = Array.from(menu.querySelectorAll('.template-library-section'))
            .map((el) => el.getAttribute('data-template-section'));

          const setSearch = async (val) => {
            searchInput.value = val;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));
          };

          await setSearch('hero');
          const heroSections = Array.from(menu.querySelectorAll('.template-library-section'))
            .map((el) => el.getAttribute('data-template-section'));
          const heroCardIds = Array.from(menu.querySelectorAll('.template-card'))
            .map((el) => el.getAttribute('data-template-id'));

          await setSearch('vector');
          const vectorSections = Array.from(menu.querySelectorAll('.template-library-section'))
            .map((el) => el.getAttribute('data-template-section'));
          const vectorCardCount = menu.querySelectorAll('.template-card').length;

          await setSearch('');
          const restoredCount = menu.querySelectorAll('.template-card').length;

          // Escape dismisses flyout when search is empty
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
          const dismissed = !document.querySelector('.template-library-popover');

          // Restore Layers
          layersToggle.click();
          await new Promise((r) => setTimeout(r, 60));

          return {
            flyoutClickable,
            initialSections,
            heroSections,
            heroCardIds,
            vectorSections,
            vectorCardCount,
            restoredCount,
            dismissed,
          };
        `);
        expect(toolRackCheck).toEqual({
          flyoutClickable: true,
          initialSections: ['ui', 'sections', 'vectors'],
          heroSections: ['sections'],
          heroCardIds: ['section-hero'],
          vectorSections: ['vectors'],
          vectorCardCount: 5,
          restoredCount: 15,
          dismissed: true,
        });

        // 5. Layer Context Menu & Layer Color Palette root stacking (not clipped by Layers sidebar)
        const layerPopoversCheck = await browser.evalJs(`
          const layerRow = document.querySelector('.layer-row');
          layerRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 250, clientY: 220 }));
          await new Promise((r) => setTimeout(r, 50));

          const ctxMenu = document.querySelector('.layer-context-menu');
          const ctxParentClass = ctxMenu?.parentElement?.className || '';
          const ctxRect = ctxMenu?.getBoundingClientRect();
          // Check right side of context menu extending over Main Canvas (x > 298)
          const probeX = ctxRect ? Math.min(ctxRect.right - 10, Math.max(ctxRect.left + 10, 320)) : 0;
          const probeY = ctxRect ? ctxRect.top + 20 : 0;
          const hitCtx = ctxRect ? document.elementFromPoint(probeX, probeY) : null;
          const ctxHitOk = Boolean(hitCtx && ctxMenu.contains(hitCtx));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));

          const colorDot = document.querySelector('.layer-color-control');
          colorDot.click();
          await new Promise((r) => setTimeout(r, 50));
          const palette = document.querySelector('.layer-color-palette');
          const paletteParentClass = palette?.parentElement?.className || '';
          const pRect = palette?.getBoundingClientRect();
          const hitPalette = pRect ? document.elementFromPoint(pRect.left + pRect.width / 2, pRect.top + pRect.height / 2) : null;
          const paletteHitOk = Boolean(hitPalette && palette.contains(hitPalette));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));

          return { ctxParentClass, ctxHitOk, paletteParentClass, paletteHitOk };
        `);
        expect(layerPopoversCheck.ctxParentClass).toContain('app-shell');
        expect(layerPopoversCheck.ctxHitOk).toBe(true);
        expect(layerPopoversCheck.paletteParentClass).toContain('app-shell');
        expect(layerPopoversCheck.paletteHitOk).toBe(true);

        // 6. WEB-01 Component Rack above Main Canvas + WEB-09 + WEB-10 + WEB-11 + WEB-12 end-to-end
        const componentWorkflow = await browser.evalJs(`
          const compToggle = document.querySelector('.component-rack-header-toggle');
          compToggle.click();
          await new Promise((r) => setTimeout(r, 80));

          const rack = document.querySelector('.component-rack-panel');
          await Promise.all(rack.getAnimations().map((a) => a.finished.catch(() => {})));
          await new Promise((r) => setTimeout(r, 40));
          const searchInput = rack.querySelector('.component-rack-search');
          const newBtn = Array.from(rack.querySelectorAll('.component-rack-save')).find((b) => b.textContent?.includes('New component'));
          const sRect = searchInput.getBoundingClientRect();
          const bRect = newBtn.getBoundingClientRect();
          const searchHit = rack.contains(document.elementFromPoint(sRect.left + sRect.width / 2, sRect.top + sRect.height / 2));
          const newBtnHit = rack.contains(document.elementFromPoint(bRect.left + bRect.width / 2, bRect.top + bRect.height / 2));

          // Create a new master component -> opens Component Canvas
          newBtn.click();
          await new Promise((r) => setTimeout(r, 120));

          const countAfterCreate = Number(document.querySelector('.component-rack-count')?.textContent || '0');
          // Close Component Rack while drawing on Component Canvas
          compToggle.click();
          await new Promise((r) => setTimeout(r, 60));

          // WEB-10: Create Rect, Ellipse, and Text inside Component Canvas (420x280) using real Studio Shape/Text tools
          const drawOnComponentCanvas = async (groupAriaLabel, toolName, x1Frac, y1Frac, x2Frac, y2Frac) => {
            const trigger = document.querySelector('button[aria-label="' + groupAriaLabel + '"]');
            trigger.click();
            await new Promise((r) => setTimeout(r, 40));
            if (toolName) {
              const item = Array.from(document.querySelectorAll('.tool-rack-menu .tool-rack-item'))
                .find((el) => el.textContent?.includes(toolName));
              item.click();
              await new Promise((r) => setTimeout(r, 40));
            }
            const svgEl = document.querySelector('[data-window-id="component-canvas"] .canvas-stage svg');
            const sr = svgEl.getBoundingClientRect();
            const startX = sr.left + sr.width * x1Frac;
            const startY = sr.top + sr.height * y1Frac;
            const endX = sr.left + sr.width * x2Frac;
            const endY = sr.top + sr.height * y2Frac;
            svgEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, clientX: startX, clientY: startY }));
            svgEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, clientX: endX, clientY: endY }));
            svgEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 1, clientX: endX, clientY: endY }));
            await new Promise((r) => setTimeout(r, 70));
          };

          await drawOnComponentCanvas('Shape tools', 'Rectangle', 0.12, 0.14, 0.56, 0.58);
          await drawOnComponentCanvas('Shape tools', 'Ellipse', 0.24, 0.22, 0.68, 0.66);
          await drawOnComponentCanvas('Text tools', null, 0.16, 0.72, 0.58, 0.86);
          // Commit inline text editing if opened
          const inlineEditor = document.querySelector('.canvas-inline-text-editor');
          if (inlineEditor) inlineEditor.blur();
          await new Promise((r) => setTimeout(r, 60));

          const compSvg = document.querySelector('[data-window-id="component-canvas"] .canvas-stage svg');
          const compHints = document.querySelectorAll('[data-window-id="component-canvas"] .canvas-hint').length;
          const rects = Array.from(compSvg.querySelectorAll('g.canvas-node rect')).map((el) => ({
            x: Number(el.getAttribute('x')),
            y: Number(el.getAttribute('y')),
            w: Number(el.getAttribute('width')),
            h: Number(el.getAttribute('height')),
          }));
          const ellipses = Array.from(compSvg.querySelectorAll('g.canvas-node ellipse')).map((el) => ({
            cx: Number(el.getAttribute('cx')),
            cy: Number(el.getAttribute('cy')),
            rx: Number(el.getAttribute('rx')),
            ry: Number(el.getAttribute('ry')),
          }));
          const texts = Array.from(compSvg.querySelectorAll('g.canvas-node text')).map((el) => ({
            x: Number(el.getAttribute('x')),
            y: Number(el.getAttribute('y')),
            fontSize: getComputedStyle(el).fontSize,
          }));

          const allInside420x280 =
            rects.length >= 1 &&
            ellipses.length >= 1 &&
            texts.length >= 1 &&
            rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 420 && r.y + r.h <= 280) &&
            ellipses.every((e) => e.cx - e.rx >= 0 && e.cy - e.ry >= 0 && e.cx + e.rx <= 420 && e.cy + e.ry <= 280) &&
            texts.every((t) => t.x >= 0 && t.y >= 0 && t.x < 420 && t.y < 280);

          // WEB-12: Create a clipping mask inside the Component Master (clip Ellipse to Rectangle below it)
          const layerRows = Array.from(document.querySelectorAll('.layers-panel .layer-row'));
          // Layers panel is top-to-bottom (Text, Ellipse, Rectangle); right-click Ellipse (index 1) -> Create clipping mask
          layerRows[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 200 }));
          await new Promise((r) => setTimeout(r, 50));
          const maskBtn = Array.from(document.querySelectorAll('.layer-context-menu button')).find((b) =>
            b.textContent?.includes('Create Clipping Mask')
          );
          maskBtn.click();
          await new Promise((r) => setTimeout(r, 80));

          const compMaskCount = compSvg.querySelectorAll('defs mask').length;

          // WEB-09: Clicking Save/Update Master updates in place without duplicating component count
          const saveMasterBtn = document.querySelector('.component-master-save-button');
          saveMasterBtn.click();
          await new Promise((r) => setTimeout(r, 80));
          const countAfterMasterSave = Number(document.querySelector('.component-rack-count')?.textContent || '0');

          // Reopen Component Rack and check WEB-11 live SVG thumbnail + insert linked instance onto Main Canvas
          compToggle.click();
          await new Promise((r) => setTimeout(r, 80));

          const thumbSvg = document.querySelector('.component-rack-card .component-rack-thumbnail-svg');
          const thumbHasShapes = Boolean(thumbSvg && thumbSvg.querySelector('rect, ellipse, text'));
          const thumbMaskCount = thumbSvg ? thumbSvg.querySelectorAll('defs mask').length : 0;

          // Insert linked instance onto Main Canvas
          document.querySelector('.component-rack-card .component-rack-preview').click();
          await new Promise((r) => setTimeout(r, 100));

          // Check WEB-12 instance artwork contains its own namespaced <mask> and ZERO duplicate DOM IDs across entire page
          const instanceMasks = document.querySelectorAll('[data-window-id="main-canvas"] .component-instance-artwork defs mask').length;
          const allIds = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
          const duplicateIds = allIds.filter((id, idx) => allIds.indexOf(id) !== idx);

          // Regression: clicking and dragging a child <rect> inside a Component Instance must select & move the instance normally
          const instanceArtwork = document.querySelector('[data-window-id="main-canvas"] .component-instance-artwork');
          const nestedNodeIdCount = instanceArtwork ? instanceArtwork.querySelectorAll('[data-node-id]').length : -1;
          const mainSvg = document.querySelector('[data-window-id="main-canvas"] svg.artboard');
          const instanceTransformGroup = instanceArtwork?.querySelector(':scope > g[transform]');
          const parseTranslate = (el) => {
            const raw = el?.getAttribute('transform') || '';
            const m = raw.match(/translate\\(([-0-9.]+)[ ,]+([-0-9.]+)\\)/);
            return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
          };
          const beforeDragPos = parseTranslate(instanceTransformGroup);
          const innerShapeRect = instanceArtwork?.querySelector('g.canvas-node rect');
          const innerRectBox = innerShapeRect?.getBoundingClientRect();
          let afterDragPos = null;
          let instanceSelectedAfterDrag = false;
          if (innerShapeRect && innerRectBox && mainSvg) {
            const startX = innerRectBox.left + innerRectBox.width / 2;
            const startY = innerRectBox.top + innerRectBox.height / 2;
            innerShapeRect.dispatchEvent(new PointerEvent('pointerdown', {
              bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: startX, clientY: startY,
            }));
            await new Promise((r) => setTimeout(r, 30));
            mainSvg.dispatchEvent(new PointerEvent('pointermove', {
              bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: startX + 90, clientY: startY + 55,
            }));
            await new Promise((r) => setTimeout(r, 30));
            mainSvg.dispatchEvent(new PointerEvent('pointerup', {
              bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, clientX: startX + 90, clientY: startY + 55,
            }));
            await new Promise((r) => setTimeout(r, 80));
            const updatedGroup = document.querySelector('[data-window-id="main-canvas"] .component-instance-artwork > g[transform]');
            afterDragPos = parseTranslate(updatedGroup);
            instanceSelectedAfterDrag = Boolean(document.querySelector('[data-window-id="main-canvas"] .canvas-selection-outline'));
          }

          // WEB-09 secondary action: explicitly save selected layer on Component Canvas as a NEW component
          compToggle.click();
          await new Promise((r) => setTimeout(r, 60));
          document.querySelector('[data-window-id="component-canvas"] .workspace-toolbar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
          document.querySelector('.layers-panel .layer-row').click();
          await new Promise((r) => setTimeout(r, 50));
          const saveNewBtn = document.querySelector('.component-save-new-button');
          saveNewBtn.click();
          await new Promise((r) => setTimeout(r, 80));
          const countAfterSaveAsNew = Number(document.querySelector('.component-rack-count')?.textContent || '0');

          return {
            searchHit,
            newBtnHit,
            countAfterCreate,
            compHints,
            allInside420x280,
            compMaskCount,
            countAfterMasterSave,
            thumbHasShapes,
            thumbMaskCount,
            instanceMasks,
            duplicateIds,
            nestedNodeIdCount,
            beforeDragPos,
            afterDragPos,
            instanceSelectedAfterDrag,
            countAfterSaveAsNew,
          };
        `);

        expect(componentWorkflow.searchHit).toBe(true);
        expect(componentWorkflow.newBtnHit).toBe(true);
        expect(componentWorkflow.countAfterCreate).toBe(1);
        expect(componentWorkflow.compHints).toBe(0);
        expect(componentWorkflow.allInside420x280).toBe(true);
        expect(componentWorkflow.compMaskCount).toBeGreaterThanOrEqual(1);
        expect(componentWorkflow.countAfterMasterSave).toBe(1);
        expect(componentWorkflow.thumbHasShapes).toBe(true);
        expect(componentWorkflow.thumbMaskCount).toBeGreaterThanOrEqual(1);
        expect(componentWorkflow.instanceMasks).toBeGreaterThanOrEqual(1);
        expect(componentWorkflow.duplicateIds).toEqual([]);
        expect(componentWorkflow.nestedNodeIdCount).toBe(0);
        expect(componentWorkflow.beforeDragPos).not.toBeNull();
        expect(componentWorkflow.afterDragPos).not.toBeNull();
        expect(componentWorkflow.afterDragPos.x).toBeGreaterThan(componentWorkflow.beforeDragPos.x + 20);
        expect(componentWorkflow.afterDragPos.y).toBeGreaterThan(componentWorkflow.beforeDragPos.y + 15);
        expect(componentWorkflow.instanceSelectedAfterDrag).toBe(true);
        expect(componentWorkflow.countAfterSaveAsNew).toBe(2);

        // 7. Throttled mousemove resizing handles for Layers sidebar & Inspector panel
        const resizeCheck = await browser.evalJs(`
          // Close floating Component Canvas opened in section 6 so docked side-panel handles are unobstructed
          const closeCompCanvas = document.querySelector('[data-window-id="component-canvas"] .window-control-close');
          if (closeCompCanvas) {
            closeCompCanvas.click();
            await new Promise((r) => setTimeout(r, 60));
          }
          const layersPanel = document.querySelector('.layers-panel');
          const inspectorPanel = document.querySelector('.inspector-panel');
          const layersHandle = document.querySelector('[data-resize-panel="layers"]');
          const inspectorHandle = document.querySelector('[data-resize-panel="inspector"]');

          const initialLayersW = Math.round(layersPanel.getBoundingClientRect().width);
          const initialInspectorW = Math.round(inspectorPanel.getBoundingClientRect().width);

          // Verify neither handle is occluded by .workspace at center or either horizontal edge
          const lRect = layersHandle.getBoundingClientRect();
          const iRect = inspectorHandle.getBoundingClientRect();
          const lMidY = lRect.top + lRect.height / 2;
          const iMidY = iRect.top + iRect.height / 2;
          const layersHandleHit =
            document.elementFromPoint(lRect.left + 1, lMidY) === layersHandle &&
            document.elementFromPoint(lRect.left + lRect.width / 2, lMidY) === layersHandle &&
            document.elementFromPoint(lRect.right - 1, lMidY) === layersHandle;
          const inspectorHandleHit =
            document.elementFromPoint(iRect.left + 1, iMidY) === inspectorHandle &&
            document.elementFromPoint(iRect.left + iRect.width / 2, iMidY) === inspectorHandle &&
            document.elementFromPoint(iRect.right - 1, iMidY) === inspectorHandle;

          // Track active window mousemove/mouseup listeners via AbortSignal (and removeEventListener fallback)
          const activeMouseListeners = new Set();
          let mouseMoveAdds = 0;
          let mouseMoveDetaches = 0;
          let allMouseListenersUseAbortSignal = true;
          let listenerSeq = 0;
          const origAdd = window.addEventListener.bind(window);
          const origRemove = window.removeEventListener.bind(window);
          window.addEventListener = function(type, listener, options) {
            const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
            const signal = typeof options === 'object' && options !== null ? options.signal : undefined;
            if (type === 'mousemove' || type === 'mouseup') {
              if (!(signal instanceof AbortSignal)) {
                allMouseListenersUseAbortSignal = false;
              }
              if (!signal || !signal.aborted) {
                const token = type + ':' + capture + ':' + (++listenerSeq);
                activeMouseListeners.add(token);
                if (type === 'mousemove') mouseMoveAdds += 1;
                if (signal instanceof AbortSignal) {
                  signal.addEventListener('abort', () => {
                    if (activeMouseListeners.delete(token) && type === 'mousemove') {
                      mouseMoveDetaches += 1;
                    }
                  }, { once: true });
                }
              }
            }
            return origAdd(type, listener, options);
          };
          window.removeEventListener = function(type, listener, options) {
            return origRemove(type, listener, options);
          };

          try {
            // Burst 25 rapid mousemove events dragging Layers handle +90px right
            const lStartX = lRect.left + lRect.width / 2;
            layersHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: lStartX, clientY: 300 }));
            const resizingClassActive = document.querySelector('.app-shell').classList.contains('is-resizing-panel');
            const listenersAttachedDuringDrag = activeMouseListeners.size;
            for (let i = 1; i <= 25; i++) {
              window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: lStartX + (90 * i) / 25, clientY: 300 }));
            }
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: lStartX + 90, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 40));
            const resizedLayersW = Math.round(layersPanel.getBoundingClientRect().width);
            const resizingClassCleared = !document.querySelector('.app-shell').classList.contains('is-resizing-panel');
            // Moving mouse after mouseup must NOT affect width
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: lStartX + 240, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 30));
            const layersAfterPostUpMoveW = Math.round(layersPanel.getBoundingClientRect().width);

            // Burst 25 rapid mousemove events dragging Inspector handle -80px left (widens Inspector by 80px)
            const iStartX = iRect.left + iRect.width / 2;
            inspectorHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: iStartX, clientY: 300 }));
            for (let i = 1; i <= 25; i++) {
              window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: iStartX - (80 * i) / 25, clientY: 300 }));
            }
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: iStartX - 80, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 40));
            const resizedInspectorW = Math.round(inspectorPanel.getBoundingClientRect().width);
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: iStartX - 240, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 30));
            const inspectorAfterPostUpMoveW = Math.round(inspectorPanel.getBoundingClientRect().width);

            // Verify Pages Rack right edge tracks the widened Inspector panel without overlapping
            const pagesToggle = document.querySelector('.pages-rack-header-toggle');
            pagesToggle.click();
            await new Promise((r) => setTimeout(r, 60));
            const pagesRack = document.querySelector('.pages-rack-panel');
            const rackRight = Math.round(pagesRack.getBoundingClientRect().right);
            const inspectorLeft = Math.round(inspectorPanel.getBoundingClientRect().left);
            pagesToggle.click();
            await new Promise((r) => setTimeout(r, 40));

            // Escape mid-drag cancels, reverts width, and aborts mousemove/mouseup listeners
            const beforeCancelX = layersHandle.getBoundingClientRect().left + 4;
            layersHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: beforeCancelX, clientY: 300 }));
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: beforeCancelX + 120, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 25));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));
            const layersAfterEscapeW = Math.round(layersPanel.getBoundingClientRect().width);

            // Window blur mid-drag interrupts the session and aborts mousemove/mouseup listeners cleanly
            const beforeBlurX = layersHandle.getBoundingClientRect().left + 4;
            layersHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: beforeBlurX, clientY: 300 }));
            window.dispatchEvent(new Event('blur'));
            await new Promise((r) => setTimeout(r, 30));
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: beforeBlurX + 150, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 30));
            const layersAfterBlurInterruptW = Math.round(layersPanel.getBoundingClientRect().width);
            const resizingClearedAfterBlur = !document.querySelector('.app-shell').classList.contains('is-resizing-panel');

            // Removing the resize handle DOM element mid-drag immediately aborts the AbortController
            const beforeRemoveX = layersHandle.getBoundingClientRect().left + 4;
            const handleParent = layersHandle.parentNode;
            const handleNextSibling = layersHandle.nextSibling;
            layersHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: beforeRemoveX, clientY: 300 }));
            const listenersBeforeDomRemove = activeMouseListeners.size;
            layersHandle.remove();
            await new Promise((r) => setTimeout(r, 30));
            const listenersAfterDomRemove = activeMouseListeners.size;
            const resizingClearedAfterDomRemove = !document.querySelector('.app-shell').classList.contains('is-resizing-panel');
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: beforeRemoveX + 150, clientY: 300 }));
            await new Promise((r) => setTimeout(r, 30));
            const layersAfterDomRemoveW = Math.round(layersPanel.getBoundingClientRect().width);
            handleParent.insertBefore(layersHandle, handleNextSibling);

            // Keyboard ArrowLeft narrows Layers by 16px
            layersHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));
            const layersAfterKeyW = Math.round(layersPanel.getBoundingClientRect().width);

            // Full realistic double-click sequence resets both panels to PANEL_RESIZE_CONSTRAINTS defaults
            const dispatchDoubleClick = (handleEl) => {
              const box = handleEl.getBoundingClientRect();
              const x = box.left + box.width / 2;
              const y = box.top + box.height / 2;
              handleEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: x, clientY: y }));
              window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 1, clientX: x, clientY: y }));
              handleEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 2, clientX: x, clientY: y }));
              const listenersDuringSecondClick = activeMouseListeners.size;
              window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, detail: 2, clientX: x, clientY: y }));
              handleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2, clientX: x, clientY: y }));
              return listenersDuringSecondClick;
            };
            const listenersDuringLayersSecondClick = dispatchDoubleClick(layersHandle);
            const listenersDuringInspectorSecondClick = dispatchDoubleClick(inspectorHandle);
            await new Promise((r) => setTimeout(r, 40));
            const resetLayersW = Math.round(layersPanel.getBoundingClientRect().width);
            const resetInspectorW = Math.round(inspectorPanel.getBoundingClientRect().width);
            const resetLayersAria = layersHandle.getAttribute('aria-valuenow');
            const resetInspectorAria = inspectorHandle.getAttribute('aria-valuenow');
            const persistedWidthsAfterReset = JSON.parse(window.localStorage.getItem('folio.panel-widths.v1') || 'null');

            return {
              initialLayersW,
              initialInspectorW,
              layersHandleHit,
              inspectorHandleHit,
              resizingClassActive,
              resizingClassCleared,
              resizingClearedAfterBlur,
              listenersAttachedDuringDrag,
              listenersBeforeDomRemove,
              listenersAfterDomRemove,
              resizingClearedAfterDomRemove,
              layersAfterDomRemoveW,
              listenersDuringLayersSecondClick,
              listenersDuringInspectorSecondClick,
              allMouseListenersUseAbortSignal,
              leakedMouseListeners: activeMouseListeners.size,
              mouseMoveAdds,
              mouseMoveDetaches,
              resizedLayersW,
              layersAfterPostUpMoveW,
              resizedInspectorW,
              inspectorAfterPostUpMoveW,
              rackAlignedToInspector: Math.abs(rackRight - inspectorLeft) <= 2,
              layersAfterEscapeW,
              layersAfterBlurInterruptW,
              layersAfterKeyW,
              resetLayersW,
              resetInspectorW,
              resetLayersAria,
              resetInspectorAria,
              persistedWidthsAfterReset,
            };
          } finally {
            window.addEventListener = origAdd;
            window.removeEventListener = origRemove;
          }
        `);

        expect(resizeCheck.initialLayersW).toBe(240);
        expect(resizeCheck.initialInspectorW).toBe(292);
        expect(resizeCheck.layersHandleHit).toBe(true);
        expect(resizeCheck.inspectorHandleHit).toBe(true);
        expect(resizeCheck.resizingClassActive).toBe(true);
        expect(resizeCheck.resizingClassCleared).toBe(true);
        expect(resizeCheck.resizingClearedAfterBlur).toBe(true);
        expect(resizeCheck.listenersAttachedDuringDrag).toBe(2);
        expect(resizeCheck.listenersBeforeDomRemove).toBe(2);
        expect(resizeCheck.listenersAfterDomRemove).toBe(0);
        expect(resizeCheck.resizingClearedAfterDomRemove).toBe(true);
        expect(resizeCheck.layersAfterDomRemoveW).toBe(330);
        expect(resizeCheck.listenersDuringLayersSecondClick).toBe(0);
        expect(resizeCheck.listenersDuringInspectorSecondClick).toBe(0);
        expect(resizeCheck.allMouseListenersUseAbortSignal).toBe(true);
        expect(resizeCheck.leakedMouseListeners).toBe(0);
        expect(resizeCheck.mouseMoveAdds).toBe(7);
        expect(resizeCheck.mouseMoveDetaches).toBe(7);
        expect(resizeCheck.layersAfterBlurInterruptW).toBe(330);
        expect(resizeCheck.resizedLayersW).toBe(330);
        expect(resizeCheck.layersAfterPostUpMoveW).toBe(330);
        expect(resizeCheck.resizedInspectorW).toBe(372);
        expect(resizeCheck.inspectorAfterPostUpMoveW).toBe(372);
        expect(resizeCheck.rackAlignedToInspector).toBe(true);
        expect(resizeCheck.layersAfterEscapeW).toBe(330);
        expect(resizeCheck.layersAfterKeyW).toBe(314);
        expect(resizeCheck.resetLayersW).toBe(240);
        expect(resizeCheck.resetInspectorW).toBe(292);
        expect(resizeCheck.resetLayersAria).toBe('240');
        expect(resizeCheck.resetInspectorAria).toBe('292');
        expect(resizeCheck.persistedWidthsAfterReset).toEqual({ layers: 240, inspector: 292 });

        // 8. Isolated ToolbarHintBar hover updates accurately on pointer enter/leave
        const hintCheck = await browser.evalJs(`
          const hintPanelEl = () => document.querySelector('.hint-panel-label')?.textContent?.trim() || '';
          const hintDescEl = () => document.querySelector('.hint-panel-description')?.textContent?.trim() || '';
          const appShell = document.querySelector('.app-shell');
          const menuTriggers = [...document.querySelectorAll('.global-menu-item.menu-trigger')];
          const fileBtn = menuTriggers.find((el) => el.textContent?.trim() === 'File');
          const viewBtn = menuTriggers.find((el) => el.textContent?.trim() === 'View');
          if (!appShell || !fileBtn || !viewBtn) {
            return { found: false };
          }
          fileBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
          await new Promise((r) => setTimeout(r, 25));
          const filePanel = hintPanelEl();
          const fileDesc = hintDescEl();

          viewBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
          await new Promise((r) => setTimeout(r, 25));
          const viewPanel = hintPanelEl();
          const viewDesc = hintDescEl();

          appShell.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
          await new Promise((r) => setTimeout(r, 25));
          const afterLeavePanel = hintPanelEl();

          return {
            found: true,
            filePanel,
            fileDesc,
            viewPanel,
            viewDesc,
            afterLeavePanel,
          };
        `);

        expect(hintCheck.found).toBe(true);
        expect(hintCheck.filePanel).toBe('FILE');
        expect(hintCheck.fileDesc).toContain('.flop');
        expect(hintCheck.viewPanel).toBe('VIEW');
        expect(hintCheck.viewDesc.length).toBeGreaterThan(10);
        expect(hintCheck.afterLeavePanel).toBe('WORKSPACE');

        expect(browser.consoleErrors).toEqual([]);
        expect(browser.pageErrors).toEqual([]);
      } finally {
        await browser.cleanup();
        await server.close();
      }
    },
    45000,
  );

  it(
    'renders compiled HTML/CSS Live Preview in real Chromium with verified DOM structure, semantic tags, SVG arrowheads, Auto-Layout, scaling, and Master->Variants->Slots->Overrides->Tokens computed styles',
    async () => {
      const project = createInitialProject('Rendered Code Fidelity');
      project.designTokens = createDefaultDesignTokens();
      const page = getActivePage(project);

      const heroSection = {
        ...createFrameNode(0),
        id: 'sec-hero',
        name: 'Hero',
        semanticTag: 'section',
        ariaLabel: 'Hero Landmark',
        layout: {
          mode: 'flex',
          direction: 'row',
          wrap: 'nowrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
        },
        tokenBindings: {
          fill: 'tok-sem-surface-card',
          radius: 'tok-radius-md',
        },
      };

      const safeLink = {
        ...createTextNode(1),
        id: 'cta-safe',
        parentId: 'sec-hero',
        name: 'Docs Link',
        text: 'Read Docs',
        semanticTag: 'a',
        href: 'https://folio.dev/docs',
      };

      const blockedLink = {
        ...createTextNode(2),
        id: 'cta-unsafe',
        parentId: 'sec-hero',
        name: 'Blocked Link',
        text: 'Blocked',
        semanticTag: 'a',
        href: 'javascript:alert(1)',
      };

      const arrowPath = {
        id: 'vec-arrow',
        type: 'path',
        name: 'Connector',
        x: 20,
        y: 360,
        width: 80,
        height: 24,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        onCanvas: true,
        points: [
          { id: 'p1', x: 0, y: 12, pointType: 'corner' },
          { id: 'p2', x: 80, y: 12, pointType: 'corner' },
        ],
        closed: false,
        style: {
          fill: 'none',
          stroke: '#7C6CF6',
          strokeWidth: 3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          arrowEnd: true,
        },
      };

      const compBg = {
        ...createRectNode(0),
        id: 'c-bg',
        name: 'Surface',
        x: 0,
        y: 0,
        width: 160,
        height: 44,
        style: { fill: '#7C6CF6', stroke: '#00000000', strokeWidth: 0, radius: 10 },
      };
      const compBadge = {
        ...createRectNode(1),
        id: 'c-badge',
        name: 'Badge',
        x: 132,
        y: 12,
        width: 16,
        height: 16,
        style: { fill: '#222222', stroke: '#00000000', strokeWidth: 0, radius: 4 },
        tokenBindings: { fill: 'tok-sem-accent-primary' },
      };
      const compLabel = {
        ...createTextNode(2),
        id: 'c-label',
        name: 'Label',
        x: 16,
        y: 12,
        width: 108,
        height: 20,
        text: 'Base Label',
      };
      const master = buildComponentDefinitionFromNodes(
        [compBg, compBadge, compLabel],
        ['c-bg', 'c-badge', 'c-label'],
        'Pill CTA',
        { id: 'comp-pill', now: '2026-01-01T00:00:00.000Z' },
      );
      const toneAxis = createComponentVariantAxis('Tone', { id: 'axis-tone', optionLabels: ['Primary', 'Danger'] });
      toneAxis.options[1].overrides['c-bg'] = { fill: '#E0485A' };
      toneAxis.options[1].overrides['c-badge'] = { fill: '#FF0000' };
      const labelSlot = createComponentSlot('Label', 'c-label', { id: 'slot-label', defaultText: 'Default Slot' });
      const bgSlot = createComponentSlot('Surface', 'c-bg', { id: 'slot-bg' });
      master.variants = [toneAxis];
      master.slots = [labelSlot, bgSlot];
      project.components = [master];

      const instance = createComponentInstance(master, 40, 420, 'inst-pill');
      instance.width = master.document.width * 2;
      instance.height = master.document.height * 2;
      instance.variantSelection = { 'axis-tone': toneAxis.options[1].id };
      instance.slotAssignments = {
        'slot-label': { text: 'Slot Label' },
        'slot-bg': { fill: '#059669' },
      };
      instance.overrides = {
        'c-bg': { fill: '#F59E0B' },
        'c-label': { text: 'Override Final' },
        'c-badge': { fill: '#000000' },
      };

      page.document.nodes = [heroSection, safeLink, blockedLink, arrowPath, instance];

      const html = buildLivePreviewHtml(project, { pageId: page.id, themeId: 'theme-dark' });
      const browser = await launchChromiumHtml(html, {
        chromiumBin: chromium,
        profilePrefix: 'folio-merge-readiness-preview-',
        initialViewport: { width: 1440, height: 900 },
      });

      try {
        const rendered = await browser.evalJs(`
          const sec = document.querySelector('section[data-folio-id="sec-hero"]');
          const secStyle = sec ? getComputedStyle(sec) : null;
          const safeA = document.querySelector('a[data-folio-id="cta-safe"]');
          const blockedA = document.querySelector('a[data-folio-id="cta-unsafe"]');
          const arrowSvg = document.querySelector('[data-folio-id="vec-arrow"] svg');
          const arrowPathEl = arrowSvg?.querySelector('path');
          const arrowPolyEl = arrowSvg?.querySelector('polygon');
          const inst = document.querySelector('[data-folio-id="inst-pill"]');
          const inner = inst?.querySelector('[class$="__inner"]');
          const bgEl = document.querySelector('[data-folio-id="inst-pill__c-bg"]');
          const badgeEl = document.querySelector('[data-folio-id="inst-pill__c-badge"]');
          const labelEl = document.querySelector('[data-folio-id="inst-pill__c-label"]');

          return {
            themeAttr: document.documentElement.getAttribute('data-theme'),
            secTag: sec?.tagName,
            secAria: sec?.getAttribute('aria-label'),
            secDisplay: secStyle?.display,
            secBg: secStyle?.backgroundColor,
            secRadius: secStyle?.borderRadius,
            safeHref: safeA?.getAttribute('href'),
            blockedHref: blockedA?.getAttribute('href'),
            hasArrowPath: Boolean(arrowPathEl && arrowPathEl.getBoundingClientRect().width > 50),
            hasArrowPoly: Boolean(arrowPolyEl && arrowPolyEl.getBoundingClientRect().width > 4),
            innerTransform: inner ? getComputedStyle(inner).transform : null,
            bgColor: bgEl ? getComputedStyle(bgEl).backgroundColor : null,
            badgeColor: badgeEl ? getComputedStyle(badgeEl).backgroundColor : null,
            labelText: labelEl?.textContent,
          };
        `);

        expect(rendered.themeAttr).toBe('dark');
        expect(rendered.secTag).toBe('SECTION');
        expect(rendered.secAria).toBe('Hero Landmark');
        expect(rendered.secDisplay).toBe('flex');
        // Dark theme --surface-card (#2B2E3B -> rgb(43, 46, 59)) & --radius-md (16px)
        expect(rendered.secBg).toBe('rgb(43, 46, 59)');
        expect(rendered.secRadius).toBe('16px');
        expect(rendered.safeHref).toBe('https://folio.dev/docs');
        expect(rendered.blockedHref).toBe('#');
        expect(rendered.hasArrowPath).toBe(true);
        expect(rendered.hasArrowPoly).toBe(true);
        expect(rendered.innerTransform).toBe('matrix(2, 0, 0, 2, 0, 0)');
        // Unbound bg -> Local Override (#F59E0B -> rgb(245, 158, 11)) beats Slot & Variant
        expect(rendered.bgColor).toBe('rgb(245, 158, 11)');
        // Label -> Local Override beats Slot & Variant
        expect(rendered.labelText).toBe('Override Final');
        // Token-bound badge -> Dark theme --accent-primary (#9B8CFF -> rgb(155, 140, 255)) wins last (Step 5: Tokens)
        expect(rendered.badgeColor).toBe('rgb(155, 140, 255)');
        expect(browser.consoleErrors).toEqual([]);
        expect(browser.pageErrors).toEqual([]);
      } finally {
        await browser.cleanup();
      }
    },
    30000,
  );

  it(
    'Visual Node Logic Editor renders starter graph, simulates interactions, and launches interactive Live Preview',
    async () => {
      expect(chromium, 'Chromium binary is required to run browser acceptance tests').toBeTruthy();

      const server = await createViteServer({
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      });
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') {
        await server.close();
        throw new Error('Failed to bind Vite test server');
      }
      const url = `http://127.0.0.1:${address.port}/folio-studio/`;
      const browser = await launchChromium(url);
      try {
        const mountDeadline = Date.now() + 15000;
        while (Date.now() < mountDeadline) {
          try {
            const ready = await browser.evalJs(`
              return Boolean(document.querySelector('.app-shell') && !document.querySelector('.project-hydration-overlay'));
            `);
            if (ready) break;
          } catch (err) {
            if (!String(err).includes('Execution context was destroyed')) throw err;
          }
          await new Promise((r) => setTimeout(r, 80));
        }

        const result = await browser.evalJs(`
          // 1. Open Edit, Tools, and Option menus to verify live interactive dropdowns
          const openMenuItems = async (label) => {
            const btn = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger')).find((b) => b.textContent?.trim() === label);
            btn?.click();
            await new Promise((r) => setTimeout(r, 40));
            return Array.from(document.querySelectorAll('.global-menu-dropdown [role="menuitem"]')).map((el) => el.textContent?.trim());
          };
          const editItems = await openMenuItems('Edit');
          const toolsItems = await openMenuItems('Tools');
          const optionItems = await openMenuItems('Option');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));

          // 2. Open Node Logic Workspace
          document.querySelector('.node-logic-header-toggle')?.click();
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline && !document.querySelector('.nl-studio')) {
            await new Promise((r) => setTimeout(r, 40));
          }

          const initialNodeCount = document.querySelectorAll('.nl-node-card').length;
          const initialWireCount = document.querySelectorAll('.nl-wire-group').length;

          // 3. Add a node from the categorized palette
          const firstPaletteItem = document.querySelector('.nl-palette-item');
          firstPaletteItem?.click();
          await new Promise((r) => setTimeout(r, 60));
          const afterAddNodeCount = document.querySelectorAll('.nl-node-card').length;

          // 4. Switch to Simulate tab and trigger starter Visual card click
          const simTab = Array.from(document.querySelectorAll('.nl-tab-btn')).find((b) => b.textContent?.trim() === 'Simulate');
          simTab?.click();
          await new Promise((r) => setTimeout(r, 50));
          const triggerBtn = document.querySelector('.nl-trigger-btn');
          triggerBtn?.click();
          await new Promise((r) => setTimeout(r, 60));
          const simValues = Array.from(document.querySelectorAll('.nl-sim-kv')).map((row) => row.textContent?.trim());
          const traceCount = document.querySelectorAll('.nl-trace-row').length;

          // 5. Launch Live Preview directly from Node Logic CTA and verify real DOM interaction
          document.querySelector('.nl-preview-cta')?.click();
          const previewDeadline = Date.now() + 5000;
          while (Date.now() < previewDeadline && !document.querySelector('.live-preview-iframe')) {
            await new Promise((r) => setTimeout(r, 50));
          }
          const iframe = document.querySelector('.live-preview-iframe');
          const previewOpen = Boolean(iframe);
          const previewSrcdoc = iframe?.getAttribute('srcdoc') ?? '';

          return {
            editCount: editItems.length,
            toolsCount: toolsItems.length,
            optionCount: optionItems.length,
            initialNodeCount,
            initialWireCount,
            afterAddNodeCount,
            simValues,
            traceCount,
            previewOpen,
            previewSrcdoc,
          };
        `);

        expect(result.editCount).toBeGreaterThanOrEqual(10);
        expect(result.toolsCount).toBeGreaterThanOrEqual(14);
        expect(result.optionCount).toBeGreaterThanOrEqual(5);
        expect(result.initialNodeCount).toBe(9);
        expect(result.initialWireCount).toBe(8);
        expect(result.afterAddNodeCount).toBe(10);
        expect(result.simValues.some((v) => v.includes('clickCount') && v.includes('1'))).toBe(true);
        expect(result.simValues.some((v) => v.includes('accentActive') && v.includes('true'))).toBe(true);
        expect(result.traceCount).toBeGreaterThan(0);
        expect(result.previewOpen).toBe(true);
        expect(result.previewSrcdoc).toContain('INTERACTIONS');
        expect(browser.consoleErrors).toEqual([]);
        expect(browser.pageErrors).toEqual([]);

        // 6. Execute the exact Live Preview HTML in Chromium and click Visual card
        const previewBrowser = await launchChromiumHtml(result.previewSrcdoc, {
          chromiumBin: chromium,
          profilePrefix: 'folio-merge-readiness-logic-preview-',
          initialViewport: { width: 1440, height: 900 },
        });
        try {
          const domInteraction = await previewBrowser.evalJs(`
            const visibleText = () => Array.from(document.querySelectorAll('[data-folio-id]')).map((el) => el.textContent ?? '').join(' | ');
            const clickable = document.querySelector('[data-folio-interactive="true"]');
            const beforeText = visibleText();
            clickable?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));
            const afterText1 = visibleText();
            clickable?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));
            const afterText2 = visibleText();
            return {
              hasClickable: Boolean(clickable),
              updated1: !beforeText.includes('INTERACTIONS') && afterText1.includes('INTERACTIONS') && afterText1.includes('1'),
              updated2: afterText2.includes('INTERACTIONS') && afterText2.includes('2'),
            };
          `);
          expect(domInteraction).toEqual({
            hasClickable: true,
            updated1: true,
            updated2: true,
          });
          expect(previewBrowser.consoleErrors).toEqual([]);
          expect(previewBrowser.pageErrors).toEqual([]);
        } finally {
          await previewBrowser.cleanup();
        }
      } finally {
        await browser.cleanup();
        await server.close();
      }
    },
    30000,
  );

  it(
    'docks Stage 8 Motion Timeline Studio, scrubs live canvas poses, inspects keyframes, and compiles @keyframes into Live Preview',
    async () => {
      expect(chromium, 'Chromium binary is required to run browser acceptance tests').toBeTruthy();

      const server = await createViteServer({
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      });
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') {
        await server.close();
        throw new Error('Failed to bind Vite test server');
      }
      const url = `http://127.0.0.1:${address.port}/folio-studio/`;
      const browser = await launchChromium(url);
      try {
        const mountDeadline = Date.now() + 15000;
        while (Date.now() < mountDeadline) {
          try {
            const ready = await browser.evalJs(`
              return Boolean(document.querySelector('.motion-timeline-header-toggle') && !document.querySelector('.project-hydration-overlay'));
            `);
            if (ready) break;
          } catch (err) {
            if (!String(err).includes('Execution context was destroyed')) throw err;
          }
          await new Promise((r) => setTimeout(r, 80));
        }
        const motionResult = await browser.evalJs(`
          const toggleBtn = document.querySelector('.motion-timeline-header-toggle');
          toggleBtn.click();
          const dockDeadline = Date.now() + 5000;
          while (Date.now() < dockDeadline && !document.querySelector('[data-testid="motion-timeline"]')) {
            await new Promise((r) => setTimeout(r, 40));
          }
          const dock = document.querySelector('[data-testid="motion-timeline"]');
          const shellHasClass = document.querySelector('.app-shell')?.classList.contains('has-motion-timeline');
          const trackCount = document.querySelectorAll('.mt-track-grid-row').length;
          const initialKeyframes = document.querySelectorAll('.mt-keyframe').length;
          const clipLabel = document.querySelector('.mt-clip-select')?.selectedOptions?.[0]?.textContent?.trim() ?? '';

          // Scrub ruler to midpoint via keyboard ArrowRight (Shift+ArrowRight = +100ms)
          const ruler = document.querySelector('.mt-ruler');
          ruler.focus();
          for (let i = 0; i < 4; i += 1) {
            ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
            await new Promise((r) => setTimeout(r, 25));
          }
          await new Promise((r) => setTimeout(r, 60));
          const timecodeAfterScrub = document.querySelector('[data-testid="motion-timecode"]')?.textContent?.trim() ?? '';
          const playheadPctAfterKeyboard = parseFloat(
            document.querySelector('.mt-playhead-cap')?.style?.left ?? 'NaN',
          );

          const scrubTrackRatio = async (ratio) => {
            const trackEl = document.querySelector('.mt-ruler-track');
            const rect = trackEl.getBoundingClientRect();
            const clientX = rect.left + rect.width * ratio;
            const clientY = rect.top + rect.height / 2;
            ruler.dispatchEvent(new PointerEvent('pointerdown', {
              bubbles: true,
              clientX,
              clientY,
              pointerId: 7,
            }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
            await new Promise((r) => setTimeout(r, 40));
            return {
              timecode: document.querySelector('[data-testid="motion-timecode"]')?.textContent?.trim() ?? '',
              playheadPct: parseFloat(document.querySelector('.mt-playhead-cap')?.style?.left ?? 'NaN'),
            };
          };

          const scrubStart = await scrubTrackRatio(0);
          const scrubMid = await scrubTrackRatio(0.5);
          const scrubEnd = await scrubTrackRatio(1);

          // Verify scrub accuracy when ruler has asymmetric/extra padding
          const prevRulerPadding = ruler.style.padding;
          ruler.style.padding = '0 40px';
          await new Promise((r) => setTimeout(r, 30));
          const scrubPaddedMid = await scrubTrackRatio(0.5);
          ruler.style.padding = prevRulerPadding;

          // Verify scrub accuracy after timeline dock resizes
          const prevDockWidth = dock.style.width;
          dock.style.width = '760px';
          await new Promise((r) => setTimeout(r, 30));
          const scrubResizedMid = await scrubTrackRatio(0.5);
          dock.style.width = prevDockWidth;
          await new Promise((r) => setTimeout(r, 30));

          // Select first keyframe to open inspector strip
          const firstKf = document.querySelector('.mt-keyframe');
          firstKf?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 720, pointerId: 1 }));
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
          await new Promise((r) => setTimeout(r, 40));
          const hasEasingSelect = Boolean(document.querySelector('[aria-label="Keyframe easing curve"]'));

          // Launch Live Preview from Motion Timeline More menu and confirm @keyframes CSS
          const moreBtn = document.querySelector('[data-testid="motion-more-btn"]');
          moreBtn?.click();
          const moreMenuDeadline = Date.now() + 2000;
          while (Date.now() < moreMenuDeadline && !document.querySelector('[data-testid="motion-more-menu"]')) {
            await new Promise((r) => setTimeout(r, 25));
          }
          const previewItem = Array.from(
            document.querySelectorAll('[data-testid="motion-more-menu"] [role="menuitem"]'),
          ).find((el) => el.textContent?.includes('Test in Live Preview'));
          previewItem?.click();
          const previewDeadline = Date.now() + 5000;
          while (Date.now() < previewDeadline && !document.querySelector('.live-preview-iframe')) {
            await new Promise((r) => setTimeout(r, 50));
          }
          const srcdoc = document.querySelector('.live-preview-iframe')?.getAttribute('srcdoc') ?? '';

          return {
            docked: Boolean(dock),
            shellHasClass,
            trackCount,
            initialKeyframes,
            clipLabel,
            timecodeAfterScrub,
            playheadPctAfterKeyboard,
            scrubStart,
            scrubMid,
            scrubEnd,
            scrubPaddedMid,
            scrubResizedMid,
            hasEasingSelect,
            hasKeyframesCss: srcdoc.includes('@keyframes folio-kf-'),
            hasReducedMotionGuard: srcdoc.includes('prefers-reduced-motion: reduce'),
          };
        `);

        expect(motionResult.docked).toBe(true);
        expect(motionResult.shellHasClass).toBe(true);
        expect(motionResult.trackCount).toBeGreaterThanOrEqual(4);
        expect(motionResult.initialKeyframes).toBeGreaterThanOrEqual(8);
        expect(motionResult.clipLabel).toContain('Hero Entrance');
        expect(motionResult.timecodeAfterScrub).toContain('0.40s');
        expect(motionResult.playheadPctAfterKeyboard).toBeCloseTo((400 / 1200) * 100, 1);
        expect(motionResult.scrubStart.timecode).toContain('0.00s');
        expect(motionResult.scrubStart.playheadPct).toBeCloseTo(0, 1);
        expect(motionResult.scrubMid.timecode).toContain('0.60s');
        expect(motionResult.scrubMid.playheadPct).toBeCloseTo(50, 1);
        expect(motionResult.scrubEnd.timecode).toContain('1.20s');
        expect(motionResult.scrubEnd.playheadPct).toBeCloseTo(100, 1);
        expect(motionResult.scrubPaddedMid.timecode).toContain('0.60s');
        expect(motionResult.scrubPaddedMid.playheadPct).toBeCloseTo(50, 1);
        expect(motionResult.scrubResizedMid.timecode).toContain('0.60s');
        expect(motionResult.scrubResizedMid.playheadPct).toBeCloseTo(50, 1);
        expect(motionResult.hasEasingSelect).toBe(true);
        expect(motionResult.hasKeyframesCss).toBe(true);
        expect(motionResult.hasReducedMotionGuard).toBe(true);
        expect(browser.consoleErrors).toEqual([]);
        expect(browser.pageErrors).toEqual([]);
      } finally {
        await browser.cleanup();
        await server.close();
      }
    },
    30000,
  );
});
