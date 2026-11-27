// Every sentence the player reads about a shooter level: the goal, the banner at the start, the HUD
// line and the "Thông tin màn" card. Pure functions of the level (no Phaser, no DOM), so they are
// tested without a browser and the game and the page always say the same thing.
import { ENEMY_TYPES, bossOf, bossWaveOf, rangedOf, sameWeapon, totalScheduledEnemies, type ShooterLevel } from '@game-creator/contracts';

type Win = ShooterLevel['win'];
type Weapon = ShooterLevel['weapon'];

/** "Sống sót 60 giây", "Hạ 40 quái" or "Hạ boss"; with a base to defend, "Bảo vệ căn cứ: Sống sót 60 giây" and so on. */
export const goalSentence = (win: Win, withBase = false): string => {
  const goal = win.type === 'survive' ? `Sống sót ${win.seconds} giây` : win.type === 'kill' ? `Hạ ${win.count} quái` : 'Hạ boss';
  return withBase ? `Bảo vệ căn cứ: ${goal}` : goal;
};

// --- the banner shown for the first seconds of every game (and after every restart) ---
export const BANNER_MS = 3000;
export const BANNER_FADE_MS = 500;
export const bannerTitle = (win: Win, withBase = false): string => `MỤC TIÊU: ${goalSentence(win, withBase)}`;
/** A title longer than this does not fit on one line at the banner's size, and is shown on two. */
export const BANNER_ONE_LINE_MAX = 34;
/** The lines the banner is drawn on: the title as it is, or "MỤC TIÊU:" and then the goal when the title is long (a base to defend). */
export function bannerLines(title: string): string[] {
  const cut = title.indexOf(': ');
  return title.length <= BANNER_ONE_LINE_MAX || cut < 0 ? [title] : [title.slice(0, cut + 1), title.slice(cut + 2)];
}
export const BANNER_HINT = 'WASD di chuyển · chuột ngắm và bắn · R chơi lại';

/** How opaque the banner is `elapsedMs` after the game started: fully for the first 2.5 s, fading out over
 * the last half second, gone from 3 s on. */
export function bannerAlpha(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= BANNER_MS) return 0;
  const fadeStart = BANNER_MS - BANNER_FADE_MS;
  return elapsedMs <= fadeStart ? 1 : (BANNER_MS - elapsedMs) / BANNER_FADE_MS;
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
};
/** WCAG contrast ratio of two #rrggbb colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export const BANNER_MIN_CONTRAST = 3;
export const BANNER_FALLBACK_COLOR = '#ffffff';
/** The theme's accent when it stands out from the background by at least 3:1, else white. The banner
 * also has a dark outline and a dark plate behind it, so it reads on walls as well. */
export const bannerTextColor = (theme: Pick<ShooterLevel['theme'], 'accent' | 'background'>): string =>
  (contrastRatio(theme.accent, theme.background) >= BANNER_MIN_CONTRAST ? theme.accent : BANNER_FALLBACK_COLOR);

// --- the HUD line ---
export interface HudInput { hp: number; maxHp: number; score: number; kills: number; seconds: number }

/** "Sống sót 12/60s", "Hạ 12/40" or "Hạ boss" (the boss bar is its progress): the goal with its progress. */
export function goalProgress(win: Win, hud: Pick<HudInput, 'kills' | 'seconds'>, withBase = false): string {
  const goal = win.type === 'boss' ? 'Hạ boss'
    : win.type === 'survive' ? `Sống sót ${Math.min(Math.floor(hud.seconds), win.seconds)}/${win.seconds}s` : `Hạ ${hud.kills}/${win.count}`;
  return withBase ? `Giữ căn cứ · ${goal}` : goal;
}

/** Health, score, then the goal. A survive game also shows the kills (a kill game shows them in the goal). */
export function hudLine(win: Win, hud: HudInput, withBase = false): string {
  const parts = [`Máu ${hud.hp}/${hud.maxHp}`, `Điểm ${hud.score}`];
  if (win.type === 'survive') parts.push(`Hạ ${hud.kills}`);
  parts.push(goalProgress(win, hud, withBase), 'R: chơi lại');
  return parts.join('  ·  ');
}

// --- the boss bar and the warning when the boss appears ---
/** The warning "BOSS XUẤT HIỆN!" is shown for 2 s of game time (120 ticks), fading out over the last half second (30 ticks). */
export const BOSS_WARNING_TICKS = 120;
export const BOSS_WARNING_FADE_TICKS = 30;
export const BOSS_WARNING_TEXT = 'BOSS XUẤT HIỆN!';

/** How opaque the warning is `ticksSince` game ticks after the boss appeared: 1, fading to 0 at 120, gone after. */
export function bossWarningAlpha(ticksSince: number): number {
  if (!(ticksSince >= 0) || ticksSince >= BOSS_WARNING_TICKS) return 0;
  const fadeStart = BOSS_WARNING_TICKS - BOSS_WARNING_FADE_TICKS;
  return ticksSince <= fadeStart ? 1 : (BOSS_WARNING_TICKS - ticksSince) / BOSS_WARNING_FADE_TICKS;
}

export interface BossBar { share: number; percent: number; label: string; note: string }
/** The boss bar: how full it is (0 to 1, from hit points over maximum), the label, and "CUỒNG NỘ" once it is enraged. */
export function bossBar(hp: number, maxHp: number, enraged: boolean): BossBar {
  const share = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
  return { share, percent: Math.round(share * 100), label: 'BOSS', note: enraged ? 'CUỒNG NỘ' : '' };
}

// --- the base's bar, and where the two bars stand ---
/** The base's bar is at the top right of the HUD strip (the strip is the top 70 px of the field), with its label to the left of it:
 * 260 px wide, at least 60 px from the longest HUD line. The boss's bar is under the strip (y 73 to 93, x 236 to 724). They never
 * touch: the base's bar ends at y 55. */
export const BASE_BAR = { x: 678, y: 41, width: 260, height: 14 } as const;
export const BASE_BAR_LABEL = { x: 670, y: 48 } as const;
export const BOSS_BAR_PLATE = { x: 236, y: 73, width: 488, height: 20 } as const;
/** The dark plate behind the base's bar (2 px more on every side). */
export const BASE_BAR_PLATE = { x: BASE_BAR.x - 2, y: BASE_BAR.y - 2, width: BASE_BAR.width + 4, height: BASE_BAR.height + 4 } as const;
export const HUD_STRIP_HEIGHT = 70;
type Box = { x: number; y: number; width: number; height: number };
/** Whether two boxes share any area. */
export const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The base is "low" (its rim flashes red) at or below this share of its hit points. */
export const BASE_LOW_SHARE = 0.3;
export interface BaseBar { share: number; percent: number; label: string; low: boolean }
/** The base's bar: how full it is (0 to 1, from hit points over maximum), the label, and whether it is low. */
export function baseBar(hp: number, maxHp: number): BaseBar {
  const share = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
  return { share, percent: Math.round(share * 100), label: 'CĂN CỨ', low: share <= BASE_LOW_SHARE };
}

/** The line under "Game over" (the first words of the result's detail): why the game was lost. Without a base it is what it always was. */
export function loseReason(lostBy: 'player' | 'base' | undefined, withBase: boolean): string {
  if (lostBy === 'base') return 'Căn cứ đã bị phá.';
  return withBase ? 'Bạn đã bị hạ.' : 'Bạn đã hết máu.';
}

// --- the "Thông tin màn" card ---
/** Seconds as Vietnamese people write them: 0,3 and 1 (never 0.30000000000000004). */
const seconds = (ms: number) => String(Math.round(ms / 10) / 100).replace('.', ',');

export const RAPID_MAX_COOLDOWN_MS = 200;
export const SLOW_MIN_COOLDOWN_MS = 500;

export function weaponSummary(weapon: Weapon): { label: string; detail: string } {
  // New weapons are recognised by their data, never by a name.
  const pellets = weapon.pellets ?? 1;
  const pierce = weapon.pierce ?? 1;
  if (pellets > 1) return { label: 'Bắn chùm', detail: `${pellets} viên mỗi phát · mỗi ${seconds(weapon.cooldownMs)} giây · sát thương ${weapon.damage} mỗi viên · tầm ${weapon.range}` };
  if (pierce > 1) return { label: 'Đạn xuyên', detail: `xuyên tối đa ${pierce} quái · mỗi ${seconds(weapon.cooldownMs)} giây một phát · sát thương ${weapon.damage} · tầm ${weapon.range}` };
  const label = weapon.cooldownMs <= RAPID_MAX_COOLDOWN_MS ? 'Bắn liên tục'
    : weapon.cooldownMs >= SLOW_MIN_COOLDOWN_MS ? 'Bắn chậm, sát thương lớn' : 'Bắn từng phát';
  return { label, detail: `mỗi ${seconds(weapon.cooldownMs)} giây một phát · sát thương ${weapon.damage} · tầm ${weapon.range}` };
}

/** `arsenal` (the weapons the player can switch to, and the one it starts with) is only there for a level that has one. */
export interface LevelInfo { goal: string; maxHealth: number; maxEnemies: number; weapon: string; weaponDetail: string; extras: string[]; arsenal?: string[] }

/** What the card shows, computed from the level alone. */
export function levelInfo(level: ShooterLevel): LevelInfo {
  const weapon = weaponSummary(level.weapon);
  const extras: string[] = [];
  if (level.waves.some((wave) => rangedOf(wave.type) !== undefined)) extras.push('Có quái bắn xa (né đạn của chúng)');
  const drop = level.drops?.healthChancePct ?? 0;
  if (drop > 0) extras.push(`Quái bị hạ có thể rơi vật phẩm hồi máu (${drop}%)`);
  const bossWave = bossWaveOf(level);
  const boss = bossWave && bossOf(bossWave.type);
  if (bossWave && boss) {
    const hp = level.bossHp ?? ENEMY_TYPES[bossWave.type].hp;
    // told apart by what the boss does (its data), never by its name
    if (boss.charge) extras.push(`Boss cuối: quái khổng lồ, lao vào bạn (máu ${hp})`);
    else if (boss.volleys) extras.push(`Boss cuối: bắn đạn quạt và vòng đạn (máu ${hp})`);
    else extras.push(`Boss cuối (máu ${hp})`);
  }
  if (level.base) extras.push(`Có căn cứ cần bảo vệ (máu ${level.base.hp}): thua nếu căn cứ bị phá`);
  return { goal: goalSentence(level.win, level.base !== undefined), maxHealth: level.player.hp, maxEnemies: totalScheduledEnemies(level), weapon: weapon.label, weaponDetail: weapon.detail, extras, ...(level.arsenal ? { arsenal: arsenalLines(level) } : {}) };
}

// --- Stage 6A: switching weapons (keys 1-5, the mouse wheel) and the weapon bar ---------------------------------------------------
/** The names the screen gives to the five weapons (by the id of an arsenal entry, which is only a name for the screen: the simulation never reads it). */
export const WEAPON_NAMES: Record<string, string> = { pistol: 'Súng ngắn', shotgun: 'Shotgun', piercing: 'Súng xuyên', rapid: 'Bắn nhanh', heavy: 'Súng nặng' };
export const weaponName = (id: string) => WEAPON_NAMES[id] ?? id;
/** The third line of the banner and of the hidden #game-banner, only in a level with an arsenal. */
export const ARSENAL_HINT = '1–5 hoặc cuộn chuột: đổi súng';

/** The slot a key asks for: the digit row and the number pad, 1 to 5, and no more slots than the arsenal has. Anything else is not a weapon key. */
export function slotForKey(code: string, count: number): number | undefined {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!match) return undefined;
  const slot = Number(match[1]) - 1;
  return slot < count ? slot : undefined;
}

/** The slot `steps` places on from `current`, going round (a wheel that goes past the last weapon comes back to the first). */
export const wrapSlot = (current: number, steps: number, count: number) => (((current + steps) % count) + count) % count;

/** The mouse wheel gives many small numbers on a trackpad and 100 a notch on a mouse. Adds `deltaY` to what is already stored and gives one
 * step (+1 forward = down, -1 back = up) per WHEEL_NOTCH, keeping the rest. At most one step per event. */
export const WHEEL_NOTCH = 60;
export function wheelStep(stored: number, deltaY: number): { step: -1 | 0 | 1; rest: number } {
  const total = stored + (Number.isFinite(deltaY) ? deltaY : 0);
  // what is left after a step is held below one notch, so a run of fast notches cannot store up steps for later
  if (total >= WHEEL_NOTCH) return { step: 1, rest: Math.min(total - WHEEL_NOTCH, WHEEL_NOTCH - 1) };
  if (total <= -WHEEL_NOTCH) return { step: -1, rest: Math.max(total + WHEEL_NOTCH, 1 - WHEEL_NOTCH) };
  return { step: 0, rest: total };
}

/** Where the bar of weapons stands: centered along the bottom of the field, one cell of 40 x 40 per weapon, 6 px apart. */
export const WEAPON_CELL = 40;
export const WEAPON_GAP = 6;
export const WEAPON_BAR_BOTTOM = 540 - 8;
export interface WeaponBarLayout { plate: { x: number; y: number; width: number; height: number }; cells: Array<{ x: number; y: number; key: string }> }
export function weaponBarLayout(count: number): WeaponBarLayout {
  const width = count * WEAPON_CELL + (count - 1) * WEAPON_GAP;
  const left = Math.round(480 - width / 2);
  const top = WEAPON_BAR_BOTTOM - WEAPON_CELL;
  return {
    plate: { x: left - 6, y: top - 6, width: width + 12, height: WEAPON_CELL + 12 },
    cells: Array.from({ length: count }, (_, i) => ({ x: left + i * (WEAPON_CELL + WEAPON_GAP), y: top, key: String(i + 1) })),
  };
}

/** How much of the wait is left, 1 (just started) to 0 (ready): the longer of the shot clock and the switch, over the length of the
 * wait that was started (the weapon's cooldown, or the switch if that takes longer). */
export function waitShare(tick: number, nextShotTick: number, equipUntilTick: number, cooldownTicks: number, equipTicks: number): number {
  const left = Math.max(nextShotTick - tick, equipUntilTick - tick, 0);
  const total = Math.max(cooldownTicks, equipTicks, 1);
  return Math.min(1, left / total);
}

/** The line about the weapons for the level card (only with an arsenal): the list, with the weapon the player starts with marked. */
export function arsenalLines(level: Pick<ShooterLevel, 'arsenal' | 'weapon'>): string[] {
  const arsenal = level.arsenal;
  if (!arsenal) return [];
  const start = arsenal.findIndex((entry) => sameWeapon(entry.weapon, level.weapon));
  const names = arsenal.map((entry, i) => `${i + 1} ${weaponName(entry.id)}`).join(', ');
  return [`Có ${arsenal.length} súng, đổi bằng phím 1–${arsenal.length} hoặc cuộn chuột: ${names}`, `Súng lúc đầu: ${weaponName(arsenal[Math.max(0, start)]!.id)}`];
}
