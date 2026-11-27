// Step 4 of a tick: the weapon fires. The numbers (cooldown, speed, damage, range and the optional
// pellets, spread and pierce) come from `level.weapon` (or, in a level with an arsenal, the weapon in hand), never from a weapon's name.
import { BULLET_RADIUS, MAX_BULLETS, PLAYER_RADIUS, msToTicks } from './constants.js';
import { activeWeapon } from './equip.js';
import { RADIANS_PER_DEGREE, tanSmall } from './geometry.js';
import type { ShooterBullet, ShooterInput, ShooterState } from './state.js';

/** 4. The weapon fires if asked and ready, and the bullet cap allows (a shot of several pellets needs
 * room for all of them). `pellets` bullets leave in a fan `spreadDeg` wide, evenly spaced and symmetric
 * around the aim; one pellet goes exactly along the aim. Each bullet has its own id, in order. */
export function fireWeapon(state: ShooterState, input: ShooterInput, t: number) {
  const { level, player } = state;
  const weapon = state.weaponSlot === undefined ? level.weapon : activeWeapon(state);
  const pellets = weapon.pellets ?? 1;
  // (`equipUntilTick` only exists in a level with an arsenal: elsewhere it is 0 and this line is what it always was)
  if (!input.fire || t < player.nextShotTick || t < (state.equipUntilTick ?? 0) || state.bullets.length + pellets > MAX_BULLETS) return;
  const reach = PLAYER_RADIUS + BULLET_RADIUS + 1;
  const x = player.x + state.aimX * reach;
  const y = player.y + state.aimY * reach;
  const pierce = weapon.pierce ?? 1;
  const tanHalf = pellets > 1 ? tanSmall(((weapon.spreadDeg ?? 0) / 2) * RADIANS_PER_DEGREE) : 0;
  for (let k = 0; k < pellets; k += 1) {
    let dx = state.aimX;
    let dy = state.aimY;
    if (pellets > 1) {
      // aim + perpendicular(aim) * side, made a unit vector again with one square root
      const side = tanHalf * ((2 * k) / (pellets - 1) - 1);
      const sx = state.aimX - state.aimY * side;
      const sy = state.aimY + state.aimX * side;
      const length = Math.sqrt(sx * sx + sy * sy);
      dx = sx / length;
      dy = sy / length;
    }
    const bullet: ShooterBullet = { id: state.nextId, x, y, vx: dx * weapon.bulletSpeed, vy: dy * weapon.bulletSpeed, travelled: 0 };
    if (pierce > 1) { bullet.pierceLeft = pierce; bullet.hitIds = []; }
    // A bullet keeps the numbers of the weapon that fired it (only in a level with an arsenal, where the player can switch in flight).
    if (state.weaponSlot !== undefined) { bullet.damage = weapon.damage; bullet.range = weapon.range; }
    state.bullets.push(bullet);
    state.nextId += 1;
  }
  player.nextShotTick = t + msToTicks(weapon.cooldownMs);
}
