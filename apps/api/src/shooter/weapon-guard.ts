// The guard on the weapons of a brief: the model is NOT trusted to pick the weapon the user named, nor to know when "chỉ có súng ngắn"
// means that the player gets only that one. The user's own words (weapon-words.ts) decide, by fixed rules; what the model said is kept
// only when the words say nothing. Pure and deterministic. A change is not told to the user (they asked for it), except in one case: a
// limit to SEVERAL weapons, which the engine cannot do. Every change is written down in the diagnostics (`guardChanged`).
import { WEAPON_LABEL_VI, foldPrompt, weaponsNamed, type WeaponId } from './weapon-words.js';

/** Words that say, about guns, "limit me" (folded text): enough to limit the player to one weapon even when none is named. */
export const LIMIT_PHRASES = /\b(?:mot loai sung|1 loai sung|khong (?:(?:duoc|the) )?(?:doi|chuyen) sung|co dinh sung|sung co dinh|one weapon|no weapon (?:switching|changing))\b/;
/** Words that mean "only" in general. They limit the weapons only when exactly ONE weapon is named: "chỉ có zombie" limits nothing. */
export const LIMIT_WORDS = /\b(?:chi co|chi dung|chi duoc|chi xai|duy nhat|only|just (?:a|an|one|the)|single)\b/;

export interface Change { field: 'weapon' | 'loadout'; from: string; to: string }
export interface WeaponGuarded<T> { brief: T; changed: Change[]; notices: string[] }

export const SEVERAL_WEAPONS_NOTICE = (start: WeaponId) =>
  `Chưa hỗ trợ: chỉ giữ một vài súng; màn có đủ 5 súng, bắt đầu bằng ${WEAPON_LABEL_VI[start]}.`;

/** Applies the rules to the brief the model returned (see the numbered rules in docs/DIRECTION.md, Stage 6B). */
export function guardWeapons<T extends { weapon: string; loadout?: string }>(brief: T, prompt: string): WeaponGuarded<T> {
  const named = weaponsNamed(prompt);
  const text = foldPrompt(prompt);
  const phrases = LIMIT_PHRASES.test(text);
  const limited = phrases || LIMIT_WORDS.test(text);
  let weapon = brief.weapon;
  let loadout = brief.loadout ?? 'all';
  const notices: string[] = [];

  if (named.length === 1) {
    weapon = named[0]!; // the weapon the user named wins over the model's choice
    loadout = limited ? 'single' : loadout === 'single' ? 'all' : loadout; // "only the pistol" is one weapon; a single nobody asked for goes back to all
  } else if (named.length === 0) {
    if (phrases) loadout = 'single'; // "chỉ có một loại súng": one weapon, the model's choice
    else if (loadout === 'single') loadout = 'all';
  } else {
    // several weapons named: the start is one of them; a limit to a few of them is not something the engine can do
    if (!named.includes(weapon as WeaponId)) weapon = named[0]!;
    loadout = 'all';
    if (limited) notices.push(SEVERAL_WEAPONS_NOTICE(weapon as WeaponId));
  }

  const changed: Change[] = [];
  if (weapon !== brief.weapon) changed.push({ field: 'weapon', from: brief.weapon, to: weapon });
  if (loadout !== (brief.loadout ?? 'all')) changed.push({ field: 'loadout', from: brief.loadout ?? 'all', to: loadout });
  return { brief: changed.length === 0 ? brief : { ...brief, weapon, loadout }, changed, notices };
}
