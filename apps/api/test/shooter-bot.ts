// Test helper, not product code: a plain player to prove that a level is
// winnable, and that standing still is not enough.
import { FIELD, PLAYER_RADIUS, createSim, step, type ShooterInput, type ShooterLevel, type ShooterState } from '@game-creator/contracts';

const FLEE_RADIUS = 150;
const WALL_RADIUS = 60;

/** Aims at the nearest enemy, holds fire, and steps away from enemies within
 * 150 px and from walls. */
export function botInput(state: ShooterState): ShooterInput {
  const { player, enemies, level } = state;
  let nearest: (typeof enemies)[number] | undefined;
  let nearestDistance = Infinity;
  let fx = 0;
  let fy = 0;
  for (const enemy of enemies) {
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = enemy; }
    if (distance < FLEE_RADIUS && distance > 0) {
      const weight = (FLEE_RADIUS - distance) / FLEE_RADIUS / distance;
      fx += (player.x - enemy.x) * weight;
      fy += (player.y - enemy.y) * weight;
    }
  }
  // Walls and edges push back too, so fleeing does not pin the bot in a corner.
  const edge = (gap: number) => (gap < WALL_RADIUS ? (WALL_RADIUS - gap) / WALL_RADIUS : 0);
  fx += edge(player.x - FIELD.left - PLAYER_RADIUS) - edge(FIELD.right - PLAYER_RADIUS - player.x);
  fy += edge(player.y - FIELD.top - PLAYER_RADIUS) - edge(FIELD.bottom - PLAYER_RADIUS - player.y);
  for (const block of level.obstacles) {
    const dx = Math.max(Math.abs(player.x - block.x) - block.width / 2, 0);
    const dy = Math.max(Math.abs(player.y - block.y) - block.height / 2, 0);
    const gap = Math.hypot(dx, dy) - PLAYER_RADIUS;
    if (gap < WALL_RADIUS) {
      const nx = Math.max(Math.min(player.x, block.x + block.width / 2), block.x - block.width / 2);
      const ny = Math.max(Math.min(player.y, block.y + block.height / 2), block.y - block.height / 2);
      const distance = Math.hypot(player.x - nx, player.y - ny) || 1;
      fx += ((player.x - nx) / distance) * edge(gap);
      fy += ((player.y - ny) / distance) * edge(gap);
    }
  }
  const length = Math.hypot(fx, fy);
  const sector = (value: number) => (length < 1e-6 ? 0 : value / length > 0.38 ? 1 : value / length < -0.38 ? -1 : 0);
  return {
    moveX: sector(fx), moveY: sector(fy),
    aimX: nearest ? nearest.x : player.x + 1, aimY: nearest ? nearest.y : player.y,
    fire: nearest !== undefined,
  };
}

export const IDLE: ShooterInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };

export interface RunResult { status: ShooterState['status']; seconds: number; kills: number; hp: number; state: ShooterState }

/** Plays a level to its end (or `maxTicks`) with `policy`. */
export function play(level: ShooterLevel, policy: (state: ShooterState) => ShooterInput, maxTicks = 60 * 400): RunResult {
  const state = createSim(level);
  while (state.status === 'playing' && state.tick < maxTicks) step(state, policy(state));
  return { status: state.status, seconds: state.tick / 60, kills: state.kills, hp: state.player.hp, state };
}
