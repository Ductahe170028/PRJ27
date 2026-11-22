// Grid pathfinding for chasing enemies. One breadth-first search from the
// player gives every enemy its way; nothing here is per enemy.
import { FIELD, NAV_CELL } from './constants.js';
import { clamp, dist as length, pointRectDistance, type Rect, type Vec } from './geometry.js';
import type { ShooterLevel } from './level.js';

export const NAV_COLS = (FIELD.right - FIELD.left) / NAV_CELL;
/** The last row would reach past the bottom edge; its center sits exactly on it and is blocked. */
export const NAV_ROWS = Math.ceil((FIELD.bottom - FIELD.top) / NAV_CELL);

export interface FlowField {
  /** Cell the field was built for (the player's). */
  goal: number;
  /** Tick it was built at. */
  atTick: number;
  /** Steps to the goal for every cell; -1 for blocked or unreachable cells. */
  dist: number[];
}

export const cellX = (cell: number) => (cell % NAV_COLS) * NAV_CELL + NAV_CELL / 2;
export const cellY = (cell: number) => FIELD.top + Math.floor(cell / NAV_COLS) * NAV_CELL + NAV_CELL / 2;

/** Cell holding a world point, clamped into the grid. */
export function cellOf(x: number, y: number): number {
  const col = clamp(Math.floor((x - FIELD.left) / NAV_CELL), 0, NAV_COLS - 1);
  const row = clamp(Math.floor((y - FIELD.top) / NAV_CELL), 0, NAV_ROWS - 1);
  return row * NAV_COLS + col;
}

/** blocked[cell]: the cell center lies closer than `inflate` to an obstacle, or outside the field. */
export function blockedCells(obstacles: readonly Rect[], inflate: number): boolean[] {
  const blocked: boolean[] = [];
  for (let cell = 0; cell < NAV_COLS * NAV_ROWS; cell += 1) {
    const x = cellX(cell);
    const y = cellY(cell);
    blocked.push(y >= FIELD.bottom || obstacles.some((block) => pointRectDistance(x, y, block) < inflate));
  }
  return blocked;
}

/** The 4 side neighbors, in a fixed order. */
function sides(cell: number): number[] {
  const col = cell % NAV_COLS;
  const row = Math.floor(cell / NAV_COLS);
  const out: number[] = [];
  if (row > 0) out.push(cell - NAV_COLS);
  if (col > 0) out.push(cell - 1);
  if (col < NAV_COLS - 1) out.push(cell + 1);
  if (row < NAV_ROWS - 1) out.push(cell + NAV_COLS);
  return out;
}

/** Breadth-first distances from `goal`. The goal is always a seed, even when
 * blocked (the player may stand right against a wall). Four directions. */
export function flowDistances(blocked: readonly boolean[], goal: number): number[] {
  const dist: number[] = new Array<number>(NAV_COLS * NAV_ROWS).fill(-1);
  const queue: number[] = [goal];
  dist[goal] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!;
    for (const next of sides(cell)) {
      if (dist[next] !== -1 || blocked[next]) continue;
      dist[next] = dist[cell]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

/** Nearest cell that is not blocked, for a point that was pushed into one. */
function nearestFree(blocked: readonly boolean[], x: number, y: number): number | undefined {
  const origin = cellOf(x, y);
  const col = origin % NAV_COLS;
  const row = Math.floor(origin / NAV_COLS);
  let best: number | undefined;
  let bestDistance = Infinity;
  for (let radius = 1; radius <= 4 && best === undefined; radius += 1) {
    for (let r = Math.max(0, row - radius); r <= Math.min(NAV_ROWS - 1, row + radius); r += 1) {
      for (let c = Math.max(0, col - radius); c <= Math.min(NAV_COLS - 1, col + radius); c += 1) {
        const cell = r * NAV_COLS + c;
        if (blocked[cell]) continue;
        const d = length(cellX(cell) - x, cellY(cell) - y);
        if (d < bestDistance) { bestDistance = d; best = cell; }
      }
    }
  }
  return best;
}

/** Side and diagonal steps, side steps first. */
const STEPS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/** Where an enemy that cannot see the player should walk: the center of the
 * neighbor cell that is closest to the player. Diagonals count only when both
 * side cells are free, so no path cuts a corner. Undefined when the enemy's
 * cell has no way to the goal. */
export function flowTarget(blocked: readonly boolean[], dist: readonly number[], x: number, y: number): Vec | undefined {
  const cell = cellOf(x, y);
  if (blocked[cell]) {
    const free = nearestFree(blocked, x, y);
    if (free === undefined) return undefined;
    return { x: cellX(free), y: cellY(free) };
  }
  const here = dist[cell]!;
  if (here < 0) return undefined;
  if (here === 0) return undefined;
  const col = cell % NAV_COLS;
  const row = Math.floor(cell / NAV_COLS);
  let best = -1;
  let bestDist = here;
  for (const [dc, dr] of STEPS) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || c >= NAV_COLS || r < 0 || r >= NAV_ROWS) continue;
    const next = r * NAV_COLS + c;
    const d = dist[next]!;
    if (d < 0 || d >= bestDist) continue;
    if (dc !== 0 && dr !== 0 && (blocked[row * NAV_COLS + c] || blocked[r * NAV_COLS + col])) continue;
    best = next; bestDist = d;
  }
  if (best < 0) return undefined;
  return { x: cellX(best), y: cellY(best) };
}

/** Whether every spawn point can reach the player over free space that keeps
 * `clearance` px between obstacles (a disk of that diameter fits). The player's
 * and each spawn's own cell may sit near a wall: they only need a free
 * neighbor that the search reached. */
export function freeSpaceConnected(level: ShooterLevel, clearance: number): boolean {
  const blocked = blockedCells(level.obstacles, clearance / 2);
  const dist = flowDistances(blocked, cellOf(level.player.x, level.player.y));
  return level.spawnPoints.every((spawn) => {
    const cell = cellOf(spawn.x, spawn.y);
    return dist[cell]! >= 0 || sides(cell).some((next) => dist[next]! >= 0);
  });
}
