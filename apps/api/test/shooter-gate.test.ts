import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ShooterLevelSchema, createCasualBot, playLevel, type PlayResult, type ShooterLevel } from '@game-creator/contracts';
import { AIError } from '../src/providers/errors.js';
import { ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import {
  KILL_REDUCE_FACTOR, MAX_KILL_REDUCTIONS, MIN_KILL_COUNT, compileAndGate, killReducedNotice,
} from '../src/shooter/compile-job.js';
import {
  GATE_SEEDS, MAX_THIN_STEPS, MIN_WINS, THINNED_NOTICE, UNWINNABLE_MESSAGE, gateLevel,
} from '../src/shooter/gate.js';
import { killTarget } from '../src/shooter/waves.js';

const brief = (patch: Record<string, unknown> = {}): ShooterBrief => ShooterBriefSchema.parse({
  version: 'brief-1', healthDrops: 'none', title: 'Gate', theme: 'zombie-city', map: 'open-arena',
  enemies: [{ type: 'runner', share: 5 }, { type: 'swarmer', share: 5 }],
  intensity: 4, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [], ...patch,
});
const total = (level: ShooterLevel) => level.waves.reduce((sum, wave) => sum + wave.count, 0);
/** A fake game result: the gate only reads status and hpLeft. */
const result = (level: ShooterLevel, won: boolean, hpLeft = won ? 1 : 0): PlayResult => ({
  status: won ? 'won' : 'lost', seconds: 1, kills: 0, hp: 1, maxHp: 1, hpLeft, state: { level } as never,
});

describe('thinning a level the bot cannot win', () => {
  it('thins by x0.8 until the bot wins, and says so once', () => {
    const level = compileShooter(brief(), 5).level;
    const start = total(level);
    const seen: number[] = [];
    const play = (lvl: ShooterLevel) => { seen.push(total(lvl)); return result(lvl, total(lvl) <= start * 0.7); };
    const gated = gateLevel(level, { play });
    expect(gated.report.thinSteps).toBe(2); // 100% -> 80% -> 64%: the bot wins at the third level, after two steps down
    expect(total(gated.level)).toBeLessThanOrEqual(start * 0.7);
    expect(total(gated.level)).toBeGreaterThanOrEqual(start * 0.3);
    expect(gated.notices).toEqual([THINNED_NOTICE]);
    expect(seen).toHaveLength(GATE_SEEDS * 3);
    expect(ShooterLevelSchema.safeParse(gated.level).success).toBe(true);
    expect(gated.report.wins).toBe(GATE_SEEDS);
  });

  it('never goes below 25% of the original density: 6 steps at most, then unwinnable_level', () => {
    const level = compileShooter(brief(), 5).level;
    let calls = 0;
    const play = (lvl: ShooterLevel) => { calls += 1; return result(lvl, false); };
    let thrown: unknown;
    try { gateLevel(level, { play }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AIError);
    expect(thrown).toMatchObject({ code: 'unwinnable_level', status: 422, issues: ['goal'], message: UNWINNABLE_MESSAGE });
    expect((thrown as AIError).message).toBe('Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.');
    expect(calls).toBe(GATE_SEEDS * (1 + MAX_THIN_STEPS));
    expect(MAX_THIN_STEPS).toBe(6); // 4 while the gate's bot was the expert; the casual bot needs up to 6 (docs/shooter-calibration.md)
    expect(0.8 ** MAX_THIN_STEPS).toBeGreaterThanOrEqual(0.25);
  });

  it('thinning really removes enemies even when every wave holds only one or two', () => {
    const level = compileShooter(brief({ enemies: [{ type: 'brute', share: 5 }], intensity: 3 }), 8).level;
    expect(level.waves.every((wave) => wave.count <= 2)).toBe(true);
    const sizes: number[] = [];
    gateLevel(level, { play: (lvl) => { sizes.push(total(lvl)); return result(lvl, total(lvl) < total(level) * 0.7); } });
    expect(Math.min(...sizes)).toBeLessThan(total(level) * 0.7);
  });

  it('a kill level keeps at least 1.3 times the goal and is stretched in time instead', () => {
    const b = brief({ goal: { type: 'kill', count: 40 } });
    const level = compileShooter(b, 6).level;
    const lastAt = Math.max(...level.waves.map((wave) => wave.atMs));
    let attempts = 0;
    const gated = gateLevel(level, { play: (lvl) => { attempts += 1; return result(lvl, attempts > GATE_SEEDS * 2); } });
    expect(gated.report.thinSteps).toBe(2);
    expect(total(gated.level)).toBeGreaterThanOrEqual(killTarget(40));
    expect(gated.level.win).toEqual({ type: 'kill', count: 40 });
    expect(Math.max(...gated.level.waves.map((wave) => wave.atMs))).toBeGreaterThan(lastAt);
    expect(ShooterLevelSchema.safeParse(gated.level).success).toBe(true);
  });
});

/** A fake bot that wins exactly on the first `n` of the gate's seeds (level.seed + 1 .. + 3), whatever the level. */
const winsFirst = (base: ShooterLevel, n: number) => (lvl: ShooterLevel) => result(lvl, lvl.seed - base.seed <= n);

describe('the 2-of-3 threshold, and a gate that never makes a level harder', () => {
  it('MIN_WINS is 2 of 3', () => {
    expect(GATE_SEEDS).toBe(3);
    expect(MIN_WINS).toBe(2);
  });

  it('a bot that wins 1 of 3 is not enough: the level is thinned', () => {
    const level = compileShooter(brief(), 5).level;
    let calls = 0;
    const gated = gateLevel(level, {
      play: (lvl) => {
        calls += 1;
        // 1 of 3 at the original density, 3 of 3 once it has been thinned
        return result(lvl, total(lvl) < total(level) || lvl.seed - level.seed === 1);
      },
    });
    expect(gated.report.thinSteps).toBe(1);
    expect(total(gated.level)).toBeLessThan(total(level));
    expect(gated.notices).toEqual([THINNED_NOTICE]);
    expect(calls).toBe(GATE_SEEDS * 2);
  });

  it('2 of 3 is accepted at once, unchanged and without a notice', () => {
    const level = compileShooter(brief(), 5).level;
    const gated = gateLevel(level, { play: winsFirst(level, 2) });
    expect(gated.level).toEqual(level);
    expect(gated.report).toMatchObject({ thinSteps: 0, wins: 2, scheduled: total(level) });
    expect(gated.notices).toEqual([]);
  });

  it('3 of 3 is accepted at once and never thickened, at any intensity and with all hp left', () => {
    for (const intensity of [1, 2, 3, 4, 5]) {
      const b = brief({ intensity });
      const level = compileShooter(b, 5).level;
      const gated = gateLevel(level, { play: (lvl) => result(lvl, true, 1) });
      expect(gated.level, `intensity ${intensity}`).toEqual(level);
      expect(gated.notices, `intensity ${intensity}`).toEqual([]);
      expect(gated.report.thinSteps).toBe(0);
    }
    const kill = brief({ intensity: 5, goal: { type: 'kill', count: 60 } });
    const level = compileShooter(kill, 5).level;
    expect(gateLevel(level, { play: (lvl) => result(lvl, true, 1) }).level).toEqual(level);
  });

  it('1 of 3 at every step (and 0 of 3) ends in unwinnable_level after the last thinning step', () => {
    for (const wins of [0, 1]) {
      const level = compileShooter(brief(), 5).level;
      let calls = 0;
      let thrown: unknown;
      try { gateLevel(level, { play: (lvl) => { calls += 1; return winsFirst(level, wins)(lvl); } }); } catch (error) { thrown = error; }
      expect(thrown, `${wins} wins`).toBeInstanceOf(AIError);
      expect(thrown).toMatchObject({ code: 'unwinnable_level', status: 422, issues: ['goal'] });
      expect(calls).toBe(GATE_SEEDS * (1 + MAX_THIN_STEPS));
    }
  });

  it('no code or text is left that makes a level harder', () => {
    for (const file of ['gate.ts', 'compile-job.ts', 'notices.ts']) {
      const source = readFileSync(new URL(`../src/shooter/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/thicken|khó hơn/i);
    }
  });
});

describe('a kill goal that is too heavy is lowered, not refused', () => {
  const kill = (count: number) => brief({ goal: { type: 'kill', count }, enemies: [{ type: 'brute', share: 6 }, { type: 'runner', share: 4 }] });
  /** Fake bot: wins when the goal is at most `limit`. */
  const winsUpTo = (limit: number) => (lvl: ShooterLevel) => result(lvl, lvl.win.type === 'kill' && lvl.win.count <= limit);

  it('x0.7 rounded down, at most 3 times, with the same seed, and one fixed notice with N and M', () => {
    const goals: number[] = [];
    const out = compileAndGate({ brief: kill(200), seed: 9 }, { play: (lvl) => { if (lvl.win.type === 'kill' && goals.at(-1) !== lvl.win.count) goals.push(lvl.win.count); return winsUpTo(68)(lvl); } });
    expect(goals).toEqual([200, 140, 98, 68]);
    expect(out.level.win).toEqual({ type: 'kill', count: 68 });
    expect(out.report.killReductions).toBe(3);
    expect(out.notices).toEqual(['Mục tiêu hạ 200 quái quá nặng; đã giảm còn 68.']);
    expect(killReducedNotice(200, 68)).toBe('Mục tiêu hạ 200 quái quá nặng; đã giảm còn 68.');
    expect(KILL_REDUCE_FACTOR).toBe(0.7);
    // same seed on every attempt: the level seed is the job seed
    expect(out.level.seed).toBe(9);
  });

  it('says it once, with the final number, whatever the number of reductions', () => {
    const one = compileAndGate({ brief: kill(100), seed: 9 }, { play: winsUpTo(70) });
    expect(one.notices).toEqual(['Mục tiêu hạ 100 quái quá nặng; đã giảm còn 70.']);
    expect(one.report.killReductions).toBe(1);
    const two = compileAndGate({ brief: kill(100), seed: 9 }, { play: winsUpTo(49) });
    expect(two.notices).toEqual(['Mục tiêu hạ 100 quái quá nặng; đã giảm còn 49.']);
  });

  it('a goal that already wins is left alone, with no notice', () => {
    const out = compileAndGate({ brief: kill(100), seed: 9 }, { play: winsUpTo(100) });
    expect(out.level.win).toEqual({ type: 'kill', count: 100 });
    expect(out.report.killReductions).toBe(0);
    expect(out.notices.some((notice) => notice.includes('quá nặng'))).toBe(false);
  });

  it('after 3 reductions it still loses: unwinnable_level', () => {
    const goals = new Set<number>();
    let gates = 0;
    let thrown: unknown;
    try {
      compileAndGate({ brief: kill(200), seed: 9 }, { play: (lvl) => { if (lvl.win.type === 'kill') goals.add(lvl.win.count); gates += 1; return result(lvl, false); } });
    } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ code: 'unwinnable_level', status: 422, message: UNWINNABLE_MESSAGE });
    expect([...goals]).toEqual([200, 140, 98, 68]);
    expect(MAX_KILL_REDUCTIONS).toBe(3);
    expect(gates).toBe((1 + MAX_KILL_REDUCTIONS) * GATE_SEEDS * (1 + MAX_THIN_STEPS));
  });

  it('never goes below 10', () => {
    const goals = new Set<number>();
    expect(() => compileAndGate({ brief: kill(12), seed: 9 }, { play: (lvl) => { if (lvl.win.type === 'kill') goals.add(lvl.win.count); return result(lvl, false); } })).toThrow();
    expect([...goals]).toEqual([12, MIN_KILL_COUNT]);
    const floor = new Set<number>();
    expect(() => compileAndGate({ brief: kill(10), seed: 9 }, { play: (lvl) => { if (lvl.win.type === 'kill') floor.add(lvl.win.count); return result(lvl, false); } })).toThrow();
    expect([...floor]).toEqual([10]);
  });

  it('a survive goal is never lowered: the time stays and the level is refused', () => {
    const seconds = new Set<number>();
    let gates = 0;
    expect(() => compileAndGate({ brief: brief({ goal: { type: 'survive', seconds: 90 } }), seed: 9 }, {
      play: (lvl) => { if (lvl.win.type === 'survive') seconds.add(lvl.win.seconds); gates += 1; return result(lvl, false); },
    })).toThrow(/Không dựng được/);
    expect([...seconds]).toEqual([90]);
    expect(gates).toBe(GATE_SEEDS * (1 + MAX_THIN_STEPS)); // one gate only, no second compile
  });

  it('with the real bot: a heavy goal with brutes is lowered, and the result is the same bit for bit', () => {
    // (with the pistol or the heavy gun, the casual bot cannot win a 200-kill brute level even after three reductions: unwinnable_level)
    const b = ShooterBriefSchema.parse({
      version: 'brief-1', healthDrops: 'none', title: 'Heavy', theme: 'zombie-city', map: 'pillars',
      enemies: [{ type: 'brute', share: 5 }, { type: 'runner', share: 3 }, { type: 'swarmer', share: 2 }],
      intensity: 3, playerHealth: 'normal', weapon: 'rapid', goal: { type: 'kill', count: 150 }, unsupported: [],
    });
    const first = compileAndGate({ brief: b, seed: 1 });
    expect(first.report.killReductions).toBeGreaterThan(0);
    expect(first.level.win.type === 'kill' && first.level.win.count).toBeLessThan(150);
    const m = first.level.win.type === 'kill' ? first.level.win.count : 0;
    expect(first.notices).toContain(killReducedNotice(150, m));
    expect(first.report.wins).toBeGreaterThanOrEqual(MIN_WINS);
    expect(ShooterLevelSchema.safeParse(first.level).success).toBe(true);
    expect(JSON.stringify(compileAndGate({ brief: b, seed: 1 }))).toBe(JSON.stringify(first));
  }, 60_000);
});

describe('the gate with the real bot', () => {
  it('the gate plays with the casual bot, says so in its report, and gives the same answer every time', () => {
    const level = compileShooter(brief({ intensity: 3 }), 21).level;
    const first = gateLevel(level);
    expect(first.report.bot).toBe('casual');
    expect(JSON.stringify(gateLevel(level))).toBe(JSON.stringify(first));
    // a test's own player is named as such
    expect(gateLevel(level, { play: (lvl) => result(lvl, true, 1) }).report.bot).toBe('custom');
  });

  it('what it reports is what a fresh casual bot does on the same seeds', () => {
    const level = compileShooter(brief({ intensity: 3 }), 21).level;
    const gated = gateLevel(level);
    const wins = [1, 2, 3].filter((i) => playLevel({ ...gated.level, seed: gated.level.seed + i }, createCasualBot(gated.level.seed + i)).status === 'won').length;
    expect(gated.report.wins).toBe(wins);
  });

  it('a brief that is too hard comes out as a level the bot wins', () => {
    const b = brief({ intensity: 5, playerHealth: 'fragile', enemies: [{ type: 'brute', share: 6 }, { type: 'swarmer', share: 4 }], map: 'rooms' });
    for (const seed of [1, 2, 3]) {
      const out = compileAndGate({ brief: b, seed });
      expect(ShooterLevelSchema.safeParse(out.level).success).toBe(true);
      const wins = [1, 2, 3].filter((i) => playLevel({ ...out.level, seed: out.level.seed + i }, createCasualBot(out.level.seed + i)).status === 'won').length;
      expect(wins, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_WINS);
      expect(out.report.wins).toBeGreaterThanOrEqual(MIN_WINS);
    }
  }, 60_000);

  it('notices are unique and fixed sentences', () => {
    const b = brief({ intensity: 5, map: 'pillars' });
    const out = compileAndGate({ brief: b, seed: 3 }, { rejectLayout: () => true });
    expect(new Set(out.notices).size).toBe(out.notices.length);
    expect(out.notices[0]).toBe('Bản đồ được đơn giản hóa thành đấu trường trống.');
    for (const notice of out.notices) expect(notice.length).toBeLessThanOrEqual(160);
  });

  it('compile + gate of a 60 s and a 180 s level fit well inside the 8 s limit', () => {
    for (const seconds of [60, 180]) {
      const b = brief({ intensity: 4, goal: { type: 'survive', seconds } });
      const before = process.cpuUsage();
      compileAndGate({ brief: b, seed: 11 });
      const used = process.cpuUsage(before);
      expect((used.user + used.system) / 1e6, `${seconds} s level`).toBeLessThan(6);
    }
  }, 60_000);

  it('the worst case (kill 200 with brutes at intensity 5, every reduction used) stays well inside the 8 s limit', () => {
    const b = brief({ intensity: 5, goal: { type: 'kill', count: 200 }, enemies: [{ type: 'brute', share: 6 }, { type: 'runner', share: 4 }], playerHealth: 'fragile' });
    const before = process.cpuUsage();
    try { compileAndGate({ brief: b, seed: 11 }); } catch (error) { expect(error).toMatchObject({ code: 'unwinnable_level' }); }
    const used = process.cpuUsage(before);
    expect((used.user + used.system) / 1e6).toBeLessThan(6);
  }, 60_000);
});
