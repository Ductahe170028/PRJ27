// Circles, axis-aligned rectangles and segments. Rectangles are given by their
// CENTER and size, like everything else in a level. Pure functions only.
import { BASE_SIZE, FIELD } from './constants.js';

export interface Rect { x: number; y: number; width: number; height: number }
export interface Vec { x: number; y: number }

export const clamp = (value: number, min: number, max: number) => (value < min ? min : value > max ? max : value);

/** Length of (dx, dy). A plain square root: it is rounded the same way by every
 * engine, unlike the standard hypot function. */
export const dist = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);

/** Inside the play field, edges included. */
export function rectInsideField(rect: Rect): boolean {
  return rect.x - rect.width / 2 >= FIELD.left && rect.x + rect.width / 2 <= FIELD.right
    && rect.y - rect.height / 2 >= FIELD.top && rect.y + rect.height / 2 <= FIELD.bottom;
}

/** Distance from a point to the rectangle; 0 inside or on the edge. */
export function pointRectDistance(px: number, py: number, rect: Rect): number {
  const dx = Math.max(Math.abs(px - rect.x) - rect.width / 2, 0);
  const dy = Math.max(Math.abs(py - rect.y) - rect.height / 2, 0);
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointInsideRect(px: number, py: number, rect: Rect): boolean {
  return Math.abs(px - rect.x) < rect.width / 2 && Math.abs(py - rect.y) < rect.height / 2;
}

/** Pushes a circle out of one rectangle. Returns whether it moved. */
export function pushCircleOutOfRect(circle: Vec, radius: number, rect: Rect): boolean {
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const nearestX = clamp(circle.x, rect.x - halfW, rect.x + halfW);
  const nearestY = clamp(circle.y, rect.y - halfH, rect.y + halfH);
  let dx = circle.x - nearestX;
  let dy = circle.y - nearestY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance >= radius) return false;
  if (distance > 0) {
    circle.x = nearestX + (dx / distance) * radius;
    circle.y = nearestY + (dy / distance) * radius;
    return true;
  }
  // The center is inside the rectangle: leave by the shortest side.
  dx = circle.x - rect.x;
  dy = circle.y - rect.y;
  const overX = halfW - Math.abs(dx);
  const overY = halfH - Math.abs(dy);
  if (overX < overY) circle.x = rect.x + (dx < 0 ? -(halfW + radius) : halfW + radius);
  else circle.y = rect.y + (dy < 0 ? -(halfH + radius) : halfH + radius);
  return true;
}

/** Keeps a circle inside the play field and out of every rectangle. Two passes
 * so that a corner between two walls settles. */
export function resolveCircle(circle: Vec, radius: number, rects: readonly Rect[]): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const rect of rects) pushCircleOutOfRect(circle, radius, rect);
    circle.x = clamp(circle.x, FIELD.left + radius, FIELD.right - radius);
    circle.y = clamp(circle.y, FIELD.top + radius, FIELD.bottom - radius);
  }
}

/** Earliest t in [0,1] where the segment (x0,y0)-(x1,y1) touches the circle;
 * 0 when it starts inside. */
export function segmentCircleHit(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, radius: number): number | undefined {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return undefined;
  const b = fx * dx + fy * dy;
  if (b >= 0) return undefined; // moving away
  const discriminant = b * b - a * c;
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : undefined;
}

/** Earliest t in [0,1] where the segment enters the rectangle grown by `pad`
 * on every side (slab method); 0 when it starts inside. */
export function segmentRectHit(x0: number, y0: number, x1: number, y1: number, rect: Rect, pad = 0): number | undefined {
  const minX = rect.x - rect.width / 2 - pad;
  const maxX = rect.x + rect.width / 2 + pad;
  const minY = rect.y - rect.height / 2 - pad;
  const maxY = rect.y + rect.height / 2 + pad;
  let tMin = 0;
  let tMax = 1;
  // x slab, then y slab (unrolled: this runs for every enemy and bullet, every tick)
  const dx = x1 - x0;
  if (dx === 0) {
    if (x0 < minX || x0 > maxX) return undefined;
  } else {
    const t1 = (minX - x0) / dx;
    const t2 = (maxX - x0) / dx;
    tMin = Math.max(tMin, t1 < t2 ? t1 : t2);
    tMax = Math.min(tMax, t1 < t2 ? t2 : t1);
    if (tMin > tMax) return undefined;
  }
  const dy = y1 - y0;
  if (dy === 0) {
    if (y0 < minY || y0 > maxY) return undefined;
  } else {
    const t1 = (minY - y0) / dy;
    const t2 = (maxY - y0) / dy;
    tMin = Math.max(tMin, t1 < t2 ? t1 : t2);
    tMax = Math.min(tMax, t1 < t2 ? t2 : t1);
    if (tMin > tMax) return undefined;
  }
  return tMin;
}

/** Whether a circle moving straight from `from` to `to` stays clear of every rectangle. */
export function lineOfSight(from: Vec, to: Vec, radius: number, rects: readonly Rect[]): boolean {
  for (const rect of rects) if (segmentRectHit(from.x, from.y, to.x, to.y, rect, radius) !== undefined) return false;
  return true;
}

/** The square a base stands on: centered on the base, `BASE_SIZE` on a side. */
export const baseRectOf = (base: Vec): Rect => ({ x: base.x, y: base.y, width: BASE_SIZE, height: BASE_SIZE });

/** Radians in one degree. */
export const RADIANS_PER_DEGREE = Math.PI / 180;

/** tan(x) for |x| up to 30 degrees (0.5236 rad) with + - * only, from the series x + x^3/3 + 2x^5/15 +
 * 17x^7/315. Every engine rounds these the same way; Math.tan is not guaranteed to. Error at most
 * 0.0001 up to 30 degrees (0.00007 at 30, under 0.000001 at 12). */
export function tanSmall(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (1 / 3 + x2 * (2 / 15 + x2 * (17 / 315))));
}
