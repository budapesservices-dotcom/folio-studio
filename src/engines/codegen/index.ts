import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  CodeModuleLanguage,
  CodeModuleRecord,
  DesignNode,
  FolioProject,
} from '../../core/document/types';
import {
  buildLivePreviewHtml,
  compilePageHtmlCss,
  compileTokensCssFile,
  resolveSemanticTag,
  type LivePreviewOptions,
} from './htmlCssCompiler';
import { applyMappedNodeEdit } from './mappedSync';
import { compileReactProjectFiles } from './reactCompiler';
import { toKebabCase } from './sanitize';
import type {
  CodegenOptions,
  CodeMappingEntry,
  CodeOutputTarget,
  CompiledCodeFile,
  CompiledProjectOutput,
  MappedEditResult,
  MappedNodeEditPatch,
} from './types';

import {
  applyA11yQuickFixToNode,
  auditPageAccessibility,
  computeContrastRatio,
  parseCssColorToRgba,
  suggestAccessibleForegroundColor,
  type A11yAuditIssue,
  type A11yAuditReport,
  type A11yIssueCode,
  type A11yIssueSeverity,
  type A11yQuickFix,
} from './a11yAudit';
import {
  buildCompiledProjectBundle,
  type CompiledProjectBundle,
} from './projectBundle';
import {
  buildZipArchive,
  computeCrc32,
  normalizeArchiveEntryPath,
  parseZipArchive,
  type ParsedZipEntry,
  type ZipArchiveEntry,
} from './zipArchive';

export type {
  A11yAuditIssue,
  A11yAuditReport,
  A11yIssueCode,
  A11yIssueSeverity,
  A11yQuickFix,
  CodegenOptions,
  CodeMappingEntry,
  CodeOutputTarget,
  CompiledCodeFile,
  CompiledProjectBundle,
  CompiledProjectOutput,
  LivePreviewOptions,
  MappedEditResult,
  MappedNodeEditPatch,
  ParsedZipEntry,
  ZipArchiveEntry,
};
export {
  applyA11yQuickFixToNode,
  applyMappedNodeEdit,
  auditPageAccessibility,
  buildCompiledProjectBundle,
  buildLivePreviewHtml,
  buildZipArchive,
  computeContrastRatio,
  computeCrc32,
  normalizeArchiveEntryPath,
  parseCssColorToRgba,
  parseZipArchive,
  resolveSemanticTag,
  suggestAccessibleForegroundColor,
};

/**
 * Compiles the unified Folio `.flop` v2 project into deterministic, explicitly
 * classified code files across all four Folio Blueprint §3.4 / §7 categories:
 * - `generated` (Design Tokens CSS, React App & Master Component contracts)
 * - `mapped` (Page HTML5 / React TSX & Responsive CSS bound to AST `data-folio-id`)
 * - `custom` (Developer-authored CSS/JS/TS modules never overwritten by Canvas edits)
 * - `extension` (Per-node or per-page CSS overrides anchored by stable node/page IDs)
 */
export function compileFolioProject(
  project: FolioProject,
  options: CodegenOptions = {},
): CompiledProjectOutput {
  const target: CodeOutputTarget = options.target ?? 'html-css';
  const activePage =
    (options.pageId ? project.pages.find((p) => p.id === options.pageId) : undefined) ??
    getActivePage(project);
  const tokens = getProjectDesignTokens(project);
  const activeThemeId = options.themeId ?? tokens.activeThemeId;

  const files: CompiledCodeFile[] = [];

  if (target === 'html-css') {
    const pagesToCompile = options.includeAllPages ? project.pages : [activePage];
    for (const page of pagesToCompile) {
      const compiled = compilePageHtmlCss(project, page);
      files.push(compiled.htmlFile, compiled.cssFile);
    }
    files.push(compileTokensCssFile(project));
  } else {
    files.push(...compileReactProjectFiles(project, activePage.id));
    // Include every page stylesheet and tokens CSS under `src/styles/` so all React imports resolve cleanly
    for (const page of project.pages) {
      const compiled = compilePageHtmlCss(project, page);
      files.push({
        ...compiled.cssFile,
        path: `src/${compiled.cssFile.path}`,
      });
    }
    const tokensCssFile = compileTokensCssFile(project);
    files.push({
      ...tokensCssFile,
      path: `src/${tokensCssFile.path}`,
    });
  }

  for (const mod of project.codeModules ?? []) {
    files.push({
      id: `module:${mod.id}`,
      path: mod.path,
      language: mod.language,
      category: mod.mapping,
      readOnly: false,
      content: mod.content,
      moduleId: mod.id,
      ...(mod.targetNodeId ? { targetNodeId: mod.targetNodeId } : {}),
      ...(mod.targetPageId ? { targetPageId: mod.targetPageId } : {}),
      description:
        mod.description ??
        (mod.mapping === 'extension'
          ? 'Node/Page Extension CSS override preserved across visual edits.'
          : 'Developer-authored Custom Code module preserved across visual edits.'),
      mappings: [],
    });
  }

  let generatedCount = 0;
  let mappedCount = 0;
  let customCount = 0;
  let extensionCount = 0;
  const mappedNodeIds = new Set<string>();

  for (const file of files) {
    if (file.category === 'generated') generatedCount += 1;
    else if (file.category === 'mapped') mappedCount += 1;
    else if (file.category === 'custom') customCount += 1;
    else if (file.category === 'extension') extensionCount += 1;

    for (const entry of file.mappings) {
      mappedNodeIds.add(entry.nodeId);
    }
  }

  return {
    target,
    activePageId: activePage.id,
    activeThemeId,
    files,
    summary: {
      totalFiles: files.length,
      generatedCount,
      mappedCount,
      customCount,
      extensionCount,
      mappedNodeCount: mappedNodeIds.size,
    },
  };
}

export function createCustomCodeModule(
  existingModules: readonly CodeModuleRecord[],
  language: Extract<CodeModuleLanguage, 'css' | 'js'> = 'css',
): CodeModuleRecord {
  const existingPaths = new Set(existingModules.map((item) => item.path));
  const baseDir = language === 'css' ? 'styles' : 'scripts';
  let index = 1;
  let candidatePath = `${baseDir}/custom.${language}`;
  while (existingPaths.has(candidatePath)) {
    index += 1;
    candidatePath = `${baseDir}/custom-${index}.${language}`;
  }
  const id = `code-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const now = new Date().toISOString();

  const content =
    language === 'css'
      ? [
          '/* FOLIO Custom CSS Module — preserved across visual Canvas edits */',
          'main {',
          '  transition: background-color 180ms ease;',
          '}',
          '',
        ].join('\n')
      : [
          '// FOLIO Custom Script Module — executed only in sandboxed preview when enabled',
          "document.addEventListener('DOMContentLoaded', () => {",
          '  // Add custom client interactions here',
          '});',
          '',
        ].join('\n');

  return {
    id,
    path: candidatePath,
    language,
    mapping: 'custom',
    content,
    description: language === 'css'
      ? 'Developer-authored custom stylesheet layered over compiled page CSS.'
      : 'Developer-authored custom script module.',
    updatedAt: now,
  };
}

export function createNodeExtensionModule(
  node: DesignNode,
  pageId: string,
  existingModules: readonly CodeModuleRecord[],
): CodeModuleRecord {
  const existingPaths = new Set(existingModules.map((item) => item.path));
  const slug = toKebabCase(node.name, 'node').slice(0, 24);
  let index = 1;
  let candidatePath = `extensions/${slug}.css`;
  while (existingPaths.has(candidatePath)) {
    index += 1;
    candidatePath = `extensions/${slug}-${index}.css`;
  }
  const id = `ext-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const now = new Date().toISOString();

  return {
    id,
    path: candidatePath,
    language: 'css',
    mapping: 'extension',
    targetNodeId: node.id,
    targetPageId: pageId,
    description: `Extension CSS anchored to AST node "${node.name}" (${node.id}).`,
    content: [
      `/* FOLIO Extension Override for "${node.name}" */`,
      `/* Anchored via stable AST ID so visual moves/renames never discard this code. */`,
      `[data-folio-id="${node.id}"] {`,
      '  outline: 2px solid #7c6cf6;',
      '  outline-offset: 4px;',
      '}',
      '',
    ].join('\n'),
    updatedAt: now,
  };
}
