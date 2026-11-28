import { createServer } from 'vite';

function parseArgs(argv) {
  const args = {
    scale: 'medium',
    json: false,
    nodes: undefined,
    iterations: undefined,
  };

  for (const raw of argv) {
    if (raw === '--json') {
      args.json = true;
    } else if (raw.startsWith('--scale=')) {
      const value = raw.slice('--scale='.length);
      if (value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge' || value === 'monster') {
        args.scale = value;
      } else {
        throw new Error(`Unsupported --scale value "${value}". Expected small, medium, large, xlarge, or monster.`);
      }
    } else if (raw.startsWith('--nodes=')) {
      const parsed = Number(raw.slice('--nodes='.length));
      if (!Number.isFinite(parsed) || parsed < 10) {
        throw new Error(`Invalid --nodes value "${raw}". Expected an integer >= 10.`);
      }
      args.nodes = Math.floor(parsed);
    } else if (raw.startsWith('--iterations=')) {
      const parsed = Number(raw.slice('--iterations='.length));
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --iterations value "${raw}". Expected an integer >= 1.`);
      }
      args.iterations = Math.floor(parsed);
    }
  }
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
    const mod = await server.ssrLoadModule('/scripts/studioBenchmark.ts');
    const report = mod.runStudioBenchmark({
      scale: options.scale,
      ...(options.nodes !== undefined ? { nodesPerPage: options.nodes } : {}),
      ...(options.iterations !== undefined ? { iterations: options.iterations } : {}),
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(mod.formatBenchmarkReport(report));
    }
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error('Folio Studio benchmark failed:', error);
  process.exitCode = 1;
});
