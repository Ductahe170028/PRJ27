// Which packs a level needs. No drawing code here, so the page (not only the game iframe) can use it to know what to fetch.
import type { Look } from '@game-creator/contracts';
import { DEFAULT_IDS } from '../render/look';
import type { PackRef } from './types';

/** The packs a look needs: its five, plus the health pickup and the effects every level uses, plus (in a level with an arsenal) the weapon
 * pack of every other weapon the player can switch to, by the id of its arsenal entry. */
export function neededRefs(look: Look, arsenalIds: readonly string[] = []): PackRef[] {
  const extra = arsenalIds.filter((id, i) => id !== look.weapon && arsenalIds.indexOf(id) === i).map((id): PackRef => ({ kind: 'weapon', id }));
  return [
    { kind: 'biome', id: look.biome }, { kind: 'hero', id: look.hero }, { kind: 'family', id: look.family }, { kind: 'base', id: look.base },
    { kind: 'weapon', id: look.weapon }, { kind: 'pickup', id: DEFAULT_IDS.pickup }, { kind: 'fx', id: DEFAULT_IDS.fx },
    ...extra,
  ];
}
