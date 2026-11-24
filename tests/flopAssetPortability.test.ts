import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import type { AssetReference, FolioProject } from '../src/core/document/types';
import {
  clearAssetMemoryCache,
  computeBytesSha256,
  ingestImageBytes,
  materializeProjectAssetsForExport,
  putDeduplicatedAssetBlob,
} from '../src/core/persistence/assetStore';
import {
  MAX_PROJECT_FILE_BYTES,
  MissingExportAssetsError,
  ProjectFileSizeLimitError,
  downloadProject,
  evaluateProjectAssetPortabilityBudget,
  getUtf8ByteLength,
  readProjectFile,
  serializeProjectToFlopJson,
} from '../src/core/persistence/projectFile';
import { openProjectFile } from '../src/app/projectFileActions';
import {
  LARGE_BINARY_ASSET_THRESHOLD_BYTES,
  MAX_PROJECT_SIZE,
  scanRawProjectFileBeforeParse,
  validateProjectPreImport,
  validateRawProjectFileBeforeParse,
} from '../src/app/workspace/useProjectFileLifecycle';

function makeDeterministicBytes(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  // Minimal valid PNG header prefix followed by deterministic pattern
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[2] = 0x4e;
  bytes[3] = 0x47;
  for (let i = 4; i < length; i += 1) {
    bytes[i] = (i * 31 + seed) & 0xff;
  }
  return bytes;
}

function makeFakeBase64DataUrl(rawByteLength: number, mimeType = 'image/png', fillChar = 'A'): string {
  const base64Chars = Math.ceil(rawByteLength / 3) * 4;
  return `data:${mimeType};base64,${fillChar.repeat(base64Chars)}`;
}

function stubBrowserDownload() {
  const anchor = {
    href: '',
    download: '',
    click: vi.fn(),
    remove: vi.fn(),
  };
  let capturedBlob: Blob | undefined;
  const createObjectURL = vi.fn((blob: Blob) => {
    capturedBlob = blob;
    return 'blob:folio-portability-test';
  });
  const revokeObjectURL = vi.fn();

  vi.stubGlobal('document', {
    createElement: vi.fn(() => anchor),
    body: { append: vi.fn() },
  });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('window', { setTimeout: vi.fn() });

  return {
    anchor,
    createObjectURL,
    revokeObjectURL,
    getBlob: () => capturedBlob,
  };
}

function fileFromBlobText(text: string, name = 'portable-project.flop'): File {
  const size = getUtf8ByteLength(text);
  return {
    name,
    size,
    text: async () => text,
  } as unknown as File;
}

afterEach(() => {
  clearAssetMemoryCache();
  vi.unstubAllGlobals();
});

describe('P1 .flop Asset Portability — single size contract & fail-closed materialization', () => {
  it('completes round-trip materialize -> downloadProject -> readProjectFile near the 25 MB limit', async () => {
    const project = createInitialProject('Near-Limit Portable Project');
    const timestamp = '2026-11-24T00:00:00.000Z';

    // Asset 1: real binary bytes stored behind `folio-asset://<sha256>` and materialized at export time
    const storedBytes = makeDeterministicBytes(64 * 1024, 7);
    const storedHash = await computeBytesSha256(storedBytes);
    await putDeduplicatedAssetBlob({
      sha256: storedHash,
      bytes: storedBytes,
      mimeType: 'image/png',
      width: 640,
      height: 480,
    });

    // Asset 2: large inline data URL bringing final `.flop` to ~24.4 MB (just under 25 MiB cap)
    const largeRawBytes = 18 * 1024 * 1024; // 18 MiB raw -> 24 MiB Base64
    const largeAsset: AssetReference = {
      id: 'asset-hero-near-limit',
      name: 'hero-near-limit.png',
      kind: 'image',
      mimeType: 'image/png',
      source: makeFakeBase64DataUrl(largeRawBytes, 'image/png', 'B'),
      byteLength: largeRawBytes,
      createdAt: timestamp,
    };

    const internalAsset: AssetReference = {
      id: 'asset-internal-stored',
      name: 'stored-thumbnail.png',
      kind: 'image',
      mimeType: 'image/png',
      source: `folio-asset://${storedHash}`,
      sha256: storedHash,
      byteLength: storedBytes.byteLength,
      createdAt: timestamp,
    };

    project.assets = [internalAsset, largeAsset];

    const materialized = await materializeProjectAssetsForExport(project);
    expect(materialized.assets[0].source.startsWith('data:image/png;base64,')).toBe(true);
    expect(materialized.assets.some((a) => a.source.startsWith('folio-asset://'))).toBe(false);

    const download = stubBrowserDownload();
    expect(() => downloadProject(materialized)).not.toThrow();
    expect(download.createObjectURL).toHaveBeenCalledOnce();
    expect(download.anchor.click).toHaveBeenCalledOnce();

    const exportedBlob = download.getBlob();
    expect(exportedBlob).toBeDefined();
    expect(exportedBlob!.size).toBeGreaterThan(24 * 1024 * 1024);
    expect(exportedBlob!.size).toBeLessThanOrEqual(MAX_PROJECT_FILE_BYTES);

    const exportedText = await exportedBlob!.text();
    const reimported = await readProjectFile(fileFromBlobText(exportedText));

    expect(reimported.metadata.id).toBe(project.metadata.id);
    expect(reimported.assets).toHaveLength(2);
    expect(reimported.assets[0].id).toBe('asset-internal-stored');
    expect(reimported.assets[0].source).toBe(materialized.assets[0].source);
    expect(reimported.assets[1].id).toBe('asset-hero-near-limit');
    expect(reimported.assets[1].source.length).toBe(largeAsset.source.length);
  });

  it('rejects oversized post-Base64 projects cleanly before triggering download and names the largest asset', () => {
    const project = createInitialProject('Oversized Asset Project');
    const timestamp = '2026-11-24T00:00:00.000Z';

    // Each asset is <= 10 MB per-asset raw limit, yet together 19.5 MiB raw -> ~26 MiB Base64 > 25 MiB cap!
    const smallRawBytes = 9.5 * 1024 * 1024;
    const largestRawBytes = 10 * 1024 * 1024;
    project.assets = [
      {
        id: 'asset-gallery-1',
        name: 'gallery-photo.jpg',
        kind: 'image',
        mimeType: 'image/jpeg',
        source: makeFakeBase64DataUrl(smallRawBytes, 'image/jpeg', 'C'),
        byteLength: smallRawBytes,
        createdAt: timestamp,
      },
      {
        id: 'asset-hero-4k',
        name: 'hero-banner-4k.png',
        kind: 'image',
        mimeType: 'image/png',
        source: makeFakeBase64DataUrl(largestRawBytes, 'image/png', 'D'),
        byteLength: largestRawBytes,
        createdAt: timestamp,
      },
    ];

    const download = stubBrowserDownload();
    let caughtError: unknown;
    try {
      downloadProject(project);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ProjectFileSizeLimitError);
    const sizeError = caughtError as ProjectFileSizeLimitError;
    expect(sizeError.code).toBe('PROJECT_FILE_SIZE_LIMIT_EXCEEDED');
    expect(sizeError.direction).toBe('export');
    expect(sizeError.maxBytes).toBe(MAX_PROJECT_FILE_BYTES);
    expect(sizeError.actualBytes).toBeGreaterThan(MAX_PROJECT_FILE_BYTES);
    expect(sizeError.largestAsset).not.toBeNull();
    expect(sizeError.largestAsset?.id).toBe('asset-hero-4k');
    expect(sizeError.largestAsset?.name).toBe('hero-banner-4k.png');
    expect(sizeError.message).toMatch(/25 MB safety limit/i);
    expect(sizeError.message).toContain('hero-banner-4k.png');
    expect(sizeError.message).toMatch(/\d+\.\d{2} MB/);

    // Must fail strictly BEFORE creating a Blob URL or triggering download
    expect(download.createObjectURL).not.toHaveBeenCalled();
    expect(download.anchor.click).not.toHaveBeenCalled();
  });

  it('enforces the exact same MAX_PROJECT_FILE_BYTES boundary on both export and readProjectFile import', async () => {
    const oversizedPayload = ' '.repeat(MAX_PROJECT_FILE_BYTES + 1);
    let importError: unknown;
    try {
      await readProjectFile(fileFromBlobText(oversizedPayload));
    } catch (error) {
      importError = error;
    }

    expect(importError).toBeInstanceOf(ProjectFileSizeLimitError);
    const typedImportError = importError as ProjectFileSizeLimitError;
    expect(typedImportError.direction).toBe('import');
    expect(typedImportError.maxBytes).toBe(MAX_PROJECT_FILE_BYTES);
    expect(typedImportError.actualBytes).toBe(MAX_PROJECT_FILE_BYTES + 1);
    expect(typedImportError.message).toMatch(/25 MB safety limit/i);
  });

  it('fails closed in materializeProjectAssetsForExport when IndexedDB/memory blobs are missing (never leaks folio-asset://)', async () => {
    const project = createInitialProject('Missing Blobs Project');
    const timestamp = '2026-11-24T00:00:00.000Z';

    const presentBytes = makeDeterministicBytes(2048, 3);
    const presentHash = await computeBytesSha256(presentBytes);
    await putDeduplicatedAssetBlob({
      sha256: presentHash,
      bytes: presentBytes,
      mimeType: 'image/png',
    });

    const missingHashA = 'a'.repeat(64);
    const missingHashB = 'b'.repeat(64);
    project.assets = [
      {
        id: 'asset-present',
        name: 'present.png',
        kind: 'image',
        mimeType: 'image/png',
        source: `folio-asset://${presentHash}`,
        sha256: presentHash,
        byteLength: presentBytes.byteLength,
        createdAt: timestamp,
      },
      {
        id: 'asset-missing-1',
        name: 'lost-hero.png',
        kind: 'image',
        mimeType: 'image/png',
        source: `folio-asset://${missingHashA}`,
        sha256: missingHashA,
        byteLength: 250000,
        createdAt: timestamp,
      },
      {
        id: 'asset-missing-2',
        name: 'lost-icon.svg',
        kind: 'image',
        mimeType: 'image/svg+xml',
        source: `folio-asset://${missingHashB}`,
        sha256: missingHashB,
        byteLength: 42000,
        createdAt: timestamp,
      },
    ];

    let caughtError: unknown;
    try {
      await materializeProjectAssetsForExport(project);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(MissingExportAssetsError);
    const missingError = caughtError as MissingExportAssetsError;
    expect(missingError.code).toBe('MISSING_EXPORT_ASSETS');
    expect(missingError.missingAssets).toHaveLength(2);
    expect(missingError.missingAssets.map((a) => a.id)).toEqual(['asset-missing-1', 'asset-missing-2']);
    expect(missingError.missingAssets.map((a) => a.name)).toEqual(['lost-hero.png', 'lost-icon.svg']);
    expect(missingError.missingAssets.map((a) => a.sha256)).toEqual([missingHashA, missingHashB]);
    expect(missingError.message).toContain('lost-hero.png');
    expect(missingError.message).toContain('lost-icon.svg');
  });

  it('blocks dangling folio-asset:// or blob: URIs even if downloadProject or serializeProjectToFlopJson is called directly', () => {
    const project = createInitialProject('Unmaterialized Direct Export');
    const missingHash = 'c'.repeat(64);
    project.assets = [
      {
        id: 'asset-dangling',
        name: 'dangling.png',
        kind: 'image',
        mimeType: 'image/png',
        source: `folio-asset://${missingHash}`,
        sha256: missingHash,
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ];

    const download = stubBrowserDownload();
    expect(() => serializeProjectToFlopJson(project)).toThrow(MissingExportAssetsError);
    expect(() => downloadProject(project)).toThrow(MissingExportAssetsError);
    expect(download.createObjectURL).not.toHaveBeenCalled();
    expect(download.anchor.click).not.toHaveBeenCalled();
  });

  it('emits early cumulative .flop budget warnings during upload when approaching or exceeding 25 MB post-Base64', async () => {
    const existingLargeRaw = 15 * 1024 * 1024; // ~20 MiB serialized -> 80% warning threshold
    const existingAsset: AssetReference = {
      id: 'asset-existing-large',
      name: 'existing-hero.png',
      kind: 'image',
      mimeType: 'image/png',
      source: `folio-asset://${'d'.repeat(64)}`,
      sha256: 'd'.repeat(64),
      byteLength: existingLargeRaw,
      createdAt: '2026-11-24T00:00:00.000Z',
    };

    const budgetAtWarning = evaluateProjectAssetPortabilityBudget([existingAsset]);
    expect(budgetAtWarning.status).toBe('warning');
    expect(budgetAtWarning.warningMessage).toMatch(/approaching the 25 MB \.flop export limit/i);
    expect(budgetAtWarning.largestAsset?.name).toBe('existing-hero.png');

    // Uploading a second 5 MB asset pushes cumulative serialized assets past the 24 MB asset budget (~26.7 MB serialized)
    const incomingBytes = makeDeterministicBytes(5 * 1024 * 1024, 19);
    const ingested = await ingestImageBytes(
      {
        name: 'second-banner.png',
        mimeType: 'image/png',
        bytes: incomingBytes,
        width: 1920,
        height: 1080,
      },
      [existingAsset],
    );

    expect(ingested.budgetReport.status).toBe('exceeds-flop-limit');
    expect(ingested.portabilityWarning).toBeDefined();
    expect(ingested.portabilityWarning).toMatch(/exceed the 25 MB \.flop export limit/i);
    expect(ingested.portabilityWarning).toContain('existing-hero.png');

    // Confirm legacy/external non-internal URIs remain compatible with materializeProjectAssetsForExport
    const legacyProject: FolioProject = createInitialProject('Legacy External Assets');
    legacyProject.assets = [
      {
        id: 'asset-legacy',
        name: 'legacy-ref.png',
        kind: 'image',
        mimeType: 'image/png',
        source: 'asset://legacy-ref',
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ];
    const untouched = await materializeProjectAssetsForExport(legacyProject);
    expect(untouched.assets[0].source).toBe('asset://legacy-ref');
  });

  it('scans imported projects for large binary assets and denies import before persistence when total size exceeds the contract limit', async () => {
    const project = createInitialProject('Pre-Import Oversized Assets');
    const timestamp = '2026-11-24T00:00:00.000Z';

    // Compact metadata JSON file (< 2 KB on disk), but its declared binary assets total
    // 20 MiB raw -> ~26.67 MiB serialized, exceeding the 25 MiB contract limit.
    project.assets = [
      {
        id: 'asset-small-icon',
        name: 'icon.svg',
        kind: 'image',
        mimeType: 'image/svg+xml',
        source: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        byteLength: 12,
        createdAt: timestamp,
      },
      {
        id: 'asset-large-1',
        name: 'background-4k.png',
        kind: 'image',
        mimeType: 'image/png',
        source: `folio-asset://${'e'.repeat(64)}`,
        sha256: 'e'.repeat(64),
        byteLength: 9 * 1024 * 1024,
        createdAt: timestamp,
      },
      {
        id: 'asset-large-2',
        name: 'hero-ultra.png',
        kind: 'image',
        mimeType: 'image/png',
        source: `folio-asset://${'f'.repeat(64)}`,
        sha256: 'f'.repeat(64),
        byteLength: 11 * 1024 * 1024,
        createdAt: timestamp,
      },
    ];

    const result = validateProjectPreImport(project);
    expect(result.allowed).toBe(false);
    expect(result.maxContractBytes).toBe(MAX_PROJECT_FILE_BYTES);
    expect(result.scannedAssets).toHaveLength(3);
    expect(result.largeAssets.map((a) => a.id)).toEqual(['asset-large-1', 'asset-large-2']);
    expect(result.largeAssets.every((a) => a.rawBytes >= LARGE_BINARY_ASSET_THRESHOLD_BYTES)).toBe(true);
    expect(result.scannedAssets.find((a) => a.id === 'asset-large-2')?.exceedsPerAssetLimit).toBe(true);
    expect(result.largestAsset?.id).toBe('asset-large-2');
    expect(result.error).toBeInstanceOf(ProjectFileSizeLimitError);
    expect(result.error?.direction).toBe('import');
    expect(result.error?.message).toMatch(/25 MB safety limit/i);
    expect(result.error?.message).toContain('hero-ultra.png');

    // Verify openProjectFile + pre-import gate aborts BEFORE persistence/store replacement runs
    const saveAndReplaceSpy = vi.fn();
    const rawFile = fileFromBlobText(JSON.stringify(project), 'oversized-assets.flop');
    await expect(
      openProjectFile(rawFile, async (loadedProject) => {
        const check = validateProjectPreImport(loadedProject, { fileSizeBytes: rawFile.size });
        if (!check.allowed) throw check.error!;
        saveAndReplaceSpy(loadedProject);
      }),
    ).rejects.toThrow(ProjectFileSizeLimitError);
    expect(saveAndReplaceSpy).not.toHaveBeenCalled();

    // Valid project with large assets staying within the 25 MiB contract is allowed with a warning
    const allowedProject = createInitialProject('Pre-Import Within Contract');
    allowedProject.assets = [
      {
        id: 'asset-large-ok-1',
        name: 'hero-a.png',
        kind: 'image',
        mimeType: 'image/png',
        source: makeFakeBase64DataUrl(8 * 1024 * 1024, 'image/png', 'E'),
        byteLength: 8 * 1024 * 1024,
        createdAt: timestamp,
      },
      {
        id: 'asset-large-ok-2',
        name: 'hero-b.png',
        kind: 'image',
        mimeType: 'image/png',
        source: makeFakeBase64DataUrl(8 * 1024 * 1024, 'image/png', 'F'),
        byteLength: 8 * 1024 * 1024,
        createdAt: timestamp,
      },
    ];
    const allowedCheck = validateProjectPreImport(allowedProject);
    expect(allowedCheck.allowed).toBe(true);
    expect(allowedCheck.error).toBeNull();
    expect(allowedCheck.largeAssets).toHaveLength(2);
    expect(allowedCheck.warningMessage).toMatch(/approaching the 25 MB \.flop export limit/i);
  });

  it('calculates incoming file size and total assets size BEFORE JSON.parse and denies files exceeding MAX_PROJECT_SIZE', async () => {
    expect(MAX_PROJECT_SIZE).toBe(MAX_PROJECT_FILE_BYTES);

    const parseSpy = vi.spyOn(JSON, 'parse');
    try {
      // Case 1: file.size exceeds MAX_PROJECT_SIZE -> rejected before even reading file.text() or parsing
      const hugeFileText = vi.fn(async () => '{}');
      const hugeFile = {
        name: 'huge.flop',
        size: MAX_PROJECT_SIZE + 128,
        text: hugeFileText,
      } as unknown as File;

      const hugeResult = await validateRawProjectFileBeforeParse(hugeFile);
      expect(hugeResult.allowed).toBe(false);
      expect(hugeResult.rawContent).toBeNull();
      expect(hugeResult.incomingFileBytes).toBe(MAX_PROJECT_SIZE + 128);
      expect(hugeResult.errorMessage).toMatch(/25 MB safety limit/i);
      expect(hugeFileText).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();

      // Case 2: Small JSON file on disk, but total declared binary assets exceed MAX_PROJECT_SIZE -> rejected BEFORE JSON.parse
      const project = createInitialProject('Pre-Parse Asset Overflow');
      const timestamp = '2026-11-24T00:00:00.000Z';
      project.assets = [
        {
          id: 'asset-a',
          name: 'poster-a.png',
          kind: 'image',
          mimeType: 'image/png',
          source: `folio-asset://${'1'.repeat(64)}`,
          sha256: '1'.repeat(64),
          byteLength: 10 * 1024 * 1024,
          createdAt: timestamp,
        },
        {
          id: 'asset-b',
          name: 'poster-b-4k.png',
          kind: 'image',
          mimeType: 'image/png',
          source: `folio-asset://${'2'.repeat(64)}`,
          sha256: '2'.repeat(64),
          byteLength: 10 * 1024 * 1024 + 512,
          createdAt: timestamp,
        },
      ];
      const rawJson = JSON.stringify(project, null, 2);
      const compactOversizedFile = fileFromBlobText(rawJson, 'compact-oversized-assets.flop');

      const assetOverflowResult = await validateRawProjectFileBeforeParse(compactOversizedFile);
      expect(assetOverflowResult.allowed).toBe(false);
      expect(assetOverflowResult.rawContent).toBeNull();
      expect(assetOverflowResult.incomingFileBytes).toBe(getUtf8ByteLength(rawJson));
      expect(assetOverflowResult.totalAssetsBytes).toBeGreaterThan(MAX_PROJECT_SIZE);
      expect(assetOverflowResult.largestAsset?.name).toBe('poster-b-4k.png');
      expect(assetOverflowResult.errorMessage).toMatch(/25 MB safety limit/i);
      expect(assetOverflowResult.errorMessage).toContain('poster-b-4k.png');
      // Must NEVER have called JSON.parse!
      expect(parseSpy).not.toHaveBeenCalled();

      // Case 3: Valid project within MAX_PROJECT_SIZE passes pre-parse scan cleanly without JSON.parse
      const validProject = createInitialProject('Pre-Parse Valid');
      validProject.assets = [
        {
          id: 'asset-ok',
          name: 'thumb.png',
          kind: 'image',
          mimeType: 'image/png',
          source: makeFakeBase64DataUrl(128 * 1024, 'image/png', 'G'),
          byteLength: 128 * 1024,
          createdAt: timestamp,
        },
      ];
      const validRaw = JSON.stringify(validProject);
      const validScan = scanRawProjectFileBeforeParse(validRaw, getUtf8ByteLength(validRaw));
      expect(validScan.allowed).toBe(true);
      expect(validScan.error).toBeNull();
      expect(validScan.errorMessage).toBeNull();
      expect(validScan.incomingFileBytes).toBe(getUtf8ByteLength(validRaw));
      expect(validScan.totalAssetsBytes).toBe(getUtf8ByteLength(validProject.assets[0].source));
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
  });
});
