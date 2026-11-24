import { useRef, useState } from 'preact/hooks';
import { createEmptyDocument, createNodeForDocument } from '../../core/document/factory';
import { createComponentInstance, wouldCreateComponentCycle } from '../../core/document/components';
import type { ComponentDefinition, FolioDocument, FolioPage, FolioProject } from '../../core/document/types';
import type { StudioTemplateDefinition, TemplateInsertMode } from '../../core/document/templates';
import type { CanvasToolId } from '../../engines/canvas/tools/types';
import type { EditorTarget } from '../editorContext';
import type { MainCanvasCommandClient } from '../mainCanvasCommandClient';

let cachedTemplatesModule: typeof import('../../core/document/templates') | null = null;

export interface UsePageAndTemplateActionsOptions {
  project: FolioProject;
  activeEditorId: EditorTarget;
  editingComponentId?: string | null;
  activeDocument: FolioDocument;
  focusedDocument: FolioDocument;
  isHydrating: boolean;
  mainCommandClient: MainCanvasCommandClient;
  focusedCommandClient: MainCanvasCommandClient;
  setActiveEditorId: (target: EditorTarget) => void;
  setWorkspaceTools: (updater: (current: Record<EditorTarget, CanvasToolId>) => Record<EditorTarget, CanvasToolId>) => void;
  setToolRackOpen: (rack: string | null) => void;
  setInspectorVisible: (visible: boolean) => void;
  openMainCanvas: () => void;
  closePagesRack: () => void;
  setNotice: (message: string) => void;
}

export function usePageAndTemplateActions({
  project,
  activeEditorId,
  editingComponentId = null,
  activeDocument,
  focusedDocument,
  isHydrating,
  mainCommandClient,
  focusedCommandClient,
  setActiveEditorId,
  setWorkspaceTools,
  setToolRackOpen,
  setInspectorVisible,
  openMainCanvas,
  closePagesRack,
  setNotice,
}: UsePageAndTemplateActionsOptions) {
  const [templateInsertMode, setTemplateInsertMode] = useState<TemplateInsertMode>('nodes');
  const templateInsertCountRef = useRef(0);
  const [pageNameDraft, setPageNameDraft] = useState('');

  const addNode = (type: 'rect' | 'ellipse' | 'text') => {
    if (isHydrating || !focusedDocument) return;
    const node = createNodeForDocument(type, focusedDocument);
    focusedCommandClient.createNodes([node], `Create ${type} node`);
    setInspectorVisible(true);
  };

  const insertTemplate = (template: StudioTemplateDefinition, requestedMode: TemplateInsertMode) => {
    if (isHydrating) return;
    const effectiveMode: TemplateInsertMode = activeEditorId === 'component' ? 'nodes' : requestedMode;
    const staggerIndex = templateInsertCountRef.current;
    templateInsertCountRef.current += 1;

    const executeInsert = ({
      buildTemplateComponentAndInstance,
      computeTemplateInsertionOrigin,
      instantiateTemplateNodes,
    }: typeof import('../../core/document/templates')) => {
      const origin = computeTemplateInsertionOrigin(focusedDocument, template, staggerIndex);

      if (effectiveMode === 'component' && activeEditorId === 'main') {
        const existingNames = project.components.map((item) => item.name);
        const { component, instance } = buildTemplateComponentAndInstance(template, origin, existingNames);
        const txResult = mainCommandClient.createComponentWithInstance(
          component,
          instance,
          `Insert "${template.name}" as component`,
        );
        if (txResult.status === 'applied') {
          mainCommandClient.selectNodes([instance.id], `Select inserted ${component.name} instance`);
          setWorkspaceTools((current) => ({ ...current, main: 'select' }));
          setToolRackOpen(null);
          setInspectorVisible(true);
          setNotice(`Inserted “${component.name}” as Master Component + linked Instance.`);
        }
        return;
      }

      const nodes = instantiateTemplateNodes(template, origin);
      const result = focusedCommandClient.createNodes(nodes, `Insert "${template.name}" template`);
      if (result.status === 'applied') {
        const rootIds = nodes.filter((node) => !node.parentId).map((node) => node.id);
        focusedCommandClient.selectNodes(rootIds.length > 0 ? rootIds : [nodes[0].id], `Select inserted ${template.name}`);
        setWorkspaceTools((current) => ({ ...current, [activeEditorId]: 'select' }));
        setToolRackOpen(null);
        setInspectorVisible(true);
        setNotice(`Inserted “${template.name}” (${nodes.length} layers).`);
      }
    };

    if (cachedTemplatesModule) {
      executeInsert(cachedTemplatesModule);
      return;
    }

    void import('../../core/document/templates')
      .then((mod) => {
        cachedTemplatesModule = mod;
        executeInsert(mod);
      })
      .catch((error: unknown) => {
        console.error('Folio could not instantiate the selected template:', error);
        setNotice('Unable to insert template.');
      });
  };

  const switchPage = (page: FolioPage) => {
    if (isHydrating || page.id === project.activePageId) return;
    setActiveEditorId('main');
    mainCommandClient.setActivePage(page.id, 'Switch active page');
    closePagesRack();
    setInspectorVisible(true);
    setNotice(`Switched to ${page.name}.`);
  };

  const addPage = () => {
    if (isHydrating) return;
    const name = pageNameDraft.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `page-${project.pages.length + 1}`;
    const route = `/${slug}`;
    if (project.pages.some((page) => page.route === route)) {
      setNotice('A page with this route already exists.');
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `page-${Date.now()}`;
    const document = {
      ...createEmptyDocument(name, activeDocument.width, activeDocument.height),
      background: activeDocument.background,
    };
    mainCommandClient.createPage({ id, name, route, document }, 'Create page');
    setPageNameDraft('');
    closePagesRack();
    setInspectorVisible(true);
    setNotice(`Created ${name}.`);
  };

  const commitProjectName = (value: string) => {
    if (isHydrating) return;
    const name = value.trim();
    if (name && name !== project.metadata.name) {
      mainCommandClient.renameProject(name);
    }
  };

  const insertOwnedComponent = (component: ComponentDefinition) => {
    if (isHydrating) return;
    if (activeEditorId === 'component' && editingComponentId && editingComponentId !== component.id) {
      if (wouldCreateComponentCycle(project.components, editingComponentId, component.id)) {
        setNotice(`Cannot nest “${component.name}” here: circular component dependency detected.`);
        return;
      }
      const offset = focusedDocument.nodes.length;
      const instance = createComponentInstance(component, 24 + (offset % 4) * 20, 24 + (offset % 4) * 20);
      const result = focusedCommandClient.createNodes([instance], 'Insert nested component instance');
      if (result.status !== 'applied') return;
      setInspectorVisible(true);
      setNotice(`Nested instance of “${component.name}” added to Component Canvas.`);
      return;
    }
    const offset = project.pages.find((page) => page.id === project.activePageId)?.document.nodes.length ?? 0;
    const instance = createComponentInstance(component, 150 + (offset % 4) * 28, 130 + (offset % 4) * 28);
    const result = mainCommandClient.createNodes([instance], 'Insert component instance');
    if (result.status !== 'applied') return;
    openMainCanvas();
    setInspectorVisible(true);
    setNotice(`Linked instance of “${component.name}” added to Main Canvas.`);
  };

  return {
    templateInsertMode,
    setTemplateInsertMode,
    pageNameDraft,
    setPageNameDraft,
    addNode,
    insertTemplate,
    switchPage,
    addPage,
    commitProjectName,
    insertOwnedComponent,
  };
}
