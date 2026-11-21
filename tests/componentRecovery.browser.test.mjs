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
const browserIt = it;
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


async function startDisposableApp() {
  let vite;
  let browser;
  let fixtureDirectory;
  try {
    if (!chromium || typeof WebSocket === 'undefined') {
      throw new Error('Required native Chromium acceptance prerequisite missing: ' + browserAvailability);
    }
    fixtureDirectory = mkdtempSync(join(tmpdir(), 'folio-component-recovery-fixture-'));
    const fixturePath = join(fixtureDirectory, 'browser.html');
    writeFileSync(fixturePath, '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    vite = await startViteApp();
    browser = await launchChromium(fixturePath);
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await browser.send('Storage.clearDataForOrigin', {
      origin: new URL(vite.url).origin,
      storageTypes: 'all',
    });
    await browser.navigate(vite.url);
    await waitForApp(
      browser,
      'document.querySelector(".app-shell")?.getAttribute("aria-busy")==="false"',
      'actual Preact App hydration',
    );
    await waitForApp(
      browser,
      'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
      'initial Main Canvas project autosave',
    );
    await waitForApp(
      browser,
      'document.querySelector(".component-buffer-save")?.classList.contains("component-save-saved")',
      'initial Component Canvas buffer autosave',
    );
    return { vite, browser, fixtureDirectory, origin: vite.url };
  } catch (error) {
    await browser?.close();
    await vite?.close();
    if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}

async function closeDisposableApp(context) {
  await context?.browser?.close();
  await context?.vite?.close();
  if (context?.fixtureDirectory) {
    rmSync(context.fixtureDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function readNativeProjects(browser) {
  return browser.evaluate(
    '(async()=>{const open=indexedDB.open("folio-studio");' +
    'const db=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);' +
    'open.onerror=()=>reject(open.error||new Error("IndexedDB open failed"));' +
    'open.onblocked=()=>reject(new Error("IndexedDB read blocked"));});' +
    'if(db.version!==2){const version=db.version;db.close();throw new Error("Expected IndexedDB v2, got "+version);}' +
    'if(!db.objectStoreNames.contains("projects")){db.close();throw new Error("Native projects object store missing");}' +
    'const tx=db.transaction("projects","readonly");const request=tx.objectStore("projects").getAll();let records=[];' +
    'request.onsuccess=()=>{records=request.result||[];};' +
    'await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Native read failed"));' +
    'tx.onabort=()=>reject(tx.error||new Error("Native read aborted"));});db.close();' +
    'const roots=records.filter((record)=>record&&record.metadata&&typeof record.metadata.id==="string"&&' +
    'record.metadata.id!=="folio-component-canvas"&&!record.metadata.id.startsWith("folio-page-"));' +
    'if(roots.length!==1)throw new Error("Expected exactly one root project record, found "+roots.length);' +
    'const root=roots[0];const buffer=records.find((record)=>record&&record.metadata?.id==="folio-component-canvas")||null;' +
    'const getNodes=(project)=>{const page=project?.pages?.find((item)=>item.id===project.activePageId)||project?.pages?.[0];' +
    'return Array.isArray(page?.document?.nodes)?page.document.nodes:[];};' +
    'return {databaseVersion:2,root:{id:root.metadata.id,name:root.metadata.name,formatVersion:root.formatVersion,' +
    'components:(root.components||[]).map((component)=>({id:component.id,name:component.name,' +
    'documentId:component.document?.id,nodeCount:Array.isArray(component.document?.nodes)?component.document.nodes.length:0,' +
    'nodes:(component.document?.nodes||[]).map((node)=>({id:node.id,name:node.name,type:node.type,parentId:node.parentId}))}))},' +
    'buffer:buffer?{id:buffer.metadata.id,nodeCount:getNodes(buffer).length,' +
    'nodes:getNodes(buffer).map((node)=>({id:node.id,name:node.name,type:node.type,parentId:node.parentId}))}:null};})()',
  );
}

async function waitForNativeProjects(browser, predicate, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await readNativeProjects(browser);
    if (predicate(last)) return last;
    await delay(80);
  }
  throw new Error('Timed out waiting for native IndexedDB state: ' + description + '. Last state=' + JSON.stringify(last));
}

function installNativeDeletionProbeSource() {
  const probe = {
    masterId: null,
    masterName: null,
    abortPhase: null,
    tracking: false,
    writes: [],
    events: [],
    triggerErrors: [],
  };
  window.__folioComponentRecoveryProbe = probe;
  const originalPut = IDBObjectStore.prototype.put;
  const getNodes = (project) => {
    const page = project?.pages?.find((item) => item.id === project.activePageId) ?? project?.pages?.[0];
    return Array.isArray(page?.document?.nodes) ? page.document.nodes : [];
  };
  const phaseFor = (project) => {
    if (!project || typeof project !== 'object') return null;
    if (project.metadata?.id === 'folio-component-canvas') {
      return getNodes(project).length === 0 ? 'cleanup' : null;
    }
    if (!Array.isArray(project.components) || !probe.masterId) return null;
    const hasMaster = project.components.some((component) => component.id === probe.masterId);
    const recoveryName = probe.masterName + ' (Recovered)';
    const hasRecovery = project.components.some((component) =>
      component.id !== probe.masterId && component.name === recoveryName);
    if (hasMaster && hasRecovery) return 'recovery';
    if (!hasMaster && hasRecovery) return 'deletion';
    if (!hasMaster && !hasRecovery) return 'plain-deletion';
    return null;
  };
  IDBObjectStore.prototype.put = function(value, ...args) {
    if (this.name !== 'projects' || this.transaction?.mode !== 'readwrite') {
      return originalPut.call(this, value, ...args);
    }
    const phase = phaseFor(value);
    if (!phase) return originalPut.call(this, value, ...args);
    const entry = {
      phase,
      projectId: value.metadata?.id ?? null,
      masterId: probe.masterId,
      components: Array.isArray(value.components)
        ? value.components.map((component) => ({
            id: component.id,
            name: component.name,
            nodeIds: (component.document?.nodes || []).map((node) => node.id),
            nodeNames: (component.document?.nodes || []).map((node) => node.name),
          }))
        : [],
      bufferNodeIds: value.metadata?.id === 'folio-component-canvas'
        ? getNodes(value).map((node) => node.id)
        : [],
    };
    if (probe.tracking) {
      probe.writes.push(entry);
      const transaction = this.transaction;
      transaction.addEventListener('complete', () => {
        probe.events.push({ phase, event: 'complete', projectId: entry.projectId });
      }, { once: true });
      transaction.addEventListener('abort', () => {
        probe.events.push({ phase, event: 'abort', projectId: entry.projectId });
      }, { once: true });
    }
    const request = originalPut.call(this, value, ...args);
    if (probe.abortPhase === phase) {
      probe.abortPhase = null;
      try {
        this.transaction.abort();
      } catch (error) {
        probe.triggerErrors.push(phase + ': abort threw ' + String(error));
      }
    }
    return request;
  };
  return true;
}

async function installNativeDeletionProbe(browser) {
  return browser.evaluate('(' + installNativeDeletionProbeSource.toString() + ')()');
}

async function armNativeDeletionProbe(browser, masterId, masterName, abortPhase = null) {
  return browser.evaluate(
    '(() => { const p=window.__folioComponentRecoveryProbe; if(!p)throw new Error("Native deletion probe is not installed");' +
    'p.masterId=' + JSON.stringify(masterId) + ';p.masterName=' + JSON.stringify(masterName) + ';' +
    'p.abortPhase=' + JSON.stringify(abortPhase) + ';p.tracking=true;p.writes=[];p.events=[];p.triggerErrors=[];return true;})()',
  );
}

async function readNativeDeletionProbe(browser) {
  return browser.evaluate(
    '(()=>{const p=window.__folioComponentRecoveryProbe;if(!p)return null;' +
    'return {masterId:p.masterId,masterName:p.masterName,abortPhase:p.abortPhase,' +
    'writes:p.writes,events:p.events,triggerErrors:p.triggerErrors};})()',
  );
}

async function ensureComponentRackOpen(browser) {
  const isOpen = await browser.evaluate(
    'document.querySelector(".component-rack-panel")?.classList.contains("is-open")===true',
  );
  if (!isOpen) await browser.click('button.component-rack-header-toggle');
  await waitForApp(
    browser,
    'document.querySelector(".component-rack-panel")?.classList.contains("is-open")===true',
    'Component Rack opened',
  );
}

async function clickCardAction(browser, componentName, action) {
  const result = await browser.evaluate(
    '(() => {const card=Array.from(document.querySelectorAll(".component-rack-card")).find((item)=>' +
    'item.querySelector(".component-rack-card-name")?.textContent.trim()===' + JSON.stringify(componentName) + ');' +
    'if(!card)throw new Error("Component Rack card not found: "+' + JSON.stringify(componentName) + ');' +
    'const button=card.querySelector(' + JSON.stringify(action) + ');' +
    'if(!button)throw new Error("Component action not found: "+' + JSON.stringify(action) + ');' +
    'button.focus();button.click();return true;})()',
  );
  expect(result).toBe(true);
}

async function clickDialogAction(browser, label) {
  const result = await browser.evaluate(
    '(() => {const dialog=document.querySelector(".component-deletion-dialog");' +
    'if(!dialog)throw new Error("Component deletion dialog is not open");' +
    'const button=Array.from(dialog.querySelectorAll("button")).find((item)=>item.textContent.trim()===' +
    JSON.stringify(label) + ');' +
    'if(!button)throw new Error("Dialog action not found: "+' + JSON.stringify(label) + ');' +
    'button.click();return true;})()',
  );
  expect(result).toBe(true);
}

async function pressKey(browser, key, virtualKeyCode, shift = false) {
  const payload = {
    key,
    code: key === 'Escape' ? 'Escape' : 'Tab',
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    ...(shift ? { modifiers: 8 } : {}),
  };
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', ...payload });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload });
}

async function createComponentMaster(browser) {
  await ensureComponentRackOpen(browser);
  const before = await browser.evaluate('document.querySelectorAll(".component-rack-card").length');
  await browser.click('button[title="Create a new master component"]');
  await waitForApp(
    browser,
    'document.querySelectorAll(".component-rack-card").length===' + (before + 1),
    'new master appears in Component Rack',
  );
  await waitForApp(browser, 'document.querySelector('[data-window-id="component-canvas"]')!==null', 'new master opens Component Canvas');
  const name = await browser.evaluate(
    'Array.from(document.querySelectorAll(".component-rack-card-name")).at(-1)?.textContent.trim()||null',
  );
  expect(name).toBeTruthy();
  await ensureComponentRackOpen(browser);
  const renameSelector = 'button[title=' + JSON.stringify('Rename ' + name) + ']';
  await waitForApp(
    browser,
    'document.querySelector(' + JSON.stringify(renameSelector) + ')!==null',
    'new master action controls are available',
  );
  return name;
}

async function createDirtyActiveMaster(browser) {
  const originalName = await createComponentMaster(browser);
  const renamedName = originalName + ' QA';
  await browser.click('button[title=' + JSON.stringify('Rename ' + originalName) + ']');
  const inputSelector = 'input[aria-label=' + JSON.stringify('Rename ' + originalName) + ']';
  await waitForApp(
    browser,
    'document.querySelector(' + JSON.stringify(inputSelector) + ')!==null',
    'Component Rack rename form opens',
  );
  await browser.evaluate(
    '(() => {const input=document.querySelector(' + JSON.stringify(inputSelector) + ');' +
    'if(!input)throw new Error("Rename input missing");input.focus();input.select();return true;})()',
  );
  await browser.send('Input.insertText', { text: renamedName });
  await waitForApp(
    browser,
    'document.querySelector(' + JSON.stringify(inputSelector) + ')?.value===' + JSON.stringify(renamedName),
    'rename draft is stored before the concurrent local edit',
  );
  await browser.click('button[aria-label="Create tools"]');
  await waitForApp(
    browser,
    'document.querySelectorAll(".tool-rack-menu button[role=menuitem]").length===3',
    'Create tools menu opens for the Component Canvas',
  );

  // Both real UI event handlers run in one browser task. Preact publishes the
  // local buffer edit and canonical rename together; the sync effect therefore
  // sees a changed master timestamp plus a structurally dirty buffer and must
  // pause rather than overwrite either side.
  const race = await browser.evaluate(
    '(() => {const item=Array.from(document.querySelectorAll(".tool-rack-menu button[role=menuitem]"))' +
    '.find((button)=>button.textContent.trim()==="Rectangle");' +
    'const card=Array.from(document.querySelectorAll(".component-rack-card")).find((entry)=>' +
    'entry.querySelector(".component-rack-card-name")?.textContent.trim()===' + JSON.stringify(originalName) + ');' +
    'const form=card?.querySelector("form");if(!item||!form)throw new Error("Concurrent UI controls were not both available");' +
    'item.click();form.requestSubmit();return true;})()',
  );
  expect(race).toBe(true);
  await waitForApp(
    browser,
    'document.querySelector(".toast")?.textContent.includes("unsynchronized edits")===true',
    'actual App marks the Component Canvas buffer conflicted after canonical master changes',
    15000,
  );
  await waitForApp(
    browser,
    'document.querySelector(".component-buffer-save")?.classList.contains("component-save-saved")===true',
    'dirty Component Canvas buffer is durably autosaved',
  );

  const state = await waitForNativeProjects(
    browser,
    (value) => {
      const master = value.root.components.find((component) => component.name === renamedName);
      return Boolean(master && master.nodeCount === 0 && value.buffer?.nodeCount === 1);
    },
    'native root master remains unchanged while the local Component Canvas buffer keeps its edit',
  );
  const master = state.root.components.find((component) => component.name === renamedName);
  expect(master).toBeTruthy();
  expect(master.nodeCount).toBe(0);
  expect(state.buffer.nodeCount).toBe(1);
  return { originalName, name: renamedName, masterId: master.id, buffer: state.buffer, before: state };
}

async function clickDeleteMaster(browser, name) {
  await clickCardAction(browser, name, 'button.component-rack-delete');
  await waitForApp(
    browser,
    'document.querySelector(".component-deletion-dialog")!==null',
    'active dirty master deletion opens the recovery dialog',
  );
}

async function waitForDialogClosed(browser) {
  await waitForApp(browser, 'document.querySelector(".component-deletion-dialog")===null', 'Component deletion dialog closes');
}

async function waitForAppReload(browser) {
  await waitForApp(
    browser,
    'document.querySelector(".app-shell")?.getAttribute("aria-busy")==="false"',
    'actual App rehydrates after reload',
  );
  await waitForApp(
    browser,
    'document.querySelector(".statusbar .status-right")?.classList.contains("save-saved")',
    'Main Canvas persistence settles after reload',
  );
  await waitForApp(
    browser,
    'document.querySelector(".component-buffer-save")?.classList.contains("component-save-saved")',
    'Component Canvas buffer persistence settles after reload',
  );
}

function assertPhaseOrder(events, phases) {
  const completed = phases.map((phase) => events.findIndex((event) => event.phase === phase && event.event === 'complete'));
  expect(completed.every((index) => index >= 0)).toBe(true);
  expect([...completed].sort((a, b) => a - b)).toEqual(completed);
}

describe('Component Canvas deletion and recovery — actual App / Chromium / IndexedDB v2', () => {
  browserIt(
    'keeps Cancel safe, traps dialog focus, retries Delete, saves a recovery copy before deletion, and reloads the durable result',
    async () => {
      let context;
      try {
        context = await startDisposableApp();
        const browser = context.browser;
        expect(await installNativeDeletionProbe(browser)).toBe(true);
        const master = await createDirtyActiveMaster(browser);
        await clickDeleteMaster(browser, master.name);

        const dialogState = await browser.evaluate(
          '(() => {const shell=document.querySelector(".app-shell");const host=document.querySelector(".component-deletion-modal-host");' +
          'const dialog=document.querySelector(".component-deletion-dialog");const initial=dialog?.querySelector("[data-dialog-initial-focus]");' +
          'return {dialog:!!dialog,initialFocused:document.activeElement===initial,backgroundInert:Array.from(shell.children)' +
          '.filter((child)=>child!==host).every((child)=>child.inert&&child.getAttribute("aria-hidden")==="true"),' +
          'buttonTexts:Array.from(dialog.querySelectorAll("button")).map((button)=>button.textContent.trim())};})()',
        );
        expect(dialogState.dialog).toBe(true);
        expect(dialogState.initialFocused).toBe(true);
        expect(dialogState.backgroundInert).toBe(true);
        expect(dialogState.buttonTexts).toEqual([
          'Cancel',
          'Save buffer as a new component',
          'Discard buffer and delete',
        ]);

        await pressKey(browser, 'Tab', 9, true);
        const reverseWrapped = await browser.evaluate(
          'document.activeElement===Array.from(document.querySelector(".component-deletion-dialog").querySelectorAll("button")).at(-1)',
        );
        expect(reverseWrapped).toBe(true);
        await pressKey(browser, 'Tab', 9, false);
        const forwardWrapped = await browser.evaluate(
          'document.activeElement===document.querySelector(".component-deletion-dialog [data-dialog-initial-focus]")',
        );
        expect(forwardWrapped).toBe(true);

        await pressKey(browser, 'Escape', 27);
        await waitForDialogClosed(browser);
        const cancelState = await readNativeProjects(browser);
        expect(cancelState.root.components.some((component) => component.id === master.masterId)).toBe(true);
        expect(cancelState.buffer.nodes.map((node) => node.id)).toEqual(master.buffer.nodes.map((node) => node.id));
        const focusReturned = await browser.evaluate(
          'document.activeElement===document.querySelector("button[aria-label="+JSON.stringify(' +
          JSON.stringify('Delete ' + master.name) + ')+"]")',
        );
        expect(focusReturned).toBe(true);
        expect(await browser.evaluate('document.querySelector('[data-window-id="component-canvas"]')!==null')).toBe(true);

        await clickDeleteMaster(browser, master.name);
        await armNativeDeletionProbe(browser, master.masterId, master.name);
        await clickDialogAction(browser, 'Save buffer as a new component');
        await waitForDialogClosed(browser);
        const successfulProbe = await readNativeDeletionProbe(browser);
        expect(successfulProbe.triggerErrors).toEqual([]);
        assertPhaseOrder(successfulProbe.events, ['recovery', 'deletion', 'cleanup']);
        const finalState = await waitForNativeProjects(
          browser,
          (value) => !value.root.components.some((component) => component.id === master.masterId) &&
            value.buffer?.nodeCount === 0,
          'recovery copy and original-master deletion are committed before Component Canvas cleanup',
        );
        const recovered = finalState.root.components.filter((component) =>
          component.name === master.name + ' (Recovered)');
        expect(recovered).toHaveLength(1);
        expect(recovered[0].nodeCount).toBe(master.buffer.nodeCount);
        expect(recovered[0].nodes.map((node) => node.id)).toEqual(master.buffer.nodes.map((node) => node.id));
        expect(recovered[0].nodes.map((node) => node.name)).toEqual(master.buffer.nodes.map((node) => node.name));
        expect(finalState.buffer.nodeCount).toBe(0);
        await browser.reload();
        await waitForAppReload(browser);
        const restored = await readNativeProjects(browser);
        expect(restored.root.id).toBe(finalState.root.id);
        expect(restored.root.components.filter((component) => component.name === master.name + ' (Recovered)')).toHaveLength(1);
        expect(restored.buffer.nodeCount).toBe(0);
      } finally {
        await closeDisposableApp(context);
      }
    },
    120000,
  );

  browserIt(
    'aborts only the native recovery-copy transaction, preserves the master and buffer, then retries and reloads',
    async () => {
      let context;
      try {
        context = await startDisposableApp();
        const browser = context.browser;
        await installNativeDeletionProbe(browser);
        const master = await createDirtyActiveMaster(browser);
        await clickDeleteMaster(browser, master.name);
        await armNativeDeletionProbe(browser, master.masterId, master.name, 'recovery');
        await clickDialogAction(browser, 'Save buffer as a new component');
        await waitForApp(
          browser,
          'document.querySelector(".toast")?.textContent.includes("Recovery-copy persistence failed")===true',
          'recovery-copy IndexedDB transaction failure is surfaced by the actual App',
        );
        await waitForApp(
          browser,
          'window.__folioComponentRecoveryProbe.events.some((event)=>event.phase==="recovery"&&event.event==="abort")',
          'targeted native recovery-copy transaction aborts',
        );
        const failedProbe = await readNativeDeletionProbe(browser);
        expect(failedProbe.triggerErrors).toEqual([]);
        const afterFailure = await readNativeProjects(browser);
        expect(afterFailure.root.components.some((component) => component.id === master.masterId)).toBe(true);
        expect(afterFailure.root.components.some((component) => component.name === master.name + ' (Recovered)')).toBe(false);
        expect(afterFailure.buffer.nodes.map((node) => node.id)).toEqual(master.buffer.nodes.map((node) => node.id));
        expect(await browser.evaluate('document.querySelector(".component-deletion-dialog")!==null')).toBe(true);

        await clickDialogAction(browser, 'Save buffer as a new component');
        await waitForDialogClosed(browser);
        const finalState = await waitForNativeProjects(
          browser,
          (value) => !value.root.components.some((component) => component.id === master.masterId) &&
            value.buffer?.nodeCount === 0,
          'recovery retry commits the copy, then deletion and cleanup',
        );
        expect(finalState.root.components.filter((component) => component.name === master.name + ' (Recovered)')).toHaveLength(1);
        const retryProbe = await readNativeDeletionProbe(browser);
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'recovery', event: 'abort' }));
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'recovery', event: 'complete' }));
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'deletion', event: 'complete' }));
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'cleanup', event: 'complete' }));
        await browser.reload();
        await waitForAppReload(browser);
        const restored = await readNativeProjects(browser);
        expect(restored.root.components.filter((component) => component.name === master.name + ' (Recovered)')).toHaveLength(1);
        expect(restored.root.components.some((component) => component.id === master.masterId)).toBe(false);
        expect(restored.buffer.nodeCount).toBe(0);
      } finally {
        await closeDisposableApp(context);
      }
    },
    120000,
  );

  browserIt(
    'aborts the native deletion transaction after a durable recovery copy, retries without duplication, and reloads',
    async () => {
      let context;
      try {
        context = await startDisposableApp();
        const browser = context.browser;
        await installNativeDeletionProbe(browser);
        const master = await createDirtyActiveMaster(browser);
        await clickDeleteMaster(browser, master.name);
        await armNativeDeletionProbe(browser, master.masterId, master.name, 'deletion');
        await clickDialogAction(browser, 'Save buffer as a new component');
        await waitForApp(
          browser,
          'document.querySelector(".toast")?.textContent.includes("deletion persistence failed")===true',
          'canonical deletion IndexedDB transaction failure is surfaced by the actual App',
        );
        await waitForApp(
          browser,
          'window.__folioComponentRecoveryProbe.events.some((event)=>event.phase==="deletion"&&event.event==="abort")',
          'targeted native canonical deletion transaction aborts',
        );
        const afterFailure = await readNativeProjects(browser);
        expect(afterFailure.root.components.some((component) => component.id === master.masterId)).toBe(true);
        const recoveryBeforeRetry = afterFailure.root.components.filter((component) =>
          component.name === master.name + ' (Recovered)');
        expect(recoveryBeforeRetry).toHaveLength(1);
        expect(recoveryBeforeRetry[0].nodes.map((node) => node.id)).toEqual(master.buffer.nodes.map((node) => node.id));
        expect(afterFailure.buffer.nodes.map((node) => node.id)).toEqual(master.buffer.nodes.map((node) => node.id));
        const retryDialog = await browser.evaluate(
          'document.querySelector(".component-deletion-dialog h2")?.textContent.trim()',
        );
        expect(retryDialog).toContain('Recovery copy saved; deletion needs retry');

        await clickDialogAction(browser, 'Retry deletion using saved recovery');
        await waitForDialogClosed(browser);
        await waitForNativeProjects(
          browser,
          (value) => !value.root.components.some((component) => component.id === master.masterId) &&
            value.buffer?.nodeCount === 0,
          'the actual App retries only the deletion and then performs buffer cleanup',
        );
        const retryProbe = await readNativeDeletionProbe(browser);
        expect(retryProbe.triggerErrors).toEqual([]);
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'recovery', event: 'complete' }));
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'deletion', event: 'abort' }));
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'deletion', event: 'complete' }));
        expect(retryProbe.events).toContainEqual(expect.objectContaining({ phase: 'cleanup', event: 'complete' }));
        const completedBeforeReload = await readNativeProjects(browser);
        expect(completedBeforeReload.root.components.some((component) => component.id === master.masterId)).toBe(false);
        expect(completedBeforeReload.root.components.filter((component) =>
          component.name === master.name + ' (Recovered)').length).toBe(1);
        expect(completedBeforeReload.buffer.nodeCount).toBe(0);

        await browser.reload();
        await waitForAppReload(browser);
        const restored = await readNativeProjects(browser);
        expect(restored.root.components.some((component) => component.id === master.masterId)).toBe(false);
        expect(restored.root.components.filter((component) =>
          component.name === master.name + ' (Recovered)').length).toBe(1);
        expect(restored.buffer.nodeCount).toBe(0);
      } finally {
        await closeDisposableApp(context);
      }
    },
    120000,
  );

  browserIt(
    'aborts native buffer cleanup after deletion is durable, retries cleanup only, and reloads',
    async () => {
      let context;
      try {
        context = await startDisposableApp();
        const browser = context.browser;
        await installNativeDeletionProbe(browser);
        const master = await createDirtyActiveMaster(browser);
        await clickDeleteMaster(browser, master.name);
        await armNativeDeletionProbe(browser, master.masterId, master.name, 'cleanup');
        await clickDialogAction(browser, 'Save buffer as a new component');
        await waitForApp(
          browser,
          'document.querySelector(".component-deletion-dialog h2")?.textContent.includes("Deletion saved; buffer cleanup pending")===true',
          'actual App keeps the protected buffer after native cleanup transaction failure',
        );
        await waitForApp(
          browser,
          'window.__folioComponentRecoveryProbe.events.some((event)=>event.phase==="cleanup"&&event.event==="abort")',
          'targeted native Component Canvas cleanup transaction aborts',
        );
        const afterFailure = await readNativeProjects(browser);
        expect(afterFailure.root.components.some((component) => component.id === master.masterId)).toBe(false);
        expect(afterFailure.root.components.filter((component) =>
          component.name === master.name + ' (Recovered)').length).toBe(1);
        expect(afterFailure.buffer.nodes.map((node) => node.id)).toEqual(master.buffer.nodes.map((node) => node.id));

        await clickDialogAction(browser, 'Retry durable cleanup');
        await waitForDialogClosed(browser);
        const probe = await readNativeDeletionProbe(browser);
        expect(probe.triggerErrors).toEqual([]);
        expect(probe.events).toContainEqual(expect.objectContaining({ phase: 'recovery', event: 'complete' }));
        expect(probe.events).toContainEqual(expect.objectContaining({ phase: 'deletion', event: 'complete' }));
        expect(probe.events).toContainEqual(expect.objectContaining({ phase: 'cleanup', event: 'abort' }));
        expect(probe.events).toContainEqual(expect.objectContaining({ phase: 'cleanup', event: 'complete' }));
        const finalState = await waitForNativeProjects(
          browser,
          (value) => value.buffer?.nodeCount === 0,
          'cleanup retry stores the reserved empty Component Canvas record',
        );
        expect(finalState.root.components.some((component) => component.id === master.masterId)).toBe(false);
        expect(finalState.root.components.filter((component) => component.name === master.name + ' (Recovered)')).toHaveLength(1);
        await browser.reload();
        await waitForAppReload(browser);
        const restored = await readNativeProjects(browser);
        expect(restored.buffer.nodeCount).toBe(0);
        expect(restored.root.components.filter((component) => component.name === master.name + ' (Recovered)')).toHaveLength(1);
      } finally {
        await closeDisposableApp(context);
      }
    },
    120000,
  );

  browserIt(
    'discards a dirty buffer only after deletion durability and deletes a clean active master after both barriers',
    async () => {
      let context;
      try {
        context = await startDisposableApp();
        const browser = context.browser;
        await installNativeDeletionProbe(browser);
        const dirty = await createDirtyActiveMaster(browser);
        await clickDeleteMaster(browser, dirty.name);
        await armNativeDeletionProbe(browser, dirty.masterId, dirty.name);
        await clickDialogAction(browser, 'Discard buffer and delete');
        await waitForDialogClosed(browser);
        const discardProbe = await readNativeDeletionProbe(browser);
        assertPhaseOrder(discardProbe.events, ['plain-deletion', 'cleanup']);
        const afterDiscard = await readNativeProjects(browser);
        expect(afterDiscard.root.components.some((component) => component.id === dirty.masterId)).toBe(false);
        expect(afterDiscard.root.components.some((component) => component.name === dirty.name + ' (Recovered)')).toBe(false);
        expect(afterDiscard.buffer.nodeCount).toBe(0);

        const cleanName = await createComponentMaster(browser);
        const cleanState = await readNativeProjects(browser);
        const cleanMaster = cleanState.root.components.find((component) => component.name === cleanName);
        expect(cleanMaster).toBeTruthy();
        expect(cleanMaster.nodeCount).toBe(0);
        await armNativeDeletionProbe(browser, cleanMaster.id, cleanName);
        await clickDeleteMaster(browser, cleanName);
        await waitForApp(
          browser,
          'document.querySelector(".component-deletion-dialog .component-deletion-progress")!==null',
          'clean active master shows durable deletion progress dialog',
        );
        await waitForDialogClosed(browser);
        const cleanProbe = await readNativeDeletionProbe(browser);
        assertPhaseOrder(cleanProbe.events, ['plain-deletion', 'cleanup']);
        const afterCleanDelete = await waitForNativeProjects(
          browser,
          (value) => !value.root.components.some((component) => component.id === cleanMaster.id) &&
            value.buffer?.nodeCount === 0,
          'clean master canonical deletion and reserved buffer cleanup are durable',
        );
        expect(afterCleanDelete.root.components.some((component) => component.id === cleanMaster.id)).toBe(false);
        expect(afterCleanDelete.buffer.nodeCount).toBe(0);
      } finally {
        await closeDisposableApp(context);
      }
    },
    120000,
  );
});
