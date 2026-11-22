// Map templates: a name becomes up to 12 rectangles. Everything is whole numbers
// and even sizes, so centers stay whole. The player starts at (480, 305); the
// field is x 0..960, y 70..540. Positions are drawn from the seeded generator,
// over the whole field, so two games of the same map rarely look alike. The
// engine decides every position; the AI only picks the map's name.
import { BRUTE_CLEARANCE, OBSTACLE_MARGIN, pointRectDistance, type ShooterLevel } from '@game-creator/contracts';
import type { Rng } from './rng.js';
import { randomInt } from './rng.js';
import type { ShooterBrief } from './brief.js';

export type Obstacle = ShooterLevel['obstacles'][number];
export type MapName = ShooterBrief['map'];
/** `variant` 0..7: later variants are tamer (fewer blocks, smaller jitter, wider
 * gaps), so a layout that does not fit can be tried again a little more loosely. */
export type MapTemplate = (rng: Rng, variant: number) => Obstacle[];

/** Narrowest passage a layout may leave: a brute (40 px) plus the clearance of
 * the level checks plus slack. Walls that touch (gap 0) are fine; slits are not. */
export const MIN_GAP = BRUTE_CLEARANCE + 12;
export const MAX_VARIANTS = 8;

const START = { x: 480, y: 305 } as const;
/** Keep an obstacle at least this far from the player's start: the schema's
 * margin plus room to move (px). */
export const START_CLEARANCE = OBSTACLE_MARGIN + 40;
/** Tries for each block of a scatter before it is given up. */
export const SCATTER_TRIES = 60;

const jitter = (rng: Rng, amplitude: number) => randomInt(rng, -amplitude, amplitude);
/** A whole, even number in [min, max] (both even), so that centers stay whole. */
const evenIn = (rng: Rng, min: number, max: number) => 2 * randomInt(rng, min / 2, max / 2);
const easing = (variant: number) => 1 - variant / MAX_VARIANTS;

/** Where enemies come from, in order of preference: corners, the middle of the
 * top and bottom edges, then four points between. At most 8 are used. */
export const SPAWN_CANDIDATES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 40, y: 110 }, { x: 920, y: 110 }, { x: 40, y: 500 }, { x: 920, y: 500 },
  { x: 480, y: 100 }, { x: 480, y: 510 },
  { x: 240, y: 100 }, { x: 720, y: 100 }, { x: 240, y: 510 }, { x: 720, y: 510 },
];

const rectGap = (a: Obstacle, b: Obstacle) => {
  const dx = Math.max(Math.abs(a.x - b.x) - (a.width + b.width) / 2, 0);
  const dy = Math.max(Math.abs(a.y - b.y) - (a.height + b.height) / 2, 0);
  return Math.sqrt(dx * dx + dy * dy);
};
const wide = (gap: number, minGap = MIN_GAP) => gap === 0 || gap >= minGap;
const edgeGaps = (a: Obstacle) => [a.x - a.width / 2 - 0, 960 - (a.x + a.width / 2), a.y - a.height / 2 - 70, 540 - (a.y + a.height / 2)];

/** Every gap between two obstacles, and between an obstacle and the field edge,
 * is either closed (the rectangles touch) or at least MIN_GAP wide. */
export function gapsAreWide(obstacles: readonly Obstacle[], minGap = MIN_GAP): boolean {
  for (let i = 0; i < obstacles.length; i += 1) {
    const a = obstacles[i]!;
    for (let j = i + 1; j < obstacles.length; j += 1) if (!wide(rectGap(a, obstacles[j]!), minGap)) return false;
    if (!edgeGaps(a).every((gap) => wide(gap, minGap))) return false;
  }
  return true;
}

export interface ScatterSpec {
  /** How many blocks to try to place: a whole number in [min, max] is drawn. */
  count: readonly [number, number];
  /** Every this many variants the range loses one block (never below `floor`). */
  fewerEvery: number;
  floor: number;
  /** Even sizes in [min, max]. A square uses the width for the height. */
  width: readonly [number, number];
  height: readonly [number, number];
  square?: boolean;
  /** Distance every block keeps from the field center (px, point to rectangle). Default: the start clearance. */
  awayFromCenter?: number;
}

/** Exclusion sampling over the whole field. For each block, up to 60 tries: draw
 * a size and a center anywhere that keeps the block inside the field, and keep it
 * when it (a) stays MIN_GAP from every block already placed (no touching, no
 * overlap), (b) leaves the field edge either at 0 or at least MIN_GAP, and (c)
 * keeps clear of the player's start. A block that fits in none of its tries is
 * left out, so there may be fewer blocks than drawn. The number of generator
 * draws is a function of the generator state alone: every try draws the same
 * numbers whether it is kept or not. */
export function scatter(rng: Rng, variant: number, spec: ScatterSpec): Obstacle[] {
  const reduce = Math.floor(variant / spec.fewerEvery);
  const min = Math.max(spec.floor, spec.count[0] - reduce);
  const max = Math.max(spec.floor, spec.count[1] - reduce);
  const wanted = randomInt(rng, min, max);
  const away = Math.max(START_CLEARANCE, spec.awayFromCenter ?? 0);
  const placed: Obstacle[] = [];
  for (let block = 0; block < wanted; block += 1) {
    for (let attempt = 0; attempt < SCATTER_TRIES; attempt += 1) {
      const width = evenIn(rng, spec.width[0], spec.width[1]);
      const height = spec.square ? width : evenIn(rng, spec.height[0], spec.height[1]);
      const x = randomInt(rng, width / 2, 960 - width / 2);
      const y = randomInt(rng, 70 + height / 2, 540 - height / 2);
      const candidate = { x, y, width, height };
      if (!edgeGaps(candidate).every((gap) => wide(gap))) continue;
      if (pointRectDistance(START.x, START.y, candidate) < away) continue;
      if (placed.some((other) => rectGap(candidate, other) < MIN_GAP)) continue;
      placed.push(candidate);
      break;
    }
  }
  return placed;
}

const openArena: MapTemplate = () => [];

/** 4 to 8 square pillars (50-70 px) anywhere on the field. */
const pillars: MapTemplate = (rng, variant) => scatter(rng, variant, {
  count: [4, 8], fewerEvery: 3, floor: 3, width: [50, 70], height: [50, 70], square: true,
});

/** A block that stands closer to a field edge than MIN_GAP (but does not touch it)
 * is moved back to exactly MIN_GAP. */
function clearEdges(block: Obstacle): Obstacle {
  let { x, y } = block;
  const [left, right, top, bottom] = edgeGaps(block) as [number, number, number, number];
  if (left > 0 && left < MIN_GAP) x += MIN_GAP - left;
  if (right > 0 && right < MIN_GAP) x -= MIN_GAP - right;
  if (top > 0 && top < MIN_GAP) y += MIN_GAP - top;
  if (bottom > 0 && bottom < MIN_GAP) y -= MIN_GAP - bottom;
  return { ...block, x, y };
}

/** Pushes a block away from the start until the start is clear, then clears the field edges. */
function settle(block: Obstacle): Obstacle {
  let { x, y } = block;
  const sx = x >= START.x ? 1 : -1;
  const sy = y >= START.y ? 1 : -1;
  for (let i = 0; i < 80 && pointRectDistance(START.x, START.y, { ...block, x, y }) < START_CLEARANCE; i += 1) { x += sx * 2; y += sy * 2; }
  return clearEdges({ ...block, x, y });
}

/** A crossing of corridors around the center, with four blocks of their own size
 * and distance (no mirror image), each nudged a little; now and then one is
 * missing, which makes a T. */
const crossCorridors: MapTemplate = (rng, variant) => {
  const spread = Math.round(40 * easing(variant));
  const blocks: Obstacle[] = [];
  for (const [sideX, sideY] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const width = evenIn(rng, 120, 190);
    const height = evenIn(rng, 50, 80);
    const gapX = randomInt(rng, 70, 110) + variant * 3; // from the vertical corridor
    const gapY = randomInt(rng, 60, 90) + variant * 3; // from the horizontal corridor
    const dx = jitter(rng, spread);
    const dy = jitter(rng, spread);
    blocks.push(settle({
      x: START.x + sideX * (gapX + width / 2) + dx, y: START.y + sideY * (gapY + height / 2) + dy, width, height,
    }));
  }
  const missing = rng() < 0.3 ? randomInt(rng, 0, 3) : -1;
  return blocks.filter((_, index) => index !== missing);
};

/** 1 or 2 long walls, vertical (two pieces with a gap of 110-160 px) or
 * horizontal (one wall that leaves an opening at one end). Where they stand is
 * drawn over the field, never over the start. */
const rooms: MapTemplate = (rng, variant) => {
  const count = rng() < 0.5 ? 1 : 2;
  const mixed = count === 2 && rng() < 0.3;
  const firstVertical = rng() < 0.6;
  const walls: Obstacle[] = [];
  for (let i = 0; i < count; i += 1) {
    const vertical = mixed ? i === 0 === firstVertical : firstVertical;
    const thickness = evenIn(rng, 32, 40);
    const gap = 2 * randomInt(rng, 55, 80) + variant * 2;
    if (vertical) {
      // x anywhere in 100..860 except a band around the start: draw, then skip the band.
      const keepOut = START_CLEARANCE + thickness / 2;
      const raw = randomInt(rng, 100, 860 - 2 * keepOut);
      const x = raw >= START.x - keepOut ? raw + 2 * keepOut : raw;
      const top = 2 * randomInt(rng, 30, Math.floor((410 - gap) / 2)); // 470 = top + gap + bottom, each piece >= 60
      const bottom = 470 - gap - top;
      walls.push({ x, y: 70 + top / 2, width: thickness, height: top }, { x, y: 540 - bottom / 2, width: thickness, height: bottom });
    } else {
      const length = evenIn(rng, 300, 400);
      const keepOut = START_CLEARANCE + thickness / 2;
      const raw = randomInt(rng, 150, 470 - 2 * keepOut);
      const y = raw >= START.y - keepOut ? raw + 2 * keepOut : raw;
      const openLeft = rng() < 0.5;
      const opening = Math.floor(gap / 2) * 2;
      walls.push(clearEdges({ x: openLeft ? opening + length / 2 : 960 - opening - length / 2, y, width: length, height: thickness }));
    }
  }
  return walls;
};

/** 1 to 3 big blocks to run around, scattered over the field and kept 150 px
 * from the center, so there is something to circle that does not block the start. */
const ring: MapTemplate = (rng, variant) => scatter(rng, variant, {
  count: [1, 3], fewerEvery: 3, floor: 1, width: [100, 200], height: [60, 140], awayFromCenter: 150,
});

export const MAP_TEMPLATES: Record<MapName, MapTemplate> = {
  'open-arena': openArena, pillars, 'cross-corridors': crossCorridors, rooms, ring,
};
