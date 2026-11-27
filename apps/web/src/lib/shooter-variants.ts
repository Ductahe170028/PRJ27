// Changes the playground can make to a hand-made level from the address (`/?shooter=art-showcase&boss=crusher&biome=ice-base&stress=120`):
// how it looks, a boss, a crowd. Pure functions of (level, parameters): a value they do not know is ignored.
import { MAX_SCHEDULED_ENEMIES, ShooterLevelSchema, bossOf, type EnemyType, type Look, type ShooterLevel } from '@game-creator/contracts';
import { applyLookOverrides, effectiveLook } from '../game/render/look';

/** Adds the boss `kind` to the level at 6 s and makes defeating it the goal. A level that already has a boss is left as it is. */
export function withBoss(level: ShooterLevel, kind: string): ShooterLevel {
  if (kind !== 'crusher' && kind !== 'gunner') return level;
  if (level.waves.some((wave) => bossOf(wave.type) !== undefined)) return level;
  const candidate = { ...level, waves: [...level.waves, { atMs: 6_000, type: kind, count: 1 }].sort((a, b) => a.atMs - b.atMs), win: { type: 'boss' } };
  const parsed = ShooterLevelSchema.safeParse(candidate);
  return parsed.success ? parsed.data : level;
}

const CROWD: readonly EnemyType[] = ['swarmer', 'runner', 'brute', 'swarmer', 'runner', 'spitter'];
/** Fills the level with `count` ordinary enemies (4 to MAX_SCHEDULED_ENEMIES), coming in 30 waves-or-fewer from the start, to see the game with a crowd. */
export function withCrowd(level: ShooterLevel, count: number): ShooterLevel {
  const total = Math.min(MAX_SCHEDULED_ENEMIES, Math.max(4, Math.floor(count)));
  const perWave = Math.ceil(total / 24);
  const waves: ShooterLevel['waves'] = [];
  let left = total;
  for (let i = 0; left > 0; i += 1) {
    const here = Math.min(perWave, left);
    waves.push({ atMs: 500 + i * 450, type: CROWD[i % CROWD.length]!, count: here });
    left -= here;
  }
  const boss = level.waves.find((wave) => bossOf(wave.type) !== undefined);
  const candidate = { ...level, waves: boss ? [...waves, boss].sort((a, b) => a.atMs - b.atMs) : waves, win: level.win.type === 'kill' ? { type: 'survive', seconds: 120 } : level.win };
  const parsed = ShooterLevelSchema.safeParse(candidate);
  return parsed.success ? parsed.data : level;
}

export type KnownIds = Record<keyof Look, readonly string[]>;

/** The level the playground really plays: `level` with the look, boss and crowd that the address asks for. */
export function variantFromParams(level: ShooterLevel, params: URLSearchParams, known: KnownIds): ShooterLevel {
  let next = level;
  const boss = params.get('boss');
  if (boss) next = withBoss(next, boss);
  // &loadout=single: the one weapon the level starts with, no arsenal (to try the one-weapon mode of a level that has five)
  if (params.get('loadout') === 'single' && next.arsenal) { const { arsenal: _arsenal, ...single } = next; next = single; }
  const stress = Number(params.get('stress'));
  if (Number.isFinite(stress) && stress > 0) next = withCrowd(next, stress);
  const look = applyLookOverrides(effectiveLook(next), params, known);
  return { ...next, look };
}

/** Whether the address asks for anything that changes the level (the playground then waits for the list of known packs). */
export const hasOverrides = (params: URLSearchParams) => ['biome', 'hero', 'family', 'base', 'weapon', 'boss', 'stress', 'loadout'].some((name) => params.has(name));
