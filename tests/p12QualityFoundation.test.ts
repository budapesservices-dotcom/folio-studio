import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_PRESETS,
  createRealisticBenchmarkProject,
  formatBenchmarkReport,
  runStudioBenchmark,
} from '../scripts/studioBenchmark';
import { validateProject } from '../src/core/document/validation';

const rootConfigs = import.meta.glob(
  [
    '../package.json',
    '../package-lock.json',
    '../.nvmrc',
    '../.github/workflows/ci.yml',
    '../.github/workflows/deploy.yml',
    '../.devcontainer/devcontainer.json',
    '../docs/ARCHITECTURE.md',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const strayBunLocks = import.meta.glob('../bun.lock', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('P1.2 — Dependency & Lockfile Reproducibility', () => {
  it('removes conflicting bun.lock and provides a canonical npm lockfileVersion 3 package-lock.json', () => {
    expect(Object.keys(strayBunLocks)).toHaveLength(0);

    const pkgRaw = rootConfigs['../package.json'];
    const lockRaw = rootConfigs['../package-lock.json'];
    expect(pkgRaw).toBeTruthy();
    expect(lockRaw).toBeTruthy();

    const pkg = JSON.parse(pkgRaw) as {
      name: string;
      version: string;
      packageManager?: string;
      engines?: { node?: string };
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lock = JSON.parse(lockRaw) as {
      name: string;
      version: string;
      lockfileVersion: number;
      packages: Record<
        string,
        {
          version?: string;
          resolved?: string;
          integrity?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }
      >;
    };

    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
    expect(pkg.engines?.node).toBeTruthy();
    expect(pkg.scripts?.benchmark).toBe('node scripts/run-benchmark.mjs');
    expect(pkg.scripts?.['test:unit']).toBeTruthy();
    expect(pkg.scripts?.['test:browser']).toBeTruthy();

    // Every direct dependency and devDependency must be pinned to an exact version (no floating ^ or ~ ranges)
    const allDirectDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    for (const [depName, spec] of Object.entries(allDirectDeps)) {
      expect(spec, `Expected exact version for ${depName}`).toMatch(/^\d+\.\d+\.\d+$/);
    }

    // Lockfile root package must mirror package.json 1:1
    const lockRoot = lock.packages[''];
    expect(lockRoot).toBeDefined();
    expect(lockRoot.dependencies).toEqual(pkg.dependencies);
    expect(lockRoot.devDependencies).toEqual(pkg.devDependencies);

    // Every resolved external entry in package-lock.json carries an integrity hash
    const externalPackages = Object.entries(lock.packages).filter(([key]) => key !== '');
    expect(externalPackages.length).toBeGreaterThan(20);
    for (const [pkgPath, entry] of externalPackages) {
      expect(entry.version, `Missing version for ${pkgPath}`).toBeTruthy();
      expect(entry.integrity, `Missing integrity hash for ${pkgPath}`).toMatch(/^sha(256|384|512)-/);
      expect(entry.resolved, `Missing resolved URL for ${pkgPath}`).toMatch(/^https:\/\//);
    }
  });

  it('aligns .nvmrc, CI, deploy workflows, and devcontainer on reproducible npm ci', () => {
    const nvmrc = rootConfigs['../.nvmrc']?.trim();
    const ciYml = rootConfigs['../.github/workflows/ci.yml'];
    const deployYml = rootConfigs['../.github/workflows/deploy.yml'];
    const devcontainer = rootConfigs['../.devcontainer/devcontainer.json'];

    expect(nvmrc).toMatch(/^\d+$/);
    expect(Number(nvmrc)).toBeGreaterThanOrEqual(22);

    expect(ciYml).toContain('node-version-file: .nvmrc');
    expect(ciYml).toContain('cache: npm');
    expect(ciYml).toContain('npm ci');

    expect(deployYml).toContain('node-version-file: .nvmrc');
    expect(deployYml).toContain('cache: npm');
    expect(deployYml).toContain('npm ci');

    expect(devcontainer).toContain('"postCreateCommand": "npm ci"');
  });
});

describe('P1.2 — Studio Performance Benchmark Suite', () => {
  it('builds a valid multi-page realistic benchmark project across presets', () => {
    const project = createRealisticBenchmarkProject(BENCHMARK_PRESETS.small);
    const validation = validateProject(project);
    expect(validation.ok).toBe(true);
    expect(project.pages.length).toBe(BENCHMARK_PRESETS.small.pageCount);
    expect(project.components.length).toBe(BENCHMARK_PRESETS.small.componentCount);
    expect(project.pages[0].document.nodes.length).toBe(BENCHMARK_PRESETS.small.nodesPerPage);
  });

  it('executes render, pan, zoom, drag, and boolean benchmarks cleanly with finite metrics', () => {
    const report = runStudioBenchmark({
      scale: 'small',
      iterations: 2,
      warmupRuns: 0,
    });

    expect(report.projectStats.projectValid).toBe(true);
    expect(report.projectStats.activePageNodeCount).toBe(BENCHMARK_PRESETS.small.nodesPerPage);
    expect(report.projectStats.totalNodeCount).toBeGreaterThan(BENCHMARK_PRESETS.small.nodesPerPage);

    const categories = new Set(report.results.map((r) => r.category));
    expect(categories).toEqual(new Set(['render', 'pan', 'zoom', 'drag', 'boolean']));

    for (const item of report.results) {
      expect(Number.isFinite(item.minMs) && item.minMs >= 0).toBe(true);
      expect(Number.isFinite(item.medianMs) && item.medianMs >= 0).toBe(true);
      expect(Number.isFinite(item.p95Ms) && item.p95Ms >= item.medianMs).toBe(true);
      expect(Number.isFinite(item.perUnitMedianMs) && item.perUnitMedianMs >= 0).toBe(true);
      expect(Number.isFinite(item.opsPerSec) && item.opsPerSec > 0).toBe(true);
    }

    const formatted = formatBenchmarkReport(report);
    expect(formatted).toContain('FOLIO Studio Performance Benchmark (SMALL)');
    expect(formatted).toContain('Full scene render');
    expect(formatted).toContain('Hand pan gesture');
    expect(formatted).toContain('Scrubby zoom gesture');
    expect(formatted).toContain('Single-node drag');
    expect(formatted).toContain('Pathfinder unite');
  });
});

describe('P1.2 — Architecture Documentation Synchronization', () => {
  it('accurately documents implemented subsystems, contracts, and planned engine boundaries', () => {
    const archDoc = rootConfigs['../docs/ARCHITECTURE.md'];
    expect(archDoc).toBeTruthy();

    // Key implemented subsystem paths & contracts
    expect(archDoc).toContain('src/core/tools/operationContract.ts');
    expect(archDoc).toContain('src/engines/canvas/geometryEngine.ts');
    expect(archDoc).toContain('src/app/toolOperationExecutor.ts');
    expect(archDoc).toContain('src/core/document/planarBoolean.ts');
    expect(archDoc).toContain('src/app/mainCanvasCommandClient.ts');
    expect(archDoc).toContain('src/app/nativeCommandExecutor.ts');
    expect(archDoc).toContain('src/app/editorStore.ts');
    expect(archDoc).toContain('scripts/studioBenchmark.ts');
    expect(archDoc).toContain('npm run benchmark');
    expect(archDoc).toContain('package-lock.json');

    // Explicit separation between implemented engines and planned/not-yet-implemented engines
    expect(archDoc).toContain('Implemented');
    expect(archDoc).toContain('Planned');
  });
});
