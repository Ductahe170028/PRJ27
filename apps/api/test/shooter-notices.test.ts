import { describe, expect, it } from 'vitest';
import { MAX_NOTICES, NOTICE_GROUPS, NOTICE_MAX_CHARS, collectNotices, fold, keywordNotices } from '../src/shooter/notices.js';

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
    ['pickups', ['hồi máu', 'nhặt vật phẩm', 'power-up', 'powerups', 'nâng cấp súng', 'upgrades', 'health pack', 'medkit', 'pickups']],
    ['weapons', ['đổi vũ khí', 'nhiều vũ khí', 'multiple weapons', 'switch weapons', 'weapon switching', 'swap weapon']],
    ['crafting', ['chế tạo', 'crafting', 'craft items']],
    ['traps', ['đặt bẫy', 'trap', 'traps', 'cái bẫy', 'bẫy gai']],
  ];
  it.each(cases)('%s', (id, texts) => {
    for (const text of texts) {
      expect(keywordNotices(`Tạo game: ${text}. Sống sót 60 giây.`, []), text).toContain(noticeOf(id));
      expect(keywordNotices(text.toUpperCase(), []), `${text} (upper)`).toContain(noticeOf(id));
    }
  });

  it('every group has a fixed Vietnamese sentence of at most 160 characters', () => {
    expect(NOTICE_GROUPS).toHaveLength(9);
    for (const group of NOTICE_GROUPS) {
      expect(group.notice.length).toBeLessThanOrEqual(NOTICE_MAX_CHARS);
      expect(group.notice.startsWith('Chưa hỗ trợ:')).toBe(true);
    }
    expect(new Set(NOTICE_GROUPS.map((group) => group.notice)).size).toBe(9);
  });

  it('adds nothing for ordinary prompts', () => {
    for (const text of ['zombie sinh tồn thành phố 60 giây', 'quái ngoài hành tinh phòng thí nghiệm, hạ 40 con', 'rừng đầy quái vật, súng bắn nhanh',
      'bệnh viện, zombie đi chậm nhưng ra liên tục, sống sót 90 giây', 'military base, three kinds of monsters', 'zombie', 'bắn tên lửa nổ lan', 'không có quái nhưng hạ 50 quái',
      'a fast game with a car-like speed', 'carpet', 'crafty zombies', 'trapezoid arena']) {
      expect(keywordNotices(text, []), text).toEqual([]);
    }
  });

  it('does not repeat a group that the model already reported', () => {
    expect(keywordNotices('có boss và hồi máu', ['Chưa có boss'])).toEqual([noticeOf('pickups')]);
    expect(keywordNotices('có boss và hồi máu', ['Không có BOSS', 'chưa có hồi máu'])).toEqual([]);
    expect(keywordNotices('có boss', ['một điều khác'])).toEqual([noticeOf('boss')]);
  });

  it('never copies the prompt into a notice', () => {
    const secret = 'MA-BI-MAT-123';
    const found = keywordNotices(`boss ${secret} hồi máu đặt bẫy`, []);
    expect(found.length).toBe(3);
    for (const notice of found) expect(notice).not.toContain(secret);
  });
});

describe('collectNotices', () => {
  it('orders: the model, the standard sentences, then what the engine changed', () => {
    const list = collectNotices({ prompt: 'có boss', unsupported: ['Chưa có hồi máu'], engine: ['Độ khó được điều chỉnh để màn chơi khó hơn.'] });
    expect(list).toEqual(['Chưa có hồi máu', noticeOf('boss'), 'Độ khó được điều chỉnh để màn chơi khó hơn.']);
  });

  it('has no duplicates, whatever the case, accents or spacing', () => {
    const list = collectNotices({ prompt: 'x', unsupported: ['Chưa có boss', 'chua co boss', ' CHƯA CÓ BOSS '], engine: ['A.', 'a.'] });
    expect(list).toEqual(['Chưa có boss', 'A.']);
  });

  it('keeps at most 8 and at most 160 characters each, dropping standard sentences first', () => {
    const everything = 'boss xe multiplayer bảo vệ căn cứ hết đạn hồi máu đổi vũ khí chế tạo bẫy';
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
