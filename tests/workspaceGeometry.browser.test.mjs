import { spawn, spawnSync } from 'node:child_process';
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
const browserIt = it;
const browserTestTitle = 'checks Rack fixture CSS and actual Preact App in one Chromium session';
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
    '<section id="pages-rack" class="pages-rack-panel" aria-label="Pages Rack">' +
    '<div class="pages-rack-heading"><div class="pages-rack-title"><span class="panel-kicker">PROJECT STRUCTURE</span>' +
    '<strong>Pages</strong><span class="pages-rack-count">18</span></div><div class="pages-rack-actions">' +
    '<input id="pages-input" class="pages-rack-name-input" aria-label="New page name">' +
    button('pages-add', 'Add page', 'pages-rack-add') +
    button('pages-close', 'Close Pages Rack', 'component-rack-close') +
    '</div></div><div class="pages-rack-list">' + pages + '</div></section>' +
    '<section id="component-rack" class="component-rack-panel" aria-label="Component Rack">' +
    '<div class="component-rack-heading"><div class="component-rack-title"><span class="panel-kicker">YOUR LIBRARY</span>' +
    '<strong>Component Rack</strong><span class="component-rack-count">24</span></div><div class="component-rack-actions">' +
    '<input id="component-input" class="component-rack-search" aria-label="Search components">' +
    button('component-new', 'New component', 'component-rack-save') +
    button('component-save', 'Save selection', 'component-rack-save') +
    button('component-close', 'Close Component Rack', 'component-rack-close') +
    '</div></div><div class="component-rack-list">' + components + '</div></section>' +
    '</div></div></body></html>';
}

async function launchChromiumAttempt(path, attemptNumber) {
  // Chrome chooses an unused port itself and writes it to DevToolsActivePort.
  // This avoids the close-and-rebind race from reserving a TCP port in Node first.
  const profile = mkdtempSync(join(tmpdir(), 'folio-rack-chromium-profile-'));
  const activePortPath = join(profile, 'DevToolsActivePort');

  // Headless Chromium needs no desktop session bus; strip CI's inherited D-Bus values.
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
    'file://' + path,
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: chromiumEnv,
  });

  let socket;
  let stderr = '';
  let spawnError = null;
  let cleanupPromise = null;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => { spawnError = error; });

  const processGroupIsAlive = () => {
    if (!child.pid || process.platform === 'win32') {
      return child.exitCode === null && child.signalCode === null && !spawnError;
    }
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      return error?.code === 'EPERM';
    }
  };

  const waitForProcessGroupExit = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (processGroupIsAlive() && Date.now() < deadline) await delay(40);
    return !processGroupIsAlive();
  };

  const waitForChildExit = async (timeoutMs) => {
    if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(timeoutMs),
    ]);
  };

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try { socket?.close(); } catch { /* Ignore an already closed websocket. */ }

      if (process.platform !== 'win32' && child.pid) {
        // Signal the whole detached Chromium process group, including renderer children.
        try {
          if (processGroupIsAlive()) process.kill(-child.pid, 'SIGTERM');
        } catch { /* The group may have exited between the check and signal. */ }

        const stopped = await waitForProcessGroupExit(4000);
        if (!stopped) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
          const stoppedAfterKill = await waitForProcessGroupExit(2500);
          if (!stoppedAfterKill) {
            throw new Error(
              'Chromium process group remained alive after SIGKILL. PID=' + child.pid +
              '. stderr tail:\\n' + stderr.slice(-3000),
            );
          }
        }
      } else if (child.exitCode === null && child.signalCode === null && !spawnError) {
        try { child.kill('SIGTERM'); } catch { /* Already gone. */ }
        await waitForChildExit(4000);
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* Already gone. */ }
          await waitForChildExit(2500);
        }
      }

      await waitForChildExit(500);
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    })();
    return cleanupPromise;
  };

  try {
    let debugPort = null;
    let activePortContents = '';
    let targets;
    let lastEndpointError = '';
    const startupDeadline = Date.now() + 20000;

    while (Date.now() < startupDeadline && child.exitCode === null && !spawnError) {
      if (debugPort === null && existsSync(activePortPath)) {
        try {
          activePortContents = readFileSync(activePortPath, 'utf8');
          const parsedPort = Number(activePortContents.split(/\r?\n/, 1)[0]);
          if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
            debugPort = parsedPort;
          }
        } catch (error) {
          lastEndpointError = 'Could not read DevToolsActivePort: ' + String(error);
        }
      }

      if (debugPort !== null) {
        try {
          const response = await fetch(
            'http://127.0.0.1:' + debugPort + '/json/list',
            { signal: AbortSignal.timeout(750) },
          );
          if (response.ok) {
            targets = await response.json();
            if (Array.isArray(targets)) break;
          } else {
            lastEndpointError = 'DevTools /json/list returned HTTP ' + response.status;
          }
        } catch (error) {
          lastEndpointError = String(error);
        }
      }

      await delay(50);
    }

    if (!targets) {
      const processState = spawnError
        ? 'spawnError=' + String(spawnError)
        : 'exitCode=' + String(child.exitCode) + ', signal=' + String(child.signalCode);
      throw new Error(
        'Chromium DevTools startup failed on attempt ' + attemptNumber +
        ' (' + processState + '). DevToolsActivePort=' +
        (activePortContents.trim() || '<not created>') +
        (lastEndpointError ? '. Endpoint=' + lastEndpointError : '') +
        '. stderr tail:\n' + stderr.slice(-3000),
      );
    }

    const page = targets.find((target) => target.type === 'page' && target.url.startsWith('file://'));
    if (!page?.webSocketDebuggerUrl) {
      throw new Error(
        'Chromium exposed DevTools on attempt ' + attemptNumber +
        ' but did not expose the fixture page. Targets=' + JSON.stringify(targets),
      );
    }

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
      if (message.error) entry.reject(new Error(message.error.message || 'DevTools command failed'));
      else entry.resolve(message.result);
    });

    const send = (method, params = {}) => new Promise((resolveResult, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('DevTools command timed out: ' + method));
      }, 15000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolveResult(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
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
        'element.scrollIntoView({ block: "center", inline: "center" }); ' +
        'const rect = element.getBoundingClientRect(); ' +
        'const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right); ' +
        'const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom); ' +
        'if (right <= left || bottom <= top) throw new Error("Click target outside viewport: " + JSON.stringify({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,innerWidth,innerHeight})); ' +
        'const point = { x: left + (right-left)/2, y: top + (bottom-top)/2 }; ' +
        'const hit = document.elementFromPoint(point.x, point.y); ' +
        'if (!hit || !(hit === element || element.contains(hit))) throw new Error("Click target occluded by: " + (hit?.outerHTML?.slice(0,160) || "nothing")); ' +
        'return point; })()',
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
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate('document.readyState === "complete"')) break;
      await delay(100);
    }

    return {
      send,
      evaluate,
      viewport,
      setViewport: viewport,
      pressTab,
      pressTabs,
      focus,
      click,
      wheel,
      insertText: (text) => send('Input.insertText', { text }),
      navigate: (url) => send('Page.navigate', { url }),
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function launchChromium(path) {
  const failures = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await launchChromiumAttempt(path, attempt);
    } catch (error) {
      failures.push(String(error?.stack || error));
      if (attempt < 2) await delay(500);
    }
  }
  throw new Error('Chromium startup failed after two isolated attempts:\n' + failures.join('\n--- retry ---\n'));
}
async function runRackBrowserChecks() {
  if (!chromium) throw new Error('Chromium binary not found; set CHROMIUM_BIN or install Chromium in the CI image.');
  if (typeof WebSocket === 'undefined') throw new Error('Node WebSocket API is unavailable; use the supported Node runtime.');
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
        // Fixture verifies production CSS only; Preact focus/inert is tested in the App below.
        panels.forEach(([panel]) => panel.classList.add('is-open'));
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

    const appAcceptance = await runAppAcceptance(browser);
    return { geometry, appAcceptance };
  } finally {
    await browser?.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

describe('Workspace Rack keyboard focus and compact geometry (Chromium)', () => {
  browserIt(browserTestTitle, async () => {
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

    const appAcceptance = result.appAcceptance;
    expect(appAcceptance.counts.pages).toBeGreaterThanOrEqual(13);
    expect(appAcceptance.counts.components).toBeGreaterThanOrEqual(12);
    expect(appAcceptance.componentRaised.component).toBeGreaterThan(appAcceptance.componentRaised.main);
    expect(appAcceptance.mainRaised.main).toBeGreaterThan(appAcceptance.mainRaised.component);

    for (const size of VIEWPORTS) {
      const actual = appAcceptance.geometry.find((entry) =>
        entry.viewport.width === size.width && entry.viewport.height === size.height,
      );
      expect(actual).toBeDefined();
      expect(actual.body).toEqual(size);
      expect(actual.shell).toEqual(size);
      expect(actual.racks).toHaveLength(2);
      for (const rack of actual.racks) {
        expect(rack.rect.left).toBeGreaterThanOrEqual(0);
        expect(rack.rect.right).toBeLessThanOrEqual(size.width);
        expect(rack.rect.top).toBeGreaterThanOrEqual(56);
        expect(rack.rect.bottom).toBeLessThanOrEqual(size.height - 27);
        expect(rack.rect.height).toBeLessThanOrEqual(size.height - 83);
      }
    }
  }, 180000);
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

async function runAppAcceptance(browser) {
  let vite;
  try {
    vite = await startViteApp();
    await browser.viewport({ width: 1280, height: 800 });
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
    await browser.click('.component-rack-panel button[title="Create a new master component"]');
    await waitForApp(
      browser,
      'document.querySelector(".component-rack-panel").inert',
      'App New Component closes Component Rack',
      30000,
    );
    const componentCanvasOpened = await browser.evaluate('!!document.querySelector("[data-window-id=component-canvas]")');
    expect(componentCanvasOpened).toBe(true);

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
    await waitForApp(
      browser,
      'document.querySelectorAll(".component-rack-card").length === 12',
      'all real Component Rack duplicates remain rendered',
    );

    const counts = await browser.evaluate(
      '({pages:document.querySelectorAll(".pages-rack-card").length,' +
      'components:document.querySelectorAll(".component-rack-card").length,' +
      'main:!!document.querySelector("[data-window-id=main-canvas]"),componentCanvas:!!document.querySelector("[data-window-id=component-canvas]")})',
    );
    expect(counts.pages).toBeGreaterThanOrEqual(13);
    expect(counts.components).toBeGreaterThanOrEqual(12);
    expect(counts.main).toBe(true);
    expect(counts.componentCanvas).toBe(true);

    // Clicking the real FloatingWindow title bars must continue to update shared window stacking.
    const stackBefore = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("[data-window-id=main-canvas]")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("[data-window-id=component-canvas]")).zIndex)})',
    );
    await browser.click('[data-window-id=component-canvas] .workspace-toolbar');
    const componentRaised = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("[data-window-id=main-canvas]")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("[data-window-id=component-canvas]")).zIndex)})',
    );
    expect(componentRaised.component).toBeGreaterThan(componentRaised.main);

    await browser.click('[data-window-id=main-canvas] .workspace-toolbar');
    const mainRaised = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("[data-window-id=main-canvas]")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("[data-window-id=component-canvas]")).zIndex)})',
    );
    expect(mainRaised.main).toBeGreaterThan(mainRaised.component);
    expect(Number.isFinite(stackBefore.main)).toBe(true);
    expect(Number.isFinite(stackBefore.component)).toBe(true);

    // Keyboard focus entering an actual child control must raise its owning window.
    await browser.focus('[data-window-id="component-canvas"] .window-control-close');
    const componentRaisedByKeyboard = await browser.evaluate(
      '({main:Number(getComputedStyle(document.querySelector("[data-window-id=main-canvas]")).zIndex),' +
      'component:Number(getComputedStyle(document.querySelector("[data-window-id=component-canvas]")).zIndex),' +
      'focused:document.activeElement?.getAttribute("aria-label")})',
    );
    expect(componentRaisedByKeyboard.component).toBeGreaterThan(componentRaisedByKeyboard.main);
    expect(componentRaisedByKeyboard.focused).toBe('Close Component Canvas window');

    // Exercise the real App FloatingWindow pointer handlers, not a CSS fixture.
    const floatingWindowReady = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'return {floating:w?.getAttribute("data-window-floating"),' +
      'handles:w?.querySelectorAll("[data-window-resize]").length ?? 0,' +
      'shell:!!w?.closest(".app-shell")}; })()',
    );
    expect(floatingWindowReady).toEqual({ floating: 'true', handles: 8, shell: true });

    const dragStart = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'const toolbar=w?.querySelector(".workspace-toolbar-draggable"); ' +
      'if(!w || !toolbar) throw new Error("Floating Component Canvas drag handle is missing"); ' +
      'const r=w.getBoundingClientRect(), t=toolbar.getBoundingClientRect(); ' +
      'const point={x:t.left+Math.min(90,t.width/3),y:t.top+t.height/2}; ' +
      'const hit=document.elementFromPoint(point.x,point.y); ' +
      'if(!hit || !toolbar.contains(hit) || hit.closest("button,a,input,select,textarea,[role=button],[contenteditable=true]")) ' +
      'throw new Error("Chosen drag point is not a non-interactive titlebar target"); ' +
      'return {before:{x:r.left,y:r.top,width:r.width,height:r.height},point}; })()',
    );
    const dispatchMouseDrag = async (point, dx, dy) => {
      const target = { x: point.x + dx, y: point.y + dy };
      await browser.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
      await browser.send('Input.dispatchMouseEvent', {
        type:'mousePressed', x:point.x, y:point.y, button:'left', buttons:1, clickCount:1,
      });
      await browser.send('Input.dispatchMouseEvent', {
        type:'mouseMoved', x:target.x, y:target.y, button:'left', buttons:1,
      });
      await browser.send('Input.dispatchMouseEvent', {
        type:'mouseReleased', x:target.x, y:target.y, button:'left', buttons:0, clickCount:1,
      });
      await browser.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    await dispatchMouseDrag(dragStart.point, -100, 60);
    const afterDrag = await browser.evaluate(
      '(() => { const r=document.querySelector("[data-window-id=component-canvas]").getBoundingClientRect(); ' +
      'return {x:r.left,y:r.top,width:r.width,height:r.height}; })()',
    );
    expect(afterDrag.x).toBeCloseTo(dragStart.before.x - 100, 0);
    expect(afterDrag.y).toBeCloseTo(dragStart.before.y + 60, 0);

    const resizeStart = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'const h=w?.querySelector("[data-window-resize=se]"); ' +
      'if(!w || !h) throw new Error("South-east resize handle is missing"); ' +
      'const r=w.getBoundingClientRect(), p=h.getBoundingClientRect(); ' +
      'const point={x:p.left+p.width/2,y:p.top+p.height/2}; ' +
      'const hit=document.elementFromPoint(point.x,point.y); ' +
      'if(!hit || !(hit===h || h.contains(hit))) throw new Error("South-east resize handle is occluded"); ' +
      'return {before:{x:r.left,y:r.top,width:r.width,height:r.height},point}; })()',
    );
    await dispatchMouseDrag(resizeStart.point, 45, 35);
    const afterResize = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'const r=w.getBoundingClientRect(), s=document.querySelector(".app-shell").getBoundingClientRect(); ' +
      'return {x:r.left,y:r.top,width:r.width,height:r.height,right:r.right-s.left,bottom:r.bottom-s.top}; })()',
    );
    expect(afterResize.x).toBeCloseTo(resizeStart.before.x, 0);
    expect(afterResize.y).toBeCloseTo(resizeStart.before.y, 0);
    expect(afterResize.width).toBeCloseTo(resizeStart.before.width + 45, 0);
    expect(afterResize.height).toBeCloseTo(resizeStart.before.height + 35, 0);
    expect(afterResize.x).toBeGreaterThanOrEqual(0);
    expect(afterResize.y).toBeGreaterThanOrEqual(56);
    expect(afterResize.right).toBeLessThanOrEqual(1280);
    expect(afterResize.bottom).toBeLessThanOrEqual(800 - 27);

    // Also exercise a straight edge resize, not only the southeast corner.
    const eastResizeStart = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'const h=w?.querySelector("[data-window-resize=e]"); ' +
      'if(!w || !h) throw new Error("East resize handle is missing"); ' +
      'const r=w.getBoundingClientRect(), p=h.getBoundingClientRect(); ' +
      'return {before:{x:r.left,y:r.top,width:r.width,height:r.height},' +
      'point:{x:p.left+p.width/2,y:p.top+p.height/2}}; })()',
    );
    await dispatchMouseDrag(eastResizeStart.point, 35, 0);
    const afterEastResize = await browser.evaluate(
      '(() => { const r=document.querySelector("[data-window-id=component-canvas]").getBoundingClientRect(); ' +
      'return {x:r.left,y:r.top,width:r.width,height:r.height}; })()',
    );
    expect(afterEastResize.x).toBeCloseTo(eastResizeStart.before.x, 0);
    expect(afterEastResize.y).toBeCloseTo(eastResizeStart.before.y, 0);
    expect(afterEastResize.width).toBeCloseTo(eastResizeStart.before.width + 35, 0);
    expect(afterEastResize.height).toBeCloseTo(eastResizeStart.before.height, 0);

    // Resizing the viewport during a live drag must re-clamp the actual App
    // window to the new shell and leave the pointer interaction recoverable.
    const viewportDragStart = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'const t=w.querySelector(".workspace-toolbar-draggable"), r=t.getBoundingClientRect(); ' +
      'return {x:r.left+Math.min(90,r.width/3),y:r.top+r.height/2}; })()',
    );
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseMoved', x:viewportDragStart.x, y:viewportDragStart.y,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type:'mousePressed', x:viewportDragStart.x, y:viewportDragStart.y, button:'left', buttons:1, clickCount:1,
    });
    await browser.setViewport({ width: 1120, height: 740 });
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseMoved', x:viewportDragStart.x+30, y:viewportDragStart.y+20, button:'left', buttons:1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseReleased', x:viewportDragStart.x+30, y:viewportDragStart.y+20, button:'left', buttons:0, clickCount:1,
    });
    const afterViewportResize = await browser.evaluate(
      '(() => { const r=document.querySelector("[data-window-id=component-canvas]").getBoundingClientRect(); ' +
      'const s=document.querySelector(".app-shell").getBoundingClientRect(); ' +
      'return {x:r.left,y:r.top,right:r.right-s.left,bottom:r.bottom-s.top,width:r.width,height:r.height}; })()',
    );
    expect(afterViewportResize.x).toBeGreaterThanOrEqual(0);
    expect(afterViewportResize.y).toBeGreaterThanOrEqual(56);
    expect(afterViewportResize.right).toBeLessThanOrEqual(1120);
    expect(afterViewportResize.bottom).toBeLessThanOrEqual(740 - 27);
    await browser.setViewport({ width: 1280, height: 800 });

    // A browser blur during an active drag must end the pointer session; later
    // mouse movement must not continue moving the window.
    const blurDragStart = await browser.evaluate(
      '(() => { const w=document.querySelector("[data-window-id=component-canvas]"); ' +
      'const t=w.querySelector(".workspace-toolbar-draggable"), r=t.getBoundingClientRect(); ' +
      'return {x:r.left+Math.min(90,r.width/3),y:r.top+r.height/2}; })()',
    );
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseMoved', x:blurDragStart.x, y:blurDragStart.y,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type:'mousePressed', x:blurDragStart.x, y:blurDragStart.y, button:'left', buttons:1, clickCount:1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseMoved', x:blurDragStart.x+20, y:blurDragStart.y+15, button:'left', buttons:1,
    });
    await browser.evaluate('window.dispatchEvent(new Event("blur"))');
    const afterBlurCleanup = await browser.evaluate(
      '(() => { const r=document.querySelector("[data-window-id=component-canvas]").getBoundingClientRect(); ' +
      'return {x:r.left,y:r.top}; })()',
    );
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseMoved', x:blurDragStart.x+80, y:blurDragStart.y+60, button:'left', buttons:1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type:'mouseReleased', x:blurDragStart.x+80, y:blurDragStart.y+60, button:'left', buttons:0, clickCount:1,
    });
    const afterPostBlurMove = await browser.evaluate(
      '(() => { const r=document.querySelector("[data-window-id=component-canvas]").getBoundingClientRect(); ' +
      'return {x:r.left,y:r.top}; })()',
    );
    expect(afterPostBlurMove).toEqual(afterBlurCleanup);

    const floatingWindowAcceptance = {
      componentRaisedByKeyboard,
      beforeDrag: dragStart.before,
      afterDrag,
      beforeResize: resizeStart.before,
      afterResize,
      beforeEastResize: eastResizeStart.before,
      afterEastResize,
      afterViewportResize,
      afterBlurCleanup,
      afterPostBlurMove,
    };

    // Open each Rack through the real App toolbar toggle at desktop width,
    // then retain that live panel while measuring it at every required viewport.
    // This avoids clicking a compact toolbar toggle whose horizontal overflow is
    // independently constrained by the app's 240px chrome layout.
    const geometry = VIEWPORTS.map((viewport) => ({
      viewport,
      body: null,
      shell: null,
      bodyMinWidth: null,
      shellMinHeight: null,
      racks: [],
    }));

    const definitions = [
      { toggle:'.pages-rack-header-toggle', panel:'.pages-rack-panel', list:'.pages-rack-list' },
      { toggle:'.component-rack-header-toggle', panel:'.component-rack-panel', list:'.component-rack-list' },
    ];

    for (const rack of definitions) {
      await browser.setViewport({ width: 1280, height: 800 });
      await browser.click(rack.toggle);
      await waitForAppRackAnimation(browser, rack.panel);

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
        if (viewport.width <= 700) {
          expect(shell.bodyMinWidth).toBe('0px');
          expect(shell.shellMinHeight).toBe('0px');
        }

        const entry = geometry.find((item) =>
          item.viewport.width === viewport.width && item.viewport.height === viewport.height,
        );
        entry.body = shell.body;
        entry.shell = shell.shell;
        entry.bodyMinWidth = shell.bodyMinWidth;
        entry.shellMinHeight = shell.shellMinHeight;

        const metrics = await browser.evaluate(
          '(() => { const s=document.querySelector(".app-shell").getBoundingClientRect(); ' +
          'const p=document.querySelector(' + JSON.stringify(rack.panel) + '); const r=p.getBoundingClientRect(); ' +
          'const l=p.querySelector(' + JSON.stringify(rack.list) + '); ' +
          'return {rect:{left:r.left-s.left,top:r.top-s.top,width:r.width,height:r.height,right:r.right-s.left,bottom:r.bottom-s.top},' +
          'minHeight:getComputedStyle(p).minHeight,maxHeight:getComputedStyle(p).maxHeight,' +
          'overflowY:getComputedStyle(l).overflowY,clientHeight:l.clientHeight,scrollHeight:l.scrollHeight}; })()',
        );
        entry.racks.push({ panel:rack.panel, ...metrics });

        expect(metrics.rect.left).toBeGreaterThanOrEqual(0);
        expect(metrics.rect.top).toBeGreaterThanOrEqual(56);
        expect(metrics.rect.right).toBeLessThanOrEqual(viewport.width);
        expect(metrics.rect.bottom).toBeLessThanOrEqual(viewport.height - 27);
        expect(metrics.rect.width).toBeLessThanOrEqual(viewport.width);
        expect(metrics.rect.height).toBeLessThanOrEqual(viewport.height - 83);
        expect(metrics.minHeight).toBe('0px');
        expect(metrics.overflowY).toBe('auto');
        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

        await browser.wheel(rack.list, 200);
        await waitForApp(
          browser,
          'document.querySelector(' + JSON.stringify(rack.list) + ').scrollTop > 0',
          rack.panel + ' list scrolls after real wheel input',
          5000,
        );
        const scrollTop = await browser.evaluate(
          'document.querySelector(' + JSON.stringify(rack.list) + ').scrollTop',
        );
        expect(scrollTop).toBeGreaterThan(0);
      }

      await browser.setViewport({ width: 1280, height: 800 });
      await browser.click(rack.toggle);
      await waitForApp(
        browser,
        'document.querySelector(' + JSON.stringify(rack.panel) + ').inert',
        rack.panel + ' closed after geometry',
      );
    }
    return { counts, stackBefore, componentRaised, mainRaised, floatingWindowAcceptance, geometry };
  } finally {
    await vite?.close();
  }
}

