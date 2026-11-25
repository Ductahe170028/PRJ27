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
/** Enemy bullets closer than this push the expert bot away (px). */
export const EXPERT_BULLET_RADIUS = 90;

export interface Point { x: number; y: number }
/** An enemy as a bot sees it. `extra` (only a boss has it) is added to the distance at which it pushes the bot away: a boss is big. */
export interface EnemyPoint extends Point { extra?: number }
/** An enemy bullet as a bot sees it: where it is and which way it flies (px/s). */
export interface BulletPoint extends Point { vx: number; vy: number }

/** One step away from `enemies` within `fleeRadius` and from walls and edges within `wallRadius`,
 * as -1, 0 or 1 per axis (walls push back too, so fleeing does not pin the bot in a corner).
 * The sums are taken in a fixed order (enemies as given, then enemy bullets, then the edges, then the obstacles). */
export function steer(
  player: Point, level: ShooterLevel, enemies: readonly EnemyPoint[], fleeRadius: number, wallRadius: number,
  bullets: readonly BulletPoint[] = [], bulletRadius = EXPERT_BULLET_RADIUS,
): { moveX: -1 | 0 | 1; moveY: -1 | 0 | 1 } {
  let fx = 0;
  let fy = 0;
  for (const enemy of enemies) {
    const distance = dist(enemy.x - player.x, enemy.y - player.y);
    const reach = fleeRadius + (enemy.extra ?? 0); // (exactly fleeRadius for every enemy that is not a boss)
    if (distance < reach && distance > 0) {
      const weight = (reach - distance) / reach / distance;
      fx += (player.x - enemy.x) * weight;
      fy += (player.y - enemy.y) * weight;
    }
  }
  // A bullet that is coming at the player is sidestepped, not run from: the push is across its line of flight, to
  // the side the player is already on (a bullet is faster than the player, so backing straight away never works).
  // A bullet that has passed does nothing. Nothing is added when there are no bullets.
  for (const bullet of bullets) {
    const rx = player.x - bullet.x;
    const ry = player.y - bullet.y;
    const distance = dist(rx, ry);
    const speed = dist(bullet.vx, bullet.vy);
    if (distance >= bulletRadius || distance === 0 || speed === 0) continue;
    const ux = bullet.vx / speed;
    const uy = bullet.vy / speed;
    if (rx * ux + ry * uy <= 0) continue; // already past the player
    const side = rx * -uy + ry * ux; // which side of its path the player is on
    const sign = side >= 0 ? 1 : -1;
    const weight = (bulletRadius - distance) / bulletRadius;
    fx += -uy * sign * weight;
    fy += ux * sign * weight;
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
