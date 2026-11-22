// compileShooter: a brief and a seed become a ShooterLevel. Pure and
// deterministic: no I/O, no clock, no global randomness. The same brief and seed
// give the same level on every machine.
import {
  BRUTE_CLEARANCE, ShooterLevelSchema, freeSpaceConnected, type ShooterLevel,
} from '@game-creator/contracts';
import type { ShooterBrief } from './brief.js';
import { MAP_TEMPLATES, MAX_VARIANTS, SPAWN_CANDIDATES, gapsAreWide, type MapName, type Obstacle } from './maps.js';
import { HEALTH_HP, PLAYER_SPEED, PLAYER_START, THEMES, WEAPONS } from './presets.js';
import { deriveRng } from './rng.js';
import { scheduleWaves } from './waves.js';

/** Said when no layout of the chosen map fit and the empty arena was used instead. */
export const MAP_SIMPLIFIED_NOTICE = 'Bản đồ được đơn giản hóa thành đấu trường trống.';

export interface CompileOptions {
  /** Test seam: refuse a layout so that the next variant (and in the end the empty arena) is used. */
  rejectLayout?: (map: MapName, variant: number, obstacles: readonly Obstacle[]) => boolean;
}

export interface Compiled {
  level: ShooterLevel;
  /** Sentences about what the engine changed (not about what the user asked for). */
  notices: string[];
  /** The map actually used, and the variant (0..7) that fit. */
  map: MapName;
  variant: number;
}

type Layout = { obstacles: Obstacle[]; spawnPoints: ShooterLevel['spawnPoints'] };

/** Stream of the generator that draws the map (the variant is added to it). */
export const SALT_MAP = 0x4d41;
const SALT_WAVES = 0x5741;
const MIN_SPAWN_POINTS = 3;
const MAX_SPAWN_POINTS = 8;

/** A level around the layout with one dummy wave: just enough to run the schema and the connectivity check. */
const skeleton = (layout: Layout, spawnPoints = layout.spawnPoints): ShooterLevel => ({
  kind: 'shooter-v1', title: 'x', seed: 0, width: 960, height: 540, theme: THEMES['zombie-city'],
  player: { ...PLAYER_START, speed: PLAYER_SPEED, hp: 5 }, weapon: WEAPONS.pistol,
  obstacles: layout.obstacles, spawnPoints: [...spawnPoints],
  waves: [{ atMs: 0, type: 'runner', count: 1 }], win: { type: 'survive', seconds: 20 },
});

/** Obstacles that pass the schema, spawn points that each reach the player, wide gaps. */
function usableLayout(obstacles: Obstacle[]): Layout | undefined {
  if (obstacles.length > 12 || !gapsAreWide(obstacles)) return undefined;
  // Candidate spawn points the schema accepts (clear of walls, far enough from the start), each one connected.
  const spawnPoints: Layout['spawnPoints'] = [];
  for (const candidate of SPAWN_CANDIDATES) {
    if (spawnPoints.length >= MAX_SPAWN_POINTS) break;
    const single = skeleton({ obstacles, spawnPoints: [] }, [candidate]);
    if (!ShooterLevelSchema.safeParse(single).success) continue;
    if (!freeSpaceConnected(single, BRUTE_CLEARANCE)) continue;
    spawnPoints.push({ ...candidate });
  }
  if (spawnPoints.length < MIN_SPAWN_POINTS) return undefined;
  const layout = { obstacles, spawnPoints };
  return ShooterLevelSchema.safeParse(skeleton(layout)).success && freeSpaceConnected(skeleton(layout), BRUTE_CLEARANCE) ? layout : undefined;
}

function chooseLayout(map: MapName, seed: number, options: CompileOptions): { layout: Layout; map: MapName; variant: number; simplified: boolean } {
  for (let variant = 0; variant < MAX_VARIANTS; variant += 1) {
    const obstacles = MAP_TEMPLATES[map](deriveRng(seed, SALT_MAP + variant), variant);
    if (options.rejectLayout?.(map, variant, obstacles)) continue;
    const layout = usableLayout(obstacles);
    if (layout) return { layout, map, variant, simplified: false };
  }
  // No variant fit: the empty arena always does.
  const layout = usableLayout([]);
  if (!layout) throw new Error('compileShooter: the empty arena has no usable spawn points.');
  return { layout, map: 'open-arena', variant: 0, simplified: map !== 'open-arena' };
}

export function compileShooter(brief: ShooterBrief, seed: number, options: CompileOptions = {}): Compiled {
  const levelSeed = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  const chosen = chooseLayout(brief.map, levelSeed, options);
  const { waves } = scheduleWaves(brief, deriveRng(levelSeed, SALT_WAVES));
  const candidate = {
    kind: 'shooter-v1', title: brief.title, seed: levelSeed, width: 960, height: 540,
    theme: THEMES[brief.theme],
    player: { ...PLAYER_START, speed: PLAYER_SPEED, hp: HEALTH_HP[brief.playerHealth] },
    weapon: WEAPONS[brief.weapon],
    obstacles: chosen.layout.obstacles, spawnPoints: chosen.layout.spawnPoints,
    waves,
    win: brief.goal.type === 'survive' ? { type: 'survive', seconds: brief.goal.seconds } : { type: 'kill', count: brief.goal.count },
  };
  // The schema is the last word. Failing here is a bug in the compiler, never a user error.
  const parsed = ShooterLevelSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`compileShooter produced an invalid level (${first?.path.join('.') ?? '?'}: ${first?.message ?? '?'})`);
  }
  return { level: parsed.data, notices: chosen.simplified ? [MAP_SIMPLIFIED_NOTICE] : [], map: chosen.map, variant: chosen.variant };
}
