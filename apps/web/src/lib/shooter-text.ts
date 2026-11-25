// Every sentence the player reads about a shooter level: the goal, the banner at the start, the HUD
// line and the "Thông tin màn" card. Pure functions of the level (no Phaser, no DOM), so they are
// tested without a browser and the game and the page always say the same thing.
import { rangedOf, totalScheduledEnemies, type ShooterLevel } from '@game-creator/contracts';

type Win = ShooterLevel['win'];
type Weapon = ShooterLevel['weapon'];

/** "Sống sót 60 giây" or "Hạ 40 quái". */
export const goalSentence = (win: Win): string => (win.type === 'survive' ? `Sống sót ${win.seconds} giây` : `Hạ ${win.count} quái`);

// --- the banner shown for the first seconds of every game (and after every restart) ---
export const BANNER_MS = 3000;
export const BANNER_FADE_MS = 500;
export const bannerTitle = (win: Win): string => `MỤC TIÊU: ${goalSentence(win)}`;
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

/** "Sống sót 12/60s" or "Hạ 12/40": the goal with its progress. */
export function goalProgress(win: Win, hud: Pick<HudInput, 'kills' | 'seconds'>): string {
  return win.type === 'survive' ? `Sống sót ${Math.min(Math.floor(hud.seconds), win.seconds)}/${win.seconds}s` : `Hạ ${hud.kills}/${win.count}`;
}

/** Health, score, then the goal. A survive game also shows the kills (a kill game shows them in the goal). */
export function hudLine(win: Win, hud: HudInput): string {
  const parts = [`Máu ${hud.hp}/${hud.maxHp}`, `Điểm ${hud.score}`];
  if (win.type === 'survive') parts.push(`Hạ ${hud.kills}`);
  parts.push(goalProgress(win, hud), 'R: chơi lại');
  return parts.join('  ·  ');
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

export interface LevelInfo { goal: string; maxHealth: number; maxEnemies: number; weapon: string; weaponDetail: string; extras: string[] }

/** What the card shows, computed from the level alone. */
export function levelInfo(level: ShooterLevel): LevelInfo {
  const weapon = weaponSummary(level.weapon);
  const extras: string[] = [];
  if (level.waves.some((wave) => rangedOf(wave.type) !== undefined)) extras.push('Có quái bắn xa (né đạn của chúng)');
  const drop = level.drops?.healthChancePct ?? 0;
  if (drop > 0) extras.push(`Quái bị hạ có thể rơi vật phẩm hồi máu (${drop}%)`);
  return { goal: goalSentence(level.win), maxHealth: level.player.hp, maxEnemies: totalScheduledEnemies(level), weapon: weapon.label, weaponDetail: weapon.detail, extras };
}
