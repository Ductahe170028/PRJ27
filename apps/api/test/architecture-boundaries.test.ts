import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Three rules keep the layers apart:
//   1. the simulation core (packages/contracts/src/shooter) imports nothing but zod and its own files: no phaser, react,
//      node: module, app or other package;
//   2. the API's shooter module (apps/api/src/shooter) never reaches into the web app;
//   3. the web app never reaches into the API.
const repo = fileURLToPath(new URL('../../../', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(path) ? [path] : [];
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

const isLocal = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../');
const reachesApp = (specifier: string, app: 'web' | 'api') => new RegExp(`(^|/)apps/${app}(/|$)|(^|/)@game-creator/${app}(/|$)`).test(specifier);
/** The only imports the simulation core may have: zod, and files next to it. */
const coreProblem = (specifier: string) => (specifier === 'zod' || (isLocal(specifier) && !specifier.includes('..'))) ? undefined : specifier;
const webProblem = (specifier: string) => reachesApp(specifier, 'api') || /(^|\/)api\/src(\/|$)/.test(specifier) || /(^|\/)(express|cors|dotenv|groq-sdk|@google\/genai)(\/|$)/.test(specifier);
const apiShooterProblem = (specifier: string) => reachesApp(specifier, 'web') || /(^|\/)(phaser|react|react-dom)(\/|$)/.test(specifier);

const core = join(repo, 'packages/contracts/src/shooter');
const apiShooter = join(repo, 'apps/api/src/shooter');
const web = join(repo, 'apps/web/src');

describe('architecture boundaries', () => {
  it('guard real files', () => {
    expect(sourceFiles(core).length).toBeGreaterThanOrEqual(20);
    expect(sourceFiles(apiShooter).length).toBeGreaterThanOrEqual(10);
    expect(sourceFiles(web).length).toBeGreaterThanOrEqual(15);
  });

  it('the simulation core imports only zod and its own files (no phaser, react, node:, app or package)', () => {
    const violations = sourceFiles(core).flatMap((file) => specifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => coreProblem(specifier) !== undefined).map((specifier) => `${relative(repo, file)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('the API shooter module does not import the web app, phaser or react', () => {
    const violations = sourceFiles(apiShooter).flatMap((file) => specifiers(readFileSync(file, 'utf8'))
      .filter(apiShooterProblem).map((specifier) => `${relative(repo, file)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('the whole API source does not import the web app', () => {
    const violations = sourceFiles(join(repo, 'apps/api/src')).flatMap((file) => specifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => reachesApp(specifier, 'web')).map((specifier) => `${relative(repo, file)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('the web app does not import the API (or a server library)', () => {
    const violations = sourceFiles(web).flatMap((file) => specifiers(readFileSync(file, 'utf8'))
      .filter(webProblem).map((specifier) => `${relative(repo, file)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('the detectors see every import form and every kind of violation (so the checks above can fail)', () => {
    const forms = [
      "import { a } from 'phaser';", "import type { A } from 'react';", "export { a } from 'node:fs';", "import 'node:path';",
      "const m = await import('node:crypto');", "const r = require('node:os');", "import {\n  a,\n  b,\n} from '../../../apps/web/src/x.js';",
    ];
    for (const form of forms) expect(specifiers(form).length, form).toBe(1);
    for (const bad of ['phaser', 'react', 'node:fs', '@game-creator/api', '../geometry/../../x.js', '../../../apps/web/src/x.js']) {
      expect(coreProblem(bad), bad).toBeDefined();
    }
    for (const ok of ['zod', './geometry.js', './sim.js']) expect(coreProblem(ok), ok).toBeUndefined();
    for (const bad of ['../../../apps/web/src/App.tsx', '@game-creator/web', 'phaser', 'react']) expect(apiShooterProblem(bad), bad).toBe(true);
    for (const ok of ['@game-creator/contracts', '../providers/errors.js', 'node:crypto', 'zod']) expect(apiShooterProblem(ok), ok).toBe(false);
    for (const bad of ['../../api/src/app', 'apps/api/src/app.js', '@game-creator/api', 'express', 'groq-sdk']) expect(webProblem(bad), bad).toBe(true);
    for (const ok of ['@game-creator/contracts', 'phaser', 'react', './lib/api']) expect(webProblem(ok), ok).toBe(false);
  });
});
