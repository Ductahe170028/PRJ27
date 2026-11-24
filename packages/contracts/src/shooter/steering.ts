// How a bot decides where to step: away from enemies that are too close and away from walls and
// edges. Shared by the expert bot (bot.ts) and the casual bot (casual-bot.ts), which differ in WHAT
// they know (exact or a moment old) and in the radii they use, not in how they steer.
import { FIELD, PLAYER_RADIUS } from './constants.js';
import { dist } from './geometry.js';
import type { ShooterLevel } from './level.js';

/** Enemies closer than this push the expert bot away (px). */
export const EXPERT_FLEE_RADIUS = 150;
/** Walls and edges closer than this push the expert bot away (px). */
export const EXPERT_WALL_RADIUS = 60;

export interface Point { x: number; y: number }

/** One step away from `enemies` within `fleeRadius` and from walls and edges within `wallRadius`,
 * as -1, 0 or 1 per axis (walls push back too, so fleeing does not pin the bot in a corner).
 * The sums are taken in a fixed order (enemies as given, then the edges, then the obstacles). */
export function steer(player: Point, level: ShooterLevel, enemies: readonly Point[], fleeRadius: number, wallRadius: number): { moveX: -1 | 0 | 1; moveY: -1 | 0 | 1 } {
  let fx = 0;
  let fy = 0;
  for (const enemy of enemies) {
    const distance = dist(enemy.x - player.x, enemy.y - player.y);
    if (distance < fleeRadius && distance > 0) {
      const weight = (fleeRadius - distance) / fleeRadius / distance;
      fx += (player.x - enemy.x) * weight;
      fy += (player.y - enemy.y) * weight;
    }
  }
  const edge = (gap: number) => (gap < wallRadius ? (wallRadius - gap) / wallRadius : 0);
  fx += edge(player.x - FIELD.left - PLAYER_RADIUS) - edge(FIELD.right - PLAYER_RADIUS - player.x);
  fy += edge(player.y - FIELD.top - PLAYER_RADIUS) - edge(FIELD.bottom - PLAYER_RADIUS - player.y);
  for (const block of level.obstacles) {
    const dx = Math.max(Math.abs(player.x - block.x) - block.width / 2, 0);
    const dy = Math.max(Math.abs(player.y - block.y) - block.height / 2, 0);
    const gap = dist(dx, dy) - PLAYER_RADIUS;
    if (gap < wallRadius) {
      const nx = Math.max(Math.min(player.x, block.x + block.width / 2), block.x - block.width / 2);
      const ny = Math.max(Math.min(player.y, block.y + block.height / 2), block.y - block.height / 2);
      const distance = dist(player.x - nx, player.y - ny) || 1;
      fx += ((player.x - nx) / distance) * edge(gap);
      fy += ((player.y - ny) / distance) * edge(gap);
    }
  }
  const length = dist(fx, fy);
  const sector = (value: number) => (length < 1e-6 ? 0 : value / length > 0.38 ? 1 : value / length < -0.38 ? -1 : 0);
  return { moveX: sector(fx), moveY: sector(fy) };
}
