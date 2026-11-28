import { describe, expect, it } from 'vitest';
import { createInitialProject, createTextNode } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { DesignTokenDefinition } from '../src/core/document/types';
import { createTokenId } from '../src/app/workspace/TokensPanel';
import { resolveOpaqueExportBackground } from '../src/engines/animation/videoExport';
import appSource from '../src/app/App.tsx?raw';
import storesSource from '../src/app/useWorkspaceStores.ts?raw';
import shortcutsSource from '../src/app/workspace/useWorkspaceShortcuts.ts?raw';
import chromeSource from '../src/app/workspace/useWorkspaceChromeActions.ts?raw';

describe('Audit fixes regression suite', () => {
  it('generates clean fallback IDs for non-alphanumeric design token names and avoids collisions', () => {
    const existing: DesignTokenDefinition[] = [
      {
        id: 'tok-custom',
        name: 'Custom',
        layer: 'semantic',
        category: 'color',
        value: { kind: 'literal', value: '#7C6FF6' },
      },
      {
        id: 'tok-brand-primary',
        name: 'Brand Primary',
        layer: 'semantic',
        category: 'color',
        value: { kind: 'literal', value: '#7C6FF6' },
      },
    ];

    expect(createTokenId('!!!', [])).toBe('tok-custom');
    expect(createTokenId('---', existing)).toBe('tok-custom-2');
    expect(createTokenId('Brand Primary', existing)).toBe('tok-brand-primary-2');
    expect(createTokenId('Accent Soft', existing)).toBe('tok-accent-soft');
  });

  it('picks a contrast-safe opaque export background for transparent artboards', () => {
    const project = createInitialProject('Opaque Contrast');
    const page = getActivePage(project);

    // Explicit opaque background is preserved verbatim.
    expect(resolveOpaqueExportBackground({ ...page.document, background: '#F5F2EC' })).toBe('#F5F2EC');

    // Transparent artboard with dark text (starter default) uses crisp light backdrop.
    const baseDark = createTextNode(0);
    const darkText = { ...baseDark, style: { ...baseDark.style, fill: '#20212A' } };
    expect(resolveOpaqueExportBackground({ ...page.document, background: '#00000000', nodes: [darkText] })).toBe('#FFFFFF');
    expect(resolveOpaqueExportBackground({ ...page.document, background: 'transparent', nodes: [darkText] })).toBe('#FFFFFF');

    // Transparent artboard with bright light text switches to dark studio backdrop.
    const baseLight = createTextNode(1);
    const lightText = { ...baseLight, style: { ...baseLight.style, fill: '#F8FAFC' } };
    expect(resolveOpaqueExportBackground({ ...page.document, background: '#00000000', nodes: [lightText] })).toBe('#12161A');
  });

  it('preserves Component Canvas 420x280 startup dimensions, modal shortcut guards, and exclusive rack panel toggles', () => {
    expect(storesSource).toContain('page.document.width = 420;');
    expect(storesSource).toContain('page.document.height = 280;');
    expect(appSource).toContain('diagnosticsModalOpen: dialogs.diagnosticsModalOpen');
    expect(appSource).toContain('motionExportOpen: toolShell.motionExportOpen');

    expect(shortcutsSource).toContain('|| diagnosticsModalOpen');
    expect(shortcutsSource).toContain('|| motionExportOpen');

    expect(chromeSource).toContain("} else if (panel === 'pages') {\n      togglePagesRack();");
    expect(chromeSource).toContain("} else if (panel === 'components') {\n      toggleComponentRack();");
    expect(chromeSource).toContain("} else if (panel === 'motion') {\n      toggleMotionTimeline();");
  });
});
