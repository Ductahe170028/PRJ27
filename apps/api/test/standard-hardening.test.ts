import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import {
  JUMP_START_TOLERANCE_PX, buildNavigation, buildPhysicalGraph, collectibleCost, createAnalysisCache, overlapsRect, patrolRect,
  physicalNavigation,
} from '../src/services/game-geometry.js';
import {
  HAZARD_HORIZON, HAZARD_MIN_WINDOW_TICKS, analyzeHazards, enemyEnvelope, enemyTracks, windowedOrigins, zeroDamageNavigation,
} from '../src/services/enemy-hazard.js';
import { parseGameSpec } from '../src/services/game-generation-service.js';
import { repairGamePlacement } from '../src/services/repair-game-placement.js';
import { sampleSpec } from './fixtures.js';
import { fixtureSpec, standardFixture } from './standard-fixtures.js';
import { platformer } from './standard-scenarios.js';

// These tests build the physical graph and hazard analysis of recorded games: ~4 s of CPU
// alone, several times that when the whole suite runs in parallel. Vitest's default 5 s
// timeout made one of them fail intermittently, so the limit is explicit here.
vi.setConfig({ testTimeout: 30_000 });

const goldenDir = fileURLToPath(new URL('./fixtures/standard/golden/', import.meta.url));
interface Golden { runId: string; outcome: 'ok' | 'fail'; output?: GameSpec; error?: { code: string; status: number; message: string; issues: string[] | null } }
const golden = (name: string): Golden => {
  const file = readdirSync(goldenDir).find((entry) => entry.endsWith(`-${name}.json`))!;
  return JSON.parse(readFileSync(join(goldenDir, file), 'utf8')) as Golden;
};
/** CPU time of this process. A guard only: under the parallel suite the same
 * repair costs ~3x more CPU than alone. The <= 2s budget is checked by the
 * median benchmark; these tests check the work done (hazard analyses). */
const GUARD_MS = 5_000; // the worker timeout
const cpuMs = (task: () => void) => {
  const start = process.cpuUsage();
  task();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
};
const displacement = (before: GameSpec, after: GameSpec) => {
  const sum = (a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>) =>
    a.reduce((total, item, index) => total + Math.hypot(item.x - b[index]!.x, item.y - b[index]!.y), 0);
  return sum(after.platforms, before.platforms) + sum(after.enemies, before.enemies) + sum(after.collectibles, before.collectibles);
};
const coinReach = (game: GameSpec, avoidEnemies: boolean) => {
  const navigation = buildNavigation(game, avoidEnemies);
  return game.collectibles.map((coin) => (navigation ? Number.isFinite(collectibleCost(game, coin, navigation)) : false));
};
const eb2a = (patch: (game: GameSpec) => void) => { const game = fixtureSpec('eb2a'); patch(game); return game; };
const slowEnemies = (timeLimitSeconds: number) => eb2a((game) => {
  game.enemies.forEach((enemy) => { enemy.speed = 20; });
  game.difficulty.enemySpeedMultiplier = 0.5;
  game.lose.timeLimitSeconds = timeLimitSeconds;
});

describe('V1: hazard wait bound covers the whole enemy period', () => {
  it('a slow enemy (period > 600) waits up to its period, not up to the horizon', () => {
    const game = GameSpecSchema.parse(golden('eb2a').output);
    game.enemies.forEach((enemy) => { enemy.speed = 20; });
    game.difficulty.enemySpeedMultiplier = 0.5;
    const analysis = analyzeHazards(game, buildPhysicalGraph(game)!);
    expect(analysis.tracks.every((track) => track.period > HAZARD_HORIZON)).toBe(true);
    const timed = analysis.edges.filter((edge) => edge.timed);
    expect(timed.length).toBeGreaterThan(0);
    // Phases past the horizon were never tried, so they are unusable: every
    // timed edge waits at least period - horizon.
    const period = Math.min(...analysis.tracks.map((track) => track.period));
    expect(timed.every((edge) => edge.ticks >= period - HAZARD_HORIZON)).toBe(true);
  }, 20_000);

  it('rejects a deadline the old horizon-based bound accepted, and accepts a long one', () => {
    // Route upper bound: 15.9s with the 1A formula, 89.4s now.
    expect(() => repairGamePlacement(slowEnemies(40))).toThrow(expect.objectContaining({ code: 'invalid_game_spec', issues: ['lose.timeLimitSeconds'] }));
    expect(repairGamePlacement(slowEnemies(120)).lose.timeLimitSeconds).toBe(120);
  }, 30_000);
});

describe('V2: a failing repair stops early', () => {
  it('eb2a with a 5s limit fails on the deadline without sliding enemies', () => {
    const cache = createAnalysisCache();
    const game = eb2a((spec) => { spec.lose.timeLimitSeconds = 5; });
    let error: unknown;
    const used = cpuMs(() => { try { repairGamePlacement(game, cache); } catch (caught) { error = caught; } });
    expect(error).toMatchObject({ code: 'invalid_game_spec', issues: ['lose.timeLimitSeconds'] });
    // Before: 16 slide candidates, each a full hazard analysis (about 5s).
    expect(cache.counts.hazardRuns).toBe(1);
    expect(cache.counts.graphBuilds).toBe(2); // before and after the clamp
    expect(used).toBeLessThan(GUARD_MS);
  }, 20_000);

  it('a route that exists but misses the deadline is not "blocked": no slides', () => {
    const cache = createAnalysisCache();
    expect(() => repairGamePlacement(slowEnemies(40), cache)).toThrow(expect.objectContaining({ issues: ['lose.timeLimitSeconds'] }));
    expect(cache.counts.hazardRuns).toBe(1);
  }, 20_000);
});

describe('V3: human tolerance', () => {
  it(`keeps a jump only if ${JUMP_START_TOLERANCE_PX}px of starts work`, () => {
    // Platforms 3 and 4 of 2ef2 only, spawn on platform 3 (as the E2E
    // standard-physics "world top"): the jump bumps y=70 and its start window
    // is 12-15px. Kept at 12px, dropped at 16px (2 jumps), within budget.
    const ceiling = platformer({
      player: { x: 757, y: 166, size: 28, speed: 260, jumpSpeed: 560, health: 3 },
      platforms: [{ x: 750, y: 190, width: 140, height: 20 }, { x: 880, y: 120, width: 120, height: 20 }],
      collectibles: [{ x: 890, y: 95, value: 10 }],
    });
    const at = (jumpTolerancePx: number) => {
      const graph = buildPhysicalGraph(ceiling, undefined, { jumpTolerancePx })!;
      expect(graph.stats.toleranceBudgetExceeded).toBe(false);
      return { graph, reach: Number.isFinite(collectibleCost(ceiling, ceiling.collectibles[0]!, physicalNavigation(graph))) };
    };
    expect(at(0).reach).toBe(true);
    expect(at(JUMP_START_TOLERANCE_PX).reach).toBe(true);
    const strict = at(16);
    expect(strict.reach).toBe(false);
    expect(strict.graph.stats.jumpsBelowTolerance).toBe(2);
    // A wide jump survives a stricter tolerance.
    const landing = standardFixture('landing').spec as GameSpec;
    const graph = buildPhysicalGraph(landing, undefined, { jumpTolerancePx: 16 })!;
    expect(Number.isFinite(collectibleCost(landing, landing.collectibles[0]!, physicalNavigation(graph)))).toBe(true);
  }, 30_000);

  it('counts a start overhanging the edge as standable, as Phaser does', () => {
    // dca2 (played) climbs to platform 3 only from the left end of platform 2,
    // where the body may hang past the edge. Full-support starts alone give a
    // 0px window; Phaser-standable starts give 27px.
    const played = GameSpecSchema.parse(golden('dca2').output);
    expect(coinReach(played, false)).toEqual([true, true, true, true, true, true]);
  }, 20_000);

  it(`keeps a timed move only with a start window of ${HAZARD_MIN_WINDOW_TICKS} ticks`, () => {
    expect(windowedOrigins([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 600, 2000, 12)).toEqual([]);
    expect(windowedOrigins([3, ...Array.from({ length: 12 }, (_, k) => 20 + k)], 600, 2000, 12)).toEqual(Array.from({ length: 12 }, (_, k) => 20 + k));
    // Wraps around the cycle only when every phase of it was tried.
    const wrap = [0, 1, 2, 3, 4, 5, 94, 95, 96, 97, 98, 99];
    expect(windowedOrigins(wrap, 100, 100, 12)).toHaveLength(12);
    expect(windowedOrigins(wrap, 100, 2000, 12)).toEqual([]);
    // eb2a (played) with both enemies at 180 x2: coin 5 has a 5-tick window,
    // rejected; at 150 x2 its window is 18 ticks, kept.
    const fast = (speed: number) => {
      const game = GameSpecSchema.parse(golden('eb2a').output);
      game.enemies.forEach((enemy) => { enemy.speed = speed; });
      game.difficulty.enemySpeedMultiplier = 2;
      const graph = buildPhysicalGraph(game)!;
      return (minWindowTicks: number) => {
        const navigation = zeroDamageNavigation(graph, analyzeHazards(game, graph, { minWindowTicks }));
        return !!navigation && Number.isFinite(collectibleCost(game, game.collectibles[5]!, navigation));
      };
    };
    const narrow = fast(180);
    expect(narrow(5)).toBe(true);
    expect(narrow(HAZARD_MIN_WINDOW_TICKS)).toBe(false);
    const wide = fast(150);
    expect(wide(HAZARD_MIN_WINDOW_TICKS)).toBe(true);
    expect(wide(19)).toBe(false);
  }, 60_000);
});

describe('V4: platformer enemy placement uses the hazard envelope', () => {
  // speed 180 x2 = 6px per step: turns overshoot by up to two steps (+ turn
  // uncertainty), far beyond patrolRect's one step + 1px.
  const near = () => platformer({
    obstacles: [{ x: 480 + 120 + 30 + 20, y: 485, width: 40, height: 30 }],
    enemies: [{ x: 480, y: 484, size: 28, speed: 180, axis: 'horizontal', range: 120, damage: 1 }],
    collectibles: [{ x: 300, y: 475, value: 10 }],
    difficulty: { gravity: 1200, invulnerabilityMs: 1000, enemySpeedMultiplier: 2 },
  });

  it('moves an enemy whose real overshoot touches a block that patrolRect misses', () => {
    const game = near();
    const block = game.obstacles[0]!;
    expect(overlapsRect(patrolRect(game.enemies[0]!, 2), block)).toBe(false);
    expect(overlapsRect(enemyEnvelope(game, game.enemies[0]!), block)).toBe(true);
    const repaired = repairGamePlacement(game);
    expect(repaired.enemies[0]!.x).not.toBe(game.enemies[0]!.x);
    expect(repaired.enemies[0]!.y).toBe(484);
    expect(overlapsRect({ ...enemyEnvelope(repaired, repaired.enemies[0]!), height: 28 }, block)).toBe(false);
    // The analysis agrees: the moved enemy never touches a block.
    expect(enemyTracks(repaired)[0]!.predictable).toBe(true);
  }, 20_000);

  it('keeps patrolRect for top-down', () => {
    const game = sampleSpec('top-down');
    game.enemies = [{ ...game.enemies[0]!, x: 780, y: 300, speed: 180, range: 40 }];
    game.difficulty.enemySpeedMultiplier = 2;
    // Same as before: still valid under patrolRect, so it is not moved.
    expect(repairGamePlacement(game).enemies[0]).toEqual(game.enemies[0]);
  });
});

describe('golden outputs (played fixtures)', () => {
  it.each(['dca2', '2ef2', 'eb2a', '8db8'])('%s: unchanged', (name) => {
    expect(parseGameSpec(JSON.stringify(fixtureSpec(name)))).toEqual(golden(name).output);
  }, 20_000);

  it('c36f: only enemy 0 moves 3px further from spawn (V4 envelope)', () => {
    const before = fixtureSpec('c36f');
    const repaired = parseGameSpec(JSON.stringify(before));
    const expected = structuredClone(golden('c36f').output!);
    expected.enemies[0]!.x = 259; // was 256: the patrol reaches 2 steps past range
    expect(repaired).toEqual(expected);
    expect(Math.round(displacement(before, repaired))).toBe(107); // golden 104
  }, 20_000);

  it('b769: same provider-shape error', () => {
    const expected = golden('b769').error!;
    expect(() => parseGameSpec(JSON.stringify(standardFixture('b769').spec))).toThrow(expect.objectContaining({
      code: expected.code, status: expected.status, issues: expected.issues,
    }));
  });
});

describe('eb2a mutations (regression)', () => {
  const cases: Array<[string, (game: GameSpec) => void, string | undefined]> = [
    ['enemy 0 standing on coin 0', (game) => { game.enemies[0] = { ...game.enemies[0]!, x: 220, range: 0 }; }, undefined],
    ['enemy 1 speed 180, x2', (game) => { game.enemies[1]!.speed = 180; game.difficulty.enemySpeedMultiplier = 2; }, undefined],
    ['enemy 0 range 160 speed 180, x2', (game) => { game.enemies[0]!.range = 160; game.enemies[0]!.speed = 180; game.difficulty.enemySpeedMultiplier = 2; }, undefined],
    ['time limit 5s', (game) => { game.lose.timeLimitSeconds = 5; }, 'lose.timeLimitSeconds'],
    ['time limit 60s', (game) => { game.lose.timeLimitSeconds = 60; }, undefined],
    ['slow enemies x0.5, time limit 40s', (game) => { game.enemies.forEach((enemy) => { enemy.speed = 20; }); game.difficulty.enemySpeedMultiplier = 0.5; game.lose.timeLimitSeconds = 40; }, 'lose.timeLimitSeconds'],
  ];
  it.each(cases)('%s', (_name, patch, failure) => {
    const game = eb2a(patch);
    let result: GameSpec | undefined;
    let error: unknown;
    const cache = createAnalysisCache();
    const used = cpuMs(() => { try { result = repairGamePlacement(game, cache); } catch (caught) { error = caught; } });
    // No slide candidates on any of these: one analysis for the final route,
    // one more only when the route had to be checked without its deadline.
    expect(cache.counts.hazardRuns).toBeLessThanOrEqual(2);
    if (failure) expect(error).toMatchObject({ code: 'invalid_game_spec', issues: [failure] });
    else {
      expect(error).toBeUndefined();
      expect(result!.collectibles.map((coin) => coin.value)).toEqual(game.collectibles.map((coin) => coin.value));
      expect(coinReach(result!, true).every(Boolean)).toBe(true);
    }
    expect(used).toBeLessThan(GUARD_MS);
  }, 20_000);
});
