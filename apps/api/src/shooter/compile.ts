// compileShooter: a brief and a seed become a ShooterLevel. Pure and
// deterministic: no I/O, no clock, no global randomness. The same brief and seed
// give the same level on every machine.
import {
  BRUTE_CLEARANCE, ENEMY_TYPES, NAV_INFLATE, ShooterLevelSchema, baseRectOf, blockedCells, bossBlockedCells, freeSpaceConnected, type ShooterLevel,
} from '@game-creator/contracts';
import type { ShooterBrief } from './brief.js';
import { pickLook } from './look.js';
import { MAP_TEMPLATES, MAX_VARIANTS, SPAWN_CANDIDATES, gapsAreWide, type MapName, type Obstacle } from './maps.js';
import { BASE_PLAYER, HEALTH_DROP_PCT, HEALTH_HP, PLAYER_SPEED, PLAYER_START, THEMES, WEAPONS, arsenalOf, baseFor, bossHpFor } from './presets.js';
import { deriveRng } from './rng.js';
import { scheduleBossWaves, scheduleWaves } from './waves.js';

/** Said when no layout of the chosen map fit and the empty arena was used instead. */
export const MAP_SIMPLIFIED_NOTICE = 'Bản đồ được đơn giản hóa thành đấu trường trống.';
/** Said whenever the level has a boss: the goal of the brief no longer decides how it is won. */
export const BOSS_GOAL_NOTICE = 'Màn có boss: thắng bằng cách hạ boss.';

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

type Base = NonNullable<ShooterLevel['base']>;
type Layout = { obstacles: Obstacle[]; spawnPoints: ShooterLevel['spawnPoints']; player: { x: number; y: number } };
/** Where the player starts and, in a level with a base, the base: the two go together, because the spawn points must keep their distance from both. */
interface Stand { player: { x: number; y: number }; base?: Base }

/** Stream of the generator that draws the map (the variant is added to it). */
export const SALT_MAP = 0x4d41;
const SALT_WAVES = 0x5741;
const MIN_SPAWN_POINTS = 3;
const MAX_SPAWN_POINTS = 8;

/** A level around the layout with one dummy wave: just enough to run the schema and the connectivity check. */
const skeleton = (layout: Pick<Layout, 'obstacles' | 'spawnPoints'>, stand: Stand, spawnPoints = layout.spawnPoints): ShooterLevel => ({
  kind: 'shooter-v1', title: 'x', seed: 0, width: 960, height: 540, theme: THEMES['zombie-city'],
  player: { ...stand.player, speed: PLAYER_SPEED, hp: 5 }, weapon: WEAPONS.pistol,
  obstacles: layout.obstacles, spawnPoints: [...spawnPoints],
  waves: [{ atMs: 0, type: 'runner', count: 1 }], win: { type: 'survive', seconds: 20 },
  ...(stand.base ? { base: stand.base } : {}),
});

/** Obstacles that pass the schema, spawn points that each reach the player, wide gaps. With `bossRadius` every spawn point must
 * also reach the player on the grid the boss walks on (bossBlockedCells: the boss's whole body must fit): the boss comes out at
 * one of the spawn points, so each of them must be a place it can leave, and the player a place it can get to. */
function usableLayout(obstacles: Obstacle[], bossRadius?: number, stand: Stand = { player: PLAYER_START }): Layout | undefined {
  if (obstacles.length > 12 || !gapsAreWide(obstacles)) return undefined;
  // With a base, its square is one more wall for everyone who walks: the player, the brutes and the boss must still get round it,
  // and every spawn point must reach the base itself on the field the enemies walk to it on (the grid WITHOUT its square, as in
  // the simulation's baseFlow).
  const { base } = stand;
  const walls = base ? [...obstacles, baseRectOf(base)] : obstacles;
  const bossGrid = bossRadius === undefined ? undefined : bossBlockedCells(walls, bossRadius);
  const mainGrid = base ? blockedCells(walls, BRUTE_CLEARANCE / 2) : undefined;
  const baseGrid = base ? blockedCells(obstacles, NAV_INFLATE) : undefined;
  const connected = (level: ShooterLevel) => freeSpaceConnected(level, BRUTE_CLEARANCE, mainGrid) && (bossGrid === undefined || freeSpaceConnected(level, 0, bossGrid))
    && (baseGrid === undefined || freeSpaceConnected({ ...level, player: { ...level.player, x: base!.x, y: base!.y } }, 0, baseGrid));
  // Candidate spawn points the schema accepts (clear of walls, far enough from the start), each one connected.
  const spawnPoints: Layout['spawnPoints'] = [];
  for (const candidate of SPAWN_CANDIDATES) {
    if (spawnPoints.length >= MAX_SPAWN_POINTS) break;
    const single = skeleton({ obstacles, spawnPoints: [] }, stand, [candidate]);
    if (!ShooterLevelSchema.safeParse(single).success) continue;
    if (!connected(single)) continue;
    spawnPoints.push({ ...candidate });
  }
  if (spawnPoints.length < MIN_SPAWN_POINTS) return undefined;
  const layout = { obstacles, spawnPoints, player: stand.player };
  return ShooterLevelSchema.safeParse(skeleton(layout, stand)).success && connected(skeleton(layout, stand)) ? layout : undefined;
}

/** Up, down, left, right: where the player may start, relative to the base. */
const SIDES = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }] as const;

/** Where the player may stand, in the order of preference. Without a base: the start of every level, as it always was. With one:
 * `BASE_PLAYER.gap` px from the base's center on one of the four sides, beginning with side `seed % 4` and going round. */
function stands(seed: number, base?: Base): Stand[] {
  if (!base) return [{ player: PLAYER_START }];
  return SIDES.map((_, k) => SIDES[(seed + k) % 4]!).map((side) => ({ base, player: { x: base.x + side.x * BASE_PLAYER.gap, y: base.y + side.y * BASE_PLAYER.gap } }));
}

function chooseLayout(map: MapName, seed: number, options: CompileOptions, bossRadius?: number, base?: Base): { layout: Layout; map: MapName; variant: number; simplified: boolean } {
  for (let variant = 0; variant < MAX_VARIANTS; variant += 1) {
    const obstacles = MAP_TEMPLATES[map](deriveRng(seed, SALT_MAP + variant), variant);
    if (options.rejectLayout?.(map, variant, obstacles)) continue;
    for (const stand of stands(seed, base)) {
      const layout = usableLayout(obstacles, bossRadius, stand);
      if (layout) return { layout, map, variant, simplified: false };
    }
  }
  // No variant fit: the empty arena always does.
  const layout = stands(seed, base).map((stand) => usableLayout([], bossRadius, stand)).find((found) => found !== undefined);
  if (!layout) throw new Error('compileShooter: the empty arena has no usable spawn points.');
  return { layout, map: 'open-arena', variant: 0, simplified: map !== 'open-arena' };
}

export function compileShooter(brief: ShooterBrief, seed: number, options: CompileOptions = {}): Compiled {
  const levelSeed = Math.abs(Math.trunc(seed)) % 2_147_483_648;
  // A level with a boss is won by defeating it, whatever goal the brief names; the goal only sets how long the first part is.
  const boss = brief.boss === 'none' ? undefined : brief.boss;
  const base = brief.base === 'defend' ? baseFor(brief.intensity) : undefined;
  const chosen = chooseLayout(brief.map, levelSeed, options, boss === undefined ? undefined : ENEMY_TYPES[boss].radius, base);
  const { waves } = boss ? scheduleBossWaves(brief, deriveRng(levelSeed, SALT_WAVES)) : scheduleWaves(brief, deriveRng(levelSeed, SALT_WAVES));
  const candidate = {
    kind: 'shooter-v1', title: brief.title, seed: levelSeed, width: 960, height: 540,
    theme: THEMES[brief.theme],
    player: { ...chosen.layout.player, speed: PLAYER_SPEED, hp: HEALTH_HP[brief.playerHealth] },
    weapon: WEAPONS[brief.weapon],
    obstacles: chosen.layout.obstacles, spawnPoints: chosen.layout.spawnPoints,
    waves,
    // Only a level that has health drops carries the field: every other level stays exactly as it was.
    ...(brief.healthDrops === 'none' ? {} : { drops: { healthChancePct: HEALTH_DROP_PCT[brief.healthDrops] } }),
    ...(boss ? { bossHp: bossHpFor(boss, brief.intensity) } : {}),
    ...(base ? { base } : {}),
    // A loadout of `all` puts the five weapons in the player's hands (the bots, and so every calibration, keep to `weapon`, the one it starts with).
    ...(brief.loadout === 'all' ? { arsenal: arsenalOf() } : {}),
    look: pickLook(brief, levelSeed),
    win: boss ? { type: 'boss' } : brief.goal.type === 'survive' ? { type: 'survive', seconds: brief.goal.seconds } : { type: 'kill', count: brief.goal.count },
  };
  // The schema is the last word. Failing here is a bug in the compiler, never a user error.
  const parsed = ShooterLevelSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`compileShooter produced an invalid level (${first?.path.join('.') ?? '?'}: ${first?.message ?? '?'})`);
  }
  return { level: parsed.data, notices: [...(chosen.simplified ? [MAP_SIMPLIFIED_NOTICE] : []), ...(boss ? [BOSS_GOAL_NOTICE] : [])], map: chosen.map, variant: chosen.variant };
}
