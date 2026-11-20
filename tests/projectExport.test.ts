import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectExportSnapshot } from '../src/app/projectExport';
import { createInitialProject, createRectNode } from '../src/core/document/factory';
import type { ComponentDefinition, FolioProject } from '../src/core/document/types';
import { readProjectFile, downloadProject } from '../src/core/persistence/projectFile';

function createProjectWithMaster(): FolioProject {
  const project = createInitialProject('Export project');
  const now = '2026-11-20T00:00:00.000Z';
  const base = createInitialProject('Card').pages[0].document;
  const component: ComponentDefinition = {
    id: 'component-master',
    name: 'Card',
    createdAt: now,
    updatedAt: now,
    document: {
      ...base,
      id: 'document-master',
      name: 'Card',
      nodes: [{ ...createRectNode(), id: 'master-rect', style: { fill: '#111111', stroke: '#000000', strokeWidth: 0 } }],
    },
  };
  project.components = [component];
  return project;
}

function createEditedBuffer(project: FolioProject): FolioProject {
  const buffer = createInitialProject('Component Canvas');
  const masterDocument = project.components[0].document;
  buffer.pages[0].document = {
    ...masterDocument,
    nodes: masterDocument.nodes.map((node) => node.type === 'rect'
      ? { ...node, style: { ...node.style, fill: '#ed3344' } }
      : node),
  };
  return buffer;
}

function fileFromContent(content: string): File {
  return { text: async () => content } as File;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Component Canvas export snapshot', () => {
  it('exports the newest master buffer immediately and survives .flop re-import', async () => {
    const canonicalProject = createProjectWithMaster();
    const canonicalDocument = canonicalProject.components[0].document;
    const originalContent = JSON.stringify(canonicalProject);
    const componentBuffer = createEditedBuffer(canonicalProject);

    // This snapshot is taken before the App useEffect can sync the buffer.
    const snapshot = createProjectExportSnapshot(
      canonicalProject,
      'component-master',
      componentBuffer,
    );

    expect(snapshot).not.toBe(canonicalProject);
    expect(snapshot.components[0]).not.toBe(canonicalProject.components[0]);
    expect(snapshot.components[0].document.nodes[0]).toMatchObject({
      id: 'master-rect',
      style: { fill: '#ed3344' },
    });
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
      id: 'master-rect',
      style: { fill: '#ed3344' },
    });
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
