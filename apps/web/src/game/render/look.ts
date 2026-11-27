// Which packs a level is drawn with when it has no `look` (the hand-made levels, levels saved before Stage 5A), and the sentence the
// hidden HUD publishes. Pure: it needs no pack and no browser.
import type { Look, ShooterLevel } from '@game-creator/contracts';

/** The first id of each list is the default. The lists are the ids of the packs that exist (art/registry.ts keeps them in step). */
export const DEFAULT_IDS = { hero: 'scout', family: 'bug', base: 'bunker', weapon: 'pistol', pickup: 'health', fx: 'basic' } as const;

/** The ground colors of the eight scenery packs, as the API's themes give them (apps/api/src/shooter/presets.ts THEMES): a level whose
 * theme is none of them gets the scenery whose color is nearest. */
export const BIOME_BACKGROUNDS: Record<string, string> = {
  'zombie-city': '#121820', 'alien-lab': '#0e1a1f', 'dark-forest': '#0f1a12', 'desert-ruins': '#2a2118',
  'ice-base': '#0f1c2a', 'neon-arena': '#0a0a14', hospital: '#14202a', 'military-base': '#141a14',
};
export const FALLBACK_BIOME = 'neon-arena';

const channels = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** The scenery whose ground color is nearest to the level's background (an exact match wins, of course). */
export function nearestBiome(background: string): string {
  const [r, g, b] = channels(background);
  let best = FALLBACK_BIOME;
  let bestDistance = Infinity;
  for (const [id, hex] of Object.entries(BIOME_BACKGROUNDS)) {
    const [r2, g2, b2] = channels(hex);
    const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (distance < bestDistance) { best = id; bestDistance = distance; }
  }
  return best;
}

/** The held gun, worked out from the weapon's numbers: pellets -> shotgun, pierce -> piercing, fast -> rapid, strong -> heavy. */
export function weaponIdFor(weapon: ShooterLevel['weapon']): string {
  if (weapon.pellets !== undefined && weapon.pellets > 1) return 'shotgun';
  if (weapon.pierce !== undefined && weapon.pierce > 1) return 'piercing';
  if (weapon.cooldownMs <= 150) return 'rapid';
  if (weapon.damage >= 3) return 'heavy';
  return DEFAULT_IDS.weapon;
}

/** The look a level is drawn with: its own `look`, or the defaults for what is missing. */
export function effectiveLook(level: Pick<ShooterLevel, 'look' | 'theme' | 'weapon'>): Look {
  if (level.look) return level.look;
  return {
    biome: nearestBiome(level.theme.background), hero: DEFAULT_IDS.hero, family: DEFAULT_IDS.family,
    base: DEFAULT_IDS.base, weapon: weaponIdFor(level.weapon),
  };
}

/** `biome:...;hero:...;family:...;base:...;weapon:...`, for `data-look` on the hidden HUD. */
export const lookText = (look: Look) => `biome:${look.biome};hero:${look.hero};family:${look.family};base:${look.base};weapon:${look.weapon}`;

/** Overrides from the playground's address (`&biome=ice-base&hero=armor...`): only the five known names are read; a value that is
 * not an id of a pack in `known` is ignored (the look keeps what it had). */
export function applyLookOverrides(look: Look, params: URLSearchParams, known: Record<keyof Look, readonly string[]>): Look {
  const next: Look = { ...look };
  for (const name of ['biome', 'hero', 'family', 'base', 'weapon'] as const) {
    const value = params.get(name);
    if (value !== null && known[name].includes(value)) next[name] = value;
  }
  return next;
}
