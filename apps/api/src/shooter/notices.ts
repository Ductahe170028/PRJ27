// A safety net that does not depend on the model: when the user's text asks for
// something the engine does not have, say so, even if the model forgot to.
// Fixed sentences only: nothing of the prompt is ever copied into a notice.

export const MAX_NOTICES = 8;
export const NOTICE_MAX_CHARS = 160;

/** `weak` words count only when the text is not also about health drops (which the engine has). */
interface Group { id: string; pattern: RegExp; weak?: RegExp; notice: string }

/** Words about healing: "nhặt vật phẩm hồi máu" asks for something the engine has, "nhặt vật phẩm tăng tốc" does not. */
const HEALTH = /\b(?:hoi mau|hop mau|binh mau|health|heal\w*|med ?kits?|first aid)\b/;

const hits = (group: Group, text: string) => group.pattern.test(text) || (group.weak?.test(text) === true && !HEALTH.test(text));

/** Lower case, no accents, hyphens and underscores as spaces: "Hết đạn" and
 * "het-dan" and "HET DAN" all read "het dan". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

// Characters that a user might ask the game to protect or escort (folded text).
const CHARACTERS = '(?:nguoi dan|dan lang|dong doi|em be|cong chua|npc|civilians?|villagers?|princess(?:es)?|allies|ally|teammates?)';
const PROTECT = '(?:bao ve|protect\\w*|defend\\w*)';

export const NOTICE_GROUPS: readonly Group[] = [
  {
    id: 'no-enemies',
    pattern: /\bkhong (?:co )?quai\b(?! (?:trau|nhanh|cham|chay|lon|nho|bay|dac biet))|\bhoa binh\b|\bno (?:enemies|enemy|monsters?|zombies?)\b|\bpeaceful\b/,
    notice: 'Chưa hỗ trợ: màn không có quái. Màn chơi luôn có quái xuất hiện.',
  },
  {
    // One final boss is supported now; only MORE than one (or small ones) is not.
    id: 'boss',
    pattern: /\b(?:nhieu|hai|ba|2|3|multiple|many|several|two|three) +(?:con +)?(?:boss(?:es)?|trum)\b|\bmini ?boss(?:es)?\b|\bboss phu\b|\bboss con\b/,
    notice: 'Chưa hỗ trợ: nhiều boss. Mỗi màn có tối đa một boss cuối.',
  },
  {
    id: 'boss-summon',
    pattern: /\b(?:boss|trum)\b.{0,24}\b(?:trieu hoi|goi quai|goi them quai|summon\w*)\b|\bsummon\w*\b.{0,16}\bboss\b/,
    notice: 'Chưa hỗ trợ: boss triệu hồi quái.',
  },
  { id: 'vehicle', pattern: /\bxe\b|\bphuong tien\b|\bvehicles?\b|\b(drive|drives|driving)\b/, notice: 'Chưa hỗ trợ: xe và phương tiện. Người chơi đi bộ.' },
  { id: 'multiplayer', pattern: /\bmulti ?player\b|\bco ?op\b|\bnhieu nguoi choi\b|\bhai nguoi choi\b|\b2 nguoi choi\b|\b(two|2|multiple) players?\b/, notice: 'Chưa hỗ trợ: nhiều người chơi. Game chỉ có một người chơi.' },
  // The base itself is supported now (brief `base: 'defend'`); what is not: building or upgrading towers and walls, repairing the base, and more than one.
  {
    id: 'towers',
    pattern: /\b(?:xay|dat|nang cap)\b.{0,16}\b(?:thap phao|thap|tru|tuong|hang rao|phao dai)\b|\b(?:build|building|upgrade|upgrading)\b.{0,16}\b(?:towers?|turrets?|walls?|fences?)\b|tower defen[cs]e/,
    notice: 'Chưa hỗ trợ: xây hoặc nâng cấp tháp, tường. Căn cứ không thể xây thêm.',
  },
  {
    id: 'many-bases',
    pattern: /\b(?:hai|2|nhieu) +can cu\b|\bnhieu +can cu\b|\bmultiple bases\b/,
    notice: 'Chưa hỗ trợ: nhiều căn cứ. Mỗi màn có tối đa một căn cứ.',
  },
  {
    id: 'repair-base',
    pattern: /\bsua can cu\b|\bsua chua\b|\brepair\w*\b.{0,16}\bbase\b|\bbase\b.{0,16}\brepair/,
    notice: 'Chưa hỗ trợ: sửa chữa căn cứ. Căn cứ không tự hồi máu.',
  },
  {
    id: 'escort',
    pattern: new RegExp(`\\bho tong\\b|\\bescort(?:s|ing|ed)?\\b|\\b${PROTECT}\\b.{0,24}\\b${CHARACTERS}\\b|\\b${CHARACTERS}\\b.{0,24}\\b${PROTECT}\\b`),
    notice: 'Chưa hỗ trợ: bảo vệ hoặc hộ tống nhân vật khác. Game chỉ có một người chơi.',
  },
  { id: 'ammo', pattern: /\bhet dan\b|\bnap dan\b|\breload(ing)?\b|\bammo\b|\bammunition\b|\bdan co han\b|\bgioi han dan\b|\blimited bullets\b/, notice: 'Chưa hỗ trợ: giới hạn đạn và nạp đạn. Đạn không giới hạn, có hồi chiêu.' },
  {
    id: 'pickups',
    pattern: /\bpower ?ups?\b|\bnang cap\b|\bupgrades?\b/,
    weak: /\bvat pham\b|\bpick ?ups?\b/,
    notice: 'Chưa hỗ trợ: vật phẩm tăng sức mạnh và nâng cấp. Chỉ có vật phẩm hồi máu.',
  },
  {
    id: 'explosion',
    pattern: /\bno lan\b|\bten lua\b|\brockets?\b|\bgrenades?\b|\bluu dan\b|\bexplosi\w*|\barea damage\b|\bsat thuong lan\b/,
    notice: 'Chưa hỗ trợ: đạn nổ lan. Mỗi viên đạn chỉ trúng quái nó chạm.',
  },
  {
    id: 'weapons',
    pattern: /\bdoi vu khi\b|\bnhieu vu khi\b|\bnhieu loai sung\b|\bmultiple weapons?\b|\b(switch|switching|swap|swapping) weapons?\b|\bweapon (switch|switching|wheel)\b/,
    notice: 'Chưa hỗ trợ: đổi giữa nhiều vũ khí. Mỗi game dùng một vũ khí.',
  },
  { id: 'crafting', pattern: /\bche tao\b|\bcrafting\b|\bcraft\b/, notice: 'Chưa hỗ trợ: chế tạo.' },
  { id: 'traps', pattern: /\btraps?\b|\bcai bay\b|\bdat bay\b|\bbay (gai|min|lua|sat)\b/, notice: 'Chưa hỗ trợ: bẫy.' },
];

const matches = (group: Group, text: string) => hits(group, fold(text));

/** The standard sentence for every group that the prompt mentions and that the
 * model's own `unsupported` entries do not already cover. */
export function keywordNotices(prompt: string, unsupported: readonly string[]): string[] {
  const text = fold(prompt);
  return NOTICE_GROUPS
    .filter((group) => hits(group, text) && !unsupported.some((item) => matches(group, item)))
    .map((group) => group.notice);
}

const sameSentence = (a: string, b: string) => fold(a).trim() === fold(b).trim();

/** Said instead of an `unsupported` entry that only repeats the user's prompt. */
export const GENERIC_UNSUPPORTED_NOTICE = 'Một phần yêu cầu chưa được hỗ trợ.';
/** A repeated prompt must be at least this long to be told apart from a short, meaningful entry like "boss cuối". */
export const COPY_MIN_CHARS = 40;
/** ...and this close in length to the prompt (shorter / longer). */
export const COPY_MIN_RATIO = 0.8;

/** Folded, with every run of punctuation and spaces read as one space. */
const plain = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** True when the model pasted the user's prompt into `unsupported` instead of naming what is missing:
 * the same text after `fold`, or (from 40 characters) text that is contained in the prompt, or contains
 * it, and is within 80% of its length. */
export function isPromptCopy(item: string, prompt: string): boolean {
  const a = plain(item);
  const b = plain(prompt);
  if (a === '' || b === '') return false;
  if (a === b) return true;
  if (a.length < COPY_MIN_CHARS) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= COPY_MIN_RATIO * long.length && long.includes(short);
}

/** The final list for the user: the model's `unsupported` entries (a pasted
 * copy of the prompt becomes one generic sentence), the standard sentences,
 * then what the engine changed itself. No duplicates, at most 8, each at most
 * 160 characters. When there are too many, standard sentences are dropped first. */
export function collectNotices(input: { prompt: string; unsupported: readonly string[]; engine: readonly string[] }): string[] {
  const cut = (text: string) => Array.from(text.trim()).slice(0, NOTICE_MAX_CHARS).join('');
  // A copy of the prompt names nothing, so it must not hide a keyword sentence either.
  const meaningful = input.unsupported.filter((item) => !isPromptCopy(item, input.prompt));
  const model = input.unsupported.map((item) => (isPromptCopy(item, input.prompt) ? GENERIC_UNSUPPORTED_NOTICE : item));
  const keyword = new Set(keywordNotices(input.prompt, meaningful).map(cut));
  const list: string[] = [];
  for (const item of [...model, ...keyword, ...input.engine].map(cut)) {
    if (item !== '' && !list.some((known) => sameSentence(known, item))) list.push(item);
  }
  while (list.length > MAX_NOTICES) {
    let drop = -1;
    list.forEach((item, index) => { if (keyword.has(item)) drop = index; });
    list.splice(drop >= 0 ? drop : list.length - 1, 1);
  }
  return list;
}

// --- What the model added that nobody asked for -----------------------------------------------------------------------------
// A small model sometimes adds a feature that changes the game (health drops, a base to lose) when the user's text says
// nothing of it. A feature is kept only when the text has at least one word that could mean it; the words are many on purpose
// (folded text, no accents), so that a user who did ask is never refused, even at the price of keeping a few that were not asked for.

/** Words that could mean health drops (`mau` also reads "màu" and `roi` also "rồi", `tim` also "tìm": folded text cannot tell them apart). */
const HEALTH_ASKED = /\b(?:hoi mau|hop mau|binh mau|mau|hoi phuc|heal\w*|health|med ?kits?|thuoc|vat pham|items?|pick ?ups?|roi|drops?|tim)\b/;
/** Words that could mean a base to defend (`thanh phố` is a city, not a castle). */
const BASE_ASKED = /\b(?:can cu|can ban|bao ve|giu|phong thu|thanh(?! pho)|nha|trai|phao dai|tru so|co so|base|defen[cs]e\w*|protect\w*|guard\w*|fort\w*|castle|camp|house|shelter)\b/;

export interface Guarded<T> { brief: T; /** The features the guard took out, by the name of the brief's field. */ removed: Array<'healthDrops' | 'base'> }

/** Puts `healthDrops` back to 'none' and `base` back to 'none' when the user's text has no word that could mean them. The boss is left
 * alone (too many ways to say it, and losing a boss the user wanted is worse than keeping one they did not). Nothing is said to the
 * user about what was taken out: they did not ask for it. The caller records `removed` for the diagnostics. */
export function guardUnrequested<T extends { healthDrops: string; base: string }>(brief: T, prompt: string): Guarded<T> {
  const text = fold(prompt);
  const removed: Guarded<T>['removed'] = [];
  let next = brief;
  if (brief.healthDrops !== 'none' && !HEALTH_ASKED.test(text)) { next = { ...next, healthDrops: 'none' }; removed.push('healthDrops'); }
  if (brief.base !== 'none' && !BASE_ASKED.test(text)) { next = { ...next, base: 'none' }; removed.push('base'); }
  return { brief: next, removed };
}
