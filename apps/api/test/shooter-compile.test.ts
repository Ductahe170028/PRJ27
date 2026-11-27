import { describe, expect, it } from 'vitest';
import {
  BRUTE_CLEARANCE, ShooterLevelSchema, createSim, freeSpaceConnected, snapshotHash, type ShooterLevel,
} from '@game-creator/contracts';
import { PLAYER_HEALTHS, SHOOTER_MAPS, SHOOTER_THEMES, ShooterBriefSchema, WEAPONS, type ShooterBrief } from '../src/shooter/brief.js';
import { MAP_SIMPLIFIED_NOTICE, compileShooter } from '../src/shooter/compile.js';
import { MAX_VARIANTS, MIN_GAP, gapsAreWide } from '../src/shooter/maps.js';
import { HEALTH_HP, PLAYER_SPEED, THEMES, WEAPONS as WEAPON_PRESETS } from '../src/shooter/presets.js';
import { deriveRng } from '../src/shooter/rng.js';
import { BRUTE_NOT_BEFORE, ENEMY_WEIGHT, INTENSITY_RATE, MAX_WAVES, MAX_WAVE_COUNT, killTarget, scheduleWaves } from '../src/shooter/waves.js';

const brief = (patch: Partial<ShooterBrief> = {}): ShooterBrief => ShooterBriefSchema.parse({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', title: 'Zombie City', theme: 'zombie-city', map: 'open-arena',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 3, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [], ...patch,
});

// WCAG relative luminance and contrast ratio
const luminance = (hex: string) => {
  const channel = (shift: number) => {
    const value = ((Number.parseInt(hex.slice(1), 16) >> shift) & 255) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('presets', () => {
  it('every theme keeps player, enemy and bullet at 3:1 or better against the background', () => {
    for (const theme of SHOOTER_THEMES) {
      const colors = THEMES[theme];
      for (const part of ['player', 'enemy', 'bullet'] as const) {
        expect(contrast(colors.background, colors[part]), `${theme} ${part}`).toBeGreaterThanOrEqual(3);
      }
      expect(colors.player.toLowerCase(), theme).not.toBe(colors.enemy.toLowerCase());
      expect(contrast(colors.background, colors.wall), `${theme} wall`).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('the tables hold the numbers of the brief', () => {
    expect(HEALTH_HP).toEqual({ fragile: 3, normal: 5, sturdy: 8 });
    expect(PLAYER_SPEED).toBe(210);
    expect(WEAPON_PRESETS.pistol).toEqual({ cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 });
    expect(WEAPON_PRESETS.rapid).toEqual({ cooldownMs: 150, bulletSpeed: 650, damage: 1, range: 500 });
    expect(WEAPON_PRESETS.heavy).toEqual({ cooldownMs: 600, bulletSpeed: 700, damage: 3, range: 700 });
  });

  it('every theme x weapon x health compiles to a valid level that uses those presets', () => {
    for (const theme of SHOOTER_THEMES) for (const weapon of WEAPONS) for (const playerHealth of PLAYER_HEALTHS) {
      const { level } = compileShooter(brief({ theme, weapon, playerHealth }), 7);
      expect(ShooterLevelSchema.safeParse(level).success).toBe(true);
      expect(level.theme).toEqual(THEMES[theme]);
      expect(level.weapon).toEqual(WEAPON_PRESETS[weapon]);
      expect(level.player).toEqual({ x: 480, y: 305, speed: 210, hp: HEALTH_HP[playerHealth] });
    }
  });
});

describe('maps', () => {
  const SEEDS = 200;
  it.each(SHOOTER_MAPS)('%s: %i seeds, every layout the compiler hands out is usable', (map) => {
    const bad: string[] = [];
    let simplified = 0;
    const distinct = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const compiled = compileShooter(brief({ map }), seed * 7919);
      const { level } = compiled;
      if (!ShooterLevelSchema.safeParse(level).success) bad.push(`${seed}: schema`);
      if (!freeSpaceConnected(level, BRUTE_CLEARANCE)) bad.push(`${seed}: not connected`);
      if (!gapsAreWide(level.obstacles)) bad.push(`${seed}: narrow gap`);
      if (level.spawnPoints.length < 3) bad.push(`${seed}: ${level.spawnPoints.length} spawn points`);
      if (level.obstacles.length > 12) bad.push(`${seed}: too many obstacles`);
      // every spawn point reaches the player, one by one
      for (const spawn of level.spawnPoints) if (!freeSpaceConnected({ ...level, spawnPoints: [spawn] }, BRUTE_CLEARANCE)) bad.push(`${seed}: spawn ${spawn.x},${spawn.y} cut off`);
      if (compiled.notices.length > 0) { simplified += 1; expect(compiled.notices).toEqual([MAP_SIMPLIFIED_NOTICE]); expect(level.obstacles).toEqual([]); }
      distinct.add(JSON.stringify(level.obstacles));
    }
    console.info(`[shooter] map ${map}: ${simplified}/${SEEDS} simplified to an empty arena, ${distinct.size} distinct layouts`);
    expect(bad).toEqual([]);
    if (map === 'open-arena') { expect(simplified).toBe(0); expect(distinct.size).toBe(1); }
    else { expect(simplified).toBeLessThanOrEqual(SEEDS * 0.05); expect(distinct.size).toBeGreaterThan(20); }
  });

  it('the map is what its name says: its blocks have the shape of the template, wherever they stand', () => {
    const level = (map: ShooterBrief['map'], seed: number) => compileShooter(brief({ map }), seed).level;
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(level('open-arena', seed).obstacles).toHaveLength(0);
      const pillars = level('pillars', seed).obstacles;
      expect(pillars.length).toBeGreaterThanOrEqual(3);
      expect(pillars.length).toBeLessThanOrEqual(8);
      for (const pillar of pillars) { expect(pillar.width).toBe(pillar.height); expect(pillar.width).toBeGreaterThanOrEqual(50); expect(pillar.width).toBeLessThanOrEqual(70); }
      const cross = level('cross-corridors', seed).obstacles;
      expect([3, 4]).toContain(cross.length); // four blocks, now and then one missing
      for (const block of cross) { expect(block.width).toBeGreaterThanOrEqual(120); expect(block.width).toBeLessThanOrEqual(190); expect(block.height).toBeGreaterThanOrEqual(50); expect(block.height).toBeLessThanOrEqual(80); }
      expect(level('rooms', seed).obstacles.length).toBeGreaterThanOrEqual(1);
      const ring = level('ring', seed).obstacles;
      expect(ring.length).toBeGreaterThanOrEqual(1);
      expect(ring.length).toBeLessThanOrEqual(3);
      for (const block of ring) { expect(block.width).toBeGreaterThanOrEqual(100); expect(block.width).toBeLessThanOrEqual(200); expect(block.height).toBeGreaterThanOrEqual(60); expect(block.height).toBeLessThanOrEqual(140); }
    }
  });

  it('a layout that does not fit falls to the next variant, and in the end to the empty arena with the exact notice', () => {
    const forced = compileShooter(brief({ map: 'pillars' }), 99, { rejectLayout: () => true });
    expect(forced.level.obstacles).toEqual([]);
    expect(forced.map).toBe('open-arena');
    expect(forced.notices).toEqual(['Bản đồ được đơn giản hóa thành đấu trường trống.']);
    expect(ShooterLevelSchema.safeParse(forced.level).success).toBe(true);

    const second = compileShooter(brief({ map: 'pillars' }), 99, { rejectLayout: (_map, variant) => variant < 3 });
    expect(second.variant).toBe(3);
    expect(second.map).toBe('pillars');
    expect(second.notices).toEqual([]);

    // the empty arena asked for by name is not "simplified"
    expect(compileShooter(brief({ map: 'open-arena' }), 99, { rejectLayout: () => true }).notices).toEqual([]);
    expect(MAX_VARIANTS).toBe(8);
  });

  it('the narrowest passage a layout may leave is the brute plus slack', () => {
    expect(MIN_GAP).toBe(BRUTE_CLEARANCE + 12);
    const wall = (x: number) => ({ x, y: 300, width: 40, height: 100 });
    expect(gapsAreWide([wall(300), wall(300 + 40 + 30)])).toBe(false); // 30 px slit
    expect(gapsAreWide([wall(300), wall(300 + 40 + MIN_GAP)])).toBe(true);
    expect(gapsAreWide([wall(300), wall(320)])).toBe(true); // touching/overlapping is a wall
    expect(gapsAreWide([{ x: 30, y: 300, width: 40, height: 100 }])).toBe(false); // 10 px from the edge
  });
});

describe('waves', () => {
  const mixes: Array<ShooterBrief['enemies']> = [
    [{ type: 'runner', share: 1 }], [{ type: 'brute', share: 1 }], [{ type: 'swarmer', share: 1 }],
    [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
    [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 7 }],
    [{ type: 'brute', share: 9 }, { type: 'runner', share: 1 }],
  ];
  const goals: Array<ShooterBrief['goal']> = [
    { type: 'survive', seconds: 20 }, { type: 'survive', seconds: 60 }, { type: 'survive', seconds: 180 },
    { type: 'kill', count: 10 }, { type: 'kill', count: 60 }, { type: 'kill', count: 200 },
  ];

  it('every combination: shares within 15 points, brute not early, caps, goal rules', () => {
    const problems: string[] = [];
    let cases = 0;
    for (const enemies of mixes) for (const goal of goals) for (const intensity of [1, 2, 3, 4, 5]) for (const seed of [1, 2, 3]) {
      cases += 1;
      const b = brief({ enemies, goal, intensity });
      const key = `${enemies.map((e) => `${e.type}${e.share}`).join('+')} ${JSON.stringify(goal)} i${intensity} s${seed}`;
      const { waves, horizonSeconds } = scheduleWaves(b, deriveRng(seed, 5));
      const total = waves.reduce((sum, wave) => sum + wave.count, 0);
      if (total > 400) problems.push(`${key}: ${total} enemies`);
      if (waves.length > MAX_WAVES) problems.push(`${key}: ${waves.length} waves`);
      if (waves.some((wave) => wave.count < 1 || wave.count > MAX_WAVE_COUNT)) problems.push(`${key}: a wave count out of 1..40`);
      if (waves.some((wave) => wave.atMs < 0 || wave.atMs > 600_000)) problems.push(`${key}: time out of range`);
      // the mix follows the shares
      const sum = enemies.reduce((acc, e) => acc + e.share, 0);
      for (const e of enemies) {
        const seen = waves.filter((wave) => wave.type === e.type).reduce((acc, wave) => acc + wave.count, 0) / total;
        if (Math.abs(seen - e.share / sum) > 0.15) problems.push(`${key}: ${e.type} is ${seen.toFixed(2)} of the enemies, wanted ${(e.share / sum).toFixed(2)}`);
      }
      // a brute waits for a quarter of the horizon unless it is alone
      if (enemies.length > 1) {
        for (const wave of waves) if (wave.type === 'brute' && wave.atMs < horizonSeconds * 1000 * BRUTE_NOT_BEFORE) problems.push(`${key}: brute at ${wave.atMs} ms`);
      }
      if (goal.type === 'survive' && !waves.some((wave) => wave.atMs < goal.seconds * 1000)) problems.push(`${key}: no wave before the end`);
      if (goal.type === 'kill' && total < killTarget(goal.count)) problems.push(`${key}: ${total} < ${killTarget(goal.count)}`);
    }
    expect(cases).toBe(6 * 6 * 5 * 3);
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('intensity raises the number of enemies; kill levels hold 1.3 times the goal', () => {
    const count = (intensity: number) => scheduleWaves(brief({ intensity }), deriveRng(1, 5)).waves.reduce((sum, wave) => sum + wave.count, 0);
    const totals = [1, 2, 3, 4, 5].map(count);
    for (let i = 1; i < totals.length; i += 1) expect(totals[i]!).toBeGreaterThan(totals[i - 1]!);
    expect(killTarget(40)).toBe(52);
    const kill = scheduleWaves(brief({ goal: { type: 'kill', count: 40 } }), deriveRng(1, 5)).waves;
    expect(kill.reduce((sum, wave) => sum + wave.count, 0)).toBeGreaterThanOrEqual(52);
  });

  it('a brute-only game has fewer enemies than a swarmer-only one at the same intensity (weights)', () => {
    const total = (type: 'brute' | 'swarmer') => scheduleWaves(brief({ enemies: [{ type, share: 5 }] }), deriveRng(1, 5)).waves.reduce((sum, wave) => sum + wave.count, 0);
    expect(total('brute')).toBeLessThan(total('swarmer') / 2);
    expect(ENEMY_WEIGHT.brute).toBeGreaterThan(ENEMY_WEIGHT.swarmer);
    expect(INTENSITY_RATE).toHaveLength(5);
  });
});

describe('compileShooter', () => {
  it('is deterministic: the same brief and seed give the same level, byte for byte', () => {
    for (const map of SHOOTER_MAPS) {
      const b = brief({ map, enemies: [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }] });
      const one = compileShooter(b, 31337);
      const two = compileShooter(b, 31337);
      expect(JSON.stringify(one.level)).toBe(JSON.stringify(two.level));
      expect(snapshotHash(createSim(one.level))).toBe(snapshotHash(createSim(two.level)));
      expect(one.notices).toEqual(two.notices);
    }
  });

  it('a different seed gives a different level', () => {
    const b = brief({ map: 'pillars' });
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(compileShooter(b, seed).level)));
    expect(seen.size).toBeGreaterThan(5);
    const hashes = new Set([1, 2, 3, 4].map((seed) => snapshotHash(createSim(compileShooter(b, seed).level))));
    expect(hashes.size).toBeGreaterThan(1);
  });

  it('every output passes the level schema, and carries the brief', () => {
    const goals: Array<ShooterBrief['goal']> = [{ type: 'survive', seconds: 45 }, { type: 'kill', count: 33 }];
    for (const goal of goals) for (const map of SHOOTER_MAPS) for (const seed of [1, 2, 3]) {
      const { level } = compileShooter(brief({ map, goal, title: 'Tiêu đề thử' }), seed);
      const parsed: ShooterLevel = ShooterLevelSchema.parse(level);
      expect(parsed.title).toBe('Tiêu đề thử');
      expect(parsed.win).toEqual(goal.type === 'survive' ? { type: 'survive', seconds: 45 } : { type: 'kill', count: 33 });
      expect(parsed.seed).toBe(seed);
    }
  });

  it('keeps the seed inside the level range, whatever it is given', () => {
    for (const seed of [0, 2 ** 31, 2 ** 40 + 5, -17, 123.9]) {
      const { level } = compileShooter(brief(), seed);
      expect(Number.isInteger(level.seed)).toBe(true);
      expect(level.seed).toBeGreaterThanOrEqual(0);
      expect(level.seed).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it('an invalid level is a bug, reported as a plain error with the field', () => {
    const broken = { ...brief(), title: '<b>no</b>' } as ShooterBrief; // a brief that never passed the schema
    expect(() => compileShooter(broken, 1)).toThrowError(/compileShooter produced an invalid level \(title:/);
    expect(() => compileShooter(broken, 1)).not.toThrowError(expect.objectContaining({ code: expect.anything() }));
  });
});
