import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import type {
  BreakpointId,
  ComponentDefinition,
  ComponentInstanceNode,
  ComponentSlotDefinition,
  ComponentVariantAxis,
  DesignNode,
  DesignTokenCollection,
  FolioDocument,
  FolioProject,
} from '../../core/document/types';
import { getProjectDesignTokens } from '../../core/document/tokens';
import { applyAutoLayoutToNodes } from '../../engines/layout/autoLayout';
import type { WorkspaceCommandClient } from '../mainCanvasCommandClient';

export interface UseDesignSystemActionsArgs {
  project: FolioProject;
  focusedDocument: FolioDocument;
  selectedNode: DesignNode | null;
  mainCommandClient: WorkspaceCommandClient;
  focusedCommandClient: WorkspaceCommandClient;
  componentCommandClient?: WorkspaceCommandClient;
  setNotice: (message: string) => void;
  onMasterMetadataUpdated?: (componentId: string, previousUpdatedAt: string) => void;
}

export function useDesignSystemActions({
  project,
  focusedDocument,
  selectedNode,
  mainCommandClient,
  focusedCommandClient,
  componentCommandClient,
  setNotice,
  onMasterMetadataUpdated,
}: UseDesignSystemActionsArgs) {
  const [activeBreakpoint, setActiveBreakpoint] = useState<BreakpointId>('desktop');
  const [tokensRackOpen, setTokensRackOpen] = useState(false);
  const tokensRackRef = useRef<HTMLElement | null>(null);
  const tokensRackToggleRef = useRef<HTMLButtonElement | null>(null);

  const designTokens = useMemo(() => getProjectDesignTokens(project), [project]);

  const closeTokensRack = useCallback(() => {
    if (tokensRackRef.current?.contains(document.activeElement)) {
      tokensRackToggleRef.current?.focus({ preventScroll: true });
    }
    setTokensRackOpen(false);
  }, []);

  const updateDesignTokens = useCallback(
    (next: DesignTokenCollection, unbindTokenIds?: string[], description = 'Update design tokens') => {
      const result = mainCommandClient.updateDesignTokens(next, unbindTokenIds, description);
      if (result.status === 'applied') {
        componentCommandClient?.updateDesignTokens(next, unbindTokenIds, description);
        if (unbindTokenIds && unbindTokenIds.length > 0) {
          setNotice('Design token deleted and unbound from layers.');
        }
      }
    },
    [mainCommandClient, componentCommandClient, setNotice],
  );

  const applyAutoLayout = useCallback(
    (containerId: string) => {
      const container = focusedDocument.nodes.find((n) => n.id === containerId);
      if (!container || !container.layout || container.layout.mode === 'none') return;
      const computed = applyAutoLayoutToNodes(focusedDocument.nodes, containerId, designTokens);
      const beforeById = new Map(focusedDocument.nodes.map((n) => [n.id, n]));
      const changed = computed.filter((node) => {
        const prev = beforeById.get(node.id);
        return (
          prev !== undefined &&
          (prev.x !== node.x || prev.y !== node.y || prev.width !== node.width || prev.height !== node.height)
        );
      });
      if (changed.length === 0) {
        setNotice('Auto-Layout positions are already up to date.');
        return;
      }
      const res = focusedCommandClient.transformNodes(changed, 'Apply Auto-Layout');
      if (res.status === 'applied') {
        setNotice(`Applied Auto-Layout to ${changed.length} layer${changed.length === 1 ? '' : 's'}.`);
      }
    },
    [focusedDocument, activeBreakpoint, designTokens, focusedCommandClient, setNotice],
  );

  const updateInstanceVariant = useCallback(
    (axisId: string, optionId: string) => {
      if (!selectedNode || selectedNode.type !== 'component-instance') return;
      const instance = selectedNode as ComponentInstanceNode;
      const next: ComponentInstanceNode = {
        ...instance,
        variantSelection: {
          ...(instance.variantSelection ?? {}),
          [axisId]: optionId,
        },
      };
      focusedCommandClient.replaceNode(next, 'Switch component variant');
    },
    [selectedNode, focusedCommandClient],
  );

  const updateInstanceSlot = useCallback(
    (slotId: string, patch: { text?: string; visible?: boolean }) => {
      if (!selectedNode || selectedNode.type !== 'component-instance') return;
      const instance = selectedNode as ComponentInstanceNode;
      const current = instance.slotAssignments?.[slotId] ?? {};
      const next: ComponentInstanceNode = {
        ...instance,
        slotAssignments: {
          ...(instance.slotAssignments ?? {}),
          [slotId]: { ...current, ...patch },
        },
      };
      focusedCommandClient.editNode(next, 'instance-slot:' + instance.id + ':' + slotId, 'Update component slot');
    },
    [selectedNode, focusedCommandClient],
  );

  const updateMasterContract = useCallback(
    (
      component: ComponentDefinition,
      patch: { variants?: ComponentVariantAxis[]; slots?: ComponentSlotDefinition[]; nodeLogicEnabled?: boolean },
    ) => {
      const live = project.components.find((c) => c.id === component.id);
      if (!live) return;
      const res = mainCommandClient.updateComponentContract(
        {
          componentId: live.id,
          ...(patch.variants !== undefined ? { variants: patch.variants } : {}),
          ...(patch.slots !== undefined ? { slots: patch.slots } : {}),
          ...(patch.nodeLogicEnabled !== undefined ? { nodeLogicEnabled: patch.nodeLogicEnabled } : {}),
          expectedUpdatedAt: live.updatedAt,
          expectedMasterDocument: live.document,
        },
        patch.nodeLogicEnabled !== undefined
          ? (patch.nodeLogicEnabled ? `Send ${live.name} to Node Logic` : `Disable ${live.name} in Node Logic`)
          : `Update ${live.name} contract`,
      );
      if (res.status === 'applied') {
        onMasterMetadataUpdated?.(live.id, live.updatedAt);
        if (patch.nodeLogicEnabled !== undefined && patch.variants === undefined && patch.slots === undefined) {
          setNotice(
            patch.nodeLogicEnabled
              ? `“${live.name}” enabled in Node Logic. Select it from any Component node dropdown.`
              : `“${live.name}” removed from Node Logic component list.`,
          );
        } else {
          setNotice(`Updated contract for “${live.name}”.`);
        }
      }
    },
    [project.components, mainCommandClient, onMasterMetadataUpdated, setNotice],
  );

  const toggleComponentNodeLogic = useCallback(
    (component: ComponentDefinition, enabled?: boolean) => {
      const live = project.components.find((c) => c.id === component.id);
      if (!live) return;
      const nextEnabled = enabled ?? !Boolean(live.nodeLogicEnabled);
      updateMasterContract(live, { nodeLogicEnabled: nextEnabled });
    },
    [project.components, updateMasterContract],
  );

  return {
    activeBreakpoint,
    setActiveBreakpoint,
    tokensRackOpen,
    setTokensRackOpen,
    tokensRackRef,
    tokensRackToggleRef,
    closeTokensRack,
    designTokens,
    updateDesignTokens,
    applyAutoLayout,
    updateInstanceVariant,
    updateInstanceSlot,
    updateMasterContract,
    toggleComponentNodeLogic,
  };
}
