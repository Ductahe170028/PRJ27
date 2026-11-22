// The numbers behind the words of a brief. The AI picks a word; these tables are
// the only place that word becomes a number.
import type { ShooterLevel } from '@game-creator/contracts';
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
};

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
