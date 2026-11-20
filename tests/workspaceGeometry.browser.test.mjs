import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOW_CHROME, getDefaultWindowLayouts } from '../src/app/windowManager';

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
    const result = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
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

function readRenderedGeometries() {
  if (!chromium) throw new Error('Chromium is not available for rendered geometry verification');
  const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
  const expected = VIEWPORTS.map((viewport) => ({
    viewport,
    geometry: getDefaultWindowLayouts(viewport)['main-canvas'],
  }));
  const dir = mkdtempSync(join(tmpdir(), 'folio-window-geometry-'));
  const htmlPath = join(dir, 'geometry.html');
  const casesHtml = expected.map((item, index) => {
    const g = item.geometry;
    return '<div class="app-shell" id="shell-' + index +
      '" style="width:' + item.viewport.width + 'px;height:' + item.viewport.height +
      'px;min-width:0;min-height:0"><div class="workspace canvas-floating" id="window-' +
      index + '" style="left:' + g.position.x + 'px;top:' + g.position.y +
      'px;width:' + g.size.width + 'px;height:' + g.size.height +
      'px;z-index:120"></div></div>';
  }).join('');
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    css + '</style></head><body>' + casesHtml +
    '<pre id="result"></pre><script>' +
    'const data=[];' +
    'for(let i=0;i<3;i++){' +
    'const shell=document.getElementById("shell-"+i);' +
    'const target=document.getElementById("window-"+i);' +
    'const sr=shell.getBoundingClientRect();' +
    'const r=target.getBoundingClientRect();' +
    'const s=getComputedStyle(target);' +
    'data.push({shell:{width:sr.width,height:sr.height},' +
    'window:{left:r.left-sr.left,top:r.top-sr.top,width:r.width,height:r.height,' +
    'right:r.right-sr.left,bottom:r.bottom-sr.top},' +
    'computed:{minWidth:s.minWidth,minHeight:s.minHeight}});}' +
    'document.getElementById("result").textContent=' +
    'btoa(unescape(encodeURIComponent(JSON.stringify(data))));' +
    '</script></body></html>';
  try {
    writeFileSync(htmlPath, html);
    const output = execFileSync(chromium, [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--dump-dom',
      'file://' + htmlPath,
    ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    const encoded = output.match(/<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/)?.[1];
    if (!encoded) throw new Error('Chromium did not return rendered geometry: ' + output.slice(-500));
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Floating workspace rendered geometry (Chromium)', () => {
  browserIt('respects actual computed dimensions and app-shell bounds at desktop and compact sizes', () => {
    const rendered = readRenderedGeometries();
    expect(rendered).toHaveLength(VIEWPORTS.length);
    for (let index = 0; index < VIEWPORTS.length; index += 1) {
      const viewport = VIEWPORTS[index];
      const actual = rendered[index];
      const expected = getDefaultWindowLayouts(viewport)['main-canvas'];
      expect(actual.shell).toEqual(viewport);
      expect(actual.window.left).toBeGreaterThanOrEqual(0);
      expect(actual.window.top).toBeGreaterThanOrEqual(WINDOW_CHROME.header);
      expect(actual.window.right).toBeLessThanOrEqual(actual.shell.width);
      expect(actual.window.bottom).toBeLessThanOrEqual(actual.shell.height - WINDOW_CHROME.footer);
      expect(actual.window.width).toBeCloseTo(expected.size.width, 1);
      expect(actual.window.height).toBeCloseTo(expected.size.height, 1);
      expect(actual.computed.minWidth).toBeTruthy();
      expect(actual.computed.minHeight).toBeTruthy();
    }
  }, 45000);
});
