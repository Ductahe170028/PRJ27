// The boss: how it appears, moves, rushes and fires. Every number comes from the kind's `boss` data in ENEMY_TYPES,
// and nothing here is random: what a boss does is a function of the tick and of the state, so a boss level plays out
// the same way every time and does not disturb the game's random numbers.
import {
  ENEMY_TYPES, MAX_ENEMY_BULLETS, PLAYER_RADIUS, TICK_RATE, bossOf, msToTicks, type BossSpec, type EnemyType, type VolleySpec,
} from './constants.js';
import { RADIANS_PER_DEGREE, lineOfSight, resolveCircle, tanSmall, type Rect } from './geometry.js';
import { flowTarget } from './navigation.js';
import type { ShooterEnemy, ShooterState } from './state.js';

/** Twelve unit vectors, 30 degrees apart, written out (4 decimals) so that no trigonometry is needed. */
export const RING_12: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5],
  [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5],
];

export const isBoss = (type: EnemyType) => bossOf(type) !== undefined;

/** The enemy is enraged once its hit points are at or below the share of its maximum that its kind names. */
export const isEnraged = (enemy: ShooterEnemy, spec: BossSpec) => enemy.maxHp !== undefined && enemy.hp <= enemy.maxHp * spec.enrage.belowHpShare;

/** Sets a boss that has just appeared: its hit points (the level's `bossHp` when it has one), and the first time of
 * each of its cycles, counted from `t`, the tick it appeared. */
export function startBoss(enemy: ShooterEnemy, spec: BossSpec, t: number, bossHp: number | undefined) {
  if (bossHp !== undefined) enemy.hp = bossHp;
  enemy.maxHp = enemy.hp;
  enemy.bossPhase = 'move';
  if (spec.charge) enemy.nextChargeTick = t + msToTicks(spec.charge.cycleMs);
  if (spec.volleys) enemy.volleyTicks = spec.volleys.map((volley) => t + msToTicks(volley.cooldownMs));
}

/** Step 6 for a boss, instead of the ordinary movement: its rush (stand still, then rush straight), else it walks at
 * the player (along the flow field when it cannot see the player), stopping at `holdRange` when it has one. */
export function moveBoss(state: ShooterState, enemy: ShooterEnemy, t: number, walls: readonly Rect[], flowDist: () => number[]) {
  const spec = bossOf(enemy.type)!;
  const kind = ENEMY_TYPES[enemy.type];
  const { player } = state;
  const enraged = isEnraged(enemy, spec);
  const speed = (kind.speed / TICK_RATE) * (enraged ? spec.enrage.speedScale : 1);
  const charge = spec.charge;
  if (charge && enemy.bossPhase === 'move' && t >= (enemy.nextChargeTick ?? Infinity)) {
    enemy.bossPhase = 'telegraph';
    enemy.phaseUntilTick = t + msToTicks(charge.telegraphMs);
    return;
  }
  if (charge && enemy.bossPhase === 'telegraph') {
    if (t < (enemy.phaseUntilTick ?? 0)) return; // standing still: this is the warning
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    enemy.chargeDx = length > 0 ? dx / length : 1;
    enemy.chargeDy = length > 0 ? dy / length : 0;
    enemy.bossPhase = 'charge';
    enemy.phaseUntilTick = t + msToTicks(charge.durationMs);
  }
  if (charge && enemy.bossPhase === 'charge') {
    const stride = speed * charge.speedScale;
    const fromX = enemy.x;
    const fromY = enemy.y;
    enemy.x += (enemy.chargeDx ?? 1) * stride;
    enemy.y += (enemy.chargeDy ?? 0) * stride;
    const aimedX = enemy.x;
    const aimedY = enemy.y;
    resolveCircle(enemy, kind.radius, walls);
    const hitWall = enemy.x !== aimedX || enemy.y !== aimedY;
    if (hitWall || t + 1 >= (enemy.phaseUntilTick ?? 0) || (enemy.x === fromX && enemy.y === fromY)) {
      enemy.bossPhase = 'move';
      enemy.nextChargeTick = t + 1 + msToTicks(charge.cycleMs * (enraged ? spec.enrage.cooldownScale : 1));
    }
    return;
  }
  // walking
  let toPlayer = true;
  let tx = player.x;
  let ty = player.y;
  const sight = lineOfSight(enemy, player, kind.radius, walls);
  if (!sight) {
    const target = flowTarget(state.bossBlocked ?? state.blocked, flowDist(), enemy.x, enemy.y);
    if (target) { tx = target.x; ty = target.y; toPlayer = false; }
  }
  const dx = tx - enemy.x;
  const dy = ty - enemy.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return;
  if (spec.holdRange !== undefined && sight && distance <= spec.holdRange) return;
  const room = toPlayer ? distance - (PLAYER_RADIUS + kind.radius - 1) : distance;
  const move = Math.min(speed, Math.max(0, room));
  enemy.x += (dx / distance) * move;
  enemy.y += (dy / distance) * move;
}

/** Step 6b for bosses: each volley of each boss whose turn has come is fired when the player is within its range (a
 * fan also needs a straight view) and there is room for all its bullets; otherwise it waits and tries again next tick. */
export function bossesFire(state: ShooterState, t: number, walls: readonly Rect[]) {
  const { player } = state;
  for (const enemy of state.enemies) {
    const spec = bossOf(enemy.type);
    if (!spec?.volleys || !enemy.volleyTicks) continue;
    const enraged = isEnraged(enemy, spec);
    spec.volleys.forEach((volley, index) => {
      if (t < (enemy.volleyTicks![index] ?? Infinity) || state.enemyBullets.length + volley.count > MAX_ENEMY_BULLETS) return;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance === 0 || distance > volley.range) return;
      if (volley.shape === 'fan' && !lineOfSight(enemy, player, volley.bulletRadius, walls)) return;
      fire(state, enemy, volley, dx / distance, dy / distance);
      enemy.volleyTicks![index] = t + msToTicks(volley.cooldownMs * (enraged ? spec.enrage.cooldownScale : 1));
    });
  }
}

function fire(state: ShooterState, enemy: ShooterEnemy, volley: VolleySpec, ux: number, uy: number) {
  const reach = ENEMY_TYPES[enemy.type].radius + 1;
  const tanHalf = volley.shape === 'fan' ? tanSmall((volley.spreadDeg / 2) * RADIANS_PER_DEGREE) : 0;
  const count = volley.shape === 'ring' ? RING_12.length : volley.count;
  for (let k = 0; k < count; k += 1) {
    let dx: number;
    let dy: number;
    if (volley.shape === 'ring') {
      [dx, dy] = RING_12[k]!;
    } else {
      // aim + perpendicular(aim) * side, a unit vector again (the same fan as the shotgun's)
      const side = count > 1 ? tanHalf * ((2 * k) / (count - 1) - 1) : 0;
      const sx = ux - uy * side;
      const sy = uy + ux * side;
      const length = Math.sqrt(sx * sx + sy * sy);
      dx = sx / length;
      dy = sy / length;
    }
    state.enemyBullets.push({
      id: state.nextId, x: enemy.x + dx * reach, y: enemy.y + dy * reach, vx: dx * volley.bulletSpeed, vy: dy * volley.bulletSpeed,
      travelled: 0, damage: volley.bulletDamage, radius: volley.bulletRadius, range: volley.range,
    });
    state.nextId += 1;
  }
}
