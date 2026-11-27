import { z } from 'zod';
import {
  BASE_CLEARANCE, EDGE_MARGIN, ENEMY_TYPE_NAMES, FIELD, MAX_SCHEDULED_ENEMIES, OBSTACLE_MARGIN, SPAWN_SAFE_DISTANCE, bossOf,
} from './constants.js';
import { baseRectOf, dist, pointRectDistance, rectInsideField } from './geometry.js';
import { LookSchema } from './look.js';
import { intBetween as integer, labelOf } from './schema-helpers.js';

const label = labelOf(80);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const point = { x: integer(FIELD.left, FIELD.right), y: integer(FIELD.top, FIELD.bottom) };

/** A hand-made or compiled level. Every coordinate, spawn time and balance
 * number is in the data: nothing hidden lives in the engine. */
export const ShooterLevelSchema = z.object({
  kind: z.literal('shooter-v1'),
  title: label,
  seed: integer(0, 2_147_483_647),
  width: z.literal(960), height: z.literal(540),
  theme: z.object({
    background: color, wall: color, player: color, enemy: color, bullet: color, accent: color,
  }).strict(),
  player: z.object({ ...point, speed: integer(120, 320), hp: integer(1, 10) }).strict(),
  weapon: z.object({
    cooldownMs: integer(80, 1000), bulletSpeed: integer(300, 900), damage: integer(1, 5), range: integer(200, 1000),
    /** Bullets per shot (absent = 1), the whole width of their fan in degrees (absent = 0) and how many
     * enemies one bullet passes through (absent = 1). All optional: a level without them plays as before. */
    pellets: integer(1, 9).optional(), spreadDeg: integer(0, 60).optional(), pierce: integer(1, 5).optional(),
  }).strict(),
  obstacles: z.array(z.object({
    ...point, width: integer(20, 400), height: integer(20, 400),
  }).strict()).max(12),
  spawnPoints: z.array(z.object(point).strict()).min(1).max(8),
  waves: z.array(z.object({
    atMs: integer(0, 600_000), type: z.enum(ENEMY_TYPE_NAMES), count: integer(1, 40),
  }).strict()).min(1).max(30),
  /** Chance in percent that a defeated enemy drops a health pickup (absent or 0 = never). */
  drops: z.object({ healthChancePct: integer(0, 50) }).strict().optional(),
  /** Hit points of the boss when it appears (absent = the boss kind's own). */
  bossHp: integer(10, 400).optional(),
  /** A base to defend (absent = none): a square of BASE_SIZE centered here. The game is lost when its hit points reach zero. */
  base: z.object({ ...point, hp: integer(5, 200) }).strict().optional(),
  /** How the level looks (ids of art packs). Only the renderer reads it: the simulation and its hash never do. Absent = the defaults. */
  look: LookSchema.optional(),
  win: z.discriminatedUnion('type', [
    z.object({ type: z.literal('survive'), seconds: integer(10, 300) }).strict(),
    z.object({ type: z.literal('kill'), count: integer(1, 400) }).strict(),
    z.object({ type: z.literal('boss') }).strict(),
  ]),
}).strict().superRefine((level, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  level.obstacles.forEach((block, index) => {
    if (!rectInsideField(block)) issue(['obstacles', index], 'Vật cản vượt khỏi vùng chơi.');
  });
  const insideMargin = (p: { x: number; y: number }) => p.x >= FIELD.left + EDGE_MARGIN && p.x <= FIELD.right - EDGE_MARGIN
    && p.y >= FIELD.top + EDGE_MARGIN && p.y <= FIELD.bottom - EDGE_MARGIN;
  const blocked = (p: { x: number; y: number }) => level.obstacles.some((block) => pointRectDistance(p.x, p.y, block) < OBSTACLE_MARGIN);
  if (!insideMargin(level.player)) issue(['player'], 'Người chơi nằm quá sát mép vùng chơi.');
  if (blocked(level.player)) issue(['player'], 'Người chơi nằm trong hoặc sát vật cản.');
  level.spawnPoints.forEach((spawn, index) => {
    if (!insideMargin(spawn)) issue(['spawnPoints', index], 'Điểm xuất hiện của quái nằm quá sát mép vùng chơi.');
    if (blocked(spawn)) issue(['spawnPoints', index], 'Điểm xuất hiện của quái nằm trong hoặc sát vật cản.');
    if (dist(spawn.x - level.player.x, spawn.y - level.player.y) < SPAWN_SAFE_DISTANCE) {
      issue(['spawnPoints', index], 'Điểm xuất hiện của quái quá gần người chơi.');
    }
  });
  if (level.base) {
    const square = baseRectOf(level.base);
    if (!rectInsideField(square) || !insideMargin({ x: square.x - square.width / 2, y: square.y - square.height / 2 })
      || !insideMargin({ x: square.x + square.width / 2, y: square.y + square.height / 2 })) issue(['base'], 'Căn cứ nằm quá sát mép vùng chơi.');
    level.obstacles.forEach((block, index) => {
      const gapX = Math.max(Math.abs(block.x - square.x) - (block.width + square.width) / 2, 0);
      const gapY = Math.max(Math.abs(block.y - square.y) - (block.height + square.height) / 2, 0);
      if (dist(gapX, gapY) < BASE_CLEARANCE) issue(['obstacles', index], 'Vật cản nằm quá gần căn cứ.');
    });
    if (pointRectDistance(level.player.x, level.player.y, square) < OBSTACLE_MARGIN) issue(['player'], 'Người chơi nằm trong hoặc sát căn cứ.');
    level.spawnPoints.forEach((spawn, index) => {
      if (pointRectDistance(spawn.x, spawn.y, square) < OBSTACLE_MARGIN) issue(['spawnPoints', index], 'Điểm xuất hiện của quái nằm trong hoặc sát căn cứ.');
      if (dist(spawn.x - level.base!.x, spawn.y - level.base!.y) < SPAWN_SAFE_DISTANCE) issue(['spawnPoints', index], 'Điểm xuất hiện của quái quá gần căn cứ.');
    });
  }
  const total = level.waves.reduce((sum, wave) => sum + wave.count, 0);
  if (total > MAX_SCHEDULED_ENEMIES) issue(['waves'], `Tổng số quái theo lịch vượt ${MAX_SCHEDULED_ENEMIES}.`);
  if (level.win.type === 'kill' && level.win.count > total) {
    issue(['win', 'count'], 'Mục tiêu hạ quái vượt tổng số quái theo lịch.');
  }
  // At most one boss per level, once; a level that is won by defeating the boss must have it.
  const bossWaves = level.waves.filter((wave) => bossOf(wave.type) !== undefined);
  if (bossWaves.length > 1) issue(['waves'], 'Mỗi màn có tối đa một đợt boss.');
  bossWaves.forEach((wave) => { if (wave.count !== 1) issue(['waves'], 'Đợt boss chỉ có một con.'); });
  if (level.win.type === 'boss' && bossWaves.length !== 1) issue(['win'], 'Màn có mục tiêu hạ boss cần đúng một đợt boss.');
  if (level.bossHp !== undefined && bossWaves.length === 0) issue(['bossHp'], 'bossHp cần có đợt boss.');
  if (level.win.type === 'survive') {
    const endMs = level.win.seconds * 1000;
    if (!level.waves.some((wave) => wave.atMs < endMs)) issue(['waves'], 'Màn sống sót cần ít nhất một đợt quái xuất hiện trước khi hết giờ.');
  }
});

export type ShooterLevel = z.infer<typeof ShooterLevelSchema>;

/** The level's boss wave, if it has one (a level has at most one). */
export const bossWaveOf = (level: Pick<ShooterLevel, 'waves'>) => level.waves.find((wave) => bossOf(wave.type) !== undefined);
