// Family ROBOT: square plated chassis, a glowing eye strip, small treads or legs and an antenna (steel grey with orange, red or
// cyan glow). Treads roll with the walk phase; a dying robot throws sparks and its plates fly apart.
import { box, dot, glow, hash32, oval, poly, rgba, stroke, unit, at, type Ctx } from './draw';
import type { FamPose, FamilySpec, KindDrawer, Pal } from './family-shared';

export const ROBOT_PAL: Pal = { main: '#8996a8', light: '#c8d3df', dark: '#434d5c', accent: '#6a7688', glow: '#ff7a18', extra: '#38e0ff' };
const TRACK = '#2a313c';

/** A tread on one side: a dark band with light marks that roll one mark-width over the 6 walk frames. */
function tread(ctx: Ctx, c: Pal, p: FamPose, x: number, y: number, w: number, h: number, ow = 1): void {
  box(ctx, x, y, w, h, TRACK, ow);
  const shift = Math.round((p.ph / (Math.PI * 2)) * 4);
  for (let k = -1; k * 4 < w; k += 1) {
    const mx = x + k * 4 + shift;
    if (mx >= x && mx < x + w - 1) dot(ctx, mx, y + 1, 2, h - 2, c.dark);
  }
  dot(ctx, x + 1, y, w - 2, 1, c.accent);
}
function antenna(ctx: Ctx, c: Pal, p: FamPose, x: number, y: number, len: number, tip: string): void {
  const wob = Math.round(Math.sin(p.ph * 2) * 1.5);
  stroke(ctx, [[x, y], [x - len * 0.4, y - len * 0.6 + wob], [x - len * 0.8, y - len + wob]], 1.5, c.dark, 1);
  dot(ctx, x - len * 0.8 - 1, y - len + wob - 1, 3, 3, tip);
}
/** A glowing eye strip; it flares while attacking. */
function eyeStrip(ctx: Ctx, color: string, x: number, y: number, w: number, h: number, flare: number): void {
  box(ctx, x - 1, y - 1, w + 2, h + 2, '#1a2230', 0);
  dot(ctx, x, y, w, h, color);
  if (flare > 0) glow(ctx, x + w / 2, y + h / 2, Math.min(Math.max(w, h) * 0.6, 9) + flare * 2, color, 0.7);
}
const rivets = (ctx: Ctx, c: Pal, x: number, y: number, w: number, h: number): void => {
  for (const [rx, ry] of [[x + 2, y + 2], [x + w - 4, y + 2], [x + 2, y + h - 4], [x + w - 4, y + h - 4]]) dot(ctx, rx ?? 0, ry ?? 0, 2, 2, c.light);
};

const runner: KindDrawer = (ctx, p, c) => {
  ctx.translate(Math.round(p.atk * 2), 0);
  tread(ctx, c, p, -8, -11, 14, 3, 1); tread(ctx, c, p, -8, 8, 14, 3, 1);
  poly(ctx, [[-9, -7], [4, -7], [13, 0], [4, 7], [-9, 7]], c.main);
  dot(ctx, -7, -5, 9, 2, c.light);
  dot(ctx, -7, 3, 9, 2, c.accent);
  eyeStrip(ctx, '#ff3b3b', 6, -2, 4, 4, p.atk);
  for (const side of [-1, 1]) poly(ctx, [[3, side * 7], [8 + p.atk * 3, side * 9], [3, side * 9]], c.light, 1); // little blades
  antenna(ctx, c, p, -5, -3, 6, '#ff3b3b');
};

const brute: KindDrawer = (ctx, p, c) => {
  tread(ctx, c, p, -19, -25, 36, 8, 2); tread(ctx, c, p, -19, 17, 36, 8, 2);
  box(ctx, -17, -16, 32, 32, c.main, 2); // heavy chassis
  box(ctx, -13, -12, 24, 24, c.accent, 0);
  dot(ctx, -13, -12, 24, 3, c.light);
  rivets(ctx, c, -17, -16, 32, 32);
  box(ctx, 15, -10, 3 + p.atk * 5, 20, c.light, 2); // ram plate
  box(ctx, 6, -9, 8, 18, c.dark, 1);
  eyeStrip(ctx, c.glow, 8, -6, 4, 12, p.atk);
  box(ctx, -8, -19, 12, 4, c.light, 1); box(ctx, -8, 15, 12, 4, c.light, 1);
  antenna(ctx, c, p, -10, -8, 9, c.glow);
};

const swarmer: KindDrawer = (ctx, p, c) => {
  ctx.translate(Math.round(p.atk * 2), 0);
  for (const side of [-1, 1]) for (const [i, x] of [-4, 3].entries()) {
    const sway = Math.round(Math.sin(p.ph + i * 2 + (side > 0 ? Math.PI : 0)) * 2);
    stroke(ctx, [[x, side * 4], [x + sway, side * 8]], 1.5, c.dark, 1);
  }
  box(ctx, -6, -6, 12, 12, c.main, 1);
  dot(ctx, -5, -5, 10, 2, c.light);
  eyeStrip(ctx, c.glow, 2, -2, 3, 4, p.atk);
  dot(ctx, -5, 2, 3, 3, c.accent);
};

const spitter: KindDrawer = (ctx, p, c) => {
  const kick = Math.round(p.atk * 2);
  tread(ctx, c, p, -9, -13, 16, 3, 1); tread(ctx, c, p, -9, 10, 16, 3, 1);
  box(ctx, -9, -9, 16, 18, c.main, 1);
  dot(ctx, -8, -8, 14, 2, c.light);
  box(ctx, 6 - kick, -3, 12, 6, c.dark, 1); // barrel, points to +x
  box(ctx, 14 - kick, -4, 3, 8, c.light, 1);
  eyeStrip(ctx, c.extra, -5, -3, 3, 6, 0);
  dot(ctx, 17 - kick, -2, 2, 4, p.atk > 0 ? '#ffffff' : c.extra);
  if (p.atk > 0) glow(ctx, 18, 0, 3 + p.atk * 2, c.extra, 0.9);
  antenna(ctx, c, p, -6, -6, 6, c.extra);
};

const crusher: KindDrawer = (ctx, p, c) => {
  const ext = Math.round(p.atk * 6);
  tread(ctx, c, p, -34, -46, 66, 14, 2); tread(ctx, c, p, -34, 32, 66, 14, 2);
  box(ctx, -30, -30, 56, 60, c.main, 2); // armored hull
  box(ctx, -24, -24, 44, 48, c.accent, 0);
  dot(ctx, -24, -24, 44, 4, c.light);
  rivets(ctx, c, -30, -30, 56, 60);
  for (const side of [-1, 1]) {
    for (const x of [-18, -4]) poly(ctx, [[x - 5, side * 30], [x, side * 44], [x + 5, side * 30]], c.light, 2); // shoulder spikes
    box(ctx, 22, side * 17 - 5, 12 + ext, 10, c.dark, 2); // piston arm
    poly(ctx, [[32 + ext, side * 25], [46 + ext, side * 11], [42 + ext, side * 25]], c.light, 2); // claw
    poly(ctx, [[34 + ext, side * 9], [40 + ext, side * 6], [38 + ext, side * 13]], c.main, 1);
  }
  box(ctx, 10, -20, 12, 40, c.dark, 2);
  eyeStrip(ctx, '#ff3b2f', 13, -16, 5, 32, p.atk);
  poly(ctx, [[-14, -30], [-22, -50], [-8, -30]], c.dark, 2);
  antenna(ctx, c, p, -24, -12, 16, '#ff3b2f');
};

const gunner: KindDrawer = (ctx, p, c) => {
  const kick = Math.round(p.atk * 4);
  tread(ctx, c, p, -30, -40, 58, 13, 2); tread(ctx, c, p, -30, 27, 58, 13, 2);
  box(ctx, -26, -27, 50, 54, c.main, 2);
  box(ctx, -21, -22, 40, 44, c.accent, 0);
  dot(ctx, -21, -22, 40, 3, c.light);
  rivets(ctx, c, -26, -27, 50, 54);
  box(ctx, 8 - kick, -8, 36, 16, c.dark, 2); // cannon barrel, points to +x
  for (const x of [16, 26]) box(ctx, x - kick, -10, 3, 20, c.accent, 1);
  box(ctx, 38 - kick, -11, 8, 22, c.light, 2); // muzzle brake
  dot(ctx, 42 - kick, -6, 2, 12, p.atk > 0 ? '#ffffff' : c.extra);
  if (p.atk > 0) glow(ctx, 46, 0, 2 + p.atk * 2.5, c.extra, 0.9);
  oval(ctx, 0, 0, 16, 16, c.main, 2); oval(ctx, 0, 0, 10, 10, c.dark, 1); // turret
  glow(ctx, 0, 0, 5, c.extra, 0.9); dot(ctx, -2, -2, 4, 4, c.extra);
  box(ctx, -24, -12, 4, 24, c.dark, 1); eyeStrip(ctx, c.extra, -23, -9, 2, 18, 0);
  stroke(ctx, [[-14, -22], [-18, -34]], 2, c.dark, 1); oval(ctx, -18, -36, 5, 3, c.light, 1); // radar dish
};

/** A burnt patch under a dying robot; sparks and flying plates over it. */
function scorch(ctx: Ctx, k: number, r: number): void {
  ctx.fillStyle = `rgba(10,12,16,${0.35 + k * 0.35})`;
  ctx.beginPath(); ctx.ellipse(0, 3, r * (0.8 + k * 0.4), r * (0.5 + k * 0.3), 0, 0, Math.PI * 2); ctx.fill();
}
function debris(ctx: Ctx, k: number, r: number, c: Pal): void {
  for (let i = 0; i < 5; i += 1) { // plates flying apart
    const a = unit(i, 21) * Math.PI * 2; const d = r * (0.2 + k * 0.7 + unit(i, 22) * 0.2); const size = Math.max(2, Math.round(r * 0.3 * (1.1 - k * 0.3)));
    at(ctx, Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * 0.8), () => {
      ctx.rotate(unit(i, 23) * 3 + k * 2); box(ctx, -size / 2, -size / 2, size, size * 0.7, i % 2 ? c.main : c.accent, 1);
    });
  }
  for (let i = 0; i < 7; i += 1) { // sparks
    const a = unit(i, 24) * Math.PI * 2; const d = r * (0.3 + ((i * 37 + k * 100) % 100) / 100 * 0.9);
    const x = Math.round(Math.cos(a) * d); const y = Math.round(Math.sin(a) * d * 0.8);
    dot(ctx, x - 1, y, 3, 1, hash32(i, 25) % 2 ? '#ffe066' : '#ffffff'); dot(ctx, x, y - 1, 1, 3, '#ffb23a');
  }
  if (k < 0.6) glow(ctx, 0, 0, r * (0.4 + k * 0.4), c.glow, 0.5);
  ctx.fillStyle = rgba('#0b1220', 0.5);
  ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r * 0.12), 0, Math.PI * 2); ctx.fill();
}

export const ROBOT: FamilySpec = {
  id: 'robot', pal: ROBOT_PAL, flatten: 0.7, fade: 0,
  kinds: { runner, brute, swarmer, spitter, crusher, gunner },
  muzzle: { spitter: [18, 0], gunner: [45, 0] },
  under: (ctx, k, r) => { if (k > 0) scorch(ctx, k, r); },
  over: (ctx, k, r, c) => { if (k > 0) debris(ctx, k, r, c); },
};
