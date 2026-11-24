import { useCallback, useEffect, useMemo } from 'preact/hooks';
import { getActiveDocument } from '../../core/document/project';
import {
  collectProjectGoogleFonts,
  ensureStudioCustomFontsLoaded,
  ensureStudioGoogleFontsLoaded,
} from '../../core/document/fonts';
import { createImageNodeFromAsset, ingestImageFile } from '../../core/persistence/assetStore';
import type { FolioProject } from '../../core/document/types';
import type { EditorTarget } from '../editorContext';
import type { CanonicalEditorStore } from '../editorStore';
import type { MainCanvasCommandClient, WorkspaceCommandClient } from '../mainCanvasCommandClient';

export interface UseMediaAndFontsLifecycleOptions {
  project: FolioProject;
  activeEditorId: EditorTarget;
  isHydrating: boolean;
  canonicalStore: CanonicalEditorStore;
  componentStore: CanonicalEditorStore;
  mainCommandClient: MainCanvasCommandClient;
  componentCommandClient: WorkspaceCommandClient;
  selectionSourceRef: { current: 'canvas' | 'layers' | 'inspector' };
  setInspectorVisible: (visible: boolean) => void;
  setNotice: (message: string) => void;
}

/**
 * Manages Studio Google Fonts / @font-face dynamic stylesheet loading and
 * SHA-256 deduplicated image ingestion (drag-and-drop or Inspector file picker).
 */
export function useMediaAndFontsLifecycle({
  project,
  activeEditorId,
  isHydrating,
  canonicalStore,
  componentStore,
  mainCommandClient,
  componentCommandClient,
  selectionSourceRef,
  setInspectorVisible,
  setNotice,
}: UseMediaAndFontsLifecycleOptions) {
  const projectGoogleFonts = useMemo(() => collectProjectGoogleFonts(project), [project]);
  const projectGoogleFontsKey = projectGoogleFonts.join('|');

  useEffect(() => {
    ensureStudioGoogleFontsLoaded(projectGoogleFonts);
  }, [projectGoogleFontsKey]);

  useEffect(() => {
    ensureStudioCustomFontsLoaded(project.assets);
  }, [project.assets]);

  const handleInsertImageFiles = useCallback(async (
    files: readonly File[],
    targetEditor: EditorTarget = activeEditorId,
    dropPoint?: { x: number; y: number },
  ) => {
    if (isHydrating || files.length === 0) return;
    const targetDoc = targetEditor === 'component'
      ? getActiveDocument(componentStore.getSnapshot().editorState.project)
      : getActiveDocument(canonicalStore.getSnapshot().editorState.project);
    let insertedCount = 0;
    let reusedCount = 0;
    let sanitizedSvgCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      try {
        const existingAssets = canonicalStore.getSnapshot().editorState.project.assets;
        const ingested = await ingestImageFile(file, existingAssets);
        if (ingested.deduplicated) reusedCount += 1;
        if (ingested.asset.mimeType === 'image/svg+xml') sanitizedSvgCount += 1;

        const offset = i * 28;
        const assetW = ingested.asset.width ?? 360;
        const assetH = ingested.asset.height ?? 240;
        const imageNode = createImageNodeFromAsset(ingested.asset, {
          x: dropPoint ? Math.round(dropPoint.x - Math.min(480, assetW) / 2 + offset) : Math.round(120 + offset),
          y: dropPoint ? Math.round(dropPoint.y - Math.min(360, assetH) / 2 + offset) : Math.round(120 + offset),
          maxDimension: Math.max(160, Math.min(520, Math.round(targetDoc.width * 0.65))),
        });

        if (targetEditor === 'component') {
          mainCommandClient.upsertAsset(ingested.asset, `Register asset "${ingested.asset.name}"`);
          const res = componentCommandClient.createNodes([imageNode], `Insert image "${imageNode.name}"`);
          if (res.status === 'applied') insertedCount += 1;
        } else {
          const res = mainCommandClient.insertImageWithAsset(
            ingested.asset,
            imageNode,
            `Insert image "${imageNode.name}"`,
          );
          if (res.status === 'applied') insertedCount += 1;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unsupported image file.';
        errors.push(`${file.name}: ${msg}`);
      }
    }

    if (insertedCount > 0) {
      selectionSourceRef.current = 'canvas';
      setInspectorVisible(true);
      const details: string[] = [];
      if (reusedCount > 0) details.push(`${reusedCount} deduplicated`);
      if (sanitizedSvgCount > 0) details.push(`${sanitizedSvgCount} SVG sanitized`);
      const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
      setNotice(`Inserted ${insertedCount} image${insertedCount === 1 ? '' : 's'}${suffix}.`);
    } else if (errors.length > 0) {
      setNotice(errors[0]);
    }
  }, [
    activeEditorId,
    canonicalStore,
    componentCommandClient,
    componentStore,
    isHydrating,
    mainCommandClient,
    selectionSourceRef,
    setInspectorVisible,
    setNotice,
  ]);

  return {
    handleInsertImageFiles,
  };
}
