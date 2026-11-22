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

export const ENEMY_TYPES = {
  /** Fast and thin. */
  runner: { radius: 11, speed: 135, hp: 2, damage: 1, points: 2 },
  /** Slow and tough. */
  brute: { radius: 20, speed: 50, hp: 12, damage: 2, points: 5 },
  /** Small and weak; comes in swarms. */
  swarmer: { radius: 9, speed: 95, hp: 1, damage: 1, points: 1 },
} as const;

export type EnemyType = keyof typeof ENEMY_TYPES;
export const ENEMY_TYPE_NAMES = ['runner', 'brute', 'swarmer'] as const satisfies readonly EnemyType[];

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
