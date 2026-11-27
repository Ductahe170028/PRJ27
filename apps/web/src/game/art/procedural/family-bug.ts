// Family BUG: multi-legged insects, beetles and spiders (green / brown chitin). Legs wiggle with the walk phase, mandibles
// snap on an attack, a dying bug curls up and bursts into a green splat.
import { box, disc, dot, glow, hash32, oval, poly, rgba, stroke, unit, type Ctx } from './draw';
import type { FamPose, FamilySpec, KindDrawer, Pal } from './family-shared';

export const BUG_PAL: Pal = { main: '#5d8f2f', light: '#9ccc4a', dark: '#3a5220', accent: '#d9b73c', glow: '#ff5436', extra: '#b6ff3c' };

interface LegSpec { n: number; x0: number; x1: number; y: number; len: number; w: number; amp: number }
/** Two rows of legs (one each side), alternating with the walk phase; they curl in as the bug dies. */
function legs(ctx: Ctx, c: Pal, p: FamPose, s: LegSpec): void {
  const curl = 1 - p.die * 0.6;
  for (const side of [-1, 1]) {
    for (let i = 0; i < s.n; i += 1) {
      const x = s.n === 1 ? s.x0 : s.x0 + ((s.x1 - s.x0) * i) / (s.n - 1);
      const sway = Math.round(Math.sin(p.ph + i * 1.2 + (side > 0 ? Math.PI : 0)) * s.amp * (1 - p.die * 0.7));
      stroke(ctx, [[x, side * s.y * 0.6], [x + Math.round(sway * 0.4) - 1, side * (s.y + s.len * 0.55 * curl)], [x + sway - 1, side * (s.y + s.len * curl)]], s.w, c.dark, 1);
    }
  }
}
function antennae(ctx: Ctx, c: Pal, p: FamPose, x: number, y: number, len: number, w: number): void {
  const wig = Math.round(Math.sin(p.ph * 2) * 2);
  for (const side of [-1, 1]) {
    stroke(ctx, [[x, side * y], [x + len * 0.6, side * (y + len * 0.4) + wig], [x + len, side * (y + len * 0.7) - wig]], w, c.dark, 0);
    dot(ctx, x + len - 1, side * (y + len * 0.7) - wig - 1, 2, 2, c.accent);
  }
}
const eyes = (ctx: Ctx, c: Pal, x: number, y: number, s: number): void => {
  dot(ctx, x, -y - s, s, s, c.glow); dot(ctx, x, y, s, s, c.glow);
};
/** Mandibles: wide open before a strike, closed on it. */
function mandibles(ctx: Ctx, c: Pal, p: FamPose, x: number, y: number, len: number, w: number, open: number): void {
  const gap = y + (1 - p.atk) * open;
  for (const side of [-1, 1]) stroke(ctx, [[x, side * y], [x + len * 0.7, side * (gap + 2)], [x + len, side * Math.max(0.5, gap - 3)]], w, c.accent, 1);
}

const runner: KindDrawer = (ctx, p, c) => {
  ctx.translate(Math.round(p.atk * 2), 0);
  legs(ctx, c, p, { n: 3, x0: -6, x1: 3, y: 3, len: 8, w: 1.5, amp: 3 });
  oval(ctx, -7, 0, 7, 5, c.main);
  dot(ctx, -9, -1, 8, 1, c.light);
  oval(ctx, 0, 0, 5, 4.5, c.dark);
  poly(ctx, [[3, -4], [12, 0], [3, 4]], c.light);
  eyes(ctx, c, 5, 2, 2);
  antennae(ctx, c, p, 9, 1, 5, 1);
  mandibles(ctx, c, p, 11, 1, 4, 1, 3);
};

const brute: KindDrawer = (ctx, p, c) => {
  ctx.translate(Math.round(p.atk * 3), 0);
  legs(ctx, c, p, { n: 3, x0: -10, x1: 7, y: 13, len: 12, w: 2.5, amp: 4 });
  oval(ctx, -3, 0, 18, 17, c.main, 2); // wide shell
  oval(ctx, -6, -8, 9, 4, c.light, 0); oval(ctx, -6, 8, 9, 4, c.light, 0);
  dot(ctx, -20, -1, 30, 2, c.dark); // shell seam
  for (let i = 0; i < 6; i += 1) dot(ctx, -16 + (hash32(i, 3) % 20), -12 + (hash32(i, 4) % 24), 3, 3, c.accent);
  oval(ctx, 14, 0, 8, 7, c.dark, 2);
  eyes(ctx, c, 17, 3, 3);
  for (const side of [-1, 1]) { // big pincers
    const tip = 3 + (1 - p.atk) * 8;
    stroke(ctx, [[17, side * 5], [23, side * 10], [26, side * tip]], 3.5, c.accent, 1);
  }
};

const swarmer: KindDrawer = (ctx, p, c) => {
  ctx.translate(Math.round(p.atk * 2), 0);
  legs(ctx, c, p, { n: 3, x0: -3, x1: 3, y: 3, len: 5, w: 1, amp: 2 });
  oval(ctx, -1, 0, 6, 5.5, c.main);
  dot(ctx, -4, -4, 3, 2, c.light);
  disc(ctx, 5, 0, 3, c.dark);
  eyes(ctx, c, 6, 1, 1);
  dot(ctx, -3, -1, 2, 2, c.accent);
  antennae(ctx, c, p, 7, 1, 3, 1);
};

const spitter: KindDrawer = (ctx, p, c) => {
  legs(ctx, c, p, { n: 4, x0: -6, x1: 5, y: 5, len: 7, w: 1.5, amp: 2.5 });
  oval(ctx, -6, 0, 9, 8 + p.atk * 1.5, c.main); // abdomen
  oval(ctx, -6, 0, 6 - p.atk, 5.5 - p.atk, c.extra, 0); // venom sac
  dot(ctx, -9, -3, 3, 2, '#e8ffb0');
  oval(ctx, 4, 0, 6, 5, c.dark);
  eyes(ctx, c, 6, 2, 2);
  poly(ctx, [[8, -3], [16, -1.5], [16, 1.5], [8, 3]], c.accent); // the spout, points to +x
  if (p.atk > 0) glow(ctx, 17, 0, 4 + p.atk * 3, c.extra, 0.9);
};

const crusher: KindDrawer = (ctx, p, c) => {
  ctx.translate(Math.round(p.atk * 4), 0);
  legs(ctx, c, p, { n: 4, x0: -20, x1: 16, y: 24, len: 20, w: 4.5, amp: 6 });
  for (let i = 0; i < 5; i += 1) { // side spikes
    const x = -22 + i * 11;
    for (const side of [-1, 1]) poly(ctx, [[x - 5, side * 26], [x, side * 40], [x + 5, side * 26]], c.light, 2);
  }
  poly(ctx, [[-28, -8], [-46, 0], [-28, 8]], c.dark, 2); // rear horn
  oval(ctx, -4, 0, 32, 29, c.main, 2); // armored shell
  for (let i = -2; i <= 1; i += 1) stroke(ctx, [[-18 + i * 11, -24], [-16 + i * 11, 0], [-18 + i * 11, 24]], 3, c.dark, 0);
  oval(ctx, -10, -12, 14, 5, c.light, 0); oval(ctx, -10, 12, 14, 5, c.light, 0);
  oval(ctx, 26, 0, 12, 13, c.dark, 2);
  dot(ctx, 30, -9, 4, 4, c.glow); dot(ctx, 30, 5, 4, 4, c.glow); dot(ctx, 34, -2, 3, 4, c.glow);
  for (const side of [-1, 1]) { // huge pincers that snap shut
    const tip = 5 + (1 - p.atk) * 10;
    stroke(ctx, [[32, side * 9], [41, side * 20], [46, side * tip]], 8, c.light, 2);
    poly(ctx, [[40, side * 16], [44, side * (tip + 5)], [42, side * 12]], c.accent, 1);
  }
};

const gunner: KindDrawer = (ctx, p, c) => {
  const kick = Math.round(p.atk * 4);
  legs(ctx, c, p, { n: 4, x0: -18, x1: 12, y: 19, len: 17, w: 3.5, amp: 5 });
  for (const side of [-1, 1]) poly(ctx, [[-18, side * 20], [-12, side * 32], [-6, side * 20]], c.light, 2);
  oval(ctx, -4, 0, 27, 23, c.main, 2); // body
  oval(ctx, -12, 0, 12, 14, c.dark, 2); // swollen back
  for (let i = 0; i < 4; i += 1) dot(ctx, 4 + (i % 2) * 5, -14 + i * 8, 3, 3, c.glow); // eye cluster
  box(ctx, 6 - kick, -7, 38, 14, c.dark, 2); // the barrel, points to +x
  for (const x of [14, 24, 34]) box(ctx, x - kick, -9, 3, 18, c.light, 1);
  box(ctx, 42 - kick, -9, 4, 18, c.accent, 1);
  dot(ctx, 8 - kick, -5, 32, 2, rgba(c.light, 0.45));
  if (p.atk > 0) glow(ctx, 45, 0, 2 + p.atk * 2.5, c.extra, 0.9);
};

/** The splat under a dying bug grows with `k`. */
function splat(ctx: Ctx, k: number, r: number, c: Pal): void {
  ctx.fillStyle = rgba(c.extra, 0.85);
  ctx.beginPath(); ctx.ellipse(0, 2, r * (0.7 + k * 0.6), r * (0.4 + k * 0.45), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba(c.main, 0.6);
  ctx.beginPath(); ctx.ellipse(0, 2, r * (0.45 + k * 0.35), r * (0.25 + k * 0.25), 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 6; i += 1) { // droplets flung out
    const a = unit(i, 7) * Math.PI * 2; const d = r * (0.8 + k * 0.5 + unit(i, 8) * 0.3);
    disc(ctx, Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * 0.7), Math.max(1, r * 0.09), c.extra, 0);
  }
}

export const BUG: FamilySpec = {
  id: 'bug', pal: BUG_PAL, flatten: 0.45, fade: 0.25,
  kinds: { runner, brute, swarmer, spitter, crusher, gunner },
  muzzle: { spitter: [17, 0], gunner: [45, 0] },
  under: (ctx, k, r, c) => { if (k > 0) splat(ctx, k, r, c); },
  over: () => undefined,
};
