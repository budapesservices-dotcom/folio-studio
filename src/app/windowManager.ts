export type WindowId = 'main-canvas' | 'component-canvas' | 'node-logic' | 'pages';
export interface WindowPosition { x: number; y: number }
export interface WindowSize { width: number; height: number }
export interface WindowLayout { position: WindowPosition; size: WindowSize }
export interface WindowViewport { width: number; height: number }

export const WINDOW_CHROME = { header: 56, footer: 27 } as const;

export function bringWindowToFront(order: readonly WindowId[], id: WindowId): WindowId[] {
  return [...order.filter((item) => item !== id), id];
}

export function getWindowZIndex(order: readonly WindowId[], id: WindowId, base = 120): number {
  const index = order.indexOf(id);
  return base + (index < 0 ? 0 : index);
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function clampWindowPosition(position: WindowPosition, size: WindowSize, viewport: WindowViewport): WindowPosition {
  const width = Math.min(Math.max(1, size.width), Math.max(1, viewport.width));
  const height = Math.min(Math.max(1, size.height), Math.max(1, viewport.height - WINDOW_CHROME.header - WINDOW_CHROME.footer));
  const minY = Math.min(WINDOW_CHROME.header, Math.max(0, viewport.height - WINDOW_CHROME.footer - height));
  return {
    x: clamp(Number.isFinite(position.x) ? position.x : 0, 0, Math.max(0, viewport.width - width)),
    y: clamp(Number.isFinite(position.y) ? position.y : minY, minY, Math.max(minY, viewport.height - WINDOW_CHROME.footer - height)),
  };
}

export function recoverWindowLayout(
  layout: WindowLayout,
  viewport: WindowViewport,
  minWidth = 280,
  minHeight = 220,
): WindowLayout {
  const maxWidth = Math.max(minWidth, viewport.width);
  const maxHeight = Math.max(minHeight, viewport.height - WINDOW_CHROME.header - WINDOW_CHROME.footer);
  const width = clamp(Number.isFinite(layout.size.width) ? layout.size.width : minWidth, minWidth, maxWidth);
  const height = clamp(Number.isFinite(layout.size.height) ? layout.size.height : minHeight, minHeight, maxHeight);
  const maxX = Math.max(0, viewport.width - width);
  const minY = Math.min(WINDOW_CHROME.header, Math.max(0, viewport.height - WINDOW_CHROME.footer - height));
  const maxY = Math.max(minY, viewport.height - WINDOW_CHROME.footer - height);
  return {
    position: {
      x: clamp(Number.isFinite(layout.position.x) ? layout.position.x : 0, 0, maxX),
      y: clamp(Number.isFinite(layout.position.y) ? layout.position.y : WINDOW_CHROME.header, minY, maxY),
    },
    size: { width, height },
  };
}

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
  const minTop = WINDOW_CHROME.header;
  const maxBottom = Math.max(minTop + minHeight, viewport.height - WINDOW_CHROME.footer);
  const rightEdge = Math.min(viewport.width, position.x + size.width);
  const bottomEdge = Math.min(maxBottom, position.y + size.height);
  let left = position.x;
  let top = position.y;
  let right = rightEdge;
  let bottom = bottomEdge;

  if (direction.includes('e')) right = clamp(right + dx, left + minWidth, Math.max(left + minWidth, viewport.width));
  if (direction.includes('s')) bottom = clamp(bottom + dy, top + minHeight, maxBottom);
  if (direction.includes('w')) left = clamp(left + dx, 0, right - minWidth);
  if (direction.includes('n')) top = clamp(top + dy, minTop, bottom - minHeight);

  const resized = recoverWindowLayout(
    { position: { x: left, y: top }, size: { width: right - left, height: bottom - top } },
    viewport,
    minWidth,
    minHeight,
  );
  return resized;
}

export function getDefaultWindowLayouts(viewport: WindowViewport): Record<'main-canvas' | 'component-canvas' | 'node-logic', WindowLayout> {
  const mainSize = {
    width: Math.min(860, viewport.width * 0.78),
    height: Math.min(620, (viewport.height - WINDOW_CHROME.header - WINDOW_CHROME.footer) * 0.86),
  };
  const componentSize = {
    width: Math.min(680, viewport.width * 0.72),
    height: Math.min(500, (viewport.height - WINDOW_CHROME.header - WINDOW_CHROME.footer) * 0.72),
  };
  const logicSize = {
    width: Math.min(720, viewport.width * 0.74),
    height: Math.min(540, (viewport.height - WINDOW_CHROME.header - WINDOW_CHROME.footer) * 0.78),
  };
  return {
    'main-canvas': recoverWindowLayout({ position: { x: 48, y: 80 }, size: mainSize }, viewport),
    'component-canvas': recoverWindowLayout({
      position: { x: Math.max(24, viewport.width - componentSize.width - 48), y: 112 },
      size: componentSize,
    }, viewport),
    'node-logic': recoverWindowLayout({
      position: { x: Math.max(40, Math.round((viewport.width - logicSize.width) * 0.18)), y: 146 },
      size: logicSize,
    }, viewport),
  };
}
