// Base packs: `bunker` (concrete block, roof turret, sandbags, door on the +x side) and `outpost` (light building, tall mast,
// radar dish, blinking light). Sheet: 120x120 frames, 4 per row, 9 frames (3 rows -> 480 x 360):
//   idle 0-1 | hit 2-3 | low 4-7 | destroyed 8.
// The body is an 80x80 square (Stage 6B: the base is bigger than the 56 px of the older levels; the game scales the sprite to the size of
// the level's base, 72 for the compiler's). It is at x 20..100, y 24..104 of each frame; masts and smoke rise above it (y 0..24).
import type { Manifest } from '@game-creator/contracts';
import type { ProceduralPack } from '../types';
import { anim, at, box, clipped, disc, dot, frameOrigin, glow, hash32, oval, poly, rgba, shadow, stroke, unit, type Ctx, type Pt } from './draw';

const FRAME = { w: 120, h: 120 };
const COLUMNS = 4;
const SQ = { x: 20, y: 24, w: 80, h: 80 };
/** The marks that were drawn for a square of 56 (sparks, cracks, smoke, rubble) are drawn on the 80 square by growing them about its corner. */
const GROW = 80 / 56;
const grown = (ctx: Ctx, draw: () => void): void => { ctx.save(); ctx.translate(SQ.x, SQ.y); ctx.scale(GROW, GROW); ctx.translate(-SQ.x, -SQ.y); draw(); ctx.restore(); };
const FRAMES = 9;

type Mode = 'idle' | 'hit' | 'low' | 'destroyed';
/** Draws the intact building. `f` = frame within the animation (the light blinks on it). */
type Building = (ctx: Ctx, f: number) => void;

const blink = (ctx: Ctx, x: number, y: number, on: boolean, color: string, off: string): void => {
  disc(ctx, x, y, 2.5, on ? color : off, 1);
  if (on) glow(ctx, x, y, 5, color, 0.8);
};

const bunker: Building = (ctx, f) => {
  box(ctx, SQ.x, SQ.y, SQ.w, SQ.h, '#8b9096', 2); // concrete block
  box(ctx, 27, 31, 66, 66, '#a3a8ae', 0);
  dot(ctx, 27, 31, 66, 3, '#c6cacf'); dot(ctx, 27, 94, 66, 3, '#757a80');
  for (const x of [43, 60, 77]) dot(ctx, x, 34, 1, 58, '#8b9096'); // panel seams
  for (const y of [48, 66]) dot(ctx, 29, y, 62, 1, '#929aa1');
  for (let i = 0; i < 4; i += 1) { dot(ctx, 31 + i * 17, 36, 2, 2, '#6c7279'); dot(ctx, 31 + i * 17, 90, 2, 2, '#6c7279'); } // rivets
  box(ctx, 89, 55, 14, 30, '#5d646d', 1); box(ctx, 93, 59, 10, 22, '#262b32', 1); // door on the right side
  dot(ctx, 97, 66, 2, 3, '#e0b93a'); dot(ctx, 97, 74, 2, 3, '#e0b93a');
  box(ctx, 33, 40, 16, 9, '#454b52', 1); box(ctx, 35, 42, 12, 5, '#1a1e23', 0); // roof hatch
  disc(ctx, 58, 66, 13, '#5a6068', 1); box(ctx, 66, 63, 22, 7, '#262b32', 1); disc(ctx, 58, 66, 9, '#7c838d', 1); box(ctx, 85, 62, 4, 9, '#454b52', 1); // roof turret
  dot(ctx, 55, 62, 5, 3, '#b9c0c9');
  for (let i = 0; i < 9; i += 1) oval(ctx, 26 + i * 8.5, 102, 6, 4.2, i % 2 ? '#bfa268' : '#cdb078', 1); // sandbag trim
  for (let i = 0; i < 4; i += 1) oval(ctx, 22, 38 + i * 11, 4.2, 5.5, i % 2 ? '#cdb078' : '#bfa268', 1);
  stroke(ctx, [[40, 32], [40, 10]], 2.5, '#4a5058', 1); stroke(ctx, [[34, 18], [46, 18]], 2, '#4a5058', 1); // antenna
  blink(ctx, 40, 8, f % 2 === 0, '#ff4a4a', '#5a1c1c');
};

const outpost: Building = (ctx, f) => {
  box(ctx, SQ.x, SQ.y, SQ.w, SQ.h, '#d3dae2', 2); // light building
  box(ctx, 26, 30, 68, 68, '#eef2f6', 0);
  dot(ctx, 26, 30, 68, 4, '#ffffff'); dot(ctx, 26, 94, 68, 4, '#b3bcc7');
  box(ctx, 26, 82, 68, 7, '#e0762e', 0); // orange stripe
  for (let i = 0; i < 4; i += 1) box(ctx, 31 + i * 15, 52, 11, 15, '#3d5a80', 1); // windows
  for (let i = 0; i < 4; i += 1) { dot(ctx, 32 + i * 15, 53, 5, 3, '#9ec5ef'); dot(ctx, 31 + i * 15, 67, 11, 1, '#2a4263'); }
  box(ctx, 89, 55, 14, 30, '#5d6d80', 1); box(ctx, 93, 59, 10, 22, '#2a3646', 1); // door on the right side
  box(ctx, 66, 36, 14, 10, '#c4ccd6', 1); dot(ctx, 68, 38, 10, 2, '#e8edf2'); // roof unit
  stroke(ctx, [[40, 32], [40, 6]], 3, '#59616b', 1); // tall mast
  stroke(ctx, [[32, 22], [48, 22]], 2.5, '#59616b', 1); stroke(ctx, [[35, 13], [45, 13]], 2.5, '#59616b', 1);
  blink(ctx, 40, 5, true, f % 2 === 0 ? '#ff4a4a' : '#4ade80', '#000000'); // red, then green
  stroke(ctx, [[78, 32], [78, 18]], 2.5, '#59616b', 1); // radar dish
  at(ctx, 78, 14, () => { ctx.rotate(f * 0.28 - 0.14); oval(ctx, 0, 0, 16, 6, '#cfd6de', 1); dot(ctx, -1, -1, 4, 2, '#e04a3a'); });
};

/** Sparks around the block: tiny crosses, different in every frame. */
function sparks(ctx: Ctx, f: number): void {
  for (let i = 0; i < 7; i += 1) {
    const x = 18 + (hash32(i, f, 1) % 60); const y = 22 + (hash32(i, f, 2) % 60);
    const len = 2 + (hash32(i, f, 3) % 3);
    dot(ctx, x - len, y, len * 2 + 1, 1, i % 2 ? '#ffe066' : '#ffffff'); dot(ctx, x, y - len, 1, len * 2 + 1, '#ffb23a');
  }
}
const CRACKS: Pt[][] = [
  [[34, 24], [38, 36], [32, 46], [40, 58]],
  [[76, 38], [66, 44], [62, 54], [52, 60], [54, 72]],
  [[44, 80], [50, 70], [46, 64]],
];
function smoke(ctx: Ctx, f: number): void {
  for (let j = 0; j < 3; j += 1) {
    const t = (f / 4 + j / 3) % 1;
    const x = 34 + j * 14 + Math.round(Math.sin(t * 6 + j) * 3); const y = 36 - t * 26; const r = 3 + t * 5;
    ctx.fillStyle = rgba(j % 2 ? '#6a6f77' : '#4b4f56', 0.7 * (1 - t * 0.8));
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
function flame(ctx: Ctx, x: number, y: number, h: number): void {
  poly(ctx, [[x - 4, y], [x - 3, y - h * 0.5], [x, y - h], [x + 3, y - h * 0.5], [x + 4, y]], '#ff7a1a', 1);
  poly(ctx, [[x - 2, y], [x, y - h * 0.6], [x + 2, y]], '#ffd84a', 0);
}
function rubble(ctx: Ctx): void {
  ctx.fillStyle = 'rgba(12,10,10,0.55)';
  ctx.beginPath(); ctx.ellipse(48, 54, 31, 28, 0, 0, Math.PI * 2); ctx.fill();
  const greys = ['#7d8288', '#5f646b', '#9a9ea4', '#6e5f55', '#4a4e54'];
  for (let i = 0; i < 18; i += 1) {
    const cx = 26 + (hash32(i, 41) % 44); const cy = 30 + (hash32(i, 42) % 44);
    const r = 3 + (hash32(i, 43) % 5);
    const pts: Pt[] = [0, 1, 2, 3, 4].map((k): Pt => { const a = (k / 5) * Math.PI * 2 + unit(i, 44); return [cx + Math.cos(a) * r * (0.7 + unit(i, k)), cy + Math.sin(a) * r * (0.6 + unit(i, k, 7) * 0.6)]; });
    poly(ctx, pts, greys[i % greys.length] ?? '#777777', 1);
  }
  stroke(ctx, [[36, 44], [44, 30]], 1.5, '#8a5a3a', 1); stroke(ctx, [[60, 68], [68, 56]], 1.5, '#8a5a3a', 1); // bent rebar
  flame(ctx, 33, 62, 11); flame(ctx, 54, 52, 15); flame(ctx, 63, 68, 9);
}

function paintBase(ctx: Ctx, building: Building, mode: Mode, f: number): void {
  shadow(ctx, 60, 108, 50, 8, 0.32);
  if (mode === 'destroyed') { grown(ctx, () => rubble(ctx)); return; }
  building(ctx, f);
  if (mode === 'hit') {
    ctx.fillStyle = `rgba(255,255,255,${f === 0 ? 0.7 : 0.4})`; ctx.fillRect(SQ.x - 1, SQ.y - 1, SQ.w + 2, SQ.h + 2);
    grown(ctx, () => sparks(ctx, f));
  } else if (mode === 'low') {
    ctx.fillStyle = 'rgba(20,10,6,0.3)'; ctx.fillRect(SQ.x, SQ.y, SQ.w, SQ.h);
    grown(ctx, () => {
      for (const c of CRACKS) stroke(ctx, c, 1.5, '#1c1612', 0);
      poly(ctx, [[76, 24], [62, 24], [68, 31], [76, 38]], '#2b2420', 1); // a broken corner
      if (f % 2 === 1) { dot(ctx, 49, 66, 3, 3, '#ff7a1a'); dot(ctx, 50, 65, 1, 2, '#ffd84a'); }
      smoke(ctx, f);
    });
  }
}

const SPECS: Record<string, Building> = { bunker, outpost };
const SEQUENCE: { mode: Mode; f: number }[] = [
  { mode: 'idle', f: 0 }, { mode: 'idle', f: 1 }, { mode: 'hit', f: 0 }, { mode: 'hit', f: 1 },
  { mode: 'low', f: 0 }, { mode: 'low', f: 1 }, { mode: 'low', f: 2 }, { mode: 'low', f: 3 }, { mode: 'destroyed', f: 0 },
];

function basePack(id: string, building: Building): ProceduralPack {
  const manifest: Manifest = {
    version: 1, kind: 'base', id, source: 'procedural', license: 'procedural', author: '', origin: '',
    frame: FRAME, columns: COLUMNS, body: { w: SQ.w, h: SQ.h }, anchor: { x: 0.5, y: (SQ.y + SQ.h / 2) / FRAME.h }, overhang: 24,
    animations: {
      idle: anim([0, 1], 2, true), hit: anim([2, 3], 20, false), low: anim([4, 5, 6, 7], 6, true), destroyed: anim([8], 1, false),
    },
  };
  const width = FRAME.w * COLUMNS; const height = FRAME.h * Math.ceil(FRAMES / COLUMNS);
  return {
    manifest, width, height,
    paint(ctx) {
      ctx.clearRect(0, 0, width, height);
      SEQUENCE.forEach(({ mode, f }, i) => { const o = frameOrigin(i, FRAME, COLUMNS); clipped(ctx, o.x, o.y, FRAME.w, FRAME.h, () => at(ctx, o.x, o.y, () => paintBase(ctx, building, mode, f))); });
    },
  };
}

export const BASE_PACKS: Record<string, ProceduralPack> = Object.fromEntries(Object.entries(SPECS).map(([id, b]) => [id, basePack(id, b)]));
