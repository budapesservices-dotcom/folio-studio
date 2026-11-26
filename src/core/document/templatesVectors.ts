import {
  makeEllipse,
  makeFrame,
  makePath,
  makeRect,
  makeText,
  type StudioTemplateDefinition,
} from './templatesHelpers';

export const VECTOR_STARTER_TEMPLATES: readonly StudioTemplateDefinition[] = [
  {
    id: 'vector-logo-mark',
    name: 'Geometric Logo Mark',
    category: 'vectors',
    summary: 'Layered diamond crest and inner ring built from editable vector primitives.',
    keywords: ['logo', 'brand', 'crest', 'diamond', 'icon', 'vector', 'mark', 'emblem'],
    width: 180,
    height: 180,
    previewSurface: 'dark',
    buildNodes: (origin, makeId) => {
      const rootId = makeId('logo-root');
      const root = makeFrame(rootId, 'Geometric Logo Mark', origin.x, origin.y, 180, 180, {
        fill: '#0f172a',
        stroke: '#334155',
        strokeWidth: 1.5,
        radius: 36,
        clipContent: true,
      });
      const outer = makePath(
        makeId('logo-outer'),
        'Outer Diamond',
        [
          { x: origin.x + 90, y: origin.y + 24, type: 'corner' },
          { x: origin.x + 152, y: origin.y + 90, type: 'corner' },
          { x: origin.x + 90, y: origin.y + 156, type: 'corner' },
          { x: origin.x + 28, y: origin.y + 90, type: 'corner' },
        ],
        {
          parentId: rootId,
          closed: true,
          fill: '#1e293b',
          stroke: '#38bdf8',
          strokeWidth: 4,
        },
      );
      const inner = makePath(
        makeId('logo-inner'),
        'Inner Facet',
        [
          { x: origin.x + 90, y: origin.y + 46, type: 'corner' },
          { x: origin.x + 130, y: origin.y + 90, type: 'corner' },
          { x: origin.x + 90, y: origin.y + 134, type: 'corner' },
          { x: origin.x + 50, y: origin.y + 90, type: 'corner' },
        ],
        {
          parentId: rootId,
          closed: true,
          fill: '#6366f1',
          stroke: '#a5b4fc',
          strokeWidth: 2,
        },
      );
      const core = makeEllipse(makeId('logo-core'), 'Center Core', origin.x + 74, origin.y + 74, 32, 32, {
        parentId: rootId,
        fill: '#f8fafc',
      });
      return [root, outer, inner, core];
    },
  },
  {
    id: 'vector-app-icon',
    name: 'App Icon Base',
    category: 'vectors',
    summary: 'Squircle app icon tile with layered ribbon fold and soft highlight dot.',
    keywords: ['app', 'icon', 'ios', 'tile', 'squircle', 'vector', 'launcher'],
    width: 160,
    height: 160,
    previewSurface: 'dark',
    buildNodes: (origin, makeId) => {
      const rootId = makeId('appicon-root');
      const root = makeFrame(rootId, 'App Icon Base', origin.x, origin.y, 160, 160, {
        fill: '#1e1b4b',
        stroke: '#6366f1',
        strokeWidth: 2,
        radius: 36,
        clipContent: true,
      });
      const backRibbon = makePath(
        makeId('appicon-ribbon-a'),
        'Back Ribbon',
        [
          { x: origin.x + 36, y: origin.y + 114, type: 'corner' },
          { x: origin.x + 72, y: origin.y + 44, type: 'corner' },
          { x: origin.x + 124, y: origin.y + 44, type: 'corner' },
          { x: origin.x + 88, y: origin.y + 114, type: 'corner' },
        ],
        { parentId: rootId, closed: true, fill: '#4f46e5', stroke: 'none', strokeWidth: 0 },
      );
      const frontRibbon = makePath(
        makeId('appicon-ribbon-b'),
        'Front Ribbon',
        [
          { x: origin.x + 56, y: origin.y + 116, type: 'corner' },
          { x: origin.x + 92, y: origin.y + 56, type: 'corner' },
          { x: origin.x + 128, y: origin.y + 116, type: 'corner' },
        ],
        { parentId: rootId, closed: true, fill: '#38bdf8', stroke: '#e0f2fe', strokeWidth: 2 },
      );
      const highlight = makeEllipse(makeId('appicon-dot'), 'Accent Dot', origin.x + 36, origin.y + 34, 22, 22, {
        parentId: rootId,
        fill: '#f472b6',
      });
      return [root, backRibbon, frontRibbon, highlight];
    },
  },
  {
    id: 'vector-ui-badge',
    name: 'Verified Ribbon Badge',
    category: 'vectors',
    summary: 'Vector rosette emblem with checkmark glyph and label strip.',
    keywords: ['badge', 'seal', 'verified', 'award', 'ribbon', 'check', 'vector'],
    width: 180,
    height: 180,
    previewSurface: 'dark',
    buildNodes: (origin, makeId) => {
      const rootId = makeId('badge-root');
      const root = makeFrame(rootId, 'Verified Ribbon Badge', origin.x, origin.y, 180, 180, {
        fill: '#0f172a',
        stroke: '#1e293b',
        strokeWidth: 1,
        radius: 20,
      });
      const ring = makeEllipse(makeId('badge-ring'), 'Outer Ring', origin.x + 32, origin.y + 20, 116, 116, {
        parentId: rootId,
        fill: '#064e3b',
        stroke: '#34d399',
        strokeWidth: 4,
      });
      const check = makePath(
        makeId('badge-check'),
        'Check Mark',
        [
          { x: origin.x + 66, y: origin.y + 78, type: 'corner' },
          { x: origin.x + 84, y: origin.y + 96, type: 'corner' },
          { x: origin.x + 116, y: origin.y + 60, type: 'corner' },
        ],
        { parentId: rootId, closed: false, fill: 'none', stroke: '#ecfdf5', strokeWidth: 7 },
      );
      const strip = makeRect(makeId('badge-strip'), 'Label Strip', origin.x + 36, origin.y + 132, 108, 28, {
        parentId: rootId,
        fill: '#10b981',
        radius: 14,
      });
      const label = makeText(makeId('badge-label'), 'Label Text', 'VERIFIED', origin.x + 42, origin.y + 138, 96, 18, {
        parentId: rootId,
        fill: '#022c22',
        fontSize: 11,
        fontWeight: 800,
        textAlign: 'center',
      });
      return [root, ring, check, strip, label];
    },
  },
  {
    id: 'vector-play-button',
    name: 'Media Play Emblem',
    category: 'vectors',
    summary: 'Concentric circular play emblem with crisp vector triangle glyph.',
    keywords: ['play', 'media', 'video', 'audio', 'button', 'triangle', 'vector'],
    width: 160,
    height: 160,
    previewSurface: 'dark',
    buildNodes: (origin, makeId) => {
      const rootId = makeId('play-root');
      const root = makeFrame(rootId, 'Media Play Emblem', origin.x, origin.y, 160, 160, {
        fill: '#111827',
        stroke: '#1f2937',
        strokeWidth: 1,
        radius: 80,
      });
      const halo = makeEllipse(makeId('play-halo'), 'Outer Halo', origin.x + 16, origin.y + 16, 128, 128, {
        parentId: rootId,
        fill: '#1d4ed8',
        opacity: 0.28,
      });
      const disc = makeEllipse(makeId('play-disc'), 'Play Disc', origin.x + 32, origin.y + 32, 96, 96, {
        parentId: rootId,
        fill: '#2563eb',
        stroke: '#93c5fd',
        strokeWidth: 2,
      });
      const glyph = makePath(
        makeId('play-glyph'),
        'Play Triangle',
        [
          { x: origin.x + 68, y: origin.y + 56, type: 'corner' },
          { x: origin.x + 106, y: origin.y + 80, type: 'corner' },
          { x: origin.x + 68, y: origin.y + 104, type: 'corner' },
        ],
        { parentId: rootId, closed: true, fill: '#ffffff', stroke: 'none', strokeWidth: 0 },
      );
      return [root, halo, disc, glyph];
    },
  },
  {
    id: 'vector-wave-banner',
    name: 'Abstract Wave Ribbon',
    category: 'vectors',
    summary: 'Layered Bezier wave illustration ready for hero art or custom masks.',
    keywords: ['wave', 'bezier', 'curve', 'illustration', 'abstract', 'ribbon', 'vector'],
    width: 320,
    height: 160,
    previewSurface: 'dark',
    buildNodes: (origin, makeId) => {
      const rootId = makeId('wave-root');
      const root = makeFrame(rootId, 'Abstract Wave Ribbon', origin.x, origin.y, 320, 160, {
        fill: '#0b1120',
        stroke: '#1e293b',
        strokeWidth: 1,
        radius: 16,
        clipContent: true,
      });
      const backWave = makePath(
        makeId('wave-back'),
        'Back Wave',
        [
          { x: origin.x, y: origin.y + 108, type: 'smooth', handleOut: { x: origin.x + 70, y: origin.y + 44 } },
          {
            x: origin.x + 164,
            y: origin.y + 86,
            type: 'smooth',
            handleIn: { x: origin.x + 114, y: origin.y + 124 },
            handleOut: { x: origin.x + 218, y: origin.y + 48 },
          },
          { x: origin.x + 320, y: origin.y + 72, type: 'corner' },
          { x: origin.x + 320, y: origin.y + 160, type: 'corner' },
          { x: origin.x, y: origin.y + 160, type: 'corner' },
        ],
        { parentId: rootId, closed: true, fill: '#312e81', stroke: '#6366f1', strokeWidth: 2 },
      );
      const frontWave = makePath(
        makeId('wave-front'),
        'Front Wave',
        [
          { x: origin.x, y: origin.y + 124, type: 'smooth', handleOut: { x: origin.x + 86, y: origin.y + 82 } },
          {
            x: origin.x + 184,
            y: origin.y + 116,
            type: 'smooth',
            handleIn: { x: origin.x + 132, y: origin.y + 146 },
            handleOut: { x: origin.x + 240, y: origin.y + 88 },
          },
          { x: origin.x + 320, y: origin.y + 106, type: 'corner' },
          { x: origin.x + 320, y: origin.y + 160, type: 'corner' },
          { x: origin.x, y: origin.y + 160, type: 'corner' },
        ],
        { parentId: rootId, closed: true, fill: '#0ea5e9', stroke: '#7dd3fc', strokeWidth: 2, opacity: 0.9 },
      );
      const orb = makeEllipse(makeId('wave-orb'), 'Glow Orb', origin.x + 244, origin.y + 24, 42, 42, {
        parentId: rootId,
        fill: '#f43f5e',
        opacity: 0.9,
      });
      return [root, backWave, frontWave, orb];
    },
  },
];
