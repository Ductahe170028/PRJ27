// Stage 4D: the base. A square building with hit points that stands still; enemies may go for it instead of the player, it hurts
// when they touch it, and the game is lost when it is destroyed. The base is a wall of the simulation (state.walls), so the
// player, the enemies, the bullets and the lines of sight treat it as one without any extra code. Nothing here is random: what
// an enemy does is a function of the state and of the tick.
import { BASE_DIRECT_RANGE, BASE_TUNING, ENEMY_TYPES, NAV_INFLATE, msToTicks, rangedOf } from './constants.js';
import { dist, lineOfSight, pointRectDistance, type Rect } from './geometry.js';
import type { ShooterLevel } from './level.js';
import { blockedCells, cellOf, flowDistances, flowTarget } from './navigation.js';
import type { ShooterEnemy, ShooterState } from './state.js';

/** The base's own state and the field its enemies walk on: the grid WITHOUT the base's block (a field is searched from a free
 * cell, and the base's own cell is blocked), made once, because the base never moves. */
export function createBase(level: ShooterLevel, rect: Rect) {
  const { x, y, hp } = level.base!;
  const blocked = blockedCells(level.obstacles, NAV_INFLATE);
  return {
    base: { x, y, hp, maxHp: hp, nextHitTick: 0, lastHitTick: -1000 },
    baseRect: rect,
    baseFlow: { blocked, dist: flowDistances(blocked, cellOf(x, y)) },
  };
}

/** On the way in an enemy picks the nearer of the base's center and the player (the player on a tie). */
export function aimsAtBaseOnSpawn(state: ShooterState, enemy: ShooterEnemy): boolean {
  const { base, player } = state;
  const toBase = (enemy.x - base!.x) * (enemy.x - base!.x) + (enemy.y - base!.y) * (enemy.y - base!.y);
  const toPlayer = (enemy.x - player.x) * (enemy.x - player.x) + (enemy.y - player.y) * (enemy.y - player.y);
  return toBase < toPlayer;
}

/** Every tick an enemy changes its mind only when the other target is nearer than the current one by at least the margin, so
 * that it does not flicker between the two. */
export function retarget(state: ShooterState, enemy: ShooterEnemy) {
  const { base, player } = state;
  const toBase = dist(enemy.x - base!.x, enemy.y - base!.y);
  const toPlayer = dist(enemy.x - player.x, enemy.y - player.y);
  const current = enemy.aimAtBase ? toBase : toPlayer;
  const other = enemy.aimAtBase ? toPlayer : toBase;
  if (current - other >= BASE_TUNING.targetSwitchMargin) enemy.aimAtBase = !enemy.aimAtBase;
}

/** An enemy touches the base when its body reaches the square. */
export const touchesBase = (state: ShooterState, enemy: ShooterEnemy) =>
  pointRectDistance(enemy.x, enemy.y, state.baseRect!) <= ENEMY_TYPES[enemy.type].radius + 1;

/** Whether the enemy sees the base's center. Only the obstacles count: the base does not block the view of itself. */
export const baseInSight = (state: ShooterState, enemy: ShooterEnemy, radius: number) => lineOfSight(enemy, state.base!, radius, state.level.obstacles);

/** Step 6 for an enemy that is going for the base: along the base's field, straight at the center once it is near; it stops
 * when it touches the square (and never goes into it). A shooting enemy stops at its hold range when it sees the base. */
export function moveAtBase(state: ShooterState, enemy: ShooterEnemy, stride: number) {
  const { base, baseRect, baseFlow } = state;
  const kind = ENEMY_TYPES[enemy.type];
  const toCenter = dist(base!.x - enemy.x, base!.y - enemy.y);
  const ranged = rangedOf(enemy.type);
  if (ranged && toCenter <= ranged.holdRange && baseInSight(state, enemy, ranged.bulletRadius)) return;
  const room = pointRectDistance(enemy.x, enemy.y, baseRect!) - (kind.radius + 1);
  if (room <= 0) return;
  let tx = base!.x;
  let ty = base!.y;
  let straight = true;
  if (toCenter > BASE_DIRECT_RANGE) {
    const next = flowTarget(baseFlow!.blocked, baseFlow!.dist, enemy.x, enemy.y);
    if (next) { tx = next.x; ty = next.y; straight = false; }
  }
  const dx = tx - enemy.x;
  const dy = ty - enemy.y;
  const distance = dist(dx, dy);
  if (distance === 0) return;
  const move = straight ? Math.min(stride, room) : stride;
  enemy.x += (dx / distance) * move;
  enemy.y += (dy / distance) * move;
}

/** The base takes `amount` and remembers when (for drawing). */
export function damageBase(state: ShooterState, amount: number, t: number) {
  const base = state.base!;
  base.hp = Math.max(0, base.hp - amount);
  base.lastHitTick = t;
}

/** 8b. Every BASE_TUNING.hitIntervalMs the base takes the TOTAL damage of every enemy that touches it (a boss too). With
 * no enemy touching, nothing happens and the interval does not start. */
export function hurtBase(state: ShooterState, t: number) {
  const { base } = state;
  if (!base || t < base.nextHitTick) return;
  let damage = 0;
  for (const enemy of state.enemies) if (touchesBase(state, enemy)) damage += ENEMY_TYPES[enemy.type].damage;
  if (damage === 0) return;
  damageBase(state, damage, t);
  base.nextHitTick = t + msToTicks(BASE_TUNING.hitIntervalMs);
}
