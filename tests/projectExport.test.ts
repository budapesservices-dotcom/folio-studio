import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectExportSnapshot } from '../src/app/projectExport';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { ComponentDefinition, FolioProject } from '../src/core/document/types';
import { readProjectFile, downloadProject } from '../src/core/persistence/projectFile';

function createProjectWithMaster(): FolioProject {
  const project = createInitialProject('Export project');
  const now = '2026-11-20T00:00:00.000Z';
  const base = createInitialProject('Card').pages[0].document;
  const makeComponent = (id: string, name: string, documentId: string): ComponentDefinition => ({
    id,
    name,
    createdAt: now,
    updatedAt: now,
    document: {
      ...base,
      id: documentId,
      name,
      nodes: [{ ...createRectNode(), id: id + '-rect', style: { fill: '#111111', stroke: '#000000', strokeWidth: 0 } }],
    },
  });
  project.components = [
    makeComponent('component-master', 'Card', 'document-master'),
    makeComponent('component-untouched', 'Badge', 'document-untouched'),
  ];
  project.metadata.updatedAt = '2026-11-19T00:00:00.000Z';
  return project;
}

function createEditedBuffer(project: FolioProject, edit = true): FolioProject {
  const buffer = createInitialProject('Component Canvas');
  const masterDocument = project.components[0].document;
  const nextDocument = structuredClone(masterDocument);
  if (edit) {
    const node = nextDocument.nodes[0];
    if (node.type === 'rect') node.style.fill = '#ed3344';
  }
  buffer.pages[0].document = nextDocument;
  return buffer;
}

function fileFromContent(content: string): File {
  return { text: async () => content } as File;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Component Canvas export snapshot', () => {
  it('exports the newest master buffer immediately and survives .flop re-import', async () => {
    const canonicalProject = createProjectWithMaster();
    const canonicalDocument = canonicalProject.components[0].document;
    const originalContent = JSON.stringify(canonicalProject);
    const componentBuffer = createEditedBuffer(canonicalProject);

    const snapshot = createProjectExportSnapshot(
      canonicalProject,
      'component-master',
      componentBuffer,
    );

    expect(snapshot).not.toBe(canonicalProject);
    expect(snapshot.components[0]).not.toBe(canonicalProject.components[0]);
    expect(snapshot.components[0].document.nodes[0]).toMatchObject({
      id: 'component-master-rect',
      style: { fill: '#ed3344' },
    });
    expect(snapshot.components[1]).toBe(canonicalProject.components[1]);
    expect(canonicalProject.components[0].document).toBe(canonicalDocument);
    expect(JSON.stringify(canonicalProject)).toBe(originalContent);

    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    let exportedBlob: Blob | undefined;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append: vi.fn() },
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob;
        return 'blob:folio-export';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('window', { setTimeout: vi.fn() });

    downloadProject(snapshot);
    expect(exportedBlob).toBeDefined();
    expect(anchor.download).toBe('export-project.flop');

    const imported = await readProjectFile(fileFromContent(await exportedBlob!.text()));
    expect(imported.components[0].document.nodes[0]).toMatchObject({
      id: 'component-master-rect',
      style: { fill: '#ed3344' },
    });
    expect(imported.components[0].updatedAt).toBe(snapshot.components[0].updatedAt);
    expect(imported.metadata.updatedAt).toBe(snapshot.metadata.updatedAt);
  });

  it('updates component and project timestamps together only when the buffer document changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T12:34:56.000Z'));

    const canonicalProject = createProjectWithMaster();
    const canonicalBefore = JSON.stringify(canonicalProject);
    const canonicalMetadataBefore = structuredClone(canonicalProject.metadata);
    const canonicalComponentBefore = structuredClone(canonicalProject.components[0]);
    const componentBuffer = createEditedBuffer(canonicalProject);
    const bufferBefore = JSON.stringify(componentBuffer);

    const snapshot = createProjectExportSnapshot(
      canonicalProject,
      'component-master',
      componentBuffer,
    );
    const expectedTimestamp = '2026-11-20T12:34:56.000Z';

    expect(snapshot.components[0].document).toEqual(componentBuffer.pages[0].document);
    expect(snapshot.components[0].updatedAt).toBe(expectedTimestamp);
    expect(snapshot.metadata.updatedAt).toBe(expectedTimestamp);
    expect(snapshot.components[0].updatedAt).not.toBe(canonicalComponentBefore.updatedAt);
    expect(snapshot.metadata.updatedAt).not.toBe(canonicalMetadataBefore.updatedAt);

    expect(JSON.stringify(canonicalProject)).toBe(canonicalBefore);
    expect(canonicalProject.metadata).toEqual(canonicalMetadataBefore);
    expect(canonicalProject.components[0]).toEqual(canonicalComponentBefore);
    expect(JSON.stringify(componentBuffer)).toBe(bufferBefore);
    expect(snapshot.components[1]).toBe(canonicalProject.components[1]);
    expect(snapshot.components[1].updatedAt).toBe(canonicalProject.components[1].updatedAt);
  });

  it('does not create modification timestamps when the buffer document is unchanged', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T12:34:56.000Z'));

    const canonicalProject = createProjectWithMaster();
    const originalTimestamp = canonicalProject.metadata.updatedAt;
    const componentTimestamp = canonicalProject.components[0].updatedAt;
    const sameContentBuffer = createEditedBuffer(canonicalProject, false);

    const snapshot = createProjectExportSnapshot(
      canonicalProject,
      'component-master',
      sameContentBuffer,
    );

    expect(snapshot).toBe(canonicalProject);
    expect(snapshot.metadata.updatedAt).toBe(originalTimestamp);
    expect(snapshot.components[0].updatedAt).toBe(componentTimestamp);
  });

  it('uses the canonical project unchanged when no master component is being edited', () => {
    const project = createProjectWithMaster();
    const buffer = createEditedBuffer(project);

    expect(createProjectExportSnapshot(project, null, buffer)).toBe(project);
  });

  it('leaves the canonical project unchanged when the editing component no longer exists', () => {
    const project = createProjectWithMaster();
    const buffer = createEditedBuffer(project);

    expect(createProjectExportSnapshot(project, 'missing-component', buffer)).toBe(project);
  });
});
