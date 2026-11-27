// Small drawing helpers shared by every procedural pack. Pure Canvas 2D calls on a context handed in; no randomness
// (variety comes from `hash32`), no DOM. Shapes get a dark outline so a sprite reads against any ground.
import type { AnimationSpec } from '@game-creator/contracts';

export type Ctx = CanvasRenderingContext2D;
export type Pt = readonly [number, number];

/** The dark outline color of every sprite. */
export const OUT = '#0b1220';

/** A small integer hash of up to three numbers: the same input always gives the same 32-bit unsigned result. */
export function hash32(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
/** A hash as a number in [0, 1). */
export const unit = (a: number, b = 0, c = 0): number => hash32(a, b, c) / 4294967296;
/** A hash as an integer in [lo, hi] (both included). */
export const span = (lo: number, hi: number, a: number, b = 0, c = 0): number => lo + (hash32(a, b, c) % (hi - lo + 1));

/** Top-left corner (px) of frame `i` in a grid of `columns` frames per row, starting at `offset`. */
export function frameOrigin(i: number, frame: { w: number; h: number }, columns: number, offset?: { x: number; y: number }): { x: number; y: number } {
  return { x: (offset?.x ?? 0) + (i % columns) * frame.w, y: (offset?.y ?? 0) + Math.floor(i / columns) * frame.h };
}

/** [start, start+1, ... start+count-1]. */
export const seq = (start: number, count: number): number[] => Array.from({ length: count }, (_, i) => start + i);
export const anim = (frames: number[], fps: number, loop: boolean): AnimationSpec => ({ frames, fps, loop });

// --- colors ------------------------------------------------------------------------------------------------------------------
const channels = (hex: string): [number, number, number] => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** Mixes #rrggbb `a` toward `b` by `t` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a); const [br, bg, bb] = channels(b);
  return `#${toHex(ar + (br - ar) * t)}${toHex(ag + (bg - ag) * t)}${toHex(ab + (bb - ab) * t)}`;
}
export const lighten = (hex: string, t: number) => mix(hex, '#ffffff', t);
export const darken = (hex: string, t: number) => mix(hex, '#000000', t);
/** #rrggbb as `rgba(...)` with an alpha. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
/** The same palette with every color mixed toward `hex` by `t`. */
export function tinted<T extends Record<string, string>>(pal: T, hex: string, t: number): T {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(pal)) out[key] = mix(value, hex, t);
  return out as T;
}
/** The palette pushed toward white: the "just hit" flash. */
export const flashed = <T extends Record<string, string>>(pal: T, amount = 0.8): T => tinted(pal, '#ffffff', amount);

// --- shapes (all outlined when `ow` > 0) -----------------------------------------------------------------------------------
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, ow = 1): void {
  if (ow > 0) { ctx.fillStyle = OUT; ctx.fillRect(x - ow, y - ow, w + ow * 2, h + ow * 2); }
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
}
export function oval(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, ow = 1, rot = 0): void {
  if (ow > 0) { ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(x, y, rx + ow, ry + ow, rot, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
}
export const disc = (ctx: Ctx, x: number, y: number, r: number, fill: string, ow = 1): void => oval(ctx, x, y, r, r, fill, ow);

function path(ctx: Ctx, pts: readonly Pt[], close: boolean): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  if (close) ctx.closePath();
}
export function poly(ctx: Ctx, pts: readonly Pt[], fill: string, ow = 1): void {
  if (ow > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = ow * 2; ctx.strokeStyle = OUT; path(ctx, pts, true); ctx.stroke(); }
  ctx.fillStyle = fill; path(ctx, pts, true); ctx.fill();
}
/** A thick polyline (a leg, a tentacle, a crack) with an outline of `ow` px on each side. */
export function stroke(ctx: Ctx, pts: readonly Pt[], width: number, color: string, ow = 1): void {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ow > 0) { ctx.lineWidth = width + ow * 2; ctx.strokeStyle = OUT; path(ctx, pts, false); ctx.stroke(); }
  ctx.lineWidth = width; ctx.strokeStyle = color; path(ctx, pts, false); ctx.stroke();
}
/** A plain filled rectangle with no outline, for speckles and highlights. */
export function dot(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
}
/** A soft elliptical drop shadow (semi-transparent black). Draw it first. */
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.3): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
/** A glow: a few stacked translucent discs. */
export function glow(ctx: Ctx, x: number, y: number, r: number, hex: string, alpha = 0.5): void {
  for (let i = 3; i >= 1; i -= 1) {
    ctx.fillStyle = rgba(hex, alpha * (1 - i / 4));
    ctx.beginPath(); ctx.arc(x, y, r * (0.4 + i * 0.3), 0, Math.PI * 2); ctx.fill();
  }
}
/** Keeps what is drawn by `fn` inside a rectangle of the sheet (so a tile or a prop never leaks into its neighbor). */
export function clipped(ctx: Ctx, x: number, y: number, w: number, h: number, fn: () => void): void {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); fn(); ctx.restore();
}
/** Runs `fn` with the origin moved to (x, y). */
export function at(ctx: Ctx, x: number, y: number, fn: () => void): void {
  ctx.save(); ctx.translate(x, y); fn(); ctx.restore();
}
