import {
  buildGoogleFontsStylesheetUrl,
  collectProjectGoogleFonts,
} from '../../core/document/fonts';
import { sanitizeProjectNetworkSecrets } from '../../core/document/networkSecrets';
import type { FolioProject } from '../../core/document/types';
import { getActivePage } from '../../core/document/project';
import {
  extractAssetBinaryBytesSync,
  getAssetBundlePath,
} from '../../core/persistence/assetStore';
import { compileFolioProject } from './index';
import { escapeAttr, escapeHtml, toKebabCase, toPageFileSlug } from './sanitize';
import type { CodeOutputTarget } from './types';
import { buildZipArchive, type ZipArchiveEntry } from './zipArchive';

export interface CompiledProjectBundle {
  readonly fileName: string;
  readonly target: CodeOutputTarget;
  readonly entries: readonly ZipArchiveEntry[];
  readonly zipBytes: Uint8Array;
}

function buildReactScaffoldEntries(project: FolioProject, packageSlug: string): ZipArchiveEntry[] {
  const pkgJson = JSON.stringify(
    {
      name: packageSlug,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc --noEmit && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^4.3.4',
        typescript: '^5.8.0',
        vite: '^6.2.0',
      },
    },
    null,
    2,
  );

  const tsconfigJson = JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        useDefineForClassFields: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
      },
      include: ['src'],
    },
    null,
    2,
  );

  const viteConfigTs = [
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    '',
    'export default defineConfig({',
    '  plugins: [react()],',
    '});',
    '',
  ].join('\n');

  const googleFontsUrl = buildGoogleFontsStylesheetUrl(collectProjectGoogleFonts(project));
  const indexHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(project.metadata.name)}</title>`,
    ...(googleFontsUrl
      ? [
          '    <link rel="preconnect" href="https://fonts.googleapis.com" />',
          '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
          `    <link rel="stylesheet" href="${escapeAttr(googleFontsUrl)}" />`,
        ]
      : []),
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  const mainTsx = [
    "import React from 'react';",
    "import ReactDOM from 'react-dom/client';",
    "import { App } from './App';",
    '',
    "const rootEl = document.getElementById('root');",
    'if (rootEl) {',
    '  ReactDOM.createRoot(rootEl).render(',
    '    <React.StrictMode>',
    '      <App />',
    '    </React.StrictMode>,',
    '  );',
    '}',
    '',
  ].join('\n');

  const readmeMd = [
    `# ${project.metadata.name}`,
    '',
    'Exported from **Folio Studio** as a self-contained React + TypeScript + Vite project.',
    '',
    '## Quick start',
    '',
    '```bash',
    'npm install',
    'npm run dev',
    '```',
    '',
  ].join('\n');

  return [
    { path: 'package.json', content: `${pkgJson}\n` },
    { path: 'tsconfig.json', content: `${tsconfigJson}\n` },
    { path: 'vite.config.ts', content: viteConfigTs },
    { path: 'index.html', content: indexHtml },
    { path: 'src/main.tsx', content: mainTsx },
    { path: 'README.md', content: readmeMd },
  ];
}

function buildHtmlCssScaffoldEntries(project: FolioProject, activePageId: string): ZipArchiveEntry[] {
  const activePage = project.pages.find((p) => p.id === activePageId) ?? getActivePage(project);
  const entrySlug = toPageFileSlug(activePage.route, activePage.name);
  const entryHref = `pages/${entrySlug}.html`;
  const indexRedirectHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    `    <meta http-equiv="refresh" content="0; url=${entryHref}" />`,
    `    <title>${escapeHtml(project.metadata.name)}</title>`,
    '  </head>',
    '  <body>',
    `    <p>Opening <a href="${entryHref}">${escapeHtml(activePage.name)}</a>…</p>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n');

  const readmeMd = [
    `# ${project.metadata.name}`,
    '',
    'Exported from **Folio Studio** as a static HTML5 + CSS bundle.',
    '',
    `Open \`${entryHref}\` (or serve this directory with any static web server).`,
    '',
  ].join('\n');

  return [
    { path: 'index.html', content: indexRedirectHtml },
    { path: 'README.md', content: readmeMd },
  ];
}

/**
 * Compiles the full Folio project (all pages, design tokens, components, and
 * preserved Custom/Extension modules) and packages it into a runnable ZIP archive.
 */
export function buildCompiledProjectBundle(
  inputProject: FolioProject,
  options: {
    target: CodeOutputTarget;
    pageId?: string;
    themeId?: string;
  },
): CompiledProjectBundle {
  const project = sanitizeProjectNetworkSecrets(inputProject);
  const compiled = compileFolioProject(project, {
    target: options.target,
    pageId: options.pageId,
    themeId: options.themeId,
    includeAllPages: true,
  });

  const projectSlug = toKebabCase(project.metadata.name, 'folio-project').slice(0, 48);
  const scaffold = options.target === 'react'
    ? buildReactScaffoldEntries(project, projectSlug)
    : buildHtmlCssScaffoldEntries(project, compiled.activePageId);

  const entryMap = new Map<string, ZipArchiveEntry>();
  for (const item of scaffold) {
    entryMap.set(item.path, item);
  }
  for (const file of compiled.files) {
    // Compiled files & user modules always take precedence over scaffold placeholders
    entryMap.set(file.path, { path: file.path, content: file.content });
  }

  for (const asset of project.assets) {
    const bytes = extractAssetBinaryBytesSync(asset);
    if (!bytes) continue;
    const bundlePath = getAssetBundlePath(asset);
    const zipPath = options.target === 'react' ? `public/${bundlePath}` : bundlePath;
    entryMap.set(zipPath, { path: zipPath, content: bytes });
  }

  const entries = Array.from(entryMap.values());
  const zipBytes = buildZipArchive(entries);
  const targetSuffix = options.target === 'react' ? 'react-ts' : 'html-css';

  return {
    fileName: `${projectSlug}-${targetSuffix}.zip`,
    target: options.target,
    entries,
    zipBytes,
  };
}
