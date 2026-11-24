// The whole shooter, as plain data and plain functions. A renderer reads the
// state and draws it; nothing here knows how. Same level and same inputs give
// the same state, tick for tick: the only randomness is a seeded generator, and
// the physics uses only + - * / and square roots, which every engine rounds the
// same way (trigonometry is used for the drawn `aim` angle only).
//
// This file only orders the steps of a tick. The state and the generator are in
// state.ts, and each step has its own file: player.ts, weapons.ts, spawn.ts,
// enemies.ts, combat.ts (the hash for tests is hash.ts).
import { advanceClock, hurtPlayer } from './combat.js';
import { moveEnemies } from './enemies.js';
import type { Rect } from './geometry.js';
import { aimPlayer, movePlayer } from './player.js';
import { spawnDue } from './spawn.js';
import type { ShooterInput, ShooterState } from './state.js';
import { fireWeapon, flyBullets } from './weapons.js';

/** One tick, in place. Order of work, always the same:
 *  1. a finished game does nothing
 *  2. the player moves (diagonals normalized), slides along walls and edges
 *  3. the aim is updated from the aim point
 *  4. the weapon fires if asked and ready, and the bullet cap allows
 *  5. due enemies spawn (waiting ones stay queued, none is dropped)
 *  6. enemies move (straight at the player in plain sight, else along the flow
 *     field), push each other apart, then leave walls
 *  7. bullets fly; a swept test finds the first enemy or wall on the way
 *  8. one enemy touch hurts the player, unless the player is still protected
 *  9. the clock advances; losing is checked before winning
 */
export function step(state: ShooterState, input: ShooterInput): void {
  if (state.status !== 'playing') return;
  const t = state.tick;
  const walls: readonly Rect[] = state.level.obstacles;

  movePlayer(state, input, walls);
  aimPlayer(state, input);
  fireWeapon(state, input, t);
  spawnDue(state, t);
  moveEnemies(state, t, walls);
  flyBullets(state, walls);
  hurtPlayer(state, t);
  advanceClock(state, t);
}
