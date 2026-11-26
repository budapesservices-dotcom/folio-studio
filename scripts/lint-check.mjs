import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = join(ROOT_DIR, 'src');

const FORBIDDEN_RULES = [
  {
    id: 'no-debugger',
    pattern: /\bdebugger\b/,
    message: 'Debugger statements must not be committed.',
  },
  {
    id: 'no-window-alert',
    pattern: /\bwindow\.alert\s*\(/,
    message: 'window.alert() is forbidden in studio UI and sandboxed iframes.',
  },
  {
    id: 'no-window-open',
    pattern: /\bwindow\.open\s*\(/,
    message: 'window.open() is forbidden in sandboxed studio previews.',
  },
  {
    id: 'no-raw-innerhtml',
    pattern: /\.innerHTML\s*=/,
    message: 'Direct innerHTML assignment violates Folio zero-innerHTML policy.',
  },
  {
    id: 'no-document-write',
    pattern: /\bdocument\.write\s*\(/,
    message: 'document.write() is forbidden.',
  },
];

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (['.ts', '.tsx', '.js', '.mjs'].includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const files = collectSourceFiles(SRC_DIR);
const violations = [];

for (const file of files) {
  const relPath = relative(ROOT_DIR, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const rule of FORBIDDEN_RULES) {
      if (rule.pattern.test(line)) {
        violations.push(`${relPath}:${i + 1} [${rule.id}] ${rule.message}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Folio lint failed with ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log(`Folio lint passed (${files.length} source files checked).`);
