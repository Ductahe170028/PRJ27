// Which weapons a user's sentence NAMES, found by keywords (never by the model): a fixed table of names, in Vietnamese and in English, with
// accents removed. Pure and deterministic. Used by the weapon guard (weapon-guard.ts), which does not trust the model to pick the
// weapon the user named, nor to know when "only a pistol" means that the player gets ONE weapon.
import { fold } from './notices.js';

export type WeaponId = 'pistol' | 'shotgun' | 'piercing' | 'rapid' | 'heavy';

/** The names of each weapon, folded (no accents, lower case). `sung lien tuc` needs the word "sung": "lien tuc" alone ("quái tấn công liên tục")
 * is not a weapon. "sniper" is not here either: it is often the name of an enemy. Word boundaries keep "heavy" out of "heavyweight". */
export const WEAPON_NAMES: Record<WeaponId, readonly string[]> = {
  pistol: ['sung ngan', 'sung luc', 'pistol', 'handgun'],
  shotgun: ['shotgun', 'sung san', 'sung hoa cai'],
  piercing: ['sung xuyen', 'xuyen giap', 'ban xuyen', 'piercing'],
  rapid: ['sung ban nhanh', 'ban nhanh', 'sung nhanh', 'lien thanh', 'sung lien tuc', 'tieu lien', 'sung tu dong', 'smg', 'machine gun', 'machinegun'],
  heavy: ['sung nang', 'hang nang', 'dai bac', 'heavy', 'cannon'],
};

/** How the game calls each weapon, for the one notice the guard can make. */
export const WEAPON_LABEL_VI: Record<WeaponId, string> = {
  pistol: 'súng ngắn', shotgun: 'shotgun (súng săn)', piercing: 'súng xuyên giáp', rapid: 'súng bắn nhanh (liên thanh)', heavy: 'súng nặng',
};

const PATTERNS = (Object.entries(WEAPON_NAMES) as Array<[WeaponId, readonly string[]]>).map(([id, names]) => ({ id, pattern: new RegExp(`\\b(?:${names.join('|')})\\b`, 'g') }));

/** A word that turns the weapon after it down. "dungneg" is "đừng" (don't): written with its accent it is told apart from "dùng" (use). */
const NEGATION = /\b(?:khong|dungneg|bo|tru|ngoai tru|without|no|not|except|dont|don't)\b/;
/** How many characters before a weapon's name a negation still counts ("không dùng súng shotgun" is 16 before "shotgun"). */
export const NEGATION_REACH = 20;

/** The sentence as the matching sees it: accents out, lower case, and "đừng" kept apart from "dùng". */
export function foldPrompt(prompt: string): string {
  return fold(prompt.normalize('NFC').toLowerCase().replace(/đừng/g, ' dungneg '));
}

/** The weapons the sentence names, once each, in the order they first appear. A name right after a negation ("không dùng shotgun", "no
 * pistol", "ngoài trừ súng nặng") does not count. */
export function weaponsNamed(prompt: string): WeaponId[] {
  const text = foldPrompt(prompt);
  const found: Array<{ id: WeaponId; at: number }> = [];
  for (const { id, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - NEGATION_REACH), match.index);
      if (NEGATION.test(before)) continue;
      found.push({ id, at: match.index });
      break; // the first name that counts is where this weapon "appears"
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.id);
}
