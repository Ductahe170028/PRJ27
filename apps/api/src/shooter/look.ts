// How a compiled level looks: which art packs it uses. The AI never chooses these (only the scenery, through `theme`, and the family of
// enemies, through `enemyFamily`); the engine picks the rest from the level's seed. Nothing here touches the simulation.
import type { Look } from '@game-creator/contracts';
import type { ShooterBrief } from './brief.js';

/** The ids that exist, per part of a look. Each id has a pack in apps/web (a PNG one in public/art/ or a procedural one in the game's
 * code); a test keeps this table and the packs in step. Adding a pack = adding its id here (docs/art-packs.md). */
export const LOOK_OPTIONS = {
  hero: ['scout', 'armor'],
  family: ['bug', 'mutant', 'robot'],
  base: ['bunker', 'outpost'],
  /** By the weapon of the brief: the held gun looks like the weapon it is. */
  weapon: { pistol: ['pistol'], rapid: ['rapid'], heavy: ['heavy'], shotgun: ['shotgun'], piercing: ['piercing'] },
} as const satisfies { hero: readonly string[]; family: readonly string[]; base: readonly string[]; weapon: Record<ShooterBrief['weapon'], readonly string[]> };

// One salt per part, so that the parts are chosen independently of each other.
const SALT_HERO = 0x68_65_72;
const SALT_FAMILY = 0x66_61_6d;
const SALT_BASE = 0x62_61_73;
const SALT_WEAPON = 0x77_65_70;

/** A 32-bit integer hash of (seed, salt): the same two numbers always give the same result. No Math.random, no state. */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = <T>(options: readonly T[], seed: number, salt: number): T => options[mixSeed(seed, salt) % options.length]!;

/** The look of a level: the scenery is the theme, the enemy family is the brief's when the user named one, and the rest is picked
 * from `levelSeed`. The same brief and seed always give the same look. */
export function pickLook(brief: Pick<ShooterBrief, 'theme' | 'enemyFamily' | 'weapon'>, levelSeed: number): Look {
  return {
    biome: brief.theme,
    hero: pick(LOOK_OPTIONS.hero, levelSeed, SALT_HERO),
    family: brief.enemyFamily === 'auto' ? pick(LOOK_OPTIONS.family, levelSeed, SALT_FAMILY) : brief.enemyFamily,
    base: pick(LOOK_OPTIONS.base, levelSeed, SALT_BASE),
    weapon: pick(LOOK_OPTIONS.weapon[brief.weapon], levelSeed, SALT_WEAPON),
  };
}
