// Shared parts of the three enemy families (bug, mutant, robot): the pose of one frame and the types a family is made of.
// Every kind is drawn around (0, 0) = the center of its frame, facing +x; the wrapper in families.ts moves the origin.
import type { AnimationSpec, EnemyType } from '@game-creator/contracts';
import { anim, seq, type Ctx, type Pt } from './draw';

/** One animation frame of an enemy. `ph` walk phase (radians), `atk` 0..1 (wind-up, strike, recover), `flash` white tint, `die` 0..1. */
export interface FamPose { ph: number; atk: number; flash: number; die: number }

/** The colors of a family. Not every kind uses every color. */
export type Pal = { main: string; light: string; dark: string; accent: string; glow: string; extra: string };

export type KindDrawer = (ctx: Ctx, p: FamPose, c: Pal) => void;

export interface FamilySpec {
  id: 'bug' | 'mutant' | 'robot';
  pal: Pal;
  kinds: Record<EnemyType, KindDrawer>;
  /** Where the bullet leaves, as an offset (px) from the frame center. */
  muzzle: { spitter: Pt; gunner: Pt };
  /** y-scale of the body in the last dying frame (1 = no squash) and how much of the body fades. */
  flatten: number;
  fade: number;
  /** Drawn under the body (a splat, a scorch) and over it (sparks, flying plates), `k` = die progress 0..1, `r` = body radius. */
  under(ctx: Ctx, k: number, r: number, c: Pal): void;
  over(ctx: Ctx, k: number, r: number, c: Pal): void;
}

/** Frames of every kind's block: move 0-5 | attack 6-8 | hit 9 | die 10-13 (the columns of a block are set in families.ts). */
export const FAM_POSES: FamPose[] = [
  ...seq(0, 6).map((i): FamPose => ({ ph: (i / 6) * Math.PI * 2, atk: 0, flash: 0, die: 0 })),
  ...[0.4, 1, 0.55].map((atk): FamPose => ({ ph: 0, atk, flash: 0, die: 0 })),
  { ph: 0, atk: 0, flash: 1, die: 0 },
  ...seq(1, 4).map((i): FamPose => ({ ph: 0.7, atk: 0, flash: 0, die: i / 4 })),
];
export const famAnimations = (moveFps: number): Record<string, AnimationSpec> => ({
  move: anim(seq(0, 6), moveFps, true),
  attack: anim(seq(6, 3), 12, false),
  hit: anim([9], 10, false),
  die: anim(seq(10, 4), 10, false),
});
