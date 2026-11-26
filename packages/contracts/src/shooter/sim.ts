// The whole shooter, as plain data and plain functions. A renderer reads the
// state and draws it; nothing here knows how. Same level and same inputs give
// the same state, tick for tick: the only randomness is a seeded generator, and
// the physics uses only + - * / and square roots, which every engine rounds the
// same way (trigonometry is used for the drawn `aim` angle only).
//
// This file only orders the steps of a tick. The state and the generator are in
// state.ts, and each step has its own file: player.ts, weapons.ts, spawn.ts,
// enemies.ts, enemy-fire.ts, boss.ts, bullets.ts, pickups.ts, combat.ts (the hash for tests is hash.ts).
import { hurtBase } from './base.js';
import { advanceClock, hurtPlayer } from './combat.js';
import { bossesFire } from './boss.js';
import { enemiesShoot, flyEnemyBullets } from './enemy-fire.js';
import { moveEnemies } from './enemies.js';
import type { Rect } from './geometry.js';
import { aimPlayer, movePlayer } from './player.js';
import { collectPickups } from './pickups.js';
import { spawnDue } from './spawn.js';
import type { ShooterInput, ShooterState } from './state.js';
import { flyBullets } from './bullets.js';
import { fireWeapon } from './weapons.js';

/** One tick, in place. Order of work, always the same:
 *  1. a finished game does nothing
 *  2. the player moves (diagonals normalized), slides along walls and edges
 *  3. the aim is updated from the aim point
 *  4. the weapon fires if asked and ready, and the bullet cap allows
 *  5. due enemies spawn (waiting ones stay queued, none is dropped)
 *  6. enemies move (straight at the player in plain sight, else along the flow
 *     field; a shooting enemy stops within its hold range), push each other apart, then leave walls
 *     6b. shooting enemies fire at the player (in plain sight, in range, on their turn); a boss fires its volleys
 *  7. the player's bullets fly; a swept test finds the first enemy or wall on the way
 *     (a piercing bullet goes on through several enemies)
 *     7b. enemy bullets fly: a wall stops them; they hurt the player unless it is still protected
 *     7c. health pickups: expired ones go, the player takes one by touching it when hurt
 *  8. one enemy touch hurts the player, unless the player is still protected
 *     8b. the enemies that touch the base hurt it (all of them together, once every 500 ms); it is a wall like the obstacles,
 *         and enemies that go for it walk to it by a field of their own (base.ts)
 *  9. the clock advances; losing is checked before winning (the player's hit points, or the base's)
 */
export function step(state: ShooterState, input: ShooterInput): void {
  if (state.status !== 'playing') return;
  const t = state.tick;
  const walls: readonly Rect[] = state.walls;

  movePlayer(state, input, walls);
  aimPlayer(state, input);
  fireWeapon(state, input, t);
  spawnDue(state, t);
  moveEnemies(state, t, walls);
  enemiesShoot(state, t);
  bossesFire(state, t, walls);
  flyBullets(state, walls);
  flyEnemyBullets(state, t, walls);
  collectPickups(state, t);
  hurtPlayer(state, t);
  hurtBase(state, t);
  advanceClock(state, t);
}
