export type WindowId = 'main-canvas' | 'component-canvas' | 'node-logic' | 'pages';
export interface WindowPosition { x: number; y: number }
export interface WindowSize { width: number; height: number }
export interface WindowLayout { position: WindowPosition; size: WindowSize }
export interface WindowViewport { width: number; height: number }

/**
 * Shared chrome dimensions used by geometry recovery. Workspace windows are
 * constrained to the area below the application toolbar and above the statusbar.
 */
export const WINDOW_CHROME = { header: 56, footer: 27 } as const;

/**
 * Explicit stacking contract. Workspace window z-index values occupy a bounded
 * band below Component Rack; application chrome remains above both.
 *
 * Keep these values in sync with the CSS custom properties in global.css.
 */
export const WINDOW_LAYERING = {
  dockedWorkspace: 10,
  sidePanel: 70,
  floatingWindowBase: 120,
  componentRack: 300,
  applicationToolbar: 1200,
  toolRail: 1200,
  menuOverlay: 1400,
  blockingOverlay: 2000,
} as const;

const WINDOW_IDS: readonly WindowId[] = [
  'main-canvas',
  'component-canvas',
  'node-logic',
  'pages',
];

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function normalizeViewport(viewport: WindowViewport): WindowViewport {
  return {
    width: Math.max(1, finiteOr(viewport?.width, 1)),
    height: Math.max(1, finiteOr(viewport?.height, 1)),
  };
}

function getUsableVerticalBounds(viewport: WindowViewport) {
  const top = Math.min(WINDOW_CHROME.header, Math.max(0, viewport.height - 1));
  const bottom = Math.min(WINDOW_CHROME.footer, Math.max(0, viewport.height - top - 1));
  return {
    top,
    bottom,
    height: Math.max(1, viewport.height - top - bottom),
  };
}

function normalizeMinimum(value: number, fallback: number, maximum: number): number {
  const requested = Math.max(1, finiteOr(value, fallback));
  // On a viewport smaller than the nominal minimum, the viewport wins. A
  // smaller window is preferable to one that cannot be recovered on-screen.
  return Math.min(requested, Math.max(1, maximum));
}

export function bringWindowToFront(order: readonly WindowId[], id: WindowId): WindowId[] {
  const uniqueOrder = order.filter((item, index) => order.indexOf(item) === index);
  return [...uniqueOrder.filter((item) => item !== id), id];
}

export function getWindowZIndex(
  order: readonly WindowId[],
  id: WindowId,
  base: number = WINDOW_LAYERING.floatingWindowBase,
): number {
  const index = order.indexOf(id);
  const safeBase = finiteOr(base, WINDOW_LAYERING.floatingWindowBase);
  return safeBase + (index < 0 ? 0 : index);
}

/**
 * Clamp a position without changing the window's intended size. Oversized
 * windows are temporarily constrained to the viewport through recovery.
 */
export function clampWindowPosition(
  position: WindowPosition,
  size: WindowSize,
  viewport: WindowViewport,
): WindowPosition {
  return recoverWindowLayout(
    { position, size },
    viewport,
    1,
    1,
  ).position;
}

/**
 * Normalize saved geometry against the current viewport.
 *
 * Invalid values fall back to a visible default, windows are reduced when the
 * viewport is smaller than their nominal minimum, and the complete window is
 * kept between the toolbar and statusbar whenever the viewport permits it.
 */
export function recoverWindowLayout(
  layout: WindowLayout,
  viewport: WindowViewport,
  minWidth = 280,
  minHeight = 220,
): WindowLayout {
  const safeViewport = normalizeViewport(viewport);
  const vertical = getUsableVerticalBounds(safeViewport);
  const safeMinWidth = normalizeMinimum(minWidth, 280, safeViewport.width);
  const safeMinHeight = normalizeMinimum(minHeight, 220, vertical.height);

  const rawSize = layout?.size;
  const rawPosition = layout?.position;
  const width = clamp(
    finiteOr(rawSize?.width, safeMinWidth),
    safeMinWidth,
    safeViewport.width,
  );
  const height = clamp(
    finiteOr(rawSize?.height, safeMinHeight),
    safeMinHeight,
    vertical.height,
  );
  const maxX = Math.max(0, safeViewport.width - width);
  const maxY = Math.max(vertical.top, safeViewport.height - vertical.bottom - height);

  return {
    position: {
      x: clamp(finiteOr(rawPosition?.x, 0), 0, maxX),
      y: clamp(finiteOr(rawPosition?.y, vertical.top), Math.min(vertical.top, maxY), maxY),
    },
    size: { width, height },
  };
}

/**
 * Apply a pointer resize delta from any edge/corner while preserving the
 * opposite edge and enforcing viewport-aware minimum dimensions.
 */
export function resizeWindowFromPointer(
  position: WindowPosition,
  size: WindowSize,
  direction: string,
  dx: number,
  dy: number,
  viewport: WindowViewport,
  minWidth = 280,
  minHeight = 220,
): WindowLayout {
  const safeViewport = normalizeViewport(viewport);
  const vertical = getUsableVerticalBounds(safeViewport);
  const safeMinWidth = normalizeMinimum(minWidth, 280, safeViewport.width);
  const safeMinHeight = normalizeMinimum(minHeight, 220, vertical.height);
  const safeDirection = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(direction)
    ? direction
    : '';

  const current = recoverWindowLayout(
    { position, size },
    safeViewport,
    safeMinWidth,
    safeMinHeight,
  );
  if (!safeDirection) return current;

  const deltaX = finiteOr(dx, 0);
  const deltaY = finiteOr(dy, 0);
  let left = current.position.x;
  let top = current.position.y;
  let right = left + current.size.width;
  let bottom = top + current.size.height;
  const maxRight = safeViewport.width;
  const maxBottom = safeViewport.height - vertical.bottom;

  if (safeDirection.includes('e')) {
    right = clamp(right + deltaX, left + safeMinWidth, maxRight);
  }
  if (safeDirection.includes('s')) {
    bottom = clamp(bottom + deltaY, top + safeMinHeight, maxBottom);
  }
  if (safeDirection.includes('w')) {
    left = clamp(left + deltaX, 0, right - safeMinWidth);
  }
  if (safeDirection.includes('n')) {
    top = clamp(top + deltaY, vertical.top, bottom - safeMinHeight);
  }

  return recoverWindowLayout(
    {
      position: { x: left, y: top },
      size: { width: right - left, height: bottom - top },
    },
    safeViewport,
    safeMinWidth,
    safeMinHeight,
  );
}

export function getDefaultWindowLayouts(
  viewport: WindowViewport,
): Record<'main-canvas' | 'component-canvas' | 'node-logic', WindowLayout> {
  const safeViewport = normalizeViewport(viewport);
  const vertical = getUsableVerticalBounds(safeViewport);
  const minWidth = normalizeMinimum(280, 280, safeViewport.width);
  const minHeight = normalizeMinimum(220, 220, vertical.height);

  const mainSize = {
    width: Math.min(860, Math.max(minWidth, safeViewport.width * 0.78)),
    height: Math.min(620, Math.max(minHeight, vertical.height * 0.86)),
  };
  const componentSize = {
    width: Math.min(680, Math.max(minWidth, safeViewport.width * 0.72)),
    height: Math.min(500, Math.max(minHeight, vertical.height * 0.72)),
  };
  const logicSize = {
    width: Math.min(720, Math.max(minWidth, safeViewport.width * 0.74)),
    height: Math.min(540, Math.max(minHeight, vertical.height * 0.78)),
  };

  return {
    'main-canvas': recoverWindowLayout(
      { position: { x: 48, y: 80 }, size: mainSize },
      safeViewport,
    ),
    'component-canvas': recoverWindowLayout(
      {
        position: {
          x: Math.max(24, safeViewport.width - componentSize.width - 48),
          y: 112,
        },
        size: componentSize,
      },
      safeViewport,
    ),
    'node-logic': recoverWindowLayout(
      {
        position: {
          x: Math.max(40, Math.round((safeViewport.width - logicSize.width) * 0.18)),
          y: 146,
        },
        size: logicSize,
      },
      safeViewport,
    ),
  };
}

/** Return the known window IDs in their stable declaration order. */
export function getWorkspaceWindowIds(): readonly WindowId[] {
  return WINDOW_IDS;
}
