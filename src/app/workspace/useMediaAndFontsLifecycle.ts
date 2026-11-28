import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { getActiveDocument } from '../../core/document/project';
import {
  collectProjectGoogleFonts,
  ensureStudioCustomFontsLoaded,
  ensureStudioGoogleFontsLoaded,
  formatCustomFontCssStack,
} from '../../core/document/fonts';
import {
  createImageNodeFromAsset,
  getAssetCacheRevision,
  ingestFontFile,
  ingestImageFile,
  subscribeAssetCacheUpdates,
} from '../../core/persistence/assetStore';
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
 * Manages Studio Google Fonts / @font-face dynamic stylesheet loading,
 * SHA-256 deduplicated image ingestion, and custom font file import (.woff2/.woff/.ttf/.otf).
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
  const [assetCacheRevision, setAssetCacheRevision] = useState(() => getAssetCacheRevision());

  useEffect(() => subscribeAssetCacheUpdates(() => {
    setAssetCacheRevision(getAssetCacheRevision());
  }), []);

  useEffect(() => {
    ensureStudioGoogleFontsLoaded(projectGoogleFonts);
  }, [projectGoogleFontsKey]);

  useEffect(() => {
    ensureStudioCustomFontsLoaded(project.assets);
  }, [project.assets, assetCacheRevision]);

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
    let latestPortabilityWarning: string | null = null;
    const errors: string[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      try {
        const existingAssets = canonicalStore.getSnapshot().editorState.project.assets;
        const ingested = await ingestImageFile(file, existingAssets);
        if (ingested.deduplicated) reusedCount += 1;
        if (ingested.asset.mimeType === 'image/svg+xml') sanitizedSvgCount += 1;
        if (ingested.portabilityWarning) latestPortabilityWarning = ingested.portabilityWarning;

        const offset = i * 28;
        const assetW = ingested.asset.width ?? 360;
        const assetH = ingested.asset.height ?? 240;
        const imageNode = createImageNodeFromAsset(ingested.asset, {
          x: dropPoint ? Math.round(dropPoint.x - Math.min(480, assetW) / 2 + offset) : Math.round(120 + offset),
          y: dropPoint ? Math.round(dropPoint.y - Math.min(360, assetH) / 2 + offset) : Math.round(120 + offset),
          maxDimension: Math.max(160, Math.min(520, Math.round(targetDoc.width * 0.65))),
        });

        if (targetEditor === 'component') {
          const res = componentCommandClient.insertImageWithAsset(
            ingested.asset,
            imageNode,
            `Insert image "${imageNode.name}"`,
          );
          if (res.status === 'applied') {
            mainCommandClient.upsertAsset(ingested.asset, `Register asset "${ingested.asset.name}"`);
            insertedCount += 1;
          }
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
      const baseNotice = `Inserted ${insertedCount} image${insertedCount === 1 ? '' : 's'}${suffix}.`;
      setNotice(latestPortabilityWarning ? `${baseNotice} Warning: ${latestPortabilityWarning}` : baseNotice);
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

  const handleImportFontFiles = useCallback(async (
    files: readonly File[],
    targetEditor: EditorTarget = activeEditorId,
  ) => {
    if (isHydrating || files.length === 0) return;
    let importedCount = 0;
    let reusedCount = 0;
    let lastFamilyName = '';
    let latestPortabilityWarning: string | null = null;
    const errors: string[] = [];

    for (const file of files) {
      try {
        const existingAssets = canonicalStore.getSnapshot().editorState.project.assets;
        const ingested = await ingestFontFile(file, existingAssets);
        if (ingested.deduplicated) reusedCount += 1;
        if (ingested.portabilityWarning) latestPortabilityWarning = ingested.portabilityWarning;

        const res = mainCommandClient.upsertAsset(
          ingested.asset,
          `Import font "${ingested.familyName}"`,
        );
        if (res.status === 'applied') {
          importedCount += 1;
          lastFamilyName = ingested.familyName;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unsupported font file.';
        errors.push(`${file.name}: ${msg}`);
      }
    }

    if (importedCount > 0) {
      const updatedProject = canonicalStore.getSnapshot().editorState.project;
      ensureStudioCustomFontsLoaded(updatedProject.assets);

      let appliedToText = false;
      if (lastFamilyName) {
        const targetStore = targetEditor === 'component' ? componentStore : canonicalStore;
        const targetClient = targetEditor === 'component' ? componentCommandClient : mainCommandClient;
        const snap = targetStore.getSnapshot().editorState;
        const activeDoc = getActiveDocument(snap.project);
        const selectedTextNodes = snap.selectedNodeIds
          .map((id) => activeDoc.nodes.find((n) => n.id === id))
          .filter((node): node is Extract<typeof activeDoc.nodes[number], { type: 'text' }> => node?.type === 'text');
        if (selectedTextNodes.length > 0) {
          const stack = formatCustomFontCssStack(lastFamilyName);
          targetClient.transformNodes(
            selectedTextNodes.map((node) => ({
              ...node,
              style: { ...node.style, fontFamily: stack },
            })),
            `Apply imported font "${lastFamilyName}"`,
          );
          appliedToText = true;
        }
      }

      const details: string[] = [];
      if (reusedCount > 0) details.push(`${reusedCount} deduplicated`);
      if (appliedToText) details.push('applied to selection');
      const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
      const baseNotice =
        importedCount === 1
          ? `Imported font "${lastFamilyName}"${suffix}.`
          : `Imported ${importedCount} custom fonts${suffix}.`;
      setNotice(latestPortabilityWarning ? `${baseNotice} Warning: ${latestPortabilityWarning}` : baseNotice);
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
    setNotice,
  ]);

  return {
    handleInsertImageFiles,
    handleImportFontFiles,
  };
}
