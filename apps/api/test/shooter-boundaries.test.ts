import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The shooter core must run anywhere: in the browser, in Node, in a worker. So
// it may import only zod and its own sibling files, and must not touch the
// engine, the page, the clock or the global random generator.
const directory = fileURLToPath(new URL('../../../packages/contracts/src/shooter/', import.meta.url));

/** Source without comments and string/template contents, so only code is scanned. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (match) => (/^['"`]\.{0,2}\//.test(match) || match === "'zod'" ? match : '""'));
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['phaser', /phaser/i],
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['globalThis', /\bglobalThis\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date', /\bnew\s+Date\b/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
  // Not bit-for-bit the same on every engine: only + - * / and square roots are allowed.
  ['Math.hypot', /\bMath\s*\.\s*hypot\b/],
  ['Math.sin', /\bMath\s*\.\s*sin\b/],
  ['Math.cos', /\bMath\s*\.\s*cos\b/],
  ['Math.tan', /\bMath\s*\.\s*tan\b/],
  ['Math.atan', /\bMath\s*\.\s*atan(?!2)\b/],
  ['Math.pow', /\bMath\s*\.\s*pow\b/],
  ['Math.exp', /\bMath\s*\.\s*exp\b/],
  ['Math.log', /\bMath\s*\.\s*log\b/],
  ['the ** operator', /\*\*/],
];

/** Everything wrong with one file's source; empty when it is clean. */
function violations(file: string, source: string): string[] {
  const out: string[] = [];
  for (const specifier of specifiers(source)) {
    if (specifier !== 'zod' && !/^\.\/[\w-]+\.js$/.test(specifier)) out.push(`${file}: imports "${specifier}"`);
  }
  const stripped = code(source);
  for (const [name, pattern] of FORBIDDEN) if (pattern.test(stripped)) out.push(`${file}: uses ${name}`);
  return out;
}

const files = readdirSync(directory).filter((name) => name.endsWith('.ts'));

describe('shooter core stays pure', () => {
  it('has the files it should', () => {
    expect(files).toEqual(expect.arrayContaining(['constants.ts', 'fixtures.ts', 'geometry.ts', 'index.ts', 'level.ts', 'navigation.ts', 'sim.ts']));
  });

  it('no file imports anything but zod or a sibling, and none uses the page, the engine, the clock or Math.random', () => {
    const found = files.flatMap((file) => violations(file, readFileSync(join(directory, file), 'utf8')));
    expect(found).toEqual([]);
  });

  it('catches every kind of violation (so the check above can fail)', () => {
    const bad: Array<[string, string]> = [
      ["import Phaser from 'phaser';", 'imports "phaser"'],
      ["import { x } from '../game-spec.js';", 'imports "../game-spec.js"'],
      ["import { x } from 'node:fs';", 'imports "node:fs"'],
      ["const a = await import('../agent/x.js');", 'imports "../agent/x.js"'],
      ['const w = window.innerWidth;', 'uses window'],
      ["const d = document.getElementById('x');", 'uses document'],
      ['const r = Math.random();', 'uses Math.random'],
      ['const t = Date.now();', 'uses Date.now'],
      ['const t = new Date();', 'uses new Date'],
      ['const t = performance.now();', 'uses performance.now'],
      ['setTimeout(() => {}, 1);', 'uses setTimeout'],
      ['const p = new Phaser.Game();', 'uses phaser'],
      ['const d = Math.hypot(a, b);', 'uses Math.hypot'],
      ['const d = Math.sin(a) + Math.cos(a) + Math.tan(a);', 'uses Math.sin'],
      ['const a = Math.atan(1);', 'uses Math.atan'],
      ['const v = Math.pow(2, 3) + Math.exp(1) + Math.log(2);', 'uses Math.pow'],
      ['const v = 2 ** 8;', 'uses the ** operator'],
    ];
    for (const [source, message] of bad) expect(violations('x.ts', source).join('|'), source).toContain(message);
    // the allowed math is not flagged (atan2 is limited by the count test above)
    expect(violations('x.ts', 'const a = Math.atan2(1, 2); const r = Math.sqrt(4) * 2 + Math.max(1, 2);')).toEqual([]);
    // comments and strings are not code
    expect(violations('x.ts', '// uses Math.random and window\n/* document, Phaser */\nconst s = "Date.now()";')).toEqual([]);
    expect(violations('x.ts', "import { z } from 'zod';\nimport { a } from './geometry.js';\nexport * from './sim.js';")).toEqual([]);
  });

  it('Math.atan2 appears exactly once, in sim.ts (the aim angle that is only drawn)', () => {
    const uses = files.flatMap((file) => {
      const found = code(readFileSync(join(directory, file), 'utf8')).match(/\bMath\s*\.\s*atan2\b/g) ?? [];
      return found.map(() => file);
    });
    expect(uses).toEqual(['sim.ts']);
  });

  it('the package index exposes the shooter module', () => {
    const index = readFileSync(join(directory, '../index.ts'), 'utf8');
    expect(index).toContain("export * from './shooter/index.js';");
  });
});
