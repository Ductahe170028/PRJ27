// The procedural art packs: manifests are valid and consistent with the sheet, paint code runs against a fake canvas context,
// is deterministic, and no source file uses randomness or the clock. No canvas is needed (a recording Proxy stands in for it).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIMATION_NAMES, ENEMY_TYPE_NAMES, ManifestSchema, type AnimationSpec, type FamilyKind, type Manifest } from '@game-creator/contracts';
import type { ProceduralPack } from '../src/game/art/types';
import { BASE_PACKS } from '../src/game/art/procedural/bases';
import { BIOME_PACKS } from '../src/game/art/procedural/biomes';
import { FAMILY_PACKS } from '../src/game/art/procedural/families';
import { HERO_PACKS } from '../src/game/art/procedural/heroes';
import { FX_PACKS, PICKUP_PACKS } from '../src/game/art/procedural/misc';
import { WEAPON_PACKS } from '../src/game/art/procedural/weapons';

const GROUPS: [string, Record<string, ProceduralPack>][] = [
  ['hero', HERO_PACKS], ['family', FAMILY_PACKS], ['base', BASE_PACKS], ['weapon', WEAPON_PACKS],
  ['biome', BIOME_PACKS], ['pickup', PICKUP_PACKS], ['fx', FX_PACKS],
];
const ALL: [string, string, ProceduralPack][] = GROUPS.flatMap(([kind, packs]) => Object.entries(packs).map(([id, pack]): [string, string, ProceduralPack] => [kind, id, pack]));

/** A context that records every call and accepts every property: a stand-in for CanvasRenderingContext2D. */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, key) {
      const name = String(key);
      if (name in target) return target[name];
      if (name === 'createLinearGradient' || name === 'createRadialGradient') return (...args: unknown[]) => { calls.push(`${name}(${args.join(',')})`); return gradient; };
      return (...args: unknown[]) => { calls.push(`${name}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 1000) / 1000 : String(a))).join(',')})`); return undefined; };
    },
    set(_t, key, value) { target[String(key)] = value; calls.push(`set ${String(key)}=${String(value)}`); return true; },
  });
  return { ctx: proxy as CanvasRenderingContext2D, calls };
}
const DRAW = /^(fillRect|fill|stroke|strokeRect|arc|ellipse|lineTo|clearRect)\(/;
const drawCalls = (calls: string[]) => calls.filter((c) => DRAW.test(c)).length;

const animationsOf = (m: Manifest): Record<string, AnimationSpec> => m.animations ?? {};
function expectFramesInside(animations: Record<string, AnimationSpec>, frame: { w: number; h: number }, columns: number, rows: number): void {
  for (const [name, a] of Object.entries(animations)) for (const i of a.frames) {
    expect(i, `${name} frame ${i}`).toBeGreaterThanOrEqual(0);
    expect(i, `${name} frame ${i}`).toBeLessThan(columns * rows);
  }
  expect(frame.w).toBeGreaterThan(0);
}

describe('procedural packs: manifests', () => {
  it.each(ALL)('%s/%s has a valid manifest and sheet size', (kind, id, pack) => {
    const parsed = ManifestSchema.parse(pack.manifest);
    expect(parsed.source).toBe('procedural');
    expect(parsed.license).toBe('procedural');
    expect(parsed.kind).toBe(kind);
    expect(parsed.id).toBe(id);
    for (const n of [pack.width, pack.height]) { expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThan(0); expect(n).toBeLessThanOrEqual(2048); }
  });

  it('has exactly the ids the game looks for', () => {
    expect(Object.keys(BIOME_PACKS).sort()).toEqual(['alien-lab', 'dark-forest', 'desert-ruins', 'hospital', 'ice-base', 'military-base', 'neon-arena', 'zombie-city']);
    expect(Object.keys(HERO_PACKS).sort()).toEqual(['armor', 'scout']);
    expect(Object.keys(FAMILY_PACKS).sort()).toEqual(['bug', 'mutant', 'robot']);
    expect(Object.keys(BASE_PACKS).sort()).toEqual(['bunker', 'outpost']);
    expect(Object.keys(WEAPON_PACKS).sort()).toEqual(['heavy', 'piercing', 'pistol', 'rapid', 'shotgun']);
    expect(Object.keys(PICKUP_PACKS)).toEqual(['health']);
    expect(Object.keys(FX_PACKS)).toEqual(['basic']);
  });

  it('grid packs keep every animation frame inside the sheet and have the required animations', () => {
    const required: Record<string, readonly string[]> = {
      hero: ['idle', 'move', 'shoot', 'hit', 'die'], base: ['idle', 'hit', 'low', 'destroyed'], weapon: ['idle', 'fire'], pickup: ['idle'], fx: ANIMATION_NAMES.fx,
    };
    for (const [kind, id, pack] of ALL) {
      const need = required[kind];
      if (!need) continue;
      const m = pack.manifest;
      const frame = m.frame; const columns = m.columns;
      expect(frame, `${kind}/${id} frame`).toBeDefined(); expect(columns, `${kind}/${id} columns`).toBeDefined();
      if (!frame || columns === undefined) continue;
      expect(columns * frame.w, `${kind}/${id} width`).toBeLessThanOrEqual(pack.width);
      const rows = Math.floor(pack.height / frame.h);
      expectFramesInside(animationsOf(m), frame, columns, rows);
      for (const name of need) expect(animationsOf(m)[name], `${kind}/${id} ${name}`).toBeDefined();
    }
  });

  it('families: six kinds, each block inside the sheet, blocks never overlap, frames inside blocks', () => {
    for (const [id, pack] of Object.entries(FAMILY_PACKS)) {
      const kinds: Partial<Record<string, FamilyKind>> = pack.manifest.kinds ?? {};
      expect(Object.keys(kinds).sort(), id).toEqual([...ENEMY_TYPE_NAMES].sort());
      const rects: { type: string; x0: number; y0: number; x1: number; y1: number }[] = [];
      for (const type of ENEMY_TYPE_NAMES) {
        const k = kinds[type];
        expect(k, `${id}/${type}`).toBeDefined();
        if (!k) continue;
        const off = k.offset ?? { x: 0, y: 0 };
        let maxIndex = 0;
        for (const name of ['move', 'attack', 'hit', 'die']) {
          const a = k.animations[name];
          expect(a, `${id}/${type} ${name}`).toBeDefined();
          for (const i of a?.frames ?? []) maxIndex = Math.max(maxIndex, i);
        }
        const rows = Math.ceil((maxIndex + 1) / k.columns);
        const rect = { type, x0: off.x, y0: off.y, x1: off.x + Math.min(k.columns, maxIndex + 1) * k.frame.w, y1: off.y + rows * k.frame.h };
        expect(rect.x1, `${id}/${type} right`).toBeLessThanOrEqual(pack.width);
        expect(rect.y1, `${id}/${type} bottom`).toBeLessThanOrEqual(pack.height);
        rects.push(rect);
        if (type === 'spitter' || type === 'gunner') {
          expect(k.muzzle, `${id}/${type} muzzle`).toBeDefined();
          if (k.muzzle) { expect(k.muzzle.x).toBeLessThan(k.frame.w); expect(k.muzzle.y).toBeLessThan(k.frame.h); expect(k.muzzle.x).toBeGreaterThan(k.frame.w / 2); }
        } else expect(k.muzzle).toBeUndefined();
      }
      for (const a of rects) for (const b of rects) {
        if (a === b) continue;
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${id}: ${a.type} overlaps ${b.type}`).toBe(false);
      }
      const frameOf = (t: 'crusher' | 'gunner' | 'runner') => kinds[t]?.frame.w ?? 0;
      expect(frameOf('crusher')).toBeGreaterThan(frameOf('runner') * 2);
      expect(frameOf('gunner')).toBeGreaterThan(frameOf('runner') * 2);
    }
  });

  it('bases match the footprint the engine expects', () => {
    for (const pack of Object.values(BASE_PACKS)) {
      const m = pack.manifest;
      expect(m.frame).toEqual({ w: 120, h: 120 }); // (Stage 6B: 96 before, for a base of 56)
      expect(m.columns).toBe(4);
      expect(m.body).toEqual({ w: 80, h: 80 });
      expect(m.overhang).toBe(24);
      expect(m.anchor?.x).toBe(0.5);
      expect(m.anchor?.y).toBeCloseTo((24 + 40) / 120, 4); // the 80 square is at y 24..104, so that 24 px (the allowed overhang) are left above it
    }
  });

  it('weapons: muzzle inside the frame, anchor is a fraction, bullet styles as specified', () => {
    const bullets: Record<string, [string, string]> = {
      pistol: ['dot', '#ffe066'], rapid: ['dot', '#7ee8ff'], heavy: ['dot', '#ff9f43'], shotgun: ['dot', '#ffd6a5'], piercing: ['streak', '#c792ff'],
    };
    for (const [id, pack] of Object.entries(WEAPON_PACKS)) {
      const m = pack.manifest;
      expect(m.frame).toEqual({ w: 40, h: 24 });
      expect(m.columns).toBe(4);
      expect(m.muzzle).toBeDefined();
      if (m.muzzle) { expect(m.muzzle.x).toBeGreaterThan(0); expect(m.muzzle.x).toBeLessThan(40); expect(m.muzzle.y).toBeGreaterThan(0); expect(m.muzzle.y).toBeLessThan(24); }
      expect(m.anchor?.x).toBeGreaterThan(0); expect(m.anchor?.x).toBeLessThan(1);
      expect([m.bullet?.style, m.bullet?.color]).toEqual(bullets[id]);
    }
  });

  it('biomes: tiles, wall and props fit inside the sheet and do not overlap each other', () => {
    const ambient: Record<string, string> = { 'ice-base': 'snow', 'desert-ruins': 'dust', 'dark-forest': 'fireflies', 'alien-lab': 'sparks', 'neon-arena': 'sparks' };
    for (const [id, pack] of Object.entries(BIOME_PACKS)) {
      const m = pack.manifest;
      const tiles = m.tiles; const wall = m.wall; const props = m.props ?? [];
      expect(tiles?.count, id).toBe(6);
      const o = tiles?.offset ?? { x: 0, y: 0 };
      expect(o.x + (tiles?.count ?? 0) * 64, id).toBeLessThanOrEqual(pack.width);
      expect(o.y + 64, id).toBeLessThanOrEqual(pack.height);
      expect(wall).toEqual({ x: 0, y: 64, w: 64, h: 64 });
      expect(props.length, id).toBeGreaterThanOrEqual(4); expect(props.length, id).toBeLessThanOrEqual(6);
      const rects = [{ x: 0, y: 0, w: 64 * 6, h: 64 }, { x: 0, y: 64, w: 64, h: 64 }, ...props];
      props.forEach((p) => {
        expect(p.y, id).toBeGreaterThanOrEqual(128);
        expect(p.x + p.w, id).toBeLessThanOrEqual(pack.width); expect(p.y + p.h, id).toBeLessThanOrEqual(pack.height);
        for (const n of [p.w, p.h]) { expect(n).toBeGreaterThanOrEqual(16); expect(n).toBeLessThanOrEqual(40); }
      });
      rects.forEach((a, i) => rects.forEach((b, j) => { if (i < j) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${id}: rect ${i} overlaps ${j}`).toBe(false); }));
      expect(m.ambient, id).toBe(ambient[id] ?? 'none');
    }
  });
});

describe('procedural packs: painting', () => {
  it.each(ALL)('%s/%s paints with a fake context, enough calls, and deterministically', (_kind, _id, pack) => {
    const a = fakeContext(); pack.paint(a.ctx);
    const b = fakeContext(); pack.paint(b.ctx);
    expect(drawCalls(a.calls)).toBeGreaterThanOrEqual(20);
    expect(b.calls).toEqual(a.calls);
  });
});

describe('procedural source files', () => {
  const dir = join(__dirname, '..', 'src', 'game', 'art', 'procedural');
  it('use neither Math.random nor Date.now', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text, f).not.toContain('Math.random');
      expect(text, f).not.toContain('Date.now');
      expect(text, f).not.toMatch(/\b(document|window)\./);
    }
  });
});
