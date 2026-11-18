import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { createInitialProject, createNode } from '../core/document/factory';
import type { DesignNode } from '../core/document/types';
import { loadMostRecentProject, saveProject } from '../core/persistence/indexedDb';
import { Canvas } from '../engines/canvas/Canvas';
import { alignNodes, distributeNodes, type Alignment, type DistributionAxis } from '../engines/canvas/geometry';
import { createEditorState, editorReducer } from './editorReducer';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    cursor: 'M5 3l14 9-6 1.5L10 20 5 3z',
    rect: 'M4 5h16v14H4z',
    ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
    text: 'M4 5h16M12 5v14M8 19h8',
    layers: 'M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
    export: 'M12 3v12m0-12 4 4m-4-4-4 4M5 14v6h14v-6',
    import: 'M12 15V3m0 12 4-4m-4 4-4-4M5 14v6h14v-6',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2',
    redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2',
    trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    chevron: 'm9 18 6-6-6-6',
    save: 'M5 4h12l3 3v13H4V4h1zm2 0v6h10V4M8 20v-7h8v7',
    fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    sidebar: 'M4 4h16v16H4zM9 4v16',
    canvas: 'M3 4h18v16H3zM7 8h10v8H7z',
    componentCanvas: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    inspector: 'M4 4h16v16H4zM15 4v16',
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-svg">
      <path d={paths[name] ?? paths.layers} />
    </svg>
  );
}

function LayerIcon({ type }: { type: DesignNode['type'] }) {
  return <span class={`layer-type layer-type-${type}`}>{type === 'text' ? 'T' : type === 'ellipse' ? '○' : '□'}</span>;
}

type ToolbarHint = {
  panel: string;
  description: string;
  shortcuts: string[];
};

const DEFAULT_TOOLBAR_HINT: ToolbarHint = {
  panel: 'WORKSPACE',
  description: 'Point at a panel to see what it does and which shortcuts are available.',
  shortcuts: ['SPACE + DRAG', 'SHIFT + CLICK'],
};

export function App() {
  const initialEditorState = useMemo(() => createEditorState(createInitialProject('First canvas')), []);
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(0.82);
  const [toolbarHint, setToolbarHint] = useState<ToolbarHint>(DEFAULT_TOOLBAR_HINT);
  const [layersVisible, setLayersVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [canvasMinimized, setCanvasMinimized] = useState(false);
  const [canvasClosed, setCanvasClosed] = useState(false);
  const [canvasWindowMode, setCanvasWindowMode] = useState<'docked' | 'floating'>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.canvas-window') ?? 'null');
      return saved?.mode === 'floating' ? 'floating' : 'docked';
    } catch { return 'docked'; }
  });
  const canvasFloating = canvasWindowMode === 'floating';
  const [canvasSize, setCanvasSize] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      // Keep enough free screen area around the window for reliable dragging.
      const maxWidth = Math.max(280, Math.min(viewportWidth * 0.82, viewportWidth - 24));
      const maxHeight = Math.max(220, Math.min(viewportHeight * 0.60, viewportHeight - 56 - 27 - 16));
      const preferredWidth = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(860, viewportWidth * 0.78);
      const preferredHeight = Number.isFinite(saved?.size?.height) ? saved.size.height : Math.min(620, viewportHeight * 0.58);
      return {
        width: Math.min(maxWidth, Math.max(280, preferredWidth)),
        height: Math.min(maxHeight, Math.max(220, preferredHeight)),
      };
    } catch {
      return {
        width: Math.max(280, Math.min(860, window.innerWidth * 0.78, window.innerWidth * 0.82)),
        height: Math.max(220, Math.min(620, window.innerHeight * 0.58)),
      };
    }
  });
  const [componentCanvasClosed, setComponentCanvasClosed] = useState(true);
  const [componentCanvasMinimized, setComponentCanvasMinimized] = useState(false);
  const [componentCanvasWindowMode, setComponentCanvasWindowMode] = useState<'docked' | 'floating'>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.component-canvas-window') ?? 'null');
      return saved?.mode === 'docked' ? 'docked' : 'floating';
    } catch { return 'floating'; }
  });
  const componentCanvasFloating = componentCanvasWindowMode === 'floating';
  const componentCanvasOpen = !componentCanvasClosed && !componentCanvasMinimized;
  const [componentCanvasZoom, setComponentCanvasZoom] = useState(0.82);
  const [componentCanvasSize, setComponentCanvasSize] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.component-canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(680, viewportWidth * 0.72);
      const height = Number.isFinite(saved?.size?.height) ? saved.size.height : Math.min(500, viewportHeight * 0.58);
      return {
        width: Math.min(Math.max(280, viewportWidth - 24), Math.max(280, width)),
        height: Math.min(Math.max(220, viewportHeight - 100), Math.max(220, height)),
      };
    } catch {
      return {
        width: Math.max(280, Math.min(680, window.innerWidth * 0.72)),
        height: Math.max(220, Math.min(500, window.innerHeight * 0.58)),
      };
    }
  });
  const [componentCanvasPosition, setComponentCanvasPosition] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.component-canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const width = Number.isFinite(saved?.size?.width) ? saved.size.width : Math.min(680, viewportWidth * 0.72);
      return {
        x: Number.isFinite(saved?.position?.x) ? saved.position.x : Math.max(24, viewportWidth - width - 48),
        y: Math.max(56, Number.isFinite(saved?.position?.y) ? saved.position.y : 112),
      };
    } catch { return { x: Math.max(24, window.innerWidth - 700), y: 112 }; }
  });
  const componentCanvasDrag = useRef<{ pointerId: number; pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const componentCanvasDragCleanup = useRef<(() => void) | null>(null);
  const componentCanvasResize = useRef<{ pointerId: number; pointerX: number; pointerY: number; left: number; top: number; width: number; height: number; direction: string } | null>(null);
  const componentCanvasResizeCleanup = useRef<(() => void) | null>(null);

  const [canvasPosition, setCanvasPosition] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('folio.canvas-window') ?? 'null');
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const savedX = Number.isFinite(saved?.position?.x) ? saved.position.x : 48;
      const savedY = Number.isFinite(saved?.position?.y) ? saved.position.y : 80;
      // Horizontal and bottom placement are intentionally unbounded; only keep
      // the titlebar below the app header so the window can always be recovered.
      return {
        x: savedX,
        y: Math.max(56, savedY),
      };
    } catch { return { x: 48, y: 80 }; }
  });
  const canvasDrag = useRef<{ pointerId: number; pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const canvasDragCleanup = useRef<(() => void) | null>(null);
  const canvasResize = useRef<{ pointerId: number; pointerX: number; pointerY: number; left: number; top: number; width: number; height: number; direction: string } | null>(null);
  const canvasResizeCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('folio.canvas-window', JSON.stringify({ mode: canvasWindowMode, position: canvasPosition, size: canvasSize }));
    } catch (error) {
      console.warn('Folio could not persist Canvas window layout:', error);
    }
  }, [canvasWindowMode, canvasPosition, canvasSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem('folio.component-canvas-window', JSON.stringify({
        mode: componentCanvasWindowMode,
        position: componentCanvasPosition,
        size: componentCanvasSize,
      }));
    } catch (error) {
      console.warn('Folio could not persist Component Canvas window layout:', error);
    }
  }, [componentCanvasWindowMode, componentCanvasPosition, componentCanvasSize]);

  useEffect(() => () => {
    componentCanvasDragCleanup.current?.();
    componentCanvasResizeCleanup.current?.();
  }, []);

  useEffect(() => () => {
    canvasDragCleanup.current?.();
    canvasResizeCleanup.current?.();
  }, []);

  useEffect(() => {
    let active = true;
    loadMostRecentProject()
      .then((project) => {
        if (active && project) dispatch({ type: 'replace-project', project });
      })
      .catch((error: unknown) => {
        console.warn('Folio could not read local autosave:', error);
        if (active) setNotice('Local storage is unavailable. You can still export .flop files.');
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      saveProject(state.project)
        .then(() => setSaveStatus('saved'))
        .catch((error: unknown) => {
          console.error('Folio autosave failed:', error);
          setSaveStatus('error');
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [state.project, ready]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedNode = useMemo(
    () => state.project.document.nodes.find((node) => node.id === state.selectedNodeId) ?? null,
    [state.project.document.nodes, state.selectedNodeId],
  );

  const addNode = (type: DesignNode['type']) => {
    dispatch({ type: 'add-node', node: createNode(type, state.project.document.nodes.length) });
    setInspectorVisible(true);
  };

  const updateSelected = (patch: Partial<DesignNode>) => {
    if (!selectedNode) return;
    dispatch({ type: 'replace-node', node: { ...selectedNode, ...patch } as DesignNode });
  };

  const updateSelectedStyle = (patch: Record<string, string | number>) => {
    if (!selectedNode) return;
    dispatch({
      type: 'replace-node',
      node: { ...selectedNode, style: { ...selectedNode.style, ...patch } } as DesignNode,
    });
  };

  const alignSelection = (alignment: Alignment) => {
    const selected = state.project.document.nodes.filter((node) => state.selectedNodeIds.includes(node.id));
    if (selected.length < 2) return;
    dispatch({ type: 'transform-nodes', nodes: alignNodes(selected, alignment) });
  };

  const distributeSelection = (axis: DistributionAxis) => {
    const selected = state.project.document.nodes.filter((node) => state.selectedNodeIds.includes(node.id));
    if (selected.length < 3) return;
    dispatch({ type: 'transform-nodes', nodes: distributeNodes(selected, axis) });
  };

  const updateToolbarHint = (panel: string, description: string, shortcuts: string[] = []) => {
    setToolbarHint({ panel, description, shortcuts });
  };

  const enterFullscreen = () => {
    const root = document.querySelector('.app-shell') as HTMLElement | null;
    if (!document.fullscreenElement) root?.requestFullscreen?.().catch(() => setNotice('Fullscreen is unavailable in this browser.'));
    else document.exitFullscreen?.();
  };

  const startCanvasDrag = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if ((!canvasFloating && !canvasMinimized) || event.button !== 0 || !event.isPrimary) return;

    const target = event.target as Element;
    if (target.closest('button, a, input, select, textarea')) return;

    event.preventDefault();
    event.stopPropagation();
    canvasResizeCleanup.current?.();
    canvasDragCleanup.current?.();

    const drag = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: canvasPosition.x,
      originY: canvasPosition.y,
    };
    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    canvasDrag.current = drag;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (canvasDrag.current !== drag || moveEvent.pointerId !== drag.pointerId) return;
      moveEvent.preventDefault();

      const bounds = shell?.getBoundingClientRect();
      const shellLeft = bounds?.left ?? 0;
      const shellTop = bounds?.top ?? 0;
      const visibleWidth = Math.max(0, Math.min(bounds?.right ?? window.innerWidth, window.innerWidth) - Math.max(0, shellLeft));
      const visibleHeight = Math.max(0, Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight) - Math.max(0, shellTop));
      const nextX = drag.originX + moveEvent.clientX - drag.pointerX;
      const nextY = drag.originY + moveEvent.clientY - drag.pointerY;

      // Let the window travel beyond left/right/bottom edges. Keep only its
      // titlebar above the app header to avoid losing the window permanently.
      setCanvasPosition({
        x: nextX,
        y: Math.max(56, nextY),
      });
    };

    const finishPointerDrag = (endEvent: PointerEvent) => {
      if (canvasDrag.current !== drag || endEvent.pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', finishPointerDrag);
      canvasDrag.current = null;
      canvasDragCleanup.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishPointerDrag);
    window.addEventListener('pointercancel', finishPointerDrag);
    canvasDragCleanup.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', finishPointerDrag);
      canvasDrag.current = null;
      canvasDragCleanup.current = null;
    };
  };

  const startCanvasResize = (event: JSX.TargetedPointerEvent<HTMLDivElement>, direction: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    canvasDragCleanup.current?.();
    canvasResizeCleanup.current?.();

    const resize = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: canvasPosition.x,
      top: canvasPosition.y,
      width: canvasSize.width,
      height: canvasSize.height,
      direction,
    };
    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    canvasResize.current = resize;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (canvasResize.current !== resize || moveEvent.pointerId !== resize.pointerId) return;
      moveEvent.preventDefault();

      const bounds = shell?.getBoundingClientRect();
      const shellLeft = bounds?.left ?? 0;
      const shellTop = bounds?.top ?? 0;
      const shellWidth = Math.max(0, Math.min(bounds?.right ?? window.innerWidth, window.innerWidth) - Math.max(0, shellLeft));
      const shellHeight = Math.max(0, Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight) - Math.max(0, shellTop));
      const dx = moveEvent.clientX - resize.pointerX;
      const dy = moveEvent.clientY - resize.pointerY;
      const contentBottom = shellHeight - 27;
      const clamp = (value: number, minimum: number, maximum: number) =>
        Math.min(maximum, Math.max(minimum, value));

      let left = resize.left;
      let top = resize.top;
      let width = resize.width;
      let height = resize.height;

      if (direction.includes('e')) {
        width = clamp(resize.width + dx, 280, Math.max(280, shellWidth - resize.left));
      }
      if (direction.includes('s')) {
        height = clamp(resize.height + dy, 220, Math.max(220, contentBottom - resize.top));
      }
      if (direction.includes('w')) {
        const maxLeft = Math.max(0, Math.min(resize.left + resize.width - 280, shellWidth - 280));
        left = clamp(resize.left + dx, 0, maxLeft);
        width = Math.min(resize.width + resize.left - left, Math.max(280, shellWidth - left));
      }
      if (direction.includes('n')) {
        const maxTop = Math.max(56, Math.min(resize.top + resize.height - 220, contentBottom - 220));
        top = clamp(resize.top + dy, 56, maxTop);
        height = Math.min(resize.height + resize.top - top, Math.max(220, contentBottom - top));
      }

      setCanvasPosition({ x: left, y: top });
      setCanvasSize({ width, height });
    };

    const finishPointerResize = (endEvent: PointerEvent) => {
      if (canvasResize.current !== resize || endEvent.pointerId !== resize.pointerId) return;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerResize);
      window.removeEventListener('pointercancel', finishPointerResize);
      canvasResize.current = null;
      canvasResizeCleanup.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishPointerResize);
    window.addEventListener('pointercancel', finishPointerResize);
    canvasResizeCleanup.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerResize);
      window.removeEventListener('pointercancel', finishPointerResize);
      canvasResize.current = null;
      canvasResizeCleanup.current = null;
    };
  };

  const startComponentCanvasDrag = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if ((!componentCanvasFloating && !componentCanvasMinimized) || event.button !== 0 || !event.isPrimary) return;

    const target = event.target as Element;
    if (target.closest('button, a, input, select, textarea')) return;

    event.preventDefault();
    event.stopPropagation();
    componentCanvasResizeCleanup.current?.();
    componentCanvasDragCleanup.current?.();

    const drag = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: componentCanvasPosition.x,
      originY: componentCanvasPosition.y,
    };
    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    componentCanvasDrag.current = drag;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (componentCanvasDrag.current !== drag || moveEvent.pointerId !== drag.pointerId) return;
      moveEvent.preventDefault();

      const bounds = shell?.getBoundingClientRect();
      const shellLeft = bounds?.left ?? 0;
      const shellTop = bounds?.top ?? 0;
      const visibleWidth = Math.max(0, Math.min(bounds?.right ?? window.innerWidth, window.innerWidth) - Math.max(0, shellLeft));
      const visibleHeight = Math.max(0, Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight) - Math.max(0, shellTop));
      const nextX = drag.originX + moveEvent.clientX - drag.pointerX;
      const nextY = drag.originY + moveEvent.clientY - drag.pointerY;

      // Let the window travel beyond left/right/bottom edges. Keep only its
      // titlebar above the app header to avoid losing the window permanently.
      setComponentCanvasPosition({
        x: nextX,
        y: Math.max(56, nextY),
      });
    };

    const finishPointerDrag = (endEvent: PointerEvent) => {
      if (componentCanvasDrag.current !== drag || endEvent.pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', finishPointerDrag);
      componentCanvasDrag.current = null;
      componentCanvasDragCleanup.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishPointerDrag);
    window.addEventListener('pointercancel', finishPointerDrag);
    componentCanvasDragCleanup.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', finishPointerDrag);
      componentCanvasDrag.current = null;
      componentCanvasDragCleanup.current = null;
    };
  };

  const startComponentCanvasResize = (event: JSX.TargetedPointerEvent<HTMLDivElement>, direction: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    componentCanvasDragCleanup.current?.();
    componentCanvasResizeCleanup.current?.();

    const resize = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: componentCanvasPosition.x,
      top: componentCanvasPosition.y,
      width: componentCanvasSize.width,
      height: componentCanvasSize.height,
      direction,
    };
    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    componentCanvasResize.current = resize;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (componentCanvasResize.current !== resize || moveEvent.pointerId !== resize.pointerId) return;
      moveEvent.preventDefault();

      const bounds = shell?.getBoundingClientRect();
      const shellLeft = bounds?.left ?? 0;
      const shellTop = bounds?.top ?? 0;
      const shellWidth = Math.max(0, Math.min(bounds?.right ?? window.innerWidth, window.innerWidth) - Math.max(0, shellLeft));
      const shellHeight = Math.max(0, Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight) - Math.max(0, shellTop));
      const dx = moveEvent.clientX - resize.pointerX;
      const dy = moveEvent.clientY - resize.pointerY;
      const contentBottom = shellHeight - 27;
      const clamp = (value: number, minimum: number, maximum: number) =>
        Math.min(maximum, Math.max(minimum, value));

      let left = resize.left;
      let top = resize.top;
      let width = resize.width;
      let height = resize.height;

      if (direction.includes('e')) {
        width = clamp(resize.width + dx, 280, Math.max(280, shellWidth - resize.left));
      }
      if (direction.includes('s')) {
        height = clamp(resize.height + dy, 220, Math.max(220, contentBottom - resize.top));
      }
      if (direction.includes('w')) {
        const maxLeft = Math.max(0, Math.min(resize.left + resize.width - 280, shellWidth - 280));
        left = clamp(resize.left + dx, 0, maxLeft);
        width = Math.min(resize.width + resize.left - left, Math.max(280, shellWidth - left));
      }
      if (direction.includes('n')) {
        const maxTop = Math.max(56, Math.min(resize.top + resize.height - 220, contentBottom - 220));
        top = clamp(resize.top + dy, 56, maxTop);
        height = Math.min(resize.height + resize.top - top, Math.max(220, contentBottom - top));
      }

      setComponentCanvasPosition({ x: left, y: top });
      setComponentCanvasSize({ width, height });
    };

    const finishPointerResize = (endEvent: PointerEvent) => {
      if (componentCanvasResize.current !== resize || endEvent.pointerId !== resize.pointerId) return;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerResize);
      window.removeEventListener('pointercancel', finishPointerResize);
      componentCanvasResize.current = null;
      componentCanvasResizeCleanup.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishPointerResize);
    window.addEventListener('pointercancel', finishPointerResize);
    componentCanvasResizeCleanup.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerResize);
      window.removeEventListener('pointercancel', finishPointerResize);
      componentCanvasResize.current = null;
      componentCanvasResizeCleanup.current = null;
    };
  };

  const statusLabel = saveStatus === 'loading'
    ? 'LOADING'
    : saveStatus === 'saving'
      ? 'SAVING…'
      : saveStatus === 'error'
        ? 'SAVE ERROR'
        : 'ALL CHANGES SAVED';

  return (
    <div class={`app-shell ${layersVisible ? "" : "layers-hidden"} ${inspectorVisible ? "" : "inspector-hidden"}`} onMouseLeave={() => setToolbarHint(DEFAULT_TOOLBAR_HINT)}>
      <header class="global-toolbar-slot" aria-label="FOLIO application toolbar">
        <nav class="global-menu-bar" aria-label="Application menus">
          <div class="global-toolbar-left">
          <div class="global-menu-items">
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('FILE', 'Project actions and .flop file commands will be organized here.')}>File</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('EDIT', 'Editing, history and selection commands will be organized here.')}>Edit</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('VIEW', 'Workspace display, panels, zoom and fullscreen controls will be organized here.')}>View</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('TOOLS', 'Design tools and tool-specific settings will be organized here.')}>Tools</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('OPTION', 'Application and workspace preferences will be organized here.')}>Option</span>
            <span class="global-menu-separator" aria-hidden="true">|</span>
            <span class="global-menu-item" onMouseEnter={() => updateToolbarHint('HELP', 'Keyboard reference, documentation and support will be organized here.')}>Help</span>
          </div>
          <div class="global-project-name" title={`${state.project.metadata.name}.flop`}>
            <span class="global-project-label">{state.project.metadata.name}</span>
            <span class="global-project-extension">.flop</span>
          </div>
          </div>
          <div class="global-panel-toggles" aria-label="Workspace panels">
            <button class={`global-panel-toggle ${layersVisible ? 'active' : ''}`} type="button" title="Show / hide Layers sidebar" aria-label="Show or hide Layers sidebar" aria-pressed={layersVisible} onClick={() => setLayersVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('LAYERS SIDEBAR', 'Show or hide the document Layers dock.')}><Icon name="sidebar" /></button>
            <button class={`global-panel-toggle canvas-header-toggle ${!canvasClosed && !canvasMinimized ? "active" : ""}`} type="button" title={canvasClosed || canvasMinimized ? "Open Canvas" : "Close Canvas"} aria-label={canvasClosed || canvasMinimized ? "Open Canvas" : "Close Canvas"} aria-pressed={!canvasClosed && !canvasMinimized} onClick={() => { if (canvasClosed || canvasMinimized) { setCanvasClosed(false); setCanvasMinimized(false); } else { setCanvasClosed(true); setCanvasMinimized(false); } }} onMouseEnter={() => updateToolbarHint('CANVAS WINDOW', canvasClosed || canvasMinimized ? 'Open the Canvas dock.' : 'Close the Canvas workspace.')}><Icon name="canvas" /></button>
            <button class={`global-panel-toggle component-canvas-header-toggle ${componentCanvasOpen ? 'active' : ''}`} type="button" title={componentCanvasClosed || componentCanvasMinimized ? "Open Component Canvas" : "Close Component Canvas"} aria-label={componentCanvasClosed || componentCanvasMinimized ? "Open Component Canvas" : "Close Component Canvas"} aria-pressed={componentCanvasOpen} onClick={() => { if (componentCanvasClosed || componentCanvasMinimized) { setComponentCanvasClosed(false); setComponentCanvasMinimized(false); } else { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); } }} onMouseEnter={() => updateToolbarHint('COMPONENT CANVAS', componentCanvasClosed || componentCanvasMinimized ? 'Open the Component Canvas window.' : 'Close the Component Canvas window.')}><Icon name="componentCanvas" /></button>
            <button class={`global-panel-toggle inspector-header-toggle ${inspectorVisible ? 'active' : ''}`} type="button" title={inspectorVisible ? "Hide Inspector" : "Show Inspector"} aria-label={inspectorVisible ? "Hide Inspector" : "Show Inspector"} aria-pressed={inspectorVisible} onClick={() => setInspectorVisible((value) => !value)} onMouseEnter={() => updateToolbarHint('INSPECTOR', inspectorVisible ? 'Hide the properties Inspector. Selecting an object opens it automatically.' : 'Show the properties Inspector. Selecting an object also opens it automatically.')}><Icon name="inspector" /></button>
            <button class="global-panel-toggle fullscreen-toggle" type="button" title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={enterFullscreen} onMouseEnter={() => updateToolbarHint('FULLSCREEN', 'Enter or exit browser fullscreen mode.')}><Icon name="fullscreen" /></button>
          </div>
        </nav>
        <div class="global-hint-bar" role="status" aria-live="polite">
          <span class="hint-panel-label">{toolbarHint.panel}</span>
          <span class="hint-panel-description">{toolbarHint.description}</span>
          <span class="hint-shortcut-divider" aria-hidden="true">·</span>
          <div class="hint-shortcut-list">
            {toolbarHint.shortcuts.length > 0
              ? toolbarHint.shortcuts.map((shortcut) => <span class="hint-shortcut" key={shortcut}>{shortcut}</span>)
              : <span class="hint-no-shortcuts">SHORTCUTS NOT ASSIGNED</span>}
          </div>
        </div>
      </header>
      <nav class="tool-rail" aria-label="Insert tools" onMouseEnter={() => updateToolbarHint('TOOLS', 'Choose Select, Rectangle, Ellipse or Text from the tool rail.')}>
        <button class="tool-button active" title="Select layer" aria-label="Select layer" onClick={() => dispatch({ type: 'select-node', nodeId: null })}>
          <Icon name="cursor" />
        </button>
        <div class="rail-separator" />
        <button class="tool-button" title="Add rectangle" aria-label="Add rectangle" onClick={() => addNode('rect')}>
          <Icon name="rect" />
        </button>
        <button class="tool-button" title="Add ellipse" aria-label="Add ellipse" onClick={() => addNode('ellipse')}>
          <Icon name="ellipse" />
        </button>
        <button class="tool-button" title="Add text" aria-label="Add text" onClick={() => addNode('text')}>
          <Icon name="text" />
        </button>
        <div class="rail-bottom">
          <button class="tool-button" title="Undo" aria-label="Undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
            <Icon name="undo" />
          </button>
          <button class="tool-button" title="Redo" aria-label="Redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
            <Icon name="redo" />
          </button>
        </div>
      </nav>

      <aside class={`layers-panel ${layersVisible ? "" : "is-hidden"}`} onMouseEnter={() => updateToolbarHint('LAYERS', 'Select layers or extend a selection with modifier-click.', ['SHIFT + CLICK', 'CTRL/CMD + CLICK'])}>
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">DOCUMENT</span>
            <h2>Layers</h2>
          </div>
          <button class="icon-button" title="Add rectangle" onClick={() => addNode('rect')}><Icon name="plus" /></button>
        </div>
        <div class="page-row">
          <span class="page-indicator" />
          <span>{state.project.document.name}</span>
          <span class="page-size">{state.project.document.width} × {state.project.document.height}</span>
        </div>
        <div class="layer-list-heading">
          <span>LAYERS</span>
          <span>{state.project.document.nodes.length}</span>
        </div>
        <div class="layer-list">
          {[...state.project.document.nodes].reverse().map((node) => (
            <button
              key={node.id}
              class={"layer-row " + (state.selectedNodeIds.includes(node.id) ? "selected " : "") + (node.visible ? "" : "layer-hidden")}
              onClick={(event) => {
                const selected = state.selectedNodeIds;
                setInspectorVisible(true);
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                  const next = selected.includes(node.id)
                    ? selected.filter((id) => id !== node.id)
                    : [...selected, node.id];
                  dispatch({ type: 'select-nodes', nodeIds: next });
                } else {
                  dispatch({ type: 'select-node', nodeId: node.id });
                }
              }}
              title={`Select ${node.name}`}
            >
              <LayerIcon type={node.type} />
              <span class="layer-name">{node.name}</span>
              <span class="layer-eye">{node.visible ? '◉' : '○'}</span>
            </button>
          ))}
          {state.project.document.nodes.length === 0 && (
            <div class="empty-layers">Your layers will appear here.</div>
          )}
        </div>
        <div class="layers-footnote">
          <span class="footnote-dot" />
          <span>Document is stored locally</span>
        </div>
      </aside>

      {!canvasClosed && !canvasMinimized && !(componentCanvasOpen && !componentCanvasFloating && !canvasFloating) && <main
        class={`workspace${canvasFloating ? " canvas-floating" : ""}`}
        style={canvasFloating ? {
          left: `${canvasPosition.x}px`,
          top: `${canvasPosition.y}px`,
          width: `${canvasSize.width}px`,
          height: `${canvasSize.height}px`,
        } : undefined}
        onMouseEnter={() => updateToolbarHint('COMPONENT CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
      >
        <div
          class={`workspace-toolbar${canvasFloating ? " workspace-toolbar-draggable" : ""}`}
          onPointerDown={canvasFloating ? startCanvasDrag : undefined}
        >
          <div class="breadcrumb">
            <strong>{state.project.document.name}</strong>
          </div>
          <div class="canvas-window-tools">
            {state.selectedNodeIds.length > 1 && (
              <div class="alignment-tools" aria-label="Align selected layers">
                <button title="Align left" aria-label="Align left" onClick={() => alignSelection('left')}>⇤</button>
                <button title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignSelection('horizontal-center')}>↔</button>
                <button title="Align right" aria-label="Align right" onClick={() => alignSelection('right')}>⇥</button>
                <button title="Distribute horizontally" aria-label="Distribute horizontally" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('horizontal')}>⇌</button>
                <button title="Align top" aria-label="Align top" onClick={() => alignSelection('top')}>⇡</button>
                <button title="Align vertical center" aria-label="Align vertical center" onClick={() => alignSelection('vertical-center')}>↕</button>
                <button title="Align bottom" aria-label="Align bottom" onClick={() => alignSelection('bottom')}>⇣</button>
                <button title="Distribute vertically" aria-label="Distribute vertically" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('vertical')}>⇅</button>
              </div>
            )}
            <div class="workspace-tools">
              <button class="history-button" title="Undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" /></button>
              <button class="history-button" title="Redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" /></button>
              <span class="workspace-divider" />
              <button class="zoom-button" title="Zoom out" onClick={() => setZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}><Icon name="minus" /></button>
              <span class="zoom-value">{Math.round(zoom * 100)}%</span>
              <button class="zoom-button" title="Zoom in" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))))}><Icon name="plus" /></button>
            </div>
            <div class="workspace-window-controls" aria-label="Canvas window controls">
              <button type="button" class="window-control window-control-minimize" title="Minimize canvas" aria-label="Minimize canvas" onClick={() => setCanvasMinimized(true)}></button>
              <button type="button" class="window-control" title={canvasFloating ? "Dock Canvas" : "Float Canvas"} aria-label={canvasFloating ? "Dock Canvas" : "Float Canvas"} aria-pressed={canvasFloating} onClick={() => setCanvasWindowMode(canvasFloating ? 'docked' : 'floating')}>{canvasFloating ? "▣" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Canvas window" aria-label="Close Canvas window" onClick={() => { setCanvasClosed(true); setCanvasMinimized(false); setCanvasWindowMode('docked'); }}>×</button>
            </div>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={state.project.document}
            selectedNodeIds={state.selectedNodeIds}
            zoom={zoom}
            onZoomChange={setZoom}
            onSelectionChange={(nodeIds) => {
              dispatch({ type: 'select-nodes', nodeIds });
              if (nodeIds.length > 0) setInspectorVisible(true);
            }}
            onTransformCommit={(nodes) => dispatch({ type: 'transform-nodes', nodes })}
          />
          <div class="canvas-hint">SCROLL: PAN Y · SHIFT + SCROLL: PAN X · CTRL/CMD + SCROLL: ZOOM · SPACE + DRAG: PAN</div>
        </div>
        {canvasFloating && ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((direction) => (
          <div
            key={direction}
            class={`workspace-resize-handle resize-${direction}`}
            role="presentation"
            aria-label={`Resize Component Canvas window from ${direction}`}
            onPointerDown={(event) => startCanvasResize(event, direction)}
          />
        ))}
      </main>}

      {!componentCanvasClosed && !componentCanvasMinimized && <main
        class={`workspace component-canvas-window${componentCanvasFloating ? " canvas-floating" : " component-canvas-docked"}` }
        style={componentCanvasFloating ? {
          left: `${componentCanvasPosition.x}px`,
          top: `${componentCanvasPosition.y}px`,
          width: `${componentCanvasSize.width}px`,
          height: `${componentCanvasSize.height}px`,
        } : undefined}
        onMouseEnter={() => updateToolbarHint('CANVAS', 'Scroll to pan vertically; Shift + scroll to pan horizontally; Ctrl/Cmd + scroll to zoom at pointer.', ['SCROLL: PAN Y', 'SHIFT + SCROLL: PAN X', 'CTRL/CMD + SCROLL: ZOOM'])}
      >
        <div
          class={`workspace-toolbar${componentCanvasFloating ? " workspace-toolbar-draggable" : ""}`}
          onPointerDown={componentCanvasFloating ? startComponentCanvasDrag : undefined}
        >
          <div class="breadcrumb">
            <Icon name="componentCanvas" />
            <strong>Component Canvas</strong>
          </div>
          <div class="canvas-window-tools">
            {state.selectedNodeIds.length > 1 && (
              <div class="alignment-tools" aria-label="Align selected layers">
                <button title="Align left" aria-label="Align left" onClick={() => alignSelection('left')}>⇤</button>
                <button title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignSelection('horizontal-center')}>↔</button>
                <button title="Align right" aria-label="Align right" onClick={() => alignSelection('right')}>⇥</button>
                <button title="Distribute horizontally" aria-label="Distribute horizontally" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('horizontal')}>⇌</button>
                <button title="Align top" aria-label="Align top" onClick={() => alignSelection('top')}>⇡</button>
                <button title="Align vertical center" aria-label="Align vertical center" onClick={() => alignSelection('vertical-center')}>↕</button>
                <button title="Align bottom" aria-label="Align bottom" onClick={() => alignSelection('bottom')}>⇣</button>
                <button title="Distribute vertically" aria-label="Distribute vertically" disabled={state.selectedNodeIds.length < 3} onClick={() => distributeSelection('vertical')}>⇅</button>
              </div>
            )}
            <div class="workspace-tools">
              <button class="history-button" title="Undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}><Icon name="undo" /></button>
              <button class="history-button" title="Redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}><Icon name="redo" /></button>
              <span class="workspace-divider" />
              <button class="zoom-button" title="Zoom out" onClick={() => setComponentCanvasZoom((value) => Math.max(0.35, Number((value - 0.1).toFixed(2))))}><Icon name="minus" /></button>
              <span class="zoom-value">{Math.round(componentCanvasZoom * 100)}%</span>
              <button class="zoom-button" title="Zoom in" onClick={() => setComponentCanvasZoom((value) => Math.min(2, Number((value + 0.1).toFixed(2))))}><Icon name="plus" /></button>
            </div>
            <div class="workspace-window-controls" aria-label="Component Canvas window controls">
              <button type="button" class="window-control window-control-minimize" title="Minimize Component Canvas" aria-label="Minimize Component Canvas" onClick={() => setComponentCanvasMinimized(true)}></button>
              <button type="button" class="window-control" title={componentCanvasFloating ? "Dock Component Canvas" : "Float Component Canvas"} aria-label={componentCanvasFloating ? "Dock Component Canvas" : "Float Component Canvas"} aria-pressed={componentCanvasFloating} onClick={() => setComponentCanvasWindowMode(componentCanvasFloating ? 'docked' : 'floating')}>{componentCanvasFloating ? "▣" : "□"}</button>
              <button type="button" class="window-control window-control-close" title="Close Component Canvas window" aria-label="Close Component Canvas window" onClick={() => { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); setComponentCanvasWindowMode('docked'); }}>×</button>
            </div>
          </div>
        </div>
        <div class="canvas-workspace">
          <Canvas
            document={state.project.document}
            selectedNodeIds={state.selectedNodeIds}
            zoom={componentCanvasZoom}
            onZoomChange={setComponentCanvasZoom}
            onSelectionChange={(nodeIds) => {
              dispatch({ type: 'select-nodes', nodeIds });
              if (nodeIds.length > 0) setInspectorVisible(true);
            }}
            onTransformCommit={(nodes) => dispatch({ type: 'transform-nodes', nodes })}
          />
          <div class="canvas-hint">SCROLL: PAN Y · SHIFT + SCROLL: PAN X · CTRL/CMD + SCROLL: ZOOM · SPACE + DRAG: PAN</div>
        </div>
        {componentCanvasFloating && ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((direction) => (
          <div
            key={direction}
            class={`workspace-resize-handle resize-${direction}`}
            role="presentation"
            aria-label={`Resize Canvas window from ${direction}`}
            onPointerDown={(event) => startComponentCanvasResize(event, direction)}
          />
        ))}
      </main>}

      {canvasMinimized && !canvasClosed && (
        <div
          class="canvas-minimized-window"
          style={{ left: canvasPosition.x + "px", top: canvasPosition.y + "px" }}
        >
          <div
            class="canvas-minimized-titlebar"
            onPointerDown={startCanvasDrag}
          >
            <Icon name="canvas" />
            <strong>{state.project.document.name}</strong>
            <button type="button" class="minimized-restore-control" title="Restore Canvas" aria-label="Restore Canvas" onClick={() => setCanvasMinimized(false)}></button>
            <button type="button" title="Close Canvas" aria-label="Close Canvas" onClick={() => { setCanvasClosed(true); setCanvasMinimized(false); }}>×</button>
          </div>
        </div>
      )}

      {componentCanvasMinimized && !componentCanvasClosed && (
        <div
          class="canvas-minimized-window component-canvas-minimized"
          style={{ left: componentCanvasPosition.x + "px", top: componentCanvasPosition.y + "px" }}
        >
          <div
            class="canvas-minimized-titlebar"
            onPointerDown={componentCanvasFloating ? startComponentCanvasDrag : undefined}
          >
            <Icon name="componentCanvas" />
            <strong>Component Canvas</strong>
            <button type="button" class="minimized-restore-control" title="Restore Component Canvas" aria-label="Restore Component Canvas" onClick={() => setComponentCanvasMinimized(false)}></button>
            <button type="button" title="Close Component Canvas" aria-label="Close Component Canvas" onClick={() => { setComponentCanvasClosed(true); setComponentCanvasMinimized(false); }}>×</button>
          </div>
        </div>
      )}

      <aside class={`inspector-panel ${inspectorVisible ? "" : "is-hidden"}`} onMouseEnter={() => updateToolbarHint('INSPECTOR', 'Edit the selected layer’s position, dimensions, appearance and options.')}>
        <div class="panel-heading inspector-heading">
          <div>
            <span class="panel-kicker">PROPERTIES</span>
            <h2>Inspector</h2>
          </div>
          {selectedNode && <button class="icon-button danger" title="Delete selected layer" onClick={() => dispatch({ type: 'delete-node', nodeId: selectedNode.id })}><Icon name="trash" /></button>}
        </div>

        {selectedNode ? (
          <div class="inspector-content">
            <section class="property-section">
              <div class="section-title">Layer</div>
              <label class="field-label">Name</label>
              <input
                class="text-field"
                value={selectedNode.name}
                onChange={(event) => updateSelected({ name: event.currentTarget.value })}
              />
            </section>

            <section class="property-section">
              <div class="section-title">Position</div>
              <div class="field-grid">
                <label class="field-label">X<input class="number-field" type="number" value={Math.round(selectedNode.x)} onChange={(event) => updateSelected({ x: Number(event.currentTarget.value) || 0 })} /></label>
                <label class="field-label">Y<input class="number-field" type="number" value={Math.round(selectedNode.y)} onChange={(event) => updateSelected({ y: Number(event.currentTarget.value) || 0 })} /></label>
                <label class="field-label">W<input class="number-field" type="number" min="1" value={Math.round(selectedNode.width)} onChange={(event) => updateSelected({ width: Math.max(1, Number(event.currentTarget.value) || 1) })} /></label>
                <label class="field-label">H<input class="number-field" type="number" min="1" value={Math.round(selectedNode.height)} onChange={(event) => updateSelected({ height: Math.max(1, Number(event.currentTarget.value) || 1) })} /></label>
              </div>
              <label class="field-label rotation-field">Rotation<input class="number-field" type="number" value={selectedNode.rotation} onChange={(event) => updateSelected({ rotation: Number(event.currentTarget.value) || 0 })} /></label>
            </section>

            <section class="property-section">
              <div class="section-title">Appearance</div>
              <label class="field-label">Fill</label>
              <div class="color-field-wrap">
                <input
                  class="color-swatch"
                  type="color"
                  value={selectedNode.style.fill.startsWith('#') && selectedNode.style.fill.length === 7 ? selectedNode.style.fill : '#8B7CF6'}
                  onChange={(event) => updateSelectedStyle({ fill: event.currentTarget.value })}
                />
                <span class="color-value">{selectedNode.style.fill.toUpperCase()}</span>
              </div>
              {selectedNode.type === 'rect' && (
                <label class="field-label range-label">Corner radius
                  <input class="number-field" type="number" min="0" value={selectedNode.style.radius ?? 0} onChange={(event) => updateSelectedStyle({ radius: Math.max(0, Number(event.currentTarget.value) || 0) })} />
                </label>
              )}
              {selectedNode.type === 'text' && (
                <>
                  <label class="field-label text-content-label">Text content</label>
                  <textarea class="text-area-field" rows={3} value={selectedNode.text} onChange={(event) => updateSelected({ text: event.currentTarget.value })} />
                  <div class="field-grid single-row">
                    <label class="field-label">Font size<input class="number-field" type="number" min="1" value={selectedNode.style.fontSize} onChange={(event) => updateSelectedStyle({ fontSize: Math.max(1, Number(event.currentTarget.value) || 1) })} /></label>
                    <label class="field-label">Weight<input class="number-field" type="number" min="100" max="900" step="100" value={selectedNode.style.fontWeight} onChange={(event) => updateSelectedStyle({ fontWeight: Math.min(900, Math.max(100, Number(event.currentTarget.value) || 400)) })} /></label>
                  </div>
                </>
              )}
            </section>

            <section class="property-section last-section">
              <div class="section-title">Layer options</div>
              <label class="toggle-row"><span>Visible</span><input type="checkbox" checked={selectedNode.visible} onChange={(event) => updateSelected({ visible: event.currentTarget.checked })} /></label>
              <label class="toggle-row"><span>Locked</span><input type="checkbox" checked={selectedNode.locked} onChange={(event) => updateSelected({ locked: event.currentTarget.checked })} /></label>
            </section>
          </div>
        ) : state.selectedNodeIds.length > 1 ? (
          <div class="inspector-empty multi-inspector">
            <div class="empty-icon"><Icon name="layers" /></div>
            <strong>{state.selectedNodeIds.length} layers selected</strong>
            <p>Drag to move the group, use the resize handles, or choose an alignment control above the canvas.</p>
          </div>
        ) : (
          <div class="inspector-empty">
            <div class="empty-icon"><Icon name="cursor" /></div>
            <strong>Nothing selected</strong>
            <p>Select a layer on the canvas or in the Layers panel to edit its properties.</p>
            <div class="quick-add">
              <button onClick={() => addNode('rect')}>+ Rectangle</button>
              <button onClick={() => addNode('text')}>+ Text</button>
            </div>
          </div>
        )}
      </aside>

      <footer class="statusbar">
        <div><span class="status-brand">F</span><span>Folio Studio <b>0.1.0</b></span></div>
        <div class="status-center">{state.project.document.nodes.length} LAYERS <span>·</span> {state.project.document.width} × {state.project.document.height} PX</div>
        <div class={`status-right save-${saveStatus}`} role="status" aria-live="polite"><span class="status-ready-dot" /> {statusLabel}</div>
      </footer>

      {notice && <div class="toast" role="status">{notice}</div>}
    </div>
  );
}
