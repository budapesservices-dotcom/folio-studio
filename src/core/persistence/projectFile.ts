import { migrateProjectToV2 } from '../document/migrations';
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

export function downloadProject(project: FolioProject): void {
  const content = JSON.stringify(project, null, 2);
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

export async function readProjectFile(file: File): Promise<FolioProject> {
  const content = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  return migrateProjectToV2(parsed);
}
