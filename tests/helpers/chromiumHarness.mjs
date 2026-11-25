import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const STANDARD_CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'chromium',
  'chromium-browser',
  'google-chrome',
];

function findPlaywrightChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/ms-playwright',
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root).sort().reverse();
    } catch {
      continue;
    }
    for (const dir of entries) {
      if (!dir.startsWith('chromium')) continue;
      const candidates = [
        join(root, dir, 'chrome-linux', 'chrome'),
        join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        join(root, dir, 'chrome-linux64', 'chrome'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function findChromium() {
  const explicit = process.env.CHROMIUM_BIN;
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    const found = spawnSync('which', [explicit], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }

  for (const candidate of STANDARD_CHROMIUM_CANDIDATES) {
    if (candidate.startsWith('/') && existsSync(candidate)) return candidate;
    if (!candidate.startsWith('/')) {
      const found = spawnSync('which', [candidate], { encoding: 'utf8' });
      if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
    }
  }

  return findPlaywrightChromium();
}

export function getBrowserAvailability(chromiumBin = findChromium()) {
  if (!chromiumBin) {
    return 'Chromium binary unavailable; set CHROMIUM_BIN or install Chromium in the CI image';
  }
  if (typeof WebSocket === 'undefined') {
    return 'Node WebSocket API is unavailable; use the supported Node runtime';
  }
  return 'available';
}

function normalizeStartUrl(target) {
  if (/^(?:https?|file|about):/i.test(target)) return target;
  return `file://${target}`;
}

async function launchChromiumAttempt(targetUrl, options, attemptNumber) {
  const chromiumBin = options.chromiumBin ?? findChromium();
  const availability = getBrowserAvailability(chromiumBin);
  if (availability !== 'available') {
    throw new Error(availability);
  }

  const profilePrefix = options.profilePrefix ?? 'folio-chromium-profile-';
  const profile = mkdtempSync(join(tmpdir(), profilePrefix));
  const activePortPath = join(profile, 'DevToolsActivePort');
  const startUrl = normalizeStartUrl(targetUrl);

  // Headless Chromium needs no desktop session bus; strip CI's inherited D-Bus values.
  const chromiumEnv = { ...process.env };
  for (const key of [
    'DBUS_SESSION_BUS_ADDRESS',
    'DBUS_SESSION_BUS_PID',
    'DBUS_SYSTEM_BUS_ADDRESS',
    'DBUS_STARTER_ADDRESS',
    'DBUS_STARTER_BUS_TYPE',
  ]) {
    delete chromiumEnv[key];
  }

  const child = spawn(
    chromiumBin,
    [
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
      `--user-data-dir=${profile}`,
      startUrl,
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
      env: chromiumEnv,
    },
  );

  let socket;
  let stderr = '';
  let spawnError = null;
  let cleanupPromise = null;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', (error) => {
    spawnError = error;
  });

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
      try {
        socket?.close();
      } catch {
        // Ignore already closed websocket.
      }
      if (process.platform !== 'win32' && child.pid) {
        try {
          if (processGroupIsAlive()) process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Group may have exited between check and signal.
        }
        const stopped = await waitForProcessGroupExit(4000);
        if (!stopped) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
          await waitForProcessGroupExit(2500);
        }
      } else if (child.exitCode === null && child.signalCode === null && !spawnError) {
        try {
          child.kill('SIGTERM');
        } catch {
          // Already gone.
        }
        await waitForChildExit(4000);
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
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
    let targets = null;
    let lastEndpointError = '';
    const startupDeadline = Date.now() + (options.startupTimeoutMs ?? 20000);

    while (Date.now() < startupDeadline && child.exitCode === null && !spawnError) {
      if (debugPort === null && existsSync(activePortPath)) {
        try {
          activePortContents = readFileSync(activePortPath, 'utf8');
          const parsedPort = Number(activePortContents.split(/\r?\n/, 1)[0]);
          if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
            debugPort = parsedPort;
          }
        } catch (error) {
          lastEndpointError = `Could not read DevToolsActivePort: ${String(error)}`;
        }
      }
      if (debugPort !== null) {
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
            signal: AbortSignal.timeout(750),
          });
          if (response.ok) {
            const list = await response.json();
            if (Array.isArray(list)) {
              const foundPage = list.find(
                (item) =>
                  item.type === 'page' &&
                  item.webSocketDebuggerUrl &&
                  (!options.matchUrlPrefix || String(item.url ?? '').startsWith(options.matchUrlPrefix)),
              );
              if (foundPage) {
                targets = list;
                break;
              }
            }
          } else {
            lastEndpointError = `DevTools /json/list returned HTTP ${response.status}`;
          }
        } catch (error) {
          lastEndpointError = String(error);
        }
      }
      await delay(50);
    }

    if (!targets) {
      const processState = spawnError
        ? `spawnError=${String(spawnError)}`
        : `exitCode=${String(child.exitCode)}, signal=${String(child.signalCode)}`;
      throw new Error(
        `Chromium DevTools startup failed on attempt ${attemptNumber} (${processState}). ` +
          `DevToolsActivePort=${activePortContents.trim() || '<not created>'}` +
          `${lastEndpointError ? `. Endpoint=${lastEndpointError}` : ''}. stderr tail:\n${stderr.slice(-3000)}`,
      );
    }

    const page = targets.find(
      (item) =>
        item.type === 'page' &&
        item.webSocketDebuggerUrl &&
        (!options.matchUrlPrefix || String(item.url ?? '').startsWith(options.matchUrlPrefix)),
    );
    if (!page?.webSocketDebuggerUrl) {
      throw new Error(
        `Chromium exposed DevTools on attempt ${attemptNumber} but no matching page target. Targets=${JSON.stringify(targets)}`,
      );
    }

    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new Error('DevTools websocket timeout')), 10000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolveOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          rejectOpen(new Error('DevTools websocket error'));
        },
        { once: true },
      );
    });

    let sequence = 0;
    const pending = new Map();
    const consoleErrors = [];
    const pageErrors = [];

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message || 'DevTools command failed'));
        else entry.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        consoleErrors.push(
          (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
        );
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const d = message.params?.exceptionDetails;
        pageErrors.push(d?.exception?.description ?? d?.text ?? 'Uncaught exception');
      }
    });

    const commandTimeoutMs = options.commandTimeoutMs ?? 45000;
    const send = (method, params = {}) =>
      new Promise((resolveResult, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools command timed out: ${method}`));
        }, commandTimeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolveResult(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.result?.description ||
            result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text,
        );
      }
      return result.result?.value;
    };

    const evalJs = (body) => evaluate(`(async () => { ${body} })()`);

    const viewport = async ({ width, height }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
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
        '(() => { const element = document.querySelector(' +
          JSON.stringify(selector) +
          '); if (!element) throw new Error("Focus target missing: " + ' +
          JSON.stringify(selector) +
          '); element.focus({ preventScroll: true }); return document.activeElement === element; })()',
      );
      if (!focused) throw new Error(`Browser refused focus for ${selector}`);
    };

    const click = async (selector) => {
      let point;
      if (options.waitForStableClick) {
        const waitForClickPoint = (targetSelector) =>
          new Promise((resolve, reject) => {
            const element = document.querySelector(targetSelector);
            if (!element) {
              reject(new Error(`Click target missing: ${targetSelector}`));
              return;
            }
            element.scrollIntoView({ block: 'center', inline: 'center' });
            const readRect = () => {
              const r = element.getBoundingClientRect();
              return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            };
            const sameRect = (a, b) =>
              Boolean(
                a &&
                  Math.abs(a.left - b.left) < 0.5 &&
                  Math.abs(a.top - b.top) < 0.5 &&
                  Math.abs(a.right - b.right) < 0.5 &&
                  Math.abs(a.bottom - b.bottom) < 0.5,
              );
            let previousRect = null;
            let stableFrames = 0;
            const deadline = performance.now() + 2000;
            const check = () => {
              if (performance.now() >= deadline) {
                reject(new Error(`Click target did not finish moving: ${targetSelector}`));
                return;
              }
              if (!element.isConnected) {
                reject(new Error(`Click target was unmounted before input: ${targetSelector}`));
                return;
              }
              const rect = readRect();
              let hasRunningAnimation = false;
              for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
                if (ancestor.getAnimations().some((animation) => animation.playState === 'running')) {
                  hasRunningAnimation = true;
                  break;
                }
              }
              if (hasRunningAnimation) {
                previousRect = rect;
                stableFrames = 0;
                requestAnimationFrame(check);
                return;
              }
              stableFrames = sameRect(previousRect, rect) ? stableFrames + 1 : 0;
              previousRect = rect;
              if (stableFrames < 2) {
                requestAnimationFrame(check);
                return;
              }
              const left = Math.max(0, rect.left);
              const right = Math.min(innerWidth, rect.right);
              const top = Math.max(0, rect.top);
              const bottom = Math.min(innerHeight, rect.bottom);
              if (right <= left || bottom <= top) {
                reject(new Error(`Click target outside viewport: ${targetSelector}`));
                return;
              }
              const pt = { x: left + (right - left) / 2, y: top + (bottom - top) / 2 };
              const hit = document.elementFromPoint(pt.x, pt.y);
              if (!hit || !(hit === element || element.contains(hit))) {
                reject(new Error(`Click target occluded: ${targetSelector}`));
                return;
              }
              resolve(pt);
            };
            requestAnimationFrame(check);
          });
        point = await evaluate(`(${waitForClickPoint.toString()})(${JSON.stringify(selector)})`);
      } else {
        point = await evaluate(
          '(() => { const element = document.querySelector(' +
            JSON.stringify(selector) +
            '); if (!element) throw new Error("Click target missing: " + ' +
            JSON.stringify(selector) +
            '); element.scrollIntoView({ block: "center", inline: "center" }); ' +
            'const rect = element.getBoundingClientRect(); ' +
            'const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right); ' +
            'const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom); ' +
            'if (right <= left || bottom <= top) throw new Error("Click target outside viewport"); ' +
            'const p = { x: left + (right - left) / 2, y: top + (bottom - top) / 2 }; ' +
            'const hit = document.elementFromPoint(p.x, p.y); ' +
            'if (!hit || !(hit === element || element.contains(hit))) throw new Error("Click target occluded by: " + (hit?.outerHTML?.slice(0, 160) || "nothing")); ' +
            'return p; })()',
        );
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    };

    const wheel = async (selector, deltaY = 180) => {
      const point = await evaluate(
        '(() => { const element = document.querySelector(' +
          JSON.stringify(selector) +
          '); if (!element) throw new Error("Scroll target missing: " + ' +
          JSON.stringify(selector) +
          '); const rect = element.getBoundingClientRect(); ' +
          'return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()',
      );
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
        deltaX: 0,
        deltaY,
      });
    };

    await send('Page.enable');
    await send('Runtime.enable');

    if (options.initialViewport) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: options.initialViewport.width,
        height: options.initialViewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }

    if (options.waitForComplete) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await evaluate('document.readyState === "complete"')) break;
        await delay(100);
      }
    }

    return {
      send,
      evaluate,
      evalJs,
      viewport,
      setViewport: viewport,
      pressTab,
      pressTabs,
      focus,
      click,
      wheel,
      insertText: (text) => send('Input.insertText', { text }),
      navigate: (url) => send('Page.navigate', { url }),
      reload: () => send('Page.reload', { ignoreCache: true }),
      close: cleanup,
      cleanup,
      consoleErrors,
      pageErrors,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function launchChromiumSession(targetUrl, options = {}) {
  const maxAttempts = options.maxAttempts ?? 2;
  const failures = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await launchChromiumAttempt(targetUrl, options, attempt);
    } catch (error) {
      failures.push(String(error?.stack || error));
      if (attempt < maxAttempts) await delay(500);
    }
  }
  throw new Error(
    `Chromium startup failed after ${maxAttempts} isolated attempts:\n${failures.join('\n--- retry ---\n')}`,
  );
}

/**
 * Serves an arbitrary HTML document from an ephemeral local HTTP server on
 * 127.0.0.1:0 and opens it in Chromium. Avoids passing large `data:text/html`
 * payloads in argv (which exceeds Linux MAX_ARG_STRLEN / 128 KiB and triggers
 * `spawn E2BIG`).
 */
export async function launchChromiumHtml(html, options = {}) {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind ephemeral HTML test server');
  }

  const url = `http://127.0.0.1:${address.port}/`;
  let session;
  try {
    session = await launchChromiumSession(url, {
      ...options,
      waitForComplete: true,
    });
  } catch (error) {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    throw error;
  }

  const closeAll = async () => {
    try {
      await session.cleanup();
    } finally {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    }
  };

  return {
    ...session,
    cleanup: closeAll,
    close: closeAll,
  };
}
