import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
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
  const child = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-networking',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--remote-allow-origins=*', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'file://' + path,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  try {
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const activePortFile = join(profile, 'DevToolsActivePort');
    let port = 0;
    const startupDeadline = Date.now() + 20000;
    while (Date.now() < startupDeadline && child.exitCode === null) {
      if (existsSync(activePortFile)) {
        const candidate = Number(readFileSync(activePortFile, 'utf8').split(/\\r?\\n/)[0]);
        if (Number.isInteger(candidate) && candidate > 0) {
          port = candidate;
          break;
        }
      }
      await delay(100);
    }
    if (!port) {
      throw new Error('Chromium DevTools startup timeout: ' + stderr.slice(-1000));
    }

    let targets;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        if (response.ok) { targets = await response.json(); break; }
      } catch { /* Chromium is still exposing its DevTools endpoint. */ }
      await delay(100);
    }
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
      evaluate, viewport, pressTab,
      close: async () => {
        try { socket?.close(); } catch { /* Ignore an already closed socket. */ }
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
          child.kill('SIGTERM');
          await Promise.race([exited, delay(5000)]);
        }
        rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      },
    };
  } catch (error) {
    try { socket?.close(); } catch { /* Ignore an already closed socket. */ }
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
      child.kill('SIGTERM');
      await Promise.race([exited, delay(5000)]);
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
      const actual = await browser.evaluate(`(() => {
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
        const metrics = panels.map(([panel, listSelector]) => {
          panel.classList.add('is-open');
          panel.inert = false;
          panel.removeAttribute('inert');
          panel.setAttribute('aria-hidden', 'false');
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
      pages.inert = true; pages.setAttribute('inert', ''); pages.setAttribute('aria-hidden', 'true');
      components.inert = true; components.setAttribute('inert', ''); components.setAttribute('aria-hidden', 'true');
      pages.classList.remove('is-open'); components.classList.remove('is-open');
      document.getElementById('pages-toggle').focus();
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
      const panel = document.getElementById('pages-rack');
      panel.inert = false; panel.removeAttribute('inert'); panel.setAttribute('aria-hidden', 'false');
      panel.classList.add('is-open'); document.getElementById('toolbar-end').focus();
    })()`);
    await browser.pressTab();
    const pagesOpenTab = await browser.evaluate('document.activeElement.id');

    const pagesCloseFocus = await browser.evaluate(`(() => {
      const panel = document.getElementById('pages-rack');
      const toggle = document.getElementById('pages-toggle');
      document.getElementById('pages-close').focus();
      if (panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      panel.inert = true; panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true');
      panel.classList.remove('is-open');
      return { active: document.activeElement.id, inert: panel.inert, ariaHidden: panel.getAttribute('aria-hidden') };
    })()`);
    const pagesToolbarClose = await browser.evaluate(`(() => {
      const panel = document.getElementById('pages-rack');
      const toggle = document.getElementById('pages-toggle');
      panel.inert = false; panel.removeAttribute('inert'); panel.setAttribute('aria-hidden', 'false');
      panel.classList.add('is-open'); toggle.focus();
      if (panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      panel.inert = true; panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true');
      panel.classList.remove('is-open');
      return { active: document.activeElement.id, inert: panel.inert };
    })()`);

    await browser.evaluate(`(() => {
      const panel = document.getElementById('component-rack');
      panel.inert = false; panel.removeAttribute('inert'); panel.setAttribute('aria-hidden', 'false');
      panel.classList.add('is-open'); document.getElementById('toolbar-end').focus();
    })()`);
    await browser.pressTab();
    const componentOpenTab = await browser.evaluate('document.activeElement.id');
    const componentCloseFocus = await browser.evaluate(`(() => {
      const panel = document.getElementById('component-rack');
      const toggle = document.getElementById('component-toggle');
      document.getElementById('component-close').focus();
      if (panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      panel.inert = true; panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true');
      panel.classList.remove('is-open');
      return { active: document.activeElement.id, inert: panel.inert, ariaHidden: panel.getAttribute('aria-hidden') };
    })()`);
    const componentToolbarClose = await browser.evaluate(`(() => {
      const panel = document.getElementById('component-rack');
      const toggle = document.getElementById('component-toggle');
      panel.inert = false; panel.removeAttribute('inert'); panel.setAttribute('aria-hidden', 'false');
      panel.classList.add('is-open'); toggle.focus();
      if (panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      panel.inert = true; panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true');
      panel.classList.remove('is-open');
      return { active: document.activeElement.id, inert: panel.inert };
    })()`);

    const rackSwitch = await browser.evaluate(`(() => {
      const pages = document.getElementById('pages-rack');
      const components = document.getElementById('component-rack');
      const pagesToggle = document.getElementById('pages-toggle');
      const componentToggle = document.getElementById('component-toggle');
      pages.inert = false; pages.removeAttribute('inert'); pages.setAttribute('aria-hidden', 'false');
      pages.classList.add('is-open'); document.getElementById('pages-input').focus();
      componentToggle.focus();
      if (pages.contains(document.activeElement)) pagesToggle.focus({ preventScroll: true });
      pages.inert = true; pages.setAttribute('inert', ''); pages.setAttribute('aria-hidden', 'true');
      pages.classList.remove('is-open');
      components.inert = false; components.removeAttribute('inert'); components.setAttribute('aria-hidden', 'false');
      components.classList.add('is-open');
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
