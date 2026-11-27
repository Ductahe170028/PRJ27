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
    ['boss', ['có nhiều boss', 'hai boss cuối', '2 boss', 'ba con boss', 'multiple bosses', 'two bosses', 'several bosses', 'mini boss', 'mini-bosses', 'boss phụ', 'hai trùm', 'nhiều trùm']],
    ['boss-summon', ['boss triệu hồi quái', 'boss gọi quái đến', 'trùm triệu hồi', 'a boss that summons minions', 'the boss summons enemies', 'summoner boss']],
    ['vehicle', ['lái xe tăng', 'xe máy', 'có phương tiện', 'phuong tien', 'drive a car', 'vehicles']],
    ['multiplayer', ['multiplayer', 'chế độ co-op', 'co op', 'hai người chơi', 'nhieu nguoi choi', '2 người chơi', 'two players']],
    ['towers', ['xây tháp pháo quanh căn cứ', 'xay thap', 'đặt tháp canh', 'nâng cấp tường', 'xây hàng rào', 'xây pháo đài', 'build towers', 'upgrade the turrets', 'build a wall', 'tower defense', 'tower defence', 'building fences']],
    ['many-bases', ['bảo vệ hai căn cứ', '2 căn cứ', 'nhiều căn cứ', 'nhieu can cu', 'multiple bases']],
    ['repair-base', ['sửa căn cứ', 'sửa chữa căn cứ', 'sua chua', 'repair the base', 'the base needs repairs']],
    ['ammo', ['hết đạn thì nạp đạn', 'het dan', 'reload', 'Reloading', 'ammo', 'đạn có hạn']],
    ['pickups', ['nâng cấp', 'nhặt vật phẩm', 'nhặt vật phẩm tăng tốc', 'power-up', 'powerups', 'nâng cấp súng', 'upgrades', 'pickups', 'pick up speed boosts']],
    ['explosion', ['đạn nổ lan', 'tên lửa', 'rocket launcher', 'ném lựu đạn', 'grenades', 'explosions everywhere', 'sát thương lan', 'area damage', 'nổ lan ra xung quanh']],
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
    // a base to defend is supported now: none of these says anything about a base
    ['towers', ['bảo vệ căn cứ khỏi zombie', 'phòng thủ căn cứ', 'defend the base', 'protect the base', 'tháp canh cổ', 'the tower of babel', 'một căn cứ quân sự', 'xây dựng không khí kinh dị']],
    ['many-bases', ['một căn cứ', 'căn cứ quân sự', 'hai người chơi giữ căn cứ', 'the base is big', 'two kinds of zombies']],
    ['repair-base', ['bảo vệ căn cứ', 'base defense', 'repair', 'the soldier repairs his armor', 'căn cứ bị tấn công']],
  ];
  it.each(misses)('%s does not trigger on look-alikes', (id, texts) => {
    for (const text of texts) {
      expect(keywordNotices(`Tạo game: ${text}. Sống sót 60 giây.`, []), text).not.toContain(noticeOf(id));
    }
  });

  it('a base to defend is supported now: "bảo vệ" says nothing for a base, a city or a camp, and the escort sentence for people', () => {
    for (const text of ['bảo vệ căn cứ khỏi zombie', 'phòng thủ căn cứ', 'bảo vệ thành phố khỏi zombie', 'bảo vệ căn cứ', 'bao ve can cu', 'defend the base', 'protect the camp from the horde']) {
      expect(keywordNotices(text, []), text).toEqual([]);
    }
    expect(keywordNotices('bảo vệ dân làng', [])).toEqual([noticeOf('escort')]);
    expect(keywordNotices('bảo vệ người dân', [])).toEqual([noticeOf('escort')]);
    expect(keywordNotices('bảo vệ người dân trong thành phố', [])).toEqual([noticeOf('escort')]);
  });

  it('the three new groups: building towers, more than one base, repairing the base', () => {
    expect(noticeOf('towers')).toBe('Chưa hỗ trợ: xây hoặc nâng cấp tháp, tường. Căn cứ không thể xây thêm.');
    expect(noticeOf('many-bases')).toBe('Chưa hỗ trợ: nhiều căn cứ. Mỗi màn có tối đa một căn cứ.');
    expect(noticeOf('repair-base')).toBe('Chưa hỗ trợ: sửa chữa căn cứ. Căn cứ không tự hồi máu.');
    expect(keywordNotices('xây tháp pháo quanh căn cứ', [])).toEqual([noticeOf('towers')]);
    expect(keywordNotices('bảo vệ hai căn cứ và người dân', [])).toEqual([noticeOf('many-bases'), noticeOf('escort')]);
    expect(keywordNotices('sửa chữa căn cứ sau mỗi đợt', [])).toEqual([noticeOf('repair-base')]);
    expect(keywordNotices('tower defense with turrets: build towers, then repair the base', []).sort()).toEqual([noticeOf('towers'), noticeOf('repair-base')].sort());
  });

  it('a self-contradicting prompt still gets the no-enemies sentence', () => {
    expect(keywordNotices('không có quái nhưng hạ 50 quái', [])).toEqual([noticeOf('no-enemies')]);
  });

  it('every group has a fixed Vietnamese sentence of at most 160 characters', () => {
    expect(NOTICE_GROUPS).toHaveLength(14);
    for (const group of NOTICE_GROUPS) {
      expect(group.notice.length).toBeLessThanOrEqual(NOTICE_MAX_CHARS);
      expect(group.notice.startsWith('Chưa hỗ trợ:')).toBe(true);
    }
    expect(new Set(NOTICE_GROUPS.map((group) => group.notice)).size).toBe(14);
  });

  it('adds nothing for ordinary prompts', () => {
    for (const text of ['zombie sinh tồn thành phố 60 giây', 'quái ngoài hành tinh phòng thí nghiệm, hạ 40 con', 'rừng đầy quái vật, súng bắn nhanh',
      'bệnh viện, zombie đi chậm nhưng ra liên tục, sống sót 90 giây', 'military base, three kinds of monsters', 'zombie', 'bắn xuyên qua nhiều quái', 'hạ 200 con quái trâu',
      'a fast game with a car-like speed', 'carpet', 'crafty zombies', 'trapezoid arena']) {
      expect(keywordNotices(text, []), text).toEqual([]);
    }
  });

  it('does not repeat a group that the model already reported', () => {
    expect(keywordNotices('có nhiều boss và nâng cấp', ['Chưa có nhiều boss'])).toEqual([noticeOf('pickups')]);
    expect(keywordNotices('có nhiều boss và nâng cấp', ['Không có NHIỀU BOSS', 'chưa có nâng cấp'])).toEqual([]);
    expect(keywordNotices('có nhiều boss', ['một điều khác'])).toEqual([noticeOf('boss')]);
  });

  it('never copies the prompt into a notice', () => {
    const secret = 'MA-BI-MAT-123';
    const found = keywordNotices(`nhiều boss ${secret} nâng cấp đặt bẫy`, []);
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

describe('one final boss is supported now, more than one is not', () => {
  const sentence = 'Chưa hỗ trợ: nhiều boss. Mỗi màn có tối đa một boss cuối.';
  it('the sentence is fixed', () => { expect(noticeOf('boss')).toBe(sentence); });
  it('a single boss says nothing, in any wording', () => {
    for (const prompt of ['boss cuối', 'có boss cuối', 'trùm cuối', 'quái trùm', 'Boss fight', 'BOSS', 'boss cuối to khổng lồ', 'a final boss', 'one boss at the end', 'the boss is a robot', 'robot chỉ huy là boss cuối']) {
      expect(keywordNotices(prompt, []), prompt).toEqual([]);
    }
  });
  it('several bosses, mini bosses and secondary bosses are reported, once', () => {
    for (const prompt of ['có hai boss', 'nhiều boss', '2 boss ở cuối', 'multiple bosses', 'two bosses and a mini boss', 'mini boss', 'boss phụ', 'hạ 30 quái rồi đánh boss, có hai boss và mini boss']) {
      expect(keywordNotices(prompt, []), prompt).toEqual([sentence]);
    }
  });
  it('a boss that calls enemies is reported with its own sentence', () => {
    const summon = 'Chưa hỗ trợ: boss triệu hồi quái.';
    expect(noticeOf('boss-summon')).toBe(summon);
    for (const prompt of ['boss triệu hồi quái', 'boss gọi quái đến giúp', 'a boss that summons minions', 'trùm triệu hồi lính']) expect(keywordNotices(prompt, []), prompt).toEqual([summon]);
    expect(keywordNotices('hai boss triệu hồi quái', [])).toEqual([sentence, summon]);
  });
  it('the other groups still match as before next to a boss', () => {
    expect(keywordNotices('bảo vệ căn cứ có boss cuối, tên lửa nổ lan, nhặt vật phẩm tăng tốc', []).sort()).toEqual([
      noticeOf('explosion'), noticeOf('pickups'),
    ].sort());
  });
});

describe('collectNotices', () => {
  it('orders: the model, the standard sentences, then what the engine changed', () => {
    const list = collectNotices({ prompt: 'có nhiều boss', unsupported: ['Chưa có nâng cấp'], engine: ['Độ khó được điều chỉnh để màn chơi thắng được.'] });
    expect(list).toEqual(['Chưa có nâng cấp', noticeOf('boss'), 'Độ khó được điều chỉnh để màn chơi thắng được.']);
  });

  it('has no duplicates, whatever the case, accents or spacing', () => {
    const list = collectNotices({ prompt: 'x', unsupported: ['Chưa có boss', 'chua co boss', ' CHƯA CÓ BOSS '], engine: ['A.', 'a.'] });
    expect(list).toEqual(['Chưa có boss', 'A.']);
  });

  it('keeps at most 8 and at most 160 characters each, dropping standard sentences first', () => {
    const everything = 'nhiều boss xe multiplayer xây tháp nhiều căn cứ sửa căn cứ hết đạn nâng cấp chế tạo bẫy';
    const model = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const engine = ['e1', 'e2', 'e3'];
    const list = collectNotices({ prompt: everything, unsupported: model, engine });
    expect(list).toHaveLength(MAX_NOTICES);
    for (const item of [...model, ...engine]) expect(list).toContain(item);
    expect(collectNotices({ prompt: everything, unsupported: [], engine: [] })).toHaveLength(MAX_NOTICES); // ten standard sentences, eight kept
    const long = collectNotices({ prompt: 'x', unsupported: ['y'.repeat(500)], engine: [] });
    expect(long[0]!.length).toBe(NOTICE_MAX_CHARS);
  });

  it('switching weapons is a feature now: asking for it says nothing (what stays unsupported is ammo, upgrades and pick-ups)', () => {
    for (const text of ['đổi vũ khí', 'nhiều vũ khí', 'có nhiều loại súng để đổi', 'multiple weapons', 'switch weapons with the number keys', 'weapon switching', 'swap weapons']) {
      expect(keywordNotices(text, []), text).toEqual([]);
    }
    expect(NOTICE_GROUPS.some((group) => group.id === 'weapons')).toBe(false);
    expect(keywordNotices('đổi vũ khí, hết đạn thì nạp đạn, nâng cấp súng', []).length).toBe(2);
  });

  it('is empty when there is nothing to say', () => {
    expect(collectNotices({ prompt: 'zombie', unsupported: [], engine: [] })).toEqual([]);
  });
});

describe('an `unsupported` entry that only repeats the prompt', () => {
  const prompt = 'Tạo game zombie ở thành phố, có nhiều boss cuối và nâng cấp, sống sót 60 giây';

  it('isPromptCopy: the same text, or most of it, from 40 characters', () => {
    expect(isPromptCopy(prompt, prompt)).toBe(true);
    expect(isPromptCopy(prompt.toUpperCase(), prompt)).toBe(true);
    expect(isPromptCopy('tao game zombie o thanh pho co nhieu boss cuoi va nang cap song sot 60 giay', prompt)).toBe(true); // no accents, no commas
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
    expect(collectNotices({ prompt, unsupported: ['nhiều boss cuối'], engine: [] })).toEqual(['nhiều boss cuối', noticeOf('pickups')]); // the model already covers the boss group
  });

  it('a copy does not hide the standard sentences that the prompt asks for', () => {
    const list = collectNotices({ prompt, unsupported: [prompt], engine: [] });
    expect(list).toEqual([GENERIC_UNSUPPORTED_NOTICE, noticeOf('boss'), noticeOf('pickups')]);
  });

  it('keeps the order (model, keyword, engine) and the limit of 8, the generic sentence counting as a model entry', () => {
    const everything = 'nhiều boss xe multiplayer xây tháp nhiều căn cứ sửa căn cứ hết đạn nâng cấp chế tạo bẫy và còn nhiều thứ khác nữa';
    const list = collectNotices({ prompt: everything, unsupported: ['m1', everything, 'm2'], engine: ['e1'] });
    expect(list).toHaveLength(MAX_NOTICES);
    expect(list.slice(0, 3)).toEqual(['m1', GENERIC_UNSUPPORTED_NOTICE, 'm2']);
    expect(list.at(-1)).toBe('e1');
    expect(list.slice(3, -1).every((item) => NOTICE_GROUPS.some((group) => group.notice === item))).toBe(true);
  });
});
