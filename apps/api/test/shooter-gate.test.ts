import { describe, expect, it } from 'vitest';
import { ShooterLevelSchema, botInput, playLevel, type PlayResult, type ShooterLevel } from '@game-creator/contracts';
import { AIError } from '../src/providers/errors.js';
import { ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { compileAndGate } from '../src/shooter/compile-job.js';
import {
  GATE_SEEDS, MAX_THICKEN_STEPS, MAX_THIN_STEPS, THICKENED_NOTICE, THINNED_NOTICE, UNWINNABLE_MESSAGE, gateLevel,
} from '../src/shooter/gate.js';
import { killTarget } from '../src/shooter/waves.js';

const brief = (patch: Record<string, unknown> = {}): ShooterBrief => ShooterBriefSchema.parse({
  version: 'brief-1', title: 'Gate', theme: 'zombie-city', map: 'open-arena',
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
    const gated = gateLevel(level, brief(), { play });
    expect(gated.report.thinSteps).toBe(2); // 100% -> 80% -> 64%: the bot wins at the third level, after two steps down
    expect(total(gated.level)).toBeLessThanOrEqual(start * 0.7);
    expect(total(gated.level)).toBeGreaterThanOrEqual(start * 0.3);
    expect(gated.notices).toEqual([THINNED_NOTICE]);
    expect(seen).toHaveLength(GATE_SEEDS * 3);
    expect(ShooterLevelSchema.safeParse(gated.level).success).toBe(true);
    expect(gated.report.wins).toBe(GATE_SEEDS);
  });

  it('never goes below 30% of the original density: 4 steps at most, then unwinnable_level', () => {
    const level = compileShooter(brief(), 5).level;
    let calls = 0;
    const play = (lvl: ShooterLevel) => { calls += 1; return result(lvl, false); };
    let thrown: unknown;
    try { gateLevel(level, brief(), { play }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AIError);
    expect(thrown).toMatchObject({ code: 'unwinnable_level', status: 422, issues: ['goal'], message: UNWINNABLE_MESSAGE });
    expect((thrown as AIError).message).toBe('Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.');
    expect(calls).toBe(GATE_SEEDS * (1 + MAX_THIN_STEPS));
    expect(0.8 ** MAX_THIN_STEPS).toBeGreaterThanOrEqual(0.3);
  });

  it('thinning really removes enemies even when every wave holds only one or two', () => {
    const level = compileShooter(brief({ enemies: [{ type: 'brute', share: 5 }], intensity: 3 }), 8).level;
    expect(level.waves.every((wave) => wave.count <= 2)).toBe(true);
    const sizes: number[] = [];
    gateLevel(level, brief({ enemies: [{ type: 'brute', share: 5 }], intensity: 3 }), { play: (lvl) => { sizes.push(total(lvl)); return result(lvl, total(lvl) < total(level) * 0.7); } });
    expect(Math.min(...sizes)).toBeLessThan(total(level) * 0.7);
  });

  it('a kill level keeps at least 1.3 times the goal and is stretched in time instead', () => {
    const b = brief({ goal: { type: 'kill', count: 40 } });
    const level = compileShooter(b, 6).level;
    const lastAt = Math.max(...level.waves.map((wave) => wave.atMs));
    let attempts = 0;
    const gated = gateLevel(level, b, { play: (lvl) => { attempts += 1; return result(lvl, attempts > GATE_SEEDS * 2); } });
    expect(gated.report.thinSteps).toBe(2);
    expect(total(gated.level)).toBeGreaterThanOrEqual(killTarget(40));
    expect(gated.level.win).toEqual({ type: 'kill', count: 40 });
    expect(Math.max(...gated.level.waves.map((wave) => wave.atMs))).toBeGreaterThan(lastAt);
    expect(ShooterLevelSchema.safeParse(gated.level).success).toBe(true);
  });
});

describe('thickening a level that is too easy', () => {
  const easy = (level: ShooterLevel) => result(level, true, 1);

  it('x1.2 up to twice for intensity 3+, with one notice', () => {
    const b = brief({ intensity: 4 });
    const level = compileShooter(b, 5).level;
    const gated = gateLevel(level, b, { play: easy });
    expect(gated.report.thickenSteps).toBe(MAX_THICKEN_STEPS);
    expect(total(gated.level)).toBeGreaterThan(total(level) * 1.3);
    expect(total(gated.level)).toBeLessThanOrEqual(400);
    expect(gated.level.waves.every((wave) => wave.count <= 40)).toBe(true);
    expect(gated.notices).toEqual([THICKENED_NOTICE]);
  });

  it('stops as soon as the condition ends', () => {
    const b = brief({ intensity: 5 });
    const level = compileShooter(b, 5).level;
    const gated = gateLevel(level, b, { play: (lvl) => result(lvl, true, total(lvl) > total(level) * 1.1 ? 0.5 : 1) });
    expect(gated.report.thickenSteps).toBe(1);
  });

  it('does not thicken a level the bot barely wins, nor one that had to be thinned first', () => {
    const b = brief({ intensity: 5 });
    const level = compileShooter(b, 5).level;
    expect(gateLevel(level, b, { play: (lvl) => result(lvl, true, 0.89) }).report.thickenSteps).toBe(0);
    const thinned = gateLevel(level, b, { play: (lvl) => result(lvl, total(lvl) < total(level)) }); // loses at 100%, wins thinned, hp full
    expect(thinned.report.thinSteps).toBeGreaterThan(0);
    expect(thinned.report.thickenSteps).toBe(0);
  });

  it('only for intensity 3 or more', () => {
    for (const intensity of [1, 2]) {
      const b = brief({ intensity });
      const gated = gateLevel(compileShooter(b, 5).level, b, { play: easy });
      expect(gated.report.thickenSteps).toBe(0);
      expect(gated.notices).toEqual([]);
    }
  });

  it('stops where a thicker level is a loss: it keeps the last level the bot could win', () => {
    const b = brief({ intensity: 4 });
    const level = compileShooter(b, 5).level;
    const gated = gateLevel(level, b, { play: (lvl) => result(lvl, total(lvl) <= total(level) * 1.25) });
    expect(gated.report.thickenSteps).toBe(1);
    expect(total(gated.level)).toBeLessThanOrEqual(total(level) * 1.25);
  });

  it('respects the caps of 400 enemies and 40 per wave', () => {
    const b = brief({ intensity: 5 });
    const level = ShooterLevelSchema.parse({ ...compileShooter(b, 5).level, waves: Array.from({ length: 10 }, (_, i) => ({ atMs: 2000 + i * 5000, type: 'swarmer', count: 39 })) });
    expect(total(level)).toBe(390);
    const gated = gateLevel(level, b, { play: easy });
    expect(total(gated.level)).toBeLessThanOrEqual(400);
    expect(gated.level.waves.every((wave) => wave.count <= 40)).toBe(true);
  });

  it('a kill level gets the same enemies sooner', () => {
    const b = brief({ intensity: 4, goal: { type: 'kill', count: 60 } });
    const level = compileShooter(b, 5).level;
    const gated = gateLevel(level, b, { play: easy });
    expect(total(gated.level)).toBe(total(level));
    expect(Math.max(...gated.level.waves.map((wave) => wave.atMs))).toBeLessThan(Math.max(...level.waves.map((wave) => wave.atMs)));
  });
});

describe('the gate with the real bot', () => {
  it('a brief that is too hard comes out as a level the bot wins', () => {
    const b = brief({ intensity: 5, playerHealth: 'fragile', enemies: [{ type: 'brute', share: 6 }, { type: 'swarmer', share: 4 }], map: 'rooms' });
    for (const seed of [1, 2, 3]) {
      const out = compileAndGate({ brief: b, seed });
      expect(ShooterLevelSchema.safeParse(out.level).success).toBe(true);
      const wins = [1, 2, 3].filter((i) => playLevel({ ...out.level, seed: out.level.seed + i }, botInput).status === 'won').length;
      expect(wins, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(out.report.wins).toBeGreaterThanOrEqual(1);
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
});
