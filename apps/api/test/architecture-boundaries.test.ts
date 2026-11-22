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

// The API's shooter module (brief, compiler, gate, service) sits next to Standard
// and Advanced but must not use their physics, repair or code-agent parts, nor
// the GameSpec v1 types. Allowed from services/: game-generation-service
// (generateArtifact), system-prompt (providerJsonSchema), redact,
// standard-diagnostics and worker-run; and providers/ and http/.
describe('architecture boundaries: the API shooter module', () => {
  const shooterDirectory = join(src, 'shooter');
  const forbiddenSpecifier = (specifier: string) => /(^|\/)(agent|sandbox)(\/|$)/.test(specifier)
    || /services\/(repair-|game-geometry|enemy-hazard|platformer-physics|objective-route|isolated-repair)/.test(specifier)
    || /(^|\/)game-spec(\.js)?$/.test(specifier);
  /** Code without comments and string contents. */
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
  const usesGameSpec = (source: string) => /\bGameSpec(Schema|Shape|PlacementInputSchema)?\b/.test(code(source));
  const problems = (file: string, source: string) => [
    ...specifiers(source).filter(forbiddenSpecifier).map((specifier) => `${file}: imports "${specifier}"`),
    ...(usesGameSpec(source) ? [`${file}: uses a GameSpec type`] : []),
  ];

  it('guards the real files', () => {
    const files = tsFiles(shooterDirectory);
    expect(files.map((file) => relative(shooterDirectory, file)).sort()).toEqual(expect.arrayContaining(['brief.ts', 'compile.ts', 'gate.ts', 'service.ts', 'waves.ts', 'maps.ts', 'notices.ts', 'prompt.ts', 'presets.ts', 'isolated-compile.ts']));
  });

  it('no file imports Advanced, the Standard physics or repair, or GameSpec v1', () => {
    const found = tsFiles(shooterDirectory).flatMap((file) => problems(relative(shooterDirectory, file), readFileSync(file, 'utf8')));
    expect(found).toEqual([]);
  });

  it('catches each kind of violation (so the check above can fail)', () => {
    const bad: Array<[string, string]> = [
      ["import { a } from '../agent/run-diagnostics.js';", 'imports "../agent/run-diagnostics.js"'],
      ["import { a } from '../sandbox/docker-args.js';", 'imports "../sandbox/docker-args.js"'],
      ["import { repairGamePlacement } from '../services/repair-game-placement.js';", 'repair-game-placement'],
      ["import { buildNavigation } from '../services/game-geometry.js';", 'game-geometry'],
      ["import { analyzeHazards } from '../services/enemy-hazard.js';", 'enemy-hazard'],
      ["import { x } from '../../../packages/contracts/src/game-spec.js';", 'game-spec'],
      ["import type { GameSpec } from '@game-creator/contracts';", 'uses a GameSpec type'],
      ["const s = GameSpecSchema.parse(x);", 'uses a GameSpec type'],
    ];
    for (const [source, message] of bad) expect(problems('x.ts', source).join('|'), source).toContain(message);
    const fine = [
      "import { ShooterLevelSchema } from '@game-creator/contracts';",
      "import { diagnosticSink } from '../providers/diagnostic-sink.js';",
      "import type { GameGenerationService } from '../services/game-generation-service.js';",
      "import { providerJsonSchema } from '../services/system-prompt.js';",
      "import { redactDiagnostics } from '../services/redact.js';",
      "import { runInWorker } from '../services/worker-run.js';",
      '// a comment may say GameSpec v1 and ../agent/x.js freely',
    ];
    for (const source of fine) expect(problems('x.ts', source), source).toEqual([]);
  });
});
