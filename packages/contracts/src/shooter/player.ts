// Steps 2 and 3 of a tick: the player moves and aims.
import { PLAYER_RADIUS, TICK_RATE } from './constants.js';
import { resolveCircle, type Rect } from './geometry.js';
import type { ShooterInput, ShooterState } from './state.js';

/** 2. The player moves (diagonals normalized), slides along walls and edges. */
export function movePlayer(state: ShooterState, input: ShooterInput, walls: readonly Rect[]) {
  const { level, player } = state;
  const mx = input.moveX > 0 ? 1 : input.moveX < 0 ? -1 : 0;
  const my = input.moveY > 0 ? 1 : input.moveY < 0 ? -1 : 0;
  if (mx !== 0 || my !== 0) {
    const length = Math.sqrt(mx * mx + my * my);
    const stride = level.player.speed / TICK_RATE;
    player.x += (mx / length) * stride;
    player.y += (my / length) * stride;
  }
  resolveCircle(player, PLAYER_RADIUS, walls);
}

/** 3. The aim is updated from the aim point. `player.aim` (radians) is for drawing only:
 * this is the one place in the shooter core that uses trigonometry. */
export function aimPlayer(state: ShooterState, input: ShooterInput) {
  const { player } = state;
  if (Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) {
    const ax = input.aimX - player.x;
    const ay = input.aimY - player.y;
    const length = Math.sqrt(ax * ax + ay * ay);
    if (length > 1e-9) { state.aimX = ax / length; state.aimY = ay / length; }
    player.aim = Math.atan2(state.aimY, state.aimX);
  }
}
