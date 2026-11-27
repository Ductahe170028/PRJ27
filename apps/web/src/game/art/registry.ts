// Every pack drawn by our own code, by kind and id. A PNG pack with the same kind and id is preferred (art/loader.ts); this table is
// what a game falls back on, so a missing or broken image never breaks a game.
import type { ArtKind } from '@game-creator/contracts';
import { BASE_PACKS } from './procedural/bases';
import { BIOME_PACKS } from './procedural/biomes';
import { FAMILY_PACKS } from './procedural/families';
import { HERO_PACKS } from './procedural/heroes';
import { FX_PACKS, PICKUP_PACKS } from './procedural/misc';
import { WEAPON_PACKS } from './procedural/weapons';
import type { ProceduralPack } from './types';

export const PROCEDURAL_PACKS: Record<ArtKind, Record<string, ProceduralPack>> = {
  biome: BIOME_PACKS, hero: HERO_PACKS, family: FAMILY_PACKS, base: BASE_PACKS, weapon: WEAPON_PACKS, pickup: PICKUP_PACKS, fx: FX_PACKS,
};

/** The ids of the packs drawn by code for a kind. */
export const proceduralIds = (kind: ArtKind): string[] => Object.keys(PROCEDURAL_PACKS[kind]);
/** The pack drawn by code for (kind, id), or the first one of that kind when the id is unknown. */
export function proceduralPack(kind: ArtKind, id: string): ProceduralPack {
  const table = PROCEDURAL_PACKS[kind];
  return table[id] ?? table[Object.keys(table)[0]!]!;
}
