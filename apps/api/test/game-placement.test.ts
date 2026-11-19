import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import { parseGameSpec, GameGenerationService } from '../src/services/game-generation-service.js';
import { repairGamePlacement } from '../src/services/repair-game-placement.js';
import { buildNavigation, collectibleCost } from '../src/services/game-geometry.js';
import { createApp } from '../src/app.js';
import { mockProvider, mockRegistry, sampleSpec } from './fixtures.js';

const parse = (game: GameSpec) => parseGameSpec(JSON.stringify(game));
const invalid = { code: 'invalid_game_spec', status: 422 };
function preserved(before: GameSpec, after: GameSpec) {
  // Compare every field except centers: includes counts, order, coin values,
  // enemy properties, physics, win goals, deadline and all static geometry.
  const withoutPositions = (game: GameSpec) => ({ ...game,
    collectibles: game.collectibles.map(({ x: _x, y: _y, ...rest }) => rest),
    enemies: game.enemies.map(({ x: _x, y: _y, ...rest }) => rest),
  });
  expect(withoutPositions(after)).toEqual(withoutPositions(before));
  expect(GameSpecSchema.safeParse(after).success).toBe(true);
}

describe('count-preserving geometric repair', () => {
  it.each(['top-down', 'platformer'] as const)('leaves valid %s games unchanged', (genre) => {
    const game = sampleSpec(genre);
    expect(parse(game)).toEqual(game);
  });

  it.each(['collect_all', 'reach_score', 'survive'] as const)('preserves all 8 coins, 2 enemies and the %s goal', (type) => {
    const game = sampleSpec('top-down');
    game.collectibles = Array.from({ length: 8 }, (_, i) => ({ x: 500, y: 300, value: i + 1 }));
    game.enemies.push({ ...game.enemies[0]!, x: 110, y: 300, range: 0 });
    game.win = { type, scoreTarget: 36, surviveSeconds: 45 };
    game.lose.timeLimitSeconds = 180;
    const before = structuredClone(game);
    const repaired = repairGamePlacement(game);
    preserved(before, repaired);
    expect(game).toEqual(before);
    expect(new Set(repaired.collectibles.map((coin) => `${coin.x},${coin.y}`)).size).toBe(8);
    for (const coin of repaired.collectibles) {
      expect(Math.hypot(coin.x - 500, coin.y - 300)).toBeLessThanOrEqual(160);
      expect(Math.abs(coin.x - 500) >= 40 || Math.abs(coin.y - 300) >= 40).toBe(true);
    }
    expect(repairGamePlacement(game)).toEqual(repaired); // deterministic
    expect(repairGamePlacement(repaired)).toEqual(repaired); // idempotent
  });

  it('uses the actual 20px coin body, including a partial intersection', () => {
    const game = sampleSpec('top-down');
    game.collectibles = [{ x: 461, y: 300, value: 10 }]; // 1px inside the wall
    expect(GameSpecSchema.safeParse(game).success).toBe(false);
    const repaired = parse(game);
    expect(repaired.collectibles[0]!.x).toBeLessThanOrEqual(460);
    preserved(game, repaired);
  });

  it('repairs nearby out-of-bounds centers without clipping or removing objects', () => {
    const game = sampleSpec('top-down');
    game.collectibles[0]!.x = -8;
    game.enemies[0]!.x = 970;
    game.enemies[0]!.range = 40;
    const repaired = parse(game);
    preserved(game, repaired);
    expect(repaired.collectibles[0]!.x).toBeGreaterThanOrEqual(16);
    expect(repaired.enemies[0]!.x + 40 + 14).toBeLessThan(960);
  });

  it('moves an enemy whose full patrol crosses a block, keeping its radius and speed', () => {
    const game = sampleSpec('top-down');
    game.enemies[0] = { ...game.enemies[0]!, x: 560, range: 80 };
    const repaired = parse(game);
    preserved(game, repaired);
    const enemy = repaired.enemies[0]!;
    expect(Math.abs(enemy.x - 500) >= 30 + 14 + 80 || Math.abs(enemy.y - 300) >= 30 + 14).toBe(true);
  });

  it('repairs a platformer coin inside a block to a reachable location', () => {
    const game = sampleSpec();
    game.collectibles.push({ x: 500, y: 470, value: 17 });
    const repaired = parse(game);
    preserved(game, repaired);
    expect(repaired.collectibles[0]).toEqual(game.collectibles[0]);
    expect(repaired.collectibles[1]).not.toEqual(game.collectibles[1]);
  });

  it.each(['collectibles', 'enemies'] as const)('rejects a distant unreachable %s item instead of deleting it', (list) => {
    const game = sampleSpec();
    game[list][0]!.x = 900;
    game[list][0]!.y = 100;
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: [`${list}.0`] }));
    expect(() => parse(game)).toThrow(/giữ nguyên số lượng vật thể và mục tiêu/);
  });

  it('does not change a goal, deadline, or coin value to make an impossible score pass', () => {
    const game = sampleSpec('top-down');
    game.win = { type: 'reach_score', scoreTarget: 20, surviveSeconds: 10 };
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: ['win.scoreTarget'] }));
    game.collectibles.push({ x: 500, y: 300, value: 10 });
    const repaired = parse(game);
    preserved(game, repaired);
    expect(repaired.win.scoreTarget).toBe(20);
    expect(repaired.collectibles.reduce((sum, coin) => sum + coin.value, 0)).toBe(20);
  });

  it('rejects an insufficient time limit instead of extending it or dropping coins', () => {
    const game = sampleSpec('top-down');
    game.collectibles = [{ x: 900, y: 100, value: 10 }];
    game.lose.timeLimitSeconds = 1;
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: ['lose.timeLimitSeconds'] }));
    game.lose.timeLimitSeconds = 0;
    preserved(game, parse(game));
  });

  it('keeps rejecting a survival deadline shorter than the requested survival duration', () => {
    const game = sampleSpec('top-down');
    game.win.type = 'survive'; game.win.surviveSeconds = 60; game.lose.timeLimitSeconds = 30;
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: ['lose.timeLimitSeconds'] }));
  });
});

describe('reachability beyond bounds and local overlap', () => {
  function dividingWall(game: GameSpec, opening: number) {
    // Floor-to-ceiling wall with an optional narrow opening around y=300.
    game.obstacles = [
      { x: 480, y: 120, width: 40, height: 100 },
      { x: 480, y: 220, width: 40, height: 100 },
      { x: 480, y: 280 - opening / 4, width: 40, height: 40 - opening / 2 },
      { x: 480, y: 350 + opening / 4, width: 40, height: 100 - opening / 2 },
      { x: 480, y: 450, width: 40, height: 100 },
    ];
    game.collectibles = [{ x: 840, y: 300, value: 10 }];
    game.enemies = [{ ...game.enemies[0]!, x: 250, y: 400, range: 0 }];
  }

  it.each([0, 20])('rejects top-down disconnected space or a corridor narrower than the player (%ipx)', (opening) => {
    const game = sampleSpec('top-down');
    dividingWall(game, opening);
    expect(GameSpecSchema.safeParse(game).success).toBe(true); // old check misses connectivity
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: ['collectibles.0'] }));
  });

  it('accepts the same top-down wall when the passage fits the player', () => {
    const game = sampleSpec('top-down');
    dividingWall(game, 48);
    preserved(game, parse(game));
  });

  it('rejects a platformer floor coin across a full-height wall, despite a shared floor', () => {
    const game = sampleSpec();
    dividingWall(game, 0);
    game.platforms = [];
    game.collectibles[0]!.y = 484;
    game.enemies[0]!.y = 484;
    expect(GameSpecSchema.safeParse(game).success).toBe(true);
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: ['collectibles.0'] }));
  });

  it('rejects coins above a solid low ceiling even if theoretical jump height is enough', () => {
    const game = sampleSpec();
    game.platforms = [{ x: 480, y: 405, width: 920, height: 20 }];
    game.obstacles = [];
    game.collectibles = [{ x: 500, y: 370, value: 10 }];
    game.player.size = 40; // 20px edge gaps cannot fit the player
    // No safe local repair within 160px: position farther above the ceiling.
    game.collectibles[0]!.y = 220;
    expect(() => parse(game)).toThrow(expect.objectContaining(invalid));
  });

  it('refuses to delete an enemy when the only accessible space is too close to spawn', () => {
    const game = sampleSpec('top-down');
    game.obstacles = [
      { x: 50, y: 300, width: 20, height: 100 }, { x: 150, y: 300, width: 20, height: 100 },
      { x: 100, y: 250, width: 100, height: 20 }, { x: 100, y: 350, width: 100, height: 20 },
    ];
    game.enemies = [{ ...game.enemies[0]!, x: 100, y: 300, range: 0 }];
    expect(() => parse(game)).toThrow(expect.objectContaining({ ...invalid, issues: ['enemies.0'] }));
  });

  it('fails atomically without mutating input after a later item cannot be repaired', () => {
    const game = sampleSpec();
    game.collectibles = [{ x: 500, y: 470, value: 10 }, { x: 900, y: 100, value: 50 }];
    const before = structuredClone(game);
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining(invalid));
    expect(game).toEqual(before);
  });
});

describe('stacked platform columns', () => {
  const jumpHeight = 560 ** 2 / (2 * 1200);
  function columnGame(overrides?: {
    xs?: number[];
    ys?: number[];
    width?: number;
    enemyX?: number;
  }): GameSpec {
    const game = sampleSpec();
    const ys = overrides?.ys ?? [380, 310, 240];
    const width = overrides?.width ?? 200;
    const xs = overrides?.xs ?? ys.map(() => 480);
    game.player = { x: 80, y: 460, size: 28, speed: 260, jumpSpeed: 560, health: 3 };
    game.difficulty = { gravity: 1200, invulnerabilityMs: 500, enemySpeedMultiplier: 1 };
    game.obstacles = [];
    game.platforms = ys.map((y, index) => ({ x: xs[index] ?? 480, y, width, height: 20 }));
    game.collectibles = game.platforms.map((platform) => ({
      x: platform.x, y: platform.y - platform.height / 2 - 25, value: 1,
    }));
    game.enemies = [{ x: overrides?.enemyX ?? 860, y: 484, size: 28, speed: 60, axis: 'horizontal', range: 40, damage: 1 }];
    game.win = { type: 'collect_all', scoreTarget: 3, surviveSeconds: 30 };
    game.lose.timeLimitSeconds = 0;
    return game;
  }
  function coinCosts(game: GameSpec): number[] {
    const navigation = buildNavigation(game, true);
    if (!navigation) return game.collectibles.map(() => Infinity);
    return game.collectibles.map((coin) => collectibleCost(game, coin, navigation));
  }

  it('spreads a same-x column into a staircase and keeps every coin on a step', () => {
    const game = columnGame();
    const before = structuredClone(game);
    expect(coinCosts(game).every((cost) => Number.isFinite(cost))).toBe(false);
    const repaired = repairGamePlacement(game);
    expect(game).toEqual(before);
    expect(GameSpecSchema.safeParse(repaired).success).toBe(true);
    expect(repaired.collectibles.map((coin) => coin.value)).toEqual([1, 1, 1]);
    expect(repaired.platforms.map((platform) => platform.height)).toEqual([20, 20, 20]);
    expect(repaired.platforms.map((platform) => platform.width)).toEqual([200, 200, 200]);
    expect(repaired.platforms[0]!.y).toBeGreaterThan(380);
    expect(repaired.platforms[0]!.y).toBeLessThanOrEqual(380 + 16);
    expect(repaired.platforms[1]!.y).toBe(310);
    expect(repaired.platforms[2]!.y).toBe(240);
    const steps = [...repaired.platforms].sort((a, b) => b.y - a.y);
    const reach = game.player.speed * game.player.jumpSpeed / game.difficulty.gravity;
    for (let index = 1; index < steps.length; index += 1) {
      const lower = steps[index - 1]!;
      const upper = steps[index]!;
      const rise = (lower.y - lower.height / 2) - (upper.y - upper.height / 2);
      const gap = Math.abs(upper.x - lower.x) - (upper.width + lower.width) / 2;
      expect(upper.x).not.toBe(lower.x);
      expect(rise).toBeGreaterThan(0);
      expect(rise).toBeLessThanOrEqual(jumpHeight - 12 + 1e-6);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(reach);
      expect(lower.x - lower.width / 2).toBeGreaterThanOrEqual(0);
      expect(upper.x + upper.width / 2).toBeLessThanOrEqual(960);
    }
    for (const [index, coin] of repaired.collectibles.entries()) {
      const platform = repaired.platforms[index]!;
      const top = platform.y - platform.height / 2;
      expect(coin.y).toBeLessThanOrEqual(top);
      expect(top - coin.y).toBeLessThanOrEqual(25);
      expect(Math.abs(coin.x - platform.x)).toBeLessThanOrEqual(platform.width / 2);
      expect(coin.y).not.toBe(475);
    }
    expect(coinCosts(repaired).every((cost) => Number.isFinite(cost))).toBe(true);
    expect(repairGamePlacement(repaired)).toEqual(repaired);
    expect(repairGamePlacement(structuredClone(before))).toEqual(repaired);
  }, 20_000);

  it('keeps an already reachable staircase where it is', () => {
    const game = columnGame({ xs: [280, 480, 680], ys: [440, 370, 300] });
    expect(coinCosts(game).every((cost) => Number.isFinite(cost))).toBe(true);
    expect(repairGamePlacement(game)).toEqual(game);
  });

  it('rejects a column taller than the jump instead of inventing a path', () => {
    const game = columnGame({ ys: [300, 220, 140] });
    const before = structuredClone(game);
    expect(coinCosts(game).every((cost) => Number.isFinite(cost))).toBe(false);
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining(invalid));
    expect(() => repairGamePlacement(game)).toThrow(/giữ nguyên số lượng vật thể và mục tiêu/);
    expect(game).toEqual(before);
  });

  it('rejects stacked steps that cannot sit side by side inside the screen', () => {
    const game = columnGame({ width: 400 });
    const before = structuredClone(game);
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining(invalid));
    expect(game).toEqual(before);
  });

  it.each([100, 860])('keeps a repaired column inside the screen when it starts at x=%i', (x) => {
    const game = columnGame({ xs: [x, x, x] });
    const repaired = repairGamePlacement(game);
    expect(GameSpecSchema.safeParse(repaired).success).toBe(true);
    for (const platform of repaired.platforms) {
      expect(platform.x - platform.width / 2).toBeGreaterThanOrEqual(0);
      expect(platform.x + platform.width / 2).toBeLessThanOrEqual(960);
      expect(platform.y - platform.height / 2).toBeGreaterThanOrEqual(70);
      expect(platform.y + platform.height / 2).toBeLessThanOrEqual(500);
    }
    const xs = repaired.platforms.map((platform) => platform.x);
    expect(new Set(xs).size).toBe(3);
    expect(coinCosts(repaired).every((cost) => Number.isFinite(cost))).toBe(true);
  }, 20_000);

  it('leaves a floor enemy on the floor and off the stair landings', () => {
    const game = columnGame({ enemyX: 480 });
    const enemy = game.enemies[0]!;
    const repaired = repairGamePlacement(game);
    const moved = repaired.enemies[0]!;
    expect(repaired.enemies).toHaveLength(1);
    expect(moved.y).toBe(484);
    expect(moved.y + moved.size / 2).toBeGreaterThanOrEqual(496);
    expect({ size: moved.size, speed: moved.speed, axis: moved.axis, range: moved.range, damage: moved.damage })
      .toEqual({ size: enemy.size, speed: enemy.speed, axis: enemy.axis, range: enemy.range, damage: enemy.damage });
    expect(coinCosts(repaired).every((cost) => Number.isFinite(cost))).toBe(true);
    for (const coin of repaired.collectibles) expect(coin.y).not.toBe(475);
  }, 20_000);
});

describe('repair at the HTTP boundary', () => {
  it('returns a readable 422, no partial game and no second AI call when repair is impossible', async () => {
    const game = sampleSpec();
    game.collectibles.push({ x: 900, y: 100, value: 25 });
    const provider = mockProvider('groq', async () => JSON.stringify(game));
    const generate = vi.spyOn(provider, 'generate');
    const app = createApp({ generationService: new GameGenerationService(mockRegistry([provider])) });
    const result = await request(app).post('/api/games/generate').send({ providerId: 'groq', prompt: 'Nhặt đủ 2 xu' }).expect(422);
    expect(result.body.error.code).toBe('invalid_game_spec');
    expect(result.body.error.message).toContain('Xu 2');
    expect(result.body.error.message).toContain('giữ nguyên số lượng');
    expect(result.body.data).toBeUndefined();
    expect(generate).toHaveBeenCalledOnce();
  });
});
