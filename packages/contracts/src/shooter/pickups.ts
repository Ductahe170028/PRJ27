// Health pickups: some defeated enemies drop one, the player takes it by touching it. The drop is a pure
// function of the level seed and the enemy's id: it never uses the game's random generator, so a level
// with drops plays out exactly like the same level without them.
import { MAX_PICKUPS, PICKUP_LIFETIME_TICKS, PICKUP_RADIUS, PLAYER_RADIUS } from './constants.js';
import type { ShooterEnemy, ShooterState } from './state.js';

/** 0..99 from `seed` and `id`: a 32-bit integer hash (multiply, shift, xor), the same on every engine. */
export function dropRoll(seed: number, id: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(id + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) % 100;
}

/** Called when an enemy has just been defeated: it may leave a pickup where it died (at most MAX_PICKUPS on the field). */
export function maybeDropHealth(state: ShooterState, enemy: ShooterEnemy) {
  const chance = state.level.drops?.healthChancePct ?? 0;
  if (chance <= 0 || state.pickups.length >= MAX_PICKUPS || dropRoll(state.level.seed, enemy.id) >= chance) return;
  state.pickups.push({ id: state.nextId, x: enemy.x, y: enemy.y, expiresTick: state.tick + PICKUP_LIFETIME_TICKS });
  state.nextId += 1;
}

/** Step 7c. Expired pickups go. A pickup the player touches gives 1 hit point (never above the maximum) and
 * goes; with full health it is left where it is until it expires. Healing does not change the protection time. */
export function collectPickups(state: ShooterState, t: number) {
  if (state.pickups.length === 0) return;
  const { player } = state;
  const reach = PLAYER_RADIUS + PICKUP_RADIUS;
  state.pickups = state.pickups.filter((pickup) => {
    if (t >= pickup.expiresTick) return false;
    const dx = pickup.x - player.x;
    const dy = pickup.y - player.y;
    if (dx * dx + dy * dy < reach * reach && player.hp < player.maxHp) { player.hp += 1; return false; }
    return true;
  });
}
