// Family MUTANT: round fleshy bodies with lumps, boils, one big eye or a huge mouth, and slime drips (purple, sickly green, pink).
// The body wobbles with the walk phase; a dying mutant melts into a slime puddle.
import { box, disc, glow, hash32, oval, poly, rgba, stroke, unit, type Ctx, type Pt } from './draw';
import type { FamPose, FamilySpec, KindDrawer, Pal } from './family-shared';

export const MUTANT_PAL: Pal = { main: '#a35fc4', light: '#d8a0ec', dark: '#52286e', accent: '#c8f24a', glow: '#fff06b', extra: '#ff86b4' };
const MOUTH = '#3a0f2a';
const BONE = '#f0e6c8';

/** A lumpy round body: `n` points on an ellipse, each pushed in or out by a hash (the same lumps in every frame) and wobbling a little. */
function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number, seed: number, p: FamPose, fill: string, ow = 1): void {
  const n = 20; const pts: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const lump = 1 + (unit(seed, i) - 0.5) * 0.22 + Math.sin(p.ph + i * 0.9) * 0.035;
    pts.push([x + Math.cos(a) * rx * lump, y + Math.sin(a) * ry * lump]);
  }
  poly(ctx, pts, fill, ow);
}
const eye = (ctx: Ctx, x: number, y: number, r: number, c: Pal, look = 1): void => {
  disc(ctx, x, y, r, c.glow);
  disc(ctx, x + look, y, Math.max(1, r * 0.45), '#2a1030', 0);
};
/** Boils: small pale bumps with a pink rim, at hashed spots inside a circle. */
function boils(ctx: Ctx, c: Pal, count: number, r: number, size: number, seed: number): void {
  for (let i = 0; i < count; i += 1) {
    const a = unit(seed, i) * Math.PI * 2; const d = r * (0.25 + unit(seed, i, 1) * 0.55);
    const x = Math.round(Math.cos(a) * d - r * 0.15); const y = Math.round(Math.sin(a) * d);
    disc(ctx, x, y, size, c.extra, 0); disc(ctx, x, y, Math.max(1, size - 1), '#f6e27a', 0);
  }
}
/** Slime drips hanging off the body. */
function drips(ctx: Ctx, c: Pal, p: FamPose, r: number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const a = (hash32(i, 5, count) % 628) / 100; const len = 2 + Math.round(1 + Math.sin(p.ph * 2 + i * 2));
    oval(ctx, Math.round(Math.cos(a) * r * 0.85), Math.round(Math.sin(a) * r * 0.85), 1.5, len * (r > 20 ? 1.4 : 1), c.accent, 0);
  }
}
const squash = (ctx: Ctx, p: FamPose, amount: number): void => { ctx.scale(1 + Math.sin(p.ph * 2) * amount, 1 - Math.sin(p.ph * 2) * amount); };

const runner: KindDrawer = (ctx, p, c) => {
  const foot = Math.round(Math.sin(p.ph) * 4);
  oval(ctx, -4 + foot, 8, 3, 2, c.dark); oval(ctx, -4 - foot, -8, 3, 2, c.dark);
  poly(ctx, [[-9, -3], [-17, Math.round(Math.sin(p.ph) * 3)], [-9, 3]], c.extra); // thin tail
  squash(ctx, p, 0.04);
  blob(ctx, -2, 0, 10, 7, 11, p, c.main);
  poly(ctx, [[5, -5], [15, 0], [5, 5]], c.main); // pointed snout
  eye(ctx, 5, 0, 4, c);
  if (p.atk > 0) oval(ctx, 12, 0, 3, 1 + p.atk * 2.5, MOUTH, 1);
};

const brute: KindDrawer = (ctx, p, c) => {
  for (const side of [-1, 1]) { // big swinging arms ending in fists
    const reach = Math.round(Math.sin(p.ph + (side > 0 ? Math.PI : 0)) * 4) + Math.round(p.atk * 8);
    stroke(ctx, [[0, side * 14], [8 + reach / 2, side * (20 - p.atk * 3)]], 6, c.extra, 1);
    disc(ctx, 12 + reach, side * (21 - p.atk * 5), 6, c.extra, 1);
  }
  squash(ctx, p, 0.03);
  blob(ctx, -2, 0, 19, 18, 21, p, c.main, 2);
  oval(ctx, -8, -8, 8, 4, c.light, 0);
  boils(ctx, c, 6, 19, 3, 22);
  oval(ctx, 9, 0, 8, 5 + p.atk * 4, MOUTH, 1); // huge mouth
  for (let i = 0; i < 4; i += 1) box(ctx, 5 + i * 3, -4 - p.atk * 3, 2, 2, '#f4f0dc', 0);
  eye(ctx, 4, -11, 3, c); eye(ctx, 4, 11, 3, c);
  drips(ctx, c, p, 19, 4);
};

const swarmer: KindDrawer = (ctx, p, c) => {
  const hop = Math.round(Math.abs(Math.sin(p.ph)) * 2);
  oval(ctx, -1, 6, 2, 1.5, c.dark); oval(ctx, -1, -6, 2, 1.5, c.dark);
  ctx.translate(0, -hop);
  blob(ctx, 0, 0, 7 + p.atk * 1.5, 6.5 - Math.abs(Math.sin(p.ph)), 31, p, c.main);
  eye(ctx, 2, 0, 4, c);
  disc(ctx, -4, -3, 1.5, c.extra, 0); disc(ctx, -3, 3, 1, c.light, 0);
};

const spitter: KindDrawer = (ctx, p, c) => {
  squash(ctx, p, 0.03);
  blob(ctx, -3, 0, 10, 9, 41, p, c.main);
  disc(ctx, -6, 0, 5 - p.atk, c.accent, 0); disc(ctx, -7, -1, 2, '#efffb0', 0); // slime sac
  eye(ctx, 3, -5, 2.5, c); eye(ctx, 3, 5, 2.5, c);
  const wig = Math.round(Math.sin(p.ph * 2) * 1.5);
  stroke(ctx, [[5, 0], [10, wig], [15, 0]], 5, c.extra, 1); // mouth tube, points to +x
  disc(ctx, 16, 0, 3, MOUTH, 1);
  if (p.atk > 0) glow(ctx, 16, 0, 3 + p.atk * 2, c.accent, 0.9);
  drips(ctx, c, p, 10, 2);
};

const crusher: KindDrawer = (ctx, p, c) => {
  for (const side of [-1, 1]) { // huge spiked fists
    const swing = Math.round(Math.sin(p.ph + (side > 0 ? Math.PI : 0)) * 6) + Math.round(p.atk * 10);
    stroke(ctx, [[0, side * 24], [14 + swing / 2, side * 32]], 12, c.extra, 2);
    disc(ctx, 22 + swing, side * (36 - p.atk * 4), 13, c.extra, 2);
    for (let i = 0; i < 3; i += 1) poly(ctx, [[26 + swing + i * 3, side * (30 + i * 5)], [34 + swing + i * 3, side * (31 + i * 5)], [28 + swing + i * 3, side * (34 + i * 5)]], BONE, 1);
  }
  for (let i = 0; i < 5; i += 1) { // bone spikes along the back
    const y = -22 + i * 11;
    poly(ctx, [[-22, y - 4], [-40, y], [-22, y + 4]], BONE, 2);
  }
  squash(ctx, p, 0.02);
  blob(ctx, -2, 0, 32, 30, 51, p, c.main, 2);
  oval(ctx, -10, -14, 16, 6, c.light, 0);
  boils(ctx, c, 9, 32, 4, 52);
  eye(ctx, 8, -16, 8, c); eye(ctx, 10, 15, 5, c);
  oval(ctx, 16, 0, 12, 8 + p.atk * 6, MOUTH, 2); // gaping maw with teeth
  for (let i = 0; i < 5; i += 1) box(ctx, 8 + i * 4, -8 - p.atk * 5, 2, 3, '#f4f0dc', 0);
  drips(ctx, c, p, 32, 6);
};

const gunner: KindDrawer = (ctx, p, c) => {
  const kick = Math.round(p.atk * 4);
  squash(ctx, p, 0.02);
  blob(ctx, -4, 0, 28, 27, 61, p, c.main, 2);
  boils(ctx, c, 7, 28, 4, 62);
  oval(ctx, -16, 0, 9, 16, c.dark, 1); // dark spine lump
  box(ctx, 6 - kick, -8, 36, 16, BONE, 2); // bone cannon, points to +x
  for (const x of [14, 24, 34]) box(ctx, x - kick, -10, 3, 20, '#cdbf94', 1);
  oval(ctx, 43 - kick, 0, 3, 10, MOUTH, 2);
  if (p.atk > 0) glow(ctx, 45, 0, 2 + p.atk * 2.5, c.glow, 0.9);
  oval(ctx, -4, 0, 12, 11, '#f4f0dc', 2); eye(ctx, -2, 0, 8, c, 2); // one huge eye
  drips(ctx, c, p, 28, 6);
};

/** A puddle of slime under a dying mutant, and bubbles over it. */
function puddle(ctx: Ctx, k: number, r: number, c: Pal): void {
  ctx.fillStyle = rgba(c.dark, 0.7);
  ctx.beginPath(); ctx.ellipse(0, 3, r * (0.8 + k * 0.7), r * (0.5 + k * 0.5), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgba(c.accent, 0.75);
  ctx.beginPath(); ctx.ellipse(1, 2, r * (0.55 + k * 0.5), r * (0.3 + k * 0.35), 0, 0, Math.PI * 2); ctx.fill();
}
function bubbles(ctx: Ctx, k: number, r: number, c: Pal): void {
  for (let i = 0; i < 4; i += 1) {
    const a = unit(i, 9) * Math.PI * 2; const d = r * (0.2 + unit(i, 10) * 0.6) * (0.6 + k * 0.5);
    disc(ctx, Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * 0.7), Math.max(1, r * 0.1 * (1.2 - k * 0.4)), c.extra, 0);
  }
}

export const MUTANT: FamilySpec = {
  id: 'mutant', pal: MUTANT_PAL, flatten: 0.4, fade: 0.3,
  kinds: { runner, brute, swarmer, spitter, crusher, gunner },
  muzzle: { spitter: [18, 0], gunner: [45, 0] },
  under: (ctx, k, r, c) => { if (k > 0) puddle(ctx, k, r, c); },
  over: (ctx, k, r, c) => { if (k > 0) bubbles(ctx, k, r, c); },
};
