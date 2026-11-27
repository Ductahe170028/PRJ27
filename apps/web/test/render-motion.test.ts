import { describe, expect, it } from 'vitest';
import { durationOf, fallbackFor, flashAlpha, frameAt, isFinished, isMoving, moveRate } from '../src/game/render/anim';
import { PositionHistory, alphaOf, clamp01, interpolatePoint, lerp } from '../src/game/render/interpolate';
import { angleDelta, turnFor, turnToward, wrapAngle } from '../src/game/render/rotation';

describe('smoothing positions between ticks', () => {
  it('draws between the position one tick ago and now', () => {
    expect(interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0)).toEqual({ x: 0, y: 0 });
    expect(interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
    expect(interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 1)).toEqual({ x: 10, y: 20 });
    expect(lerp(2, 4, 0.25)).toBe(2.5);
  });

  it('holds alpha in 0..1, however late or early the frame is', () => {
    expect(interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 0 }, 3)).toEqual({ x: 10, y: 0 });
    expect(interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 0 }, -1)).toEqual({ x: 0, y: 0 });
    expect(clamp01(0.3)).toBe(0.3);
    expect(alphaOf(8, 16)).toBe(0.5);
    expect(alphaOf(40, 16)).toBe(1);
    expect(alphaOf(-4, 16)).toBe(0);
  });

  it('keeps the last two ticks of every thing by id', () => {
    const history = new PositionHistory();
    history.push([{ id: 1, x: 100, y: 100 }]);
    history.push([{ id: 1, x: 110, y: 100 }]);
    expect(history.at(1, 0)).toEqual({ x: 100, y: 100 });
    expect(history.at(1, 0.5)).toEqual({ x: 105, y: 100 });
    expect(history.at(1, 1)).toEqual({ x: 110, y: 100 });
    expect(history.previous(1)).toEqual({ x: 100, y: 100 });
  });

  it('draws a thing that has just appeared where it is, never sliding in from (0, 0)', () => {
    const history = new PositionHistory();
    history.push([{ id: 1, x: 500, y: 300 }]);
    history.push([{ id: 1, x: 505, y: 300 }, { id: 2, x: 40, y: 110 }]);
    expect(history.at(2, 0)).toEqual({ x: 40, y: 110 });
    expect(history.at(2, 0.5)).toEqual({ x: 40, y: 110 });
    // the very first push is also drawn where it is
    const first = new PositionHistory();
    first.push([{ id: 7, x: 300, y: 200 }]);
    expect(first.at(7, 0)).toEqual({ x: 300, y: 200 });
  });

  it('forgets what is gone, and says nothing about what never was', () => {
    const history = new PositionHistory();
    history.push([{ id: 1, x: 1, y: 1 }, { id: 2, x: 2, y: 2 }]);
    history.push([{ id: 2, x: 3, y: 3 }]);
    expect(history.has(1)).toBe(false);
    expect(history.at(1, 0.5)).toBeUndefined();
    expect(history.at(99, 0.5)).toBeUndefined();
    expect(history.at(2, 0.5)).toEqual({ x: 2.5, y: 2.5 });
  });

  it('is smooth on a 144 Hz screen: many frames inside one tick move by small, equal steps', () => {
    const history = new PositionHistory();
    history.push([{ id: 1, x: 0, y: 0 }]);
    history.push([{ id: 1, x: 3.5, y: 0 }]); // 210 px/s at 60 ticks/s
    const frameMs = 1000 / 144;
    const xs: number[] = [];
    for (let accumulator = 0; accumulator < 1000 / 60; accumulator += frameMs) xs.push(history.at(1, alphaOf(accumulator, 1000 / 60))!.x);
    expect(xs.length).toBeGreaterThanOrEqual(2);
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 6);
  });
});

describe('animation frames by real time', () => {
  const loop = { frames: [4, 5, 6], fps: 10, loop: true };
  const once = { frames: [7, 8, 9], fps: 10, loop: false };

  it('loops a loop and stays on the last frame of a one-shot', () => {
    expect([0, 99, 100, 199, 200, 299, 300].map((ms) => frameAt(loop, ms))).toEqual([4, 4, 5, 5, 6, 6, 4]);
    expect([0, 100, 200, 300, 5000].map((ms) => frameAt(once, ms))).toEqual([7, 8, 9, 9, 9]);
  });

  it('never goes below the first frame for a negative time', () => {
    expect(frameAt(loop, -50)).toBe(4);
  });

  it('knows how long a one-shot lasts', () => {
    expect(durationOf(once)).toBe(300);
    expect(isFinished(once, 299)).toBe(false);
    expect(isFinished(once, 300)).toBe(true);
    expect(isFinished(loop, 99_999)).toBe(false);
  });

  it('plays a walk in step with the speed measured, between half and twice, and idles when standing', () => {
    expect(moveRate(100, 100)).toBe(1);
    expect(moveRate(50, 100)).toBe(0.5);
    expect(moveRate(10, 100)).toBe(0.5);
    expect(moveRate(500, 100)).toBe(2);
    expect(moveRate(5, 0)).toBe(1);
    expect(isMoving(0)).toBe(false);
    expect(isMoving(7.9)).toBe(false);
    expect(isMoving(8)).toBe(true);
  });

  it('says what to do when a pack lacks an animation', () => {
    expect(fallbackFor('hit')).toEqual({ effect: 'flash' });
    expect(fallbackFor('die')).toEqual({ effect: 'shrink' });
    expect(fallbackFor('attack')).toEqual({ use: 'move' });
    expect(fallbackFor('idle')).toEqual({ use: 'move' });
    expect(fallbackFor('move')).toEqual({});
    expect(flashAlpha(0)).toBe(1);
    expect(flashAlpha(40)).toBe(0.5);
    expect(flashAlpha(80)).toBe(0);
    expect(flashAlpha(500)).toBe(0);
  });
});

describe('turning without jumps', () => {
  it('takes the short way round and never snaps 180 degrees', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2); // across the seam, not the long way
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
    const next = turnToward(0, Math.PI, 0.3);
    expect(Math.abs(next)).toBeCloseTo(0.3);
  });

  it('arrives at the target and stays there', () => {
    expect(turnToward(1, 1.1, 0.5)).toBeCloseTo(1.1);
    let angle = 0;
    for (let i = 0; i < 100; i += 1) angle = turnFor(angle, 2.5, 16, 8);
    expect(angle).toBeCloseTo(2.5);
  });

  it('keeps angles in (-PI, PI]', () => {
    for (const a of [0, 3, 7, -7, 100, -100, Math.PI, -Math.PI]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a));
    }
  });
});
