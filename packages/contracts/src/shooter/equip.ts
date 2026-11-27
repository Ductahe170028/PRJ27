// Step 3b of a tick: the player may switch weapons. Only a level with an `arsenal` has this: its state carries the slot in hand
// (`weaponSlot`) and the tick until which the player is busy switching (`equipUntilTick`). A level without an `arsenal` has neither,
// ignores `input.slot`, and plays exactly as it always did with its one `level.weapon`. Nothing here is random.
import { EQUIP_MS, msToTicks } from './constants.js';
import type { ShooterLevel } from './level.js';
import type { ShooterInput, ShooterState } from './state.js';

type Weapon = ShooterLevel['weapon'];

/** Whether two weapons are the same, field by field (a field that is missing in one must be missing in the other). */
export function sameWeapon(a: Weapon, b: Weapon): boolean {
  return a.cooldownMs === b.cooldownMs && a.bulletSpeed === b.bulletSpeed && a.damage === b.damage && a.range === b.range
    && a.pellets === b.pellets && a.spreadDeg === b.spreadDeg && a.pierce === b.pierce;
}

/** The slot of the weapon the player starts with: the arsenal entry that is exactly `level.weapon` (the schema guarantees there is one). */
export function startingSlot(level: Pick<ShooterLevel, 'weapon' | 'arsenal'>): number {
  const index = (level.arsenal ?? []).findIndex((entry) => sameWeapon(entry.weapon, level.weapon));
  return index < 0 ? 0 : index;
}

/** A slot the input may ask for: a whole number from 0 to the last slot of the arsenal. Anything else (a fraction, a negative number,
 * NaN, infinity, a string passed off as a number) is not one. */
export const isSlot = (slot: unknown, count: number): slot is number => typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < count;

/** The weapon in the player's hands: the slot's weapon in a level with an arsenal, else the level's one weapon. */
export function activeWeapon(state: ShooterState): Weapon {
  const { level, weaponSlot } = state;
  return weaponSlot !== undefined && level.arsenal ? level.arsenal[weaponSlot]!.weapon : level.weapon;
}

/** 3b. Asking for another slot puts it in hand at once, and the player cannot fire for EQUIP_MS. The shot clock (`nextShotTick`) is
 * not touched: switching never makes the next shot come sooner. A request for the slot already in hand, or an invalid one, does nothing. */
export function equipWeapon(state: ShooterState, input: ShooterInput, t: number): void {
  const { arsenal } = state.level;
  if (!arsenal || state.weaponSlot === undefined || !isSlot(input.slot, arsenal.length) || input.slot === state.weaponSlot) return;
  state.weaponSlot = input.slot;
  state.equipUntilTick = t + msToTicks(EQUIP_MS);
}
