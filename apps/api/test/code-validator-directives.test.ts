import { describe, expect, it } from 'vitest';
import { CODE_MAX_BYTES } from '@game-creator/contracts';
import { CodeValidator, findSuppressionDirectives } from '../src/agent/code-validator.js';
import { IsolatedCodeValidator } from '../src/agent/isolated-validator.js';
import { paddleSource, shooterSource } from './agent-fixtures.js';

// Input-validation layer only. These tests do not claim OS-level sandbox isolation.
const validator = new CodeValidator();
const DIRECTIVE_ERROR = 'Không được dùng chỉ thị TypeScript';
const TRIPLE_SLASH_ERROR = 'Không được dùng chỉ thị triple-slash';

const game = (createBody: string, header = '', updateBody = '') =>
  `${header}function create(api: GameAPI): void {\n${createBody}\n}\nfunction update(api: GameAPI, dt: number): void {\n${updateBody}\n}\n`;

describe('CodeValidator: valid code is still accepted', () => {
  it.each([['shooter fixture', shooterSource], ['paddle fixture', paddleSource]])('accepts the %s', (_name, source) => {
    const result = validator.validate(source);
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain('__budget();');
  });

  it('accepts code that only uses the GameAPI surface', () => {
    const result = validator.validate(game(
      'const p = api.spawn("player", 480, 470, 36, 28, 255);\napi.setPlayer(p);\napi.state.playerId = p.id;\napi.state.timer = 0;\napi.status("Ready");',
      '',
      'const id = api.state.playerId;\nif (id === undefined) { return; }\nconst p = api.get(id);\nif (p === undefined) { return; }\n'
      + 'if (api.input.left) { p.x -= 200 * dt; }\nif (api.input.action || api.input.pointerDown) { api.addScore(1); }\n'
      + 'for (const e of api.entities) { if (e.kind === "player" && api.overlaps(p, e)) { api.state.timer = 1; } }\n'
      + 'if (api.time > 60) { api.win(); }\nif (p.y > api.height) { api.lose(); }',
    ));
    expect(result.errors).toEqual([]);
    expect(result.javascript).toBeDefined();
  });

  it('accepts code that uses the allowed Math members', () => {
    const result = validator.validate(game(
      'const p = api.spawn("player", Math.floor(Math.random() * 100) + 50, 100, 20, 20, 255);\napi.setPlayer(p);',
      '',
      'const a = Math.sqrt(4) + Math.abs(-1) + Math.min(1, 2) + Math.max(1, 2) + Math.hypot(3, 4);\n'
      + 'const b = Math.sin(Math.PI) + Math.cos(0) + Math.atan2(1, 1) + Math.ceil(1.2) + Math.round(1.5);\n'
      + 'api.state.sum = a + b + dt;',
    ));
    expect(result.errors).toEqual([]);
    expect(result.javascript).toBeDefined();
  });

  // Ordinary comments carry no compiler meaning and must keep working.
  it.each([
    ['line comment', '// move the player to the left'],
    ['block comment', '/* spawn the enemies */'],
    ['doc comment', '/** Sets the level up. */'],
    ['multi-line doc comment', '/*\n * Spawns the player.\n * Uses three lives.\n */'],
    ['comment after code', 'api.state.score = 0; // reset the score'],
    ['prose naming ts-ignore without an @ directive', '// ts-ignore is not allowed in this game'],
    ['prose mentioning a directive mid-sentence', '// we never write @ts-ignore or @ts-nocheck here'],
    ['block comment mentioning a directive mid-sentence', '/* do not use @ts-expect-error in game code */'],
    ['unrelated @ tags', '// @param api the host object, contact me at someone@example.com'],
    ['plain triple-slash comment', '/// this is only a note'],
    ['triple-slash with a non-tag angle bracket', '/// <- the player spawns here'],
  ])('accepts an ordinary %s', (_name, comment) => {
    const result = validator.validate(game(`${comment}\napi.state.score = 0;`));
    expect(result.errors).toEqual([]);
    expect(result.javascript).toBeDefined();
  });

  it('accepts ordinary comments with CRLF line endings', () => {
    const source = game('// move the player\napi.state.score = 0;').replaceAll('\n', '\r\n');
    expect(validator.validate(source).errors).toEqual([]);
  });
});

describe('CodeValidator: the type whitelist still rejects unknown globals without a directive', () => {
  it.each(['WebAssembly', 'RTCPeerConnection', 'Atomics', 'Image'])('rejects %s', (name) => {
    expect(validator.validate(game(`const x = ${name};`)).errors.join('\n')).toContain(`Cannot find name '${name}'`);
  });
});

describe('CodeValidator: TypeScript suppression directives are rejected', () => {
  const reportedCases: Array<[string, string, string]> = [
    ['WebAssembly with @ts-ignore', game('// @ts-ignore\nconst w = WebAssembly;'), '"@ts-ignore"'],
    ['RTCPeerConnection with @ts-ignore', game('// @ts-ignore\nconst rtc = RTCPeerConnection;'), '"@ts-ignore"'],
    ['Atomics with @ts-nocheck', game('const x = Atomics;', '// @ts-nocheck\n'), '"@ts-nocheck"'],
    ['Image with @ts-expect-error', game('// @ts-expect-error\nconst img = Image;'), '"@ts-expect-error"'],
  ];
  it.each(reportedCases)('rejects %s', (_name, source, directive) => {
    const result = validator.validate(source);
    expect(result.errors.join('\n')).toContain(`${DIRECTIVE_ERROR} ${directive}`);
    expect(result.javascript).toBeUndefined();
  });

  it.each([['@TS-IGNORE', '"@ts-ignore"'], ['@Ts-NoCheck', '"@ts-nocheck"'], ['@ts-expect-error', '"@ts-expect-error"']])(
    'names the directive in lower case in the message for %s', (written, named) => {
      expect(validator.validate(game(`// ${written}\nconst n = 1;`)).errors.join('\n')).toContain(`${DIRECTIVE_ERROR} ${named}`);
    },
  );

  // Whitespace and formatting variants that TypeScript still honours (TypeScript 5.9.3 scanner/parser).
  it.each([
    ['no space after the slashes', '//@ts-ignore'],
    ['several spaces', '//      @ts-ignore'],
    ['tab characters', '//\t\t@ts-ignore'],
    ['a non-breaking space', '//\u00a0@ts-ignore'],
    ['three slashes', '/// @ts-ignore'],
    ['a trailing reason', '// @ts-ignore: the type is wrong on purpose'],
    ['@ts-expect-error with a code', '// @ts-expect-error TS2304 unknown global'],
    ['@ts-nocheck without a space', '//@ts-nocheck'],
    ['@ts-nocheck with a colon', '// @ts-nocheck: skip checks'],
    ['upper case', '// @TS-IGNORE'],
    ['mixed case nocheck', '// @Ts-NoCheck'],
    ['a one-line block comment', '/* @ts-ignore */'],
    ['a block comment without spaces', '/*@ts-ignore*/'],
    ['a doc block comment', '/** @ts-ignore */'],
    ['a block comment ending after text', '/* note\n @ts-ignore */'],
    ['a block comment continuation line', '/*\n * @ts-expect-error\n */'],
    ['indentation', '        \t  // @ts-ignore'],
  ])('rejects a directive written with %s', (_name, directive) => {
    const result = validator.validate(game(`${directive}\nconst w = WebAssembly;`));
    expect(result.errors.join('\n')).toContain(DIRECTIVE_ERROR);
    expect(result.javascript).toBeUndefined();
  });

  it.each([
    ['Windows line endings', game('// @ts-ignore\nconst w = WebAssembly;').replaceAll('\n', '\r\n')],
    ['a trailing comment after code', game('api.state.a = 1; // @ts-ignore\nconst w = WebAssembly;')],
    ['a comment before the closing brace', game('const w = WebAssembly;\n// @ts-ignore')],
    ['the update function', game('', '', '// @ts-ignore\nconst w = WebAssembly;')],
    ['a nested loop', game('for (const e of api.entities) {\n  if (e.alive) {\n    // @ts-ignore\n    const w = WebAssembly;\n  }\n}')],
    ['the end of the file', `${game('api.state.a = 1;')}// @ts-ignore`],
    ['@ts-nocheck after a header comment', game('const x = Atomics;', '// game header\n// @ts-nocheck\n')],
    ['@ts-nocheck in a block comment', game('const x = Atomics;', '/* @ts-nocheck */\n')],
    ['a directive above code that needs no suppression', game('// @ts-ignore\nconst n = 1;')],
    ['a directive combined with a forbidden call', game('// @ts-ignore\nfetch("https://bad.test");')],
  ])('rejects a directive in %s', (_name, source) => {
    const result = validator.validate(source);
    expect(result.errors.join('\n')).toContain(DIRECTIVE_ERROR);
    expect(result.javascript).toBeUndefined();
  });

  it('reports the line of the directive', () => {
    const result = validator.validate(game('api.state.a = 1;\n// @ts-ignore\nconst w = WebAssembly;'));
    expect(result.errors[0]).toMatch(/^game\.ts:3: /);
  });

  it('rejects before compiling, so only the directive is reported and not the diagnostics it hides', () => {
    const result = validator.validate(game('// @ts-ignore\nconst w = WebAssembly;\nconst bad: number = "text";'));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.includes(DIRECTIVE_ERROR))).toBe(true);
  });

  it('caps the number of reported directives', () => {
    const result = validator.validate(game(Array.from({ length: 30 }, () => '// @ts-ignore\nconst n = 1;').join('\n')));
    expect(result.errors).toHaveLength(10);
  });
});

describe('CodeValidator: triple-slash directives are rejected', () => {
  it.each([
    ['reference lib', '/// <reference lib="dom" />'],
    ['reference lib, self-closing without a space', '/// <reference lib="dom"/>'],
    ['reference path', '/// <reference path="lib.dom.d.ts" />'],
    ['reference types', '/// <reference types="node" />'],
    ['reference no-default-lib', '/// <reference no-default-lib="true"/>'],
    ['upper case tag', '/// <REFERENCE lib="dom" />'],
    ['extra spaces', '///     <reference lib="dom" />'],
    ['a tab', '///\t<reference lib="dom" />'],
    ['amd-module', '/// <amd-module name="x" />'],
    ['amd-dependency', '/// <amd-dependency path="x" />'],
  ])('rejects %s', (_name, directive) => {
    const result = validator.validate(game('api.state.a = 1;', `${directive}\n`));
    expect(result.errors.join('\n')).toContain(TRIPLE_SLASH_ERROR);
    expect(result.javascript).toBeUndefined();
  });

  it('rejects a reference placed after a header comment and with Windows line endings', () => {
    const source = game('api.state.a = 1;', '// header\n/// <reference lib="dom" />\n').replaceAll('\n', '\r\n');
    expect(validator.validate(source).errors.join('\n')).toContain(TRIPLE_SLASH_ERROR);
  });

  it('rejects a reference that is followed by a use of the global it would load', () => {
    const result = validator.validate(game('const d = document;', '/// <reference lib="dom" />\n'));
    expect(result.errors.join('\n')).toContain(TRIPLE_SLASH_ERROR);
  });
});

describe('CodeValidator: existing capability bans are unchanged', () => {
  it.each([
    ['fetch', 'fetch("https://bad.test");', 'Không được truy cập fetch'],
    ['process', 'process.exit(1);', 'Không được truy cập process'],
    ['constructor chain', 'api.spawn.constructor("return globalThis")();', 'Không được truy cập constructor'],
    ['constructor by string key', 'api.spawn["constructor"]("return globalThis")();', 'Thuộc tính bị cấm'],
    ['window', 'window.location.href = "https://bad.test";', 'Không được truy cập window'],
    ['eval', 'eval("1");', 'Không được truy cập eval'],
    ['dynamic import', 'import("node:fs");', 'dynamic import'],
    ['new', 'const a = new Map();', 'Cú pháp nằm ngoài tập TypeScript an toàn'],
    ['reserved __budget name', '__budget();', 'Không được truy cập __budget'],
  ])('still rejects %s', (_name, statement, expected) => {
    const result = validator.validate(game(statement));
    expect(result.errors.join('\n')).toContain(expected);
    expect(result.javascript).toBeUndefined();
  });
});

describe('findSuppressionDirectives', () => {
  it('returns nothing for source without directives', () => {
    expect(findSuppressionDirectives(shooterSource)).toEqual([]);
    expect(findSuppressionDirectives('')).toEqual([]);
  });

  it('numbers lines for Unix, Windows, old Mac and Unicode line breaks', () => {
    for (const separator of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
      const source = ['a', 'b', '// @ts-ignore'].join(separator);
      expect(findSuppressionDirectives(source)).toEqual([expect.stringMatching(/^game\.ts:3: /)]);
    }
  });

  // Adversarial inputs at the size limit: the pre-check must stay linear because it runs before the 5 s compile budget starts.
  it.each([
    ['only slashes', '/'.repeat(CODE_MAX_BYTES)],
    ['only comment openers', '/* '.repeat(CODE_MAX_BYTES / 3)],
    ['slashes and stars that never reach an @', '/*'.repeat(CODE_MAX_BYTES / 2)],
    ['an @ after every filler run', '// @x '.repeat(CODE_MAX_BYTES / 6)],
    ['blanks before one directive', ' '.repeat(CODE_MAX_BYTES - 20) + '// @ts-ignore'],
    ['thousands of directives', '// @ts-ignore\n'.repeat(CODE_MAX_BYTES / 14)],
    ['thousands of triple-slash tags', '/// <reference lib="dom" />\n'.repeat(CODE_MAX_BYTES / 28)],
    ['slashes ahead of many @ signs', `${'/'.repeat(CODE_MAX_BYTES / 2)}${'@ '.repeat(CODE_MAX_BYTES / 4)}`],
  ])('stays fast and bounded on %s', (_name, source) => {
    const started = performance.now();
    const errors = findSuppressionDirectives(source);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(errors.length).toBeLessThanOrEqual(10);
  });
});

describe('IsolatedCodeValidator (the production path)', () => {
  it('rejects a suppression directive inside the worker that compiles AI code', async () => {
    const result = await new IsolatedCodeValidator().validate(game('// @ts-ignore\nconst w = WebAssembly;'), new AbortController().signal);
    expect(result.errors.join('\n')).toContain(DIRECTIVE_ERROR);
    expect(result.javascript).toBeUndefined();
  }, 15_000);

  it('still compiles valid code inside the worker', async () => {
    const result = await new IsolatedCodeValidator().validate(shooterSource, new AbortController().signal);
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain('__budget();');
  }, 15_000);
});
