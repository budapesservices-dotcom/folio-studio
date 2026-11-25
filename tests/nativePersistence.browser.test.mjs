import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  findChromium,
  getBrowserAvailability,
  launchChromiumSession,
} from './helpers/chromiumHarness.mjs';

const chromium = findChromium();
const browserIt = it;
const browserAvailability = getBrowserAvailability(chromium);

async function launchChromium(path) {
  return launchChromiumSession(path, {
    chromiumBin: chromium,
    profilePrefix: 'folio-native-persistence-chromium-',
    matchUrlPrefix: 'file://',
  });
}

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
      } catch { /* Vite is still starting. */ }
      await delay(50);
    }
    if (!ready) throw new Error('Vite-served Folio App did not become ready.');
    return { url, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function waitForApp(browser, expression, description, timeout = 30000) {
  try {
    await browser.evaluate(
      'new Promise((resolve,reject)=>{const deadline=Date.now()+' + timeout + ';' +
      'const check=()=>{let passed=false;try{passed=Boolean(' + expression + ');}catch(error){reject(error);return;}' +
      'if(passed)resolve(true);else if(Date.now()>=deadline)reject(new Error("Timed out waiting for " + ' +
      JSON.stringify(description) + '));else setTimeout(check,40);};check();})',
    );
  } catch (error) {
    throw new Error('Browser wait failed (' + description + '): ' + String(error));
  }
}

async function openCreateMenu(browser) {
  await browser.click('button[aria-label="Template library"]');
  await waitForApp(browser, 'document.querySelectorAll(".template-library-popover .template-card").length>=6',
    'Template library popover rendered');
}

async function ensureTemplateComponentMode(browser) {
  await openCreateMenu(browser);
  const isComponentMode = await browser.evaluate(
    'Array.from(document.querySelectorAll(".template-mode-btn")).find((b)=>b.textContent.trim()==="Component")?.getAttribute("aria-pressed")==="true"',
  );
  if (!isComponentMode) {
    await browser.evaluate(
      '(() => { const btn=Array.from(document.querySelectorAll(".template-mode-btn")).find((b)=>b.textContent.trim()==="Component"); if(!btn) throw new Error("Component mode toggle missing"); btn.click(); return true; })()',
    );
    await waitForApp(browser,
      'Array.from(document.querySelectorAll(".template-mode-btn")).find((b)=>b.textContent.trim()==="Component")?.getAttribute("aria-pressed")==="true"',
      'Template library switched to Component insert mode');
  }
  await browser.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await waitForApp(browser, 'document.querySelector(".template-library-popover")===null',
    'Template library closed after setting Component mode');
}

async function addShape(browser, label) {
  const templateId = { Rectangle: 'ui-primary-button', Ellipse: 'ui-input-field', Text: 'ui-kpi-card' }[label];
  if (!templateId) throw new Error('Unsupported test shape: ' + label);
  await openCreateMenu(browser);
  await browser.click('.template-library-popover .template-card[data-template-id="' + templateId + '"] .template-card-primary');
}

async function readMainProject(browser) {
  return browser.evaluate(
    '(async()=>{const open=indexedDB.open("folio-studio");const db=await new Promise((resolve,reject)=>{' +
    'open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error||new Error("IndexedDB open failed"));' +
    'open.onblocked=()=>reject(new Error("IndexedDB read blocked"));});' +
    'if(db.version!==2){const version=db.version;db.close();throw new Error("Expected IndexedDB v2, got "+version);}' +
    'if(!db.objectStoreNames.contains("projects")){db.close();throw new Error("Native projects object store missing");}' +
    'const tx=db.transaction("projects","readonly");const request=tx.objectStore("projects").getAll();let records=[];' +
    'request.onsuccess=()=>{records=request.result||[];};' +
    'await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Native read failed"));' +
    'tx.onabort=()=>reject(tx.error||new Error("Native read aborted"));});db.close();' +
    'const roots=records.filter((record)=>record&&record.metadata&&typeof record.metadata.id==="string"&&' +
    'record.metadata.id!=="folio-component-canvas"&&!record.metadata.id.startsWith("folio-page-"));' +
    'if(roots.length!==1)throw new Error("Expected one root project, found "+roots.length);const project=roots[0];' +
    'const page=project.pages.find((item)=>item.id===project.activePageId)||project.pages[0];' +
    'const nodes=page&&page.document&&Array.isArray(page.document.nodes)?page.document.nodes:[];' +
    'return {databaseVersion:2,projectId:project.metadata.id,formatVersion:project.formatVersion,' +
    'activePageId:page&&page.id,nodeCount:nodes.length,nodeIds:nodes.map((node)=>node.id),' +
    'nodeNames:nodes.map((node)=>node.name),nodeTypes:nodes.map((node)=>node.type)};})()',
  );
}

async function getStatus(browser) {
  return browser.evaluate(
    '(()=>{const element=document.querySelector(".statusbar .status-right");' +
    'return element?{text:element.textContent.trim(),className:element.className}:null;})()',
  );
}

async function installNativePersistenceProbe(browser) {
  const install = function() {
    const probe = {
      nextMode: null, puts: [], events: [], triggered: [],
      abortReadNodeCount: null, afterCommitReadNodeCount: null, triggerErrors: [],
    };
    window.__folioNativePersistenceProbe = probe;
    const originalPut = IDBObjectStore.prototype.put;
    const projectNodes = (project) => {
      const page = project.pages?.find((item) => item.id === project.activePageId) ?? project.pages?.[0];
      return Array.isArray(page?.document?.nodes) ? page.document.nodes : [];
    };
    const observePersistedNodeCount = (field, projectId) => {
      // Reopen after the active transaction event; the app closes its writer
      // connection when the save Promise settles.
      window.setTimeout(() => {
        const open = indexedDB.open('folio-studio');
        open.onerror = () => { probe[field] = -1; };
        open.onsuccess = () => {
          const db = open.result;
          let transaction;
          try {
            transaction = db.transaction('projects', 'readonly');
          } catch {
            probe[field] = -1;
            db.close();
            return;
          }
          const request = transaction.objectStore('projects').get(projectId);
          request.onsuccess = () => { probe[field] = projectNodes(request.result).length; };
          request.onerror = () => { probe[field] = -1; };
          transaction.oncomplete = () => db.close();
          transaction.onabort = () => { probe[field] = -1; db.close(); };
          transaction.onerror = () => { probe[field] = -1; };
        };
      }, 0);
    };
    const clickMenuItem = (label, mode) => {
      const templateId = { Rectangle: 'ui-primary-button', Ellipse: 'ui-input-field', Text: 'ui-kpi-card' }[label];
      const item = document.querySelector(
        '.template-library-popover .template-card[data-template-id="' + templateId + '"] .template-card-primary',
      );
      if (!item) {
        probe.triggerErrors.push(mode + ': ' + label + ' template card was not mounted');
        return;
      }
      item.click();
      probe.triggered.push(mode);
    };
    IDBObjectStore.prototype.put = function(value, ...args) {
      const eligible = this.name === 'projects' && this.transaction?.mode === 'readwrite' &&
        value?.metadata?.id && value.metadata.id !== 'folio-component-canvas';
      if (!eligible) return originalPut.call(this, value, ...args);
      const nodes = projectNodes(value);
      probe.puts.push({
        projectId: value.metadata.id,
        nodeCount: nodes.length,
        nodeIds: nodes.map((node) => node.id),
        nodeNames: nodes.map((node) => node.name),
        nodeTypes: nodes.map((node) => node.type),
      });
      const mode = probe.nextMode;
      if (mode) {
        probe.nextMode = null;
        const transaction = this.transaction;
        transaction.addEventListener('abort', () => {
          probe.events.push({ mode, event: 'abort' });
          observePersistedNodeCount('abortReadNodeCount', value.metadata.id);
        }, { once: true });
        transaction.addEventListener('complete', () => {
          probe.events.push({ mode, event: 'complete' });
          if (mode === 'after-commit') {
            observePersistedNodeCount('afterCommitReadNodeCount', value.metadata.id);
            clickMenuItem('Text', mode);
          }
        }, { once: true });
      }
      const request = originalPut.call(this, value, ...args);
      if (mode === 'abort-before-commit') {
        const hold = this.get(value.metadata.id);
        hold.onsuccess = () => clickMenuItem('Ellipse', mode);
      }
      return request;
    };
    return true;
  };
  return browser.evaluate('(' + install.toString() + ')()');
}

describe('Main Canvas App autosave with native Chromium IndexedDB', () => {
  browserIt(
    'mounts Preact App, fences native IndexedDB races, and restores the latest durable project after reload',
    async () => {
      let vite;
      let browser;
      let fixtureDirectory;
      try {
        fixtureDirectory = mkdtempSync(join(tmpdir(), 'folio-native-persistence-fixture-'));
        const fixturePath = join(fixtureDirectory, 'browser.html');
        writeFileSync(fixturePath, '<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>');
        vite = await startViteApp();
        browser = await launchChromium(fixturePath);
        await browser.send('Emulation.setDeviceMetricsOverride', {
          width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
        });
        await browser.send('Storage.clearDataForOrigin', {
          origin: new URL(vite.url).origin, storageTypes: 'all',
        });
        await browser.navigate(vite.url);

        await waitForApp(browser,
          'document.querySelector(".app-shell")?.getAttribute("aria-busy")==="false"',
          'actual Preact App hydration');
        await waitForApp(browser,
          'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
          'initial Main Canvas autosave completes');

        const ready = await browser.evaluate(
          '({app:!!document.querySelector("#app .app-shell"),busy:document.querySelector(".app-shell")?.getAttribute("aria-busy"),' +
          'indexedDb:"indexedDB" in window,componentStatus:!!document.querySelector(".component-buffer-save")})',
        );
        expect(ready).toEqual({ app: true, busy: 'false', indexedDb: true, componentStatus: true });

        const baseline = await readMainProject(browser);
        expect(baseline.databaseVersion).toBe(2);
        expect(baseline.projectId).toBeTruthy();
        expect(baseline.formatVersion).toBe(2);
        const baselineCount = baseline.nodeCount;

        expect(await installNativePersistenceProbe(browser)).toBe(true);
        await ensureTemplateComponentMode(browser);

        // The actual 450 ms App effect must cancel the earlier snapshot and
        // persist only the later revision after a second Main Canvas action.
        await browser.evaluate(
          '(() => { const p=window.__folioNativePersistenceProbe; p.puts=[]; p.events=[]; p.triggered=[]; })()',
        );
        await addShape(browser, 'Rectangle');
        await delay(50);
        await addShape(browser, 'Text');
        await waitForApp(browser,
          'document.querySelector(".statusbar .status-right")?.classList.contains("save-saving")',
          'Main Canvas shows saving while the latest debounce is pending');
        await waitForApp(browser,
          'window.__folioNativePersistenceProbe.puts.length>=1 && ' +
          'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
          'latest debounce snapshot becomes durable');
        const pendingDebounce = await browser.evaluate('window.__folioNativePersistenceProbe.puts');
        expect(pendingDebounce).toHaveLength(1);
        expect(pendingDebounce[0].nodeCount).toBe(baselineCount + 2);
        const afterDebounce = await readMainProject(browser);
        expect(afterDebounce.nodeCount).toBe(baselineCount + 2);

        // Native transaction A: a follow-up request keeps the real readwrite
        // transaction active. A real App action changes projectRevision inside
        // that request event, so the old transaction must abort before commit.
        await browser.evaluate(
          '(() => { const p=window.__folioNativePersistenceProbe; p.puts=[]; p.events=[]; p.triggered=[]; ' +
          'p.abortReadNodeCount=null; p.triggerErrors=[]; p.nextMode="abort-before-commit"; })()',
        );
        await addShape(browser, 'Rectangle');
        await openCreateMenu(browser); // Leave Ellipse mounted before the write starts.
        await waitForApp(browser,
          'window.__folioNativePersistenceProbe.triggered.includes("abort-before-commit")',
          'native IndexedDB request callback changes canonical revision');
        await waitForApp(browser,
          'window.__folioNativePersistenceProbe.events.some((event)=>event.mode==="abort-before-commit"&&event.event==="abort")',
          'native IndexedDB aborts the stale in-flight transaction');
        await delay(60);
        const afterAbortStatus = await getStatus(browser);
        expect(afterAbortStatus?.className).toContain('save-saving');
        expect(await browser.evaluate('window.__folioNativePersistenceProbe.triggerErrors')).toEqual([]);
        await waitForApp(browser,
          'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
          'newer revision is saved after the intentional native abort');
        const abortEvidence = await browser.evaluate(
          '({puts:window.__folioNativePersistenceProbe.puts,events:window.__folioNativePersistenceProbe.events,' +
          'triggered:window.__folioNativePersistenceProbe.triggered,abortReadNodeCount:window.__folioNativePersistenceProbe.abortReadNodeCount})',
        );
        expect(abortEvidence.events).toContainEqual({ mode: 'abort-before-commit', event: 'abort' });
        expect(abortEvidence.events).not.toContainEqual({ mode: 'abort-before-commit', event: 'complete' });
        expect(abortEvidence.triggered).toContain('abort-before-commit');
        expect(abortEvidence.abortReadNodeCount).toBe(baselineCount + 2);
        expect(abortEvidence.puts[0].nodeCount).toBe(baselineCount + 3);
        expect(abortEvidence.puts[1].nodeCount).toBe(baselineCount + 4);
        const afterAbort = await readMainProject(browser);
        expect(afterAbort.nodeCount).toBe(baselineCount + 4);

        // Native transaction B: the record has committed when its complete
        // event fires. A second App action cannot roll that commit back; the
        // final revision fence must still persist the newer canonical snapshot.
        await browser.evaluate(
          '(() => { const p=window.__folioNativePersistenceProbe; p.puts=[]; p.events=[]; p.triggered=[]; ' +
          'p.afterCommitReadNodeCount=null; p.triggerErrors=[]; p.nextMode="after-commit"; })()',
        );
        await addShape(browser, 'Rectangle');
        await openCreateMenu(browser); // Leave Text mounted for the complete-event revision change.
        await waitForApp(browser,
          'window.__folioNativePersistenceProbe.triggered.includes("after-commit")',
          'new canonical revision changes during native transaction complete event');
        await waitForApp(browser,
          'window.__folioNativePersistenceProbe.afterCommitReadNodeCount!==null',
          'native read observes the already-committed pre-revision snapshot');
        await delay(60);
        const afterCommitStatus = await getStatus(browser);
        expect(afterCommitStatus?.className).toContain('save-saving');
        expect(await browser.evaluate('window.__folioNativePersistenceProbe.triggerErrors')).toEqual([]);
        const afterCommitEvidence = await browser.evaluate(
          '({puts:window.__folioNativePersistenceProbe.puts,events:window.__folioNativePersistenceProbe.events,' +
          'triggered:window.__folioNativePersistenceProbe.triggered,readCount:window.__folioNativePersistenceProbe.afterCommitReadNodeCount})',
        );
        expect(afterCommitEvidence.events).toContainEqual({ mode: 'after-commit', event: 'complete' });
        expect(afterCommitEvidence.events).not.toContainEqual({ mode: 'after-commit', event: 'abort' });
        expect(afterCommitEvidence.triggered).toContain('after-commit');
        expect(afterCommitEvidence.puts[0].nodeCount).toBe(baselineCount + 5);
        expect(afterCommitEvidence.readCount).toBe(baselineCount + 5);
        await waitForApp(browser,
          'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
          'post-commit newer canonical revision is eventually saved');
        const afterCommit = await readMainProject(browser);
        expect(afterCommit.nodeCount).toBe(baselineCount + 6);

        // Reload and read the same real IndexedDB database. DOM layers and the
        // durable active-page snapshot must agree after App hydration.
        await browser.reload();
        await waitForApp(browser,
          'document.querySelector(".app-shell")?.getAttribute("aria-busy")==="false"',
          'App rehydrates from native IndexedDB after reload');
        await waitForApp(browser,
          'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
          'restored project finishes its autosave cycle');
        const reloadedProject = await readMainProject(browser);
        const rendered = await browser.evaluate(
          '({layerCount:document.querySelectorAll(".layers-panel .layer-row").length,' +
          'layerNames:Array.from(document.querySelectorAll(".layers-panel .layer-name")).map((item)=>item.textContent.trim())})',
        );
        expect(reloadedProject.projectId).toBe(baseline.projectId);
        expect(reloadedProject.nodeCount).toBe(afterCommit.nodeCount);
        expect(rendered.layerCount).toBe(reloadedProject.nodeCount);
        expect([...rendered.layerNames].sort()).toEqual([...reloadedProject.nodeNames].sort());
      } finally {
        await browser?.close();
        await vite?.close();
        if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
    120000,
  );
});

