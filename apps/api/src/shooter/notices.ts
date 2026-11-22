// A safety net that does not depend on the model: when the user's text asks for
// something the engine does not have, say so, even if the model forgot to.
// Fixed sentences only: nothing of the prompt is ever copied into a notice.

export const MAX_NOTICES = 8;
export const NOTICE_MAX_CHARS = 160;

interface Group { id: string; pattern: RegExp; notice: string }

/** Lower case, no accents, hyphens and underscores as spaces: "Hết đạn" and
 * "het-dan" and "HET DAN" all read "het dan". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

export const NOTICE_GROUPS: readonly Group[] = [
  { id: 'boss', pattern: /\bboss(es)?\b|\btrum cuoi\b|\bquai trum\b|\btrum\b/, notice: 'Chưa hỗ trợ: boss. Màn chơi chỉ có ba loại quái thường.' },
  { id: 'vehicle', pattern: /\bxe\b|\bphuong tien\b|\bvehicles?\b|\b(drive|drives|driving)\b/, notice: 'Chưa hỗ trợ: xe và phương tiện. Người chơi đi bộ.' },
  { id: 'multiplayer', pattern: /\bmulti ?player\b|\bco ?op\b|\bnhieu nguoi choi\b|\bhai nguoi choi\b|\b2 nguoi choi\b|\b(two|2|multiple) players?\b/, notice: 'Chưa hỗ trợ: nhiều người chơi. Game chỉ có một người chơi.' },
  {
    id: 'defense',
    pattern: /\bbao ve\b.{0,24}\b(can cu|can ban|co so|tru so|thanh|lau dai|base|tower|castle|camp)\b|\bphong thu\b|tower defen[cs]e|base defen[cs]e|\bdefend\b.{0,16}\b(base|tower|castle|camp|fort)\b/,
    notice: 'Chưa hỗ trợ: bảo vệ căn cứ. Màn chơi chỉ có sống sót hoặc hạ quái.',
  },
  { id: 'ammo', pattern: /\bhet dan\b|\bnap dan\b|\breload(ing)?\b|\bammo\b|\bammunition\b|\bdan co han\b|\bgioi han dan\b|\blimited bullets\b/, notice: 'Chưa hỗ trợ: giới hạn đạn và nạp đạn. Đạn không giới hạn, có hồi chiêu.' },
  {
    id: 'pickups',
    pattern: /\bhoi mau\b|\bvat pham\b|\bpower ?ups?\b|\bnang cap\b|\bupgrades?\b|\bhealth ?packs?\b|\bmed ?kits?\b|\bpick ?ups?\b|\bheal(ing)?\b/,
    notice: 'Chưa hỗ trợ: vật phẩm, hồi máu và nâng cấp.',
  },
  {
    id: 'weapons',
    pattern: /\bdoi vu khi\b|\bnhieu vu khi\b|\bnhieu loai sung\b|\bmultiple weapons?\b|\b(switch|switching|swap|swapping) weapons?\b|\bweapon (switch|switching|wheel)\b/,
    notice: 'Chưa hỗ trợ: đổi giữa nhiều vũ khí. Mỗi game dùng một vũ khí.',
  },
  { id: 'crafting', pattern: /\bche tao\b|\bcrafting\b|\bcraft\b/, notice: 'Chưa hỗ trợ: chế tạo.' },
  { id: 'traps', pattern: /\btraps?\b|\bcai bay\b|\bdat bay\b|\bbay (gai|min|lua|sat)\b/, notice: 'Chưa hỗ trợ: bẫy.' },
];

const matches = (group: Group, text: string) => group.pattern.test(fold(text));

/** The standard sentence for every group that the prompt mentions and that the
 * model's own `unsupported` entries do not already cover. */
export function keywordNotices(prompt: string, unsupported: readonly string[]): string[] {
  const text = fold(prompt);
  return NOTICE_GROUPS
    .filter((group) => group.pattern.test(text) && !unsupported.some((item) => matches(group, item)))
    .map((group) => group.notice);
}

const sameSentence = (a: string, b: string) => fold(a).trim() === fold(b).trim();

/** The final list for the user: the model's `unsupported` entries, the
 * standard sentences, then what the engine changed itself. No duplicates, at
 * most 8, each at most 160 characters. When there are too many, standard
 * sentences are dropped first. */
export function collectNotices(input: { prompt: string; unsupported: readonly string[]; engine: readonly string[] }): string[] {
  const cut = (text: string) => Array.from(text.trim()).slice(0, NOTICE_MAX_CHARS).join('');
  const keyword = new Set(keywordNotices(input.prompt, input.unsupported).map(cut));
  const list: string[] = [];
  for (const item of [...input.unsupported, ...keyword, ...input.engine].map(cut)) {
    if (item !== '' && !list.some((known) => sameSentence(known, item))) list.push(item);
  }
  while (list.length > MAX_NOTICES) {
    let drop = -1;
    list.forEach((item, index) => { if (keyword.has(item)) drop = index; });
    list.splice(drop >= 0 ? drop : list.length - 1, 1);
  }
  return list;
}
