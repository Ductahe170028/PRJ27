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
  { id: 'boss', pattern: /\bboss(es)?\b|\btrum cuoi\b|\bquai trum\b|\btrum\b/, notice: 'Chưa hỗ trợ: boss. Màn chơi chỉ có ba loại quái thường.' },
  { id: 'vehicle', pattern: /\bxe\b|\bphuong tien\b|\bvehicles?\b|\b(drive|drives|driving)\b/, notice: 'Chưa hỗ trợ: xe và phương tiện. Người chơi đi bộ.' },
  { id: 'multiplayer', pattern: /\bmulti ?player\b|\bco ?op\b|\bnhieu nguoi choi\b|\bhai nguoi choi\b|\b2 nguoi choi\b|\b(two|2|multiple) players?\b/, notice: 'Chưa hỗ trợ: nhiều người chơi. Game chỉ có một người chơi.' },
  {
    id: 'defense',
    pattern: /\bbao ve\b.{0,24}\b(can cu|can ban|co so|tru so|thanh|lau dai|base|tower|castle|camp)\b|\bphong thu\b|tower defen[cs]e|base defen[cs]e|\bdefend\b.{0,16}\b(base|tower|castle|camp|fort)\b/,
    notice: 'Chưa hỗ trợ: bảo vệ căn cứ. Màn chơi chỉ có sống sót hoặc hạ quái.',
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
