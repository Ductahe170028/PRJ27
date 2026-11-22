import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Standard (and the shooter to come) must not depend on Advanced. app.ts and
// server.ts are the only places allowed to assemble Advanced.
const src = fileURLToPath(new URL('../src/', import.meta.url));
const ASSEMBLY = new Set(['app.ts', 'server.ts']);

function tsFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Every module specifier in static imports, re-exports, dynamic import() and require(). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

const reachesAdvanced = (specifier: string) => /(^|\/)(agent|sandbox)(\/|$)/.test(specifier);

const guarded = [
  ...tsFiles(join(src, 'services')),
  ...tsFiles(join(src, 'providers')),
  ...tsFiles(join(src, 'http')),
  ...readdirSync(src).filter((entry) => entry.endsWith('.ts') && !ASSEMBLY.has(entry)).map((entry) => join(src, entry)),
];

describe('architecture boundaries: Standard does not import Advanced', () => {
  it('guards a non-trivial set of files', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(25);
    expect(guarded.some((file) => file.endsWith('game-generation-service.ts'))).toBe(true);
    expect(guarded.some((file) => file.endsWith('redact.ts'))).toBe(true);
    expect(guarded.some((file) => file.endsWith('app.ts'))).toBe(false);
  });

  it('no file in services, providers, http or src/*.ts imports agent/ or sandbox/', () => {
    const violations = guarded.flatMap((file) => specifiers(readFileSync(file, 'utf8'))
      .filter(reachesAdvanced).map((specifier) => `${relative(src, file)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('the detector sees every import form (so the test above can fail)', () => {
    const forms = [
      "import { a } from '../agent/run-diagnostics.js';",
      "import type { A } from '../sandbox/docker-args.js';",
      "export { a } from '../agent/x.js';",
      "import '../agent/side-effect.js';",
      "const m = await import('../sandbox/x.js');",
      "const r = require('../agent/x.js');",
      "import {\n  a,\n  b,\n} from './agent/orchestrator.js';",
    ];
    for (const form of forms) expect(specifiers(form).some(reachesAdvanced), form).toBe(true);
    for (const ok of ["import { a } from './redact.js';", "import x from '../providers/errors.js';", "import { s } from 'node:path';", "import { a } from '../services/agent-name-but-not-a-dir.js';"]) {
      expect(specifiers(ok).some(reachesAdvanced), ok).toBe(false);
    }
  });

  it('Advanced may import Standard (the allowed direction)', () => {
    const orchestrator = readFileSync(join(src, 'agent', 'orchestrator.ts'), 'utf8');
    expect(specifiers(orchestrator).some((specifier) => specifier.includes('/services/') || specifier.includes('/providers/'))).toBe(true);
  });
});
