import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ENEMY_TYPES, MAX_SCHEDULED_ENEMIES, ShooterLevelSchema, bossWaveOf, type ShooterLevel } from '@game-creator/contracts';
import { AIError } from '../src/providers/errors.js';
import { BOSSES, PLAYER_HEALTHS, SHOOTER_MAPS, ShooterBriefSchema, WEAPONS, normalizeBrief, type ShooterBrief } from '../src/shooter/brief.js';
import { BOSS_GOAL_NOTICE, compileShooter } from '../src/shooter/compile.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import { BOSS_MIN_SHARE, BOSS_THIN_FACTOR, GATE_SEEDS, MAX_THIN_STEPS, THINNED_NOTICE, UNWINNABLE_MESSAGE, gateLevel } from '../src/shooter/gate.js';
import { BOSS_HP_BY_INTENSITY, bossHpFor } from '../src/shooter/presets.js';
import { SHOOTER_BRIEF_SYSTEM_PROMPT, briefJsonSchema, describeBrief } from '../src/shooter/prompt.js';
import { BOSS_TIMING, INTENSITY_RATE, meanWeight, paceFactor, scheduleWaves } from '../src/shooter/waves.js';
import type { PlayResult } from '@game-creator/contracts';

vi.setConfig({ testTimeout: 60_000 });

const raw = (patch: Record<string, unknown> = {}) => ({
  version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', title: 'Boss', theme: 'military-base', map: 'pillars',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 3, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 90 }, unsupported: [] as unknown[], ...patch,
}) as Record<string, any>;
const brief = (patch: Record<string, unknown> = {}): ShooterBrief => ShooterBriefSchema.parse(normalizeBrief(raw(patch)));
const total = (level: ShooterLevel) => level.waves.reduce((sum, wave) => sum + wave.count, 0);
const result = (level: ShooterLevel, won: boolean): PlayResult => ({ status: won ? 'won' : 'lost', seconds: 1, kills: 0, hp: 1, maxHp: 1, hpLeft: won ? 1 : 0, state: { level } as never });

describe('the brief takes a boss', () => {
  it('none, crusher, gunner', () => {
    expect([...BOSSES]).toEqual(['none', 'crusher', 'gunner']);
    for (const boss of BOSSES) expect(ShooterBriefSchema.safeParse(raw({ boss })).success, boss).toBe(true);
  });
  it('missing becomes "none" (the one guess); a value that is there but wrong is refused', () => {
    const { boss: _omit, ...without } = raw();
    void _omit;
    expect((normalizeBrief(without) as Record<string, unknown>).boss).toBe('none');
    expect(ShooterBriefSchema.safeParse(without).success).toBe(false); // the schema itself needs it
    for (const bad of ['giant', 'Crusher', '', null, 2, true, ['crusher']]) {
      const parsed = ShooterBriefSchema.safeParse(normalizeBrief(raw({ boss: bad })));
      expect(parsed.success, String(bad)).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('boss');
    }
  });
});

describe('compiling a brief with a boss', () => {
  it('has exactly one boss wave, wins by defeating it, and says so', () => {
    for (const boss of ['crusher', 'gunner'] as const) {
      const compiled = compileShooter(brief({ boss }), 5);
      const bosses = compiled.level.waves.filter((w) => w.type === boss);
      expect(bosses).toHaveLength(1);
      expect(bosses[0]!.count).toBe(1);
      expect(compiled.level.waves.filter((w) => w.type === 'crusher' || w.type === 'gunner')).toHaveLength(1);
      expect(compiled.level.win).toEqual({ type: 'boss' });
      expect(compiled.notices).toContain(BOSS_GOAL_NOTICE);
      expect(BOSS_GOAL_NOTICE).toBe('Màn có boss: thắng bằng cách hạ boss.');
      expect(ShooterLevelSchema.safeParse(compiled.level).success).toBe(true);
    }
  });

  it('bossHp is the kind\'s hit points times the factor of the intensity, rounded, 10..400', () => {
    // the factors are tuned (docs/shooter-calibration.md): they must stay inside 0.4..1.8 and not go down with the intensity
    expect(BOSS_HP_BY_INTENSITY).toHaveLength(5);
    for (const f of BOSS_HP_BY_INTENSITY) { expect(f).toBeGreaterThanOrEqual(0.4); expect(f).toBeLessThanOrEqual(1.8); }
    BOSS_HP_BY_INTENSITY.forEach((f, i) => { if (i > 0) expect(f).toBeGreaterThanOrEqual(BOSS_HP_BY_INTENSITY[i - 1]!); });
    for (const [intensity, factor] of [1, 2, 3, 4, 5].map((i) => [i, BOSS_HP_BY_INTENSITY[i - 1]!] as const)) {
      expect(compileShooter(brief({ boss: 'crusher', intensity }), 7).level.bossHp, `crusher ${intensity}`).toBe(Math.round(ENEMY_TYPES.crusher.hp * factor));
      expect(compileShooter(brief({ boss: 'gunner', intensity }), 7).level.bossHp, `gunner ${intensity}`).toBe(Math.round(ENEMY_TYPES.gunner.hp * factor));
    }
    expect(bossHpFor('crusher', 3)).toBe(Math.round(ENEMY_TYPES.crusher.hp * BOSS_HP_BY_INTENSITY[2]!));
    expect(bossHpFor('gunner', 1)).toBe(Math.max(10, Math.round(ENEMY_TYPES.gunner.hp * BOSS_HP_BY_INTENSITY[0]!)));
    expect(bossHpFor('crusher', 99)).toBe(ENEMY_TYPES.crusher.hp); // an intensity outside 1..5 is not a crash (the brief schema holds it to 1..5 anyway)
  });

  it('survive S: the boss comes at 70% of S, rounded to 5 s, at least 20 s', () => {
    for (const [seconds, at] of [[20, 20], [40, 30], [60, 40], [90, 65], [120, 85], [180, 125]] as const) {
      const level = compileShooter(brief({ boss: 'crusher', goal: { type: 'survive', seconds } }), 3).level;
      expect(bossWaveOf(level)!.atMs, `survive ${seconds}`).toBe(at * 1000);
    }
  });

  it('kill N: the first part lasts 70% of the kill horizon; the kill count no longer decides the win', () => {
    for (const count of [10, 40, 100, 200]) {
      const b = brief({ boss: 'gunner', goal: { type: 'kill', count } });
      const horizon = scheduleWaves(b, () => 0).horizonSeconds;
      const level = compileShooter(b, 3).level;
      expect(bossWaveOf(level)!.atMs, `kill ${count}`).toBe(Math.max(20, Math.round((horizon * 0.7) / 5) * 5) * 1000);
      expect(level.win).toEqual({ type: 'boss' });
    }
  });

  it('the timing numbers stay inside the limits of Stage 4C.1 (docs/shooter-calibration.md)', () => {
    expect(BOSS_TIMING.atShare).toBeGreaterThanOrEqual(0.65); expect(BOSS_TIMING.atShare).toBeLessThanOrEqual(0.8);
    expect(BOSS_TIMING.beforePace).toBeGreaterThanOrEqual(0.4); expect(BOSS_TIMING.beforePace).toBeLessThanOrEqual(0.9);
    expect(BOSS_TIMING.afterPace).toBeGreaterThanOrEqual(0.15); expect(BOSS_TIMING.afterPace).toBeLessThanOrEqual(0.4);
    expect(BOSS_TIMING.afterSeconds).toBeGreaterThanOrEqual(15); expect(BOSS_TIMING.afterSeconds).toBeLessThanOrEqual(30);
  });

  it('before the boss the others come at beforePace of the pace of the same brief without a boss; after it, at afterPace for afterSeconds, then stop', () => {
    const enemies = [{ type: 'swarmer', share: 5 }];
    for (const intensity of [2, 3, 5]) {
      const level = compileShooter(brief({ boss: 'crusher', intensity, enemies, goal: { type: 'survive', seconds: 90 } }), 4).level;
      const at = bossWaveOf(level)!.atMs;
      const ordinary = level.waves.filter((w) => w.type !== 'crusher');
      const sum = (waves: typeof ordinary) => waves.reduce((n, w) => n + w.count, 0);
      const before = sum(ordinary.filter((w) => w.atMs < at));
      const after = sum(ordinary.filter((w) => w.atMs >= at));
      // The same brief with no boss, as long as the first part (its pace is the one of that length): the "plain" schedule.
      const plain = scheduleWaves(brief({ boss: 'none', intensity, enemies, goal: { type: 'survive', seconds: at / 1000 } }), () => 0).waves;
      const plainTotal = plain.reduce((n, w) => n + w.count, 0);
      expect(before / plainTotal, `before, intensity ${intensity}`).toBeGreaterThan(BOSS_TIMING.beforePace - 0.12);
      expect(before / plainTotal, `before, intensity ${intensity}`).toBeLessThan(BOSS_TIMING.beforePace + 0.12);
      // After: one slice every 5 s for afterSeconds, each round(rate * 5 * afterPace) (at least 1).
      const rate = (INTENSITY_RATE[intensity - 1]! * paceFactor(at / 1000)) / meanWeight(enemies as never);
      expect(after, `after, intensity ${intensity}`).toBe((BOSS_TIMING.afterSeconds / 5) * Math.max(1, Math.round(rate * 5 * BOSS_TIMING.afterPace)));
      expect(Math.max(...ordinary.map((w) => w.atMs))).toBeLessThan(at + BOSS_TIMING.afterSeconds * 1000);
      expect(ordinary.some((w) => w.atMs >= at)).toBe(true); // some come after it
      expect(level.waves.length).toBeLessThanOrEqual(30);
      expect(total(level)).toBeLessThanOrEqual(MAX_SCHEDULED_ENEMIES);
    }
  });

  it('a level with a boss has fewer ordinary enemies than the same brief without one (most at the high intensities)', () => {
    for (const intensity of [3, 4, 5]) {
      const withBoss = compileShooter(brief({ boss: 'gunner', intensity, goal: { type: 'survive', seconds: 60 } }), 8).level;
      const without = compileShooter(brief({ boss: 'none', intensity, goal: { type: 'survive', seconds: 60 } }), 8).level;
      expect(total(withBoss) - 1, `intensity ${intensity}`).toBeLessThan(total(without));
    }
  });

  it('every combination stays inside the level limits: at most 30 waves with the boss, 400 enemies', () => {
    for (const boss of ['crusher', 'gunner'] as const) for (const intensity of [1, 3, 5]) {
      for (const goal of [{ type: 'survive', seconds: 20 }, { type: 'survive', seconds: 180 }, { type: 'kill', count: 10 }, { type: 'kill', count: 200 }]) {
        for (const enemies of [[{ type: 'swarmer', share: 5 }], [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }]]) {
          const level = compileShooter(brief({ boss, intensity, goal, enemies }), 11).level;
          const label = `${boss} I${intensity} ${JSON.stringify(goal)} ${enemies.length} kinds`;
          expect(level.waves.length, label).toBeLessThanOrEqual(30);
          expect(total(level), label).toBeLessThanOrEqual(MAX_SCHEDULED_ENEMIES);
          expect(ShooterLevelSchema.safeParse(level).success, label).toBe(true);
        }
      }
    }
  });

  it('every map, weapon and health compiles to a valid boss level', () => {
    for (const map of SHOOTER_MAPS) for (const weapon of WEAPONS) for (const playerHealth of PLAYER_HEALTHS) {
      expect(ShooterLevelSchema.safeParse(compileShooter(brief({ boss: 'gunner', map, weapon, playerHealth }), 2).level).success, `${map} ${weapon} ${playerHealth}`).toBe(true);
    }
  });

  it('a brief with no boss compiles to exactly the levels of Stage 4A: the 30 compiled games of the old golden file', () => {
    const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim.json', import.meta.url), 'utf8')) as { cases: Array<{ name: string; level: ShooterLevel }> };
    const MIXES: Array<ShooterBrief['enemies']> = [
      [{ type: 'runner', share: 5 }], [{ type: 'brute', share: 5 }], [{ type: 'swarmer', share: 5 }],
      [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }],
    ];
    const SURVIVE = [30, 60, 90, 45, 120];
    const KILL = [15, 40, 70, 25, 100];
    const OLD_WEAPONS = ['pistol', 'rapid', 'heavy'] as const;
    for (let i = 0; i < 30; i += 1) {
      const survive = i % 2 === 0;
      const b = ShooterBriefSchema.parse({
        version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', enemyFamily: 'auto', title: `Golden ${i}`, theme: 'zombie-city',
        map: SHOOTER_MAPS[i % SHOOTER_MAPS.length], enemies: MIXES[i % MIXES.length], intensity: ((Math.floor(i / 5) + i) % 5) + 1,
        playerHealth: PLAYER_HEALTHS[(i + Math.floor(i / 3)) % PLAYER_HEALTHS.length], weapon: OLD_WEAPONS[i % OLD_WEAPONS.length],
        goal: survive ? { type: 'survive', seconds: SURVIVE[(i >> 1) % SURVIVE.length] } : { type: 'kill', count: KILL[(i >> 1) % KILL.length] }, unsupported: [],
      });
      const stored = golden.cases.find((c) => c.name === `compiled:${i}`)!.level;
      const now = compileShooter(b, 9000 + i * 37).level;
      // (the `look` of Stage 5A is clothes only: the level is compared without it, the golden file stays as it was)
      const { look: _look, ...bare } = now;
      expect(JSON.stringify(bare), `compiled:${i}`).toBe(JSON.stringify(stored));
      expect(now.look, `compiled:${i}`).toBeDefined();
      expect('bossHp' in now).toBe(false);
    }
  });
});

describe('the gate with a boss', () => {
  const bossLevel = (bossHp: number | undefined, boss: 'crusher' | 'gunner' = 'crusher') => {
    const level = compileShooter(brief({ boss, intensity: 3 }), 6).level;
    return bossHp === undefined ? (() => { const { bossHp: _drop, ...rest } = level; void _drop; return rest as ShooterLevel; })() : { ...level, bossHp };
  };
  /** Plays a fake game that is won once the level has been thinned `after` times; records every level it was shown. */
  const thinUntil = (level: ShooterLevel, after: number) => {
    const seen: ShooterLevel[] = [];
    const play = (lvl: ShooterLevel) => {
      if (!seen.some((s) => JSON.stringify(s) === JSON.stringify({ ...lvl, seed: s.seed }))) seen.push(lvl);
      const steps = seen.length - 1;
      return result(lvl, steps >= after);
    };
    return { out: gateLevel(level, { play }), seen };
  };

  it('each thinning step lowers the boss\'s hit points by 10% (rounded down) and the other enemies by 20%, never the boss wave', () => {
    expect(BOSS_THIN_FACTOR).toBe(0.9);
    expect(BOSS_MIN_SHARE).toBe(0.4);
    const level = bossLevel(100);
    const { out, seen } = thinUntil(level, 3);
    expect(out.report.thinSteps).toBe(3);
    expect(seen.map((s) => s.bossHp)).toEqual([100, 90, 81, 72]);
    expect(out.report.bossHp).toBe(72);
    for (const s of seen) {
      expect(s.waves.filter((w) => w.type === 'crusher')).toEqual(level.waves.filter((w) => w.type === 'crusher'));
      expect(s.win).toEqual({ type: 'boss' });
    }
    const ordinary = (l: ShooterLevel) => l.waves.filter((w) => w.type !== 'crusher').reduce((n, w) => n + w.count, 0);
    expect(ordinary(seen[1]!)).toBeLessThan(ordinary(seen[0]!));
    expect(ordinary(seen[3]!)).toBeLessThanOrEqual(Math.round(ordinary(seen[0]!) * 0.8 ** 3) + 1);
    expect(out.notices).toEqual([THINNED_NOTICE]);
  });

  it('the boss never goes below 40% of the original, nor below 10', () => {
    const { seen } = thinUntil(bossLevel(100), MAX_THIN_STEPS);
    expect(seen.map((s) => s.bossHp)).toEqual([100, 90, 81, 72, 64, 57, 51]);
    expect(Math.min(...seen.map((s) => s.bossHp!))).toBeGreaterThanOrEqual(40);
    const small = thinUntil(bossLevel(20), MAX_THIN_STEPS).seen.map((s) => s.bossHp);
    expect(small).toEqual([20, 18, 16, 14, 12, 10, 10].slice(0, small.length)); // 40% of 20 is 8: the floor of 10 holds
    expect(Math.min(...small.map((v) => v!))).toBe(10);
    // 40% of 60 is 24: reached after 9 steps' worth? 60 -> 54 -> 48 -> 43 -> 38 -> 34 -> 30: still above 24
    expect(thinUntil(bossLevel(60), MAX_THIN_STEPS).seen.map((s) => s.bossHp)).toEqual([60, 54, 48, 43, 38, 34, 30]);
  });

  it('without bossHp in the level the kind\'s own hit points are the start', () => {
    const level = bossLevel(undefined, 'gunner');
    expect(level.bossHp).toBeUndefined();
    const { seen } = thinUntil(level, 2);
    const base = ENEMY_TYPES.gunner.hp; // no bossHp in the level: the kind's own hit points are the start
    expect(seen.map((s) => s.bossHp)).toEqual([undefined, Math.floor(base * 0.9), Math.floor(Math.floor(base * 0.9) * 0.9)]);
  });

  it('a level that is already won is not touched, and reports its boss', () => {
    const level = bossLevel(100);
    const out = gateLevel(level, { play: (lvl) => result(lvl, true) });
    expect(out.level).toEqual(level);
    expect(out.notices).toEqual([]);
    expect(out.report.bossHp).toBe(100);
  });

  it('a level without a boss thins exactly as before, with no bossHp in its report', () => {
    const level = compileShooter(brief({ boss: 'none' }), 6).level;
    const out = gateLevel(level, { play: (lvl) => result(lvl, total(lvl) < total(level)) });
    expect(out.report.thinSteps).toBe(1);
    expect('bossHp' in out.report).toBe(false);
    expect(out.level.waves.every((w) => ENEMY_TYPES[w.type].hp >= 1)).toBe(true);
  });

  it('a boss level that cannot be won is refused after all the steps, and a kill goal is NOT lowered (it would change nothing)', () => {
    let gates = 0;
    const goals: string[] = [];
    let thrown: unknown;
    try {
      compileAndGate({ brief: brief({ boss: 'crusher', goal: { type: 'kill', count: 200 } }), seed: 9 }, { play: (lvl) => { gates += 1; goals.push(JSON.stringify(lvl.win)); return result(lvl, false); } });
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AIError);
    expect(thrown).toMatchObject({ code: 'unwinnable_level', message: UNWINNABLE_MESSAGE });
    expect(gates).toBe(GATE_SEEDS * (1 + MAX_THIN_STEPS)); // one compile, one gate
    expect(new Set(goals)).toEqual(new Set([JSON.stringify({ type: 'boss' })]));
  });

  it('with the real bot a boss brief comes out as a level the bot can win, with the boss notice first among the engine\'s', () => {
    const out = compileAndGate({ brief: brief({ boss: 'crusher', intensity: 2, weapon: 'rapid' }), seed: 3 });
    expect(out.level.win).toEqual({ type: 'boss' });
    expect(out.notices[0]).toBe(BOSS_GOAL_NOTICE);
    expect(out.report.wins).toBeGreaterThanOrEqual(2);
    expect(out.report.bossHp).toBeLessThanOrEqual(Math.round(ENEMY_TYPES.crusher.hp * 0.8));
  });
});

describe('what the model is told about the boss', () => {
  const text = SHOOTER_BRIEF_SYSTEM_PROMPT;
  it('the field list has boss, from the same list as the schema', () => {
    expect(describeBrief().join('\n')).toContain('boss: none|crusher|gunner');
    expect(text).toContain(describeBrief().join('\n'));
    expect(JSON.stringify(briefJsonSchema())).toContain('crusher');
  });
  it('says when to use each boss and that a boss level is won by defeating it', () => {
    expect(text).toMatch(/boss: none by default; crusher when the user wants a final boss that is big, huge, a monster, a melee boss or a tank/);
    expect(text).toMatch(/gunner when the boss shoots \(a robot, a commander, a gunman, a mage/);
    expect(text).toMatch(/when unsure but a boss is wanted, crusher/);
    expect(text).toMatch(/won by defeating the boss, whatever goal you pick/);
  });
  it('no longer says there are no bosses, and names what is still missing', () => {
    expect(text).not.toMatch(/NO bosses/);
    expect(text).toContain('more than one boss, mini-bosses, bosses that summon enemies');
    for (const word of ['vehicles', 'multiplayer', 'towers', 'repairing the base', 'more than one base', 'reloading', 'crafting', 'traps', 'explosions or area damage']) expect(text).toContain(word);
  });
});
