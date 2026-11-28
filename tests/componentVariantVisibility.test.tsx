import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';

vi.mock('preact/hooks', () => ({
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    vi.fn(),
  ],
  useEffect: vi.fn(),
  useMemo: <T,>(fn: () => T) => fn(),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useRef: <T,>(initial: T) => ({ current: initial }),
}));

import {
  InspectorComponentContractSection,
  getEffectiveVariantOptionLayerVisibility,
  updateVariantOptionLayerVisibility,
} from '../src/app/workspace/InspectorComponentContractSection';
import {
  createComponentInstance,
  createComponentVariantAxis,
  resolveComponentInstanceNodes,
} from '../src/core/document/components';
import {
  createEllipseNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  FolioProject,
  GroupNode,
  ImageNode,
  PathNode,
} from '../src/core/document/types';
import { validateProject } from '../src/core/document/validation';
import { createEditorState } from '../src/app/editorReducer';
import { createCanonicalEditorStore } from '../src/app/editorStore';
import { createMainCanvasCommandClient } from '../src/app/mainCanvasCommandClient';
import { MaskedNodeArtwork } from '../src/engines/canvas/artwork';
import { hasActiveVariantOverrides } from '../src/engines/canvas/transformUtils';
import { compileFolioProject } from '../src/engines/codegen';
import {
  buildLivePreviewLogicScript,
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createPrototypeRuntime,
} from '../src/engines/prototype';

type AnyVNode = VNode<Record<string, unknown>>;

function isVNode(value: unknown): value is AnyVNode {
  return Boolean(value && typeof value === 'object' && 'type' in (value as Record<string, unknown>) && 'props' in (value as Record<string, unknown>));
}

function expandVNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expandVNode);
  if (!isVNode(node)) return node;
  if (typeof node.type === 'function') {
    const rendered = (node.type as (props: Record<string, unknown>) => unknown)(node.props ?? {});
    return expandVNode(rendered);
  }
  const props = node.props ?? {};
  const nextChildren = props.children !== undefined ? expandVNode(props.children) : undefined;
  return {
    ...node,
    props: {
      ...props,
      ...(nextChildren !== undefined ? { children: nextChildren } : {}),
    },
  };
}

function findVNodes(root: unknown, predicate: (node: AnyVNode) => boolean, out: AnyVNode[] = []): AnyVNode[] {
  if (!root) return out;
  if (Array.isArray(root)) {
    for (const item of root) findVNodes(item, predicate, out);
    return out;
  }
  if (!isVNode(root)) return out;
  if (predicate(root)) out.push(root);
  const children = root.props?.children;
  if (children !== undefined) findVNodes(children, predicate, out);
  return out;
}

function getVNodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getVNodeText).join('');
  if (isVNode(node)) return getVNodeText(node.props?.children);
  return '';
}

function buildRichMasterComponent(): {
  component: ComponentDefinition;
  nestedChildComponent: ComponentDefinition;
  ids: {
    bg: string;
    ellipse: string;
    path: string;
    group: string;
    groupChildText: string;
    image: string;
    nestedInst: string;
  };
} {
  const now = '2026-11-28T00:00:00.000Z';
  const nestedRect: DesignNode = {
    ...createRectNode(0),
    id: 'nested-dot',
    name: 'Nested Dot',
    x: 0,
    y: 0,
    width: 16,
    height: 16,
    style: { fill: '#10B981', stroke: 'none', strokeWidth: 0, radius: 8 },
  };
  const nestedChildComponent: ComponentDefinition = {
    id: 'comp-nested-badge',
    name: 'StatusBadge',
    document: {
      id: 'doc-nested-badge',
      name: 'StatusBadge',
      width: 16,
      height: 16,
      background: '#00000000',
      nodes: [nestedRect],
    },
    createdAt: now,
    updatedAt: now,
  };

  const bg: DesignNode = {
    ...createRectNode(0),
    id: 'layer-bg',
    name: 'Card BG',
    x: 0,
    y: 0,
    width: 240,
    height: 120,
    style: { fill: '#1E293B', stroke: '#334155', strokeWidth: 2, radius: 12 },
  };
  const ellipse: DesignNode = {
    ...createEllipseNode(1),
    id: 'layer-ellipse',
    name: 'Sun Orb',
    x: 16,
    y: 16,
    width: 36,
    height: 36,
    style: { fill: '#F59E0B', stroke: '#FDE68A', strokeWidth: 2 },
  };
  const path: PathNode = {
    id: 'layer-path',
    type: 'path',
    name: 'Check Mark',
    x: 64,
    y: 20,
    width: 32,
    height: 28,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    closed: false,
    points: [
      { id: 'pt-1', x: 0, y: 14, pointType: 'corner' },
      { id: 'pt-2', x: 12, y: 26, pointType: 'corner' },
      { id: 'pt-3', x: 32, y: 2, pointType: 'corner' },
    ],
    style: { fill: 'none', stroke: '#38BDF8', strokeWidth: 3 },
  };
  const group: GroupNode = {
    id: 'layer-group',
    type: 'group',
    name: 'Meta Group',
    x: 16,
    y: 68,
    width: 180,
    height: 32,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const baseText = createTextNode(3);
  const groupChildText: DesignNode = {
    ...baseText,
    id: 'layer-group-text',
    parentId: group.id,
    name: 'Caption',
    x: 16,
    y: 72,
    width: 160,
    height: 24,
    text: 'Active status',
    style: { ...baseText.style, fontSize: 14 },
  };
  const image: ImageNode = {
    id: 'layer-image',
    type: 'image',
    name: 'Thumbnail',
    x: 184,
    y: 16,
    width: 40,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    assetId: 'asset-thumb',
    naturalWidth: 40,
    naturalHeight: 40,
    style: { fit: 'cover', radius: 6, stroke: '#475569', strokeWidth: 1 },
  };
  const nestedInst: ComponentInstanceNode = {
    ...createComponentInstance(nestedChildComponent, 208, 84, 'layer-nested-inst'),
    name: 'Online Dot',
  };

  const stateAxis = createComponentVariantAxis('State', {
    id: 'axis-state',
    optionLabels: ['Default', 'Compact'],
  });
  // Pre-existing fill, stroke, and text overrides must be preserved when toggling visibility
  stateAxis.options[1].overrides['layer-bg'] = {
    fill: '#0F172A',
    stroke: '#38BDF8',
  };
  stateAxis.options[1].overrides['layer-group-text'] = {
    text: 'Compact status',
  };
  stateAxis.options[1].overrides['layer-ellipse'] = {
    fill: '#EF4444',
    stroke: '#FCA5A5',
  };

  const component: ComponentDefinition = {
    id: 'comp-rich-card',
    name: 'RichCard',
    nodeLogicEnabled: true,
    variants: [stateAxis],
    document: {
      id: 'doc-rich-card',
      name: 'RichCard',
      width: 240,
      height: 120,
      background: '#00000000',
      nodes: [bg, ellipse, path, group, groupChildText, image, nestedInst],
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    component,
    nestedChildComponent,
    ids: {
      bg: bg.id,
      ellipse: ellipse.id,
      path: path.id,
      group: group.id,
      groupChildText: groupChildText.id,
      image: image.id,
      nestedInst: nestedInst.id,
    },
  };
}

function createPreviewDomHarness(
  script: string,
  nodeIds: readonly string[],
  options?: {
    initialDisplayById?: Record<string, string>;
    initialTextById?: Record<string, string>;
    initialAttrsById?: Record<string, Record<string, string>>;
  },
) {
  type Listener = (ev: Record<string, unknown>) => void;
  interface FakeElement {
    tagName: string;
    attrs: Record<string, string>;
    style: Record<string, string>;
    textContent: string;
    listeners: Record<string, Listener[]>;
    childSvgPath?: { attrs: Record<string, string>; setAttribute: (k: string, v: string) => void };
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, val: string) => void;
    removeAttribute: (name: string) => void;
    addEventListener: (event: string, fn: Listener) => void;
    querySelector: (sel: string) => FakeElement['childSvgPath'] | null;
    classList: {
      add: () => void;
      remove: () => void;
    };
  }

  const elements = new Map<string, FakeElement>();
  for (const id of nodeIds) {
    const attrs: Record<string, string> = {
      'data-folio-id': id,
      ...(options?.initialAttrsById?.[id] ?? {}),
    };
    const svgPath = {
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        this.attrs[k] = String(v);
      },
    };
    elements.set(id, {
      tagName: 'DIV',
      attrs,
      style: {
        display: options?.initialDisplayById?.[id] ?? 'block',
      },
      textContent: options?.initialTextById?.[id] ?? '',
      listeners: {},
      childSvgPath: svgPath,
      getAttribute(name: string) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
      },
      setAttribute(name: string, val: string) {
        this.attrs[name] = String(val);
      },
      removeAttribute(name: string) {
        delete this.attrs[name];
      },
      addEventListener(event: string, fn: Listener) {
        this.listeners[event] = this.listeners[event] ?? [];
        this.listeners[event].push(fn);
      },
      querySelector(sel: string) {
        return sel === 'path' ? this.childSvgPath ?? null : null;
      },
      classList: { add: () => {}, remove: () => {} },
    });
  }

  const doc = {
    readyState: 'complete',
    documentElement: {
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        this.attrs[k] = String(v);
      },
      removeAttribute(k: string) {
        delete this.attrs[k];
      },
    },
    body: {
      appendChild: () => {},
    },
    addEventListener: () => {},
    querySelectorAll(selector: string) {
      if (selector === '[data-folio-id]') return Array.from(elements.values());
      return [];
    },
    getElementById: () => null,
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      remove: () => {},
    }),
  };

  const win = {
    location: { origin: 'http://localhost:3000', search: '', pathname: '/' },
    addEventListener: () => {},
    dispatchEvent: () => {},
  };

  const fn = new Function('document', 'window', script);
  fn(doc, win);

  return {
    elements,
    click(id: string) {
      const el = elements.get(id);
      for (const listener of el?.listeners.click ?? []) {
        listener({ target: el, currentTarget: el, preventDefault: () => {} });
      }
    },
    getAttr(id: string, name: string) {
      return elements.get(id)?.getAttribute(name) ?? null;
    },
    getDisplay(id: string) {
      return elements.get(id)?.style.display ?? '';
    },
  };
}

describe('Component Variant Editor — Per-Layer Visibility Overrides & Set Variant Parity', () => {
  it('renders all master layers (rect, ellipse, path, group, text, image, nested instance) with Visible/Hidden controls on every Variant Option and saves via opt.overrides[targetNodeId].visible without overwriting fill/stroke/text', () => {
    const { component, ids } = buildRichMasterComponent();
    const axis = component.variants![0];
    const defaultOpt = axis.options[0];
    const compactOpt = axis.options[1];

    const onUpdateMasterContract = vi.fn();

    const vnode = InspectorComponentContractSection({
      instanceNode: null,
      instanceComponent: null,
      editingMasterComponent: component,
      onUpdateInstanceVariant: vi.fn(),
      onUpdateInstanceSlot: vi.fn(),
      onUpdateMasterContract,
    });
    const tree = expandVNode(vnode);

    // Every Variant Option must render all 7 master layers with visibility controls
    for (const opt of axis.options) {
      for (const layerId of Object.values(ids)) {
        const rows = findVNodes(
          tree,
          (n) =>
            n.type === 'div' &&
            n.props['data-variant-axis-id'] === axis.id &&
            n.props['data-variant-option-id'] === opt.id &&
            n.props['data-layer-id'] === layerId,
        );
        expect(rows).toHaveLength(1);
        const toggleButtons = findVNodes(rows[0], (n) => n.type === 'button');
        expect(toggleButtons).toHaveLength(1);
        expect(getVNodeText(toggleButtons[0])).toBe('Visible');
        expect(toggleButtons[0].props['aria-pressed']).toBe(true);
      }
    }

    // Click the visibility toggle for `layer-ellipse` in Compact option
    const compactEllipseRow = findVNodes(
      tree,
      (n) =>
        n.type === 'div' &&
        n.props['data-variant-option-id'] === compactOpt.id &&
        n.props['data-layer-id'] === ids.ellipse,
    )[0];
    const compactEllipseBtn = findVNodes(compactEllipseRow, (n) => n.type === 'button')[0];
    (compactEllipseBtn.props.onClick as () => void)();

    expect(onUpdateMasterContract).toHaveBeenCalledTimes(1);
    const [calledComp, patch] = onUpdateMasterContract.mock.calls[0];
    expect(calledComp.id).toBe(component.id);
    const updatedAxis = patch.variants[0];
    const updatedCompact = updatedAxis.options.find((o: { id: string }) => o.id === compactOpt.id);

    // Saved at opt.overrides[targetNodeId].visible WITHOUT overwriting fill/stroke
    expect(updatedCompact.overrides[ids.ellipse]).toEqual({
      fill: '#EF4444',
      stroke: '#FCA5A5',
      visible: false,
    });
    // Unrelated overrides on other layers remain intact
    expect(updatedCompact.overrides[ids.bg]).toEqual({
      fill: '#0F172A',
      stroke: '#38BDF8',
    });
    expect(updatedCompact.overrides[ids.groupChildText]).toEqual({
      text: 'Compact status',
    });
    // Default option remains untouched
    const updatedDefault = updatedAxis.options.find((o: { id: string }) => o.id === defaultOpt.id);
    expect(updatedDefault.overrides).toEqual({});

    // Re-rendering with the updated component reflects "Hidden" for Compact -> Sun Orb
    const updatedComponent: ComponentDefinition = { ...component, variants: patch.variants };
    const reRendered = expandVNode(
      InspectorComponentContractSection({
        instanceNode: null,
        instanceComponent: null,
        editingMasterComponent: updatedComponent,
        onUpdateInstanceVariant: vi.fn(),
        onUpdateInstanceSlot: vi.fn(),
        onUpdateMasterContract,
      }),
    );
    const hiddenRow = findVNodes(
      reRendered,
      (n) =>
        n.type === 'div' &&
        n.props['data-variant-option-id'] === compactOpt.id &&
        n.props['data-layer-id'] === ids.ellipse,
    )[0];
    const hiddenBtn = findVNodes(hiddenRow, (n) => n.type === 'button')[0];
    expect(getVNodeText(hiddenBtn)).toBe('Hidden');
    expect(hiddenBtn.props['aria-pressed']).toBe(false);
  });

  it('preserves existing fill, stroke, and text overrides when toggling visible across ellipse, path, group, image, text, and nested instance, and passes Native Command Engine & validateProject', () => {
    const { component, nestedChildComponent, ids } = buildRichMasterComponent();
    const axis = component.variants![0];
    const compactId = axis.options[1].id;

    let variants = component.variants!;
    variants = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.ellipse, false);
    variants = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.path, false);
    variants = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.group, false);
    variants = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.image, false);
    variants = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.nestedInst, false);
    variants = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.groupChildText, false);

    const compactOpt = variants[0].options[1];
    expect(compactOpt.overrides[ids.ellipse]).toEqual({ fill: '#EF4444', stroke: '#FCA5A5', visible: false });
    expect(compactOpt.overrides[ids.path]).toEqual({ visible: false });
    expect(compactOpt.overrides[ids.group]).toEqual({ visible: false });
    expect(compactOpt.overrides[ids.image]).toEqual({ visible: false });
    expect(compactOpt.overrides[ids.nestedInst]).toEqual({ visible: false });
    expect(compactOpt.overrides[ids.groupChildText]).toEqual({ text: 'Compact status', visible: false });
    expect(compactOpt.overrides[ids.bg]).toEqual({ fill: '#0F172A', stroke: '#38BDF8' });

    // Toggling back to true preserves all other properties
    const toggledBack = updateVariantOptionLayerVisibility(variants, axis.id, compactId, ids.ellipse, true);
    expect(toggledBack[0].options[1].overrides[ids.ellipse]).toEqual({
      fill: '#EF4444',
      stroke: '#FCA5A5',
      visible: true,
    });
    expect(
      getEffectiveVariantOptionLayerVisibility(toggledBack[0].options[1], { id: ids.ellipse, visible: false }),
    ).toBe(true);

    // Commit via Native Command Engine and validate project integrity + Undo/Redo
    const project = createInitialProject('Variant Visibility Contract');
    project.assets = [
      {
        id: 'asset-thumb',
        name: 'thumb.png',
        kind: 'image',
        mimeType: 'image/png',
        source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        byteLength: 68,
        width: 40,
        height: 40,
        createdAt: '2026-11-28T00:00:00.000Z',
      },
    ];
    project.components = [nestedChildComponent, component];
    const instance = createComponentInstance(component, 20, 20, 'inst-card');
    getActivePage(project).document.nodes = [instance];

    const store = createCanonicalEditorStore(createEditorState(project), { workspace: 'main' });
    const client = createMainCanvasCommandClient(store);

    const liveMaster = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    const res = client.updateComponentContract({
      componentId: liveMaster.id,
      variants,
      expectedUpdatedAt: liveMaster.updatedAt,
      expectedMasterDocument: liveMaster.document,
    });
    expect(res.status).toBe('applied');
    expect(validateProject(store.getSnapshot().editorState.project).ok).toBe(true);

    // Resolve instance under Compact variant vs Default variant
    const updatedMaster = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    const defaultResolved = resolveComponentInstanceNodes(instance, updatedMaster);
    const compactResolved = resolveComponentInstanceNodes(
      { ...instance, variantSelection: { [axis.id]: compactId } },
      updatedMaster,
    );

    expect(defaultResolved.find((n) => n.id === ids.ellipse)?.visible).toBe(true);
    expect(defaultResolved.find((n) => n.id === ids.path)?.visible).toBe(true);
    expect(defaultResolved.find((n) => n.id === ids.group)?.visible).toBe(true);
    expect(defaultResolved.find((n) => n.id === ids.image)?.visible).toBe(true);
    expect(defaultResolved.find((n) => n.id === ids.nestedInst)?.visible).toBe(true);

    expect(compactResolved.find((n) => n.id === ids.ellipse)?.visible).toBe(false);
    expect(compactResolved.find((n) => n.id === ids.path)?.visible).toBe(false);
    expect(compactResolved.find((n) => n.id === ids.group)?.visible).toBe(false);
    expect(compactResolved.find((n) => n.id === ids.image)?.visible).toBe(false);
    expect(compactResolved.find((n) => n.id === ids.nestedInst)?.visible).toBe(false);
    const compactBg = compactResolved.find((n) => n.id === ids.bg);
    expect(compactBg?.type === 'rect' ? compactBg.style.fill : null).toBe('#0F172A');
    expect(compactBg?.type === 'rect' ? compactBg.style.stroke : null).toBe('#38BDF8');

    // Undo restores previous contract cleanly
    expect(client.undo().status).toBe('applied');
    const undoneMaster = store.getSnapshot().editorState.project.components.find((c) => c.id === component.id)!;
    expect(undoneMaster.variants![0].options[1].overrides[ids.ellipse]?.visible).toBeUndefined();
  });

  it('updates instance appearance via Node Logic Set Variant across Headless Runtime, Studio Canvas renderer, Live Preview, and React CSS export', () => {
    const { component: baseComponent, nestedChildComponent, ids } = buildRichMasterComponent();
    const axis = baseComponent.variants![0];
    const defaultOptId = axis.options[0].id;
    const compactOptId = axis.options[1].id;

    // Configure Compact variant to hide ellipse, path, group (with caption child), and image while preserving bg fill/stroke
    let nextVariants = baseComponent.variants!;
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, compactOptId, ids.ellipse, false);
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, compactOptId, ids.path, false);
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, compactOptId, ids.group, false);
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, compactOptId, ids.image, false);
    // Explicitly show them in Default variant
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, defaultOptId, ids.ellipse, true);
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, defaultOptId, ids.path, true);
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, defaultOptId, ids.group, true);
    nextVariants = updateVariantOptionLayerVisibility(nextVariants, axis.id, defaultOptId, ids.image, true);

    const component: ComponentDefinition = {
      ...baseComponent,
      variants: nextVariants,
    };

    const baseProject = createInitialProject('Set Variant Visibility Parity');
    const page = getActivePage(baseProject);
    const instance = createComponentInstance(component, 40, 40, 'inst-rich');
    const triggerCompact = {
      ...createRectNode(10),
      id: 'btn-compact',
      name: 'Set Compact',
      x: 40,
      y: 200,
      width: 120,
      height: 36,
    };
    const triggerDefault = {
      ...createRectNode(11),
      id: 'btn-default',
      name: 'Set Default',
      x: 180,
      y: 200,
      width: 120,
      height: 36,
    };

    const evCompact = createLogicNode({ id: 'ev-compact', type: 'event.on-click', data: { targetNodeId: triggerCompact.id } });
    const actCompact = createLogicNode({
      id: 'act-compact',
      type: 'action.set-variant',
      data: { targetMode: 'override', targetNodeId: instance.id, axisId: axis.id, optionId: compactOptId },
    });
    const evDefault = createLogicNode({ id: 'ev-default', type: 'event.on-click', data: { targetNodeId: triggerDefault.id } });
    const actDefault = createLogicNode({
      id: 'act-default',
      type: 'action.set-variant',
      data: { targetMode: 'override', targetNodeId: instance.id, axisId: axis.id, optionId: defaultOptId },
    });

    const graph = createLogicGraph({
      id: 'graph-variant-vis',
      name: 'Variant Visibility Switch',
      scope: 'page',
      targetId: page.id,
      nodes: [evCompact, actCompact, evDefault, actDefault],
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: evCompact.id, sourcePortId: 'exec', targetNodeId: actCompact.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: evDefault.id, sourcePortId: 'exec', targetNodeId: actDefault.id, targetPortId: 'exec' }),
      ],
    });

    const project: FolioProject = {
      ...baseProject,
      assets: [
        {
          id: 'asset-thumb',
          name: 'thumb.png',
          kind: 'image',
          mimeType: 'image/png',
          source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          byteLength: 68,
          width: 40,
          height: 40,
          createdAt: '2026-11-28T00:00:00.000Z',
        },
      ],
      components: [nestedChildComponent, component],
      pages: baseProject.pages.map((p) =>
        p.id === page.id
          ? { ...p, document: { ...p.document, nodes: [instance, triggerCompact, triggerDefault] } }
          : p,
      ),
      logicGraphs: [graph],
    };

    expect(validateProject(project).ok).toBe(true);

    // 1. Headless Runtime + Studio Canvas SVG Renderer (`MaskedNodeArtwork`)
    const rt = createPrototypeRuntime(project);
    const snapCompact = rt.dispatchNodeEvent(triggerCompact.id, 'click');
    expect(snapCompact.nodeOverrides[instance.id]?.variantSelection?.[axis.id]).toBe(compactOptId);
    expect(hasActiveVariantOverrides(snapCompact.nodeOverrides)).toBe(true);

    const renderInstanceOnCanvas = (overrides: typeof snapCompact.nodeOverrides | undefined) =>
      expandVNode(
        MaskedNodeArtwork({
          node: instance,
          nodes: [instance],
          components: project.components,
          assets: project.assets,
          maskPrefix: 'test-canvas',
          emitNodeId: true,
          nodeOverrides: overrides,
        }),
      );

    // Before Set Variant: ellipse, path, text (inside group), and image are all rendered in SVG
    const canvasDefault = renderInstanceOnCanvas(undefined);
    expect(findVNodes(canvasDefault, (n) => n.type === 'ellipse').length).toBe(1);
    expect(findVNodes(canvasDefault, (n) => n.type === 'path').length).toBeGreaterThanOrEqual(1);
    expect(findVNodes(canvasDefault, (n) => n.type === 'image').length).toBe(1);
    expect(getVNodeText(canvasDefault)).toContain('Active status');

    // After Set Variant -> Compact: hidden ellipse, path, group (+ its caption text), and image are omitted from Studio Canvas SVG!
    const canvasCompact = renderInstanceOnCanvas(snapCompact.nodeOverrides);
    expect(findVNodes(canvasCompact, (n) => n.type === 'ellipse').length).toBe(0);
    expect(findVNodes(canvasCompact, (n) => n.type === 'path').length).toBe(0);
    expect(findVNodes(canvasCompact, (n) => n.type === 'image').length).toBe(0);
    expect(getVNodeText(canvasCompact)).not.toContain('Active status');
    expect(getVNodeText(canvasCompact)).not.toContain('Compact status');
    // Card BG still renders with Compact fill (#0F172A) and stroke (#38BDF8)
    const compactBgRects = findVNodes(
      canvasCompact,
      (n) => n.type === 'rect' && n.props.fill === '#0F172A' && n.props.stroke === '#38BDF8',
    );
    expect(compactBgRects.length).toBeGreaterThanOrEqual(1);

    // After Set Variant -> Default: all layers become visible again on Studio Canvas!
    const snapDefault = rt.dispatchNodeEvent(triggerDefault.id, 'click');
    const canvasRestored = renderInstanceOnCanvas(snapDefault.nodeOverrides);
    expect(findVNodes(canvasRestored, (n) => n.type === 'ellipse').length).toBe(1);
    expect(findVNodes(canvasRestored, (n) => n.type === 'path').length).toBeGreaterThanOrEqual(1);
    expect(findVNodes(canvasRestored, (n) => n.type === 'image').length).toBe(1);
    expect(getVNodeText(canvasRestored)).toContain('Active status');

    // 2. Live Preview Micro-Runtime
    const activePage = getActivePage(project);
    const previewScript = buildLivePreviewLogicScript(project, activePage)!;
    const scopedIds = [
      instance.id,
      triggerCompact.id,
      triggerDefault.id,
      `${instance.id}__${ids.bg}`,
      `${instance.id}__${ids.ellipse}`,
      `${instance.id}__${ids.path}`,
      `${instance.id}__${ids.group}`,
      `${instance.id}__${ids.groupChildText}`,
      `${instance.id}__${ids.image}`,
      `${instance.id}__${ids.nestedInst}`,
    ];
    const preview = createPreviewDomHarness(previewScript, scopedIds, {
      initialTextById: { [`${instance.id}__${ids.groupChildText}`]: 'Active status' },
      initialAttrsById: { [instance.id]: { 'data-variant-state': 'Default' } },
    });

    preview.click(triggerCompact.id);
    expect(preview.getAttr(instance.id, 'data-variant-state')).toBe('Compact');
    expect(preview.getDisplay(`${instance.id}__${ids.ellipse}`)).toBe('none');
    expect(preview.getDisplay(`${instance.id}__${ids.path}`)).toBe('none');
    expect(preview.getDisplay(`${instance.id}__${ids.group}`)).toBe('none');
    expect(preview.getDisplay(`${instance.id}__${ids.image}`)).toBe('none');
    expect(preview.elements.get(`${instance.id}__${ids.bg}`)?.style.background).toBe('#0F172A');
    expect(preview.elements.get(`${instance.id}__${ids.bg}`)?.style.borderColor).toBe('#38BDF8');

    preview.click(triggerDefault.id);
    expect(preview.getAttr(instance.id, 'data-variant-state')).toBe('Default');
    expect(preview.getDisplay(`${instance.id}__${ids.ellipse}`)).toBe('block');
    expect(preview.getDisplay(`${instance.id}__${ids.path}`)).toBe('block');
    expect(preview.getDisplay(`${instance.id}__${ids.group}`)).toBe('block');
    expect(preview.getDisplay(`${instance.id}__${ids.image}`)).toBe('block');
    expect(preview.elements.get(`${instance.id}__${ids.bg}`)?.style.background).toBe('#1E293B');
    expect(preview.elements.get(`${instance.id}__${ids.bg}`)?.style.borderColor).toBe('#334155');

    // 3. React Codegen CSS rules contain both display: none (Compact) and display: block (Default)
    const reactCompiled = compileFolioProject(project, { target: 'react' });
    const compCss = reactCompiled.files.find((f) => f.path === 'src/components/RichCard.css')?.content ?? '';
    expect(compCss).toContain('[data-variant-state="Compact"]');
    expect(compCss).toContain('display: none;');
    expect(compCss).toContain('[data-variant-state="Default"]');
    expect(compCss).toContain('display: block;');
  });

  it('maintains full backward compatibility with legacy components that have variants without explicit visible overrides', () => {
    const bg = { ...createRectNode(0), id: 'leg-bg', name: 'BG', x: 0, y: 0, width: 100, height: 40 };
    const axis = createComponentVariantAxis('Tone', { id: 'axis-tone', optionLabels: ['Primary', 'Ghost'] });
    axis.options[1].overrides['leg-bg'] = { fill: 'transparent' };
    const legacyComp: ComponentDefinition = {
      id: 'comp-legacy',
      name: 'LegacyBtn',
      variants: [axis],
      document: {
        id: 'doc-legacy',
        name: 'LegacyBtn',
        width: 100,
        height: 40,
        background: '#00000000',
        nodes: [bg],
      },
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    const inst = createComponentInstance(legacyComp, 0, 0, 'inst-legacy');
    const resolvedGhost = resolveComponentInstanceNodes(
      { ...inst, variantSelection: { 'axis-tone': axis.options[1].id } },
      legacyComp,
    );
    expect(resolvedGhost[0].visible).toBe(true);
    expect(resolvedGhost[0].type === 'rect' ? resolvedGhost[0].style.fill : null).toBe('transparent');
    expect(getEffectiveVariantOptionLayerVisibility(axis.options[1], bg)).toBe(true);
  });

  it('keeps multi-axis visibility and style overrides consistent when switching one axis at a time via Set Variant', () => {
    const { component: baseComponent, nestedChildComponent, ids } = buildRichMasterComponent();
    const stateAxis = baseComponent.variants![0];
    const compactOptId = stateAxis.options[1].id;

    const iconAxis = createComponentVariantAxis('Icon', {
      id: 'axis-icon',
      optionLabels: ['Shown', 'Hidden'],
    });
    const iconShownId = iconAxis.options[0].id;
    const iconHiddenId = iconAxis.options[1].id;

    let variants = [stateAxis, iconAxis];
    variants = updateVariantOptionLayerVisibility(variants, stateAxis.id, compactOptId, ids.image, false);
    variants = updateVariantOptionLayerVisibility(variants, iconAxis.id, iconHiddenId, ids.ellipse, false);
    variants = updateVariantOptionLayerVisibility(variants, iconAxis.id, iconShownId, ids.ellipse, true);

    const component: ComponentDefinition = {
      ...baseComponent,
      variants,
    };

    const baseProject = createInitialProject('Multi-Axis Variant Visibility');
    const page = getActivePage(baseProject);
    const instance = createComponentInstance(component, 20, 20, 'inst-multi');
    const btnCompact = { ...createRectNode(20), id: 'btn-multi-compact', name: 'Compact', x: 20, y: 180, width: 90, height: 32 };
    const btnHideIcon = { ...createRectNode(21), id: 'btn-multi-hide-icon', name: 'Hide Icon', x: 120, y: 180, width: 90, height: 32 };

    const ev1 = createLogicNode({ id: 'ev-m1', type: 'event.on-click', data: { targetNodeId: btnCompact.id } });
    const act1 = createLogicNode({
      id: 'act-m1',
      type: 'action.set-variant',
      data: { targetMode: 'override', targetNodeId: instance.id, axisId: stateAxis.id, optionId: compactOptId },
    });
    const ev2 = createLogicNode({ id: 'ev-m2', type: 'event.on-click', data: { targetNodeId: btnHideIcon.id } });
    const act2 = createLogicNode({
      id: 'act-m2',
      type: 'action.set-variant',
      data: { targetMode: 'override', targetNodeId: instance.id, axisId: iconAxis.id, optionId: iconHiddenId },
    });

    const graph = createLogicGraph({
      id: 'graph-multi-axis',
      name: 'Multi Axis Switch',
      scope: 'page',
      targetId: page.id,
      nodes: [ev1, act1, ev2, act2],
      connections: [
        createLogicConnection({ id: 'mc1', sourceNodeId: ev1.id, sourcePortId: 'exec', targetNodeId: act1.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'mc2', sourceNodeId: ev2.id, sourcePortId: 'exec', targetNodeId: act2.id, targetPortId: 'exec' }),
      ],
    });

    const project: FolioProject = {
      ...baseProject,
      assets: [
        {
          id: 'asset-thumb',
          name: 'thumb.png',
          kind: 'image',
          mimeType: 'image/png',
          source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          byteLength: 68,
          width: 40,
          height: 40,
          createdAt: '2026-11-28T00:00:00.000Z',
        },
      ],
      components: [nestedChildComponent, component],
      pages: baseProject.pages.map((p) =>
        p.id === page.id
          ? { ...p, document: { ...p.document, nodes: [instance, btnCompact, btnHideIcon] } }
          : p,
      ),
      logicGraphs: [graph],
    };

    expect(validateProject(project).ok).toBe(true);

    const activePage = getActivePage(project);
    const previewScript = buildLivePreviewLogicScript(project, activePage)!;
    const preview = createPreviewDomHarness(previewScript, [
      instance.id,
      btnCompact.id,
      btnHideIcon.id,
      `${instance.id}__${ids.bg}`,
      `${instance.id}__${ids.ellipse}`,
      `${instance.id}__${ids.image}`,
    ]);

    // Step 1: Switch State -> Compact (hides image, keeps ellipse visible, sets bg fill #0F172A)
    preview.click(btnCompact.id);
    expect(preview.getDisplay(`${instance.id}__${ids.image}`)).toBe('none');
    expect(preview.getDisplay(`${instance.id}__${ids.ellipse}`)).toBe('block');
    expect(preview.elements.get(`${instance.id}__${ids.bg}`)?.style.background).toBe('#0F172A');

    // Step 2: Switch Icon -> Hidden (must KEEP State=Compact overrides active while ALSO hiding ellipse!)
    preview.click(btnHideIcon.id);
    expect(preview.getDisplay(`${instance.id}__${ids.image}`)).toBe('none');
    expect(preview.getDisplay(`${instance.id}__${ids.ellipse}`)).toBe('none');
    expect(preview.elements.get(`${instance.id}__${ids.bg}`)?.style.background).toBe('#0F172A');
  });
});
