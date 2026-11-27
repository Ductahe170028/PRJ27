// Smooth drawing of a 60-tick simulation on any screen: every thing is drawn between where it was one tick ago and where it is now.
// Pure functions: no Phaser, no clock. Positions are only DRAWN this way; the game itself always uses the real ones.
export interface Point { x: number; y: number }
export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
export const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** `before + (now - before) * alpha`, with alpha held in 0..1. */
export function interpolatePoint(before: Point, now: Point, alpha: number): Point {
  const t = clamp01(alpha);
  return { x: lerp(before.x, now.x, t), y: lerp(before.y, now.y, t) };
}

/** How far through the current tick the frame is: the leftover time of the accumulator over the length of a tick, in 0..1. */
export const alphaOf = (accumulatorMs: number, tickMs: number) => clamp01(accumulatorMs / tickMs);

/** The positions of the last two ticks of every thing, by id. A thing that has just appeared has no "before": it is drawn where it is
 * (never slid in from (0, 0)); one that is gone is forgotten at the next push. */
export class PositionHistory {
  private before = new Map<number, Point>();
  private now = new Map<number, Point>();

  /** Call once per simulated tick with everything that exists after the tick. */
  push(things: ReadonlyArray<{ id: number; x: number; y: number }>): void {
    const next = new Map<number, Point>();
    for (const thing of things) next.set(thing.id, { x: thing.x, y: thing.y });
    const previous = this.now;
    this.before = new Map();
    for (const [id, point] of next) this.before.set(id, previous.get(id) ?? point);
    this.now = next;
  }

  /** Where to draw `id` at `alpha`; undefined when it does not exist. */
  at(id: number, alpha: number): Point | undefined {
    const now = this.now.get(id);
    if (!now) return undefined;
    return interpolatePoint(this.before.get(id) ?? now, now, alpha);
  }

  /** Where `id` was one tick ago. */
  previous(id: number): Point | undefined { return this.before.get(id); }
  has(id: number): boolean { return this.now.has(id); }
  clear(): void { this.before.clear(); this.now.clear(); }
}
