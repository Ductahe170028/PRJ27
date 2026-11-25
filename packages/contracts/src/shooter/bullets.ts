// Step 7 of a tick: the player's bullets fly and hit. A swept test finds what is on the way.
import { BULLET_RADIUS, ENEMY_TYPES, FIELD, MAX_ENEMY_RADIUS, TICK_RATE } from './constants.js';
import { damageEnemy } from './combat.js';
import { segmentCircleHit, segmentRectHit, type Rect } from './geometry.js';
import { buildGrid, gridQuery } from './grid.js';
import type { ShooterBullet, ShooterEnemy, ShooterState } from './state.js';

const REACH = MAX_ENEMY_RADIUS + BULLET_RADIUS;

/** 7. Bullets fly; a swept test finds the first enemy or wall on the way. A bullet of a piercing weapon
 * goes on through up to `pierce` enemies, nearest first (lowest id on a tie), hitting each only once. */
export function flyBullets(state: ShooterState, walls: readonly Rect[]) {
  const { level, enemies } = state;
  if (state.bullets.length === 0) return;
  buildGrid(enemies);
  const kept: ShooterBullet[] = [];
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
    if (bullet.pierceLeft !== undefined) {
      if (passThrough(state, bullet, x0, y0, x1, y1, wallHit)) continue; // spent
    } else {
      // First enemy on the way (lowest id on a tie).
      const first: { hit: number; enemy: ShooterEnemy | undefined } = { hit: Infinity, enemy: undefined };
      gridQuery(Math.min(x0, x1) - REACH, Math.min(y0, y1) - REACH, Math.max(x0, x1) + REACH, Math.max(y0, y1) + REACH, (index) => {
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
    }
    bullet.x = x1; bullet.y = y1;
    bullet.travelled += stride;
    const outside = x1 < FIELD.left || x1 > FIELD.right || y1 < FIELD.top || y1 > FIELD.bottom;
    if (outside || bullet.travelled >= level.weapon.range) continue;
    kept.push(bullet);
  }
  state.bullets = kept;
  state.enemies = enemies.filter((enemy) => enemy.hp > 0);
}

/** A piercing bullet's tick: hits every enemy not yet hit along the segment, nearest first, until a wall
 * (a wall at the same distance wins) or until it has passed through all it may. True when it is spent. */
function passThrough(state: ShooterState, bullet: ShooterBullet, x0: number, y0: number, x1: number, y1: number, wallHit: number | undefined): boolean {
  const { enemies } = state;
  const hitIds = bullet.hitIds!;
  const hits: Array<{ t: number; enemy: ShooterEnemy }> = [];
  gridQuery(Math.min(x0, x1) - REACH, Math.min(y0, y1) - REACH, Math.max(x0, x1) + REACH, Math.max(y0, y1) + REACH, (index) => {
    const enemy = enemies[index]!;
    if (enemy.hp <= 0 || hitIds.includes(enemy.id)) return;
    const t = segmentCircleHit(x0, y0, x1, y1, enemy.x, enemy.y, ENEMY_TYPES[enemy.type].radius + BULLET_RADIUS);
    if (t !== undefined) hits.push({ t, enemy });
  });
  hits.sort((a, b) => a.t - b.t || a.enemy.id - b.enemy.id);
  for (const { t, enemy } of hits) {
    if (wallHit !== undefined && t >= wallHit) return true;
    damageEnemy(state, enemy, state.level.weapon.damage);
    hitIds.push(enemy.id);
    bullet.pierceLeft! -= 1;
    if (bullet.pierceLeft! <= 0) return true;
  }
  return wallHit !== undefined;
}
