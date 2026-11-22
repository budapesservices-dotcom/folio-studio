import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // GitHub Pages serves this repository under /folio-studio/.
  base: '/folio-studio/',
  plugins: [preact()],
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
  },
});
