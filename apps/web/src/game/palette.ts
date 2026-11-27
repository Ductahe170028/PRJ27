// The named colors the shooter's code uses, in one place. Theme colors (a level's own background, enemy, accent...) come from the
// level data and are not here; these are the fixed ones: the dark plates behind text, white, the danger red, the health green.
export const PALETTE = {
  /** The dark plate behind the HUD, the banner and the bars. */
  ink: 0x060d18,
  /** The dark outline of a sprite and the canvas background. */
  inkSoft: 0x101b30,
  white: 0xffffff,
  /** Low health, a hit base, a warning. */
  danger: 0xff4d4d,
  /** A health pickup. */
  heal: 0x4ade80,
  /** The boss bar's "enraged" note. */
  gold: 0xffd166,
} as const;

/** The same colors as CSS strings, for Phaser text styles. */
export const CSS = { ink: '#060d18', inkSoft: '#101b30', white: '#ffffff', text: '#d6e1ee', gold: '#ffd166' } as const;

export const color = (hex: string) => Number.parseInt(hex.slice(1), 16);
/** Scales each channel of #rrggbb by `factor` (<1 darker, >1 lighter, capped). */
export function shade(hex: string, factor: number): number {
  const value = color(hex);
  const channel = (shift: number) => Math.min(255, Math.round(((value >> shift) & 255) * factor));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
