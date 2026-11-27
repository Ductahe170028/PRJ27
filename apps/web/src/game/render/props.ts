// Scenery that is only to look at: which ground tile goes where, where the small props lie, how the air moves. Everything is decided by
// integer hashes of the level's seed, never by Math.random, so the same level always looks the same. Pure functions.
import { FIELD, baseRectOf, pointRectDistance, type ShooterLevel } from '@game-creator/contracts';

/** A 32-bit integer hash of up to three numbers: the same numbers always give the same result. */
export function hash32(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
/** A number in [0, 1) from the same kind of hash. */
export const unit = (a: number, b = 0, c = 0) => hash32(a, b, c) / 4_294_967_296;

export const TILE = 64;
/** Which variant of the ground tile covers the cell (col, row): the same for the same seed. */
export const tileVariant = (seed: number, col: number, row: number, count: number) => hash32(seed, col, row) % Math.max(1, count);

export interface PropKind { w: number; h: number }
export interface PlacedProp { x: number; y: number; index: number; flip: boolean }
/** Props keep at least this far from an obstacle, the base, the player and a spawn point (px, from the edge of the prop). */
export const PROP_CLEARANCE = 24;
export const PROP_MIN = 25;
export const PROP_MAX = 40;

type Placing = Pick<ShooterLevel, 'seed' | 'obstacles' | 'player' | 'spawnPoints'> & Partial<Pick<ShooterLevel, 'base'>>;

/** 25 to 40 props scattered over the field by the level's seed. Each one is at least PROP_CLEARANCE px from everything the player
 * deals with, lies inside the field, and does not overlap another prop. `kinds` are the sizes of the biome's props. */
export function placeProps(level: Placing, kinds: readonly PropKind[]): PlacedProp[] {
  if (kinds.length === 0) return [];
  const target = PROP_MIN + (hash32(level.seed, 0x70, 1) % (PROP_MAX - PROP_MIN + 1));
  const placed: PlacedProp[] = [];
  const baseRect = level.base ? baseRectOf(level.base) : undefined;
  const half = (kind: PropKind) => Math.max(kind.w, kind.h) / 2;
  for (let attempt = 0; attempt < target * 40 && placed.length < target; attempt += 1) {
    const index = hash32(level.seed, 0x71, attempt) % kinds.length;
    const kind = kinds[index]!;
    const r = half(kind);
    const x = Math.round(r + 4 + unit(level.seed, 0x72, attempt) * (960 - 2 * r - 8));
    const y = Math.round(FIELD.top + r + 4 + unit(level.seed, 0x73, attempt) * (FIELD.bottom - FIELD.top - 2 * r - 8));
    if (level.obstacles.some((block) => pointRectDistance(x, y, block) - r < PROP_CLEARANCE)) continue;
    if (baseRect && pointRectDistance(x, y, baseRect) - r < PROP_CLEARANCE) continue;
    const near = (p: { x: number; y: number }) => Math.hypot(x - p.x, y - p.y) - r < PROP_CLEARANCE;
    if (near(level.player) || level.spawnPoints.some(near)) continue;
    if (placed.some((other) => Math.hypot(x - other.x, y - other.y) < r + half(kinds[other.index]!) + 2)) continue;
    placed.push({ x, y, index, flip: hash32(level.seed, 0x74, attempt) % 2 === 1 });
  }
  return placed;
}

// --- The air: at most 40 specks, each a pure function of (kind, index, time) ----------------------------------------------
export type Ambient = 'none' | 'snow' | 'dust' | 'fireflies' | 'sparks';
export const AMBIENT_COUNT: Record<Ambient, number> = { none: 0, snow: 40, dust: 28, fireflies: 22, sparks: 22 };
export interface Speck { x: number; y: number; alpha: number; size: number }

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Where speck `index` is `ms` after the start, in a field of 960 x (FIELD.bottom - FIELD.top) below the HUD strip. */
export function ambientSpeck(kind: Ambient, index: number, ms: number, seed: number): Speck {
  const h = (salt: number) => unit(seed, index, salt);
  const t = ms / 1000;
  const width = 960;
  const height = FIELD.bottom - FIELD.top;
  switch (kind) {
    case 'snow': {
      const fall = 18 + h(1) * 30;
      return { x: wrap(h(2) * width + Math.sin(t * (0.6 + h(3)) + h(4) * 6) * 14, width), y: FIELD.top + wrap(h(5) * height + t * fall, height), alpha: 0.35 + h(6) * 0.3, size: 1 + (h(7) > 0.7 ? 1 : 0) };
    }
    case 'dust':
      return { x: wrap(h(2) * width + t * (14 + h(1) * 24), width), y: FIELD.top + wrap(h(5) * height + Math.sin(t * 0.5 + h(4) * 6) * 8, height), alpha: 0.15 + h(6) * 0.2, size: 1 + (h(7) > 0.8 ? 1 : 0) };
    case 'fireflies': {
      const blink = 0.5 + 0.5 * Math.sin(t * (1.1 + h(1)) + h(4) * 6);
      return { x: h(2) * width + Math.sin(t * 0.4 + h(3) * 6) * 26, y: FIELD.top + h(5) * height + Math.cos(t * 0.35 + h(4) * 6) * 20, alpha: 0.1 + 0.6 * blink, size: 2 };
    }
    case 'sparks': {
      const rise = 22 + h(1) * 40;
      const life = wrap(t * (0.25 + h(3) * 0.2) + h(4), 1);
      return { x: wrap(h(2) * width + Math.sin(t + h(4) * 6) * 6, width), y: FIELD.top + wrap(h(5) * height - life * rise * 4, height), alpha: 0.7 * (1 - life), size: 1 + (h(7) > 0.6 ? 1 : 0) };
    }
    default:
      return { x: 0, y: FIELD.top, alpha: 0, size: 1 };
  }
}

