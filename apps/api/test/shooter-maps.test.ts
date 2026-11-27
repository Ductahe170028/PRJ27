import { describe, expect, it, vi } from 'vitest';
import { BRUTE_CLEARANCE, OBSTACLE_MARGIN, ShooterLevelSchema, freeSpaceConnected, pointRectDistance } from '@game-creator/contracts';
import { SHOOTER_MAPS, ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { MAP_SIMPLIFIED_NOTICE, SALT_MAP, compileShooter } from '../src/shooter/compile.js';
import { MAP_TEMPLATES, MAX_VARIANTS, MIN_GAP, SCATTER_TRIES, START_CLEARANCE, gapsAreWide, scatter, type MapName, type Obstacle } from '../src/shooter/maps.js';
import { deriveRng, makeRng } from '../src/shooter/rng.js';

// These tests compile hundreds or thousands of levels (about 5 s each alone, several times
// that when the whole suite runs in parallel); vitest's default 5 s timeout is too short.
vi.setConfig({ testTimeout: 120_000 });

const shaped = SHOOTER_MAPS.filter((map): map is Exclude<MapName, 'open-arena'> => map !== 'open-arena');
const brief = (map: MapName): ShooterBrief => ShooterBriefSchema.parse({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', loadout: 'all', title: 'Map', theme: 'zombie-city', map, enemies: [{ type: 'runner', share: 5 }],
  intensity: 2, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [],
});
/** The raw layout a template draws for `seed` at `variant`, exactly as the compiler asks for it. */
const raw = (map: MapName, seed: number, variant = 0): Obstacle[] => MAP_TEMPLATES[map](deriveRng(seed, SALT_MAP + variant), variant);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const key = (obstacles: readonly Obstacle[]) => JSON.stringify(obstacles);

describe('map variety (variant 0, seeds 1-300)', () => {
  const seeds = range(1, 300);

  it.each(shaped)('%s: at least 95% of the layouts differ from each other, and none is common', (map) => {
    const count = new Map<string, number>();
    for (const seed of seeds) count.set(key(raw(map, seed)), (count.get(key(raw(map, seed))) ?? 0) + 1);
    const most = Math.max(...count.values());
    console.info(`[shooter] ${map}: ${count.size} distinct layouts in ${seeds.length}, most frequent ${most}`);
    expect(count.size).toBeGreaterThanOrEqual(seeds.length * 0.95);
    expect(most / seeds.length).toBeLessThanOrEqual(0.02);
  });

  it.each(shaped)('%s: the obstacles reach every part of the field', (map) => {
    const strips = new Set<number>();
    const halves = new Set<number>();
    for (const seed of seeds) for (const block of raw(map, seed)) {
      strips.add(map === 'cross-corridors' ? Math.floor((block.x - 200) / 140) : Math.floor(block.x / 160));
      halves.add(block.y < 305 ? 0 : 1);
    }
    expect(halves.size).toBe(2); // upper half and lower half
    if (map === 'cross-corridors') expect([...strips].filter((strip) => strip >= 0 && strip <= 3).sort()).toEqual([0, 1, 2, 3]); // 4 strips between x=200 and x=760
    else expect([...strips].sort()).toEqual([0, 1, 2, 3, 4, 5]); // 6 vertical strips of 160 px
  });

  it.each(shaped)('%s: variant 0 is usable for at least 70% of the seeds', (map) => {
    const usable = seeds.filter((seed) => {
      const compiled = compileShooter(brief(map), seed);
      return compiled.variant === 0 && compiled.map === map;
    }).length;
    console.info(`[shooter] ${map}: variant 0 used for ${(100 * usable / seeds.length).toFixed(1)}% of ${seeds.length} seeds`);
    expect(usable / seeds.length).toBeGreaterThanOrEqual(0.7);
  });

  it.each(shaped)('%s: it falls back to the empty arena for at most 1% of 1000 seeds', (map) => {
    let simplified = 0;
    for (const seed of range(1, 1000)) {
      const compiled = compileShooter(brief(map), seed * 7919);
      if (compiled.notices.includes(MAP_SIMPLIFIED_NOTICE)) { simplified += 1; expect(compiled.map).toBe('open-arena'); }
    }
    console.info(`[shooter] ${map}: ${simplified}/1000 simplified to the empty arena`);
    expect(simplified).toBeLessThanOrEqual(10);
  });

  it('cross-corridors: at least 90% of the layouts are not mirror images (across x = 480 or y = 305)', () => {
    const mirrored = (blocks: readonly Obstacle[], flip: (b: Obstacle) => Obstacle) => {
      const own = new Set(blocks.map((b) => `${b.x},${b.y},${b.width},${b.height}`));
      return blocks.length > 0 && blocks.every((b) => { const m = flip(b); return own.has(`${m.x},${m.y},${m.width},${m.height}`); });
    };
    const symmetric = seeds.filter((seed) => {
      const blocks = raw('cross-corridors', seed);
      return mirrored(blocks, (b) => ({ ...b, x: 960 - b.x })) || mirrored(blocks, (b) => ({ ...b, y: 610 - b.y }));
    }).length;
    expect(symmetric / seeds.length).toBeLessThanOrEqual(0.1);
    // and the four blocks have their own sizes
    const sizes = new Set(raw('cross-corridors', 5).map((b) => `${b.width}x${b.height}`));
    expect(sizes.size).toBeGreaterThan(1);
  });

  it('cross-corridors: now and then a block is missing (a T), but not usually', () => {
    const sizes = seeds.map((seed) => raw('cross-corridors', seed).length);
    expect(sizes.every((n) => n === 3 || n === 4)).toBe(true);
    const three = sizes.filter((n) => n === 3).length / seeds.length;
    expect(three).toBeGreaterThan(0.15);
    expect(three).toBeLessThan(0.45);
  });

  it('pillars: 4 to 8 squares (mean 5 to 7), never touching or overlapping', () => {
    let total = 0;
    for (const seed of seeds) {
      const pillars = raw('pillars', seed);
      expect(pillars.length).toBeGreaterThanOrEqual(3);
      expect(pillars.length).toBeLessThanOrEqual(8);
      total += pillars.length;
      for (const [i, a] of pillars.entries()) {
        expect(a.width).toBe(a.height);
        expect(a.width).toBeGreaterThanOrEqual(50);
        expect(a.width).toBeLessThanOrEqual(70);
        for (const b of pillars.slice(i + 1)) {
          const gap = Math.sqrt(Math.max(Math.abs(a.x - b.x) - (a.width + b.width) / 2, 0) ** 2 + Math.max(Math.abs(a.y - b.y) - (a.height + b.height) / 2, 0) ** 2);
          expect(gap, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_GAP); // so: not touching, not overlapping
        }
      }
    }
    const mean = total / seeds.length;
    console.info(`[shooter] pillars: mean ${mean.toFixed(2)} per layout`);
    expect(mean).toBeGreaterThanOrEqual(5);
    expect(mean).toBeLessThanOrEqual(7);
  });

  it('ring: one to three big blocks, each 150 px or more from the center of the field', () => {
    const counts = new Set<number>();
    for (const seed of seeds) {
      const blocks = raw('ring', seed);
      counts.add(blocks.length);
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks.length).toBeLessThanOrEqual(3);
      for (const block of blocks) {
        expect(block.width).toBeGreaterThanOrEqual(100); expect(block.width).toBeLessThanOrEqual(200);
        expect(block.height).toBeGreaterThanOrEqual(60); expect(block.height).toBeLessThanOrEqual(140);
        expect(pointRectDistance(480, 305, block), `seed ${seed}`).toBeGreaterThanOrEqual(150);
      }
    }
    expect([...counts].sort()).toEqual([1, 2, 3]);
  });

  it('rooms: one or two walls; the vertical ones are not over the start; gaps of 110-160 px', () => {
    for (const seed of seeds) {
      const walls = raw('rooms', seed);
      expect(walls.length).toBeGreaterThanOrEqual(1);
      expect(walls.length).toBeLessThanOrEqual(4); // two vertical walls are two pieces each
      for (const wall of walls) expect(pointRectDistance(480, 305, wall), `seed ${seed}`).toBeGreaterThanOrEqual(START_CLEARANCE);
    }
    const kinds = new Set(seeds.map((seed) => raw('rooms', seed).map((wall) => (wall.width > wall.height ? 'h' : 'v')).sort().join('')));
    expect(kinds.size).toBeGreaterThan(3); // vertical, horizontal and mixed layouts all occur
  });
});

describe('every variant 0-7 hands out valid layouts', () => {
  it.each(shaped)('%s: raw layouts follow the contract, and compiled levels are usable', (map) => {
    const problems: string[] = [];
    const means: number[] = [];
    for (let variant = 0; variant < MAX_VARIANTS; variant += 1) {
      let blocks = 0;
      for (const seed of range(1, 120)) {
        const layout = raw(map, seed, variant);
        blocks += layout.length;
        if (layout.length > 12) problems.push(`v${variant} s${seed}: ${layout.length} obstacles`);
        for (const b of layout) {
          const whole = [b.x, b.y, b.width, b.height].every(Number.isInteger);
          if (!whole || b.width % 2 !== 0 || b.height % 2 !== 0) problems.push(`v${variant} s${seed}: not whole or not even`);
          if (b.width < 20 || b.width > 400 || b.height < 20 || b.height > 400) problems.push(`v${variant} s${seed}: size out of 20..400`);
          if (b.x - b.width / 2 < 0 || b.x + b.width / 2 > 960 || b.y - b.height / 2 < 70 || b.y + b.height / 2 > 540) problems.push(`v${variant} s${seed}: outside the field`);
        }
        // the compiler asked to start at this variant: whatever it hands out must hold
        const compiled = compileShooter(brief(map), seed, { rejectLayout: (_name, v) => v < variant });
        const { level } = compiled;
        if (!ShooterLevelSchema.safeParse(level).success) problems.push(`v${variant} s${seed}: schema`);
        if (!freeSpaceConnected(level, BRUTE_CLEARANCE)) problems.push(`v${variant} s${seed}: not connected`);
        if (!gapsAreWide(level.obstacles)) problems.push(`v${variant} s${seed}: narrow gap`);
        if (level.spawnPoints.length < 3) problems.push(`v${variant} s${seed}: few spawn points`);
        if (compiled.variant < variant && compiled.map === map) problems.push(`v${variant} s${seed}: used an earlier variant`);
        for (const b of level.obstacles) if (pointRectDistance(480, 305, b) < OBSTACLE_MARGIN) problems.push(`v${variant} s${seed}: too close to the start`);
      }
      means.push(blocks / 120);
    }
    expect(problems.slice(0, 10)).toEqual([]);
    // later variants are tamer: not more blocks than variant 0 (cross-corridors keeps its four)
    expect(means[MAX_VARIANTS - 1]!).toBeLessThanOrEqual(means[0]! + 0.01);
  });

  it('pillars and rings lose blocks as the variant grows (one fewer every 3 variants, never below the floor)', () => {
    const mean = (map: 'pillars' | 'ring', variant: number) => range(1, 150).reduce((sum, seed) => sum + raw(map, seed, variant).length, 0) / 150;
    expect(mean('pillars', 6)).toBeLessThan(mean('pillars', 0) - 1.5);
    expect(mean('pillars', 7)).toBeGreaterThanOrEqual(3 - 0.01); // floor 3
    expect(mean('ring', 6)).toBeLessThan(mean('ring', 0));
    for (const seed of range(1, 80)) expect(raw('ring', seed, 7).length).toBeGreaterThanOrEqual(1);
  });
});

describe('scatter', () => {
  const spec = { count: [4, 8], fewerEvery: 3, floor: 3, width: [50, 70], height: [50, 70], square: true } as const;

  it('is deterministic: the same generator state gives the same blocks, another gives other blocks', () => {
    const a = scatter(makeRng(42), 0, spec);
    expect(scatter(makeRng(42), 0, spec)).toEqual(a);
    expect(scatter(makeRng(43), 0, spec)).not.toEqual(a);
    expect(scatter(makeRng(42), 3, spec)).not.toEqual(a);
  });

  it('draws the same numbers whatever the outcome: the generator ends in a state that depends only on the seed', () => {
    const next = (seed: number) => { const rng = makeRng(seed); scatter(rng, 0, spec); return rng(); };
    expect(next(7)).toBe(next(7));
    // a field too crowded to place anything draws exactly as much as one that is empty would: tries are not skipped
    const crowded = { ...spec, count: [8, 8], width: [400, 400], height: [400, 400], square: true } as const;
    const a = makeRng(9); scatter(a, 0, crowded);
    const b = makeRng(9); scatter(b, 0, crowded);
    expect(a()).toBe(b());
  });

  it('keeps every block inside the field, clear of the start, of the edges and of each other', () => {
    for (const seed of range(1, 200)) {
      const blocks = scatter(makeRng(seed), 0, spec);
      expect(gapsAreWide(blocks)).toBe(true);
      for (const [i, a] of blocks.entries()) {
        expect(pointRectDistance(480, 305, a)).toBeGreaterThanOrEqual(START_CLEARANCE);
        for (const b of blocks.slice(i + 1)) expect(a.x === b.x && a.y === b.y).toBe(false);
      }
    }
    expect(START_CLEARANCE).toBe(OBSTACLE_MARGIN + 40);
  });

  it('gives up on a block after 60 tries and returns what it has (fewer blocks, no error)', () => {
    const impossible = { count: [3, 3], fewerEvery: 3, floor: 1, width: [400, 400], height: [400, 400] } as const;
    const blocks = scatter(makeRng(1), 0, impossible);
    expect(blocks.length).toBeLessThan(3);
    expect(SCATTER_TRIES).toBe(60);
    expect(scatter(makeRng(1), 0, { ...impossible, awayFromCenter: 5000 })).toEqual([]);
  });

  it('a larger variant asks for fewer blocks', () => {
    const wanted = (variant: number) => range(1, 100).reduce((sum, seed) => sum + scatter(makeRng(seed), variant, { ...spec, width: [20, 20], height: [20, 20] }).length, 0) / 100;
    expect(wanted(6)).toBeLessThan(wanted(0));
    expect(wanted(7)).toBeGreaterThanOrEqual(3);
  });
});
