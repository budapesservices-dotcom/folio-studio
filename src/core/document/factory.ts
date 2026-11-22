import {
  FOLIO_FORMAT,
  FOLIO_FORMAT_VERSION,
  type DesignNode,
  type EllipseNode,
  type FolioDocument,
  type FolioProject,
  type RectNode,
  type TextNode,
} from './types';

function createId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function baseNode(name: string, x: number, y: number, width: number, height: number) {
  return {
    id: createId('node'),
    name,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    onCanvas: true,
  };
}

export function createRectNode(index = 0): RectNode {
  return {
    ...baseNode('Rectangle', 300 + index * 22, 250 + index * 18, 280, 180),
    type: 'rect',
    style: { fill: '#8B7CF6', stroke: '#00000000', strokeWidth: 0, radius: 18 },
  };
}

export function createEllipseNode(index = 0): EllipseNode {
  return {
    ...baseNode('Ellipse', 340 + index * 22, 280 + index * 18, 220, 220),
    type: 'ellipse',
    style: { fill: '#F29C78', stroke: '#00000000', strokeWidth: 0 },
  };
}

export function createTextNode(index = 0): TextNode {
  return {
    ...baseNode('Text', 260 + index * 18, 320 + index * 18, 560, 100),
    type: 'text',
    text: 'Your next idea starts here',
    style: {
      fill: '#20212A',
      fontSize: 54,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 600,
      letterSpacing: -1.5,
      lineHeight: 1.12,
    },
  };
}

export function createNode(type: 'rect' | 'ellipse' | 'text', index = 0): Exclude<DesignNode, { type: 'component-instance' }> {
  switch (type) {
    case 'rect':
      return createRectNode(index);
    case 'ellipse':
      return createEllipseNode(index);
    case 'text':
      return createTextNode(index);
  }
}

/**
 * Creates a new primitive node positioned and sized cleanly inside the target
 * document's artboard coordinate system. Standard desktop pages retain classic
 * placement; compact artboards (such as Component Canvas) center and fit shapes
 * inside the visible frame with a small deterministic stagger.
 */
export function createNodeForDocument(
  type: 'rect' | 'ellipse' | 'text',
  document: Pick<FolioDocument, 'width' | 'height' | 'nodes'> & Partial<Pick<FolioDocument, 'background'>>,
): Exclude<DesignNode, { type: 'component-instance' }> {
  const index = document.nodes.length;
  const node = createNode(type, index);
  const docWidth = Math.max(1, document.width);
  const docHeight = Math.max(1, document.height);
  const margin = Math.min(24, Math.floor(Math.min(docWidth, docHeight) * 0.08));
  const maxWidth = Math.max(16, docWidth - margin * 2);
  const maxHeight = Math.max(16, docHeight - margin * 2);

  const fitsNaturally =
    node.x >= 0 &&
    node.y >= 0 &&
    node.x + node.width <= docWidth &&
    node.y + node.height <= docHeight;

  if (fitsNaturally && docWidth >= 900 && docHeight >= 600) {
    return node;
  }

  let width = node.width;
  let height = node.height;
  if (type === 'rect') {
    width = Math.min(node.width, Math.max(48, Math.round(docWidth * 0.56)), maxWidth);
    height = Math.min(node.height, Math.max(36, Math.round(docHeight * 0.48)), maxHeight);
  } else if (type === 'ellipse') {
    const diameter = Math.min(node.width, Math.max(48, Math.round(Math.min(docWidth, docHeight) * 0.52)), maxWidth, maxHeight);
    width = diameter;
    height = diameter;
  } else {
    width = Math.min(node.width, Math.max(80, Math.round(docWidth * 0.78)), maxWidth);
    height = Math.min(node.height, Math.max(32, Math.round(docHeight * 0.24)), maxHeight);
  }

  const stagger = (index % 5) * Math.min(14, Math.max(4, Math.floor(margin * 0.6)));
  const centeredX = Math.round((docWidth - width) / 2) + stagger;
  const centeredY = Math.round((docHeight - height) / 2) + stagger;
  const maxX = Math.max(0, docWidth - width);
  const maxY = Math.max(0, docHeight - height);
  const x = Math.min(maxX, Math.max(Math.min(margin, maxX), centeredX));
  const y = Math.min(maxY, Math.max(Math.min(margin, maxY), centeredY));

  if (node.type === 'text') {
    const scale = Math.min(1, width / 840, height / 180);
    const fontSize = Math.max(16, Math.min(20, Math.round(node.style.fontSize * scale)));
    const isTransparentArtboard =
      document.background === '#00000000' || document.background === 'transparent';
    return {
      ...node,
      x,
      y,
      width,
      height,
      style: {
        ...node.style,
        fill: isTransparentArtboard ? '#F3F5FA' : node.style.fill,
        fontSize,
        letterSpacing: Number((node.style.letterSpacing * scale).toFixed(2)),
      },
    };
  }

  if (node.type === 'rect' && node.style.radius !== undefined) {
    return {
      ...node,
      x,
      y,
      width,
      height,
      style: {
        ...node.style,
        radius: Math.min(node.style.radius, Math.floor(Math.min(width, height) / 3)),
      },
    };
  }

  return { ...node, x, y, width, height };
}

export function createEmptyDocument(name = 'Main Page', width = 1440, height = 900): FolioDocument {
  return {
    id: createId('document'),
    name,
    width,
    height,
    background: '#F5F2EC',
    nodes: [],
  };
}

export function createInitialProject(name = 'Untitled project'): FolioProject {
  const now = new Date().toISOString();
  const title: TextNode = {
    ...baseNode('Hero title', 112, 290, 700, 220),
    type: 'text',
    text: 'Ideas become\ninterfaces.',
    style: {
      fill: '#20212A',
      fontSize: 92,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 700,
      letterSpacing: -4,
      lineHeight: 1.02,
    },
  };

  const eyebrow: TextNode = {
    ...baseNode('Eyebrow', 118, 150, 420, 28),
    type: 'text',
    text: 'FOLIO  /  CREATIVE CANVAS',
    style: {
      fill: '#7C7067',
      fontSize: 17,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 700,
      letterSpacing: 3.5,
      lineHeight: 1.2,
    },
  };

  const description: TextNode = {
    ...baseNode('Description', 120, 565, 520, 90),
    type: 'text',
    text: 'A space to shape the things\nyou have not imagined yet.',
    style: {
      fill: '#746D67',
      fontSize: 25,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 400,
      letterSpacing: 0,
      lineHeight: 1.35,
    },
  };

  const visualCard: RectNode = {
    ...baseNode('Visual card', 850, 155, 465, 590),
    type: 'rect',
    style: { fill: '#D8C6AD', stroke: '#00000000', strokeWidth: 0, radius: 28 },
  };

  const orbit: EllipseNode = {
    ...baseNode('Orbit', 925, 238, 315, 315),
    type: 'ellipse',
    style: { fill: '#B3A0E5', stroke: '#00000000', strokeWidth: 0 },
  };

  const sun: EllipseNode = {
    ...baseNode('Sun', 1060, 352, 145, 145),
    type: 'ellipse',
    style: { fill: '#F4B27D', stroke: '#00000000', strokeWidth: 0 },
  };

  const cardCaption: TextNode = {
    ...baseNode('Card caption', 900, 670, 360, 30),
    type: 'text',
    text: 'FORM  /  LIGHT  /  MOTION',
    style: {
      fill: '#51463D',
      fontSize: 14,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 700,
      letterSpacing: 2.3,
      lineHeight: 1.2,
    },
  };

  return {
    format: FOLIO_FORMAT,
    formatVersion: FOLIO_FORMAT_VERSION,
    appVersion: '0.1.0',
    metadata: {
      id: createId('project'),
      name,
      createdAt: now,
      updatedAt: now,
    },
    activePageId: 'page-main',
    pages: [{
      id: 'page-main',
      name: 'Main Page',
      route: '/',
      document: {
        id: createId('document'),
        name: 'Main Page',
        width: 1440,
        height: 900,
        background: '#F5F2EC',
        nodes: [visualCard, orbit, sun, eyebrow, title, description, cardCaption],
      },
    }],
    components: [],
    logicGraphs: [],
    assets: [],
  };
}