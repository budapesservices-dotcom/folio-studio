import { useState } from 'preact/hooks';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  ComponentSlotDefinition,
  ComponentVariantAxis,
} from '../../core/document/types';
import {
  createComponentSlot,
  createComponentVariantAxis,
  getEffectiveVariantSelection,
} from '../../core/document/components';

export interface InspectorComponentContractSectionProps {
  /** Present when inspecting a Component Instance on Main Canvas. */
  instanceNode: ComponentInstanceNode | null;
  instanceComponent: ComponentDefinition | null;
  /** Present when editing a Component Master inside Component Canvas. */
  editingMasterComponent: ComponentDefinition | null;
  onUpdateInstanceVariant: (axisId: string, optionId: string) => void;
  onUpdateInstanceSlot: (slotId: string, patch: { text?: string; visible?: boolean }) => void;
  onUpdateMasterContract: (
    component: ComponentDefinition,
    patch: {
      variants?: ComponentVariantAxis[];
      slots?: ComponentSlotDefinition[];
      nodeLogicEnabled?: boolean;
    },
  ) => void;
  onToggleComponentNodeLogic?: (component: ComponentDefinition, enabled?: boolean) => void;
}

export function InspectorComponentContractSection({
  instanceNode,
  instanceComponent,
  editingMasterComponent,
  onUpdateInstanceVariant,
  onUpdateInstanceSlot,
  onUpdateMasterContract,
  onToggleComponentNodeLogic,
}: InspectorComponentContractSectionProps) {
  const [newAxisName, setNewAxisName] = useState('');
  const [newSlotName, setNewSlotName] = useState('');
  const [newSlotTargetId, setNewSlotTargetId] = useState('');
  const [optionDraftByAxis, setOptionDraftByAxis] = useState<Record<string, string>>({});

  const renderNodeLogicToggle = (component: ComponentDefinition) => {
    const enabled = Boolean(component.nodeLogicEnabled);
    const handleToggle = () => {
      if (onToggleComponentNodeLogic) {
        onToggleComponentNodeLogic(component, !enabled);
      } else {
        onUpdateMasterContract(component, { nodeLogicEnabled: !enabled });
      }
    };
    return (
      <div class="contract-card contract-node-logic-card">
        <div class="contract-node-logic-row">
          <div>
            <div class="contract-card-title">Node Logic</div>
            <div class="contract-card-meta">
              {enabled
                ? 'Available in Component node dropdown'
                : 'Enable to wire events in Node Logic'}
            </div>
          </div>
          <button
            type="button"
            class={`contract-node-logic-btn ${enabled ? 'is-enabled' : ''}`}
            aria-pressed={enabled}
            onClick={handleToggle}
          >
            {enabled ? '✓ In Node' : 'Send to Node'}
          </button>
        </div>
      </div>
    );
  };

  // Mode 1: Main Canvas Component Instance — Node Logic & Variant/Slot pickers
  if (instanceNode && instanceComponent) {
    const variants = instanceComponent.variants ?? [];
    const slots = instanceComponent.slots ?? [];
    const effectiveSelection = getEffectiveVariantSelection(instanceNode, instanceComponent);

    return (
      <section class="property-section" aria-label="Component Contract">
        <div class="section-title">
          {variants.length > 0 || slots.length > 0 ? 'Component Contract' : 'Component Logic'}
        </div>

        <div class="contract-group">
          {renderNodeLogicToggle(instanceComponent)}
        </div>

        {variants.length > 0 && (
          <div class="contract-group">
            {variants.map((axis) => (
              <label class="field-label" key={axis.id}>
                {axis.name}
                <select
                  class="select-field"
                  aria-label={`Variant ${axis.name}`}
                  value={effectiveSelection[axis.id] ?? axis.defaultOptionId}
                  onChange={(event) => onUpdateInstanceVariant(axis.id, event.currentTarget.value)}
                >
                  {axis.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        {slots.length > 0 && (
          <div class="contract-group">
            {slots.map((slot) => {
              const targetNode = instanceComponent.document.nodes.find((n) => n.id === slot.targetNodeId);
              const assignment = instanceNode.slotAssignments?.[slot.id];
              const isVisible = assignment?.visible ?? true;
              const currentText =
                assignment?.text ??
                slot.defaultText ??
                (targetNode?.type === 'text' ? targetNode.text : '');
              return (
                <div class="contract-card" key={slot.id}>
                  <div class="contract-card-header">
                    <span class="contract-card-title">{slot.name}</span>
                    <label class="contract-mini-toggle">
                      <input
                        type="checkbox"
                        checked={isVisible}
                        aria-label={`Show slot ${slot.name}`}
                        onChange={(event) =>
                          onUpdateInstanceSlot(slot.id, { visible: event.currentTarget.checked })
                        }
                      />
                      <span>Show</span>
                    </label>
                  </div>
                  {targetNode?.type === 'text' && (
                    <input
                      class="text-field"
                      type="text"
                      aria-label={`Slot ${slot.name} text`}
                      value={currentText}
                      onInput={(event) =>
                        onUpdateInstanceSlot(slot.id, { text: event.currentTarget.value })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  // Mode 2: Component Canvas Master — Author Variant Axes & Named Slots
  if (editingMasterComponent) {
    const masterNodes = Array.isArray(editingMasterComponent.document?.nodes)
      ? editingMasterComponent.document.nodes
      : [];
    const variants = editingMasterComponent.variants ?? [];
    const slots = editingMasterComponent.slots ?? [];
    const primaryStylableNode = masterNodes.find(
      (n) => n.type === 'rect' || n.type === 'frame' || n.type === 'ellipse' || n.type === 'path' || n.type === 'text',
    );
    const defaultSlotTarget = newSlotTargetId || masterNodes.find((n) => n.type === 'text')?.id || masterNodes[0]?.id || '';

    const handleAddAxis = () => {
      const name = newAxisName.trim() || 'Variant';
      const axis = createComponentVariantAxis(name, { optionLabels: ['Default', 'Secondary'] });
      onUpdateMasterContract(editingMasterComponent, {
        variants: [...variants, axis],
      });
      setNewAxisName('');
    };

    const handleRemoveAxis = (axisId: string) => {
      onUpdateMasterContract(editingMasterComponent, {
        variants: variants.filter((a) => a.id !== axisId),
      });
    };

    const handleAddOption = (axisId: string) => {
      const label = (optionDraftByAxis[axisId] ?? '').trim();
      if (!label) return;
      const nextVariants = variants.map((axis) => {
        if (axis.id !== axisId) return axis;
        const optId = `opt-${axis.options.length + 1}-${Date.now().toString(36).slice(-3)}`;
        return {
          ...axis,
          options: [...axis.options, { id: optId, label, overrides: {} }],
        };
      });
      onUpdateMasterContract(editingMasterComponent, { variants: nextVariants });
      setOptionDraftByAxis((prev) => ({ ...prev, [axisId]: '' }));
    };

    const handleSetOptionFill = (axisId: string, optionId: string, targetNodeId: string, fill: string) => {
      const nextVariants = variants.map((axis) => {
        if (axis.id !== axisId) return axis;
        return {
          ...axis,
          options: axis.options.map((opt) => {
            if (opt.id !== optionId) return opt;
            return {
              ...opt,
              overrides: {
                ...opt.overrides,
                [targetNodeId]: {
                  ...(opt.overrides[targetNodeId] ?? {}),
                  fill,
                },
              },
            };
          }),
        };
      });
      onUpdateMasterContract(editingMasterComponent, { variants: nextVariants });
    };

    const handleAddSlot = () => {
      if (!defaultSlotTarget) return;
      const targetNode = masterNodes.find((n) => n.id === defaultSlotTarget);
      const name = newSlotName.trim() || (targetNode ? `${targetNode.name} Slot` : 'Slot');
      const slot = createComponentSlot(
        name,
        defaultSlotTarget,
        targetNode?.type === 'text' ? { defaultText: targetNode.text } : {},
      );
      onUpdateMasterContract(editingMasterComponent, {
        slots: [...slots, slot],
      });
      setNewSlotName('');
    };

    const handleRemoveSlot = (slotId: string) => {
      onUpdateMasterContract(editingMasterComponent, {
        slots: slots.filter((s) => s.id !== slotId),
      });
    };

    return (
      <section class="property-section" aria-label="Component Master Contract">
        <div class="section-title">Component Contract</div>

        <div class="contract-subgroup">
          {renderNodeLogicToggle(editingMasterComponent)}
        </div>

        <div class="contract-subgroup">
          <div class="contract-subhead">Variant Axes ({variants.length})</div>
          {variants.map((axis) => (
            <div class="contract-card" key={axis.id}>
              <div class="contract-card-header">
                <span class="contract-card-title">{axis.name}</span>
                <button
                  type="button"
                  class="contract-remove-btn"
                  title={`Remove variant axis ${axis.name}`}
                  onClick={() => handleRemoveAxis(axis.id)}
                >
                  ×
                </button>
              </div>
              <div class="contract-options-list">
                {axis.options.map((opt) => {
                  const targetId = primaryStylableNode?.id;
                  const fillVal = targetId
                    ? (opt.overrides[targetId]?.fill ?? (primaryStylableNode && 'style' in primaryStylableNode ? primaryStylableNode.style.fill : '#8B7CF6'))
                    : '#8B7CF6';
                  return (
                    <div class="contract-option-row" key={opt.id}>
                      <span class="contract-option-label">
                        {opt.label}{opt.id === axis.defaultOptionId ? ' (default)' : ''}
                      </span>
                      {targetId && (
                        <input
                          type="color"
                          class="contract-mini-swatch"
                          title={`Fill override for ${opt.label}`}
                          aria-label={`Fill override for ${axis.name} ${opt.label}`}
                          value={fillVal.startsWith('#') && fillVal.length >= 7 ? fillVal.slice(0, 7) : '#8B7CF6'}
                          onInput={(event) => handleSetOptionFill(axis.id, opt.id, targetId, event.currentTarget.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div class="contract-inline-add">
                <input
                  class="text-field"
                  type="text"
                  placeholder="Add option..."
                  aria-label={`Add option to ${axis.name}`}
                  value={optionDraftByAxis[axis.id] ?? ''}
                  onInput={(event) =>
                    setOptionDraftByAxis((prev) => ({ ...prev, [axis.id]: event.currentTarget.value }))
                  }
                />
                <button type="button" class="inspector-inline-chip" onClick={() => handleAddOption(axis.id)}>
                  Add
                </button>
              </div>
            </div>
          ))}
          <div class="contract-inline-add">
            <input
              class="text-field"
              type="text"
              placeholder="New axis (e.g. Tone)"
              aria-label="New variant axis name"
              value={newAxisName}
              onInput={(event) => setNewAxisName(event.currentTarget.value)}
            />
            <button type="button" class="inspector-inline-chip" onClick={handleAddAxis}>
              + Axis
            </button>
          </div>
        </div>

        <div class="contract-subgroup">
          <div class="contract-subhead">Named Slots ({slots.length})</div>
          {slots.map((slot) => {
            const target = masterNodes.find((n) => n.id === slot.targetNodeId);
            return (
              <div class="contract-card" key={slot.id}>
                <div class="contract-card-header">
                  <div>
                    <span class="contract-card-title">{slot.name}</span>
                    <span class="contract-card-meta"> → {target?.name ?? slot.targetNodeId}</span>
                  </div>
                  <button
                    type="button"
                    class="contract-remove-btn"
                    title={`Remove slot ${slot.name}`}
                    onClick={() => handleRemoveSlot(slot.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
          {masterNodes.length > 0 && (
            <div class="contract-slot-add">
              <input
                class="text-field"
                type="text"
                placeholder="Slot name (e.g. Title)"
                aria-label="New slot name"
                value={newSlotName}
                onInput={(event) => setNewSlotName(event.currentTarget.value)}
              />
              <div class="contract-inline-add">
                <select
                  class="select-field"
                  aria-label="Slot target master layer"
                  value={defaultSlotTarget}
                  onChange={(event) => setNewSlotTargetId(event.currentTarget.value)}
                >
                  {masterNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name} ({n.type})</option>
                  ))}
                </select>
                <button type="button" class="inspector-inline-chip" onClick={handleAddSlot}>
                  + Slot
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  return null;
}
