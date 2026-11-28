import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { FolioProject } from '../../core/document/types';
import {
  deleteProjectById,
  listSavedProjects,
  loadProjectById,
  saveProject,
  saveProjectCopy,
  type LocalProjectSummary,
} from '../../core/persistence/indexedDb';
import { materializeProjectAssetsForExport } from '../../core/persistence/assetStore';
import { serializeProjectToFlopZip } from '../../core/persistence/flopArchive';
import { StudioIcon } from './StudioIcon';

export interface ProjectLibraryModalProps {
  open: boolean;
  project: FolioProject;
  onLoadProject: (project: FolioProject) => Promise<void>;
  onOpenFilePicker: () => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso || 'Just now';
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function downloadBytesAsFile(bytes: Uint8Array, filename: string, mimeType: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugifyFilename(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'folio-project';
}

export function ProjectLibraryModal({
  open,
  project,
  onLoadProject,
  onOpenFilePicker,
  onNotice,
  onClose,
}: ProjectLibraryModalProps) {
  const [projects, setProjects] = useState<LocalProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [snapshotName, setSnapshotName] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const items = await listSavedProjects();
      setProjects(items);
    } catch (error) {
      setErrorBanner(
        error instanceof Error ? error.message : 'Unable to read local browser projects.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSnapshotName('');
    setPendingDeleteId(null);
    void (async () => {
      try {
        if ('indexedDB' in globalThis) {
          await saveProject(project);
        }
      } catch {
        // Continue listing even if saving current snapshot fails.
      }
      await refreshList();
    })();
  }, [open, project, refreshList]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((item) => item.name.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  if (!open) return null;

  const handleSaveCopy = async () => {
    setBusyAction('save-copy');
    setErrorBanner(null);
    try {
      const portable = await materializeProjectAssetsForExport(project);
      const created = await saveProjectCopy(
        portable,
        snapshotName.trim() || `${project.metadata.name} Snapshot`,
      );
      setSnapshotName('');
      onNotice(`Saved local copy "${created.metadata.name}" to browser storage.`);
      await refreshList();
    } catch (error) {
      setErrorBanner(
        error instanceof Error ? error.message : 'Unable to save a local copy.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenProject = async (item: LocalProjectSummary) => {
    if (item.id === project.metadata.id) {
      onClose();
      return;
    }
    setBusyAction(`open:${item.id}`);
    setErrorBanner(null);
    try {
      const loaded = await loadProjectById(item.id);
      if (!loaded) {
        setErrorBanner(`Project "${item.name}" could not be found in local storage.`);
        await refreshList();
        return;
      }
      await onLoadProject(loaded);
      onNotice(`Opened "${loaded.metadata.name}" from Local Project Library.`);
      onClose();
    } catch (error) {
      setErrorBanner(
        error instanceof Error ? error.message : 'Unable to open the selected project.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportArchive = async (item: LocalProjectSummary) => {
    setBusyAction(`export:${item.id}`);
    setErrorBanner(null);
    try {
      const source =
        item.id === project.metadata.id ? project : await loadProjectById(item.id);
      if (!source) {
        setErrorBanner(`Project "${item.name}" could not be found for export.`);
        return;
      }
      const portable = await materializeProjectAssetsForExport(source);
      const bytes = serializeProjectToFlopZip(portable);
      downloadBytesAsFile(
        bytes,
        `${slugifyFilename(source.metadata.name)}.flop`,
        'application/zip',
      );
      onNotice(`Exported "${source.metadata.name}.flop" ZIP archive.`);
    } catch (error) {
      setErrorBanner(
        error instanceof Error ? error.message : 'Unable to export .flop archive.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteProject = async (item: LocalProjectSummary) => {
    if (item.id === project.metadata.id) {
      setErrorBanner('Switch to another project before deleting the currently active project.');
      setPendingDeleteId(null);
      return;
    }
    setBusyAction(`delete:${item.id}`);
    setErrorBanner(null);
    try {
      await deleteProjectById(item.id);
      setPendingDeleteId(null);
      onNotice(`Deleted "${item.name}" from local storage.`);
      await refreshList();
    } catch (error) {
      setErrorBanner(
        error instanceof Error ? error.message : 'Unable to delete local project.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      class="project-library-backdrop"
      role="presentation"
      data-testid="project-library-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        class="project-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-library-modal-title"
      >
        <header class="project-library-header">
          <div class="project-library-title-group">
            <h3 id="project-library-modal-title">Local Project Library</h3>
            <span class="project-library-subtitle">
              100% Free Offline Browser Storage (IndexedDB) · Zero Cloud Cost · Portable .flop Archives
            </span>
          </div>
          <button
            type="button"
            class="project-library-close"
            aria-label="Close Local Project Library"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div class="project-library-body">
          {errorBanner && (
            <div class="project-library-banner is-error" role="alert">
              <span>{errorBanner}</span>
              <button
                type="button"
                class="project-library-dismiss"
                onClick={() => setErrorBanner(null)}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          <div class="project-library-snapshot-bar">
            <input
              type="text"
              class="project-library-search"
              data-testid="project-library-snapshot-input"
              placeholder={`Save copy of "${project.metadata.name}" as…`}
              value={snapshotName}
              onInput={(event) => setSnapshotName((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSaveCopy();
                }
              }}
            />
            <button
              type="button"
              class="project-library-primary-btn"
              data-testid="project-library-save-copy-btn"
              disabled={busyAction !== null}
              onClick={() => {
                void handleSaveCopy();
              }}
            >
              {busyAction === 'save-copy' ? 'Saving…' : 'Save Copy'}
            </button>
            <button
              type="button"
              class="project-library-secondary-btn"
              data-testid="project-library-import-btn"
              disabled={busyAction !== null}
              onClick={() => {
                onClose();
                onOpenFilePicker();
              }}
            >
              Import .flop
            </button>
          </div>

          <div class="project-library-toolbar">
            <input
              type="search"
              class="project-library-search"
              placeholder="Search local projects…"
              aria-label="Search local projects"
              value={searchQuery}
              onInput={(event) => setSearchQuery((event.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="project-library-secondary-btn"
              disabled={loading || busyAction !== null}
              onClick={() => {
                void refreshList();
              }}
            >
              Refresh
            </button>
          </div>

          <div class="project-library-list" data-testid="project-library-list">
            {loading && projects.length === 0 ? (
              <div class="project-library-empty">Loading saved projects…</div>
            ) : filteredProjects.length === 0 ? (
              <div class="project-library-empty">
                <StudioIcon name="folder" />
                <span>
                  {projects.length === 0
                    ? 'No saved local projects yet. Click "Save Copy" to snapshot your current work.'
                    : 'No local projects match your search.'}
                </span>
              </div>
            ) : (
              filteredProjects.map((item) => {
                const isActive = item.id === project.metadata.id;
                const isOpening = busyAction === `open:${item.id}`;
                const isExporting = busyAction === `export:${item.id}`;
                const isDeleting = busyAction === `delete:${item.id}`;
                const confirmingDelete = pendingDeleteId === item.id;

                return (
                  <div
                    key={item.id}
                    class={`project-library-card ${isActive ? 'is-active' : ''}`}
                    data-testid={`local-project-row-${item.id}`}
                  >
                    <div class="project-library-meta">
                      <div class="project-library-name-row">
                        <strong>{item.name}</strong>
                        {isActive && <span class="project-library-active-badge">Active</span>}
                      </div>
                      <span>
                        {item.applicationCount} app{item.applicationCount === 1 ? '' : 's'} ·{' '}
                        {item.pageCount} page{item.pageCount === 1 ? '' : 's'} ·{' '}
                        {item.componentCount} component{item.componentCount === 1 ? '' : 's'} ·{' '}
                        Updated {formatTimestamp(item.updatedAt)}
                      </span>
                    </div>
                    <div class="project-library-actions">
                      {confirmingDelete ? (
                        <>
                          <button
                            type="button"
                            class="project-library-danger-btn"
                            disabled={busyAction !== null}
                            onClick={() => {
                              void handleDeleteProject(item);
                            }}
                          >
                            {isDeleting ? 'Deleting…' : 'Confirm Delete'}
                          </button>
                          <button
                            type="button"
                            class="project-library-secondary-btn"
                            disabled={busyAction !== null}
                            onClick={() => setPendingDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {!isActive && (
                            <button
                              type="button"
                              class="project-library-primary-btn"
                              disabled={busyAction !== null}
                              onClick={() => {
                                void handleOpenProject(item);
                              }}
                            >
                              {isOpening ? 'Opening…' : 'Open'}
                            </button>
                          )}
                          <button
                            type="button"
                            class="project-library-secondary-btn"
                            disabled={busyAction !== null}
                            onClick={() => {
                              void handleExportArchive(item);
                            }}
                          >
                            {isExporting ? 'Exporting…' : '.flop ZIP'}
                          </button>
                          {!isActive && (
                            <button
                              type="button"
                              class="project-library-secondary-btn"
                              disabled={busyAction !== null}
                              onClick={() => setPendingDeleteId(item.id)}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
