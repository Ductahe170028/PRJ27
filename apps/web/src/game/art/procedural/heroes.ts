// Hero packs `scout` (slim, cap and scarf) and `armor` (bulky, shoulder pads and helmet). Drawn WITHOUT a weapon (weapons are
// overlays). Sheet: 48x48 frames, 8 per row, 17 frames:
//   idle 0-1 | move 2-7 | shoot 8-10 | hit 11-12 | die 13-16   (3 rows -> 384 x 144). Body circle: radius 14 at the frame center.
import type { Manifest } from '@game-creator/contracts';
import type { ProceduralPack } from '../types';
import { anim, at, box, clipped, disc, flashed, frameOrigin, poly, seq, shadow, tinted, oval, type Ctx } from './draw';

const FRAME = { w: 48, h: 48 };
const COLUMNS = 8;

interface Pose {
  /** Walk phase, radians. */ ph: number;
  /** 0..1 how far the body is kicked back by a shot (arms reach forward while > 0). */ recoil: number;
  /** 0..1 white flash. */ flash: number;
  /** 0..1 how far the hero has collapsed. */ die: number;
  /** Breathing, 0 or 1 (idle). */ breath: number;
}
const REST: Pose = { ph: 0, recoil: 0, flash: 0, die: 0, breath: 0 };

const POSES: Pose[] = [
  ...seq(0, 2).map((i): Pose => ({ ...REST, breath: i })),
  ...seq(0, 6).map((i): Pose => ({ ...REST, ph: (i / 6) * Math.PI * 2 })),
  ...[1, 0.6, 0.2].map((recoil): Pose => ({ ...REST, recoil })),
  ...[1, 0.55].map((flash): Pose => ({ ...REST, flash })),
  ...seq(1, 4).map((i): Pose => ({ ...REST, die: i / 4 })),
];

const FRAME_COUNT = POSES.length; // 17
const ROWS = Math.ceil(FRAME_COUNT / COLUMNS);

const SCOUT = { skin: '#f2c9a0', coat: '#e0a43c', coatDark: '#a56f1f', boot: '#4a3426', cap: '#2e4a86', scarf: '#d9453c', pack: '#6b4a2b' };
const ARMOR = { skin: '#f2c9a0', plate: '#8398ad', plateDark: '#46566b', light: '#c7d5e4', gold: '#f0b429', visor: '#5fd4ff', boot: '#2f3a49' };

function limbs(p: Pose): { foot: number; reach: number; swing: number } {
  return { foot: Math.round(Math.sin(p.ph) * 5), reach: p.recoil > 0 ? 1 : 0, swing: Math.round(Math.sin(p.ph) * 4) };
}

function drawScout(ctx: Ctx, p: Pose): void {
  const c = p.flash > 0 ? flashed(SCOUT, 0.55 + 0.35 * p.flash) : tinted(SCOUT, '#000000', p.die * 0.35);
  const { foot, reach, swing } = limbs(p);
  const wob = Math.round(Math.sin(p.ph + 1) * 2) + p.breath;
  const spread = p.die * 4;
  // boots, alternating
  oval(ctx, 2 + foot, -5 - spread, 4, 2.5, c.boot);
  oval(ctx, 2 - foot, 5 + spread, 4, 2.5, c.boot);
  // scarf tail streaming behind
  poly(ctx, [[-4, -3], [-12, -5 + wob], [-18, -1 + wob], [-12, 3 + wob], [-4, 3]], c.scarf);
  box(ctx, -9, -5, 5, 10, c.pack); // backpack
  // arms: hanging and swinging, or reaching forward together when shooting
  if (reach) {
    oval(ctx, 7, -6, 6, 3, c.coat); oval(ctx, 7, 6, 6, 3, c.coat);
    disc(ctx, 13, -3, 2.5, c.skin); disc(ctx, 13, 3, 2.5, c.skin);
  } else {
    oval(ctx, 2 + swing, -10 - spread, 5, 3, c.coat); oval(ctx, 2 - swing, 10 + spread, 5, 3, c.coat);
    disc(ctx, 6 + swing, -10 - spread, 2.5, c.skin); disc(ctx, 6 - swing, 10 + spread, 2.5, c.skin);
  }
  oval(ctx, 0, 0, 7.5, 10.5 + p.breath * 0.5, c.coat); // torso
  box(ctx, 1, -1, 4, 2, c.coatDark, 0);
  box(ctx, -3, -8, 2, 16, c.coatDark, 0); // jacket seam
  disc(ctx, 1, 0, 7, c.cap); // head under the cap
  poly(ctx, [[5, -6], [13, -4], [13, 4], [5, 6]], c.cap); // brim, points to +x
  box(ctx, -3, -1, 4, 2, c.scarf, 0);
}

function drawArmor(ctx: Ctx, p: Pose): void {
  const c = p.flash > 0 ? flashed(ARMOR, 0.55 + 0.35 * p.flash) : tinted(ARMOR, '#000000', p.die * 0.35);
  const { foot, reach, swing } = limbs(p);
  const spread = p.die * 4;
  oval(ctx, 2 + foot, -6 - spread, 5, 3.5, c.boot);
  oval(ctx, 2 - foot, 6 + spread, 5, 3.5, c.boot);
  if (reach) {
    oval(ctx, 8, -7, 7, 4, c.plateDark); oval(ctx, 8, 7, 7, 4, c.plateDark);
    disc(ctx, 15, -3, 3, c.light); disc(ctx, 15, 3, 3, c.light);
  } else {
    oval(ctx, 3 + swing, -11 - spread, 6, 4, c.plateDark); oval(ctx, 3 - swing, 11 + spread, 6, 4, c.plateDark);
  }
  oval(ctx, 0, 0, 10, 13 + p.breath * 0.5, c.plate); // heavy torso
  box(ctx, 3, -8, 3, 16, c.light, 0); // chest plate edge
  box(ctx, -7, -9, 3, 18, c.plateDark, 0); // back pack
  // shoulder pads, round and big
  const pad = reach ? 0 : swing;
  disc(ctx, 1 + pad, -13 - spread, 6, c.plate); disc(ctx, 1 - pad, 13 + spread, 6, c.plate);
  box(ctx, -1 + pad, -15 - spread, 4, 2, c.gold, 0); box(ctx, -1 - pad, 13 + spread, 4, 2, c.gold, 0);
  // helmet with a visor and a crest
  disc(ctx, 1, 0, 8.5, c.plateDark);
  box(ctx, -7, -1, 11, 2, c.gold, 0);
  box(ctx, 5, -5, 4, 10, c.visor);
}

function paintHero(ctx: Ctx, draw: (ctx: Ctx, p: Pose) => void, shiftY: number): void {
  POSES.forEach((pose, i) => {
    const o = frameOrigin(i, FRAME, COLUMNS);
    clipped(ctx, o.x, o.y, FRAME.w, FRAME.h, () => at(ctx, o.x + FRAME.w / 2, o.y + FRAME.h / 2, () => {
      shadow(ctx, 0, 4, 15 - pose.die * 2 + shiftY, 9 - pose.die * 3);
      ctx.save();
      ctx.translate(-Math.round(pose.recoil * 2) + Math.round(pose.flash * -1.5), pose.die * 3);
      if (pose.die > 0) ctx.scale(1 + pose.die * 0.15, 1 - pose.die * 0.45);
      draw(ctx, pose);
      ctx.restore();
    }));
  });
}

const manifest = (id: 'scout' | 'armor'): Manifest => ({
  version: 1, kind: 'hero', id, source: 'procedural', license: 'procedural', author: '', origin: '',
  frame: FRAME, columns: COLUMNS, body: { radius: 14 }, anchor: { x: 0.5, y: 0.5 },
  animations: {
    idle: anim([0, 1], 3, true),
    move: anim(seq(2, 6), 12, true),
    shoot: anim(seq(8, 3), 20, false),
    hit: anim([11, 12], 20, false),
    die: anim(seq(13, 4), 10, false),
  },
});

const pack = (id: 'scout' | 'armor', draw: (ctx: Ctx, p: Pose) => void): ProceduralPack => ({
  manifest: manifest(id), width: FRAME.w * COLUMNS, height: FRAME.h * ROWS,
  paint(ctx) { ctx.clearRect(0, 0, FRAME.w * COLUMNS, FRAME.h * ROWS); paintHero(ctx, draw, id === 'armor' ? 1 : 0); },
});

export const HERO_PACKS: Record<string, ProceduralPack> = {
  scout: pack('scout', drawScout),
  armor: pack('armor', drawArmor),
};
