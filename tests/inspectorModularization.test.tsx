import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';

const hookMocks = vi.hoisted(() => ({
  useState: vi.fn((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    vi.fn(),
  ]),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn((initial: unknown) => ({ current: initial })),
  useMemo: vi.fn((factory: () => unknown) => factory()),
  useCallback: vi.fn((fn: unknown) => fn),
}));

vi.mock('preact/hooks', () => hookMocks);

import { createRectNode, createTextNode } from '../src/core/document/factory';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import type { ComponentDefinition, NodeLayoutChildConfig } from '../src/core/document/types';
import {
  INSPECTOR_FONT_FAMILIES as REEXPORTED_FONT_FAMILIES,
  InspectorPanel,
  type InspectorPanelProps,
} from '../src/app/InspectorPanel';
import {
  buildNextStateOverrides,
  hasAnyStateOverrides,
  InspectorInteractiveStateSection,
  removeStateOverride,
} from '../src/app/workspace/InspectorInteractiveStateSection';
import {
  countActiveBounds,
  detectActivePinPreset,
  resolveBound,
  resolveDimensionNumeric,
  resolveDimensionUnit,
  toLengthUnit,
} from '../src/app/workspace/InspectorSizePositionSection';
import {
  INSPECTOR_FONT_FAMILIES,
  InspectorTypographySection,
} from '../src/app/workspace/InspectorTypographySection';
import { InspectorComponentLogicSection } from '../src/app/workspace/InspectorComponentLogicSection';
import {
  InspectorEmptyStateView,
  InspectorMultiSelectionView,
} from '../src/app/workspace/InspectorSelectionStates';

import inspectorPanelSource from '../src/app/InspectorPanel.tsx?raw';
import interactiveStateSource from '../src/app/workspace/InspectorInteractiveStateSection.tsx?raw';
import sizePositionSource from '../src/app/workspace/InspectorSizePositionSection.tsx?raw';
import typographySource from '../src/app/workspace/InspectorTypographySection.tsx?raw';
import componentLogicSource from '../src/app/workspace/InspectorComponentLogicSection.tsx?raw';
import selectionStatesSource from '../src/app/workspace/InspectorSelectionStates.tsx?raw';

function createBaseInspectorProps(overrides: Partial<InspectorPanelProps> = {}): InspectorPanelProps {
  return {
    visible: true,
    width: 300,
    isResizing: false,
    resizeHandleRef: createRef<HTMLDivElement>(),
    activeEditorId: 'main',
    selectedNode: null,
    selectedNodes: [],
    selectedCount: 0,
    canRemoveFromCanvas: false,
    selectedInstanceComponent: null,
    editingMasterComponent: null,
    instanceOverrideTargets: null,
    activeBreakpoint: 'desktop',
    designTokens: createDefaultDesignTokens(),
    assets: [],
    defaultFillColor: '#00E5FF',
    renderIcon: () => <span />,
    onStartResize: vi.fn(),
    onResizeDoubleClick: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onCommitEdit: vi.fn(),
    onHoverHint: vi.fn(),
    onRemoveFromCanvas: vi.fn(),
    onUpdateSelected: vi.fn(),
    onUpdateSelectedStyle: vi.fn(),
    onApplyAutoLayout: vi.fn(),
    onConvertFrameLayoutMode: vi.fn(),
    onSwitchBreakpoint: vi.fn(),
    onUpdateInstanceOverride: vi.fn(),
    onUpdateInstanceVariant: vi.fn(),
    onUpdateInstanceSlot: vi.fn(),
    onUpdateMasterContract: vi.fn(),
    onToggleComponentNodeLogic: vi.fn(),
    onResetInstanceOverrides: vi.fn(),
    onDetachInstance: vi.fn(),
    onConvertToPath: vi.fn(),
    onTogglePathClosed: vi.fn(),
    onSimplifyPath: vi.fn(),
    onChooseTool: vi.fn(),
    onQuickAdd: vi.fn(),
    onDuplicateSelection: vi.fn(),
    onCopySelection: vi.fn(),
    ...overrides,
  };
}

describe('Inspector Modularization — Pure Helpers & Extracted Sections', () => {
  it('handles interactive state override helpers accurately', () => {
    expect(hasAnyStateOverrides({ stateOverrides: undefined }, 'default')).toBe(false);
    expect(hasAnyStateOverrides({ stateOverrides: undefined }, 'hover')).toBe(false);
    expect(hasAnyStateOverrides({ stateOverrides: { hover: {} } }, 'hover')).toBe(false);
    expect(hasAnyStateOverrides({ stateOverrides: { hover: { opacity: 0.8 } } }, 'hover')).toBe(true);

    const next = buildNextStateOverrides(undefined, 'hover', { opacity: 0.9, scale: 1.04 });
    expect(next.hover).toEqual({ opacity: 0.9, scale: 1.04 });

    const merged = buildNextStateOverrides(next, 'hover', { translateY: -4 });
    expect(merged.hover).toEqual({ opacity: 0.9, scale: 1.04, translateY: -4 });

    const withFocus = buildNextStateOverrides(merged, 'focus', { opacity: 1 });
    const afterHoverReset = removeStateOverride(withFocus, 'hover');
    expect(afterHoverReset).toEqual({ focus: { opacity: 1 } });

    const afterFocusReset = removeStateOverride(afterHoverReset, 'focus');
    expect(afterFocusReset).toBeUndefined();
  });

  it('handles Size & Position pin, unit, dimension, and bound pure helpers accurately', () => {
    expect(detectActivePinPreset(undefined)).toBe('tl');
    expect(detectActivePinPreset({ horizontal: 'center', vertical: 'center' })).toBe('center');
    expect(detectActivePinPreset({ horizontal: 'left-right', vertical: 'top-bottom' })).toBe('stretch');
    expect(detectActivePinPreset({ horizontal: 'right', vertical: 'center' })).toBeNull();

    expect(toLengthUnit('rem')).toBe('rem');
    expect(toLengthUnit('dvh')).toBe('dvh');
    expect(toLengthUnit('auto', 'px')).toBe('px');
    expect(toLengthUnit('fit', '%')).toBe('%');

    const child: NodeLayoutChildConfig = {
      widthMode: 'hug',
      heightMode: 'relative',
      heightPercent: 60,
      minWidth: 160,
      maxWidthValue: { value: 1280, unit: 'px' },
    };
    const box = { width: 320.4, height: 180.6 };

    expect(resolveDimensionUnit(child, 'width')).toBe('fit');
    expect(resolveDimensionUnit(child, 'height')).toBe('%');
    expect(resolveDimensionNumeric(box, child, 'width')).toBe(320);
    expect(resolveDimensionNumeric(box, child, 'height')).toBe(60);

    const fixedRemChild: NodeLayoutChildConfig = {
      widthMode: 'fixed',
      widthValue: { value: 24, unit: 'rem' },
    };
    expect(resolveDimensionUnit(fixedRemChild, 'width')).toBe('rem');
    expect(resolveDimensionNumeric(box, fixedRemChild, 'width')).toBe(24);

    expect(resolveBound(child, 'minWidth')).toEqual({ value: 160, unit: 'px' });
    expect(resolveBound(child, 'maxWidth')).toEqual({ value: 1280, unit: 'px' });
    expect(resolveBound(child, 'minHeight')).toEqual({ value: 0, unit: 'auto' });
    expect(countActiveBounds(child)).toBe(2);
  });

  it('preserves INSPECTOR_FONT_FAMILIES re-export and renders modular sub-sections cleanly', () => {
    expect(REEXPORTED_FONT_FAMILIES).toBe(INSPECTOR_FONT_FAMILIES);
    expect(INSPECTOR_FONT_FAMILIES.length).toBeGreaterThan(0);

    const rect = createRectNode(0);
    const text = createTextNode(0);

    const stateTree = InspectorInteractiveStateSection({
      selectedNode: rect,
      activeState: 'hover',
      onSelectState: vi.fn(),
      onUpdateSelected: vi.fn(),
      onCommitEdit: vi.fn(),
    });
    expect(stateTree).toBeTruthy();

    const typographyTree = InspectorTypographySection({
      selectedNode: text,
      onUpdateSelectedStyle: vi.fn(),
      onUpdateExtendedStyle: vi.fn(),
      onCommitEdit: vi.fn(),
    });
    expect(typographyTree).toBeTruthy();

    const logicTree = InspectorComponentLogicSection({
      activeEditorId: 'main',
      selectedNode: rect,
      scopedNodes: [rect, text],
      selectedInstanceComponent: null,
      editingMasterComponent: null,
      onUpdateInstanceVariant: vi.fn(),
      onUpdateInstanceSlot: vi.fn(),
      onUpdateMasterContract: vi.fn(),
      onResetInstanceOverrides: vi.fn(),
      onDetachInstance: vi.fn(),
      onConvertToPath: vi.fn(),
      onTogglePathClosed: vi.fn(),
      onSimplifyPath: vi.fn(),
      onChooseTool: vi.fn(),
    });
    expect(logicTree).toBeTruthy();

    const multiTree = InspectorMultiSelectionView({
      activeEditorId: 'main',
      selectedNodes: [rect, text],
      effectiveSelectedCount: 2,
      onDuplicateSelection: vi.fn(),
      onCopySelection: vi.fn(),
      onConvertToPath: vi.fn(),
      onSimplifyPath: vi.fn(),
    });
    expect(multiTree).toBeTruthy();

    const emptyTree = InspectorEmptyStateView({
      activeEditorId: 'main',
      editingMasterComponent: null,
      renderIcon: () => <span />,
      onQuickAdd: vi.fn(),
      hasImageInsert: true,
      onTriggerImagePicker: vi.fn(),
    });
    expect(emptyTree).toBeTruthy();
  });

  it('keeps InspectorPanel root hook-free across empty, single, multi, and master modes', () => {
    const rect1 = createRectNode(0);
    const rect2 = createRectNode(1);
    const masterComp = {
      id: 'comp-card',
      name: 'FeatureCard',
      scope: 'global',
      rootNodeId: 'root-1',
      nodes: [rect1],
      nodeLogicEnabled: true,
    } as unknown as ComponentDefinition;

    hookMocks.useState.mockClear();
    hookMocks.useEffect.mockClear();
    hookMocks.useLayoutEffect.mockClear();
    hookMocks.useRef.mockClear();
    hookMocks.useMemo.mockClear();
    hookMocks.useCallback.mockClear();

    expect(InspectorPanel(createBaseInspectorProps())).toBeTruthy();
    expect(
      InspectorPanel(
        createBaseInspectorProps({
          selectedNode: rect1,
          selectedNodes: [rect1],
          selectedCount: 1,
        }),
      ),
    ).toBeTruthy();
    expect(
      InspectorPanel(
        createBaseInspectorProps({
          selectedNode: null,
          selectedNodes: [rect1, rect2],
          selectedCount: 2,
        }),
      ),
    ).toBeTruthy();
    expect(
      InspectorPanel(
        createBaseInspectorProps({
          activeEditorId: 'component',
          editingMasterComponent: masterComp,
        }),
      ),
    ).toBeTruthy();

    // InspectorPanel root must remain strictly hook-free (zero hook calls across all 4 modes)
    expect(hookMocks.useState).not.toHaveBeenCalled();
    expect(hookMocks.useEffect).not.toHaveBeenCalled();
    expect(hookMocks.useLayoutEffect).not.toHaveBeenCalled();
    expect(hookMocks.useRef).not.toHaveBeenCalled();
    expect(hookMocks.useMemo).not.toHaveBeenCalled();
    expect(hookMocks.useCallback).not.toHaveBeenCalled();
  });

  it('keeps InspectorPanel orchestrator concise and enforces Zero-Typing across all extracted modules', () => {
    const panelLineCount = inspectorPanelSource.split('\n').length;
    expect(panelLineCount).toBeLessThan(650);

    const extractedSources = [
      { name: 'InspectorPanel.tsx', source: inspectorPanelSource },
      { name: 'InspectorInteractiveStateSection.tsx', source: interactiveStateSource },
      { name: 'InspectorSizePositionSection.tsx', source: sizePositionSource },
      { name: 'InspectorTypographySection.tsx', source: typographySource },
      { name: 'InspectorComponentLogicSection.tsx', source: componentLogicSource },
      { name: 'InspectorSelectionStates.tsx', source: selectionStatesSource },
    ];

    for (const entry of extractedSources) {
      expect(entry.source, `${entry.name} must not use type="number"`).not.toMatch(/type=["']number["']/);
      expect(entry.source, `${entry.name} must not use <textarea`).not.toMatch(/<textarea\b/);
    }

    // Ensure the opacity range slider in InspectorSizePositionSection never binds both onInput and onChange
    expect(sizePositionSource).toContain('type="range"');
    const rangeTagMatch = sizePositionSource.match(/<input[\s\S]*?type="range"[\s\S]*?\/>/g) ?? [];
    expect(rangeTagMatch.length).toBeGreaterThan(0);
    for (const tag of rangeTagMatch) {
      expect(tag).toContain('onInput=');
      expect(tag).not.toContain('onChange=');
    }
  });
});
