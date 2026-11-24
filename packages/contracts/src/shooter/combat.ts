// What hurts what, and how a game ends: steps 8 and 9 of a tick, and the damage an enemy takes.
import { ENEMY_TYPES, INVULNERABLE_MS, PLAYER_RADIUS, TICK_RATE, msToTicks } from './constants.js';
import type { ShooterEnemy, ShooterState } from './state.js';

/** An enemy takes `amount`; at zero hit points it counts as a kill and scores. It leaves the
 * field when the bullet step has finished (enemies with hp <= 0 are filtered out there). */
export function damageEnemy(state: ShooterState, enemy: ShooterEnemy, amount: number) {
  enemy.hp -= amount;
  if (enemy.hp <= 0) { state.kills += 1; state.score += ENEMY_TYPES[enemy.type].points; }
}

/** 8. One enemy touch hurts the player (the worst one of the tick), unless the player is still protected. */
export function hurtPlayer(state: ShooterState, t: number) {
  const { player } = state;
  if (t < player.invulnerableUntilTick) return;
  let damage = 0;
  for (const enemy of state.enemies) {
    const kind = ENEMY_TYPES[enemy.type];
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const touch = PLAYER_RADIUS + kind.radius;
    if (dx * dx + dy * dy < touch * touch && kind.damage > damage) damage = kind.damage;
  }
  if (damage === 0) return;
  player.hp = Math.max(0, player.hp - damage);
  player.invulnerableUntilTick = t + msToTicks(INVULNERABLE_MS);
}

/** 9. The clock advances; losing is checked before winning. */
export function advanceClock(state: ShooterState, t: number) {
  const { level, player } = state;
  state.tick = t + 1;
  if (player.hp <= 0) state.status = 'lost';
  else if (level.win.type === 'survive' ? state.tick >= level.win.seconds * TICK_RATE : state.kills >= level.win.count) state.status = 'won';
}
