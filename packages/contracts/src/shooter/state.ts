// What a game IS at any moment: the state, the input and the seeded generator.
// Nothing here moves anything; the steps of a tick live in the files next to this one.
import { ENEMY_TYPES, MAX_ENEMY_RADIUS, NAV_INFLATE, SPAWN_STAGGER_MS, TICK_RATE, msToTicks, type EnemyType } from './constants.js';
import { createBase } from './base.js';
import { startingSlot } from './equip.js';
import { baseRectOf, type Rect } from './geometry.js';
import { bossWaveOf, type ShooterLevel } from './level.js';
import { blockedCells, bossBlockedCells, type FlowField } from './navigation.js';

export interface ShooterInput {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  /** Aim point in world coordinates. */
  aimX: number;
  aimY: number;
  fire: boolean;
  /** Put the weapon of this arsenal slot (0 to 4) in hand. Optional: absent changes nothing. An invalid slot, or any slot in a level
   * without an arsenal, is ignored (never an error). */
  slot?: number | undefined;
}

/** `nextShotTick` only exists on enemies that shoot (a `ranged` kind). The other optional fields only exist on a boss:
 * its maximum hit points, what it is doing (`bossPhase`, until `phaseUntilTick`), the direction of its rush, the tick
 * of its next rush, and the tick of the next time of each of its volleys. */
export interface ShooterEnemy {
  id: number; type: EnemyType; x: number; y: number; hp: number; nextShotTick?: number;
  maxHp?: number; bossPhase?: 'move' | 'telegraph' | 'charge'; phaseUntilTick?: number; chargeDx?: number; chargeDy?: number;
  nextChargeTick?: number; volleyTicks?: number[];
  /** Only in a level with a base, and not on a boss: whether this enemy is going for the base (true) or for the player (false). */
  aimAtBase?: boolean;
}

/** The base of a level that has one: where it stands, its hit points, when the next touch may hurt it, and when it was last hit. */
export interface BaseState { x: number; y: number; hp: number; maxHp: number; nextHitTick: number; lastHitTick: number }
/** vx, vy are in px per second. `pierceLeft` and `hitIds` only exist on bullets of a piercing weapon:
 * how many more enemies it may pass through, and the enemies it has already hit (never twice). */
export interface ShooterBullet {
  id: number; x: number; y: number; vx: number; vy: number; travelled: number; pierceLeft?: number; hitIds?: number[];
  /** Only in a level with an arsenal: the damage and range of the weapon that FIRED this bullet (the player may have switched since). */
  damage?: number; range?: number;
}

/** A bullet shot by an enemy. vx, vy are in px per second; `range` is how far it flies before it vanishes. */
export interface EnemyBullet { id: number; x: number; y: number; vx: number; vy: number; travelled: number; damage: number; radius: number; range: number }
/** A health pickup dropped by an enemy; it vanishes at `expiresTick`. */
export interface Pickup { id: number; x: number; y: number; expiresTick: number }

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
  /** Bullets of shooting enemies and health pickups: empty in every level without such enemies or `drops`. */
  enemyBullets: EnemyBullet[];
  pickups: Pickup[];
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
  /** The largest enemy radius of THIS level (20, or the boss's when the level has one): it sizes the spatial queries. */
  maxEnemyRadius: number;
  /** Only in a level with a boss: where its entry is in `schedule`, whether it is out, and whether it has been defeated. */
  bossIndex?: number;
  bossSpawned?: boolean;
  bossDown?: boolean;
  /** Only in a level with a boss: the grid the boss walks on (see bossBlockedCells) and its flow field. */
  bossBlocked?: boolean[];
  bossFlow?: FlowField;
  /** What the player, the enemies, the bullets and the lines of sight cannot pass: the level's obstacles (the very same array
   * when there is no base) and, last, the base's square. */
  walls: readonly Rect[];
  /** Only in a level with a base: its state, its square (the last of `walls`), the field enemies walk on towards it, and who
   * lost the game (`'base'` when it was destroyed, `'player'` when the player fell, also when both on one tick). */
  base?: BaseState;
  baseRect?: Rect;
  baseFlow?: { blocked: boolean[]; dist: number[] };
  lostBy?: 'player' | 'base';
  /** Only in a level with an `arsenal`: the slot of the weapon in hand, and the tick until which the player is switching (cannot fire). */
  weaponSlot?: number;
  equipUntilTick?: number;
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
  const bossWave = bossWaveOf(level);
  const bossIndex = bossWave ? entries.findIndex((entry) => entry.type === bossWave.type) : -1;
  const square = level.base ? baseRectOf(level.base) : undefined;
  const walls = square ? [...level.obstacles, square] : level.obstacles;
  return {
    tick: 0, status: 'playing', kills: 0, score: 0,
    player: {
      x: level.player.x, y: level.player.y, hp: level.player.hp, maxHp: level.player.hp,
      invulnerableUntilTick: 0, nextShotTick: 0, aim: 0,
    },
    enemies: [], bullets: [], enemyBullets: [], pickups: [],
    level, rng: level.seed | 0, nextId: 1,
    schedule: entries.map(({ tick, type }) => ({ tick, type })), spawned: 0,
    aimX: 1, aimY: 0,
    blocked: blockedCells(walls, NAV_INFLATE), flow: undefined, walls,
    maxEnemyRadius: bossWave ? Math.max(MAX_ENEMY_RADIUS, ENEMY_TYPES[bossWave.type].radius) : MAX_ENEMY_RADIUS,
    ...(bossWave && bossIndex >= 0 ? { bossIndex, bossSpawned: false, bossDown: false, bossBlocked: bossBlockedCells(walls, ENEMY_TYPES[bossWave.type].radius) } : {}),
    ...(square ? createBase(level, square) : {}),
    ...(level.arsenal ? { weaponSlot: startingSlot(level), equipUntilTick: 0 } : {}),
  };
}

/** mulberry32: one number in [0,1) per call. */
export function random(state: ShooterState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
