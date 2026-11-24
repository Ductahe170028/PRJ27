import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS, totalScheduledEnemies, type ShooterLevel } from '@game-creator/contracts';
import {
  BANNER_FADE_MS, BANNER_HINT, BANNER_MS, bannerAlpha, bannerTextColor, bannerTitle, contrastRatio, goalProgress, goalSentence,
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
      weapon: 'Bắn từng phát', weaponDetail: 'mỗi 0,3 giây một phát · sát thương 1 · tầm 600',
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
