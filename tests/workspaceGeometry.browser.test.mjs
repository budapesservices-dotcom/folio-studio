import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createServer as createViteServer } from 'vite';
import { WINDOW_CHROME, getDefaultWindowLayouts } from '../src/app/windowManager';

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
const browserIt = chromium && typeof WebSocket !== 'undefined' ? it : it.skip;
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 360, height: 280 },
  { width: 240, height: 180 },
];

const button = (id, label, className = '') =>
  '<button id="' + id + '" type="button" class="' + className + '">' + label + '</button>';

function createFixture(css) {
  const pages = Array.from({ length: 18 }, (_, i) =>
    '<button class="pages-rack-card" type="button">Page ' + (i + 1) + '</button>').join('');
  const components = Array.from({ length: 24 }, (_, i) =>
    '<article class="component-rack-card"><button class="component-rack-preview" type="button">Component ' +
    (i + 1) + '</button></article>').join('');
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><style>' + css +
    '</style></head><body><div id="app"><div class="app-shell" id="shell">' +
    '<header class="global-toolbar-slot">' + button('pages-toggle', 'Pages') +
    button('component-toggle', 'Components') + button('toolbar-end', 'End toolbar') +
    '</header><nav class="tool-rail"></nav><aside class="layers-panel"></aside>' +
    '<main style="grid-area:workspace"></main><aside class="inspector-panel"></aside>' +
    '<footer class="statusbar"></footer><div class="workspace canvas-floating" id="floating-window"></div>' +
    '<section id="pages-rack" class="pages-rack-panel" aria-label="Pages Rack" aria-hidden="true" inert>' +
    '<div class="pages-rack-heading"><div class="pages-rack-title"><span class="panel-kicker">PROJECT STRUCTURE</span>' +
    '<strong>Pages</strong><span class="pages-rack-count">18</span></div><div class="pages-rack-actions">' +
    '<input id="pages-input" class="pages-rack-name-input" aria-label="New page name">' +
    button('pages-add', 'Add page', 'pages-rack-add') +
    button('pages-close', 'Close Pages Rack', 'component-rack-close') +
    '</div></div><div class="pages-rack-list">' + pages + '</div></section>' +
    '<section id="component-rack" class="component-rack-panel" aria-label="Component Rack" aria-hidden="true" inert>' +
    '<div class="component-rack-heading"><div class="component-rack-title"><span class="panel-kicker">YOUR LIBRARY</span>' +
    '<strong>Component Rack</strong><span class="component-rack-count">24</span></div><div class="component-rack-actions">' +
    '<input id="component-input" class="component-rack-search" aria-label="Search components">' +
    button('component-new', 'New component', 'component-rack-save') +
    button('component-save', 'Save selection', 'component-rack-save') +
    button('component-close', 'Close Component Rack', 'component-rack-close') +
    '</div></div><div class="component-rack-list">' + components + '</div></section>' +
    '</div></div></body></html>';
}

async function launchChromium(path) {
  const profile = mkdtempSync(join(tmpdir(), 'folio-rack-chromium-profile-'));
  const portServer = createServer();
  await new Promise((resolvePort, reject) => {
    portServer.once('error', reject);
    portServer.listen(0, '127.0.0.1', resolvePort);
  });
  const port = portServer.address().port;
  await new Promise((resolveClose, reject) => portServer.close((error) => error ? reject(error) : resolveClose()));
  const child = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-networking',
    '--disable-extensions', '--disable-breakpad', '--disable-crash-reporter',
    '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, 'file://' + path,
  ], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const cleanup = async () => {
    try { socket?.close(); } catch { /* Ignore an already closed socket. */ }
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { child.kill('SIGTERM'); }
      const stopped = await Promise.race([exited.then(() => true), delay(4000).then(() => false)]);
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { child.kill('SIGKILL'); }
        await Promise.race([exited, delay(2000)]);
      }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    let targets;
    const endpoint = 'http://127.0.0.1:' + port + '/json/list';
    const startupDeadline = Date.now() + 20000;
    while (Date.now() < startupDeadline && child.exitCode === null) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) { targets = await response.json(); break; }
      } catch { /* Chromium is still starting its local DevTools endpoint. */ }
      await delay(100);
    }
    if (!targets) throw new Error('Chromium DevTools startup timeout: ' + stderr.slice(-1000));
    const page = targets?.find((target) => target.type === 'page' && target.url.startsWith('file://'));
    if (!page?.webSocketDebuggerUrl) throw new Error('Chromium did not expose the fixture page');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      const timeout = setTimeout(() => reject(new Error('DevTools websocket timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('DevTools websocket error')); }, { once: true });
    });

    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || 'DevTools command failed'));
      else entry.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolveResult, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: resolveResult, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    };
    const viewport = async ({ width, height }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      });
      await evaluate('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))');
    };
    const pressTab = async () => {
      const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate('document.readyState === "complete"')) break;
      await delay(100);
    }
    return {
      evaluate, viewport, pressTab, close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function runRackBrowserChecks() {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
  const directory = mkdtempSync(join(tmpdir(), 'folio-rack-fixture-'));
  const path = join(directory, 'workspace.html');
  writeFileSync(path, createFixture(css));
  let browser;
  try {
    browser = await launchChromium(path);
    const geometry = [];
    for (const viewport of VIEWPORTS) {
      await browser.viewport(viewport);
      const expected = getDefaultWindowLayouts(viewport)['main-canvas'];
      const actual = await browser.evaluate(`(async () => {
        const shell = document.getElementById('shell');
        const bounds = shell.getBoundingClientRect();
        const floating = document.getElementById('floating-window');
        const layout = ${JSON.stringify(expected)};
        Object.assign(floating.style, {
          left: layout.position.x + 'px', top: layout.position.y + 'px',
          width: layout.size.width + 'px', height: layout.size.height + 'px', zIndex: '120',
        });
        const panels = [
          [document.getElementById('pages-rack'), '.pages-rack-list'],
          [document.getElementById('component-rack'), '.component-rack-list'],
        ];
        panels.forEach(([panel]) => {
          panel.classList.add('is-open');
          panel.inert = false;
          panel.removeAttribute('inert');
          panel.setAttribute('aria-hidden', 'false');
        });
        // Wait for the Rack's actual CSS transitions rather than sampling an intermediate transform.
        await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        await Promise.all(panels.flatMap(([panel]) =>
          panel.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
        ));
        const metrics = panels.map(([panel, listSelector]) => {
          const rect = panel.getBoundingClientRect();
          const list = panel.querySelector(listSelector);
          return {
            left: rect.left - bounds.left, top: rect.top - bounds.top,
            width: rect.width, height: rect.height,
            right: rect.right - bounds.left, bottom: rect.bottom - bounds.top,
            listClientHeight: list.clientHeight, listScrollHeight: list.scrollHeight,
            listOverflowY: getComputedStyle(list).overflowY,
          };
        });
        const rect = floating.getBoundingClientRect();
        return {
          shell: { width: bounds.width, height: bounds.height },
          bodyMinWidth: getComputedStyle(document.body).minWidth,
          shellMinHeight: getComputedStyle(shell).minHeight,
          window: {
            left: rect.left - bounds.left, top: rect.top - bounds.top,
            width: rect.width, height: rect.height,
            right: rect.right - bounds.left, bottom: rect.bottom - bounds.top,
          },
          pages: metrics[0], components: metrics[1],
        };
      })()`);
      geometry.push({ viewport, expected, actual });
    }

    await browser.viewport({ width: 1280, height: 800 });
    const keyboardStart = await browser.evaluate(`(() => {
      const pages = document.getElementById('pages-rack');
      const components = document.getElementById('component-rack');
      const pagesToggle = document.getElementById('pages-toggle');
      const componentToggle = document.getElementById('component-toggle');
      const open = (panel) => {
        panel.inert = false;
        panel.removeAttribute('inert');
        panel.setAttribute('aria-hidden', 'false');
        panel.classList.add('is-open');
      };
      const close = (panel, toggle) => {
        if (panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
        panel.inert = true;
        panel.setAttribute('inert', '');
        panel.setAttribute('aria-hidden', 'true');
        panel.classList.remove('is-open');
      };
      pagesToggle.addEventListener('click', () => {
        if (!pages.inert) close(pages, pagesToggle);
        else { open(pages); close(components, componentToggle); }
      });
      componentToggle.addEventListener('click', () => {
        if (!components.inert) close(components, componentToggle);
        else { open(components); close(pages, pagesToggle); }
      });
      document.getElementById('pages-close').addEventListener('click', () => close(pages, pagesToggle));
      document.getElementById('component-close').addEventListener('click', () => close(components, componentToggle));
      close(pages, pagesToggle);
      close(components, componentToggle);
      pagesToggle.focus();
      return {
        inertSupported: 'inert' in pages && 'inert' in components,
        pagesInitiallyInert: pages.inert && pages.getAttribute('aria-hidden') === 'true',
        componentsInitiallyInert: components.inert && components.getAttribute('aria-hidden') === 'true',
      };
    })()`);

    await browser.pressTab();
    const pagesClosedTab = await browser.evaluate('document.activeElement.id');
    await browser.pressTab();
    const componentClosedTab = await browser.evaluate('document.activeElement.id');

    await browser.evaluate(`(() => {
      const toggle = document.getElementById('pages-toggle');
      toggle.focus();
      toggle.click();
      document.getElementById('toolbar-end').focus();
    })()`);
    await browser.pressTab();
    const pagesOpenTab = await browser.evaluate('document.activeElement.id');

    const pagesCloseFocus = await browser.evaluate(`(() => {
      const close = document.getElementById('pages-close');
      const panel = document.getElementById('pages-rack');
      close.focus();
      close.click();
      return { active: document.activeElement.id, inert: panel.inert, ariaHidden: panel.getAttribute('aria-hidden') };
    })()`);
    const pagesToolbarClose = await browser.evaluate(`(() => {
      const panel = document.getElementById('pages-rack');
      const toggle = document.getElementById('pages-toggle');
      toggle.focus();
      toggle.click();
      toggle.click();
      return { active: document.activeElement.id, inert: panel.inert };
    })()`);

    await browser.evaluate(`(() => {
      const toggle = document.getElementById('component-toggle');
      toggle.focus();
      toggle.click();
      document.getElementById('toolbar-end').focus();
    })()`);
    await browser.pressTab();
    const componentOpenTab = await browser.evaluate('document.activeElement.id');
    const componentCloseFocus = await browser.evaluate(`(() => {
      const close = document.getElementById('component-close');
      const panel = document.getElementById('component-rack');
      close.focus();
      close.click();
      return { active: document.activeElement.id, inert: panel.inert, ariaHidden: panel.getAttribute('aria-hidden') };
    })()`);
    const componentToolbarClose = await browser.evaluate(`(() => {
      const panel = document.getElementById('component-rack');
      const toggle = document.getElementById('component-toggle');
      toggle.focus();
      toggle.click();
      toggle.click();
      return { active: document.activeElement.id, inert: panel.inert };
    })()`);

    const rackSwitch = await browser.evaluate(`(() => {
      const pages = document.getElementById('pages-rack');
      const components = document.getElementById('component-rack');
      const pagesToggle = document.getElementById('pages-toggle');
      const componentToggle = document.getElementById('component-toggle');
      pagesToggle.focus();
      pagesToggle.click();
      document.getElementById('pages-input').focus();
      componentToggle.focus();
      componentToggle.click();
      return {
        active: document.activeElement.id, oldInert: pages.inert,
        oldAriaHidden: pages.getAttribute('aria-hidden'), newInert: components.inert,
        newAriaHidden: components.getAttribute('aria-hidden'),
      };
    })()`);
    await browser.pressTab();
    const switchToToolbarEnd = await browser.evaluate('document.activeElement.id');
    await browser.pressTab();
    const switchIntoComponent = await browser.evaluate('document.activeElement.id');

    return {
      geometry,
      keyboard: {
        ...keyboardStart, pagesClosedTab, componentClosedTab, pagesOpenTab,
        pagesCloseFocus, pagesToolbarClose, componentOpenTab, componentCloseFocus,
        componentToolbarClose, rackSwitch, switchToToolbarEnd, switchIntoComponent,
      },
    };
  } finally {
    await browser?.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

describe('Workspace Rack keyboard focus and compact geometry (Chromium)', () => {
  browserIt('uses native inert, restores focus, and fits both Racks inside the actual CSS shell', async () => {
    const result = await runRackBrowserChecks();
    expect(result.geometry).toHaveLength(VIEWPORTS.length);
    for (const { viewport, expected, actual } of result.geometry) {
      expect(actual.shell).toEqual(viewport);
      expect(actual.bodyMinWidth).toBe(viewport.width <= 700 ? '0px' : '760px');
      expect(actual.shellMinHeight).toBe(viewport.width <= 700 ? '0px' : '560px');
      expect(actual.window.left).toBeGreaterThanOrEqual(0);
      expect(actual.window.top).toBeGreaterThanOrEqual(WINDOW_CHROME.header);
      expect(actual.window.right).toBeLessThanOrEqual(actual.shell.width);
      expect(actual.window.bottom).toBeLessThanOrEqual(actual.shell.height - WINDOW_CHROME.footer);
      expect(actual.window.width).toBeCloseTo(expected.size.width, 1);
      expect(actual.window.height).toBeCloseTo(expected.size.height, 1);
      for (const rack of [actual.pages, actual.components]) {
        expect(rack.left).toBeGreaterThanOrEqual(0);
        expect(rack.top).toBeGreaterThanOrEqual(WINDOW_CHROME.header);
        expect(rack.right).toBeLessThanOrEqual(actual.shell.width);
        expect(rack.bottom).toBeLessThanOrEqual(actual.shell.height - WINDOW_CHROME.footer);
        expect(rack.width).toBeLessThanOrEqual(actual.shell.width);
        expect(rack.height).toBeLessThanOrEqual(
          actual.shell.height - WINDOW_CHROME.header - WINDOW_CHROME.footer,
        );
        expect(rack.listOverflowY).toBe('auto');
        expect(rack.listScrollHeight).toBeGreaterThan(rack.listClientHeight);
      }
    }

    const compact = result.geometry.find(({ viewport }) => viewport.width === 240);
    expect(compact.actual.shell).toEqual({ width: 240, height: 180 });
    expect(compact.actual.pages.height).toBe(97);
    expect(compact.actual.components.height).toBe(97);
    const medium = result.geometry.find(({ viewport }) => viewport.width === 360);
    expect(medium.actual.shell).toEqual({ width: 360, height: 280 });
    expect(medium.actual.pages.height).toBe(197);
    expect(medium.actual.components.height).toBe(197);

    const keyboard = result.keyboard;
    expect(keyboard.inertSupported).toBe(true);
    expect(keyboard.pagesInitiallyInert).toBe(true);
    expect(keyboard.componentsInitiallyInert).toBe(true);
    expect(keyboard.pagesClosedTab).toBe('component-toggle');
    expect(keyboard.componentClosedTab).toBe('toolbar-end');
    expect(keyboard.pagesOpenTab).toBe('pages-input');
    expect(keyboard.pagesCloseFocus).toEqual({ active: 'pages-toggle', inert: true, ariaHidden: 'true' });
    expect(keyboard.pagesToolbarClose).toEqual({ active: 'pages-toggle', inert: true });
    expect(keyboard.componentOpenTab).toBe('component-input');
    expect(keyboard.componentCloseFocus).toEqual({ active: 'component-toggle', inert: true, ariaHidden: 'true' });
    expect(keyboard.componentToolbarClose).toEqual({ active: 'component-toggle', inert: true });
    expect(keyboard.rackSwitch).toEqual({
      active: 'component-toggle', oldInert: true, oldAriaHidden: 'true',
      newInert: false, newAriaHidden: 'false',
    });
    expect(keyboard.switchToToolbarEnd).toBe('toolbar-end');
    expect(keyboard.switchIntoComponent).toBe('component-input');
  }, 60000);
});


// App acceptance is kept in this Chromium test file so it runs sequentially
// with the existing fixture-based browser check, avoiding concurrent Chromium startup.
const appTestTitle = chromium && typeof WebSocket !== 'undefined'
  ? 'runs actual Preact App Rack keyboard, pointer, stacking and geometry acceptance'
  : 'actual App Rack acceptance (SKIPPED: Chromium or Node WebSocket unavailable; set CHROMIUM_BIN)';

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

async function launchAppChromium() {
  if (!chromium) throw new Error('Chromium is unavailable; set CHROMIUM_BIN.');
  // Each test gets a unique browser profile, isolating localStorage and IndexedDB.
  const profile = mkdtempSync(join(tmpdir(), 'folio-app-rack-profile-'));
  const portServer = createServer();
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

async function waitForApp(browser, expression, description, timeout = 15000) {
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

async function waitForAppRackAnimation(browser, selector) {
  await waitForApp(
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
    browser = await launchAppChromium();
    await browser.setViewport({ width: 1280, height: 800 });
    await browser.send('Storage.clearDataForOrigin', {
      origin: new URL(vite.url).origin,
      storageTypes: 'all',
    });
    await browser.navigate(vite.url);

    await waitForApp(
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
    await waitForAppRackAnimation(browser, '.pages-rack-panel');
    await browser.focus('.pages-rack-name-input');
    await browser.pressTab();
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".pages-rack-panel .component-rack-close")',
    )).toBe(true);

    await browser.click('.pages-rack-panel .component-rack-close');
    await waitForApp(browser, 'document.querySelector(".pages-rack-panel").inert', 'Pages close button');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".pages-rack-header-toggle")',
    )).toBe(true);

    // Closing through the Pages toolbar toggle keeps focus on that toggle.
    await browser.click('.pages-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.pages-rack-panel');
    await browser.click('.pages-rack-header-toggle');
    await waitForApp(browser, 'document.querySelector(".pages-rack-panel").inert', 'Pages toolbar close');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".pages-rack-header-toggle")',
    )).toBe(true);

    // Component Rack opens and its first enabled action is reached by sequential Tab.
    await browser.click('.component-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.component-rack-panel');
    await browser.focus('.component-rack-search');
    await browser.pressTab();
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".component-rack-panel .component-rack-save")',
    )).toBe(true);

    await browser.click('.component-rack-panel .component-rack-close');
    await waitForApp(browser, 'document.querySelector(".component-rack-panel").inert', 'Component close button');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".component-rack-header-toggle")',
    )).toBe(true);

    await browser.click('.component-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.component-rack-panel');
    await browser.click('.component-rack-header-toggle');
    await waitForApp(browser, 'document.querySelector(".component-rack-panel").inert', 'Component toolbar close');
    expect(await browser.evaluate(
      'document.activeElement === document.querySelector(".component-rack-header-toggle")',
    )).toBe(true);

    // Switching the visible Rack in either direction inerts the previous one.
    await browser.click('.pages-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.pages-rack-panel');
    await browser.click('.component-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.component-rack-panel');
    expect(await browser.evaluate(
      '(() => ({active:document.activeElement===document.querySelector(".component-rack-header-toggle"),' +
      'oldInert:document.querySelector(".pages-rack-panel").inert,oldAria:document.querySelector(".pages-rack-panel").getAttribute("aria-hidden"),' +
      'newInert:document.querySelector(".component-rack-panel").inert,newAria:document.querySelector(".component-rack-panel").getAttribute("aria-hidden")}))()',
    )).toEqual({ active:true, oldInert:true, oldAria:'true', newInert:false, newAria:'false' });

    await browser.click('.pages-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.pages-rack-panel');
    expect(await browser.evaluate(
      '(() => ({active:document.activeElement===document.querySelector(".pages-rack-header-toggle"),' +
      'oldInert:document.querySelector(".component-rack-panel").inert,oldAria:document.querySelector(".component-rack-panel").getAttribute("aria-hidden"),' +
      'newInert:document.querySelector(".pages-rack-panel").inert,newAria:document.querySelector(".pages-rack-panel").getAttribute("aria-hidden")}))()',
    )).toEqual({ active:true, oldInert:true, oldAria:'true', newInert:false, newAria:'false' });
    await browser.click('.pages-rack-header-toggle');
    await waitForApp(browser, 'document.querySelector(".pages-rack-panel").inert', 'close Pages before test data');

    // Create enough Pages through the App Add Page control so the actual list must scroll.
    for (let index=0; index<12; index+=1) {
      await browser.click('.pages-rack-header-toggle');
      await waitForAppRackAnimation(browser, '.pages-rack-panel');
      await browser.focus('.pages-rack-name-input');
      await browser.insertText('Browser Acceptance Page ' + (index+1));
      await waitForApp(browser, '!document.querySelector(".pages-rack-add").disabled', 'Add Page enabled');
      await browser.click('.pages-rack-add');
      await waitForApp(browser, 'document.querySelector(".pages-rack-panel").inert', 'App Add Page handler');
    }

    // Create one real Component through the App's New Component handler.
    // Duplicate that real record through the Rack's own Preact handler to populate
    // the rendered list without repeatedly opening and rebuilding Component Canvas.
    await browser.click('.component-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.component-rack-panel');
    await browser.click('.component-rack-panel .component-rack-save');
    await waitForApp(
      browser,
      'document.querySelector(".component-rack-panel").inert && !!document.querySelector("#component-canvas")',
      'App New Component handler',
      30000,
    );

    await browser.click('.component-rack-header-toggle');
    await waitForAppRackAnimation(browser, '.component-rack-panel');
    for (let index=0; index<11; index+=1) {
      await browser.click('.component-rack-card-actions button[title^="Duplicate"]');
      await waitForApp(
        browser,
        'document.querySelectorAll(".component-rack-card").length >= ' + (index + 2),
        'App Duplicate Component handler ' + (index + 1),
        30000,
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
        await waitForAppRackAnimation(browser, rack.panel);
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
        await waitForApp(
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
  browserIt(appTestTitle, async () => {
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
