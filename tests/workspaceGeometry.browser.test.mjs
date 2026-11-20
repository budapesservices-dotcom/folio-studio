import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOW_CHROME, getDefaultWindowLayouts } from '../src/app/windowManager';

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

function findChromium() {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
    const lookup = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (lookup.status === 0 && lookup.stdout.trim()) return lookup.stdout.trim();
  }
  return null;
}

const chromium = findChromium();
const browserIt = chromium ? it : it.skip;
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 360, height: 280 },
  { width: 240, height: 180 },
];

function readRenderedGeometry(viewport) {
  if (!chromium) throw new Error('Chromium is not available for rendered geometry verification');
  const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
  const geometry = getDefaultWindowLayouts(viewport)['main-canvas'];
  const dir = mkdtempSync(join(tmpdir(), 'folio-window-geometry-'));
  const htmlPath = join(dir, 'geometry.html');
  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
    css + '</style></head><body><div id="app"><div id="app-shell" class="app-shell">' +
    '<div id="window" class="workspace canvas-floating" style="left:' +
    geometry.position.x + 'px;top:' + geometry.position.y + 'px;width:' +
    geometry.size.width + 'px;height:' + geometry.size.height +
    'px;z-index:120"></div></div></div><pre id="result"></pre><script>' +
    'requestAnimationFrame(() => {' +
    'const shell=document.getElementById("app-shell");' +
    'const target=document.getElementById("window");' +
    'const shellRect=shell.getBoundingClientRect();' +
    'const rect=target.getBoundingClientRect();' +
    'const style=getComputedStyle(target);' +
    'const result={' +
    'viewport:{width:innerWidth,height:innerHeight},' +
    'shell:{width:shellRect.width,height:shellRect.height},' +
    'window:{left:rect.left-shellRect.left,top:rect.top-shellRect.top,' +
    'width:rect.width,height:rect.height,right:rect.right-shellRect.left,' +
    'bottom:rect.bottom-shellRect.top},' +
    'computed:{minWidth:style.minWidth,minHeight:style.minHeight}};' +
    'document.getElementById("result").textContent=' +
    'btoa(unescape(encodeURIComponent(JSON.stringify(result))));' +
    '});</script></body></html>';
  try {
    writeFileSync(htmlPath, html);
    const output = execFileSync(chromium, [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--window-size=' + viewport.width + ',' + viewport.height,
      '--virtual-time-budget=1000',
      '--dump-dom',
      'file://' + htmlPath,
    ], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    const encoded = output.match(/<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/)?.[1];
    if (!encoded) throw new Error('Chromium did not return rendered geometry: ' + output.slice(-500));
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Floating workspace rendered geometry (Chromium)', () => {
  for (const viewport of VIEWPORTS) {
    browserIt('renders within the app-shell at ' + viewport.width + 'x' + viewport.height, () => {
      const rendered = readRenderedGeometry(viewport);
      const expected = getDefaultWindowLayouts(viewport)['main-canvas'];
      expect(rendered.viewport).toEqual(viewport);
      expect(rendered.shell).toEqual(viewport);
      expect(rendered.window.left).toBeGreaterThanOrEqual(0);
      expect(rendered.window.top).toBeGreaterThanOrEqual(WINDOW_CHROME.header);
      expect(rendered.window.right).toBeLessThanOrEqual(rendered.shell.width);
      expect(rendered.window.bottom).toBeLessThanOrEqual(rendered.shell.height - WINDOW_CHROME.footer);
      expect(rendered.window.width).toBeCloseTo(expected.size.width, 1);
      expect(rendered.window.height).toBeCloseTo(expected.size.height, 1);
      expect(rendered.computed.minWidth).toBeTruthy();
      expect(rendered.computed.minHeight).toBeTruthy();
    }, 20000);
  }
});
