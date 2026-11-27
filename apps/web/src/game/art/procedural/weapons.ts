// Weapon packs: `pistol`, `rapid`, `heavy`, `shotgun`, `piercing`. A hand-held gun seen from above, pointing +x.
// Sheet: 40x24 frames, 4 per row, 4 frames: idle 0 | fire 1-3 (kick back, barrel glow fading)  -> 160 x 24.
// manifest.anchor = the grip point, manifest.muzzle = the end of the barrel (px of the frame).
import type { Manifest } from '@game-creator/contracts';
import type { ProceduralPack } from '../types';
import { anim, box, clipped, dot, frameOrigin, glow, lighten, poly, type Ctx } from './draw';

const FRAME = { w: 40, h: 24 };
const COLUMNS = 4;
/** Per frame: how far the gun kicks back (px) and how much the barrel glows (0..1). */
const STATES = [{ kick: 0, g: 0 }, { kick: 2, g: 1 }, { kick: 1, g: 0.6 }, { kick: 0, g: 0.3 }] as const;

const STEEL = '#6b7686'; const DARK = '#363e4c'; const WOOD = '#6b4a2b';
type Draw = (ctx: Ctx, g: number, bullet: string) => void;

const pistol: Draw = (ctx, g, bullet) => {
  box(ctx, 7, 11, 6, 7, WOOD); // grip
  box(ctx, 8, 9, 18, 6, STEEL); // slide
  dot(ctx, 9, 10, 16, 1, lighten(STEEL, 0.4));
  box(ctx, 26, 10, 3, 4, DARK);
  dot(ctx, 22, 8, 2, 1, bullet);
  if (g > 0) glow(ctx, 29, 12, 3, bullet, g);
};
const rapid: Draw = (ctx, g, bullet) => {
  box(ctx, 1, 10, 6, 4, DARK); // stock
  box(ctx, 14, 15, 5, 8, DARK); // magazine, sticks out the side
  dot(ctx, 15, 17, 3, 1, bullet);
  box(ctx, 6, 9, 22, 6, STEEL); // body
  dot(ctx, 7, 10, 20, 1, lighten(STEEL, 0.4));
  box(ctx, 28, 11, 8, 2, DARK); // thin barrel
  dot(ctx, 12, 7, 6, 2, bullet);
  if (g > 0) glow(ctx, 36, 12, 3, bullet, g);
};
const heavy: Draw = (ctx, g, bullet) => {
  box(ctx, 3, 5, 24, 14, '#58524a'); // chunky body
  dot(ctx, 4, 6, 22, 2, lighten('#58524a', 0.35));
  box(ctx, 8, 19, 12, 4, bullet); // ammo cell
  box(ctx, 27, 8, 9, 8, DARK); // fat barrel
  box(ctx, 35, 6, 3, 12, STEEL); // muzzle brake
  dot(ctx, 12, 8, 8, 4, DARK);
  if (g > 0) glow(ctx, 38, 12, 4, bullet, g);
};
const shotgun: Draw = (ctx, g, bullet) => {
  box(ctx, 0, 9, 9, 6, WOOD); // stock
  box(ctx, 9, 9, 10, 6, DARK); // receiver
  box(ctx, 19, 8, 19, 3, STEEL); box(ctx, 19, 13, 19, 3, STEEL); // two barrels
  box(ctx, 21, 6, 9, 12, WOOD); // pump
  dot(ctx, 22, 8, 7, 1, lighten(WOOD, 0.35));
  dot(ctx, 36, 8, 2, 8, DARK);
  if (g > 0) glow(ctx, 38, 12, 4, bullet, g);
};
const piercing: Draw = (ctx, g, bullet) => {
  box(ctx, 1, 9, 6, 6, DARK); // stock
  box(ctx, 6, 10, 30, 4, '#2c2f4a'); // slim rail
  for (const x of [12, 17, 22, 27]) { box(ctx, x, 7, 2, 10, lighten('#7d4fc4', g * 0.6)); dot(ctx, x, 7, 2, 2, bullet); } // glowing coils
  poly(ctx, [[35, 12], [39, 9], [39, 15]], lighten('#c792ff', g * 0.6));
  if (g > 0) glow(ctx, 39, 12, 4, bullet, g);
};

interface Spec { draw: Draw; grip: [number, number]; muzzle: [number, number]; style: 'dot' | 'streak'; bullet: string }
const SPECS: Record<string, Spec> = {
  pistol: { draw: pistol, grip: [10, 12], muzzle: [29, 12], style: 'dot', bullet: '#ffe066' },
  rapid: { draw: rapid, grip: [11, 12], muzzle: [36, 12], style: 'dot', bullet: '#7ee8ff' },
  heavy: { draw: heavy, grip: [10, 12], muzzle: [38, 12], style: 'dot', bullet: '#ff9f43' },
  shotgun: { draw: shotgun, grip: [14, 12], muzzle: [38, 12], style: 'dot', bullet: '#ffd6a5' },
  piercing: { draw: piercing, grip: [11, 12], muzzle: [39, 12], style: 'streak', bullet: '#c792ff' },
};

function weaponPack(id: string, s: Spec): ProceduralPack {
  const manifest: Manifest = {
    version: 1, kind: 'weapon', id, source: 'procedural', license: 'procedural', author: '', origin: '',
    frame: FRAME, columns: COLUMNS, anchor: { x: s.grip[0] / FRAME.w, y: s.grip[1] / FRAME.h },
    muzzle: { x: s.muzzle[0], y: s.muzzle[1] },
    icon: 0, // the weapon at rest, for the weapon bar
    bullet: { style: s.style, color: s.bullet },
    animations: { idle: anim([0], 1, true), fire: anim([1, 2, 3], 24, false) },
  };
  return {
    manifest, width: FRAME.w * COLUMNS, height: FRAME.h,
    paint(ctx) {
      ctx.clearRect(0, 0, FRAME.w * COLUMNS, FRAME.h);
      STATES.forEach((st, i) => {
        const o = frameOrigin(i, FRAME, COLUMNS);
        clipped(ctx, o.x, o.y, FRAME.w, FRAME.h, () => { ctx.translate(o.x - st.kick, o.y); s.draw(ctx, st.g, s.bullet); });
      });
    },
  };
}

export const WEAPON_PACKS: Record<string, ProceduralPack> = Object.fromEntries(Object.entries(SPECS).map(([id, s]) => [id, weaponPack(id, s)]));
