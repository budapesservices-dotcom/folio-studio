import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ command }) => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (command === 'build' && proc?.env && proc.env.NODE_ENV !== 'production') {
    proc.env.NODE_ENV = 'production';
  }
  const isServe = command === 'serve';
  return {
    // GitHub Pages serves this repository under /folio-studio/.
    base: '/folio-studio/',
    plugins: [
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
          if (id.includes('/src/engines/canvas/')) {
            return 'canvas-engine';
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
