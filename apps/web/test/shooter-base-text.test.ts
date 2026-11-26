import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS, createSim, step } from '@game-creator/contracts';
import {
  BANNER_ONE_LINE_MAX, BASE_BAR, BASE_BAR_PLATE, BASE_LOW_SHARE, BOSS_BAR_PLATE, HUD_STRIP_HEIGHT, bannerLines, bannerTitle, baseBar, boxesOverlap, goalProgress, goalSentence,
  hudLine, levelInfo, loseReason,
} from '../src/lib/shooter-text';

const survive = { type: 'survive', seconds: 60 } as const;
const kill = { type: 'kill', count: 40 } as const;
const boss = { type: 'boss' } as const;
const hud = { hp: 5, maxHp: 6, score: 120, kills: 12, seconds: 12.9 };

describe('the goal with a base to defend', () => {
  it('has the base in front, for the three kinds of goal', () => {
    expect(goalSentence(survive, true)).toBe('Bảo vệ căn cứ: Sống sót 60 giây');
    expect(goalSentence(kill, true)).toBe('Bảo vệ căn cứ: Hạ 40 quái');
    expect(goalSentence(boss, true)).toBe('Bảo vệ căn cứ: Hạ boss');
  });

  it('without a base not a word changes', () => {
    expect(goalSentence(survive)).toBe('Sống sót 60 giây');
    expect(goalSentence(survive, false)).toBe('Sống sót 60 giây');
    expect(bannerTitle(kill)).toBe('MỤC TIÊU: Hạ 40 quái');
    expect(goalProgress(survive, hud)).toBe('Sống sót 12/60s');
    expect(hudLine(kill, hud)).toBe('Máu 5/6  ·  Điểm 120  ·  Hạ 12/40  ·  R: chơi lại');
    expect(hudLine(survive, hud, false)).toBe(hudLine(survive, hud));
    expect(loseReason(undefined, false)).toBe('Bạn đã hết máu.');
    expect(loseReason('player', false)).toBe('Bạn đã hết máu.');
  });

  it('the banner says it, and goes on two lines when it is long, never past its frame', () => {
    expect(bannerTitle(survive, true)).toBe('MỤC TIÊU: Bảo vệ căn cứ: Sống sót 60 giây');
    expect(bannerTitle(boss, true)).toBe('MỤC TIÊU: Bảo vệ căn cứ: Hạ boss');
    // the short one (33 characters) still fits on one line
    expect(bannerLines(bannerTitle(boss, true))).toEqual(['MỤC TIÊU: Bảo vệ căn cứ: Hạ boss']);
    for (const win of [survive, kill]) {
      const lines = bannerLines(bannerTitle(win, true));
      expect(lines, JSON.stringify(win)).toHaveLength(2);
      expect(lines[0]).toBe('MỤC TIÊU:');
      expect(lines.join(' ')).toBe(bannerTitle(win, true));
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(BANNER_ONE_LINE_MAX);
    }
    // a title without a base fits on one line, as before
    for (const win of [survive, kill, boss]) expect(bannerLines(bannerTitle(win))).toEqual([bannerTitle(win)]);
    expect(bannerLines('MỤC TIÊU')).toEqual(['MỤC TIÊU']);
  });

  it('the HUD line says "Giữ căn cứ" with the progress, and is not much longer than the longest line there is', () => {
    expect(goalProgress(survive, hud, true)).toBe('Giữ căn cứ · Sống sót 12/60s');
    expect(goalProgress(kill, hud, true)).toBe('Giữ căn cứ · Hạ 12/40');
    expect(goalProgress(boss, hud, true)).toBe('Giữ căn cứ · Hạ boss');
    expect(hudLine(survive, hud, true)).toBe('Máu 5/6  ·  Điểm 120  ·  Hạ 12  ·  Giữ căn cứ · Sống sót 12/60s  ·  R: chơi lại');
    const longest = hudLine(survive, { hp: 10, maxHp: 10, score: 99999, kills: 999, seconds: 179 }, true);
    expect(longest.length).toBeLessThanOrEqual(hudLine(survive, { hp: 10, maxHp: 10, score: 99999, kills: 999, seconds: 179 }).length + 'Giữ căn cứ · '.length);
    expect(longest.length).toBeLessThan(95); // at 13 px that is about 560 px of the 960: the base's bar starts at 678
  });

  it('why the game was lost', () => {
    expect(loseReason('base', true)).toBe('Căn cứ đã bị phá.');
    expect(loseReason('player', true)).toBe('Bạn đã bị hạ.');
    expect(loseReason(undefined, true)).toBe('Bạn đã bị hạ.');
  });
});

describe('the base bar', () => {
  it('is full at the maximum, empty at zero, and low at 30% and under', () => {
    expect(baseBar(40, 40)).toEqual({ share: 1, percent: 100, label: 'CĂN CỨ', low: false });
    expect(baseBar(0, 40)).toEqual({ share: 0, percent: 0, label: 'CĂN CỨ', low: true });
    expect(baseBar(20, 40)).toMatchObject({ share: 0.5, percent: 50, low: false });
    expect(BASE_LOW_SHARE).toBe(0.3);
    expect(baseBar(12, 40).low).toBe(true); // exactly 30%
    expect(baseBar(13, 40).low).toBe(false);
    expect(baseBar(7, 3)).toMatchObject({ share: 1 }); // never above full
    expect(baseBar(-2, 40)).toMatchObject({ share: 0 });
    expect(baseBar(5, 0)).toMatchObject({ share: 0 });
  });

  it('stands in the HUD strip, at the right, and never touches the boss bar', () => {
    expect(BASE_BAR.width).toBe(260);
    expect(BASE_BAR_PLATE.y + BASE_BAR_PLATE.height).toBeLessThanOrEqual(HUD_STRIP_HEIGHT);
    expect(BASE_BAR_PLATE.x + BASE_BAR_PLATE.width).toBeLessThanOrEqual(960);
    expect(BASE_BAR.x + BASE_BAR.width).toBeGreaterThanOrEqual(930); // at the right
    expect(boxesOverlap(BASE_BAR_PLATE, BOSS_BAR_PLATE)).toBe(false);
    expect(boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(boxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false); // touching edges share no area
  });
});

describe('the card of a level with a base', () => {
  it('says the goal with the base and has a line about the base; the hand levels without one are as they were', () => {
    const info = levelInfo(SHOOTER_LEVELS['base-siege']);
    expect(info.goal).toBe('Bảo vệ căn cứ: Sống sót 60 giây');
    expect(info.extras).toContain('Có căn cứ cần bảo vệ (máu 100): thua nếu căn cứ bị phá');
    const withBoss = levelInfo(SHOOTER_LEVELS['base-boss']);
    expect(withBoss.goal).toBe('Bảo vệ căn cứ: Hạ boss');
    expect(withBoss.extras.some((line) => line.startsWith('Boss cuối'))).toBe(true);
    expect(withBoss.extras).toContain('Có căn cứ cần bảo vệ (máu 50): thua nếu căn cứ bị phá');
    for (const name of ['arena', 'pillars', 'boss-crusher', 'medic'] as const) {
      const plain = levelInfo(SHOOTER_LEVELS[name]);
      expect(plain.extras.some((line) => line.includes('căn cứ')), name).toBe(false);
      expect(plain.goal.startsWith('Bảo vệ'), name).toBe(false);
    }
  });

  it('"most enemies" is the same as for any level (the base is not an enemy)', () => {
    const level = SHOOTER_LEVELS['base-siege'];
    expect(levelInfo(level).maxEnemies).toBe(level.waves.reduce((sum, wave) => sum + wave.count, 0));
  });
});

describe('the state the scene reads', () => {
  it('a level with a base has its hit points and, once lost by it, who lost', () => {
    const state = createSim(SHOOTER_LEVELS['base-siege']);
    expect(state.base).toMatchObject({ hp: 100, maxHp: 100 });
    expect(baseBar(state.base!.hp, state.base!.maxHp).share).toBe(1);
    state.base!.hp = 0;
    step(state, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false });
    expect(state.status).toBe('lost');
    expect(loseReason(state.lostBy, true)).toBe('Căn cứ đã bị phá.');
  });
});
