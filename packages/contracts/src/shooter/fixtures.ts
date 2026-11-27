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

/** Stage 4C: the huge boss rushes at you (look for the ring that warns you), four pillars to hide behind. Defeat the boss. */
const bossCrusher: ShooterLevel = {
  kind: 'shooter-v1', title: 'Boss khổng lồ', seed: 9909, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 6 },
  weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  obstacles: [
    { x: 300, y: 210, width: 70, height: 70 }, { x: 660, y: 210, width: 70, height: 70 },
    { x: 300, y: 400, width: 70, height: 70 }, { x: 660, y: 400, width: 70, height: 70 },
  ],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 2000, type: 'swarmer', count: 6 },
    { atMs: 5000, type: 'runner', count: 3 },
    { atMs: 9000, type: 'crusher', count: 1 },
    { atMs: 14000, type: 'swarmer', count: 6 },
  ],
  bossHp: 40,
  win: { type: 'boss' },
};

/** Stage 4C: the boss keeps its distance and fires fans and rings of bullets; four pillars to hide behind. Defeat the boss. */
const bossGunner: ShooterLevel = {
  kind: 'shooter-v1', title: 'Boss xạ thủ', seed: 1010, width: 960, height: 540, theme,
  player: { x: 480, y: 305, speed: 210, hp: 8 },
  weapon: { cooldownMs: 200, bulletSpeed: 650, damage: 1, range: 550 },
  obstacles: [
    { x: 300, y: 210, width: 70, height: 70 }, { x: 660, y: 210, width: 70, height: 70 },
    { x: 300, y: 400, width: 70, height: 70 }, { x: 660, y: 400, width: 70, height: 70 },
  ],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 4000, type: 'runner', count: 2 },
    { atMs: 7000, type: 'swarmer', count: 3 },
    { atMs: 9000, type: 'gunner', count: 1 },
    { atMs: 15000, type: 'runner', count: 3 },
  ],
  bossHp: 24,
  win: { type: 'boss' },
};

/** Stage 4D: a base in the middle of the field (its square is 56 px, with its health bar above it), four pillars, and enemies from every side.
 * Hold out for 60 s: you lose if you fall or if the base is destroyed. */
const baseSiege: ShooterLevel = {
  kind: 'shooter-v1', title: 'Giữ căn cứ', seed: 4401, width: 960, height: 540, theme,
  player: { x: 416, y: 305, speed: 210, hp: 6 },
  weapon: { cooldownMs: 200, bulletSpeed: 650, damage: 1, range: 550 },
  obstacles: [
    { x: 250, y: 190, width: 60, height: 60 }, { x: 710, y: 190, width: 60, height: 60 },
    { x: 250, y: 420, width: 60, height: 60 }, { x: 710, y: 420, width: 60, height: 60 },
  ],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 3000, type: 'swarmer', count: 4 },
    { atMs: 9000, type: 'runner', count: 3 },
    { atMs: 16000, type: 'swarmer', count: 5 },
    { atMs: 23000, type: 'runner', count: 3 },
    { atMs: 31000, type: 'brute', count: 1 },
    { atMs: 34000, type: 'swarmer', count: 6 },
    { atMs: 42000, type: 'runner', count: 3 },
    { atMs: 49000, type: 'swarmer', count: 6 },
  ],
  base: { x: 480, y: 305, hp: 100 },
  win: { type: 'survive', seconds: 60 },
};

/** Stage 4D: the base and the huge boss. The boss comes out after 10 s and goes for you; whatever touches the base hurts it. Defeat the boss. */
const baseBoss: ShooterLevel = {
  kind: 'shooter-v1', title: 'Căn cứ và boss', seed: 4402, width: 960, height: 540, theme,
  player: { x: 416, y: 305, speed: 210, hp: 8 },
  weapon: { cooldownMs: 200, bulletSpeed: 650, damage: 1, range: 550 },
  obstacles: [{ x: 250, y: 190, width: 60, height: 60 }, { x: 710, y: 420, width: 60, height: 60 }],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 2000, type: 'swarmer', count: 5 },
    { atMs: 6000, type: 'runner', count: 3 },
    { atMs: 10000, type: 'crusher', count: 1 },
    { atMs: 16000, type: 'swarmer', count: 6 },
  ],
  bossHp: 30,
  base: { x: 480, y: 305, hp: 50 },
  win: { type: 'boss' },
};

/** Stage 4D: a very frail base (5 hit points) and two brutes that walk straight at it from the far side, while you stand safe at the far
 * end of the field. They take the base apart and you lose without a scratch ("Căn cứ đã bị phá"). Shoot them first. */
const baseFall: ShooterLevel = {
  kind: 'shooter-v1', title: 'Căn cứ mong manh', seed: 4403, width: 960, height: 540, theme,
  player: { x: 60, y: 305, speed: 210, hp: 5 },
  weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  obstacles: [],
  spawnPoints: [{ x: 920, y: 305 }],
  waves: [
    { atMs: 1000, type: 'brute', count: 2 },
    { atMs: 4000, type: 'brute', count: 2 },
  ],
  base: { x: 480, y: 305, hp: 5 },
  win: { type: 'survive', seconds: 60 },
};

/** Stage 5A: a level to LOOK at, not to win: a long survive with a base, a few obstacles, the four ordinary kinds of enemy (the spitter shoots)
 * and a sturdy hero. The playground can change how it looks (&biome=...&hero=...&family=...&base=...&weapon=...), add a boss
 * (&boss=crusher or &boss=gunner) or fill it with enemies (&stress=120). */
const artShowcase: ShooterLevel = {
  kind: 'shooter-v1', title: 'Xem diện mạo', seed: 5151, width: 960, height: 540, theme,
  player: { x: 416, y: 305, speed: 210, hp: 10 },
  weapon: { cooldownMs: 200, bulletSpeed: 650, damage: 1, range: 550 },
  obstacles: [
    { x: 250, y: 190, width: 60, height: 60 }, { x: 710, y: 190, width: 60, height: 60 },
    { x: 250, y: 420, width: 60, height: 60 }, { x: 710, y: 420, width: 60, height: 60 },
  ],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 2000, type: 'runner', count: 3 },
    { atMs: 5000, type: 'swarmer', count: 5 },
    { atMs: 9000, type: 'spitter', count: 2 },
    { atMs: 13000, type: 'brute', count: 1 },
    { atMs: 18000, type: 'runner', count: 4 },
    { atMs: 24000, type: 'swarmer', count: 6 },
    { atMs: 30000, type: 'spitter', count: 2 },
    { atMs: 36000, type: 'brute', count: 2 },
    { atMs: 44000, type: 'runner', count: 5 },
    { atMs: 54000, type: 'swarmer', count: 8 },
  ],
  base: { x: 480, y: 305, hp: 200 },
  look: { biome: 'military-base', hero: 'scout', family: 'bug', base: 'bunker', weapon: 'pistol' },
  win: { type: 'survive', seconds: 120 },
};

/** Stage 5A: the same shape with the hero of the one PNG test pack (public/art/hero/grunt-test), to try the way pictures travel. */
const artTest: ShooterLevel = {
  kind: 'shooter-v1', title: 'Thử ảnh PNG', seed: 5152, width: 960, height: 540, theme,
  player: { x: 416, y: 305, speed: 210, hp: 10 },
  weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 },
  obstacles: [{ x: 250, y: 190, width: 60, height: 60 }, { x: 710, y: 420, width: 60, height: 60 }],
  spawnPoints: edgeSpawns,
  waves: [
    { atMs: 3000, type: 'runner', count: 2 },
    { atMs: 9000, type: 'swarmer', count: 4 },
    { atMs: 16000, type: 'runner', count: 3 },
  ],
  base: { x: 480, y: 305, hp: 120 },
  look: { biome: 'zombie-city', hero: 'grunt-test', family: 'mutant', base: 'outpost', weapon: 'rapid' },
  win: { type: 'survive', seconds: 60 },
};

export const SHOOTER_LEVELS = {
  arena, pillars, wall, 'smoke-win': smokeWin, 'smoke-lose': smokeLose, 'shotgun-pit': shotgunPit, spitters, medic, 'boss-crusher': bossCrusher, 'boss-gunner': bossGunner,
  'base-siege': baseSiege, 'base-boss': baseBoss, 'base-fall': baseFall, 'art-showcase': artShowcase, 'art-test': artTest,
} as const satisfies Record<string, ShooterLevel>;

export type ShooterLevelName = keyof typeof SHOOTER_LEVELS;
export const SHOOTER_LEVEL_NAMES = Object.keys(SHOOTER_LEVELS) as ShooterLevelName[];

/** The level called `name`, or undefined (own names only: "constructor" is not a level). */
export function shooterLevel(name: string): ShooterLevel | undefined {
  return Object.hasOwn(SHOOTER_LEVELS, name) ? SHOOTER_LEVELS[name as ShooterLevelName] : undefined;
}
