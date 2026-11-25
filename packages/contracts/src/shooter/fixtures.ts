// Hand-made levels. Stage 2 will compile levels of the same shape from a brief;
// until then these are the games. Shared by the web playground and the tests.
import type { ShooterLevel } from './level.js';

const theme = {
  background: '#0d1520', wall: '#3a4a63', player: '#c5f277', enemy: '#f27b91', bullet: '#ffd46b', accent: '#75c9cc',
} as const;

const edgeSpawns = [
  { x: 40, y: 110 }, { x: 920, y: 110 }, { x: 40, y: 500 }, { x: 920, y: 500 }, { x: 480, y: 100 }, { x: 480, y: 510 },
];

/** Empty arena. Survive 60 s against eight waves; one brute at 40 s. */
const arena: ShooterLevel = {
  kind: 'shooter-v1', title: 'Đấu trường', seed: 1101, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 5 },
  weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  obstacles: [],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 3000, type: 'swarmer', count: 8 },
    { atMs: 8000, type: 'runner', count: 6 },
    { atMs: 14000, type: 'swarmer', count: 14 },
    { atMs: 20000, type: 'runner', count: 10 },
    { atMs: 27000, type: 'swarmer', count: 18 },
    { atMs: 33000, type: 'runner', count: 12 },
    { atMs: 40000, type: 'brute', count: 1 },
    { atMs: 46000, type: 'swarmer', count: 20 },
    { atMs: 52000, type: 'runner', count: 14 },
  ],
  win: { type: 'survive', seconds: 60 },
};

/** Four square pillars to hide behind. Kill 50 of 65. */
const pillars: ShooterLevel = {
  kind: 'shooter-v1', title: 'Cột đá', seed: 2202, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 6 },
  weapon: { cooldownMs: 280, bulletSpeed: 600, damage: 1, range: 650 },
  obstacles: [
    { x: 300, y: 210, width: 60, height: 60 }, { x: 660, y: 210, width: 60, height: 60 },
    { x: 300, y: 400, width: 60, height: 60 }, { x: 660, y: 400, width: 60, height: 60 },
  ],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 2000, type: 'swarmer', count: 10 },
    { atMs: 5000, type: 'runner', count: 6 },
    { atMs: 9000, type: 'swarmer', count: 14 },
    { atMs: 13000, type: 'runner', count: 8 },
    { atMs: 17000, type: 'brute', count: 1 },
    { atMs: 20000, type: 'swarmer', count: 16 },
    { atMs: 25000, type: 'runner', count: 10 },
  ],
  win: { type: 'kill', count: 50 },
};

/** A long wall splits the arena; the way round is 110 px wide at each end. */
const wall: ShooterLevel = {
  kind: 'shooter-v1', title: 'Bức tường', seed: 3303, width: 960, height: 540, theme,
  player: { x: 200, y: 305, speed: 210, hp: 5 },
  weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  obstacles: [{ x: 480, y: 305, width: 40, height: 250 }],
  spawnPoints: [{ x: 880, y: 110 }, { x: 880, y: 305 }, { x: 880, y: 500 }],
  waves: [
    { atMs: 2000, type: 'swarmer', count: 10 },
    { atMs: 7000, type: 'runner', count: 6 },
    { atMs: 12000, type: 'swarmer', count: 14 },
    { atMs: 17000, type: 'runner', count: 8 },
    { atMs: 22000, type: 'brute', count: 1 },
    { atMs: 24000, type: 'swarmer', count: 12 },
  ],
  win: { type: 'kill', count: 40 },
};

/** Survive 10 s with no input: one slow swarmer from far away. */
const smokeWin: ShooterLevel = {
  kind: 'shooter-v1', title: 'Thử thắng', seed: 4404, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 200, hp: 10 },
  weapon: { cooldownMs: 300, bulletSpeed: 500, damage: 1, range: 500 },
  obstacles: [],
  spawnPoints: [{ x: 900, y: 500 }],
  waves: [{ atMs: 2000, type: 'swarmer', count: 1 }],
  win: { type: 'survive', seconds: 10 },
};

/** One life and a runner just over 200 px away: lost within about two seconds. */
const smokeLose: ShooterLevel = {
  kind: 'shooter-v1', title: 'Thử thua', seed: 5505, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 200, hp: 1 },
  weapon: { cooldownMs: 300, bulletSpeed: 500, damage: 1, range: 500 },
  obstacles: [],
  spawnPoints: [{ x: 480, y: 100 }],
  waves: [{ atMs: 500, type: 'runner', count: 1 }],
  win: { type: 'survive', seconds: 30 },
};

/** Stage 4B: the shotgun (six pellets in a 36 degree fan, 320 px reach) against crowds of swarmers. Survive 45 s. */
const shotgunPit: ShooterLevel = {
  kind: 'shooter-v1', title: 'Hố shotgun', seed: 6606, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 5 },
  weapon: { cooldownMs: 1000, bulletSpeed: 650, damage: 1, range: 320, pellets: 6, spreadDeg: 36 },
  obstacles: [],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 2000, type: 'swarmer', count: 8 },
    { atMs: 7000, type: 'swarmer', count: 10 },
    { atMs: 12000, type: 'swarmer', count: 12 },
    { atMs: 17000, type: 'runner', count: 3 },
    { atMs: 22000, type: 'swarmer', count: 14 },
    { atMs: 28000, type: 'swarmer', count: 14 },
    { atMs: 34000, type: 'runner', count: 4 },
    { atMs: 38000, type: 'swarmer', count: 10 },
  ],
  win: { type: 'survive', seconds: 45 },
};

/** Stage 4B: spitters stand back and shoot slow bullets; four pillars to hide behind. Survive 50 s. */
const spitters: ShooterLevel = {
  kind: 'shooter-v1', title: 'Quái bắn xa', seed: 7707, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 6 },
  weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  obstacles: [
    { x: 300, y: 210, width: 70, height: 70 }, { x: 660, y: 210, width: 70, height: 70 },
    { x: 300, y: 400, width: 70, height: 70 }, { x: 660, y: 400, width: 70, height: 70 },
  ],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 500, type: 'spitter', count: 2 },
    { atMs: 4000, type: 'runner', count: 4 },
    { atMs: 9000, type: 'spitter', count: 2 },
    { atMs: 14000, type: 'swarmer', count: 8 },
    { atMs: 20000, type: 'spitter', count: 2 },
    { atMs: 26000, type: 'runner', count: 6 },
    { atMs: 32000, type: 'spitter', count: 2 },
  ],
  win: { type: 'survive', seconds: 50 },
};

/** Stage 4B: one defeated enemy in four drops a health pickup (1 hit point, gone after 10 s). Survive 40 s. */
const medic: ShooterLevel = {
  kind: 'shooter-v1', title: 'Hộp máu', seed: 8808, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 8 },
  weapon: { cooldownMs: 200, bulletSpeed: 650, damage: 1, range: 550 },
  obstacles: [],
  spawnPoints: edgeSpawns,
  drops: { healthChancePct: 25 },
  waves: [
    { atMs: 3000, type: 'swarmer', count: 8 },
    { atMs: 8000, type: 'swarmer', count: 12 },
    { atMs: 13000, type: 'runner', count: 4 },
    { atMs: 17000, type: 'swarmer', count: 14 },
    { atMs: 23000, type: 'runner', count: 6 },
    { atMs: 28000, type: 'swarmer', count: 16 },
    { atMs: 33000, type: 'swarmer', count: 16 },
  ],
  win: { type: 'survive', seconds: 40 },
};

export const SHOOTER_LEVELS = {
  arena, pillars, wall, 'smoke-win': smokeWin, 'smoke-lose': smokeLose, 'shotgun-pit': shotgunPit, spitters, medic,
} as const satisfies Record<string, ShooterLevel>;

export type ShooterLevelName = keyof typeof SHOOTER_LEVELS;
export const SHOOTER_LEVEL_NAMES = Object.keys(SHOOTER_LEVELS) as ShooterLevelName[];

/** The level called `name`, or undefined (own names only: "constructor" is not a level). */
export function shooterLevel(name: string): ShooterLevel | undefined {
  return Object.hasOwn(SHOOTER_LEVELS, name) ? SHOOTER_LEVELS[name as ShooterLevelName] : undefined;
}
