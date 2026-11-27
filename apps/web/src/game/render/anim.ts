// Frames of an animation, by REAL time (never by simulation tick): the same function for a pack drawn by code and for a PNG.
import type { AnimationSpec } from '@game-creator/contracts';
import { clamp01 } from './interpolate';

/** The index of the sheet's frame to show `elapsedMs` after the animation began. A loop wraps; a one-shot stays on its last frame. */
export function frameAt(animation: AnimationSpec, elapsedMs: number): number {
  const { frames, fps, loop } = animation;
  const step = Math.max(0, Math.floor((elapsedMs * fps) / 1000));
  const slot = loop ? step % frames.length : Math.min(step, frames.length - 1);
  return frames[slot]!;
}

/** How long a one-shot animation lasts (ms). */
export const durationOf = (animation: AnimationSpec) => (animation.frames.length * 1000) / animation.fps;
/** Whether a one-shot animation has played all of its frames. */
export const isFinished = (animation: AnimationSpec, elapsedMs: number) => !animation.loop && elapsedMs >= durationOf(animation);

/** Below this speed (px/s) a thing is standing: it shows `idle`, not a walk. */
export const MOVING_SPEED = 8;
export const isMoving = (measuredSpeed: number) => measuredSpeed >= MOVING_SPEED;
/** How fast a `move` animation plays: in step with the measured speed (px/s) over the speed it was drawn for, held between half and twice. */
export function moveRate(measuredSpeed: number, nominalSpeed: number): number {
  if (nominalSpeed <= 0) return 1;
  return Math.min(2, Math.max(0.5, measuredSpeed / nominalSpeed));
}

/** What to do when a pack lacks an animation (docs/art-packs.md): another animation to use, or an effect to improvise. */
export function fallbackFor(name: string): { use?: string; effect?: 'flash' | 'shrink' } {
  switch (name) {
    case 'hit': return { effect: 'flash' };
    case 'die': return { effect: 'shrink' };
    case 'attack': return { use: 'move' };
    case 'idle': return { use: 'move' }; // its first frame
    default: return {};
  }
}

/** A white flash after a hit, as an alpha 1 -> 0 over `ms` (held in 0..1). */
export const flashAlpha = (sinceHitMs: number, ms = 80) => clamp01(1 - sinceHitMs / ms);
