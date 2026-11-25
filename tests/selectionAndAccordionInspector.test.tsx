import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import {
  createEllipseNode,
  createFrameNode,
  createInitialProject,
  createPathNode,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import {
  applyShadowPresetToEffects,
  detectShadowPreset,
  formatColorWithAlpha,
  isTransparentColor,
  parseColorWithAlpha,
} from '../src/core/document/styling';
import { createDefaultDesignTokens } from '../src/core/document/tokens';
import { computeTextVerticalOffset } from '../src/core/document/typography';
import type { DesignNode, PathNode, TextNode } from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createStarPoints } from '../src/core/document/vector';
import { createEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { InspectorPanel, type InspectorPanelProps } from '../src/app/InspectorPanel';
import { evaluateToolOperation } from '../src/engines/canvas/geometryEngine';
import { hitTestNodeAtPoint, hitTestNodesAtPoint } from '../src/engines/canvas/hitTest';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import inspectorPanelSource from '../src/app/InspectorPanel.tsx?raw';
import inspectorAccordionSource from '../src/app/workspace/InspectorAccordion.tsx?raw';
import inspectorZeroTypingSource from '../src/app/workspace/InspectorZeroTypingControls.tsx?raw';

function makeStarPathNode(id: string, x: number, y: number, w: number, h: number): PathNode {
  const base = createPathNode(createStarPoints(w, h, 5, 0.42), {
    x,
    y,
    width: w,
    height: h,
    closed: true,
    name: 'Star',
    fill: '#00E5FF',
    stroke: '#12161A',
    strokeWidth: 2,
  });
  return { ...base, id };
}

describe('Part A — Shape-Aware Hit-Testing', () => {
  it('rejects empty AABB corners on ellipses and hits inside the ellipse contour', () => {
    const ellipse = {
      ...createEllipseNode(0),
      id: 'el-1',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    };

    // Top-left corner of bounding box (105, 105) is well outside the circle
    expect(hitTestNodeAtPoint(ellipse, { x: 105, y: 105 })).toBe(false);
    // Bottom-right corner of bounding box (295, 295) is also outside
    expect(hitTestNodeAtPoint(ellipse, { x: 295, y: 295 })).toBe(false);
    // Center and inside points hit accurately
    expect(hitTestNodeAtPoint(ellipse, { x: 200, y: 200 })).toBe(true);
    expect(hitTestNodeAtPoint(ellipse, { x: 260, y: 200 })).toBe(true);
  });

  it('rejects exterior corners outside rounded rectangle corner arcs', () => {
    const rect = {
      ...createRectNode(0),
      id: 'r-round',
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      style: {
        ...createRectNode(0).style,
        radius: 50,
      },
    };

    expect(hitTestNodeAtPoint(rect, { x: 2, y: 2 })).toBe(false);
    expect(hitTestNodeAtPoint(rect, { x: 118, y: 118 })).toBe(false);
    expect(hitTestNodeAtPoint(rect, { x: 60, y: 60 })).toBe(true);
  });

  it('uses actual polygon/bezier contour for star paths and rejects empty AABB corners', () => {
    const star = makeStarPathNode('star-1', 50, 50, 200, 200);

    // Outer AABB top-left corner is empty space outside the star rays
    expect(hitTestNodeAtPoint(star, { x: 54, y: 54 })).toBe(false);
    // Star center is strictly inside
    expect(hitTestNodeAtPoint(star, { x: 150, y: 150 })).toBe(true);
  });

  it('transforms coordinates into rotated shape space and respects topmost z-order', () => {
    const rotated = {
      ...createRectNode(0),
      id: 'rot-1',
      x: 100,
      y: 100,
      width: 200,
      height: 40,
      rotation: 90,
    };
    // Center is (200, 120); rotated 90 deg makes it span vertically ~y=[20..220], x=[180..220]
    expect(hitTestNodeAtPoint(rotated, { x: 200, y: 40 })).toBe(true);
    expect(hitTestNodeAtPoint(rotated, { x: 115, y: 120 })).toBe(false);

    const hidden = { ...createRectNode(1), id: 'hidden-top', x: 0, y: 0, width: 300, height: 300, visible: false };
    const locked = { ...createRectNode(2), id: 'locked-top', x: 0, y: 0, width: 300, height: 300, locked: true };
    const hit = hitTestNodesAtPoint([rotated, hidden, locked], { x: 200, y: 40 });
    expect(hit?.id).toBe('rot-1');
  });
});

describe('Part A — Native Command Engine Selection Commands (Zero-Bypass)', () => {
  it('executes Deselect, Invert Selection (skipping locked/hidden), and Select Similar via Native Commands', () => {
    const baseProject = createInitialProject();
    const page = getActivePage(baseProject);
    const n1 = {
      ...createRectNode(0),
      id: 'n1',
      name: 'Cyan Rect 1',
      style: { ...createRectNode(0).style, fill: '#00E5FF', stroke: '#4A5568', strokeWidth: 2 },
    };
    const n2 = {
      ...createRectNode(1),
      id: 'n2',
      name: 'Cyan Rect 2',
      style: { ...createRectNode(1).style, fill: '#00e5ff', stroke: '#FFFFFF', strokeWidth: 2 },
    };
    const n3 = {
      ...createEllipseNode(0),
      id: 'n3',
      name: 'Purple Circle',
      style: { ...createEllipseNode(0).style, fill: '#8B7CF6', stroke: '#4A5568', strokeWidth: 2 },
    };
    const nLocked = { ...createRectNode(2), id: 'n-locked', name: 'Locked', locked: true };
    const nHidden = { ...createRectNode(3), id: 'n-hidden', name: 'Hidden', visible: false };
    page.document.nodes = [n1, n2, n3, nLocked, nHidden];

    const store = createEditorStore(baseProject);
    const client = createMainCanvasCommandClient(store);

    // Select n1
    client.selectNodes(['n1']);
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual(['n1']);

    // Select Similar (Same Fill -> n1 + n2)
    client.selectSimilar('fill');
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual(['n1', 'n2']);

    // Select Similar (Same Stroke -> re-select n1 then match #4A5568 -> n1 + n3)
    client.selectNodes(['n1']);
    client.selectSimilar('stroke');
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual(['n1', 'n3']);

    // Select Similar (Same Type -> rect -> n1 + n2, skipping locked & hidden)
    client.selectNodes(['n1']);
    client.selectSimilar('type');
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual(['n1', 'n2']);

    // Invert Selection (siblings excluding n1, n2, locked, hidden -> [n3])
    client.invertSelection();
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual(['n3']);

    // Deselect
    client.deselectAll();
    expect(store.getSnapshot().editorState.selectedNodeIds).toEqual([]);
  });
});

describe('Part A — Draw Inside & Draw Outside Vector Masking + Codegen + .flop v2', () => {
  it('attaches newly drawn shapes to active Draw Inside / Draw Outside target via Geometry Engine', () => {
    const insideFrame = {
      ...createFrameNode(0),
      id: 'frame-inside',
      drawMode: 'inside' as const,
      clipContent: true,
    };
    const outsideEllipse = {
      ...createEllipseNode(0),
      id: 'ellipse-outside',
      drawMode: 'outside' as const,
    };

    const newRect = { ...createRectNode(0), id: 'drawn-1' };

    const insideResult = evaluateToolOperation(
      {
        nodes: [insideFrame],
        selectedNodeIds: ['frame-inside'],
        canvasWidth: 1200,
        canvasHeight: 800,
      },
      {
        kind: 'create-nodes',
        toolId: 'draw-rect',
        nodes: [newRect],
        selectIds: ['drawn-1'],
        historyMode: 'commit',
      },
    );
    expect(insideResult.ok).toBe(true);
    const createdInside = insideResult.nextNodes.find((n) => n.id === 'drawn-1');
    expect(createdInside?.parentId).toBe('frame-inside');

    const outsideResult = evaluateToolOperation(
      {
        nodes: [outsideEllipse],
        selectedNodeIds: ['ellipse-outside'],
        canvasWidth: 1200,
        canvasHeight: 800,
      },
      {
        kind: 'create-nodes',
        toolId: 'draw-rect',
        nodes: [newRect],
        selectIds: ['drawn-1'],
        historyMode: 'commit',
      },
    );
    expect(outsideResult.ok).toBe(true);
    const createdOutside = outsideResult.nextNodes.find((n) => n.id === 'drawn-1');
    expect(createdOutside?.clipMaskBaseId).toBe('ellipse-outside');
    expect(createdOutside?.clipMaskMode).toBe('outside');
  });

  it('compiles Draw Inside, Draw Outside, Stroke Align, and Text Alignment cleanly in HTML/CSS, React TSX, and .flop v2 validation', () => {
    const project = createInitialProject();
    const page = getActivePage(project);
    const baseEllipse: DesignNode = {
      ...createEllipseNode(0),
      id: 'mask-base',
      name: 'Mask Base',
      x: 100,
      y: 100,
      width: 160,
      height: 160,
      drawMode: 'outside',
      style: {
        ...createEllipseNode(0).style,
        fill: 'rgba(0, 229, 255, 0.5)',
        stroke: '#00E5FF',
        strokeWidth: 3,
        strokeAlign: 'outside',
        strokeDasharray: '8 5',
      },
    };
    const insideChild: DesignNode = {
      ...createRectNode(0),
      id: 'inside-child',
      name: 'Inside Overlay',
      x: 120,
      y: 120,
      width: 120,
      height: 120,
      clipMaskBaseId: 'mask-base',
      clipMaskMode: 'inside',
    };
    const outsideChild: DesignNode = {
      ...createRectNode(1),
      id: 'outside-child',
      name: 'Outside Overlay',
      x: 80,
      y: 80,
      width: 200,
      height: 200,
      clipMaskBaseId: 'mask-base',
      clipMaskMode: 'outside',
    };
    const textNode: TextNode = {
      ...createTextNode(0),
      id: 'aligned-text',
      name: 'Aligned Text',
      x: 40,
      y: 300,
      width: 300,
      height: 120,
      text: 'Hello Folio Studio',
      style: {
        ...createTextNode(0).style,
        textAlign: 'justify',
        verticalAlign: 'middle',
      },
    };

    page.document.nodes = [baseEllipse, insideChild, outsideChild, textNode];

    // .flop JSON v2 round-trip validation
    const validated = validateProject(JSON.parse(JSON.stringify(project)));
    expect(validated.ok).toBe(true);

    // HTML/CSS compilation
    const compiled = compilePageHtmlCss(project, page);
    expect(compiled.pageCssContent).toContain('clip-path: ellipse(');
    expect(compiled.pageCssContent).toContain('mask: url(#folio-mask-');
    expect(compiled.pageCssContent).toContain('outline: 3px dashed #00E5FF;');
    expect(compiled.pageCssContent).toContain('text-align: justify;');
    expect(compiled.pageCssContent).toContain('justify-content: center;');
    expect(compiled.htmlFile.content).toContain('<mask id="folio-mask-');
    expect(compiled.htmlFile.content).toContain('fill="#ffffff"');
    expect(compiled.htmlFile.content).toContain('fill="#000000"');

    // React TSX compilation
    const reactFiles = compileReactProjectFiles(project, page.id);
    const pageTsx = reactFiles.find((file) => file.path.startsWith('src/pages/'));
    expect(pageTsx?.content).toContain('<mask id="folio-mask-');
  });
});

describe('Part B — Styling Helpers & Zero-Typing Accordion Inspector', () => {
  it('parses and formats rgba/transparent colors, shadow presets, and text vertical offset', () => {
    expect(isTransparentColor('transparent')).toBe(true);
    expect(isTransparentColor('none')).toBe(true);
    expect(isTransparentColor('rgba(0, 229, 255, 0)')).toBe(true);
    expect(isTransparentColor('#00E5FF')).toBe(false);

    const parsed = parseColorWithAlpha('rgba(0, 229, 255, 0.5)');
    expect(parsed.hex).toBe('#00E5FF');
    expect(parsed.alpha).toBeCloseTo(0.5, 2);
    expect(formatColorWithAlpha('#00E5FF', 0.5)).toBe('rgba(0, 229, 255, 0.5)');
    expect(formatColorWithAlpha('#00E5FF', 0)).toBe('transparent');
    expect(formatColorWithAlpha('#00E5FF', 1)).toBe('#00E5FF');

    const neonEffects = applyShadowPresetToEffects([], 'neon-glow');
    expect(detectShadowPreset(neonEffects)).toBe('neon-glow');
    expect(detectShadowPreset(applyShadowPresetToEffects(neonEffects, 'none'))).toBe('none');

    expect(computeTextVerticalOffset(100, 1, 20, 1.5, 'top')).toBe(0);
    expect(computeTextVerticalOffset(100, 1, 20, 1.5, 'middle')).toBe(35);
    expect(computeTextVerticalOffset(100, 1, 20, 1.5, 'bottom')).toBe(70);
  });

  it('enforces Zero-Typing contract (zero number inputs, zero textarea, single Name text input) and hook-free InspectorPanel root', () => {
    // Source-level guarantee across all three right-sidebar inspector modules
    for (const src of [inspectorPanelSource, inspectorAccordionSource, inspectorZeroTypingSource]) {
      expect(src).not.toMatch(/type=["']number["']/);
      expect(src).not.toContain('<textarea');
    }

    // Only one type="text" input exists (the Layer / Component Name input)
    const textInputMatches = inspectorPanelSource.match(/type=["']text["']/g) ?? [];
    expect(textInputMatches).toHaveLength(1);

    // Root InspectorPanel remains hook-free when called directly as a plain JS function
    const props: InspectorPanelProps = {
      visible: true,
      width: 292,
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
      onUpdateInstanceOverride: vi.fn(),
      onUpdateInstanceVariant: vi.fn(),
      onUpdateInstanceSlot: vi.fn(),
      onUpdateMasterContract: vi.fn(),
      onResetInstanceOverrides: vi.fn(),
      onDetachInstance: vi.fn(),
      onConvertToPath: vi.fn(),
      onTogglePathClosed: vi.fn(),
      onSimplifyPath: vi.fn(),
      onChooseTool: vi.fn(),
      onQuickAdd: vi.fn(),
      onDuplicateSelection: vi.fn(),
      onCopySelection: vi.fn(),
    };

    const tree = InspectorPanel(props);
    expect(tree).toBeTruthy();
  });
});
