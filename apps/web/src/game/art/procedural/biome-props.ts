// Small flat decor for each biome, seen from above: 16..40 px, each with a soft shadow. A prop draws itself inside a w x h box
// whose top-left is the origin; the caller clips it to that box.
import { box, clipped, disc, dot, glow, oval, poly, rgba, shadow, stroke, unit, type Ctx, type Pt } from './draw';

export interface Prop { w: number; h: number; draw(ctx: Ctx, w: number, h: number): void }
const soft = (ctx: Ctx, w: number, h: number, alpha = 0.28): void => shadow(ctx, w / 2 + 1, h / 2 + 3, w * 0.4, h * 0.34, alpha);
const prop = (w: number, h: number, draw: Prop['draw']): Prop => ({ w, h, draw });
const stripes = (ctx: Ctx, x: number, y: number, w: number, h: number, a: string, b: string): void => {
  dot(ctx, x, y, w, h, a);
  clipped(ctx, x, y, w, h, () => { for (let i = -h; i < w; i += 8) poly(ctx, [[x + i, y + h], [x + i + 4, y + h], [x + i + 4 + h, y], [x + i + h, y]], b, 0); });
};
const rock = (ctx: Ctx, x: number, y: number, r: number, base: string, hi: string): void => {
  const pts: Pt[] = [0, 1, 2, 3, 4, 5].map((k): Pt => { const a = (k / 6) * Math.PI * 2 + 0.4; const j = r * (0.75 + unit(k, x, y) * 0.35); return [x + Math.cos(a) * j, y + Math.sin(a) * j * 0.85]; });
  poly(ctx, pts, base, 1); dot(ctx, x - r * 0.4, y - r * 0.5, r * 0.8, 1, hi);
};

export const BIOME_PROPS: Record<string, Prop[]> = {
  'zombie-city': [
    prop(32, 24, (ctx) => { stroke(ctx, [[2, 10], [9, 14], [15, 9], [22, 15], [30, 11]], 2, '#15171b', 0); stroke(ctx, [[15, 9], [17, 3]], 1, '#15171b', 0); stroke(ctx, [[22, 15], [24, 21]], 1, '#15171b', 0); dot(ctx, 4, 12, 8, 1, '#5a5e66'); }),
    prop(22, 22, (ctx, w, h) => { soft(ctx, w, h); disc(ctx, 11, 10, 8, '#4f6b55'); disc(ctx, 11, 10, 6, '#6c8a72', 0); dot(ctx, 8, 9, 6, 2, '#3c5442'); box(ctx, 9, 3, 4, 2, '#2e3a32', 0); }),
    prop(24, 24, (ctx, w, h) => { soft(ctx, w, h); disc(ctx, 12, 11, 10, '#1b1b1f'); disc(ctx, 12, 11, 6, '#383840', 0); disc(ctx, 12, 11, 3, '#111116', 0); dot(ctx, 5, 6, 4, 1, '#4a4a54'); }),
    prop(36, 24, (ctx, w, h) => { soft(ctx, w, h); poly(ctx, [[3, 14], [10, 8], [17, 12], [14, 19], [5, 19]], '#7a6a60', 1); poly(ctx, [[18, 10], [27, 6], [32, 13], [24, 18]], '#8a4a3a', 1); stroke(ctx, [[8, 20], [30, 21]], 1.5, '#7a5a3a', 1); dot(ctx, 22, 8, 6, 1, '#b07460'); }),
    prop(24, 24, (ctx, w, h) => { soft(ctx, w, h); disc(ctx, 12, 11, 10, '#4a4d54'); disc(ctx, 12, 11, 8, '#5f636b', 0); for (let i = -6; i <= 6; i += 3) dot(ctx, 12 + i, 5, 1, 12, '#33363c'); dot(ctx, 5, 11, 14, 1, '#33363c'); }),
  ],
  'alien-lab': [
    prop(36, 16, (ctx, w, h) => { soft(ctx, w, h); box(ctx, 3, 4, 30, 8, '#6a7a88', 1); dot(ctx, 3, 5, 30, 2, '#9db0c0'); for (const x of [6, 17, 28]) box(ctx, x, 2, 3, 12, '#4a5866', 1); }),
    prop(28, 24, (ctx) => { for (const [x, y, r, c] of [[12, 12, 10, '#1fb6d6'], [17, 14, 7, '#4ade80'], [9, 9, 5, '#b8f6ff']] as [number, number, number, string][]) { ctx.fillStyle = rgba(c, 0.45); ctx.beginPath(); ctx.ellipse(x + 2, y, r, r * 0.75, 0.3, 0, Math.PI * 2); ctx.fill(); } glow(ctx, 14, 12, 8, '#4ade80', 0.7); dot(ctx, 12, 11, 4, 3, '#d8fff0'); }),
    prop(24, 24, (ctx, w, h) => { soft(ctx, w, h); box(ctx, 3, 3, 18, 18, '#52606e', 1); box(ctx, 5, 5, 14, 14, '#657585', 0); stroke(ctx, [[5, 5], [19, 19]], 2, '#3e4a56', 0); stroke(ctx, [[19, 5], [5, 19]], 2, '#3e4a56', 0); dot(ctx, 3, 3, 18, 1, '#9db0c0'); dot(ctx, 3, 18, 18, 3, '#d9a21a'); }),
    prop(24, 24, (ctx, w, h) => { soft(ctx, w, h); box(ctx, 3, 3, 18, 18, '#2a343e', 1); for (let i = 0; i < 5; i += 1) dot(ctx, 5, 6 + i * 3, 14, 1, '#56697a'); dot(ctx, 5, 5, 14, 1, '#1fb6d6'); }),
    prop(32, 16, (ctx) => { stroke(ctx, [[2, 12], [10, 4], [20, 12], [30, 4]], 3, '#1d2630', 1); stroke(ctx, [[2, 12], [10, 4], [20, 12], [30, 4]], 1, '#3de0ff', 0); }),
  ],
  'dark-forest': [
    prop(28, 24, (ctx, w, h) => { soft(ctx, w, h); for (const [x, y, r, c] of [[9, 14, 7, '#1e4d28'], [18, 14, 7, '#235a2e'], [13, 9, 7, '#2c6d38']] as [number, number, number, string][]) disc(ctx, x, y, r, c, 1); dot(ctx, 10, 6, 4, 2, '#58a85e'); dot(ctx, 17, 11, 3, 2, '#58a85e'); }),
    prop(22, 22, (ctx, w, h) => { soft(ctx, w, h); disc(ctx, 11, 10, 9, '#5a3a1c'); disc(ctx, 11, 10, 7, '#a07a48', 0); disc(ctx, 11, 10, 4, '#8a6538', 0); disc(ctx, 11, 10, 1.5, '#5a3a1c', 0); }),
    prop(22, 20, (ctx, w, h) => { soft(ctx, w, h); for (const [x, y, r] of [[6, 12, 4], [14, 10, 5], [10, 5, 3]] as [number, number, number][]) { box(ctx, x - 1, y, 2, 4, '#e8e0c8', 0); oval(ctx, x, y, r, r * 0.7, '#c4372f', 1); dot(ctx, x - 1, y - 1, 2, 1, '#f4f0e0'); } }),
    prop(28, 20, (ctx, w, h) => { soft(ctx, w, h); rock(ctx, 9, 11, 6, '#5d6670', '#8a95a0'); rock(ctx, 19, 10, 5, '#6b747e', '#98a3ae'); rock(ctx, 14, 6, 3, '#555e68', '#8a95a0'); }),
    prop(24, 18, (ctx) => { for (let i = 0; i < 9; i += 1) { const x = 3 + Math.round(unit(i, 1) * 17); const y = 3 + Math.round(unit(i, 2) * 11); oval(ctx, x, y, 3, 1.8, ['#8a5a22', '#a8741f', '#6b4018', '#7a3a1a'][i % 4] ?? '#8a5a22', 0, unit(i, 3) * 3); } }),
  ],
  'desert-ruins': [
    prop(28, 22, (ctx, w, h) => { soft(ctx, w, h); rock(ctx, 12, 11, 8, '#b09a74', '#d8c9a4'); rock(ctx, 21, 13, 4, '#9c8660', '#c8b88e'); }),
    prop(30, 20, (ctx, w, h) => { soft(ctx, w, h, 0.2); stroke(ctx, [[3, 5], [14, 9]], 2, '#ece4cc', 1); stroke(ctx, [[5, 15], [20, 12]], 2, '#ece4cc', 1); stroke(ctx, [[10, 3], [12, 14]], 2, '#d8cfb2', 1); disc(ctx, 24, 9, 4, '#ece4cc', 1); dot(ctx, 22, 8, 1, 2, '#3a3226'); dot(ctx, 25, 8, 1, 2, '#3a3226'); }),
    prop(20, 24, (ctx, w, h) => { soft(ctx, w, h); disc(ctx, 10, 12, 8, '#3f8a45'); for (let i = 0; i < 8; i += 1) { const a = (i / 8) * Math.PI * 2; stroke(ctx, [[10, 12], [10 + Math.cos(a) * 8, 12 + Math.sin(a) * 8]], 1, '#2b6431', 0); } disc(ctx, 10, 12, 3, '#e0558a', 0); }),
    prop(40, 20, (ctx) => { oval(ctx, 18, 12, 18, 6, '#c9a85e', 0); oval(ctx, 22, 9, 14, 4, '#e2c887', 0); dot(ctx, 8, 14, 24, 1, '#b08f4a'); dot(ctx, 12, 8, 16, 1, '#f1dca2'); }),
    prop(24, 18, (ctx, w, h) => { soft(ctx, w, h, 0.2); poly(ctx, [[3, 10], [8, 4], [14, 6], [11, 13]], '#b5693f', 1); poly(ctx, [[14, 10], [20, 8], [21, 14], [15, 15]], '#a05a34', 1); dot(ctx, 8, 5, 4, 1, '#d8905f'); }),
  ],
  'ice-base': [
    prop(36, 26, (ctx) => { oval(ctx, 18, 14, 16, 9, 'rgba(255,255,255,0.95)', 0); oval(ctx, 14, 12, 9, 5, '#ffffff', 0); dot(ctx, 22, 17, 10, 1, '#cfe9f4'); }),
    prop(24, 28, (ctx, w, h) => { soft(ctx, w, h); poly(ctx, [[12, 2], [20, 20], [12, 25], [5, 18]], '#7fc3e3', 1); poly(ctx, [[12, 2], [20, 20], [14, 21]], '#b8e6f8', 0); dot(ctx, 11, 8, 1, 9, '#ffffff'); poly(ctx, [[3, 26], [8, 16], [10, 26]], '#8fcdea', 1); }),
    prop(32, 22, (ctx) => { oval(ctx, 16, 11, 14, 8, '#cfeefa', 1); oval(ctx, 13, 9, 8, 4, '#eaf9ff', 0); stroke(ctx, [[8, 12], [14, 10], [20, 14]], 1, '#8fcdea', 0); dot(ctx, 20, 8, 5, 1, '#ffffff'); }),
    prop(24, 20, (ctx, w, h) => { soft(ctx, w, h); rock(ctx, 12, 11, 8, '#5d6a78', '#8997a6'); oval(ctx, 12, 7, 7, 3, '#f4fcff', 0); oval(ctx, 18, 11, 3, 2, '#f4fcff', 0); }),
    prop(20, 20, (ctx, w, h) => { soft(ctx, w, h, 0.2); for (const [x, y] of [[4, 4], [11, 7], [6, 12], [14, 14]] as Pt[]) poly(ctx, [[x, y + 4], [x + 2, y - 2], [x + 4, y + 4]], '#a9dff2', 1); }),
  ],
  'neon-arena': [
    prop(32, 32, (ctx) => { glow(ctx, 16, 16, 15, '#ff4fd8', 0.9); disc(ctx, 16, 16, 5, '#ffd0f4', 0); disc(ctx, 16, 16, 2.5, '#ffffff', 0); }),
    prop(20, 20, (ctx, w, h) => { soft(ctx, w, h, 0.4); box(ctx, 4, 4, 12, 12, '#1a1450', 1); box(ctx, 5, 5, 10, 10, '#241a6a', 0); dot(ctx, 4, 4, 12, 2, '#19c6e6'); dot(ctx, 4, 4, 2, 12, '#19c6e6'); dot(ctx, 14, 14, 2, 2, '#ff4fd8'); }),
    prop(28, 28, (ctx) => { for (const [r, a] of [[12, 0.2], [10, 0.4]] as [number, number][]) { ctx.strokeStyle = rgba('#19c6e6', a); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(14, 14, r, 0, Math.PI * 2); ctx.stroke(); } ctx.strokeStyle = '#aaf4ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(14, 14, 10, 0, Math.PI * 2); ctx.stroke(); }),
    prop(32, 16, (ctx) => { for (let x = 3; x < 28; x += 8) { poly(ctx, [[x, 3], [x + 5, 8], [x, 13]], '#7a4dff', 0); poly(ctx, [[x + 2, 5], [x + 4, 8], [x + 2, 11]], '#d9c7ff', 0); } }),
    prop(24, 24, (ctx, w, h) => { soft(ctx, w, h, 0.35); poly(ctx, [[12, 3], [20, 8], [20, 16], [12, 21], [4, 16], [4, 8]], '#241a6a', 1); poly(ctx, [[12, 6], [17, 9], [17, 15], [12, 18], [7, 15], [7, 9]], '#3b2a9a', 0); dot(ctx, 11, 11, 2, 2, '#19c6e6'); }),
  ],
  hospital: [
    prop(28, 24, (ctx) => { ctx.fillStyle = 'rgba(140,59,59,0.38)'; ctx.beginPath(); ctx.ellipse(13, 12, 11, 8, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(110,40,40,0.5)'; ctx.beginPath(); ctx.ellipse(11, 11, 6, 4, 0.4, 0, Math.PI * 2); ctx.fill(); disc(ctx, 24, 18, 2, '#8c3b3b', 0); disc(ctx, 4, 20, 1.5, '#8c3b3b', 0); }),
    prop(40, 24, (ctx, w, h) => { soft(ctx, w, h); box(ctx, 2, 3, 36, 18, '#aebfc7', 1); box(ctx, 4, 5, 32, 14, '#f4f8f9', 0); box(ctx, 5, 7, 11, 10, '#ffffff', 1); box(ctx, 18, 5, 18, 14, '#6fa8c9', 0); dot(ctx, 18, 5, 18, 1, '#9cc9e2'); }),
    prop(28, 20, (ctx, w, h) => { soft(ctx, w, h); box(ctx, 3, 4, 22, 12, '#9aa9b3', 1); box(ctx, 4, 5, 20, 3, '#cfd9df', 0); box(ctx, 6, 9, 5, 5, '#e05a5a', 0); box(ctx, 13, 9, 5, 5, '#4ab07a', 0); disc(ctx, 6, 17, 2, '#333c44', 1); disc(ctx, 22, 17, 2, '#333c44', 1); }),
    prop(22, 16, (ctx, w, h) => { soft(ctx, w, h, 0.2); oval(ctx, 11, 8, 9, 6, '#f6f8f8', 1); dot(ctx, 6, 6, 10, 1, '#d8e0e2'); dot(ctx, 7, 10, 8, 1, '#d8e0e2'); }),
    prop(28, 22, (ctx) => { ctx.fillStyle = 'rgba(170,200,205,0.6)'; ctx.beginPath(); ctx.ellipse(14, 11, 12, 8, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(235,245,248,0.8)'; ctx.beginPath(); ctx.ellipse(11, 9, 6, 3, 0.2, 0, Math.PI * 2); ctx.fill(); }),
  ],
  'military-base': [
    prop(36, 20, (ctx, w, h) => { soft(ctx, w, h); for (let i = 0; i < 4; i += 1) oval(ctx, 7 + i * 7.5, 13, 5, 3.5, i % 2 ? '#bfa268' : '#cdb078', 1); for (let i = 0; i < 3; i += 1) oval(ctx, 11 + i * 7.5, 8, 5, 3.5, i % 2 ? '#cdb078' : '#bfa268', 1); }),
    prop(22, 22, (ctx, w, h) => { soft(ctx, w, h); disc(ctx, 11, 10, 9, '#4d5a3a'); disc(ctx, 11, 10, 6, '#657650', 0); disc(ctx, 11, 10, 2, '#2f3825', 0); dot(ctx, 3, 9, 16, 2, 'rgba(214,185,46,0.6)'); }),
    prop(28, 28, (ctx, w, h) => { soft(ctx, w, h); box(ctx, 3, 3, 20, 20, '#8a6a3a', 1); box(ctx, 5, 5, 16, 16, '#a08050', 0); dot(ctx, 3, 12, 20, 2, '#5a4426'); dot(ctx, 12, 3, 2, 20, '#5a4426'); dot(ctx, 5, 5, 16, 1, '#c4a46c'); }),
    prop(32, 16, (ctx) => { box(ctx, 2, 2, 28, 12, '#2c3024', 1); stripes(ctx, 2, 2, 28, 12, '#d6b92e', '#1a1c14'); }),
    prop(28, 28, (ctx, w, h) => { soft(ctx, w, h); stroke(ctx, [[4, 4], [24, 24]], 4, '#4a5240', 1); stroke(ctx, [[24, 4], [4, 24]], 4, '#5a6450', 1); stroke(ctx, [[14, 3], [14, 25]], 4, '#4a5240', 1); }),
  ],
};
