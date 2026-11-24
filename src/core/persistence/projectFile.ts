import { migrateProjectToV2 } from '../document/migrations';
import { sanitizeProjectNetworkSecrets } from '../document/networkSecrets';
import { requireValidProject } from '../document/validation';
import type { FolioProject } from '../document/types';

function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return cleaned || 'untitled-project';
}

/**
 * Produces a validated, secret-safe `.flop` v2 JSON string.
 * Guarantees that no raw `authToken`, unsafe `authSecretRef`, raw credential
 * inside `globalHeaders`, embedded URL credentials, or network node secrets are
 * ever written into exported `.flop` project files.
 */
export function serializeProjectToFlopJson(project: FolioProject): string {
  const sanitizedProject = sanitizeProjectNetworkSecrets(project);
  const validatedProject = requireValidProject(sanitizedProject);
  return JSON.stringify(validatedProject, null, 2);
}

export function downloadProject(project: FolioProject): void {
  const content = serializeProjectToFlopJson(project);
  const blob = new Blob([content], { type: 'application/vnd.folio.project+json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(project.metadata.name)}.flop`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Maximum `.flop` file size accepted for import to prevent OOM/tab freezes from malformed files. */
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Safely parses untrusted JSON text while stripping prototype-polluting keys
 * before schema migration or validation touches the parsed graph.
 */
export function parseProjectJsonSafe(content: string): unknown {
  return JSON.parse(content, (key, value: unknown) => {
    if (FORBIDDEN_JSON_KEYS.has(key)) return undefined;
    return value;
  });
}

export async function readProjectFile(file: File): Promise<FolioProject> {
  if (typeof file.size === 'number' && file.size > MAX_PROJECT_FILE_BYTES) {
    throw new Error('The selected .flop file exceeds the 25 MB safety limit.');
  }

  const content = await file.text();
  if (content.length > MAX_PROJECT_FILE_BYTES) {
    throw new Error('The selected .flop file exceeds the 25 MB safety limit.');
  }

  let parsed: unknown;

  try {
    parsed = parseProjectJsonSafe(content);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  return migrateProjectToV2(parsed);
}
