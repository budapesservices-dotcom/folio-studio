import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { createThrottledMouseMove, DEFAULT_RESIZE_THROTTLE_MS } from './panelResize';
import {
  clampWindowPosition,
  resizeWindowFromPointer,
  type WindowPosition,
  type WindowSize,
  type WindowViewport,
} from './windowManager';

type WindowRoot = 'main' | 'div';

interface FloatingWindowProps {
  as?: WindowRoot;
  id: string;
  className: string;
  children: ComponentChildren;
  floating?: boolean;
  minimized?: boolean;
  draggable?: boolean;
  position: WindowPosition;
  size: WindowSize;
  zIndex: number;
  onFocus?: () => void;
  onPositionChange: (position: WindowPosition) => void;
  onSizeChange: (size: WindowSize) => void;
  onGeometryChange?: (next: { position: WindowPosition; size: WindowSize }) => void;
  onMouseEnter?: () => void;
  minWidth?: number;
  minHeight?: number;
}

interface PointerSession {
  pointerId: number;
  mode: 'drag' | 'resize';
  direction: string;
  startX: number;
  startY: number;
  position: WindowPosition;
  size: WindowSize;
  shell: HTMLElement | null;
  viewport: WindowViewport;
}

const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function readViewport(shell: HTMLElement | null): WindowViewport {
  const bounds = shell?.getBoundingClientRect();
  return {
    width: Math.max(1, bounds?.width ?? window.innerWidth),
    height: Math.max(1, bounds?.height ?? window.innerHeight),
  };
}

export function FloatingWindow({
  as = 'div',
  id,
  className,
  children,
  floating = false,
  minimized = false,
  draggable = false,
  position,
  size,
  zIndex,
  onFocus,
  onPositionChange,
  onSizeChange,
  onGeometryChange,
  onMouseEnter,
  minWidth = 280,
  minHeight = 220,
}: FloatingWindowProps) {
  const sessionRef = useRef<PointerSession | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const cleanupSession = () => {
    cleanupRef.current?.();
  };

  useEffect(() => () => cleanupSession(), []);

  const handlePointerDown = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    onFocus?.();
    if (event.button !== 0 || !event.isPrimary) return;

    const target = event.target as HTMLElement;
    const resizeHandle = target.closest('[data-window-resize]') as HTMLElement | null;
    const dragHandle = target.closest(
      '.workspace-toolbar-draggable, .canvas-minimized-titlebar, [data-window-drag-handle]',
    );
    const interactive = target.closest(
      'button, a, input, select, textarea, [role="button"], [contenteditable="true"], [data-window-no-drag]',
    );
    const mode = resizeHandle && floating
      ? 'resize'
      : draggable && dragHandle && !interactive
        ? 'drag'
        : null;

    if (!mode) return;

    event.preventDefault();
    event.stopPropagation();
    cleanupSession();

    const shell = event.currentTarget.closest('.app-shell') as HTMLElement | null;
    const session: PointerSession = {
      pointerId: event.pointerId,
      mode,
      direction: resizeHandle?.getAttribute('data-window-resize') ?? '',
      startX: event.clientX,
      startY: event.clientY,
      position: { ...position },
      size: minimized ? { width: 238, height: 34 } : { ...size },
      shell,
      viewport: readViewport(shell),
    };
    sessionRef.current = session;

    const controller = new AbortController();
    const { signal } = controller;

    const applyMove = ({ clientX, clientY }: { clientX: number; clientY: number }) => {
      if (sessionRef.current !== session || signal.aborted) return;
      const dx = clientX - session.startX;
      const dy = clientY - session.startY;

      if (session.mode === 'drag') {
        onPositionChange(clampWindowPosition(
          { x: session.position.x + dx, y: session.position.y + dy },
          session.size,
          session.viewport,
        ));
      } else {
        const next = resizeWindowFromPointer(
          session.position,
          session.size,
          session.direction,
          dx,
          dy,
          session.viewport,
          minWidth,
          minHeight,
        );
        if (onGeometryChange) {
          onGeometryChange(next);
        } else {
          onPositionChange(next.position);
          onSizeChange(next.size);
        }
      }
    };

    const throttledMove = createThrottledMouseMove<{ clientX: number; clientY: number }>(
      applyMove,
      { intervalMs: DEFAULT_RESIZE_THROTTLE_MS },
    );

    const handleViewportResize = () => {
      if (sessionRef.current !== session) return;
      session.viewport = readViewport(session.shell);
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (sessionRef.current !== session || moveEvent.pointerId !== session.pointerId) return;
      moveEvent.preventDefault();
      throttledMove({ clientX: moveEvent.clientX, clientY: moveEvent.clientY });
    };

    let cleanup = (_flushPending?: boolean) => {};

    const handleBlur = () => cleanup(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cleanup(false);
    };
    const handlePointerUp = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== session.pointerId) return;
      cleanup(true);
    };
    const handlePointerCancel = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== session.pointerId) return;
      cleanup(false);
    };

    cleanup = (flushPending = false) => {
      try {
        if (flushPending) {
          throttledMove.flush();
        }
        throttledMove.cancel();
      } finally {
        controller.abort();
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerCancel);
        window.removeEventListener('resize', handleViewportResize);
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (sessionRef.current === session) sessionRef.current = null;
        if (cleanupRef.current === abortCleanup) cleanupRef.current = null;
      }
    };

    const abortCleanup = () => cleanup(false);

    window.addEventListener('pointermove', handleMove, { passive: false, signal });
    window.addEventListener('pointerup', handlePointerUp, { signal });
    window.addEventListener('pointercancel', handlePointerCancel, { signal });
    window.addEventListener('resize', handleViewportResize, { signal });
    window.addEventListener('blur', handleBlur, { signal });
    document.addEventListener('visibilitychange', handleVisibilityChange, { signal });
    cleanupRef.current = abortCleanup;
  };

  const Root = as === 'main' ? 'main' : 'div';
  const rootStyle: JSX.CSSProperties = {
    zIndex,
    ...(floating || minimized ? { left: position.x + 'px', top: position.y + 'px' } : {}),
    ...(floating ? { width: size.width + 'px', height: size.height + 'px' } : {}),
  };

  return (
    <Root
      class={className}
      style={rootStyle}
      onPointerDown={handlePointerDown}
      onFocusCapture={(event) => {
        // Focus entering a child control (including keyboard navigation) raises
        // the owning window without moving focus or causing a focus loop.
        if (event.target !== event.currentTarget) onFocus?.();
      }}
      onMouseEnter={onMouseEnter}
      data-window-id={id}
      data-window-floating={floating ? 'true' : 'false'}
      data-window-minimized={minimized ? 'true' : 'false'}
    >
      {children}
      {floating && RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          data-window-resize={direction}
          class={'workspace-resize-handle resize-' + direction}
          role="presentation"
          aria-hidden="true"
        />
      ))}
    </Root>
  );
}
