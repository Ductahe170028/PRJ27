// Steps 4 and 7 of a tick: the weapon fires, and bullets fly and hit. The numbers
// (cooldown, speed, damage, range) come from `level.weapon`, never from a weapon's name.
import { BULLET_RADIUS, FIELD, MAX_BULLETS, MAX_ENEMY_RADIUS, PLAYER_RADIUS, TICK_RATE, ENEMY_TYPES, msToTicks } from './constants.js';
import { damageEnemy } from './combat.js';
import { segmentCircleHit, segmentRectHit, type Rect } from './geometry.js';
import { buildGrid, gridQuery } from './grid.js';
import type { ShooterBullet, ShooterEnemy, ShooterInput, ShooterState } from './state.js';

/** 4. The weapon fires if asked and ready, and the bullet cap allows. */
export function fireWeapon(state: ShooterState, input: ShooterInput, t: number) {
  const { level, player } = state;
  if (input.fire && t >= player.nextShotTick && state.bullets.length < MAX_BULLETS) {
    const reach = PLAYER_RADIUS + BULLET_RADIUS + 1;
    state.bullets.push({
      id: state.nextId, x: player.x + state.aimX * reach, y: player.y + state.aimY * reach,
      vx: state.aimX * level.weapon.bulletSpeed, vy: state.aimY * level.weapon.bulletSpeed, travelled: 0,
    });
    state.nextId += 1;
    player.nextShotTick = t + msToTicks(level.weapon.cooldownMs);
  }
}

/** 7. Bullets fly; a swept test finds the first enemy or wall on the way. */
export function flyBullets(state: ShooterState, walls: readonly Rect[]) {
  const { level, enemies } = state;
  if (state.bullets.length === 0) return;
  buildGrid(enemies);
  const kept: ShooterBullet[] = [];
  const reach = MAX_ENEMY_RADIUS + BULLET_RADIUS;
  for (const bullet of state.bullets) {
    const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
    const stride = Math.min(speed / TICK_RATE, level.weapon.range - bullet.travelled);
    const x0 = bullet.x;
    const y0 = bullet.y;
    const x1 = speed > 0 ? x0 + (bullet.vx / speed) * stride : x0;
    const y1 = speed > 0 ? y0 + (bullet.vy / speed) * stride : y0;

    let wallHit: number | undefined;
    for (const block of walls) {
      const hit = segmentRectHit(x0, y0, x1, y1, block, BULLET_RADIUS);
      if (hit !== undefined && (wallHit === undefined || hit < wallHit)) wallHit = hit;
    }
    // First enemy on the way (lowest id on a tie).
    const first: { hit: number; enemy: ShooterEnemy | undefined } = { hit: Infinity, enemy: undefined };
    gridQuery(Math.min(x0, x1) - reach, Math.min(y0, y1) - reach, Math.max(x0, x1) + reach, Math.max(y0, y1) + reach, (index) => {
      const enemy = enemies[index]!;
      if (enemy.hp <= 0) return;
      const hit = segmentCircleHit(x0, y0, x1, y1, enemy.x, enemy.y, ENEMY_TYPES[enemy.type].radius + BULLET_RADIUS);
      if (hit === undefined) return;
      if (hit < first.hit || (hit === first.hit && enemy.id < first.enemy!.id)) { first.hit = hit; first.enemy = enemy; }
    });

    // A wall at the same distance wins: the bullet never reaches the enemy.
    if (first.enemy && (wallHit === undefined || first.hit < wallHit)) {
      damageEnemy(state, first.enemy, level.weapon.damage);
      continue; // the bullet is spent
    }
    if (wallHit !== undefined) continue;
    bullet.x = x1; bullet.y = y1;
    bullet.travelled += stride;
    const outside = x1 < FIELD.left || x1 > FIELD.right || y1 < FIELD.top || y1 > FIELD.bottom;
    if (outside || bullet.travelled >= level.weapon.range) continue;
    kept.push(bullet);
  }
  state.bullets = kept;
  state.enemies = enemies.filter((enemy) => enemy.hp > 0);
}
