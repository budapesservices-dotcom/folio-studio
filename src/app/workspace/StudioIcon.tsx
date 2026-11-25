import type { DesignNode } from '../../core/document/types';

export const STUDIO_ICON_PATHS: Record<string, string> = {
  cursor: 'M5 3l14 9-6 1.5L10 20 5 3z',
  directSelection: 'M4 3l15 10-6 1 4 7-3 1-4-7-4 5z',
  lasso: 'M12 3c5 0 9 3 9 7s-4 8-9 8-9-3-9-7 4-8 9-8zM5 19l-1 2m6-1-1 2m7-3 1 2',
  magicWand: 'm4 20 12-12m-9 9 3 3m5-17v4m-2-2h4m5 7v4m-2-2h4m-9 5v3m-2-1h4',
  hand: 'M8 11V5a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 4-2 7-6 7h-2c-2 0-3-1-4-3l-3-4a2 2 0 0 1 3-3z',
  scrubbyZoom: 'M5 12h14m-5-5 5 5-5 5M9 7 4 12l5 5',
  shapes: 'M4 5h8v8H4zM15 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 17h16',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  text: 'M4 5h16M12 5v14M8 19h8',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  export: 'M12 3v12m0-12 4 4m-4-4-4 4M5 14v6h14v-6',
  import: 'M12 15V3m0 12 4-4m-4 4-4-4M5 14v6h14v-6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2',
  redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.9M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9 9 0 0 0 3.2-.6',
  lock: 'M5 10h14v11H5zM8 10V7a4 4 0 1 1 8 0v3',
  unlock: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 7.5-2',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  chevron: 'm9 18 6-6-6-6',
  clipArrow: 'M20 4H8V16m-4-4 4 4 4-4',
  save: 'M5 4h12l3 3v13H4V4h1zm2 0v6h10V4M8 20v-7h8v7',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  sidebar: 'M4 4h16v16H4zM9 4v16',
  canvas: 'M3 4h18v16H3zM7 8h10v8H7z',
  componentCanvas: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  logicNodes: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h3a3 3 0 0 1 3 3v4',
  inspector: 'M4 4h16v16H4zM15 4v16',
  rack: 'M3 5h18v14H3zM7 9h4v6H7zM14 9h3M14 12h3M14 15h3',
  pages: 'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8',
  edit: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l4 4',
  copyPlus: 'M8 8h11v11H8zM5 16H4V4h12v1M13.5 11v5M11 13.5h5',
  scale: 'M4 15v5h5M20 9V4h-5M4 20l6-6M20 4l-6 6',
  frame: 'M7 3v18M17 3v18M3 7h18M3 17h18',
  section: 'M4 6h7l2 2h7v10H4V6z',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5M11 5h8v8',
  polygon: 'M12 3l8 5v8l-8 5-8-5V8l8-5z',
  star: 'm12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.1L12 17l-5.5 3 1.1-6.1-4.5-4.4 6.2-.9L12 3z',
  pen: 'm12 19 7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.5 7.5M11 11a1.5 1.5 0 1 0 0 .01',
  curvature: 'M4 18C4 10 10 6 20 6M4 18a1.5 1.5 0 1 0 0 .01M20 6a1.5 1.5 0 1 0 0 .01M10 9a1.5 1.5 0 1 0 0 .01',
  anchorPoint: 'M4 17 12 6l8 11M10 17h4',
  pencil: 'M4 20l3.5-1 11-11a2 2 0 0 0-2.8-2.8l-11 11L4 20zM13.5 6.5l4 4',
  brush: 'M18.5 3.5a2.1 2.1 0 0 1 2 2c0 .6-.2 1.1-.6 1.5l-8.4 8.4-3-3 8.4-8.4c.4-.4 1-.5 1.6-.5zM8.5 12.5c-2.2.2-3.5 1.7-3.8 3.6-.3 1.4-1.2 2.4-2.2 2.9 1.6.9 4.5 1.2 6.6-.4 1.3-1 1.9-2.4 1.9-3.6l-2.5-2.5z',
  eraser: 'M15.5 4.5 20 9l-8.5 8.5a2 2 0 0 1-2.8 0L4.5 13.3a2 2 0 0 1 0-2.8L12.7 4.5a2 2 0 0 1 2.8 0zM9.2 10.2l5.6 5.6M11 20h9',
  paintBucket: 'M19 11 11 3 3.6 10.4a2 2 0 0 0 0 2.8l4.2 4.2a2 2 0 0 0 2.8 0L19 11zM7 7l6 6M19.5 14.5c1.4 1.8 2 3 2 4a2.5 2.5 0 0 1-5 0c0-1 .6-2.2 2-4l.5-.7.5.7z',
  smooth: 'M3 16c3-7 6-7 9 0s6 7 9 0',
  scissors: 'M6 7a2.5 2.5 0 1 0 0 .01M6 17a2.5 2.5 0 1 0 0 .01M8.2 8.4 20 17M8.2 15.6 20 7',
  shapeBuilder: 'M9 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6-4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM16 17h4m-2-2v4',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  eyedropper: 'm19 5-4 4m-1-5 6 6m-7-4-8.5 8.5a2 2 0 0 0-.5 1.1L3 21l5.4-1a2 2 0 0 0 1.1-.5L18 11',
  measure: 'M3 16 16 3l5 5L8 21 3 16zM8 11l2 2M11 8l2 2M14 5l2 2',
  templates: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm3 4h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h4m3 0h1M7 16h10',
  tokens: 'M12 3 4 9l8 6 8-6-8-6zM4 15l8 6 8-6',
  desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
  tablet: 'M6 3h12v18H6zM11 18h2',
  mobile: 'M8 3h8v18H8zM11 18h2',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4m-5-11-2 14',
  preview: 'M4 5h16v14H4zM4 9h16M10 14l4-2-4-2v4z',
  motion: 'M3 7h18M3 12h18M3 17h18M9 7l2-2 2 2-2 2-2-2zm6 5l2-2 2 2-2 2-2-2zm-8 5l2-2 2 2-2 2-2-2z',
  play: 'M7 5l12 7-12 7V5z',
  pause: 'M7 5h3v14H7V5zm7 0h3v14h-3V5z',
  stop: 'M6 6h12v12H6V6z',
  loop: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  autoArrange: 'M3 9h5v6H3zM16 4h5v5h-5zM16 15h5v5h-5zM8 12h4m0-5.5h4M12 6.5v11h4',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 11 4.5-4.5L12 15l3.5-3.5L20 16M9 9.5a1.5 1.5 0 1 0 0 .01',
  sun: 'M12 3v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
};

export function StudioIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-svg">
      <path d={STUDIO_ICON_PATHS[name] ?? STUDIO_ICON_PATHS.layers} />
    </svg>
  );
}

export function LayerTypeIcon({ type }: { type: DesignNode['type'] }) {
  const glyph =
    type === 'group' ? '▣'
      : type === 'frame' ? '⊞'
      : type === 'path' ? '∿'
      : type === 'text' ? 'T'
      : type === 'image' ? '◫'
      : type === 'ellipse' ? '○'
      : type === 'component-instance' ? '◇'
      : '□';
  return <span class={`layer-type layer-type-${type}`}>{glyph}</span>;
}
