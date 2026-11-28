import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  buildComponentDefinitionFromNodes,
  createComponentInstance,
  createComponentSlot,
} from '../src/core/document/components';
import {
  createFrameNode,
  createInitialProject,
  createRectNode,
  createTextNode,
} from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import { compilePageHtmlCss } from '../src/engines/codegen/htmlCssCompiler';
import { compileReactProjectFiles } from '../src/engines/codegen/reactCompiler';
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  buildZipArchive,
  computeCrc32,
  parseZipArchive,
} from '../src/engines/codegen/zipArchive';

describe('ENG-04 — Void HTML Element Codegen Safety (HTML/CSS + React TSX)', () => {
  it('never emits closing tags or children on void elements (<input>, <img>) in HTML/CSS or React TSX', () => {
    const project = createInitialProject('Void Element Safety');
    const page = getActivePage(project);

    const textInput = {
      ...createTextNode(0),
      id: 'txt-input',
      name: 'Email Field',
      semanticTag: 'input' as const,
      text: 'alice@folio.dev',
    };
    const textImg = {
      ...createTextNode(1),
      id: 'txt-img',
      name: 'Avatar Caption',
      semanticTag: 'img' as const,
      text: 'User Avatar',
    };
    const emptyInputRect = {
      ...createRectNode(2),
      id: 'rect-input',
      name: 'Search Input',
      semanticTag: 'input' as const,
    };
    const parentInputFrame = {
      ...createFrameNode(3),
      id: 'frame-input-wrapper',
      name: 'Wrapped Frame',
      semanticTag: 'input' as const,
    };
    const childInsideInputFrame = {
      ...createTextNode(4),
      id: 'child-label',
      name: 'Child Label',
      parentId: 'frame-input-wrapper',
      text: 'Nested Label',
    };

    // Master component with void-tagged text & slot nodes
    const compInputText = {
      ...createTextNode(0),
      id: 'c-input',
      name: 'Field Text',
      semanticTag: 'input' as const,
      text: 'Default Value',
    };
    const compEmptySlot = {
      ...createRectNode(1),
      id: 'c-slot-input',
      name: 'Slot Field',
      semanticTag: 'input' as const,
    };
    const master = buildComponentDefinitionFromNodes(
      [compInputText, compEmptySlot],
      ['c-input', 'c-slot-input'],
      'InputCard',
      { id: 'comp-input-card', now: '2026-01-01T00:00:00.000Z' },
    );
    if (!master) {
      throw new Error('Expected test master component definition');
    }
    master.slots = [createComponentSlot('Field Slot', 'c-slot-input', { id: 'slot-field' })];
    project.components = [master];

    const instance = createComponentInstance(master, 40, 260, 'inst-input-card');
    page.document.nodes = [
      textInput,
      textImg,
      emptyInputRect,
      parentInputFrame,
      childInsideInputFrame,
      instance,
    ];

    const pageHtml = compilePageHtmlCss(project, page).htmlFile.content;
    expect(pageHtml).not.toMatch(/<\/input>/i);
    expect(pageHtml).not.toMatch(/<\/img>/i);
    expect(pageHtml).toContain('data-folio-id="txt-input"');
    expect(pageHtml).toContain('value="alice@folio.dev"');
    expect(pageHtml).toMatch(/<div class="[^"]+" data-folio-id="frame-input-wrapper">/);

    const reactFiles = compileReactProjectFiles(project);
    const pageTsx = reactFiles.find((file) => file.path.startsWith('src/pages/') && file.path.endsWith('.tsx'))?.content ?? '';
    const compTsx = reactFiles.find((file) => file.path.startsWith('src/components/') && file.path.endsWith('.tsx'))?.content ?? '';

    for (const [label, source] of [
      ['pageTsx', pageTsx],
      ['compTsx', compTsx],
    ] as const) {
      expect(source, `${label} must not emit </input>`).not.toMatch(/<\/input>/i);
      expect(source, `${label} must not emit </img>`).not.toMatch(/<\/img>/i);
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
        },
        reportDiagnostics: true,
      });
      expect(transpiled.diagnostics ?? [], `${label} must be syntactically valid TSX`).toHaveLength(0);
    }
    expect(pageTsx).toContain('defaultValue="alice@folio.dev"');
    expect(compTsx).toContain('<input ');
    expect(compTsx).toContain('defaultValue=');
  });
});

describe('SEC-02 — ZIP Archive Parser & Builder Hardening', () => {
  it('rejects Store-mode overlapping-offset ZIP bombs before payload extraction', () => {
    const payload = new Uint8Array(64 * 1024).fill(65);
    const crc = computeCrc32(payload);
    const localName = new TextEncoder().encode('a.bin');

    const localHeaderSize = 30 + localName.length + payload.length;
    const entryCount = 4;
    const centralRecords: Uint8Array[] = [];
    let centralSize = 0;

    for (let i = 0; i < entryCount; i += 1) {
      const nameBytes = new TextEncoder().encode(`dup-${i}.bin`);
      const rec = new Uint8Array(46 + nameBytes.length);
      const v = new DataView(rec.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, payload.length, true);
      v.setUint32(24, payload.length, true);
      v.setUint16(28, nameBytes.length, true);
      v.setUint32(42, 0, true); // All central entries alias localOffset = 0!
      rec.set(nameBytes, 46);
      centralRecords.push(rec);
      centralSize += rec.length;
    }

    const totalSize = localHeaderSize + centralSize + 22;
    const bomb = new Uint8Array(totalSize);
    const bv = new DataView(bomb.buffer);
    bv.setUint32(0, 0x04034b50, true);
    bv.setUint16(4, 20, true);
    bv.setUint16(6, 0x0800, true);
    bv.setUint16(8, 0, true);
    bv.setUint32(14, crc, true);
    bv.setUint32(18, payload.length, true);
    bv.setUint32(22, payload.length, true);
    bv.setUint16(26, localName.length, true);
    bomb.set(localName, 30);
    bomb.set(payload, 30 + localName.length);

    let offset = localHeaderSize;
    for (const rec of centralRecords) {
      bomb.set(rec, offset);
      offset += rec.length;
    }
    bv.setUint32(offset, 0x06054b50, true);
    bv.setUint16(offset + 8, entryCount, true);
    bv.setUint16(offset + 10, entryCount, true);
    bv.setUint32(offset + 12, centralSize, true);
    bv.setUint32(offset + 16, localHeaderSize, true);

    expect(() => parseZipArchive(bomb)).toThrow(/overlapping entry payload ranges/i);
  });

  it('rejects archives declaring more entries than MAX_ZIP_ENTRIES and preserves valid round-trips', () => {
    const validZip = buildZipArchive([
      { path: 'index.html', content: '<!doctype html><title>OK</title>' },
      { path: 'styles/main.css', content: 'body { margin: 0; }' },
    ]);
    const parsed = parseZipArchive(validZip);
    expect(parsed.map((e) => e.path)).toEqual(['index.html', 'styles/main.css']);

    const forged = new Uint8Array(22);
    const fv = new DataView(forged.buffer);
    fv.setUint32(0, 0x06054b50, true);
    fv.setUint16(8, MAX_ZIP_ENTRIES + 1, true);
    fv.setUint16(10, MAX_ZIP_ENTRIES + 1, true);
    expect(() => parseZipArchive(forged)).toThrow(/exceeds safety limit/i);

    expect(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES).toBe(128 * 1024 * 1024);
  });
});
