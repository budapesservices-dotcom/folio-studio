import { spawn, spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer as createViteServer } from 'vite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

const candidates = [
  process.env.CHROMIUM_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

function findChromium() {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

const chromium = findChromium();
const canRunBrowser = Boolean(chromium && typeof WebSocket !== 'undefined');
const browserIt = canRunBrowser ? it : it.skip;
const testTitle = canRunBrowser
  ? 'runs actual Preact App Rack keyboard, pointer, stacking and geometry acceptance'
  : 'actual App Rack acceptance (SKIPPED: Chromium or Node WebSocket unavailable; set CHROMIUM_BIN)';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 360, height: 280 },
  { width: 240, height: 180 },
];

async function startViteApp() {
  const server = await createViteServer({
    configFile: resolve(process.cwd(), 'vite.config.ts'),
    base: '/',
    mode: 'test',
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  });
  await server.listen();

  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Vite did not expose its HTTP server address.');
  }

  const url = 'http://127.0.0.1:' + address.port + '/';
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(url);
        if (response.ok) { ready = true; break; }
      } catch {
        // Vite is still becoming ready.
      }
      await delay(50);
    }
    if (!ready) throw new Error('Vite-served Folio App did not become ready.');
    return { url, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function launchChromium() {
  if (!chromium) throw new Error('Chromium is unavailable; set CHROMIUM_BIN.');
  // Each test gets a unique browser profile, isolating localStorage and IndexedDB.
  const profile = mkdtempSync(join(tmpdir(), 'folio-app-rack-profile-'));
  const portServer = createNetServer();
  await new Promise((resolvePort, reject) => {
    portServer.once('error', reject);
    portServer.listen(0, '127.0.0.1', resolvePort);
  });
  const port = portServer.address().port;
  await new Promise((resolveClose, reject) =>
    portServer.close((error) => error ? reject(error) : resolveClose()),
  );

  const child = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-networking',
    '--disable-extensions', '--disable-breakpad', '--disable-crash-reporter',
    '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank',
  ], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });

  let socket;
  let stderr = '';
  let cleaned = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { socket?.close(); } catch { /* Ignore closed socket. */ }
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      const stopped = await Promise.race([exited.then(() => true), delay(4000).then(() => false)]);
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        await Promise.race([exited, delay(2000)]);
      }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };

  try {
    let targets;
    const endpoint = 'http://127.0.0.1:' + port + '/json/list';
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) { targets = await response.json(); break; }
      } catch {
        // Chromium is still starting its DevTools endpoint.
      }
      await delay(100);
    }
    if (!targets) throw new Error('Chromium DevTools startup timeout: ' + stderr.slice(-1500));
    const page = targets.find((target) => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chromium did not expose its page target.');

    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      const timeout = setTimeout(() => reject(new Error('DevTools websocket timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('DevTools websocket error'));
      }, { once: true });
    });

    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'DevTools command failed'));
      else entry.resolve(message.result);
    });

    const send = (method, params = {}) => new Promise((resolveResult, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('DevTools command timed out: ' + method));
      }, 15000);
      pending.set(id, { resolve: resolveResult, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true, userGesture: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    };

    const setViewport = async ({ width, height }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      });
      await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };

    const pressTab = async () => {
      const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    };

    const pressTabs = async (count) => {
      for (let index = 0; index < count; index += 1) await pressTab();
    };

    const focus = async (selector) => {
      const focused = await evaluate(
        '(() => { const element = document.querySelector(' + JSON.stringify(selector) + '); ' +
        'if (!element) throw new Error("Focus target missing: " + ' + JSON.stringify(selector) + '); ' +
        'element.focus({ preventScroll: true }); return document.activeElement === element; })()',
      );
      if (!focused) throw new Error('Browser refused focus for ' + selector);
    };

    const click = async (selector) => {
      const point = await evaluate(
        '(() => { const element = document.querySelector(' + JSON.stringify(selector) + '); ' +
        'if (!element) throw new Error("Click target missing: " + ' + JSON.stringify(selector) + '); ' +
        'element.scrollIntoView({ block: "center", inline: "nearest" }); ' +
        'const rect = element.getBoundingClientRect(); ' +
        'if (rect.width <= 0 || rect.height <= 0) throw new Error("Click target has no rendered area."); ' +
        'return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()',
      );
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
    };

    const wheel = async (selector, deltaY = 180) => {
      const point = await evaluate(
        '(() => { const element = document.querySelector(' + JSON.stringify(selector) + '); ' +
        'if (!element) throw new Error("Scroll target missing: " + ' + JSON.stringify(selector) + '); ' +
        'const rect = element.getBoundingClientRect(); ' +
        'return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()',
      );
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY,
      });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    return {
      send, evaluate, setViewport, pressTab, pressTabs, focus, click, wheel,
      insertText: (text) => send('Input.insertText', { text }),
      navigate: (url) => send('Page.navigate', { url }),
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function waitFor(browser, expression, description, timeout = 15000) {
  try {
    await browser.evaluate(
      'new Promise((resolve, reject) => {' +
      'const deadline = Date.now() + ' + timeout + ';' +
      'const check = () => {' +
      'let passed = false;' +
      'try { passed = Boolean(' + expression + '); } catch (error) { reject(error); return; }' +
      'if (passed) resolve(true);' +
      'else if (Date.now() >= deadline) reject(new Error("Timed out waiting for " + ' + JSON.stringify(description) + '));' +
      'else setTimeout(check, 50);' +
      '}; check(); })',
    );
  } catch (error) {
    throw new Error('Browser wait failed (' + description + '): ' + String(error));
  }
}

async function waitForRackAnimation(browser, selector) {
  await waitFor(
    browser,
    '(() => { const panel = document.querySelector(' + JSON.stringify(selector) + '); ' +
    'return panel && panel.classList.contains("is-open") && !panel.inert; })()',
    selector + ' opened',
  );
  await browser.evaluate(
    'Promise.all(Array.from(document.querySelector(' + JSON.stringify(selector) + ').getAnimations())' +
    '.map((animation) => animation.finished.catch(() => undefined)))',
  );
}

async function runAppAcceptance() {
  let vite;
  let browser;
  try {
    vite = await startViteApp();
    browser = await launchChromium();
    await browser.setViewport({ width: 1280, height: 800 });
    await browser.send('Storage.clearDataForOrigin', {
      origin: new URL(vite.url).origin,
      storageTypes: 'all',
    });
    await browser.navigate(vite.url);

    await waitFor(
      browser,
      'document.querySelector(".app-shell") && document.querySelector(".app-shell").getAttribute("aria-busy") === "false"',
      'real Preact App hydration',
      30000,
    );

    const ready = await browser.evaluate(
      '({appRoot:!!document.querySelector("#app .app-shell"),module:!!document.querySelector("script[type=module]"),' +
      'hydrationOverlay:!!document.querySelector(".project-hydration-overlay"),indexedDb:("indexedDB" in window)})',
    );
    expect(ready.appRoot).toBe(true);
    expect(ready.module).toBe(true);
    expect(ready.hydrationOverlay).toBe(false);
    expect(ready.indexedDb).toBe(true);

    const initial = await browser.evaluate(
      '(() => { const p=document.querySelector(".pages-rack-panel"); const c=document.querySelector(".component-rack-panel"); ' +
      'return {pagesClosed:p.inert && p.getAttribute("aria-hidden")==="true",' +
      'componentsClosed:c.inert && c.getAttribute("aria-hidden")==="true",' +
      'pagesPointer:getComputedStyle(p).pointerEvents,componentsPointer:getComputedStyle(c).pointerEvents}; })()',
    );
    expect(initial).toEqual({
      pagesClosed: true,
      componentsClosed: true,
      pagesPointer: 'none',
      componentsPointer: 'none',
    });

    // Real Tab key events and focusin observations prove both closed Rack subtrees are skipped.
    await browser.evaluate(
      '(() => { const p=document.querySelector(".pages-rack-panel"); const c=document.querySelector(".component-rack-panel"); ' +
      'window.__rackTabViolations=[]; document.addEventListener("focusin",e=>{' +
      'if(p.contains(e.target)||c.contains(e.target)) window.__rackTabViolations.push(e.target.className||e.target.tagName);' +
      '},true); })()',
    );
    await browser.focus('.pages-rack-header-toggle');
    await browser.pressTabs(100);
    const pagesTabs = await browser.evaluate(
      '({violations:window.__rackTabViolations.slice(),inert:document.querySelector(".pages-rack-panel").inert})',
    );
    expect(pagesTabs.violations).toEqual([]);
    expect(pagesTabs.inert).toBe(true);

    await browser.evaluate('window.__rackTabViolations=[]');
    await browser.focus('.component-rack-header-toggle');
    await browser.pressTabs(100);
    const componentTabs = await browser.evaluate(
      '({violations:window.__rackTabViolations.slice(),inert:document.querySelector(".component-rack-panel").inert})',
    );
    expect(componentTabs.violations).toEqual([]);
    expect(componentTabs.inert).toBe(true);

    await browser.focus('.pages-rack-header-toggle');
    expect(await browser.evaluate(
      '(() => { const p=document.querySelector(".pages-rack-panel"); p.querySelector(".pages-rack-name-input").focus(); return p.contains(document.activeElement); })()',
    )).toBe(false);
    await browser.focus('.component-rack-header-toggle');
    expect(await browser.evaluate(
      '(() => { const p=document.querySelector(".component-rack-panel"); p.querySelector(".component-rack-search").focus(); return p.contains(document.activeElement); })()',
    )).toBe(false);

    // Click each closed Rack's would-be open rectangle and observe real pointerdown targets.
    await browser.evaluate(
      '(() => { const p=document.querySelector(".pages-rack-panel"); const c=document.querySelector(".component-rack-panel"); ' +
      'window.__closedRackPointerHits={pages:0,components:0}; document.addEventListener("pointerdown",e=>{' +
      'if(p.contains(e.target)) window.__closedRackPointerHits.pages++; if(c.contains(e.target)) window.__closedRackPointerHits.components++;' +
      '},true); })()',
    );
    const pointerPoints = await browser.evaluate(
      '(() => { const s=document.querySelector(".app-shell"); const r=s.getBoundingClientRect(); ' +
      'const point=p=>({x:r.left+p.offsetLeft+p.offsetWidth/2,y:r.top+p.offsetTop+p.offsetHeight/2}); ' +
      'return {pages:point(document.querySelector(".pages-rack-panel")),' +
      'components:point(document.querySelector(".component-rack-panel"))}; })()',
    );
    for (const point of [pointerPoints.pages, pointerPoints.components]) {
      await browser.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
      await browser.send('Input.dispatchMouseEvent', {
        type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1,
      });
      await browser.send('Input.dispatchMouseEvent', {
        type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1,
      });
    }
    expect(await browser.evaluate('window.__closedRackPointerHits')).toEqual({ pages:0, components:0 });

    // Pages Rack opens in the real App; its input and subsequent close control participate in Tab order.
    await browser.click('.pages-rack-header-toggle');
    await waitForRackAnimation(browser, '.pages-rack-panel');
    await browser.focus('.pages-rack-name-input');
    await browser.pressTab();
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".pages-rack-panel .component-rack-close")',
    )).toBe(true);

    await browser.click('.pages-rack-panel .component-rack-close');
    await waitFor(browser, 'document.querySelector(".pages-rack-panel").inert', 'Pages close button');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".pages-rack-header-toggle")',
    )).toBe(true);

    // Closing through the Pages toolbar toggle keeps focus on that toggle.
    await browser.click('.pages-rack-header-toggle');
    await waitForRackAnimation(browser, '.pages-rack-panel');
    await browser.click('.pages-rack-header-toggle');
    await waitFor(browser, 'document.querySelector(".pages-rack-panel").inert', 'Pages toolbar close');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".pages-rack-header-toggle")',
    )).toBe(true);

    // Component Rack opens and its first enabled action is reached by sequential Tab.
    await browser.click('.component-rack-header-toggle');
    await waitForRackAnimation(browser, '.component-rack-panel');
    await browser.focus('.component-rack-search');
    await browser.pressTab();
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".component-rack-panel .component-rack-save")',
    )).toBe(true);

    await browser.click('.component-rack-panel .component-rack-close');
    await waitFor(browser, 'document.querySelector(".component-rack-panel").inert', 'Component close button');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".component-rack-header-toggle")',
    )).toBe(true);

    await browser.click('.component-rack-header-toggle');
    await waitForRackAnimation(browser, '.component-rack-panel');
    await browser.click('.component-rack-header-toggle');
    await waitFor(browser, 'document.querySelector(".component-rack-panel").inert', 'Component toolbar close');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".component-rack-header-toggle")',
    )).toBe(true);

    // Switching the visible Rack in either direction inerts the previous one.
    await browser.click('.pages-rack-header-toggle');
    await waitForRackAnimation(browser, '.pages-rack-panel');
    await browser.click('.component-rack-header-toggle');
    await waitForRackAnimation(browser, '.component-rack-panel');
    expect(await browser.evaluate(
      '(() => ({active:document.activeElement===document.querySelector(".component-rack-header-toggle"),' +
      'oldInert:document.querySelector(".pages-rack-panel").inert,oldAria:document.querySelector(".pages-rack-panel").getAttribute("aria-hidden"),' +
      'newInert:document.querySelector(".component-rack-panel").inert,newAria:document.querySelector(".component-rack-panel").getAttribute("aria-hidden")}))()',
    )).toEqual({ active:true, oldInert:true, oldAria:'true', newInert:false, newAria:'false' });

    await browser.click('.pages-rack-header-toggle');
    await waitForRackAnimation(browser, '.pages-rack-panel');
    expect(await browser.evaluate(
      '(() => ({active:document.activeElement===document.querySelector(".pages-rack-header-toggle"),' +
      'oldInert:document.querySelector(".component-rack-panel").inert,oldAria:document.querySelector(".component-rack-panel").getAttribute("aria-hidden"),' +
      'newInert:document.querySelector(".pages-rack-panel").inert,newAria:document.querySelector(".pages-rack-panel").getAttribute("aria-hidden")}))()',
    )).toEqual({ active:true, oldInert:true, oldAria:'true', newInert:false, newAria:'false' });
    await browser.click('.pages-rack-header-toggle');
    await waitFor(browser, 'document.querySelector(".pages-rack-panel").inert', 'close Pages before test data');

    // Create enough Pages through the App Add Page control so the actual list must scroll.
    for (let index=0; index<12; index+=1) {
      await browser.click('.pages-rack-header-toggle');
      await waitForRackAnimation(browser, '.pages-rack-panel');
      await browser.focus('.pages-rack-name-input');
      await browser.insertText('Browser Acceptance Page ' + (index+1));
      await waitFor(browser, '!document.querySelector(".pages-rack-add").disabled', 'Add Page enabled');
      await browser.click('.pages-rack-add');
      await waitFor(browser, 'document.querySelector(".pages-rack-panel").inert', 'App Add Page handler');
    }

    // Create real Component definitions via the Rack New Component control and Preact handler.
    for (let index=0; index<12; index+=1) {
      await browser.click('.component-rack-header-toggle');
      await waitForRackAnimation(browser, '.component-rack-panel');
      await browser.click('.component-rack-panel .component-rack-save');
      await waitFor(
        browser,
        'document.querySelector(".component-rack-panel").inert && !!document.querySelector("#component-canvas")',
        'App New Component handler',
      );
    }
    await delay(800);

    const counts = await browser.evaluate(
      '({pages:document.querySelectorAll(".pages-rack-card").length,' +
      'components:document.querySelectorAll(".component-rack-card").length,' +
      'main:!!document.querySelector("#main-canvas"),componentCanvas:!!document.querySelector("#component-canvas")})',
    );
    expect(counts.pages).toBeGreaterThanOrEqual(13);
    expect(counts.components).toBeGreaterThanOrEqual(12);
    expect(counts.main).toBe(true);
    expect(counts.componentCanvas).toBe(true);

    // Clicking the real FloatingWindow title bars must continue to update shared window stacking.
    const stackBefore = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("#main-canvas")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("#component-canvas")).zIndex)})',
    );
    await browser.click('#component-canvas .workspace-toolbar-draggable');
    const componentRaised = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("#main-canvas")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("#component-canvas")).zIndex)})',
    );
    expect(componentRaised.component).toBeGreaterThan(componentRaised.main);

    await browser.click('#main-canvas .workspace-toolbar-draggable');
    const mainRaised = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("#main-canvas")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("#component-canvas")).zIndex)})',
    );
    expect(mainRaised.main).toBeGreaterThan(mainRaised.component);
    expect(Number.isFinite(stackBefore.main)).toBe(true);
    expect(Number.isFinite(stackBefore.component)).toBe(true);

    // Measure actual body, app-shell and actual Rack DOM at all requested rendered viewports.
    const geometry = [];
    for (const viewport of VIEWPORTS) {
      await browser.setViewport(viewport);
      const shell = await browser.evaluate(
        '(() => { const b=document.body.getBoundingClientRect(); const e=document.querySelector(".app-shell"); const r=e.getBoundingClientRect(); ' +
        'return {body:{width:b.width,height:b.height},shell:{width:r.width,height:r.height},' +
        'bodyMinWidth:getComputedStyle(document.body).minWidth,shellMinHeight:getComputedStyle(e).minHeight,' +
        'viewport:{width:innerWidth,height:innerHeight}}; })()',
      );
      expect(shell.viewport).toEqual(viewport);
      expect(shell.body).toEqual(viewport);
      expect(shell.shell).toEqual(viewport);
      if (viewport.width<=700) {
        expect(shell.bodyMinWidth).toBe('0px');
        expect(shell.shellMinHeight).toBe('0px');
      }

      const racks = [];
      const definitions = [
        { toggle:'.pages-rack-header-toggle', panel:'.pages-rack-panel', list:'.pages-rack-list' },
        { toggle:'.component-rack-header-toggle', panel:'.component-rack-panel', list:'.component-rack-list' },
      ];
      for (const rack of definitions) {
        await browser.click(rack.toggle);
        await waitForRackAnimation(browser, rack.panel);
        const metrics = await browser.evaluate(
          '(() => { const s=document.querySelector(".app-shell").getBoundingClientRect(); ' +
          'const p=document.querySelector(' + JSON.stringify(rack.panel) + '); const r=p.getBoundingClientRect(); ' +
          'const l=p.querySelector(' + JSON.stringify(rack.list) + '); ' +
          'return {rect:{left:r.left-s.left,top:r.top-s.top,width:r.width,height:r.height,right:r.right-s.left,bottom:r.bottom-s.top},' +
          'minHeight:getComputedStyle(p).minHeight,maxHeight:getComputedStyle(p).maxHeight,' +
          'overflowY:getComputedStyle(l).overflowY,clientHeight:l.clientHeight,scrollHeight:l.scrollHeight}; })()',
        );
        racks.push({ panel:rack.panel, ...metrics });

        expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
        expect(metrics.rect.top).toBeGreaterThanOrEqual(56);
        expect(metrics.rect.right).toBeLessThanOrEqual(viewport.width);
        expect(metrics.rect.bottom).toBeLessThanOrEqual(viewport.height-27);
        expect(metrics.rect.width).toBeLessThanOrEqual(viewport.width);
        expect(metrics.rect.height).toBeLessThanOrEqual(viewport.height-83);
        expect(metrics.minHeight).toBe('0px');
        expect(metrics.overflowY).toBe('auto');
        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

        await browser.wheel(rack.list, 200);
        await delay(100);
        const scrollTop = await browser.evaluate(
          'document.querySelector(' + JSON.stringify(rack.list) + ').scrollTop',
        );
        expect(scrollTop).toBeGreaterThan(0);
        await browser.click(rack.toggle);
        await waitFor(
          browser,
          'document.querySelector(' + JSON.stringify(rack.panel) + ').inert',
          rack.panel + ' closed after geometry',
        );
      }
      geometry.push({ viewport, ...shell, racks });
    }

    return { counts, stackBefore, componentRaised, mainRaised, geometry };
  } finally {
    try { await browser?.close(); } finally {
      await vite?.close();
    }
  }
}

describe('Production Preact App Rack browser acceptance (Vite + Chromium CDP)', () => {
  browserIt(testTitle, async () => {
    const result = await runAppAcceptance();
    expect(result.counts.pages).toBeGreaterThanOrEqual(13);
    expect(result.counts.components).toBeGreaterThanOrEqual(12);
    expect(result.componentRaised.component).toBeGreaterThan(result.componentRaised.main);
    expect(result.mainRaised.main).toBeGreaterThan(result.mainRaised.component);

    for (const size of VIEWPORTS) {
      const actual = result.geometry.find((entry) =>
        entry.viewport.width===size.width && entry.viewport.height===size.height,
      );
      expect(actual).toBeDefined();
      expect(actual.body).toEqual(size);
      expect(actual.shell).toEqual(size);
      expect(actual.racks).toHaveLength(2);
      for (const rack of actual.racks) {
        expect(rack.rect.left).toBeGreaterThanOrEqual(0);
        expect(rack.rect.right).toBeLessThanOrEqual(size.width);
        expect(rack.rect.top).toBeGreaterThanOrEqual(56);
        expect(rack.rect.bottom).toBeLessThanOrEqual(size.height-27);
        expect(rack.rect.height).toBeLessThanOrEqual(size.height-83);
      }
    }
  }, 120000);
});
