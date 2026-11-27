// Fixed packs: the health pickup (`PICKUP_PACKS.health`) and the effects (`FX_PACKS.basic`).
//   pickup/health: 24x24 frames, 4 per row: idle 0-3 (a medkit that pulses)  -> 96 x 24.
//   fx/basic: 32x32 frames, 8 per row, 20 frames: muzzle 0-2 | spark 3-5 | smoke 6-9 | puff 10-13 | burst 14-19  -> 256 x 96.
//   Effects are drawn around the frame center (the engine places that point on the muzzle, the impact, the corpse...).
import type { Manifest } from '@game-creator/contracts';
import type { ProceduralPack } from '../types';
import { anim, at, box, clipped, disc, dot, frameOrigin, glow, poly, rgba, seq, shadow, stroke, unit, type Ctx, type Pt } from './draw';

// --- pickup ------------------------------------------------------------------------------------------------------------------
const PICKUP_FRAME = { w: 24, h: 24 };
const PICKUP_COLUMNS = 4;
const PICKUP_FRAMES = 4;

function paintMedkit(ctx: Ctx, pulse: number): void {
  shadow(ctx, 12, 19, 9, 3.5, 0.3);
  ctx.strokeStyle = rgba('#4ade80', 0.25 + pulse * 0.4); ctx.lineWidth = 1.5; // the pulsing ring
  ctx.beginPath(); ctx.arc(12, 12, 9 + pulse * 1.5, 0, Math.PI * 2); ctx.stroke();
  const w = 14 + Math.round(pulse * 2); const x = 12 - w / 2;
  box(ctx, 9, 4, 6, 3, '#14532d', 1); // carry handle
  box(ctx, x, 12 - w / 2 + 1, w, w - 2, '#22a85a', 1);
  dot(ctx, x + 1, 12 - w / 2 + 2, w - 2, 1, '#6ee7a0');
  dot(ctx, 11, 8, 2, 8, '#ffffff'); dot(ctx, 8, 11, 8, 2, '#ffffff'); // the cross
}

const healthPack: ProceduralPack = {
  manifest: {
    version: 1, kind: 'pickup', id: 'health', source: 'procedural', license: 'procedural', author: '', origin: '',
    frame: PICKUP_FRAME, columns: PICKUP_COLUMNS, body: { radius: 10 },
    animations: { idle: anim(seq(0, 4), 5, true) },
  },
  width: PICKUP_FRAME.w * PICKUP_COLUMNS, height: PICKUP_FRAME.h,
  paint(ctx) {
    ctx.clearRect(0, 0, PICKUP_FRAME.w * PICKUP_COLUMNS, PICKUP_FRAME.h);
    for (let i = 0; i < PICKUP_FRAMES; i += 1) {
      const o = frameOrigin(i, PICKUP_FRAME, PICKUP_COLUMNS);
      clipped(ctx, o.x, o.y, PICKUP_FRAME.w, PICKUP_FRAME.h, () => at(ctx, o.x, o.y, () => paintMedkit(ctx, 0.5 - 0.5 * Math.cos((i / PICKUP_FRAMES) * Math.PI * 2))));
    }
  },
};

export const PICKUP_PACKS: Record<string, ProceduralPack> = { health: healthPack };

// --- fx ----------------------------------------------------------------------------------------------------------------------
const FX_FRAME = { w: 32, h: 32 };
const FX_COLUMNS = 8;
const FX_FRAMES = 20;

/** A bright muzzle flash pointing +x from the center. */
function muzzle(ctx: Ctx, i: number): void {
  const len = [11, 14, 8][i] ?? 8; const w = [5, 6, 3][i] ?? 3;
  const star = (l: number, h: number, color: string): void => poly(ctx, [[0, 0], [2, -h], [l * 0.6, -h * 0.4], [l, 0], [l * 0.6, h * 0.4], [2, h]], color, 0);
  glow(ctx, 0, 0, 5, '#ffd84a', 0.8);
  star(len, w, '#ff9f2e');
  star(len * 0.8, w * 0.7, '#ffd84a');
  star(len * 0.5, w * 0.4, '#ffffff');
  for (const side of [-1, 1]) poly(ctx, [[0, 0], [len * 0.45, side * len * 0.5], [len * 0.2, 0]], '#ffb23a', 0);
}
/** A small bullet-impact spark: rays flying out of a white core. */
function spark(ctx: Ctx, i: number): void {
  const t = i / 2;
  const alpha = 1 - t * 0.55;
  for (let k = 0; k < 7; k += 1) {
    const a = (k / 7) * Math.PI * 2 + unit(k, 3) * 0.5; const r0 = 2 + t * 4; const r1 = 5 + t * 6 + unit(k, 4) * 3;
    stroke(ctx, [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * r1, Math.sin(a) * r1]], 1.5, rgba(k % 2 ? '#ffe066' : '#ffb23a', alpha), 0);
  }
  disc(ctx, 0, 0, 3 - t * 1.5, rgba('#ffffff', alpha), 0);
}
/** A grey puff that rises and thins out. */
function smoke(ctx: Ctx, i: number): void {
  const t = i / 3;
  const blobs: Pt[] = [[-3, 2], [3, 1], [0, -2]];
  blobs.forEach(([x, y], k) => {
    const r = 5 + t * 3 + k * 0.5;
    ctx.fillStyle = rgba(k === 2 ? '#c3c8ce' : '#9aa0a8', 0.8 * (1 - t * 0.75));
    ctx.beginPath(); ctx.arc(x * (1 + t * 0.6), y - t * 8, r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = rgba('#6b7078', 0.35 * (1 - t));
  ctx.beginPath(); ctx.arc(1, 3 - t * 8, 3, 0, Math.PI * 2); ctx.fill();
}
/** A ring of dust bursting outward (a body bursts). */
function puff(ctx: Ctx, i: number): void {
  const t = (i + 1) / 4;
  ctx.fillStyle = rgba('#8a7c60', 0.35 * (1 - t));
  ctx.beginPath(); ctx.arc(0, 0, 4 + t * 6, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2 + unit(k, 5) * 0.4; const d = 3 + t * (8 + unit(k, 6) * 3); const r = Math.max(1.5, 4 - t * 1.6 + unit(k, 7));
    ctx.fillStyle = rgba(k % 2 ? '#d6c7a1' : '#f2ead4', 0.95 - t * 0.6);
    ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill();
  }
}
/** A big explosion: a ragged orange fireball, a yellow and a white core, then smoke. */
function burst(ctx: Ctx, i: number): void {
  const t = i / 5;
  const R = 5 + Math.min(1, t * 1.4) * 10;
  const ragged = (r: number, seed: number): Pt[] => seq(0, 12).map((k): Pt => { const a = (k / 12) * Math.PI * 2; const j = r * (0.82 + unit(k, seed, i % 2) * 0.3); return [Math.cos(a) * j, Math.sin(a) * j]; });
  if (t > 0.5) { ctx.fillStyle = rgba('#3a3a40', 0.5 * (1.2 - t)); ctx.beginPath(); ctx.arc(0, -1, R, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1 - Math.max(0, t - 0.6) * 1.6;
  poly(ctx, ragged(R, 11), t > 0.7 ? '#c2410c' : '#ff7a1a', 0);
  poly(ctx, ragged(R * 0.7, 12), '#ffd84a', 0);
  if (t < 0.8) disc(ctx, 0, 0, R * 0.4 * (1 - t), '#ffffff', 0);
  ctx.globalAlpha = 1;
  for (let k = 0; k < 6; k += 1) { // flying embers
    const a = unit(k, 13) * Math.PI * 2; const d = Math.min(15, R * (0.9 + unit(k, 14) * 0.3));
    dot(ctx, Math.round(Math.cos(a) * d) - 1, Math.round(Math.sin(a) * d) - 1, 2, 2, k % 2 ? '#ffe066' : '#ff9f2e');
  }
}

const FX_FRAME_DRAW: ((ctx: Ctx, i: number) => void)[] = [
  ...seq(0, 3).map((i) => (c: Ctx) => muzzle(c, i)),
  ...seq(0, 3).map((i) => (c: Ctx) => spark(c, i)),
  ...seq(0, 4).map((i) => (c: Ctx) => smoke(c, i)),
  ...seq(0, 4).map((i) => (c: Ctx) => puff(c, i)),
  ...seq(0, 6).map((i) => (c: Ctx) => burst(c, i)),
];

const fxManifest: Manifest = {
  version: 1, kind: 'fx', id: 'basic', source: 'procedural', license: 'procedural', author: '', origin: '',
  frame: FX_FRAME, columns: FX_COLUMNS, anchor: { x: 0.5, y: 0.5 },
  animations: {
    muzzle: anim(seq(0, 3), 30, false),
    spark: anim(seq(3, 3), 24, false),
    smoke: anim(seq(6, 4), 8, false),
    puff: anim(seq(10, 4), 16, false),
    burst: anim(seq(14, 6), 14, false),
  },
};

export const FX_PACKS: Record<string, ProceduralPack> = {
  basic: {
    manifest: fxManifest,
    width: FX_FRAME.w * FX_COLUMNS, height: FX_FRAME.h * Math.ceil(FX_FRAMES / FX_COLUMNS),
    paint(ctx) {
      ctx.clearRect(0, 0, FX_FRAME.w * FX_COLUMNS, FX_FRAME.h * Math.ceil(FX_FRAMES / FX_COLUMNS));
      FX_FRAME_DRAW.forEach((draw, i) => {
        const o = frameOrigin(i, FX_FRAME, FX_COLUMNS);
        clipped(ctx, o.x, o.y, FX_FRAME.w, FX_FRAME.h, () => at(ctx, o.x + FX_FRAME.w / 2, o.y + FX_FRAME.h / 2, () => draw(ctx, i)));
      });
    },
  },
};
