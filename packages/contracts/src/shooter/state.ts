// What a game IS at any moment: the state, the input and the seeded generator.
// Nothing here moves anything; the steps of a tick live in the files next to this one.
import { NAV_INFLATE, SPAWN_STAGGER_MS, TICK_RATE, msToTicks, type EnemyType } from './constants.js';
import type { ShooterLevel } from './level.js';
import { blockedCells, type FlowField } from './navigation.js';

export interface ShooterInput {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  /** Aim point in world coordinates. */
  aimX: number;
  aimY: number;
  fire: boolean;
}

export interface ShooterEnemy { id: number; type: EnemyType; x: number; y: number; hp: number }
/** vx, vy are in px per second. */
export interface ShooterBullet { id: number; x: number; y: number; vx: number; vy: number; travelled: number }

export interface ShooterState {
  tick: number;
  status: 'playing' | 'won' | 'lost';
  kills: number;
  score: number;
  player: {
    x: number; y: number; hp: number; maxHp: number;
    invulnerableUntilTick: number; nextShotTick: number;
    /** Radians, for drawing only. */
    aim: number;
  };
  enemies: ShooterEnemy[];
  bullets: ShooterBullet[];
  // --- internal, but plain data so the state can be cloned and resumed ---
  level: ShooterLevel;
  rng: number;
  nextId: number;
  /** Every enemy of the level in spawn order; `spawned` is how many are out. */
  schedule: Array<{ tick: number; type: EnemyType }>;
  spawned: number;
  /** Unit vector of the last aim; used for firing. */
  aimX: number;
  aimY: number;
  blocked: boolean[];
  flow: FlowField | undefined;
}

export const totalScheduledEnemies = (level: ShooterLevel) => level.waves.reduce((sum, wave) => sum + wave.count, 0);
export const elapsedSeconds = (state: ShooterState) => state.tick / TICK_RATE;

export function createSim(level: ShooterLevel): ShooterState {
  const entries: Array<{ tick: number; type: EnemyType; order: number }> = [];
  for (const wave of level.waves) {
    for (let k = 0; k < wave.count; k += 1) {
      entries.push({ tick: msToTicks(wave.atMs + k * SPAWN_STAGGER_MS), type: wave.type, order: entries.length });
    }
  }
  entries.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return {
    tick: 0, status: 'playing', kills: 0, score: 0,
    player: {
      x: level.player.x, y: level.player.y, hp: level.player.hp, maxHp: level.player.hp,
      invulnerableUntilTick: 0, nextShotTick: 0, aim: 0,
    },
    enemies: [], bullets: [],
    level, rng: level.seed | 0, nextId: 1,
    schedule: entries.map(({ tick, type }) => ({ tick, type })), spawned: 0,
    aimX: 1, aimY: 0,
    blocked: blockedCells(level.obstacles, NAV_INFLATE), flow: undefined,
  };
}

/** mulberry32: one number in [0,1) per call. */
export function random(state: ShooterState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
