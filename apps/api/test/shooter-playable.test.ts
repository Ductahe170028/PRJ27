import { describe, expect, it } from 'vitest';
import { IDLE, SHOOTER_LEVELS, botInput, playLevel as play, type ShooterLevel } from '@game-creator/contracts';

// The levels are numbers, and numbers can be too easy or impossible. A plain
// bot (aims at the nearest enemy, keeps firing, steps away from enemies and
// walls) must be able to win the real levels, and standing still must lose the
// ones that are meant to be a fight. If a level stops being winnable, change
// the level's numbers, not these expectations.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const withSeed = (level: ShooterLevel, seed: number): ShooterLevel => ({ ...level, seed });

describe('hand-made levels are playable', () => {
  it.each(['arena', 'pillars', 'wall'] as const)('the bot wins %s with every seed', (name) => {
    const results = SEEDS.map((seed) => {
      const result = play(withSeed(SHOOTER_LEVELS[name], seed), botInput);
      return { seed, status: result.status, seconds: Math.round(result.seconds), kills: result.kills, hp: result.hp };
    });
    console.info(`[shooter] bot on ${name}: ${results.map((r) => `${r.seed}:${r.status[0]}${r.seconds}s hp${r.hp}`).join(' ')}`);
    expect(results.filter((r) => r.status !== 'won')).toEqual([]);
  });

  it.each(['arena', 'pillars'] as const)('standing still without firing loses %s with every seed', (name) => {
    const results = SEEDS.map((seed) => play(withSeed(SHOOTER_LEVELS[name], seed), () => IDLE));
    expect(results.map((r) => r.status)).toEqual(SEEDS.map(() => 'lost'));
    for (const result of results) expect(result.seconds).toBeLessThan(30);
  });

  it('the survival level needs the whole minute, the kill levels need their count', () => {
    const arena = play(SHOOTER_LEVELS.arena, botInput);
    expect(arena.seconds).toBe(60);
    const pillars = play(SHOOTER_LEVELS.pillars, botInput);
    expect(pillars.kills).toBe(50);
    expect(pillars.seconds).toBeLessThan(60);
  });

  it('smoke-win is won with no input', () => {
    const result = play(SHOOTER_LEVELS['smoke-win'], () => IDLE);
    expect(result.status).toBe('won');
    expect(result.seconds).toBe(10);
    expect(result.hp).toBeGreaterThan(0);
  });

  it('smoke-lose is lost within a few seconds, with no input', () => {
    const result = play(SHOOTER_LEVELS['smoke-lose'], () => IDLE);
    expect(result.status).toBe('lost');
    expect(result.seconds).toBeLessThan(5);
  });

  it('a bot that only shoots (never moves) can hold smoke-lose: the level is not unwinnable', () => {
    const shooter = play(SHOOTER_LEVELS['smoke-lose'], (state) => ({ ...botInput(state), moveX: 0, moveY: 0 }));
    expect(shooter.status).toBe('won');
  });
});

// Stage 4B: the three hand-made levels for the new mechanics can be won by the expert bot, and not by standing still.
describe('the Stage 4B hand-made levels are playable', () => {
  it.each(['shotgun-pit', 'spitters', 'medic'] as const)('the bot wins %s with at least 7 of 8 seeds', (name) => {
    const results = SEEDS.map((seed) => play(withSeed(SHOOTER_LEVELS[name], seed), botInput));
    console.info(`[shooter] bot on ${name}: ${results.map((r) => `${r.status[0]}${r.hp}`).join(' ')}`);
    expect(results.filter((r) => r.status === 'won').length).toBeGreaterThanOrEqual(7);
  });
  it.each(['shotgun-pit', 'spitters', 'medic'] as const)('standing still loses %s every time', (name) => {
    expect(SEEDS.map((seed) => play(withSeed(SHOOTER_LEVELS[name], seed), () => IDLE).status)).toEqual(SEEDS.map(() => 'lost'));
  });
});

// Stage 4C: the two hand-made boss levels can be won by the expert bot (by defeating the boss), and not by standing still.
describe('the Stage 4C hand-made boss levels are playable', () => {
  it.each(['boss-crusher', 'boss-gunner'] as const)('the bot defeats the boss of %s with at least 7 of 8 seeds', (name) => {
    const results = SEEDS.map((seed) => play(withSeed(SHOOTER_LEVELS[name], seed), botInput));
    console.info(`[shooter] bot on ${name}: ${results.map((r) => `${r.status[0]}${r.hp}@${Math.round(r.seconds)}s`).join(' ')}`);
    expect(results.filter((r) => r.status === 'won').length).toBeGreaterThanOrEqual(7);
    for (const r of results.filter((x) => x.status === 'won')) expect(r.state.bossDown).toBe(true);
  });
  it.each(['boss-crusher', 'boss-gunner'] as const)('standing still loses %s every time', (name) => {
    expect(SEEDS.map((seed) => play(withSeed(SHOOTER_LEVELS[name], seed), () => IDLE).status)).toEqual(SEEDS.map(() => 'lost'));
  });
});
