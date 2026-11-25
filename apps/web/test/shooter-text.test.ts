import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES, SHOOTER_LEVELS, totalScheduledEnemies, type ShooterLevel } from '@game-creator/contracts';
import {
  BANNER_FADE_MS, BANNER_HINT, BANNER_MS, BOSS_WARNING_TEXT, bannerAlpha, bannerTextColor, bannerTitle, bossBar, bossWarningAlpha, contrastRatio, goalProgress, goalSentence,
  hudLine, levelInfo, weaponSummary,
} from '../src/lib/shooter-text';

const survive = { type: 'survive', seconds: 60 } as const;
const kill = { type: 'kill', count: 40 } as const;
const weapon = (cooldownMs: number, patch: Partial<ShooterLevel['weapon']> = {}): ShooterLevel['weapon'] => ({ cooldownMs, bulletSpeed: 600, damage: 1, range: 600, ...patch });

describe('goal sentences', () => {
  it('say the goal the same way everywhere', () => {
    expect(goalSentence(survive)).toBe('Sống sót 60 giây');
    expect(goalSentence(kill)).toBe('Hạ 40 quái');
    expect(bannerTitle(survive)).toBe('MỤC TIÊU: Sống sót 60 giây');
    expect(bannerTitle(kill)).toBe('MỤC TIÊU: Hạ 40 quái');
    expect(BANNER_HINT).toBe('WASD di chuyển · chuột ngắm và bắn · R chơi lại');
  });

  it('show progress as one piece, never past the goal', () => {
    expect(goalProgress(survive, { kills: 3, seconds: 12.9 })).toBe('Sống sót 12/60s');
    expect(goalProgress(survive, { kills: 3, seconds: 75 })).toBe('Sống sót 60/60s');
    expect(goalProgress(kill, { kills: 12, seconds: 80 })).toBe('Hạ 12/40');
  });
});

describe('the HUD line', () => {
  const base = { hp: 4, maxHp: 5, score: 31, kills: 12, seconds: 12.4 };
  it('a survive game: health, score, kills, time against the goal, restart key', () => {
    expect(hudLine(survive, base)).toBe('Máu 4/5  ·  Điểm 31  ·  Hạ 12  ·  Sống sót 12/60s  ·  R: chơi lại');
  });
  it('a kill game: the kills are inside the goal ("Hạ 12/40"), not shown twice', () => {
    const line = hudLine(kill, base);
    expect(line).toBe('Máu 4/5  ·  Điểm 31  ·  Hạ 12/40  ·  R: chơi lại');
    expect(line).not.toContain('Mục tiêu');
    expect(line.match(/Hạ/g)).toHaveLength(1);
  });
  it('starts at zero', () => {
    expect(hudLine(survive, { hp: 5, maxHp: 5, score: 0, kills: 0, seconds: 0 })).toContain('Sống sót 0/60s');
    expect(hudLine(kill, { hp: 5, maxHp: 5, score: 0, kills: 0, seconds: 0 })).toContain('Hạ 0/40');
  });
});

describe('the banner timing', () => {
  it('is fully visible for 2.5 s, fades over the last half second, and is gone at 3 s', () => {
    expect(BANNER_MS).toBe(3000);
    expect(BANNER_FADE_MS).toBe(500);
    expect(bannerAlpha(0)).toBe(1);
    expect(bannerAlpha(1000)).toBe(1);
    expect(bannerAlpha(2500)).toBe(1);
    expect(bannerAlpha(2750)).toBeCloseTo(0.5, 10);
    expect(bannerAlpha(2999)).toBeGreaterThan(0);
    expect(bannerAlpha(2999)).toBeLessThan(0.01);
    expect(bannerAlpha(3000)).toBe(0);
    expect(bannerAlpha(60_000)).toBe(0);
  });
  it('never rises again and treats nonsense as gone', () => {
    let last = 1;
    for (let ms = 0; ms <= 3200; ms += 25) { const now = bannerAlpha(ms); expect(now).toBeLessThanOrEqual(last); last = now; }
    expect(bannerAlpha(-5)).toBe(0);
    expect(bannerAlpha(Number.NaN)).toBe(0);
  });
});

describe('the banner color', () => {
  it('contrast ratio follows WCAG (black on white 21, same color 1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });
  it('uses the theme accent when it stands out from the ground by 3:1, white otherwise', () => {
    const bright = { background: '#121820', accent: '#6c8ba8' };
    expect(contrastRatio(bright.accent, bright.background)).toBeGreaterThanOrEqual(3);
    expect(bannerTextColor(bright)).toBe('#6c8ba8');
    const dull = { background: '#2a2118', accent: '#3a2f22' };
    expect(contrastRatio(dull.accent, dull.background)).toBeLessThan(3);
    expect(bannerTextColor(dull)).toBe('#ffffff');
  });
  it('every theme of the hand-made levels gets a color that reads on its background (3:1 at least)', () => {
    for (const level of Object.values(SHOOTER_LEVELS)) {
      expect(contrastRatio(bannerTextColor(level.theme), level.theme.background), level.title).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the weapon in words', () => {
  it('fast: 200 ms or less', () => {
    expect(weaponSummary(weapon(150)).label).toBe('Bắn liên tục');
    expect(weaponSummary(weapon(200)).label).toBe('Bắn liên tục');
    expect(weaponSummary(weapon(80)).label).toBe('Bắn liên tục');
  });
  it('slow: 500 ms or more', () => {
    expect(weaponSummary(weapon(500)).label).toBe('Bắn chậm, sát thương lớn');
    expect(weaponSummary(weapon(600, { damage: 3 })).label).toBe('Bắn chậm, sát thương lớn');
  });
  it('in between: one shot at a time', () => {
    expect(weaponSummary(weapon(201)).label).toBe('Bắn từng phát');
    expect(weaponSummary(weapon(300)).label).toBe('Bắn từng phát');
    expect(weaponSummary(weapon(499)).label).toBe('Bắn từng phát');
  });
  it('the detail line gives seconds per shot (comma), damage and range from the numbers', () => {
    expect(weaponSummary(weapon(300)).detail).toBe('mỗi 0,3 giây một phát · sát thương 1 · tầm 600');
    expect(weaponSummary(weapon(150, { range: 500 })).detail).toBe('mỗi 0,15 giây một phát · sát thương 1 · tầm 500');
    expect(weaponSummary(weapon(600, { damage: 3, range: 700 })).detail).toBe('mỗi 0,6 giây một phát · sát thương 3 · tầm 700');
    expect(weaponSummary(weapon(1000)).detail).toBe('mỗi 1 giây một phát · sát thương 1 · tầm 600');
    expect(weaponSummary(weapon(250)).detail).toContain('mỗi 0,25 giây');
  });
});

describe('the level card', () => {
  it('a survive level: goal, health, most enemies, weapon', () => {
    const info = levelInfo(SHOOTER_LEVELS.arena);
    expect(info).toEqual({
      goal: 'Sống sót 60 giây', maxHealth: 5, maxEnemies: totalScheduledEnemies(SHOOTER_LEVELS.arena),
      weapon: 'Bắn từng phát', weaponDetail: 'mỗi 0,3 giây một phát · sát thương 1 · tầm 600', extras: [],
    });
    expect(info.maxEnemies).toBe(103); // 8+6+14+10+18+12+1+20+14
  });
  it('a kill level reads its own numbers', () => {
    const info = levelInfo(SHOOTER_LEVELS.pillars);
    expect(info.goal).toBe('Hạ 50 quái');
    expect(info.maxHealth).toBe(6);
    expect(info.maxEnemies).toBe(totalScheduledEnemies(SHOOTER_LEVELS.pillars));
  });
  it('follows the level, not a name: change the data, the card changes', () => {
    const level: ShooterLevel = { ...SHOOTER_LEVELS.arena, weapon: weapon(150, { range: 500 }), player: { ...SHOOTER_LEVELS.arena.player, hp: 8 }, win: kill };
    const info = levelInfo(level);
    expect(info).toMatchObject({ goal: 'Hạ 40 quái', maxHealth: 8, weapon: 'Bắn liên tục' });
  });
});

describe('the new weapons in words, read from the data', () => {
  it('pellets above 1: "Bắn chùm", with the number of pellets and damage per pellet', () => {
    const shotgun = weaponSummary(weapon(800, { range: 320, pellets: 6, spreadDeg: 36, bulletSpeed: 650 }));
    expect(shotgun.label).toBe('Bắn chùm');
    expect(shotgun.detail).toBe('6 viên mỗi phát · mỗi 0,8 giây · sát thương 1 mỗi viên · tầm 320');
    expect(weaponSummary(weapon(700, { pellets: 4, damage: 2 })).detail).toBe('4 viên mỗi phát · mỗi 0,7 giây · sát thương 2 mỗi viên · tầm 600');
  });
  it('pierce above 1: "Đạn xuyên", with how many enemies', () => {
    const piercing = weaponSummary(weapon(500, { damage: 2, range: 800, pierce: 3, bulletSpeed: 800 }));
    expect(piercing.label).toBe('Đạn xuyên');
    expect(piercing.detail).toBe('xuyên tối đa 3 quái · mỗi 0,5 giây một phát · sát thương 2 · tầm 800');
  });
  it('pellets 1 and pierce 1 (or absent) are the old kinds, by cooldown as before', () => {
    expect(weaponSummary(weapon(300, { pellets: 1, pierce: 1 })).label).toBe('Bắn từng phát');
    expect(weaponSummary(weapon(150, { pellets: 1 })).label).toBe('Bắn liên tục');
    expect(weaponSummary(weapon(600, { pierce: 1 })).label).toBe('Bắn chậm, sát thương lớn');
  });
});

describe('the extra lines of the level card', () => {
  const base = SHOOTER_LEVELS.arena;
  it('none for a plain level', () => { expect(levelInfo(base).extras).toEqual([]); });
  it('shooting enemies: one line, whenever the schedule has a kind that shoots', () => {
    const level: ShooterLevel = { ...base, waves: [...base.waves, { atMs: 5000, type: 'spitter', count: 2 }] };
    expect(levelInfo(level).extras).toEqual(['Có quái bắn xa (né đạn của chúng)']);
  });
  it('health drops: the percentage of that level', () => {
    expect(levelInfo({ ...base, drops: { healthChancePct: 12 } }).extras).toEqual(['Quái bị hạ có thể rơi vật phẩm hồi máu (12%)']);
    expect(levelInfo({ ...base, drops: { healthChancePct: 25 } }).extras).toEqual(['Quái bị hạ có thể rơi vật phẩm hồi máu (25%)']);
    expect(levelInfo({ ...base, drops: { healthChancePct: 0 } }).extras).toEqual([]);
  });
  it('both, in that order', () => {
    const level: ShooterLevel = { ...base, drops: { healthChancePct: 25 }, waves: [{ atMs: 1000, type: 'spitter', count: 1 }] };
    expect(levelInfo(level).extras).toEqual(['Có quái bắn xa (né đạn của chúng)', 'Quái bị hạ có thể rơi vật phẩm hồi máu (25%)']);
  });
  it('the hand-made levels: shotgun-pit says "Bắn chùm", spitters has the shooting line, medic the drop line', () => {
    expect(levelInfo(SHOOTER_LEVELS['shotgun-pit']).weapon).toBe('Bắn chùm');
    expect(levelInfo(SHOOTER_LEVELS.spitters).extras).toContain('Có quái bắn xa (né đạn của chúng)');
    expect(levelInfo(SHOOTER_LEVELS.medic).extras).toEqual(['Quái bị hạ có thể rơi vật phẩm hồi máu (25%)']);
  });
});

describe('the boss in words (Stage 4C)', () => {
  const boss = { type: 'boss' } as const;
  it('the goal is "Hạ boss" in the sentence, the banner and the HUD (no number; the boss bar is the progress)', () => {
    expect(goalSentence(boss)).toBe('Hạ boss');
    expect(bannerTitle(boss)).toBe('MỤC TIÊU: Hạ boss');
    expect(goalProgress(boss, { kills: 30, seconds: 99 })).toBe('Hạ boss');
    expect(hudLine(boss, { hp: 4, maxHp: 6, score: 17, kills: 3, seconds: 12 })).toBe('Máu 4/6  ·  Điểm 17  ·  Hạ boss  ·  R: chơi lại');
  });
  it('the boss bar: share, percent, label, and "CUỒNG NỘ" only when enraged', () => {
    expect(bossBar(40, 40, false)).toEqual({ share: 1, percent: 100, label: 'BOSS', note: '' });
    expect(bossBar(10, 40, false)).toEqual({ share: 0.25, percent: 25, label: 'BOSS', note: '' });
    expect(bossBar(20, 40, true)).toEqual({ share: 0.5, percent: 50, label: 'BOSS', note: 'CUỒNG NỘ' });
    expect(bossBar(-3, 40, true).share).toBe(0);
    expect(bossBar(99, 40, false).share).toBe(1);
    expect(bossBar(5, 0, false).share).toBe(0);
  });
  it('the warning lasts 120 ticks of game time: full for 90, fading to 0 at 120', () => {
    expect(BOSS_WARNING_TEXT).toBe('BOSS XUẤT HIỆN!');
    expect(bossWarningAlpha(0)).toBe(1);
    expect(bossWarningAlpha(90)).toBe(1);
    expect(bossWarningAlpha(105)).toBeCloseTo(0.5, 10);
    expect(bossWarningAlpha(119)).toBeGreaterThan(0);
    expect(bossWarningAlpha(119)).toBeLessThan(0.05);
    expect(bossWarningAlpha(120)).toBe(0);
    expect(bossWarningAlpha(500)).toBe(0);
    expect(bossWarningAlpha(-1)).toBe(0);
    expect(bossWarningAlpha(Number.NaN)).toBe(0);
    let last = 1;
    for (let t = 0; t <= 130; t += 1) { const a = bossWarningAlpha(t); expect(a).toBeLessThanOrEqual(last); last = a; }
  });
  it('the level card has a boss line from the boss\'s own data, with its real hit points; the boss counts in "most enemies"', () => {
    const crusher = levelInfo(SHOOTER_LEVELS['boss-crusher']);
    expect(crusher.goal).toBe('Hạ boss');
    expect(crusher.extras).toEqual(['Boss cuối: quái khổng lồ, lao vào bạn (máu 40)']);
    expect(crusher.maxEnemies).toBe(6 + 3 + 1 + 6);
    const gunner = levelInfo(SHOOTER_LEVELS['boss-gunner']);
    expect(gunner.extras).toEqual(['Boss cuối: bắn đạn quạt và vòng đạn (máu 24)']); // (the gunner is not a "shooting enemy": no spitter line)
    expect(gunner.maxEnemies).toBe(2 + 3 + 1 + 3);
    // no bossHp in the level: the kind's own hit points
    const { bossHp: _drop, ...plain } = SHOOTER_LEVELS['boss-crusher'];
    void _drop;
    expect(levelInfo(plain).extras).toEqual([`Boss cuối: quái khổng lồ, lao vào bạn (máu ${ENEMY_TYPES.crusher.hp})`]);
  });
  it('a level without a boss has no boss line', () => {
    expect(levelInfo(SHOOTER_LEVELS.arena).extras.some((e) => e.startsWith('Boss'))).toBe(false);
  });
});
