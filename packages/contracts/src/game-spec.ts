import { z } from 'zod';

export const GAME_SPEC_MAX_BYTES = 32_768;
const integer = (min: number, max: number) => z.number().int().min(min).max(max);
// Display labels only. Letters, marks, numbers, dash punctuation (hyphen, en dash,
// em dash) and simple title punctuation. No markup, style strings, URLs or code.
const label = z.string().min(1).max(80).regex(/^[\p{L}\p{M}\p{N}\p{Pd} .,!?"'():]+$/u);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const position = { x: integer(16, 944), y: integer(80, 484) };
const rectangle = z.object({
  x: integer(10, 950), y: integer(80, 490),
  width: integer(20, 920), height: integer(16, 100),
}).strict();

export const GameSpecShape = z.object({
  version: z.literal('1.0'),
  title: label,
  genre: z.enum(['platformer', 'top-down']),
  width: z.literal(960), height: z.literal(540),
  theme: z.object({
    background: color, platform: color, player: color,
    enemy: color, collectible: color, accent: color,
  }).strict(),
  player: z.object({
    ...position, size: integer(24, 40), speed: integer(80, 320),
    jumpSpeed: integer(350, 600), health: integer(1, 5),
  }).strict(),
  platforms: z.array(rectangle).max(14),
  obstacles: z.array(rectangle).max(12),
  enemies: z.array(z.object({
    ...position, size: integer(20, 40), speed: integer(20, 180),
    axis: z.enum(['horizontal', 'vertical']), range: integer(0, 160), damage: integer(1, 2),
  }).strict()).min(1).max(8),
  collectibles: z.array(z.object({ ...position, value: integer(1, 100) }).strict()).min(1).max(24),
  controls: z.object({
    movement: z.enum(['arrows', 'wasd', 'both']),
    jump: z.enum(['space', 'up', 'both']), restart: z.literal('r'),
  }).strict(),
  win: z.object({
    type: z.enum(['collect_all', 'reach_score', 'survive']),
    scoreTarget: integer(1, 2_400), surviveSeconds: integer(10, 120),
  }).strict(),
  lose: z.object({ healthDepleted: z.literal(true), timeLimitSeconds: integer(0, 180) }).strict(),
  difficulty: z.object({
    gravity: integer(800, 1_600), invulnerabilityMs: integer(500, 2_000),
    enemySpeedMultiplier: z.number().min(0.5).max(2),
  }).strict(),
}).strict();

// Server repair may move item centers back into bounds. Every other field,
// array limit and unknown-property check stays strict before any repair runs.
const repairPosition = { x: z.number().int(), y: z.number().int() };
export const GameSpecPlacementInputSchema = GameSpecShape.extend({
  enemies: z.array(GameSpecShape.shape.enemies.element.extend(repairPosition)).min(1).max(8),
  collectibles: z.array(GameSpecShape.shape.collectibles.element.extend(repairPosition)).min(1).max(24),
});

export const GameSpecSchema = GameSpecShape.superRefine((game, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const blocks = [...game.platforms, ...game.obstacles];
  const overlaps = (x: number, y: number, size: number, block: z.infer<typeof rectangle>) =>
    Math.abs(x - block.x) < (size + block.width) / 2 && Math.abs(y - block.y) < (size + block.height) / 2;
  for (const [index, block] of blocks.entries()) {
    if (block.x - block.width / 2 < 0 || block.x + block.width / 2 > 960 || block.y - block.height / 2 < 70 || block.y + block.height / 2 > 500) {
      issue([index < game.platforms.length ? 'platforms' : 'obstacles', index < game.platforms.length ? index : index - game.platforms.length], 'Vật thể vượt khỏi màn chơi.');
    }
  }
  if (blocks.some((block) => overlaps(game.player.x, game.player.y, game.player.size, block))) {
    issue(['player'], 'Điểm xuất phát nằm trong vật cản.');
  }
  if (game.player.x < game.player.size / 2 || game.player.x > 960 - game.player.size / 2 || game.player.y - game.player.size / 2 < 70 || game.player.y + game.player.size / 2 > 500) {
    issue(['player'], 'Nhân vật nằm ngoài vùng chơi.');
  }
  for (const [i, coin] of game.collectibles.entries()) {
    if (blocks.some((block) => overlaps(coin.x, coin.y, 20, block))) issue(['collectibles', i], 'Vật phẩm nằm trong vật cản.');
  }
  for (const [i, enemy] of game.enemies.entries()) {
    if (enemy.x - enemy.size / 2 < 0 || enemy.x + enemy.size / 2 > 960 || enemy.y - enemy.size / 2 < 70 || enemy.y + enemy.size / 2 > 500
      || blocks.some((block) => overlaps(enemy.x, enemy.y, enemy.size, block))) issue(['enemies', i], 'Kẻ địch nằm ngoài vùng chơi hoặc trong vật cản.');
    const center = enemy.axis === 'horizontal' ? enemy.x : enemy.y;
    const limit = enemy.axis === 'horizontal' ? 960 : 500;
    if (center - enemy.range - enemy.size / 2 < (enemy.axis === 'horizontal' ? 0 : 70) || center + enemy.range + enemy.size / 2 > limit) {
      issue(['enemies', i], 'Đường tuần tra vượt khỏi vùng chơi.');
    }
    if (Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y) < (enemy.size + game.player.size) / 2 + 24) {
      issue(['enemies', i], 'Kẻ địch quá gần điểm xuất phát.');
    }
  }
  if (game.genre === 'top-down' && game.platforms.length > 0) issue(['platforms'], 'Top-down chỉ dùng obstacles.');
  if (game.win.type === 'reach_score' && game.win.scoreTarget > game.collectibles.reduce((sum, item) => sum + item.value, 0)) {
    issue(['win', 'scoreTarget'], 'Mục tiêu điểm vượt quá tổng điểm có thể nhặt.');
  }
  if (game.win.type === 'survive' && game.lose.timeLimitSeconds > 0 && game.lose.timeLimitSeconds < game.win.surviveSeconds) {
    issue(['lose', 'timeLimitSeconds'], 'Thời hạn ngắn hơn thời gian cần sống sót.');
  }
  // A conservative reachability check for platformer collectibles. The renderer
  // always provides a floor at y=500. This is validation, not AI repair/retry.
  if (game.genre === 'platformer') {
    const jumpHeight = game.player.jumpSpeed ** 2 / (2 * game.difficulty.gravity);
    const jumpRange = game.player.speed * game.player.jumpSpeed / game.difficulty.gravity * 1.5;
    const supports = [{ x: 480, y: 520, width: 960, height: 40 }, ...blocks];
    const reachable = new Set([0]);
    for (let pass = 0; pass < supports.length; pass += 1) {
      supports.forEach((to, index) => {
        if (reachable.has(index)) return;
        if (supports.some((from, fromIndex) => reachable.has(fromIndex)
          && from.y - from.height / 2 - (to.y - to.height / 2) <= jumpHeight - 12
          && Math.max(0, Math.abs(from.x - to.x) - (from.width + to.width) / 2) <= jumpRange)) reachable.add(index);
      });
    }
    game.collectibles.forEach((coin, index) => {
      if (!supports.some((support, supportIndex) => reachable.has(supportIndex)
        && coin.y <= support.y - support.height / 2
        && support.y - support.height / 2 - coin.y <= jumpHeight + game.player.size / 2
        && Math.abs(coin.x - support.x) <= support.width / 2)) {
        issue(['collectibles', index], 'Vật phẩm không nằm trong tầm nhảy của nền tảng có thể tới.');
      }
    });
  }
});

// The structural schema is used for constrained generation. Cross-field checks
// above remain authoritative on the server AND in the iframe.
export const GAME_SPEC_JSON_SCHEMA = z.toJSONSchema(GameSpecShape, { target: 'draft-7' });
export type GameSpec = z.infer<typeof GameSpecSchema>;
