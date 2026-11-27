import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { executeServerHttpProxy } from './src/server/httpProxyHandler.ts';

function folioHttpProxyPlugin(serverEnv: Readonly<Record<string, string | undefined>>): Plugin {
  const attachProxyMiddleware = (middlewares: {
    use: (
      path: string,
      handler: (
        req: {
          method?: string;
          headers?: Record<string, string | string[] | undefined>;
          on: (ev: string, cb: (chunk?: unknown) => void) => void;
        },
        res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void },
        next: () => void,
      ) => void,
    ) => void;
  }) => {
    middlewares.use('/api/logic/http-proxy', (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method !== 'POST') {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Allow', 'POST, OPTIONS');
          res.end('');
          return;
        }
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            status: 405,
            ok: false,
            contentType: 'application/json',
            data: null,
            durationMs: 0,
            error: 'Method Not Allowed. Use POST.',
          }),
        );
        return;
      }
      const chunks: string[] = [];
      let totalBytes = 0;
      let aborted = false;
      const encoder = new TextEncoder();
      req.on('data', (chunk) => {
        if (aborted) return;
        const text = typeof chunk === 'string' ? chunk : String(chunk ?? '');
        totalBytes += encoder.encode(text).byteLength;
        if (totalBytes > 512 * 1024) {
          aborted = true;
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              status: 413,
              ok: false,
              contentType: 'application/json',
              data: null,
              durationMs: 0,
              error: 'Proxy request payload exceeds 512 KiB.',
            }),
          );
          return;
        }
        chunks.push(text);
      });
      req.on('end', () => {
        if (aborted) return;
        void (async () => {
          try {
            const candidate = JSON.parse(chunks.join('') || '{}') as unknown;
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
              throw new Error('Body must be a JSON object');
            }
            const parsed = candidate as Record<string, unknown>;
            const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
            const dnsSpec = 'node:dns/promises';
            const dnsMod = (await import(/* @vite-ignore */ dnsSpec)) as {
              lookup: (
                hostname: string,
                opts: { all: true; verbatim: true },
              ) => Promise<Array<{ address: string; family: number }>>;
            };
            const result = await executeServerHttpProxy(
              {
                url: typeof parsed.url === 'string' ? parsed.url : '',
                method: typeof parsed.method === 'string' ? parsed.method : 'GET',
                headers:
                  parsed.headers && typeof parsed.headers === 'object' && !Array.isArray(parsed.headers)
                    ? (parsed.headers as Record<string, string>)
                    : undefined,
                body: typeof parsed.body === 'string' ? parsed.body : undefined,
                authSecretRef: typeof parsed.authSecretRef === 'string' ? parsed.authSecretRef : undefined,
              },
              {
                dnsLookup: (hostname) => dnsMod.lookup(hostname, { all: true, verbatim: true }),
                env: { ...serverEnv, ...(proc?.env ?? {}) },
                requestHeaders: req.headers ?? {},
              },
            );
            res.statusCode = result.httpStatus;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(result.body));
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                status: 400,
                ok: false,
                contentType: 'application/json',
                data: null,
                durationMs: 0,
                error: 'Invalid JSON request body.',
              }),
            );
          }
        })();
      });
      req.on('error', () => {
        next();
      });
    });
  };

  return {
    name: 'folio-http-proxy',
    configureServer(server) {
      attachProxyMiddleware(server.middlewares as unknown as Parameters<typeof attachProxyMiddleware>[0]);
    },
    configurePreviewServer(server) {
      attachProxyMiddleware(server.middlewares as unknown as Parameters<typeof attachProxyMiddleware>[0]);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const proc = (globalThis as { process?: { cwd?: () => string; env?: Record<string, string | undefined> } }).process;
  if (command === 'build' && proc?.env && proc.env.NODE_ENV !== 'production') {
    proc.env.NODE_ENV = 'production';
  }
  const serverEnv = loadEnv(mode, proc?.cwd?.() ?? '.', '');
  const isServe = command === 'serve';
  // Cloudflare Pages serves at root '/'; GitHub Pages serves under '/folio-studio/'.
  const resolvedBase =
    proc?.env?.VITE_BASE_PATH
    || (proc?.env?.CF_PAGES === '1' ? '/' : '/folio-studio/');
  return {
    base: resolvedBase,
    plugins: [
      folioHttpProxyPlugin(serverEnv),
      preact({
        devToolsEnabled: isServe,
        prefreshEnabled: isServe,
      }),
    ],
    clearScreen: false,
  server: {
    // Codespaces needs Vite to listen beyond the loopback interface.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Keep the allow-list narrow instead of disabling Vite host validation.
    allowedHosts: ['.app.github.dev', '.run.app'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/preact')) return 'vendor-preact';
          if (id.includes('/src/core/document/vectorDrawing')) {
            return 'vector-drawing-engine';
          }
          if (id.includes('/src/core/document/planarBoolean') || id.includes('/src/core/document/vector')) {
            return 'vector-engine';
          }
          if (id.includes('/src/core/document/templates.ts')) {
            return 'templates-catalog';
          }
          if (
            id.includes('/src/core/document/')
            || id.includes('/src/core/commands/')
            || id.includes('/src/core/kernels/')
            || id.includes('/src/core/tools/')
            || id.includes('/src/core/persistence/')
          ) {
            return 'core-engine';
          }
          if (id.includes('/src/engines/canvas/gpu/') && !id.endsWith('/gpu/types.ts')) {
            return 'gpu-engine';
          }
          if (id.includes('/src/engines/canvas/tools/')) {
            return 'canvas-tools';
          }
          if (id.includes('/src/engines/canvas/')) {
            return 'canvas-engine';
          }
          if (
            id.includes('/src/engines/animation/videoExport')
            || id.includes('/src/engines/animation/videoMuxer')
            || id.includes('/src/engines/animation/gifEncoder')
            || id.includes('/src/engines/animation/svgExport')
          ) {
            return 'motion-export-engine';
          }
          if (id.includes('/src/app/workspace/Inspector') || id.includes('/src/app/InspectorPanel')) {
            return 'inspector-panel';
          }
          if (
            id.includes('/src/engines/layout/')
            || id.includes('/src/engines/history/')
            || id.includes('/src/engines/prototype/')
            || id.includes('/src/engines/animation/')
          ) {
            return 'studio-engines';
          }
          return undefined;
        },
      },
    },
  },
  };
});
