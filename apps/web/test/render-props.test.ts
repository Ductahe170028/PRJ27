import { describe, expect, it } from 'vitest';
import { FIELD, SHOOTER_LEVELS, baseRectOf, pointRectDistance } from '@game-creator/contracts';
import { AMBIENT_COUNT, PROP_CLEARANCE, PROP_MAX, PROP_MIN, ambientSpeck, hash32, placeProps, tileVariant, unit, type Ambient } from '../src/game/render/props';

const KINDS = [{ w: 20, h: 16 }, { w: 30, h: 30 }, { w: 16, h: 24 }, { w: 36, h: 20 }];
const LEVELS = Object.entries(SHOOTER_LEVELS);

describe('integer hashing (no Math.random)', () => {
  it('gives the same number for the same inputs and spreads the others out', () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(1, 2, 4));
    expect(hash32(1, 2, 3)).not.toBe(hash32(2, 1, 3));
    const values = new Set(Array.from({ length: 1000 }, (_, i) => hash32(7, i)));
    expect(values.size).toBe(1000);
    for (let i = 0; i < 200; i += 1) expect(unit(5, i)).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 200; i += 1) expect(unit(5, i)).toBeLessThan(1);
  });

  it('is evenly spread over tile variants', () => {
    const counts = new Array<number>(6).fill(0);
    for (let col = 0; col < 40; col += 1) for (let row = 0; row < 40; row += 1) counts[tileVariant(4242, col, row, 6)]! += 1;
    for (const count of counts) expect(count).toBeGreaterThan(1600 / 6 / 1.5);
    expect(tileVariant(1, 2, 3, 6)).toBe(tileVariant(1, 2, 3, 6));
    expect(tileVariant(1, 2, 3, 1)).toBe(0);
  });
});

describe('where the props lie', () => {
  it.each(LEVELS)('%s: the same level always gets the same props', (_name, level) => {
    expect(placeProps(level, KINDS)).toEqual(placeProps(structuredClone(level), KINDS));
  });

  it.each(LEVELS)('%s: 25 to 40 props, inside the field', (_name, level) => {
    const props = placeProps(level, KINDS);
    expect(props.length).toBeGreaterThanOrEqual(PROP_MIN);
    expect(props.length).toBeLessThanOrEqual(PROP_MAX);
    for (const prop of props) {
      expect(prop.x).toBeGreaterThanOrEqual(0);
      expect(prop.x).toBeLessThanOrEqual(960);
      expect(prop.y).toBeGreaterThanOrEqual(FIELD.top);
      expect(prop.y).toBeLessThanOrEqual(FIELD.bottom);
      expect(prop.index).toBeLessThan(KINDS.length);
    }
  });

  it.each(LEVELS)('%s: at least 24 px from obstacles, the base, the player and every spawn point, and not on each other', (_name, level) => {
    const props = placeProps(level, KINDS);
    const half = (index: number) => Math.max(KINDS[index]!.w, KINDS[index]!.h) / 2;
    for (const prop of props) {
      const r = half(prop.index);
      for (const block of level.obstacles) expect(pointRectDistance(prop.x, prop.y, block) - r).toBeGreaterThanOrEqual(PROP_CLEARANCE);
      if (level.base) expect(pointRectDistance(prop.x, prop.y, baseRectOf(level.base)) - r).toBeGreaterThanOrEqual(PROP_CLEARANCE);
      expect(Math.hypot(prop.x - level.player.x, prop.y - level.player.y) - r).toBeGreaterThanOrEqual(PROP_CLEARANCE);
      for (const spawn of level.spawnPoints) expect(Math.hypot(prop.x - spawn.x, prop.y - spawn.y) - r).toBeGreaterThanOrEqual(PROP_CLEARANCE);
    }
    for (let i = 0; i < props.length; i += 1) {
      for (let j = i + 1; j < props.length; j += 1) {
        expect(Math.hypot(props[i]!.x - props[j]!.x, props[i]!.y - props[j]!.y)).toBeGreaterThanOrEqual(half(props[i]!.index) + half(props[j]!.index));
      }
    }
  });

  it('puts the props somewhere else for another seed, and gives none when the biome has no props', () => {
    const level = SHOOTER_LEVELS.arena;
    expect(placeProps({ ...level, seed: level.seed + 1 }, KINDS)).not.toEqual(placeProps(level, KINDS));
    expect(placeProps(level, [])).toEqual([]);
  });

  it('flips about half of them', () => {
    const flips = LEVELS.flatMap(([, level]) => placeProps(level, KINDS)).filter((prop) => prop.flip).length;
    const total = LEVELS.flatMap(([, level]) => placeProps(level, KINDS)).length;
    expect(flips / total).toBeGreaterThan(0.3);
    expect(flips / total).toBeLessThan(0.7);
  });
});

describe('the air', () => {
  const kinds: Ambient[] = ['snow', 'dust', 'fireflies', 'sparks'];

  it('has at most 40 specks of any kind, and none for "none"', () => {
    for (const kind of kinds) expect(AMBIENT_COUNT[kind]).toBeLessThanOrEqual(40);
    expect(AMBIENT_COUNT.none).toBe(0);
  });

  it.each(kinds)('%s: a speck is a pure function of (index, time, seed) and stays inside the field', (kind) => {
    for (let i = 0; i < AMBIENT_COUNT[kind]; i += 1) {
      for (const ms of [0, 1234, 60_000, 3_600_000]) {
        const a = ambientSpeck(kind, i, ms, 99);
        expect(a).toEqual(ambientSpeck(kind, i, ms, 99));
        expect(a.x).toBeGreaterThanOrEqual(-30);
        expect(a.x).toBeLessThanOrEqual(990);
        expect(a.y).toBeGreaterThanOrEqual(FIELD.top - 25);
        expect(a.y).toBeLessThanOrEqual(FIELD.bottom + 25);
        expect(a.alpha).toBeGreaterThanOrEqual(0);
        expect(a.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it('moves with time (snow falls)', () => {
    const a = ambientSpeck('snow', 3, 0, 5);
    const b = ambientSpeck('snow', 3, 2000, 5);
    expect(b.y).not.toBe(a.y);
  });
});
