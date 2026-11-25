// Small builders shared by the Stage 4B unit tests: a quiet field, and enemies put in by hand.
import {
  ENEMY_TYPES, SHOOTER_LEVELS, createSim, step, type EnemyType, type ShooterInput, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';

export const IDLE_INPUT: ShooterInput = { moveX: 0, moveY: 0, aimX: 960, aimY: 305, fire: false };

/** A quiet field: the player in the middle (480, 305) with plenty of health, one far spawn point, and one
 * enemy scheduled so late that nothing happens unless a test makes it. */
export function quietLevel(patch: Partial<ShooterLevel> = {}): ShooterLevel {
  return {
    ...structuredClone(SHOOTER_LEVELS['smoke-win']),
    player: { x: 480, y: 305, speed: 210, hp: 10 },
    waves: [{ atMs: 590_000, type: 'swarmer', count: 1 }], win: { type: 'survive', seconds: 300 },
    ...patch,
  };
}

export const weaponOf = (patch: Partial<ShooterLevel['weapon']>): ShooterLevel['weapon'] => ({ cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600, ...patch });

/** Puts an enemy straight into the state (a test shortcut; the sim never does this). */
export function place(state: ShooterState, type: EnemyType, x: number, y: number, id = state.nextId + 1000, extra: { nextShotTick?: number } = {}) {
  state.enemies.push({ id, type, x, y, hp: ENEMY_TYPES[type].hp, ...extra });
}

export const fireAt = (x: number, y: number): ShooterInput => ({ moveX: 0, moveY: 0, aimX: x, aimY: y, fire: true });

export function run(state: ShooterState, ticks: number, input: ShooterInput | ((state: ShooterState) => ShooterInput) = IDLE_INPUT) {
  for (let i = 0; i < ticks && state.status === 'playing'; i += 1) step(state, typeof input === 'function' ? input(state) : input);
}

export const newState = (level: ShooterLevel): ShooterState => createSim(level);
