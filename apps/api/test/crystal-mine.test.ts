import { describe, expect, it } from 'vitest';
import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import { buildNavigation, buildPhysicalGraph, collectibleCost, overlapsRect } from '../src/services/game-geometry.js';
import { analyzeHazards } from '../src/services/enemy-hazard.js';
import { repairGamePlacement } from '../src/services/repair-game-placement.js';
import { parseGameSpec } from '../src/services/game-generation-service.js';
import { GAME_SYSTEM_PROMPT, describeSchema, providerJsonSchema } from '../src/services/system-prompt.js';
import { sampleSpec } from './fixtures.js';
import { fixtureSpec, standardFixture } from './standard-fixtures.js';

// Recorded Groq runs, copied from .local-diagnostics into test/fixtures/standard.
// b769: provider-output.txt; Groq rejected it with json_validate_failed.
const wrappedGeneration = JSON.stringify(standardFixture('b769').spec);
// c36f: Xu 2 is collectibles[1]. 2ef2: earlier Crystal Mine. dca2: platforms
// 0-2 are a reachable zigzag; 3 and 4 fold back above them.
const latestMine = fixtureSpec('c36f');
const earlierMine = fixtureSpec('2ef2');
const foldedMine = fixtureSpec('dca2');

const coinCosts = (game: GameSpec, avoidEnemies: boolean) => {
  const navigation = buildNavigation(game, avoidEnemies);
  return game.collectibles.map((coin) => (navigation ? collectibleCost(game, coin, navigation) : Infinity));
};
const displacement = (before: GameSpec, after: GameSpec) => {
  const sum = (a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>) =>
    a.reduce((total, item, index) => total + Math.hypot(item.x - b[index]!.x, item.y - b[index]!.y), 0);
  return sum(after.platforms, before.platforms) + sum(after.enemies, before.enemies) + sum(after.collectibles, before.collectibles);
};
const withoutPositions = (game: GameSpec) => ({
  ...game,
  platforms: game.platforms.map(({ width, height }) => ({ width, height })),
  enemies: game.enemies.map(({ x: _x, y: _y, ...rest }) => rest),
  collectibles: game.collectibles.map(({ value }) => value),
});

describe('Standard fixtures', () => {
  it('are recorded Groq runs or marked synthetic', () => {
    for (const name of ['c36f', 'dca2', '2ef2', 'eb2a', '8db8', 'b769']) {
      const fixture = standardFixture(name);
      expect(fixture.provenance).toBe('live_groq');
      expect(fixture.runId).toMatch(/^standard-20261119-\d{6}-[0-9a-f]{4}$/);
    }
    // Groq returned json_validate_failed for b769, so its exchange has no usage.
    expect(standardFixture('b769').provenanceNote).toMatch(/no usage/);
    for (const name of ['landing', 'out-of-reach', 'underside', 'drop', '2ef2-ceiling']) {
      expect(standardFixture(name).provenance).toBe('synthetic');
    }
  });
});

describe('Crystal Mine structured output', () => {
  it('rejects the wrapped generation and does not teach the model a root key', () => {
    const wrapped = JSON.parse(wrappedGeneration) as { root?: Record<string, unknown> };
    expect(wrapped).toHaveProperty('root');
    expect(wrapped).not.toHaveProperty('version');
    expect(GameSpecSchema.safeParse(wrapped).success).toBe(false);
    const { root, ...siblings } = wrapped;
    const flat = GameSpecSchema.safeParse({ ...root, ...siblings });
    expect(flat.success).toBe(false);
    if (!flat.success) expect(flat.error.issues.map((issue) => issue.path.join('.'))).toEqual(['collectibles.4']);
    const provider = providerJsonSchema() as { additionalProperties?: boolean; required?: string[] };
    expect(provider.additionalProperties).toBe(false);
    expect(provider.required).toContain('version');
    expect(describeSchema()[0]).toMatch(/^version=/);
    expect(GAME_SYSTEM_PROMPT).not.toMatch(/^root:/m);
    expect(GAME_SYSTEM_PROMPT).toContain('Never wrap fields in root');
  });
});

describe('Crystal Mine placement', () => {
  it('c36f: repairs Xu 2 without moving a platform, with less displacement than before', () => {
    const before = structuredClone(latestMine);
    const repaired = repairGamePlacement(structuredClone(latestMine));
    expect(latestMine).toEqual(before);
    expect(withoutPositions(repaired)).toEqual(withoutPositions(before));
    // The underside of a step is a ceiling the jump bumps (Phaser), so the
    // original stair is physically complete. Only enemy 0 leaves the spawn
    // area and coin 4 sits on platform 4 instead of past its edge.
    expect(repaired.platforms).toEqual(before.platforms);
    // At accd838 the same repair moved 926px in total (+24..+104px per platform).
    // 1A: 104px. 1B: 107px, enemy 0 keeps 3px more from spawn because its
    // patrol really reaches two steps past its range (enemyEnvelope).
    expect(displacement(before, repaired)).toBeLessThanOrEqual(926);
    expect(Math.round(displacement(before, repaired))).toBe(107);
    expect(coinCosts(repaired, true).every(Number.isFinite)).toBe(true);
    expect(repairGamePlacement(structuredClone(latestMine))).toEqual(repaired);
  }, 20_000);

  it('2ef2: the top step is reachable by bumping the world top (E2E: standard-physics world top)', () => {
    // Behaviour change, proved in Phaser by e2e/standard-physics.spec.ts with the
    // same platforms: the jump from platform 3 is clamped at y=70 (vy=0) and
    // lands on platform 4. The old simulator rejected any flight touching y=70.
    const physical = coinCosts(earlierMine, false);
    expect(Number.isFinite(physical[3]!)).toBe(true);
    expect(Number.isFinite(physical[4]!)).toBe(true);
    const repaired = repairGamePlacement(structuredClone(earlierMine));
    expect(repaired).toEqual(GameSpecSchema.parse(earlierMine)); // nothing had to move
    expect(coinCosts(repaired, true).every(Number.isFinite)).toBe(true);
  }, 20_000);

  it('2ef2: the old Xu 2 failure came from patrols treated as walls, not from physics', () => {
    const graph = buildPhysicalGraph(earlierMine)!;
    expect(Number.isFinite(coinCosts(earlierMine, false)[1]!)).toBe(true);
    const analysis = analyzeHazards(earlierMine, graph);
    expect(analysis.spawnSafe).toBe(true);
    expect(Number.isFinite(coinCosts(earlierMine, true)[1]!)).toBe(true);
  }, 20_000);

  it('dca2: keeps the reachable zigzag and Xu 2, and loses no reachable coin', () => {
    const before = structuredClone(foldedMine);
    const reachableBefore = coinCosts(foldedMine, true).map(Number.isFinite);
    expect(reachableBefore).toEqual([true, true, true, true, false, false]);
    const repaired = repairGamePlacement(structuredClone(foldedMine));
    expect(foldedMine).toEqual(before);
    expect(repaired.platforms.slice(0, 3)).toEqual(before.platforms.slice(0, 3));
    expect(repaired.collectibles[1]).toEqual(before.collectibles[1]);
    expect(withoutPositions(repaired)).toEqual(withoutPositions(before));
    expect(coinCosts(repaired, true).every(Number.isFinite)).toBe(true);
    for (const platform of repaired.platforms) {
      expect(platform.x - platform.width / 2).toBeGreaterThanOrEqual(0);
      expect(platform.x + platform.width / 2).toBeLessThanOrEqual(960);
      expect(platform.y - platform.height / 2).toBeGreaterThanOrEqual(70);
      expect(platform.y + platform.height / 2).toBeLessThanOrEqual(500);
    }
    for (let i = 0; i < repaired.platforms.length; i += 1) {
      for (let j = i + 1; j < repaired.platforms.length; j += 1) {
        expect(overlapsRect(repaired.platforms[i]!, repaired.platforms[j]!)).toBe(false);
      }
    }
    // At accd838 this repair moved 445px in total.
    expect(displacement(before, repaired)).toBeLessThanOrEqual(445);
    expect(repairGamePlacement(structuredClone(foldedMine))).toEqual(repaired);
  }, 20_000);

  describe('eb2a: platform 4 at x=950 (right edge 1010) and coin 4 at x=950', () => {
    const mine = fixtureSpec('eb2a');

    it('(a) physical, no enemies: every coin is reachable', () => {
      expect(coinCosts({ ...mine, enemies: [] } as unknown as GameSpec, false).every(Number.isFinite)).toBe(true);
      expect(coinCosts(mine, false).every(Number.isFinite)).toBe(true);
    });

    it('(b) hazard: floor coins 0 and 5 inside the patrols are taken by timing, without damage', () => {
      const analysis = analyzeHazards(mine, buildPhysicalGraph(mine)!);
      expect(analysis.spawnSafe).toBe(true);
      expect(analysis.edges.some((edge) => edge.timed && edge.coins.includes(0))).toBe(true);
      expect(analysis.edges.some((edge) => edge.timed && edge.coins.includes(5))).toBe(true);
      expect(coinCosts(mine, true).every(Number.isFinite)).toBe(true);
    }, 20_000);

    it('(c) repair: only platform 4 is clamped inside the screen and coin 4 rides along', () => {
      const before = structuredClone(mine);
      // The only real problems: platform 4 sticks out of the screen and coin 4 is past x=944.
      expect(GameSpecSchema.safeParse(mine).error?.issues.map((issue) => issue.path.join('.'))).toEqual(['collectibles.4.x', 'platforms.4']);
      const repaired = repairGamePlacement(mine);
      expect(mine).toEqual(before);
      expect(repaired.platforms[4]).toEqual({ ...before.platforms[4], x: 900 });
      expect(repaired.platforms.slice(0, 4)).toEqual(before.platforms.slice(0, 4));
      expect(repaired.collectibles[4]).toEqual({ ...before.collectibles[4], x: 900 });
      expect(repaired.collectibles.filter((_, index) => index !== 4)).toEqual(before.collectibles.filter((_, index) => index !== 4));
      expect(repaired.enemies).toEqual(before.enemies);
      expect(withoutPositions(repaired)).toEqual(withoutPositions(before));
      expect(repaired.win).toEqual(before.win);
      expect(repairGamePlacement(structuredClone(before))).toEqual(repaired);
    }, 20_000);
  });

  it('8db8: top-down output is unchanged', () => {
    const game = fixtureSpec('8db8');
    // At accd838 repair returned this spec unchanged.
    expect(parseGameSpec(JSON.stringify(game))).toEqual(GameSpecSchema.parse(game));
  });

  it('every fixture repairs well inside the time budget', () => {
    for (const name of ['c36f', 'dca2', '2ef2', 'eb2a', '8db8']) {
      const started = performance.now();
      repairGamePlacement(fixtureSpec(name));
      expect(performance.now() - started).toBeLessThan(5_000);
    }
  }, 60_000);

  it('rolls back a folded step that cannot be seated and names that coin', () => {
    const game = sampleSpec();
    game.lose.timeLimitSeconds = 0;
    game.obstacles = [];
    game.player = { x: 80, y: 460, size: 28, speed: 260, jumpSpeed: 560, health: 3 };
    game.difficulty = { gravity: 1200, invulnerabilityMs: 500, enemySpeedMultiplier: 1 };
    game.platforms = [
      { x: 200, y: 420, width: 160, height: 20 },
      { x: 480, y: 140, width: 700, height: 20 },
    ];
    game.collectibles = [
      { x: 200, y: 385, value: 1 },
      { x: 480, y: 105, value: 1 },
    ];
    game.enemies = [{ x: 860, y: 484, size: 28, speed: 40, axis: 'horizontal', range: 40, damage: 1 }];
    game.win = { type: 'collect_all', scoreTarget: 2, surviveSeconds: 30 };
    const before = structuredClone(game);
    const navigation = buildNavigation(game, false);
    expect(Number.isFinite(collectibleCost(game, game.collectibles[0]!, navigation!))).toBe(true);
    expect(collectibleCost(game, game.collectibles[1]!, navigation!)).toBe(Infinity);
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining({
      code: 'invalid_game_spec',
      issues: ['collectibles.1'],
    }));
    expect(game).toEqual(before);
  });

  it('still rejects a platform the jump cannot reach', () => {
    const game = sampleSpec();
    game.lose.timeLimitSeconds = 0;
    game.platforms = [{ x: 480, y: 120, width: 160, height: 20 }];
    game.collectibles = [{ x: 480, y: 85, value: 10 }];
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining({
      code: 'invalid_game_spec',
      issues: ['collectibles.0'],
    }));
    expect(game.collectibles).toHaveLength(1);
  });
});
