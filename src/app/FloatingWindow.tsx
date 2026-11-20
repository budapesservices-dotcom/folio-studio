import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
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
    };
    sessionRef.current = session;

    let cleanup = () => {};
    const handleMove = (moveEvent: PointerEvent) => {
      if (sessionRef.current !== session || moveEvent.pointerId !== session.pointerId) return;
      moveEvent.preventDefault();

      // Read current bounds on every move so a viewport resize during a drag
      // cannot leave the active window outside the newly available workspace.
      const viewport = readViewport(session.shell);
      const dx = moveEvent.clientX - session.startX;
      const dy = moveEvent.clientY - session.startY;

      if (session.mode === 'drag') {
        onPositionChange(clampWindowPosition(
          { x: session.position.x + dx, y: session.position.y + dy },
          session.size,
          viewport,
        ));
      } else {
        const next = resizeWindowFromPointer(
          session.position,
          session.size,
          session.direction,
          dx,
          dy,
          viewport,
          minWidth,
          minHeight,
        );
        onPositionChange(next.position);
        onSizeChange(next.size);
      }
    };
    const handleBlur = () => cleanup();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cleanup();
    };
    const finish = (endEvent?: PointerEvent) => {
      if (endEvent && endEvent.pointerId !== session.pointerId) return;
      cleanup();
    };

    cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sessionRef.current === session) sessionRef.current = null;
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    cleanupRef.current = cleanup;
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
