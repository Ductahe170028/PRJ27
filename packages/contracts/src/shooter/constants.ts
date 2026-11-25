// Fixed numbers of the shooter simulation. Pure data: no engine, no DOM.

/** Simulation steps per second. One `step` call is exactly 1/60 s. */
export const TICK_RATE = 60;

/** Play field in world pixels. y < 70 is the HUD bar. */
export const FIELD = { left: 0, right: 960, top: 70, bottom: 540 } as const;

/** Player body radius (px). */
export const PLAYER_RADIUS = 14;
/** Bullet radius (px). Bullets are swept, so speed never skips a target. */
export const BULLET_RADIUS = 4;
/** After a hit the player cannot be hurt again for this long (ms). */
export const INVULNERABLE_MS = 700;
/** Enemies alive at once. A spawn over the cap waits; it is never lost. */
export const MAX_ENEMIES_ALIVE = 120;
/** Bullets alive at once. Firing is refused while the cap is reached. */
export const MAX_BULLETS = 200;
/** Delay between two enemies of the same wave (ms). */
export const SPAWN_STAGGER_MS = 150;
/** A spawn point closer to the player than this is skipped when another exists (px). */
export const SPAWN_MIN_PLAYER_DISTANCE = 250;
/** Schema: a spawn point must be at least this far from the player (px). */
export const SPAWN_SAFE_DISTANCE = 200;
/** Schema: player and spawn points keep this distance from the field edge (px). */
export const EDGE_MARGIN = 20;
/** Schema: player and spawn points keep this distance from every obstacle (px). */
export const OBSTACLE_MARGIN = 24;
/** Most enemies one level may schedule. */
export const MAX_SCHEDULED_ENEMIES = 400;

/** One row per enemy kind: everything the simulation knows about a kind is here, so a new kind is one more
 * row (plus its name in ENEMY_TYPE_NAMES). `code` is a small number that only the state hash uses; keep
 * the codes of existing kinds as they are, or every recorded hash changes. */
export const ENEMY_TYPES = {
  /** Fast and thin. */
  runner: { code: 1, radius: 11, speed: 135, hp: 2, damage: 1, points: 2 },
  /** Slow and tough. */
  brute: { code: 2, radius: 20, speed: 50, hp: 12, damage: 2, points: 5 },
  /** Small and weak; comes in swarms. */
  swarmer: { code: 3, radius: 9, speed: 95, hp: 1, damage: 1, points: 1 },
  /** Stands back and shoots slow bullets (the player can dodge them). Touching it still hurts. */
  spitter: {
    code: 4, radius: 12, speed: 70, hp: 3, damage: 1, points: 4,
    // Starting values were cooldown 1800 ms and bullet speed 230: with them the casual bot lost every game against
    // spitters. Tuned in docs/shooter-calibration.md (Stage 4B) to the slowest and rarest the limits allow.
    ranged: { holdRange: 260, sightRange: 460, cooldownMs: 2400, bulletSpeed: 180, bulletDamage: 1, bulletRadius: 5 },
  },
} as const;

export type EnemyType = keyof typeof ENEMY_TYPES;
export const ENEMY_TYPE_NAMES = ['runner', 'brute', 'swarmer', 'spitter'] as const satisfies readonly EnemyType[];

/** How a shooting enemy behaves, as data. Only some kinds have it (the older ones do not). Distances in px,
 * bullet speed in px/s: it stops advancing once it is within `holdRange` of the player in plain sight, fires
 * only inside `sightRange` and in plain sight, one bullet every `cooldownMs` straight at where the player is. */
export interface RangedSpec { holdRange: number; sightRange: number; cooldownMs: number; bulletSpeed: number; bulletDamage: number; bulletRadius: number }
interface EnemySpec { code: number; radius: number; speed: number; hp: number; damage: number; points: number; ranged?: RangedSpec }
/** The shooting data of a kind, or undefined when it does not shoot. */
export function rangedOf(type: EnemyType): RangedSpec | undefined {
  const spec: EnemySpec = ENEMY_TYPES[type];
  return spec.ranged;
}

/** Enemy bullets alive at once; a shot over the cap is not fired. */
export const MAX_ENEMY_BULLETS = 60;
/** Health pickups on the field at once; a drop over the cap does not appear. */
export const MAX_PICKUPS = 3;
/** A pickup stays this long (ticks), then vanishes. */
export const PICKUP_LIFETIME_TICKS = 600;
/** Pickup reach: the player takes it when closer than PLAYER_RADIUS + this (px). */
export const PICKUP_RADIUS = 10;
/** An enemy bullet flies this many times its owner's sight range before it vanishes. */
export const ENEMY_BULLET_RANGE_FACTOR = 1.3;

/** Largest enemy radius, used to size spatial queries. */
export const MAX_ENEMY_RADIUS = 20;

/** Flow-field grid cell size (px). */
export const NAV_CELL = 20;
/** Obstacles are grown by this much before a cell counts as blocked (px). */
export const NAV_INFLATE = 12;
/** The flow field is rebuilt at least this often (ticks). */
export const NAV_REFRESH_TICKS = 20;
/** Clearance the hand-made levels must give (2 brute radii plus slack, px). */
export const BRUTE_CLEARANCE = 2 * NAV_CELL + 8;

/** Whole ticks in `ms` milliseconds, rounded up. */
export const msToTicks = (ms: number) => Math.ceil((ms * TICK_RATE) / 1000);
