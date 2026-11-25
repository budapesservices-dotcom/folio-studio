import { expect } from 'vitest';
import ts from 'typescript';
import type { FolioProject } from '../../src/core/document/types';
import { compileReactProjectFiles } from '../../src/engines/codegen/reactCompiler';
import type { CompiledCodeFile } from '../../src/engines/codegen/types';

export interface MockDomElement {
  id: string;
  tagName: string;
  textContent: string;
  value: string;
  disabled: boolean;
  style: Record<string, string>;
  listeners: Record<string, Array<(ev: unknown) => void>>;
  attributes: Record<string, string>;
  addEventListener: (type: string, cb: (ev: unknown) => void) => void;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  contains: (other: unknown) => boolean;
  dispatch: (type: string, ev?: Record<string, unknown>) => void;
}

export interface MockToastElement {
  textContent: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  removed: boolean;
  setAttribute: (k: string, v: string) => void;
  remove: () => void;
}

export interface KeyEventMods {
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

export interface PreviewHarnessOptions {
  readonly initialTextById?: Readonly<Record<string, string>>;
  readonly initialValueById?: Readonly<Record<string, string>>;
  readonly initialDisplayById?: Readonly<Record<string, string>>;
  readonly tagNameById?: Readonly<Record<string, string>>;
  readonly initialAttrsById?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly fetchMock?: (url: string, init?: Record<string, unknown>) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>;
}

export function createPreviewDomHarness(
  script: string,
  ids: readonly string[],
  options: PreviewHarnessOptions = {},
) {
  const elements = new Map<string, MockDomElement>();
  for (const id of ids) {
    const initialDisplay = options.initialDisplayById?.[id];
    const el: MockDomElement = {
      id,
      tagName: options.tagNameById?.[id] ?? 'DIV',
      textContent: options.initialTextById?.[id] ?? '',
      value: options.initialValueById?.[id] ?? '',
      disabled: false,
      style: initialDisplay ? { display: initialDisplay } : {},
      listeners: {},
      attributes: { 'data-folio-id': id, ...(options.initialAttrsById?.[id] ?? {}) },
      addEventListener(type, cb) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(cb);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
          ? this.attributes[name]
          : null;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      contains(other) {
        return other === this;
      },
      dispatch(type, ev = {}) {
        for (const cb of this.listeners[type] ?? []) {
          cb({ target: this, currentTarget: this, preventDefault: () => {}, ...ev });
        }
      },
    };
    elements.set(id, el);
  }

  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const winListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const toasts: MockToastElement[] = [];
  const docElementAttrs: Record<string, string> = {};
  const docClassList = new Set<string>();
  const navigatedRoutes: string[] = [];

  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      offsetWidth: 1440,
      classList: {
        add: (cls: string) => docClassList.add(cls),
        remove: (cls: string) => docClassList.delete(cls),
        has: (cls: string) => docClassList.has(cls),
      },
      setAttribute: (k: string, v: string) => {
        docElementAttrs[k] = v;
        if (k === 'data-folio-route') navigatedRoutes.push(v);
      },
      removeAttribute: (k: string) => {
        delete docElementAttrs[k];
      },
      getAttribute: (k: string) => docElementAttrs[k] ?? null,
    },
    body: {
      appendChild: (node: MockToastElement) => {
        toasts.push(node);
      },
    },
    querySelector(selector: string) {
      const match = /\[data-folio-id="([^"]+)"\]/.exec(selector);
      if (match) return elements.get(match[1]) ?? null;
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === '[data-folio-id]') {
        return Array.from(elements.values());
      }
      return [];
    },
    createElement() {
      const toastEl: MockToastElement = {
        textContent: '',
        attributes: {},
        style: {},
        removed: false,
        setAttribute(k, v) {
          this.attributes[k] = v;
        },
        remove() {
          this.removed = true;
        },
      };
      return toastEl;
    },
    addEventListener(type: string, cb: (ev: unknown) => void) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(cb);
    },
  };

  const mockWindow = {
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
    location: { href: 'http://localhost/?tab=pricing', search: '?tab=pricing', pathname: '/' },
    history: { back: () => {}, forward: () => {}, replaceState: () => {} },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      if (!winListeners[type]) winListeners[type] = [];
      winListeners[type].push(cb);
    },
    removeEventListener: () => {},
    dispatchEvent: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const runner = new Function(
    'document',
    'window',
    'CSS',
    'URLSearchParams',
    'console',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    script,
  );
  runner(
    mockDocument,
    mockWindow,
    { escape: (s: string) => s },
    URLSearchParams,
    console,
    options.fetchMock ?? undefined,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  );

  return {
    elements,
    toasts,
    docElementAttrs,
    docClassList,
    navigatedRoutes,
    click(id: string) {
      elements.get(id)?.dispatch('click');
    },
    dblclick(id: string) {
      elements.get(id)?.dispatch('dblclick');
    },
    hoverEnter(id: string) {
      elements.get(id)?.dispatch('mouseenter');
    },
    hoverLeave(id: string) {
      elements.get(id)?.dispatch('mouseleave');
    },
    input(id: string, value: string) {
      const el = elements.get(id);
      if (!el) return;
      el.value = value;
      el.dispatch('input', { target: el, currentTarget: el });
    },
    focus(id: string) {
      elements.get(id)?.dispatch('focus');
    },
    blur(id: string) {
      elements.get(id)?.dispatch('blur');
    },
    dragStart(id: string, coords: { x?: number; y?: number } = {}) {
      elements.get(id)?.dispatch('pointerdown', { clientX: coords.x ?? 10, clientY: coords.y ?? 20 });
    },
    dragMove(id: string, coords: { x?: number; y?: number } = {}) {
      elements.get(id)?.dispatch('pointermove', { clientX: coords.x ?? 30, clientY: coords.y ?? 40 });
    },
    dragDrop(id: string, coords: { x?: number; y?: number } = {}) {
      elements.get(id)?.dispatch('pointerup', { clientX: coords.x ?? 50, clientY: coords.y ?? 60 });
    },
    clickOutside() {
      const outsideTarget = { id: '__outside__' };
      for (const cb of docListeners.click ?? []) {
        cb({ target: outsideTarget, currentTarget: mockDocument });
      }
    },
    keydown(key: string, mods: KeyEventMods = {}) {
      const ev = {
        key,
        ctrlKey: Boolean(mods.ctrlKey),
        shiftKey: Boolean(mods.shiftKey),
        altKey: Boolean(mods.altKey),
        metaKey: Boolean(mods.metaKey),
      };
      for (const cb of docListeners.keydown ?? []) {
        cb(ev);
      }
      for (const cb of winListeners.keydown ?? []) {
        cb(ev);
      }
    },
    keyup(key: string, mods: KeyEventMods = {}) {
      const ev = {
        key,
        ctrlKey: Boolean(mods.ctrlKey),
        shiftKey: Boolean(mods.shiftKey),
        altKey: Boolean(mods.altKey),
        metaKey: Boolean(mods.metaKey),
      };
      for (const cb of docListeners.keyup ?? []) {
        cb(ev);
      }
      for (const cb of winListeners.keyup ?? []) {
        cb(ev);
      }
    },
    getAttr(id: string, attr: string): string | null {
      return elements.get(id)?.getAttribute(attr) ?? null;
    },
  };
}

export interface RenderedVNode {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (RenderedVNode | string)[];
}

interface RawVNode {
  readonly type: string | ((props: Record<string, unknown>) => unknown);
  readonly props: Record<string, unknown>;
  readonly children: unknown[];
}

function isRawVNode(value: unknown): value is RawVNode {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value && 'children' in value;
}

function flattenChildren(raw: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      out.push(...flattenChildren(item));
    } else if (item !== null && item !== undefined && typeof item !== 'boolean') {
      out.push(item);
    }
  }
  return out;
}

function resolveVNode(node: unknown): RenderedVNode | string | null {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isRawVNode(node)) return null;

  if (typeof node.type === 'function') {
    const rendered = node.type({ ...node.props, children: node.children });
    return resolveVNode(rendered);
  }

  const children: Array<RenderedVNode | string> = [];
  for (const child of flattenChildren(node.children)) {
    const resolved = resolveVNode(child);
    if (resolved !== null) children.push(resolved);
  }
  return {
    type: node.type,
    props: node.props,
    children,
  };
}

function collectText(node: RenderedVNode | string): string {
  if (typeof node === 'string') return node;
  return node.children.map((child) => collectText(child)).join('');
}

function findNodeByPredicate(
  root: RenderedVNode | null,
  predicate: (node: RenderedVNode) => boolean,
): RenderedVNode | null {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children) {
    if (typeof child !== 'string') {
      const found = findNodeByPredicate(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function findAllNodesByPredicate(
  root: RenderedVNode | null,
  predicate: (node: RenderedVNode) => boolean,
  out: RenderedVNode[] = [],
): RenderedVNode[] {
  if (!root) return out;
  if (predicate(root)) out.push(root);
  for (const child of root.children) {
    if (typeof child !== 'string') {
      findAllNodesByPredicate(child, predicate, out);
    }
  }
  return out;
}

function resolveModulePath(fromPath: string, specifier: string): string {
  const fromParts = fromPath.split('/').slice(0, -1);
  const specParts = specifier.split('/');
  const combined = [...fromParts];
  for (const part of specParts) {
    if (part === '.' || part === '') continue;
    if (part === '..') combined.pop();
    else combined.push(part);
  }
  return combined.join('/');
}

/**
 * Compiles a project to React TSX, verifies zero TypeScript diagnostics across
 * all generated `.tsx` files, and executes the target page + its components
 * inside a zero-dependency React hooks mini-runtime so behavioral parity is
 * verified against real executed React TSX output.
 */
export function createReactTsxHarness(
  project: FolioProject,
  pageId: string,
  options: {
    readonly onNavigate?: (route: string) => void;
    readonly fetchMock?: PreviewHarnessOptions['fetchMock'];
  } = {},
) {
  const reactFiles: readonly CompiledCodeFile[] = compileReactProjectFiles(project);
  const tsxFiles = reactFiles.filter((f) => f.language === 'tsx');
  expect(tsxFiles.length).toBeGreaterThanOrEqual(2);

  const transpiledByPath = new Map<string, string>();
  for (const file of tsxFiles) {
    const strictCheck = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
      },
    });
    expect(strictCheck.diagnostics ?? [], `TSX diagnostics in ${file.path}`).toEqual([]);

    const cjs = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: false,
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    });
    const noExt = file.path.replace(/\.tsx$/, '');
    transpiledByPath.set(file.path, cjs.outputText);
    transpiledByPath.set(noExt, cjs.outputText);
  }

  // Mini React hooks runtime scoped to this page harness instance
  const hookStates: unknown[] = [];
  const hookRefs: Array<{ current: unknown }> = [];
  const pendingEffects: Array<{ cb: () => void | (() => void); ran: boolean }> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let stateDirty = false;

  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const winListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const docElementAttrs: Record<string, string> = {};
  const docClassList = new Set<string>();
  const navigatedRoutes: string[] = [];

  let currentTree: RenderedVNode | null = null;
  const mockDomCache = new Map<string, { id: string; getAttribute: (attr: string) => string | null; contains: (other: unknown) => boolean }>();

  const mockDocument = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
      offsetWidth: 1440,
      classList: {
        add: (cls: string) => docClassList.add(cls),
        remove: (cls: string) => docClassList.delete(cls),
        has: (cls: string) => docClassList.has(cls),
      },
      setAttribute: (k: string, v: string) => {
        docElementAttrs[k] = v;
        if (k === 'data-folio-route') navigatedRoutes.push(v);
      },
      removeAttribute: (k: string) => {
        delete docElementAttrs[k];
      },
      getAttribute: (k: string) => docElementAttrs[k] ?? null,
    },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push(cb);
    },
    removeEventListener: (type: string, cb: (ev: unknown) => void) => {
      if (!docListeners[type]) return;
      docListeners[type] = docListeners[type].filter((fn) => fn !== cb);
    },
    querySelector: (selector: string) => {
      const match = /\[data-folio-id="([^"]+)"\]/.exec(selector);
      if (!match) return null;
      const targetId = match[1];
      const found = findNodeByPredicate(currentTree, (node) => node.props['data-folio-id'] === targetId);
      if (!found) return null;
      let el = mockDomCache.get(targetId);
      if (!el) {
        el = {
          id: targetId,
          getAttribute(attr: string) {
            return attr === 'data-folio-id' ? targetId : null;
          },
          contains(other: unknown) {
            return other === this;
          },
        };
        mockDomCache.set(targetId, el);
      }
      return el;
    },
    querySelectorAll: (selector: string) => {
      if (selector !== '[data-folio-id]') return [];
      const collected: Array<{ id: string; getAttribute(attr: string): string | null; contains(other: unknown): boolean }> = [];
      const walk = (node: RenderedVNode | null) => {
        if (!node) return;
        const fid = node.props['data-folio-id'];
        if (typeof fid === 'string' && fid.length > 0) {
          let el = mockDomCache.get(fid);
          if (!el) {
            el = {
              id: fid,
              getAttribute(attr: string) {
                return attr === 'data-folio-id' ? fid : null;
              },
              contains(other: unknown) {
                return other === this;
              },
            };
            mockDomCache.set(fid, el);
          }
          collected.push(el);
        }
        for (const child of node.children) {
          if (typeof child !== 'string') walk(child);
        }
      };
      walk(currentTree);
      return collected;
    },
  };

  const mockWindow = {
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
    location: { href: 'http://localhost/?tab=pricing', search: '?tab=pricing', pathname: '/' },
    history: { back: () => {}, forward: () => {}, replaceState: () => {} },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      if (!winListeners[type]) winListeners[type] = [];
      winListeners[type].push(cb);
    },
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const ReactShim = {
    Fragment: 'fragment',
    createElement(
      type: string | ((props: Record<string, unknown>) => unknown),
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): RawVNode {
      return {
        type,
        props: props ?? {},
        children: flattenChildren(children),
      };
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = stateCursor++;
      if (idx >= hookStates.length) {
        hookStates[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = hookStates[idx] as T;
        hookStates[idx] = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        stateDirty = true;
      };
      return [hookStates[idx] as T, setState];
    },
    useRef<T>(initial: T): { current: T } {
      const idx = refCursor++;
      if (idx >= hookRefs.length) {
        hookRefs[idx] = { current: initial };
      }
      return hookRefs[idx] as { current: T };
    },
    useEffect(cb: () => void | (() => void)): void {
      const idx = effectCursor++;
      if (idx >= pendingEffects.length) {
        pendingEffects.push({ cb, ran: false });
      }
    },
  };

  const moduleCache = new Map<string, Record<string, unknown>>();

  const loadModule = (modulePath: string): Record<string, unknown> => {
    const cached = moduleCache.get(modulePath);
    if (cached) return cached;
    const code = transpiledByPath.get(modulePath);
    if (!code) {
      throw new Error(`React harness could not resolve module "${modulePath}"`);
    }
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    moduleCache.set(modulePath, mod.exports);

    const localRequire = (specifier: string): unknown => {
      if (specifier === 'react') {
        return { ...ReactShim, default: ReactShim };
      }
      if (specifier.endsWith('.css')) {
        return {};
      }
      const resolved = resolveModulePath(modulePath, specifier);
      return loadModule(resolved);
    };

    const fn = new Function(
      'exports',
      'require',
      'module',
      'window',
      'document',
      'fetch',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      code,
    );
    fn(
      mod.exports,
      localRequire,
      mod,
      mockWindow,
      mockDocument,
      options.fetchMock ?? undefined,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    );
    moduleCache.set(modulePath, mod.exports);
    return mod.exports;
  };

  const pageFile = reactFiles.find((f) => f.pageId === pageId);
  if (!pageFile) {
    throw new Error(`No compiled React page file found for pageId="${pageId}"`);
  }

  const pageExports = loadModule(pageFile.path);
  const PageComponent = Object.values(pageExports).find(
    (exp): exp is (props: Record<string, unknown>) => unknown => typeof exp === 'function',
  );
  if (!PageComponent) {
    throw new Error(`No exported React component found in ${pageFile.path}`);
  }

  const rerender = (): RenderedVNode | null => {
    stateCursor = 0;
    refCursor = 0;
    effectCursor = 0;
    stateDirty = false;
    const raw = PageComponent({
      onNavigate: (route: string) => {
        navigatedRoutes.push(route);
        options.onNavigate?.(route);
      },
    });
    const resolved = resolveVNode(raw);
    currentTree = typeof resolved === 'string' ? null : resolved;
    return currentTree;
  };

  const flushEffectsAndRender = () => {
    rerender();
    let guard = 0;
    while (guard < 8) {
      guard += 1;
      let ranAny = false;
      for (const eff of pendingEffects) {
        if (!eff.ran) {
          eff.ran = true;
          ranAny = true;
          eff.cb();
        }
      }
      if (stateDirty) {
        rerender();
      } else if (!ranAny) {
        break;
      }
    }
  };

  flushEffectsAndRender();

  const getByFolioId = (id: string): RenderedVNode | null =>
    findNodeByPredicate(currentTree, (node) => node.props['data-folio-id'] === id);

  const invokeHandler = (id: string, propName: string, ev?: Record<string, unknown>) => {
    const node = getByFolioId(id);
    if (!node) {
      throw new Error(`React harness: no rendered element found with data-folio-id="${id}"`);
    }
    const handler = node.props[propName];
    if (typeof handler === 'function') {
      (handler as (e?: unknown) => void)(ev);
      rerender();
    }
  };

  return {
    reactFiles,
    pageFile,
    docElementAttrs,
    docClassList,
    navigatedRoutes,
    getTree: () => currentTree,
    getByFolioId,
    getText(id: string): string {
      const node = getByFolioId(id);
      return node ? collectText(node) : '';
    },
    getStyle(id: string): Record<string, unknown> {
      const node = getByFolioId(id);
      const style = node?.props.style;
      return typeof style === 'object' && style !== null ? (style as Record<string, unknown>) : {};
    },
    getToasts(): Array<{ message: string; tone: string }> {
      return findAllNodesByPredicate(
        currentTree,
        (node) => typeof node.props['data-folio-toast'] === 'string',
      ).map((node) => ({
        message: collectText(node),
        tone: String(node.props['data-folio-toast']),
      }));
    },
    getAttr(id: string, attr: string): string | null {
      const node = getByFolioId(id);
      if (!node) return null;
      const direct = node.props[attr];
      if (direct !== undefined && direct !== null) {
        return typeof direct === 'string' ? direct : String(direct);
      }
      if (attr.startsWith('data-variant-') && node.children.length === 1 && typeof node.children[0] !== 'string') {
        const inner = node.children[0].props[attr];
        if (inner !== undefined && inner !== null) {
          return typeof inner === 'string' ? inner : String(inner);
        }
      }
      return null;
    },
    click(id: string) {
      invokeHandler(id, 'onClick');
    },
    dblclick(id: string) {
      invokeHandler(id, 'onDoubleClick');
    },
    hoverEnter(id: string) {
      invokeHandler(id, 'onMouseEnter');
    },
    hoverLeave(id: string) {
      invokeHandler(id, 'onMouseLeave');
    },
    input(id: string, value: string) {
      const target = { value, textContent: value };
      invokeHandler(id, 'onChange', { target, currentTarget: target });
    },
    focus(id: string, value = '') {
      const target = { value, textContent: value };
      invokeHandler(id, 'onFocus', { target, currentTarget: target });
    },
    blur(id: string, value = '') {
      const target = { value, textContent: value };
      invokeHandler(id, 'onBlur', { target, currentTarget: target });
    },
    dragStart(id: string, coords: { x?: number; y?: number } = {}) {
      invokeHandler(id, 'onPointerDown', { clientX: coords.x ?? 10, clientY: coords.y ?? 20 });
    },
    dragMove(id: string, coords: { x?: number; y?: number } = {}) {
      invokeHandler(id, 'onPointerMove', { clientX: coords.x ?? 30, clientY: coords.y ?? 40 });
    },
    dragDrop(id: string, coords: { x?: number; y?: number } = {}) {
      invokeHandler(id, 'onPointerUp', { clientX: coords.x ?? 50, clientY: coords.y ?? 60 });
    },
    clickOutside() {
      const outsideTarget = { id: '__outside__' };
      for (const cb of docListeners.click ?? []) {
        cb({ target: outsideTarget, currentTarget: mockDocument });
      }
      rerender();
    },
    keydown(key: string, mods: KeyEventMods = {}) {
      const ev = {
        key,
        ctrlKey: Boolean(mods.ctrlKey),
        shiftKey: Boolean(mods.shiftKey),
        altKey: Boolean(mods.altKey),
        metaKey: Boolean(mods.metaKey),
      };
      for (const cb of winListeners.keydown ?? []) {
        cb(ev);
      }
      rerender();
    },
    keyup(key: string, mods: KeyEventMods = {}) {
      const ev = {
        key,
        ctrlKey: Boolean(mods.ctrlKey),
        shiftKey: Boolean(mods.shiftKey),
        altKey: Boolean(mods.altKey),
        metaKey: Boolean(mods.metaKey),
      };
      for (const cb of winListeners.keyup ?? []) {
        cb(ev);
      }
      rerender();
    },
    rerender,
  };
}
