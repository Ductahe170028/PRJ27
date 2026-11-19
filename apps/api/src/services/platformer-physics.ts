// Tick simulation of one platformer jump or fall, following Phaser Arcade as used
// by GameSpecScene. Knows nothing about enemies, coins or repair.

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }

export const TICKS_PER_SECOND = 60;
export const FLIGHT_TICKS = 150;
export const MAX_FALL_SPEED = 1000; // GameSpecScene: player.setMaxVelocity(500, 1000)
export const PLAYFIELD_TOP = 70;
export const PLAYFIELD_BOTTOM = 500;
export const WORLD_WIDTH = 960;
export const FLOOR: Rect = { x: 480, y: 520, width: 960, height: 40 };
const EPS = 0.00001;

export interface FlightBody {
  half: number;
  speed: number;
  jumpSpeed: number;
  gravity: number;
}

export interface FlightWorld {
  /** Blocks the body may never enter, swept between ticks. */
  solids: readonly Rect[];
  /** Tops the body can land on. */
  surfaces: readonly Rect[];
}

/** Shared step counter so one navigation build stays inside its work budget. */
export interface SimulationBudget { used: number; limit: number }

export interface Flight {
  end: Point;
  /** Body center at every tick, start included. */
  points: Point[];
  ticks: number;
}

export function edgesOf(r: Rect, padding = 0) {
  return {
    left: r.x - r.width / 2 - padding, right: r.x + r.width / 2 + padding,
    top: r.y - r.height / 2 - padding, bottom: r.y + r.height / 2 + padding,
  };
}

// Swept AABB, not just endpoint checks: narrow walls cannot be tunneled through.
export function crosses(a: Point, b: Point, rect: Rect, padding: number): boolean {
  const bounds = edgesOf(rect, padding);
  let enter = 0, leave = 1;
  for (const [from, delta, low, high] of [
    [a.x, b.x - a.x, bounds.left + EPS, bounds.right - EPS],
    [a.y, b.y - a.y, bounds.top + EPS, bounds.bottom - EPS],
  ] as const) {
    if (Math.abs(delta) < EPS) { if (from < low || from > high) return false; }
    else {
      const t1 = (low - from) / delta, t2 = (high - from) / delta;
      enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2));
      if (enter > leave) return false;
    }
  }
  return enter <= leave;
}

export function insidePlayfield(p: Point, half: number): boolean {
  return p.x >= half && p.x <= WORLD_WIDTH - half && p.y >= PLAYFIELD_TOP + half && p.y <= PLAYFIELD_BOTTOM - half;
}

export function bodyValid(world: FlightWorld, p: Point, half: number): boolean {
  return insidePlayfield(p, half) && !world.solids.some((block) => crosses(p, p, block, half));
}

export function sweepClear(world: FlightWorld, a: Point, b: Point, half: number): boolean {
  return bodyValid(world, b, half) && !world.solids.some((block) => crosses(a, b, block, half));
}

/** Standing: the whole body width rests on one surface top. */
export function bodySupported(world: FlightWorld, p: Point, half: number): boolean {
  return world.surfaces.some((r) => Math.abs(p.y + half - (r.y - r.height / 2)) < EPS
    && p.x - half >= r.x - r.width / 2 - EPS && p.x + half <= r.x + r.width / 2 + EPS);
}

/** Horizontal position uncertainty of a real player, in px. Phaser moves the
 * body a whole `speed/60` per physics step, so a start x or a stop x can only
 * be matched to within one step. Flights keep this clearance from every block
 * side, which only rejects routes (conservative). */
export function horizontalFuzz(body: FlightBody): number {
  return body.speed / TICKS_PER_SECOND;
}

function overlapWidth(x: number, half: number, r: Rect): number {
  return Math.min(x + half, r.x + r.width / 2) - Math.max(x - half, r.x - r.width / 2);
}

/** One jump (jump=true) or fall from rest, steering toward targetX at full
 * speed. Returns the landing when the body comes to rest on a surface.
 *
 * Matches Phaser Arcade (fixed 1/60 step): gravity is added to vy, vy is capped
 * at 1000, then the position moves. Hitting the world top (y=70) or the
 * underside of a block clamps the body there with vy=0 and the fall continues;
 * horizontal motion is kept. Touching a block side, or entering a block corner
 * in a way Phaser could resolve either as a side or an underside hit, rejects
 * the whole flight (conservative). Landing needs the whole body width on the
 * surface (Phaser needs any overlap: conservative).
 */
export type FlightMode = 'jump' | 'fall' | 'walk-off';

/** `walk-off`: the body stands on a surface and walks toward `walkTargetX` until no
 * surface under it overlaps the body (Phaser keeps separating it back onto the
 * top while any overlap remains); the fall starts on that same tick and then steers toward `targetX`. The
 * surface walked off keeps its exact side, every other block gets the fuzz. */
export function simulateFlight(
  world: FlightWorld, body: FlightBody, start: Point, targetX: number, mode: FlightMode | boolean, budget?: SimulationBudget,
  walkTargetX = targetX,
): Flight | undefined {
  const kind: FlightMode = mode === true ? 'jump' : mode === false ? 'fall' : mode;
  const h = body.half;
  const fuzz = horizontalFuzz(body);
  const standing = kind === 'walk-off'
    ? world.surfaces.filter((r) => Math.abs(start.y + h - (r.y - r.height / 2)) < EPS
      && start.x + h > r.x - r.width / 2 && start.x - h < r.x + r.width / 2)
    : [];
  if (kind === 'walk-off' && standing.length === 0) return undefined;
  const padded = world.solids.map((r) => (standing.includes(r) ? r : { ...r, width: r.width + 2 * fuzz }));
  const flightWorld: FlightWorld = { solids: padded, surfaces: world.surfaces };
  let p = start;
  let vy = kind === 'jump' ? -body.jumpSpeed : 0;
  let walking = kind === 'walk-off';
  let leaving = false;
  const points: Point[] = [p];
  for (let tick = 1; tick <= FLIGHT_TICKS; tick += 1) {
    if (budget && ++budget.used > budget.limit) return undefined;
    vy = Math.min(MAX_FALL_SPEED, vy + body.gravity / TICKS_PER_SECOND);
    const aim = walking ? walkTargetX : targetX;
    const next = {
      x: p.x + Math.sign(aim - p.x) * Math.min(Math.abs(aim - p.x), body.speed / TICKS_PER_SECOND),
      y: p.y + vy / TICKS_PER_SECOND,
    };
    if (walking) {
      if (next.x === p.x) return undefined; // stopped on the surface: never walks off
      if (standing.some((r) => next.x + h > r.x - r.width / 2 + EPS && next.x - h < r.x + r.width / 2 - EPS)) {
        // Still overlapping its support: separated back onto the top, vy = 0.
        next.y = p.y;
        vy = 0;
        if (!sweepClear(flightWorld, p, next, h)) return undefined;
        points.push(next);
        p = next;
        continue;
      }
      walking = false;
      leaving = true;
    }
    // Body.checkWorldBounds runs before colliders: top clamp, vy *= -bounce (0).
    if (next.y - h < PLAYFIELD_TOP) {
      next.y = PLAYFIELD_TOP + h;
      vy = 0;
    }
    if (next.y < p.y) {
      // Underside hit. Only a body already under the block (by more than the
      // horizontal fuzz) before and after the step is a certain Y separation.
      let ceiling: number | undefined;
      for (const r of world.solids) {
        const bottom = r.y + r.height / 2;
        if (p.y - h >= bottom - EPS && next.y - h < bottom
          && overlapWidth(p.x, h, r) > fuzz && overlapWidth(next.x, h, r) > fuzz) {
          ceiling = Math.max(ceiling ?? -Infinity, bottom);
        }
      }
      if (ceiling !== undefined) {
        next.y = ceiling + h;
        vy = 0;
      }
    }
    let landing: number | undefined;
    if (vy >= 0) for (const r of world.surfaces) {
      const top = r.y - r.height / 2;
      const landY = top - h;
      // Stepping off the surface under the body is a fall, not a failed landing.
      if (Math.abs(p.y - landY) <= EPS) continue;
      if (p.y + h <= top + EPS && next.y + h >= top && next.x + h > r.x - r.width / 2 && next.x - h < r.x + r.width / 2) {
        landing = Math.min(landing ?? Infinity, landY);
      }
    }
    if (landing !== undefined) next.y = landing;
    // Phaser only checks where a step ends. On the tick that leaves the support
    // the body slid along its top and is now beside it, so the step is swept as
    // "along the top, then down"; a diagonal sweep would clip the corner it left.
    const corner = { x: next.x, y: p.y };
    const swept = leaving
      ? sweepClear(flightWorld, p, corner, h) && sweepClear(flightWorld, corner, next, h)
      : sweepClear(flightWorld, p, next, h);
    leaving = false;
    if (!swept) return undefined;
    points.push(next);
    if (landing !== undefined) return bodySupported(world, next, h) ? { end: next, points, ticks: tick } : undefined;
    p = next;
  }
  return undefined;
}
