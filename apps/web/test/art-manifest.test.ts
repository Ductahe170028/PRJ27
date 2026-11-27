import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestSchema, bodyScale, frameRect, framesFit, manifestFits, type Manifest } from '../src/game/art/manifest';

const heroManifest = (patch: Record<string, unknown> = {}) => ({
  version: 1, kind: 'hero', id: 'test-hero', source: 'png', license: 'CC0', author: 'someone', origin: '',
  sheet: 'sheet.png', frame: { w: 48, h: 48 }, columns: 4, body: { radius: 14 },
  animations: { idle: { frames: [0], fps: 1, loop: true }, move: { frames: [1, 2, 3], fps: 10, loop: true } },
  ...patch,
});
const problems = (value: unknown) => {
  const result = ManifestSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('the manifest of an art pack', () => {
  it('accepts a complete hero pack', () => {
    expect(problems(heroManifest())).toEqual([]);
  });

  it('requires a license, and a sheet for a PNG pack', () => {
    const { license: _license, ...noLicense } = heroManifest();
    expect(problems(noLicense).length).toBeGreaterThan(0);
    expect(problems(heroManifest({ license: '' })).length).toBeGreaterThan(0);
    const { sheet: _sheet, ...noSheet } = heroManifest();
    expect(problems(noSheet).join(' ')).toContain('sheet');
    expect(problems({ ...noSheet, source: 'procedural', license: 'procedural' })).toEqual([]);
  });

  it('keeps fps in 1..30 and rejects an unknown animation name or an unknown field', () => {
    expect(problems(heroManifest({ animations: { move: { frames: [0], fps: 0, loop: true } } })).length).toBeGreaterThan(0);
    expect(problems(heroManifest({ animations: { move: { frames: [0], fps: 31, loop: true } } })).length).toBeGreaterThan(0);
    expect(problems(heroManifest({ animations: { move: { frames: [0], fps: 30, loop: true } } }))).toEqual([]);
    expect(problems(heroManifest({ animations: { dance: { frames: [0], fps: 5, loop: true } } })).join(' ')).toContain('dance');
    expect(problems(heroManifest({ extra: 1 })).length).toBeGreaterThan(0);
  });

  it('checks what each kind needs', () => {
    expect(problems(heroManifest({ body: { w: 10, h: 10 } })).join(' ')).toContain('body');
    const base = { version: 1, kind: 'base', id: 'b', source: 'procedural', license: 'procedural', author: '', origin: '', frame: { w: 96, h: 96 }, columns: 4, animations: { idle: { frames: [0], fps: 2, loop: true } } };
    expect(problems(base).join(' ')).toContain('body');
    expect(problems({ ...base, body: { w: 56, h: 56 }, anchor: { x: 0.5, y: 0.54 }, overhang: 24 })).toEqual([]);
    expect(problems({ ...base, body: { w: 56, h: 56 }, overhang: 25 }).length).toBeGreaterThan(0);
    const family = { version: 1, kind: 'family', id: 'f', source: 'procedural', license: 'procedural', author: '', origin: '' };
    expect(problems(family).join(' ')).toContain('kinds');
    const weapon = { version: 1, kind: 'weapon', id: 'w', source: 'procedural', license: 'procedural', author: '', origin: '', frame: { w: 40, h: 24 }, columns: 4, animations: { idle: { frames: [0], fps: 1, loop: true } } };
    expect(problems(weapon).join(' ')).toContain('muzzle');
    expect(problems({ ...weapon, muzzle: { x: 36, y: 12 }, bullet: { style: 'dot', color: '#ffe066' } })).toEqual([]);
    expect(problems({ ...weapon, muzzle: { x: 36, y: 12 }, bullet: { style: 'dot', color: 'red' } }).length).toBeGreaterThan(0);
    const biome = { version: 1, kind: 'biome', id: 'x', source: 'procedural', license: 'procedural', author: '', origin: '' };
    expect(problems(biome).join(' ')).toContain('tiles');
    expect(problems({ ...biome, tiles: { count: 6 }, wall: { x: 0, y: 64, w: 64, h: 64 }, ambient: 'snow' })).toEqual([]);
    expect(problems({ ...biome, tiles: { count: 6 }, wall: { x: 0, y: 64, w: 64, h: 64 }, ambient: 'rain' }).length).toBeGreaterThan(0);
  });

  it('refuses an id that is not a lowercase slug', () => {
    for (const id of ['Hero', 'a b', '', 'x'.repeat(31), 'a/b']) expect(problems(heroManifest({ id })).length, id).toBeGreaterThan(0);
  });
});

describe('where frames are in a sheet', () => {
  it('counts frames row by row, with an offset for a block', () => {
    expect(frameRect({ w: 48, h: 48 }, 4, 0)).toEqual({ x: 0, y: 0, w: 48, h: 48 });
    expect(frameRect({ w: 48, h: 48 }, 4, 5)).toEqual({ x: 48, y: 48, w: 48, h: 48 });
    expect(frameRect({ w: 36, h: 36 }, 6, 7, { x: 10, y: 100 })).toEqual({ x: 46, y: 136, w: 36, h: 36 });
  });

  it('knows when every frame an animation names lies inside the sheet', () => {
    const grid = { frame: { w: 48, h: 48 }, columns: 4, animations: { move: { frames: [0, 1, 2, 3, 4, 5], fps: 10, loop: true } } };
    expect(framesFit(grid, 192, 96)).toBe(true);
    expect(framesFit(grid, 192, 95)).toBe(false); // the second row does not fit
    expect(framesFit(grid, 191, 96)).toBe(false); // the fourth column does not fit
    expect(framesFit({ ...grid, animations: { move: { frames: [99], fps: 10, loop: true } } }, 192, 96)).toBe(false);
  });

  it('checks every block of a family, the tiles, the wall and the props of a biome', () => {
    const family = ManifestSchema.parse({
      version: 1, kind: 'family', id: 'f', source: 'procedural', license: 'procedural', author: '', origin: '',
      kinds: { runner: { frame: { w: 36, h: 36 }, columns: 4, offset: { x: 0, y: 40 }, body: { radius: 11 }, animations: { move: { frames: [0, 1, 2, 3], fps: 10, loop: true } } } },
    });
    expect(manifestFits(family, 144, 76)).toBe(true);
    expect(manifestFits(family, 144, 75)).toBe(false);
    const biome = ManifestSchema.parse({
      version: 1, kind: 'biome', id: 'b', source: 'procedural', license: 'procedural', author: '', origin: '',
      tiles: { count: 6 }, wall: { x: 0, y: 64, w: 64, h: 64 }, props: [{ x: 0, y: 128, w: 30, h: 30 }],
    });
    expect(manifestFits(biome, 384, 160)).toBe(true);
    expect(manifestFits(biome, 383, 160)).toBe(false);
    expect(manifestFits(biome, 384, 157)).toBe(false);
  });

  it('scales a sprite so that its body matches the game body', () => {
    expect(bodyScale({ radius: 14 }, 14)).toBe(1);
    expect(bodyScale({ radius: 28 }, 14)).toBe(0.5);
    expect(bodyScale({ w: 56, h: 56 }, 56)).toBe(1);
    expect(bodyScale({ w: 112, h: 112 }, 56)).toBe(0.5);
    // Stage 6B: the base art has an 80 body; the base of a level may be 56, 72 (the compiler's) or 80
    expect(bodyScale({ w: 80, h: 80 }, 80)).toBe(1);
    expect(bodyScale({ w: 80, h: 80 }, 72)).toBe(0.9);
    expect(bodyScale({ w: 80, h: 80 }, 56)).toBe(0.7);
    expect(bodyScale(undefined, 14)).toBe(1);
  });
});

describe('the one PNG pack in the repo (hero/grunt-test)', () => {
  const folder = new URL('../public/art/hero/grunt-test/', import.meta.url);
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(new URL('manifest.json', folder), 'utf8'))) as Manifest;
  const png = readFileSync(new URL('sheet.png', folder));

  it('is a real PNG whose size holds every frame the manifest names', () => {
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(manifestFits(manifest, width, height)).toBe(true);
    expect(width).toBe(manifest.frame!.w * manifest.columns!);
  });

  it('is a PNG pack with the five hero animations and a license', () => {
    expect(manifest.source).toBe('png');
    expect(manifest.license).toBe('procedural');
    expect(Object.keys(manifest.animations!).sort()).toEqual(['die', 'hit', 'idle', 'move', 'shoot']);
    expect(manifest.animations!.move!.frames).toHaveLength(4);
  });
});
