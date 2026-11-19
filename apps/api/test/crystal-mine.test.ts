import { describe, expect, it } from 'vitest';
import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import { buildNavigation, collectibleCost, overlapsRect } from '../src/services/game-geometry.js';
import { repairGamePlacement } from '../src/services/repair-game-placement.js';
import { GAME_SYSTEM_PROMPT, describeSchema, providerJsonSchema } from '../src/services/system-prompt.js';
import { sampleSpec } from './fixtures.js';

// standard-20261119-170732-b769 provider-output.txt. Groq rejected this body
// with json_validate_failed before GameSpec parsing.
const wrappedGeneration = '{"root":{"version":"1.0","title":"CRYSTAL MINE – Mỏ Pha Lê","genre":"platformer","width":960,"height":540},"theme":{"background":"#001122","platform":"#334455","player":"#FFCC00","enemy":"#CC3333","collectible":"#00CCFF","accent":"#FF9900"},"player":{"x":80,"y":460,"size":28,"speed":260,"jumpSpeed":560,"health":3},"platforms":[{"x":200,"y":420,"width":200,"height":20},{"x":500,"y":350,"width":150,"height":20},{"x":700,"y":280,"width":180,"height":20},{"x":400,"y":210,"width":160,"height":20},{"x":800,"y":140,"width":140,"height":20}],"obstacles":[],"enemies":[{"x":300,"y":484,"size":28,"speed":80,"axis":"horizontal","range":120,"damage":1},{"x":650,"y":484,"size":28,"speed":80,"axis":"horizontal","range":120,"damage":1}],"collectibles":[{"x":250,"y":475,"value":1},{"x":550,"y":325,"value":1},{"x":750,"y":255,"value":1},{"x":450,"y":185,"value":1},{"x":850,"y":115,"value":1},{"x":350,"y":475,"value":1}],"controls":{"movement":"both","jump":"both","restart":"r"},"win":{"type":"collect_all","scoreTarget":10,"surviveSeconds":30},"lose":{"healthDepleted":true,"timeLimitSeconds":0},"difficulty":{"gravity":1200,"invulnerabilityMs":1000,"enemySpeedMultiplier":1.0}}';

// standard-20261119-170748-c36f parsed.json. Xu 2 is collectibles[1].
const latestMine = {
  version: '1.0', title: 'CRYSTAL MINE – Mỏ Pha Lê', genre: 'platformer', width: 960, height: 540,
  theme: { background: '#111111', platform: '#444444', player: '#00FFAA', enemy: '#FF4444', collectible: '#FFCC00', accent: '#888888' },
  player: { x: 80, y: 460, size: 28, speed: 260, jumpSpeed: 560, health: 3 },
  platforms: [
    { x: 120, y: 400, width: 200, height: 20 },
    { x: 320, y: 340, width: 180, height: 20 },
    { x: 520, y: 280, width: 160, height: 20 },
    { x: 680, y: 220, width: 140, height: 20 },
    { x: 840, y: 160, width: 120, height: 20 },
  ],
  obstacles: [],
  enemies: [
    { x: 200, y: 484, size: 28, speed: 80, axis: 'horizontal', range: 120, damage: 1 },
    { x: 600, y: 484, size: 28, speed: 80, axis: 'horizontal', range: 120, damage: 1 },
  ],
  collectibles: [
    { x: 140, y: 475, value: 1 },
    { x: 340, y: 315, value: 1 },
    { x: 540, y: 255, value: 1 },
    { x: 740, y: 195, value: 1 },
    { x: 940, y: 135, value: 1 },
    { x: 860, y: 135, value: 1 },
  ],
  controls: { movement: 'both', jump: 'both', restart: 'r' },
  win: { type: 'collect_all', scoreTarget: 6, surviveSeconds: 30 },
  lose: { healthDepleted: true, timeLimitSeconds: 0 },
  difficulty: { gravity: 1200, invulnerabilityMs: 500, enemySpeedMultiplier: 1 },
} as GameSpec;

// standard-20261119-170723-2ef2. The step under the ceiling can be reached and
// left; the top step cannot.
const earlierMine = {
  ...latestMine,
  theme: { background: '#111111', platform: '#4A4A4A', player: '#FFD700', enemy: '#FF4500', collectible: '#00FFFF', accent: '#FF69B4' },
  platforms: [
    { x: 200, y: 400, width: 200, height: 20 },
    { x: 400, y: 320, width: 180, height: 20 },
    { x: 600, y: 260, width: 160, height: 20 },
    { x: 750, y: 190, width: 140, height: 20 },
    { x: 880, y: 120, width: 120, height: 20 },
  ],
  enemies: [
    { x: 350, y: 484, size: 28, speed: 80, axis: 'horizontal', range: 120, damage: 1 },
    { x: 650, y: 484, size: 28, speed: 80, axis: 'horizontal', range: 120, damage: 1 },
  ],
  collectibles: [
    { x: 220, y: 475, value: 1 },
    { x: 420, y: 295, value: 1 },
    { x: 620, y: 235, value: 1 },
    { x: 770, y: 165, value: 1 },
    { x: 890, y: 95, value: 1 },
    { x: 150, y: 475, value: 1 },
  ],
  win: { type: 'collect_all', scoreTarget: 10, surviveSeconds: 30 },
  difficulty: { gravity: 1200, invulnerabilityMs: 1000, enemySpeedMultiplier: 1 },
} as GameSpec;

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

// standard-20261119-174831-dca2 parsed.json. Platforms 0-2 are a reachable
// zigzag; 3 and 4 fold back above them and share only a side overlap.
const foldedMine = {
  ...latestMine,
  theme: { background: '#111111', platform: '#444444', player: '#00FFAA', enemy: '#FF4444', collectible: '#FFD700', accent: '#FFAA00' },
  platforms: [
    { x: 200, y: 420, width: 200, height: 20 },
    { x: 450, y: 350, width: 180, height: 20 },
    { x: 700, y: 280, width: 160, height: 20 },
    { x: 350, y: 210, width: 220, height: 20 },
    { x: 600, y: 140, width: 200, height: 20 },
  ],
  enemies: [
    { x: 300, y: 484, size: 28, speed: 80, axis: 'horizontal', range: 120, damage: 1 },
    { x: 800, y: 484, size: 28, speed: 80, axis: 'horizontal', range: 120, damage: 1 },
  ],
  collectibles: [
    { x: 100, y: 475, value: 1 },
    { x: 250, y: 395, value: 1 },
    { x: 470, y: 325, value: 1 },
    { x: 680, y: 255, value: 1 },
    { x: 420, y: 185, value: 1 },
    { x: 650, y: 115, value: 1 },
  ],
  difficulty: { gravity: 1200, invulnerabilityMs: 1000, enemySpeedMultiplier: 1 },
} as GameSpec;

describe('Crystal Mine placement', () => {
  it('repairs the latest unreachable Xu 2 without dropping coins or the goal', () => {
    const before = structuredClone(latestMine);
    const repaired = repairGamePlacement(structuredClone(latestMine));
    expect(latestMine).toEqual(before);
    expect(repaired.collectibles).toHaveLength(before.collectibles.length);
    expect(repaired.collectibles.map((coin) => coin.value)).toEqual(before.collectibles.map((coin) => coin.value));
    expect(repaired.win).toEqual(before.win);
    expect(repaired.enemies.map(({ x: _x, ...enemy }) => enemy)).toEqual(before.enemies.map(({ x: _x, ...enemy }) => enemy));
    const safe = buildNavigation(repaired, true);
    expect(safe).toBeDefined();
    expect(repaired.collectibles.every((coin) => Number.isFinite(collectibleCost(repaired, coin, safe!)))).toBe(true);
    expect(repairGamePlacement(structuredClone(latestMine))).toEqual(repaired);
  }, 20_000);

  it('reaches the step that can be left by dropping and still rejects the step above the jump', () => {
    const navigation = buildNavigation(earlierMine, false);
    expect(navigation).toBeDefined();
    expect(Number.isFinite(collectibleCost(earlierMine, earlierMine.collectibles[3]!, navigation!))).toBe(true);
    expect(collectibleCost(earlierMine, earlierMine.collectibles[4]!, navigation!)).toBe(Infinity);
  });

  it('keeps the reachable zigzag and reseats only the folded steps', () => {
    const before = structuredClone(foldedMine);
    const navigation = buildNavigation(foldedMine, true);
    expect(navigation).toBeDefined();
    expect(Number.isFinite(collectibleCost(foldedMine, foldedMine.collectibles[1]!, navigation!))).toBe(true);
    const repaired = repairGamePlacement(structuredClone(foldedMine));
    expect(foldedMine).toEqual(before);
    expect(repaired.platforms.slice(0, 3)).toEqual(before.platforms.slice(0, 3));
    expect(repaired.platforms.map(({ width, height }) => ({ width, height })))
      .toEqual(before.platforms.map(({ width, height }) => ({ width, height })));
    expect(repaired.collectibles[1]).toEqual(before.collectibles[1]);
    expect(repaired.collectibles).toHaveLength(before.collectibles.length);
    expect(repaired.win).toEqual(before.win);
    const safe = buildNavigation(repaired, true);
    expect(safe).toBeDefined();
    expect(repaired.collectibles.every((coin) => Number.isFinite(collectibleCost(repaired, coin, safe!)))).toBe(true);
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
    expect(repairGamePlacement(structuredClone(foldedMine))).toEqual(repaired);
  }, 20_000);

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
