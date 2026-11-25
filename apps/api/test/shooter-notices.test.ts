import { describe, expect, it } from 'vitest';
import {
  GENERIC_UNSUPPORTED_NOTICE, MAX_NOTICES, NOTICE_GROUPS, NOTICE_MAX_CHARS, collectNotices, fold, isPromptCopy, keywordNotices,
} from '../src/shooter/notices.js';

const noticeOf = (id: string) => NOTICE_GROUPS.find((group) => group.id === id)!.notice;

describe('fold', () => {
  it('lower-cases, strips accents and treats hyphens as spaces', () => {
    expect(fold('Hết Đạn')).toBe('het dan');
    expect(fold('POWER-UP và co-op')).toBe('power up va co op');
    expect(fold('  a   b ')).toBe(' a b ');
  });
});

describe('keyword notices, one group at a time', () => {
  // each: [group, texts that must trigger it]
  const cases: Array<[string, string[]]> = [
    ['boss', ['có boss cuối', 'Boss fight', 'quái trùm', 'BOSSES at the end', 'quai trum']],
    ['vehicle', ['lái xe tăng', 'xe máy', 'có phương tiện', 'phuong tien', 'drive a car', 'vehicles']],
    ['multiplayer', ['multiplayer', 'chế độ co-op', 'co op', 'hai người chơi', 'nhieu nguoi choi', '2 người chơi', 'two players']],
    ['defense', ['bảo vệ căn cứ trước các đợt tấn công', 'bao ve can cu', 'phòng thủ', 'tower defense', 'tower defence', 'defend the base', 'base defense']],
    ['ammo', ['hết đạn thì nạp đạn', 'het dan', 'reload', 'Reloading', 'ammo', 'đạn có hạn']],
    ['pickups', ['nâng cấp', 'nhặt vật phẩm', 'nhặt vật phẩm tăng tốc', 'power-up', 'powerups', 'nâng cấp súng', 'upgrades', 'pickups', 'pick up speed boosts']],
    ['explosion', ['đạn nổ lan', 'tên lửa', 'rocket launcher', 'ném lựu đạn', 'grenades', 'explosions everywhere', 'sát thương lan', 'area damage', 'nổ lan ra xung quanh']],
    ['weapons', ['đổi vũ khí', 'nhiều vũ khí', 'multiple weapons', 'switch weapons', 'weapon switching', 'swap weapon']],
    ['crafting', ['chế tạo', 'crafting', 'craft items']],
    ['traps', ['đặt bẫy', 'trap', 'traps', 'cái bẫy', 'bẫy gai']],
    ['no-enemies', ['không có quái', 'màn không quái', 'hòa bình', 'no enemies', 'no monsters', 'no zombies', 'peaceful', 'không có quái nhưng hạ 50 quái', 'một thế giới hòa bình, không có quái vật']],
    ['escort', ['hộ tống công chúa', 'escort the villagers', 'bảo vệ người dân khỏi zombie', 'bảo vệ dân làng', 'bảo vệ đồng đội', 'protect the princess', 'defend the civilians',
      'bảo vệ em bé', 'NPC cần được bảo vệ', 'protect allies', 'hộ tống', 'villagers must be protected', 'bảo vệ các đồng đội của bạn']],
  ];
  it.each(cases)('%s', (id, texts) => {
    for (const text of texts) {
      expect(keywordNotices(`Tạo game: ${text}. Sống sót 60 giây.`, []), text).toContain(noticeOf(id));
      expect(keywordNotices(text.toUpperCase(), []), `${text} (upper)`).toContain(noticeOf(id));
    }
  });

  // each: [group, texts that must NOT trigger it]
  const misses: Array<[string, string[]]> = [
    ['no-enemies', ['hòa nhạc trong thành phố', 'màu sắc hòa trộn', 'hoa quả và zombie', 'không có quái trâu', 'know enemies well', 'quái không có điểm yếu', 'peacefully', 'nobody wins', 'zombie đi chậm, hạ 50 con']],
    ['escort', ['bảo vệ bản thân khỏi zombie', 'áo giáp bảo vệ người chơi', 'bảo vệ môi trường', 'protect yourself', 'defend against the horde', 'zombie tấn công người dân',
      'a friendly ally', 'totally awesome', 'bảo vệ máu và sống sót thật lâu, đồng đội không cần', 'em bé zombie']],
    ['vehicle', ['xem thử màn chơi', 'xếp hàng quái', 'exercise room', 'mixed enemies', 'axe fight', 'a taxi']],
  ];
  it.each(misses)('%s does not trigger on look-alikes', (id, texts) => {
    for (const text of texts) {
      expect(keywordNotices(`Tạo game: ${text}. Sống sót 60 giây.`, []), text).not.toContain(noticeOf(id));
    }
  });

  it('"bảo vệ" is the defence group for a base or a city, and the escort group for people', () => {
    // Decision recorded on purpose: asking to defend a city expects something to defend, and there is nothing, so say it.
    expect(keywordNotices('bảo vệ thành phố khỏi zombie', [])).toEqual([noticeOf('defense')]);
    expect(keywordNotices('bảo vệ căn cứ', [])).toEqual([noticeOf('defense')]);
    expect(keywordNotices('bảo vệ dân làng', [])).toEqual([noticeOf('escort')]);
    expect(keywordNotices('bảo vệ người dân trong thành phố', [])).toEqual([noticeOf('defense'), noticeOf('escort')]);
  });

  it('a self-contradicting prompt still gets the no-enemies sentence', () => {
    expect(keywordNotices('không có quái nhưng hạ 50 quái', [])).toEqual([noticeOf('no-enemies')]);
  });

  it('every group has a fixed Vietnamese sentence of at most 160 characters', () => {
    expect(NOTICE_GROUPS).toHaveLength(12);
    for (const group of NOTICE_GROUPS) {
      expect(group.notice.length).toBeLessThanOrEqual(NOTICE_MAX_CHARS);
      expect(group.notice.startsWith('Chưa hỗ trợ:')).toBe(true);
    }
    expect(new Set(NOTICE_GROUPS.map((group) => group.notice)).size).toBe(12);
  });

  it('adds nothing for ordinary prompts', () => {
    for (const text of ['zombie sinh tồn thành phố 60 giây', 'quái ngoài hành tinh phòng thí nghiệm, hạ 40 con', 'rừng đầy quái vật, súng bắn nhanh',
      'bệnh viện, zombie đi chậm nhưng ra liên tục, sống sót 90 giây', 'military base, three kinds of monsters', 'zombie', 'bắn xuyên qua nhiều quái', 'hạ 200 con quái trâu',
      'a fast game with a car-like speed', 'carpet', 'crafty zombies', 'trapezoid arena']) {
      expect(keywordNotices(text, []), text).toEqual([]);
    }
  });

  it('does not repeat a group that the model already reported', () => {
    expect(keywordNotices('có boss và nâng cấp', ['Chưa có boss'])).toEqual([noticeOf('pickups')]);
    expect(keywordNotices('có boss và nâng cấp', ['Không có BOSS', 'chưa có nâng cấp'])).toEqual([]);
    expect(keywordNotices('có boss', ['một điều khác'])).toEqual([noticeOf('boss')]);
  });

  it('never copies the prompt into a notice', () => {
    const secret = 'MA-BI-MAT-123';
    const found = keywordNotices(`boss ${secret} nâng cấp đặt bẫy`, []);
    expect(found.length).toBe(3);
    for (const notice of found) expect(notice).not.toContain(secret);
  });
});

describe('health drops are supported now, other pickups are not', () => {
  const pickups = noticeOf('pickups');
  it('asking for healing says nothing', () => {
    for (const prompt of ['nhặt vật phẩm hồi máu', 'quái rơi hộp máu', 'hồi máu', 'nhặt hồi máu', 'có hộp máu và bình máu', 'health packs drop from enemies', 'medkits', 'healing items', 'pick up health']) {
      expect(keywordNotices(prompt, []), prompt).toEqual([]);
    }
  });
  it('asking for something else to pick up still warns, and says that health is the only one', () => {
    expect(keywordNotices('nhặt vật phẩm tăng tốc', [])).toEqual([pickups]);
    expect(keywordNotices('pick up a speed boost', [])).toEqual([pickups]);
    expect(pickups).toContain('Chỉ có vật phẩm hồi máu');
  });
  it('healing together with an upgrade still warns about the upgrade', () => {
    expect(keywordNotices('hồi máu và nâng cấp súng', [])).toEqual([pickups]);
    expect(keywordNotices('nhặt hộp máu và power-up', [])).toEqual([pickups]);
  });
});

describe('explosions', () => {
  const sentence = 'Chưa hỗ trợ: đạn nổ lan. Mỗi viên đạn chỉ trúng quái nó chạm.';
  it('have a fixed sentence', () => { expect(noticeOf('explosion')).toBe(sentence); });
  it('rockets, grenades and area damage warn', () => {
    for (const prompt of ['tên lửa nổ lan', 'súng bắn tên lửa', 'rocket launcher', 'ném lựu đạn', 'grenades', 'big explosions', 'area damage', 'sát thương lan']) {
      expect(keywordNotices(prompt, []), prompt).toEqual([sentence]);
    }
  });
  it('the model reporting it first is enough', () => {
    expect(keywordNotices('tên lửa nổ lan', ['Chưa có đạn nổ lan'])).toEqual([]);
  });
  it('shotgun, piercing and ordinary shooting do not warn', () => {
    for (const prompt of ['súng shotgun', 'đạn xuyên giáp', 'bắn tỉa', 'zombie chạy lan ra khắp nơi', 'no landmines here']) expect(keywordNotices(prompt, []), prompt).toEqual([]);
  });
});

describe('collectNotices', () => {
  it('orders: the model, the standard sentences, then what the engine changed', () => {
    const list = collectNotices({ prompt: 'có boss', unsupported: ['Chưa có nâng cấp'], engine: ['Độ khó được điều chỉnh để màn chơi thắng được.'] });
    expect(list).toEqual(['Chưa có nâng cấp', noticeOf('boss'), 'Độ khó được điều chỉnh để màn chơi thắng được.']);
  });

  it('has no duplicates, whatever the case, accents or spacing', () => {
    const list = collectNotices({ prompt: 'x', unsupported: ['Chưa có boss', 'chua co boss', ' CHƯA CÓ BOSS '], engine: ['A.', 'a.'] });
    expect(list).toEqual(['Chưa có boss', 'A.']);
  });

  it('keeps at most 8 and at most 160 characters each, dropping standard sentences first', () => {
    const everything = 'boss xe multiplayer bảo vệ căn cứ hết đạn nâng cấp đổi vũ khí chế tạo bẫy';
    const model = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const engine = ['e1', 'e2', 'e3'];
    const list = collectNotices({ prompt: everything, unsupported: model, engine });
    expect(list).toHaveLength(MAX_NOTICES);
    for (const item of [...model, ...engine]) expect(list).toContain(item);
    expect(collectNotices({ prompt: everything, unsupported: [], engine: [] })).toHaveLength(MAX_NOTICES); // nine standard sentences, eight kept
    const long = collectNotices({ prompt: 'x', unsupported: ['y'.repeat(500)], engine: [] });
    expect(long[0]!.length).toBe(NOTICE_MAX_CHARS);
  });

  it('is empty when there is nothing to say', () => {
    expect(collectNotices({ prompt: 'zombie', unsupported: [], engine: [] })).toEqual([]);
  });
});

describe('an `unsupported` entry that only repeats the prompt', () => {
  const prompt = 'Tạo game zombie ở thành phố, có boss cuối và nâng cấp, sống sót 60 giây';

  it('isPromptCopy: the same text, or most of it, from 40 characters', () => {
    expect(isPromptCopy(prompt, prompt)).toBe(true);
    expect(isPromptCopy(prompt.toUpperCase(), prompt)).toBe(true);
    expect(isPromptCopy('tao game zombie o thanh pho co boss cuoi va nang cap song sot 60 giay', prompt)).toBe(true); // no accents, no commas
    expect(isPromptCopy(`  ${prompt}.  `, prompt)).toBe(true);
    expect(isPromptCopy(prompt.slice(0, -12), prompt)).toBe(true); // a prefix, still >= 80% and >= 40 characters
    expect(isPromptCopy(`${prompt}!!`, prompt)).toBe(true);
    expect(isPromptCopy('Tạo game zombie', prompt)).toBe(false); // short and a small part of it
    expect(isPromptCopy(prompt.slice(0, 30), prompt)).toBe(false); // under 40 characters and not the whole prompt
    expect(isPromptCopy(prompt.slice(0, 45), prompt)).toBe(false); // 45 characters but only 64% of the prompt
    expect(isPromptCopy('boss cuối', prompt)).toBe(false);
    expect(isPromptCopy('Chưa có nâng cấp và nhặt vật phẩm trong màn chơi', prompt)).toBe(false);
  });

  it('a short entry that is equal to a short prompt is a copy; a longer sentence around it is not', () => {
    expect(isPromptCopy('boss cuối', 'boss cuối')).toBe(true);
    expect(isPromptCopy('Chưa hỗ trợ: boss cuối, màn chơi chỉ có ba loại quái thường.', 'boss cuối')).toBe(false);
    expect(isPromptCopy('', 'zombie')).toBe(false);
    expect(isPromptCopy('zombie', '')).toBe(false);
  });

  it('is replaced by one generic sentence, in the model\'s place', () => {
    const list = collectNotices({ prompt, unsupported: ['Chưa có nâng cấp', prompt, 'sinh tồn'], engine: [] });
    expect(list[0]).toBe('Chưa có nâng cấp');
    expect(list[1]).toBe(GENERIC_UNSUPPORTED_NOTICE);
    expect(list[2]).toBe('sinh tồn');
    expect(list).not.toContain(prompt);
    expect(GENERIC_UNSUPPORTED_NOTICE).toBe('Một phần yêu cầu chưa được hỗ trợ.');
    for (const item of list) expect(item.length).toBeLessThanOrEqual(NOTICE_MAX_CHARS);
  });

  it('does not repeat the generic sentence, even when the model sent it or sent several copies', () => {
    const list = collectNotices({ prompt, unsupported: [prompt, prompt.slice(0, -12), GENERIC_UNSUPPORTED_NOTICE, prompt.toUpperCase()], engine: [] });
    expect(list.filter((item) => item === GENERIC_UNSUPPORTED_NOTICE)).toHaveLength(1);
  });

  it('a short meaningful entry is kept as it is', () => {
    expect(collectNotices({ prompt, unsupported: ['boss cuối'], engine: [] })).toEqual(['boss cuối', noticeOf('pickups')]); // the model already covers the boss group
  });

  it('a copy does not hide the standard sentences that the prompt asks for', () => {
    const list = collectNotices({ prompt, unsupported: [prompt], engine: [] });
    expect(list).toEqual([GENERIC_UNSUPPORTED_NOTICE, noticeOf('boss'), noticeOf('pickups')]);
  });

  it('keeps the order (model, keyword, engine) and the limit of 8, the generic sentence counting as a model entry', () => {
    const everything = 'boss xe multiplayer bảo vệ căn cứ hết đạn nâng cấp đổi vũ khí chế tạo bẫy và còn nhiều thứ khác nữa';
    const list = collectNotices({ prompt: everything, unsupported: ['m1', everything, 'm2'], engine: ['e1'] });
    expect(list).toHaveLength(MAX_NOTICES);
    expect(list.slice(0, 3)).toEqual(['m1', GENERIC_UNSUPPORTED_NOTICE, 'm2']);
    expect(list.at(-1)).toBe('e1');
    expect(list.slice(3, -1).every((item) => NOTICE_GROUPS.some((group) => group.notice === item))).toBe(true);
  });
});
