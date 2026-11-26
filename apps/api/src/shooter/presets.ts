// The numbers behind the words of a brief. The AI picks a word; these tables are
// the only place that word becomes a number.
import { ENEMY_TYPES, type ShooterLevel } from '@game-creator/contracts';
import type { ShooterBrief } from './brief.js';

/** Where the player starts, and how fast it runs (px/s), in every compiled level. */
export const PLAYER_START = { x: 480, y: 305 } as const;
export const PLAYER_SPEED = 210;

/** Player hit points. A touch costs 1 (runner, swarmer) or 2 (brute). */
export const HEALTH_HP: Record<ShooterBrief['playerHealth'], number> = { fragile: 3, normal: 5, sturdy: 8 };

/** Weapon: time between shots (ms), bullet speed (px/s), damage per hit, reach (px). */
export const WEAPONS: Record<ShooterBrief['weapon'], ShooterLevel['weapon']> = {
  pistol: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  rapid: { cooldownMs: 150, bulletSpeed: 650, damage: 1, range: 500 },
  heavy: { cooldownMs: 600, bulletSpeed: 700, damage: 3, range: 700 },
  // Stage 4B. `pellets` bullets in a fan `spreadDeg` wide; `pierce` enemies per bullet. The older weapons have none of these fields.
  // Tuned in docs/shooter-calibration.md (Stage 4B); the first numbers (800 ms and 500 ms / pierce 3) won far more often than
  // the pistol, which the calibration did not allow. The shotgun keeps its 320 px reach on purpose: a spitter holds at 260 px and
  // the bots only fire inside 85% of the reach, so 300 px (255 px for the bot) could not touch a spitter that stood still.
  shotgun: { cooldownMs: 1000, bulletSpeed: 650, damage: 1, range: 320, pellets: 6, spreadDeg: 36 },
  piercing: { cooldownMs: 600, bulletSpeed: 800, damage: 2, range: 800, pierce: 2 },
};

/** The boss's hit points are its kind's own (ENEMY_TYPES) times this, by intensity 1..5 (calibrated: docs/shooter-calibration.md). */
// (starting values 0.6, 0.8, 1, 1.2, 1.4: too hard for the casual bot, see docs/shooter-calibration.md, Stage 4C)
export const BOSS_HP_BY_INTENSITY: number[] = [0.4, 0.45, 0.5, 0.55, 0.6];
/** The `bossHp` of a level: the boss kind's hit points times the factor of the intensity, a whole number from 10 to 400. */
export function bossHpFor(boss: Exclude<ShooterBrief['boss'], 'none'>, intensity: number): number {
  return Math.min(400, Math.max(10, Math.round(ENEMY_TYPES[boss].hp * (BOSS_HP_BY_INTENSITY[intensity - 1] ?? 1))));
}

/** The base of a level that has one (brief `base: 'defend'`): its center is the center of the field, which is where every compiled
 * level starts the player, so the player starts `gap` px away from it, on one of four sides (see compile.ts). The gap is tuned
 * (limits 56..90 px; docs/shooter-calibration.md, Stage 4D); it is an object only so that the calibration script can try others. */
export const BASE_PLAYER = { gap: 64 };
/** The base's hit points by intensity 1..5 (20..200, the schema's maximum). Intensities 1-3 sit at 120; 4 and 5 get more (150, 200) because the
 * dense waves of the top two levels cannot be held by 120 (Stage 4D.1, docs/shooter-calibration.md). */
export const BASE_HP_BY_INTENSITY: number[] = [120, 120, 120, 150, 200];
/** The `base` of a level for a brief of this intensity. */
export const baseFor = (intensity: number) => ({ x: PLAYER_START.x, y: PLAYER_START.y, hp: BASE_HP_BY_INTENSITY[intensity - 1] ?? BASE_HP_BY_INTENSITY[2]! });

/** Chance in percent that a defeated enemy drops a health pickup, by the brief's `healthDrops`. */
export const HEALTH_DROP_PCT: Record<ShooterBrief['healthDrops'], number> = { none: 0, some: 12, many: 25 };

/** Colors per theme. Dark ground with bright player, enemy and bullet: each of
 * those keeps a contrast ratio of at least 3:1 against the background (tested). */
export const THEMES: Record<ShooterBrief['theme'], ShooterLevel['theme']> = {
  'zombie-city': { background: '#121820', wall: '#3b4658', player: '#7bd88f', enemy: '#e5566d', bullet: '#ffd166', accent: '#6c8ba8' },
  'alien-lab': { background: '#0e1a1f', wall: '#2f4a52', player: '#8affc1', enemy: '#c77dff', bullet: '#f5ff7a', accent: '#3ddcd0' },
  'dark-forest': { background: '#0f1a12', wall: '#2f4a33', player: '#d9f99d', enemy: '#ef6f6c', bullet: '#ffe08a', accent: '#5aa469' },
  'desert-ruins': { background: '#2a2118', wall: '#6b5638', player: '#fff1c1', enemy: '#e4572e', bullet: '#8bd3ff', accent: '#d4a24c' },
  'ice-base': { background: '#0f1c2a', wall: '#3d5a78', player: '#e8f6ff', enemy: '#ff6b8b', bullet: '#ffe66d', accent: '#7fc8f8' },
  'neon-arena': { background: '#0a0a14', wall: '#2b2b5c', player: '#00f5d4', enemy: '#ff2e88', bullet: '#fee440', accent: '#9b5de5' },
  hospital: { background: '#14202a', wall: '#4a6272', player: '#9be8d8', enemy: '#ff7a7a', bullet: '#ffe9a0', accent: '#8fb8ca' },
  'military-base': { background: '#141a14', wall: '#3d4a3a', player: '#c9e265', enemy: '#ff7f50', bullet: '#f0e68c', accent: '#8a9a5b' },
};
