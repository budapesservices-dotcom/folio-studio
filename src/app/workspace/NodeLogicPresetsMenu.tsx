import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { LogicFramePreset } from '../../core/document/types';
import { getLogicFrameColorPreset } from '../../engines/prototype';
import { LOGIC_PRESETS, type LogicPresetId } from './nodeLogicGraphHelpers';

export type LogicPresetTabId = 'all' | 'starter' | 'saved';

export interface PresetsMenuRectLike {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface PresetsMenuLayout {
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly placement: 'below' | 'above';
}

export interface ComputePresetsMenuLayoutOptions {
  readonly menuWidth?: number;
  readonly preferredMaxHeight?: number;
  readonly margin?: number;
  readonly gap?: number;
  readonly minVisibleHeight?: number;
}

/**
 * Computes a viewport-clamped layout for the Node Logic Presets menu so its
 * sticky tabs and scrollable preset list stay accessible even in restricted
 * viewport or window areas.
 */
export function computePresetsMenuLayout(
  anchorRect: PresetsMenuRectLike,
  viewport: { readonly width: number; readonly height: number },
  options: ComputePresetsMenuLayoutOptions = {},
): PresetsMenuLayout {
  const menuWidth = options.menuWidth ?? 284;
  const preferredMaxHeight = options.preferredMaxHeight ?? 360;
  const margin = options.margin ?? 10;
  const gap = options.gap ?? 6;
  const minVisibleHeight = options.minVisibleHeight ?? 116;

  const safeViewportW = Math.max(menuWidth + margin * 2, viewport.width);
  const safeViewportH = Math.max(minVisibleHeight + margin * 2, viewport.height);

  const left = Math.max(margin, Math.min(anchorRect.left, safeViewportW - menuWidth - margin));
  const availableBelow = Math.max(0, safeViewportH - anchorRect.bottom - gap - margin);
  const availableAbove = Math.max(0, anchorRect.top - gap - margin);

  const flipThreshold = Math.min(180, preferredMaxHeight);
  const placement: 'below' | 'above' =
    availableBelow >= flipThreshold || availableBelow >= availableAbove ? 'below' : 'above';

  if (placement === 'below') {
    const maxHeight = Math.max(
      minVisibleHeight,
      Math.min(preferredMaxHeight, Math.max(availableBelow, minVisibleHeight)),
    );
    const clampedMaxHeight = Math.min(maxHeight, safeViewportH - margin * 2);
    const top = Math.max(
      margin,
      Math.min(anchorRect.bottom + gap, safeViewportH - clampedMaxHeight - margin),
    );
    return {
      top: Math.round(top),
      left: Math.round(left),
      maxHeight: Math.round(clampedMaxHeight),
      placement,
    };
  }

  const maxHeight = Math.max(
    minVisibleHeight,
    Math.min(preferredMaxHeight, Math.max(availableAbove, minVisibleHeight)),
  );
  const clampedMaxHeight = Math.min(maxHeight, safeViewportH - margin * 2);
  const top = Math.max(margin, anchorRect.top - gap - clampedMaxHeight);
  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight: Math.round(clampedMaxHeight),
    placement,
  };
}

export interface NodeLogicPresetsMenuProps {
  menuRef: RefObject<HTMLDivElement>;
  layout: PresetsMenuLayout;
  savedFramePresets: readonly LogicFramePreset[];
  onInsertPreset: (presetId: LogicPresetId) => void;
  onInsertSavedFramePreset: (preset: LogicFramePreset) => void;
  onDeleteSavedFramePreset: (presetId: string) => void;
}

const PRESET_TABS: readonly { readonly id: LogicPresetTabId; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'starter', label: 'Starter' },
  { id: 'saved', label: 'Saved' },
];

export function NodeLogicPresetsMenu({
  menuRef,
  layout,
  savedFramePresets,
  onInsertPreset,
  onInsertSavedFramePreset,
  onDeleteSavedFramePreset,
}: NodeLogicPresetsMenuProps) {
  const [activeTab, setActiveTab] = useState<LogicPresetTabId>('all');
  const tabButtonRefs = useRef<Partial<Record<LogicPresetTabId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (menuRef.current) {
      menuRef.current.scrollTop = 0;
    }
  }, [activeTab, menuRef]);

  const counts: Record<LogicPresetTabId, number> = {
    all: LOGIC_PRESETS.length + savedFramePresets.length,
    starter: LOGIC_PRESETS.length,
    saved: savedFramePresets.length,
  };

  const handleTabKeyDown = (event: KeyboardEvent, currentIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % PRESET_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + PRESET_TABS.length) % PRESET_TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = PRESET_TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = PRESET_TABS[nextIndex];
    setActiveTab(nextTab.id);
    tabButtonRefs.current[nextTab.id]?.focus();
  };

  const showStarter = activeTab === 'all' || activeTab === 'starter';
  const showSaved = activeTab === 'all' || activeTab === 'saved';

  return (
    <div
      ref={menuRef}
      class="nl-presets-menu"
      data-testid="nl-presets-menu"
      data-placement={layout.placement}
      role="dialog"
      aria-label="Interactive logic presets"
      style={{
        top: `${layout.top}px`,
        left: `${layout.left}px`,
        maxHeight: `${layout.maxHeight}px`,
      }}
    >
      <div
        class="nl-presets-tabs"
        role="tablist"
        aria-label="Node preset categories"
        data-testid="nl-presets-tabs"
      >
        {PRESET_TABS.map((tab, index) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabButtonRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`nl-preset-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls="nl-presets-tabpanel"
              tabIndex={isSelected ? 0 : -1}
              data-testid={`nl-preset-tab-${tab.id}`}
              class={`nl-presets-tab ${isSelected ? 'is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              <span class="nl-presets-tab-count nl-tabular">{counts[tab.id]}</span>
            </button>
          );
        })}
      </div>

      <div
        id="nl-presets-tabpanel"
        role="tabpanel"
        aria-labelledby={`nl-preset-tab-${activeTab}`}
        class="nl-presets-panel"
        data-testid="nl-presets-panel"
      >
        {showStarter && (
          <>
            <div class="nl-presets-section-title">Starter Graph Presets</div>
            {LOGIC_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                class="nl-preset-item"
                onClick={() => onInsertPreset(preset.id)}
              >
                <strong>{preset.name}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </>
        )}

        {activeTab === 'all' && <div class="nl-presets-divider" />}

        {showSaved && (
          <>
            <div class="nl-presets-section-title">
              Saved Frame Presets ({savedFramePresets.length})
            </div>
            {savedFramePresets.length === 0 ? (
              <div class="nl-preset-empty">
                Bake any Smart Logic Frame and click “Save as Preset” to reuse it here.
              </div>
            ) : (
              savedFramePresets.map((fPreset) => {
                const fpColor = getLogicFrameColorPreset(fPreset.color);
                return (
                  <div key={fPreset.id} class="nl-saved-preset-row">
                    <button
                      type="button"
                      class="nl-preset-item nl-saved-preset-btn"
                      onClick={() => onInsertSavedFramePreset(fPreset)}
                    >
                      <strong class="nl-saved-preset-title">
                        <span
                          class="nl-saved-preset-dot"
                          style={{ backgroundColor: fpColor.accent }}
                          aria-hidden="true"
                        />
                        {fPreset.name}
                      </strong>
                      <span>{fPreset.description ?? `${fPreset.nodes.length} baked nodes`}</span>
                    </button>
                    <button
                      type="button"
                      class="nl-saved-preset-del"
                      aria-label={`Remove saved preset ${fPreset.name}`}
                      title="Remove saved preset"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteSavedFramePreset(fPreset.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
