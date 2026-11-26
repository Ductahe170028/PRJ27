// Steps 6b and 7b of a tick: enemies that shoot (a `ranged` kind in ENEMY_TYPES) fire at the player,
// and their bullets fly. Every number comes from the kind's `ranged` data. No random numbers here.
import { ENEMY_BULLET_RANGE_FACTOR, ENEMY_TYPES, FIELD, INVULNERABLE_MS, MAX_ENEMY_BULLETS, PLAYER_RADIUS, TICK_RATE, msToTicks, rangedOf } from './constants.js';
import { lineOfSight, segmentCircleHit, segmentRectHit, type Rect } from './geometry.js';
import { damageBase } from './base.js';
import type { EnemyBullet, ShooterState } from './state.js';

/** 6b. Each shooting enemy (in array order) whose turn has come, that sees the player in a straight line
 * within its sight range, fires one bullet at where the player IS now (no leading), while fewer than
 * MAX_ENEMY_BULLETS are in the air. It tries again every tick until it sees the player. */
export function enemiesShoot(state: ShooterState, t: number) {
  const { player, enemies, level } = state;
  for (const enemy of enemies) {
    const ranged = rangedOf(enemy.type);
    if (!ranged || enemy.nextShotTick === undefined || t < enemy.nextShotTick) continue;
    if (state.enemyBullets.length >= MAX_ENEMY_BULLETS) return;
    // An enemy that is going for the base shoots at its center (the base does not block the view of itself).
    const atBase = enemy.aimAtBase === true && state.base !== undefined;
    const target = atBase ? state.base! : player;
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0 || distance > ranged.sightRange) continue;
    if (!lineOfSight(enemy, target, ranged.bulletRadius, atBase ? level.obstacles : state.walls)) continue;
    const ux = dx / distance;
    const uy = dy / distance;
    const reach = ENEMY_TYPES[enemy.type].radius + 1;
    state.enemyBullets.push({
      id: state.nextId, x: enemy.x + ux * reach, y: enemy.y + uy * reach,
      vx: ux * ranged.bulletSpeed, vy: uy * ranged.bulletSpeed, travelled: 0,
      damage: ranged.bulletDamage, radius: ranged.bulletRadius, range: ranged.sightRange * ENEMY_BULLET_RANGE_FACTOR,
    });
    state.nextId += 1;
    enemy.nextShotTick = t + msToTicks(ranged.cooldownMs);
  }
}

/** 7b. Enemy bullets fly (after the player's). A wall stops a bullet (a wall at the same distance wins). A
 * bullet that reaches the player hurts it and sets the same protection time as a touch; while the player
 * is still protected the bullet is absorbed and does nothing. Enemy bullets never hit other enemies. */
export function flyEnemyBullets(state: ShooterState, t: number, walls: readonly Rect[]) {
  if (state.enemyBullets.length === 0) return;
  const { player } = state;
  const kept: EnemyBullet[] = [];
  for (const bullet of state.enemyBullets) {
    const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
    const stride = Math.min(speed / TICK_RATE, bullet.range - bullet.travelled);
    const x0 = bullet.x;
    const y0 = bullet.y;
    const x1 = speed > 0 ? x0 + (bullet.vx / speed) * stride : x0;
    const y1 = speed > 0 ? y0 + (bullet.vy / speed) * stride : y0;
    let wallHit: number | undefined;
    let baseHit: number | undefined; // the base's square is among the walls, but it is hurt by a bullet, not only stopped
    for (const block of walls) {
      const hit = segmentRectHit(x0, y0, x1, y1, block, bullet.radius);
      if (hit === undefined) continue;
      if (block === state.baseRect) baseHit = hit;
      else if (wallHit === undefined || hit < wallHit) wallHit = hit;
    }
    const playerHit = segmentCircleHit(x0, y0, x1, y1, player.x, player.y, PLAYER_RADIUS + bullet.radius);
    // The base takes the bullet's damage at once, and the bullet is spent, when it is the first thing on the way.
    if (baseHit !== undefined && (wallHit === undefined || baseHit < wallHit) && (playerHit === undefined || baseHit < playerHit)) {
      damageBase(state, bullet.damage, t);
      continue;
    }
    if (playerHit !== undefined && (wallHit === undefined || playerHit < wallHit)) {
      if (t >= player.invulnerableUntilTick) {
        player.hp = Math.max(0, player.hp - bullet.damage);
        player.invulnerableUntilTick = t + msToTicks(INVULNERABLE_MS);
      }
      continue; // spent either way
    }
    if (wallHit !== undefined) continue;
    bullet.x = x1; bullet.y = y1;
    bullet.travelled += stride;
    const outside = x1 < FIELD.left || x1 > FIELD.right || y1 < FIELD.top || y1 > FIELD.bottom;
    if (outside || bullet.travelled >= bullet.range) continue;
    kept.push(bullet);
  }
  state.enemyBullets = kept;
}
