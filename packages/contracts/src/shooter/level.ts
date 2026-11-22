import { z } from 'zod';
import {
  EDGE_MARGIN, ENEMY_TYPE_NAMES, FIELD, MAX_SCHEDULED_ENEMIES, OBSTACLE_MARGIN, SPAWN_SAFE_DISTANCE,
} from './constants.js';
import { pointRectDistance, rectInsideField } from './geometry.js';

const integer = (min: number, max: number) => z.number().int().min(min).max(max);
// Same rule as the `label` of GameSpec v1: letters, marks, numbers, dashes and
// simple title punctuation. No markup, URLs or code.
const label = z.string().min(1).max(80).regex(/^[\p{L}\p{M}\p{N}\p{Pd} .,!?"'():]+$/u);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const point = { x: integer(FIELD.left, FIELD.right), y: integer(FIELD.top, FIELD.bottom) };

/** A hand-made or compiled level. Every coordinate, spawn time and balance
 * number is in the data: nothing hidden lives in the engine. */
export const ShooterLevelSchema = z.object({
  kind: z.literal('shooter-v1'),
  title: label,
  seed: integer(0, 2 ** 31 - 1),
  width: z.literal(960), height: z.literal(540),
  theme: z.object({
    background: color, wall: color, player: color, enemy: color, bullet: color, accent: color,
  }).strict(),
  player: z.object({ ...point, speed: integer(120, 320), hp: integer(1, 10) }).strict(),
  weapon: z.object({
    cooldownMs: integer(80, 1000), bulletSpeed: integer(300, 900), damage: integer(1, 5), range: integer(200, 1000),
  }).strict(),
  obstacles: z.array(z.object({
    ...point, width: integer(20, 400), height: integer(20, 400),
  }).strict()).max(12),
  spawnPoints: z.array(z.object(point).strict()).min(1).max(8),
  waves: z.array(z.object({
    atMs: integer(0, 600_000), type: z.enum(ENEMY_TYPE_NAMES), count: integer(1, 40),
  }).strict()).min(1).max(30),
  win: z.discriminatedUnion('type', [
    z.object({ type: z.literal('survive'), seconds: integer(10, 300) }).strict(),
    z.object({ type: z.literal('kill'), count: integer(1, 400) }).strict(),
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
    if (Math.hypot(spawn.x - level.player.x, spawn.y - level.player.y) < SPAWN_SAFE_DISTANCE) {
      issue(['spawnPoints', index], 'Điểm xuất hiện của quái quá gần người chơi.');
    }
  });
  const total = level.waves.reduce((sum, wave) => sum + wave.count, 0);
  if (total > MAX_SCHEDULED_ENEMIES) issue(['waves'], `Tổng số quái theo lịch vượt ${MAX_SCHEDULED_ENEMIES}.`);
  if (level.win.type === 'kill' && level.win.count > total) {
    issue(['win', 'count'], 'Mục tiêu hạ quái vượt tổng số quái theo lịch.');
  }
  if (level.win.type === 'survive') {
    const endMs = level.win.seconds * 1000;
    if (!level.waves.some((wave) => wave.atMs < endMs)) issue(['waves'], 'Màn sống sót cần ít nhất một đợt quái xuất hiện trước khi hết giờ.');
  }
});

export type ShooterLevel = z.infer<typeof ShooterLevelSchema>;
