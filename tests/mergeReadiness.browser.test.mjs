import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createServer as createViteServer } from 'vite';

const chromiumCandidates = [
  process.env.CHROMIUM_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

function findChromium() {
  for (const candidate of chromiumCandidates) {
    if (existsSync(candidate)) return candidate;
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

const chromium = findChromium();

async function launchChromium(url) {
  const profile = mkdtempSync(join(tmpdir(), 'folio-merge-readiness-profile-'));
  const activePortPath = join(profile, 'DevToolsActivePort');
  const chromiumEnv = { ...process.env };
  for (const key of [
    'DBUS_SESSION_BUS_ADDRESS',
    'DBUS_SESSION_BUS_PID',
    'DBUS_SYSTEM_BUS_ADDRESS',
    'DBUS_STARTER_ADDRESS',
    'DBUS_STARTER_BUS_TYPE',
  ]) delete chromiumEnv[key];

  const child = spawn(chromium, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    url,
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: chromiumEnv,
  });

  let socket;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const cleanup = async () => {
    try { socket?.close(); } catch { /* ignore */ }
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
      await delay(300);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
    } else {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    let port = null;
    const deadline = Date.now() + 20000;
    while (!port && Date.now() < deadline) {
      if (existsSync(activePortPath)) {
        const { readFileSync } = await import('node:fs');
        const firstLine = readFileSync(activePortPath, 'utf8').split(/\r?\n/)[0]?.trim();
        const parsed = Number.parseInt(firstLine ?? '', 10);
        if (Number.isInteger(parsed) && parsed > 0) port = parsed;
      }
      if (!port) await delay(50);
    }
    if (!port) throw new Error(`Chromium DevToolsActivePort unavailable.\n${stderr}`);

    let target = null;
    while (!target && Date.now() < deadline) {
      try {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
        target = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      } catch {
        // retry
      }
      if (!target) await delay(60);
    }
    if (!target) throw new Error(`Chromium CDP page target unavailable.\n${stderr}`);

    socket = new WebSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const consoleErrors = [];
    const pageErrors = [];

    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', rejectOpen, { once: true });
    });

    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        pageErrors.push(d?.exception?.description ?? d?.text ?? 'Uncaught exception');
      }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    return { send, evalJs, cleanup, consoleErrors, pageErrors };
  } catch (error) {
    await cleanup();
    throw error;
  }
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

          // WEB-02: File & View button vertical alignment + placeholder menus disabled
          const fileBtn = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger')).find((b) => b.textContent?.trim() === 'File');
          const viewBtn = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger')).find((b) => b.textContent?.trim() === 'View');
          const fileRect = fileBtn?.getBoundingClientRect();
          const viewRect = viewBtn?.getBoundingClientRect();
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
            fileRect: fileRect ? { top: fileRect.top, height: fileRect.height } : null,
            viewRect: viewRect ? { top: viewRect.top, height: viewRect.height } : null,
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
        expect(baseline.fileRect).toBeTruthy();
        expect(baseline.viewRect).toBeTruthy();
        expect(Math.abs(baseline.fileRect.top - baseline.viewRect.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(baseline.fileRect.height - baseline.viewRect.height)).toBeLessThanOrEqual(1);
        expect(baseline.disabledPlaceholders.length).toBeGreaterThanOrEqual(4);
        expect(baseline.disabledPlaceholders.every((p) => p.ariaDisabled === 'true')).toBe(true);
        expect(baseline.panelGroups).toEqual(['Racks', 'Side panels', 'Workspace windows']);
        expect(baseline.panelDividers).toBe(3);

        // 2. WEB-02 Menu open, above-tool-rail stacking, & Escape / outside-click dismissal
        const menuDismissal = await browser.evalJs(`
          const fileBtn = Array.from(document.querySelectorAll('.global-menu-item.menu-trigger')).find((b) => b.textContent?.trim() === 'File');
          fileBtn.click();
          await new Promise((r) => setTimeout(r, 40));
          const exportItem = Array.from(document.querySelectorAll('.global-menu-dropdown [role="menuitem"]')).find((b) => b.textContent?.trim() === 'Export Project');
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
        const toolRackCheck = await browser.evalJs(`
          const layersToggle = document.querySelector('button[aria-label="Show or hide Layers sidebar"]');
          layersToggle.click();
          await new Promise((r) => setTimeout(r, 60));

          const createBtn = document.querySelector('button[aria-label="Create tools"]');
          createBtn.click();
          await new Promise((r) => setTimeout(r, 60));

          const menu = document.querySelector('.tool-rack-menu');
          const firstItem = menu?.querySelector('.tool-rack-item');
          const rect = firstItem?.getBoundingClientRect();
          const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
          const flyoutClickable = Boolean(hit && menu.contains(hit));

          // Escape dismisses flyout
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
          const dismissed = !document.querySelector('.tool-rack-menu');

          // Restore Layers
          layersToggle.click();
          await new Promise((r) => setTimeout(r, 60));

          return { flyoutClickable, dismissed };
        `);
        expect(toolRackCheck).toEqual({ flyoutClickable: true, dismissed: true });

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

          // WEB-10: Create Rect, Ellipse, and Text inside Component Canvas (420x280)
          const addFromCreateMenu = async (label) => {
            document.querySelector('button[aria-label="Create tools"]').click();
            await new Promise((r) => setTimeout(r, 40));
            const item = Array.from(document.querySelectorAll('.tool-rack-item')).find((el) => el.textContent?.includes(label));
            item.click();
            await new Promise((r) => setTimeout(r, 60));
          };

          await addFromCreateMenu('Rectangle');
          await addFromCreateMenu('Ellipse');
          await addFromCreateMenu('Text');

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

        expect(browser.consoleErrors).toEqual([]);
        expect(browser.pageErrors).toEqual([]);
      } finally {
        await browser.cleanup();
        await server.close();
      }
    },
    45000,
  );
});
