import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from 'vite';
import { describe, expect, it } from 'vitest';

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
const browserAvailability = chromium
  ? (typeof WebSocket !== 'undefined' ? 'available' : 'Node WebSocket unavailable')
  : 'Chromium binary unavailable; set CHROMIUM_BIN or install Chromium in the CI image';

async function launchChromiumAttempt(path, attemptNumber) {
  if (!chromium) throw new Error(browserAvailability);
  if (typeof WebSocket === 'undefined') throw new Error(browserAvailability);

  const profile = mkdtempSync(join(tmpdir(), 'folio-native-persistence-chromium-'));
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
    '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--disable-background-networking', '--disable-extensions',
    '--disable-breakpad', '--disable-crash-reporter', '--no-first-run',
    '--no-default-browser-check', '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
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
        try {
          if (processGroupIsAlive()) process.kill(-child.pid, 'SIGTERM');
        } catch { /* The group may have exited between the check and signal. */ }
        const stopped = await waitForProcessGroupExit(4000);
        if (!stopped) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
          await waitForProcessGroupExit(2500);
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
          if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) debugPort = parsedPort;
        } catch (error) {
          lastEndpointError = 'Could not read DevToolsActivePort: ' + String(error);
        }
      }
      if (debugPort !== null) {
        try {
          const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list', {
            signal: AbortSignal.timeout(750),
          });
          if (response.ok) {
            targets = await response.json();
            if (Array.isArray(targets)) break;
          } else lastEndpointError = 'DevTools /json/list returned HTTP ' + response.status;
        } catch (error) {
          lastEndpointError = String(error);
        }
      }
      await delay(50);
    }

    if (!targets) {
      const processState = spawnError ? 'spawnError=' + String(spawnError)
        : 'exitCode=' + String(child.exitCode) + ', signal=' + String(child.signalCode);
      throw new Error(
        'Chromium DevTools startup failed on attempt ' + attemptNumber + ' (' + processState + '). DevToolsActivePort=' +
        (activePortContents.trim() || '<not created>') +
        (lastEndpointError ? '. Endpoint=' + lastEndpointError : '') +
        '. stderr tail:\n' + stderr.slice(-3000),
      );
    }

    const page = targets.find((target) => target.type === 'page' && target.url.startsWith('file://'));

    if (!page?.webSocketDebuggerUrl) {
      throw new Error('Chromium exposed DevTools on attempt ' + attemptNumber + ' but no fixture page target. Targets=' + JSON.stringify(targets));
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
      }, 45000);
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
        throw new Error(result.result?.description || result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    };

    const click = async (selector) => {
      const point = await evaluate(
        '(() => { const element=document.querySelector(' + JSON.stringify(selector) + '); ' +
        'if(!element) throw new Error("Click target missing: " + ' + JSON.stringify(selector) + '); ' +
        'element.scrollIntoView({block:"center",inline:"center"}); const rect=element.getBoundingClientRect(); ' +
        'const left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right); ' +
        'const top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom); ' +
        'if(right<=left||bottom<=top) throw new Error("Click target outside viewport"); ' +
        'const p={x:left+(right-left)/2,y:top+(bottom-top)/2}; const hit=document.elementFromPoint(p.x,p.y); ' +
        'if(!hit||!(hit===element||element.contains(hit))) throw new Error("Click target occluded"); return p; })()',
      );
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    return {
      send, evaluate, click,
      navigate: (url) => send('Page.navigate', { url }),
      reload: () => send('Page.reload', { ignoreCache: true }),
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
  throw new Error('Chromium startup failed after two isolated attempts:\\n' + failures.join('\\n--- retry ---\\n'));
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
  await browser.click('button[aria-label="Create tools"]');
  await waitForApp(browser, 'document.querySelectorAll(".tool-rack-menu button[role=menuitem]").length===3',
    'Create tools menu rendered');
}

async function addShape(browser, label) {
  const index = { Rectangle: 1, Ellipse: 2, Text: 3 }[label];
  if (!index) throw new Error('Unsupported test shape: ' + label);
  await openCreateMenu(browser);
  await browser.click('.tool-rack-menu button[role="menuitem"]:nth-of-type(' + index + ')');
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
    const clickMenuItem = (label, mode) => {
      const item = Array.from(document.querySelectorAll('.tool-rack-menu button[role="menuitem"]'))
        .find((button) => button.textContent.trim() === label);
      if (!item) {
        probe.triggerErrors.push(mode + ': ' + label + ' menu item was not mounted');
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
          const read = transaction.db.transaction('projects', 'readonly');
          const request = read.objectStore('projects').get(value.metadata.id);
          request.onsuccess = () => {
            probe.abortReadNodeCount = projectNodes(request.result).length;
          };
        }, { once: true });
        transaction.addEventListener('complete', () => {
          probe.events.push({ mode, event: 'complete' });
          if (mode === 'after-commit') {
            const read = transaction.db.transaction('projects', 'readonly');
            const request = read.objectStore('projects').get(value.metadata.id);
            request.onsuccess = () => {
              probe.afterCommitReadNodeCount = projectNodes(request.result).length;
            };
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

        // The actual 450 ms App effect must cancel the earlier snapshot and
        // persist only the later revision after a second Main Canvas action.
        await browser.evaluate(
          '(() => { const p=window.__folioNativePersistenceProbe; p.puts=[]; p.events=[]; p.triggered=[]; })()',
        );
        await addShape(browser, 'Rectangle');
        await delay(110);
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
        expect(rendered.layerNames).toEqual(reloadedProject.nodeNames);
      } finally {
        await browser?.close();
        await vite?.close();
        if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
    120000,
  );
});

