// Spatial grid over enemies (scratch, rebuilt before each use).
// Cells about the size of a small enemy: a crowd of 120 spreads over many cells,
// so a neighbor query visits a few enemies instead of the whole crowd.
import { FIELD } from './constants.js';
import type { ShooterEnemy } from './state.js';

const GRID = 32;
export const GRID_COLS = Math.ceil((FIELD.right - FIELD.left) / GRID);
export const GRID_ROWS = Math.ceil((FIELD.bottom - FIELD.top) / GRID);
export const gridCells: number[][] = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);
export const gridCol = (x: number) => Math.min(GRID_COLS - 1, Math.max(0, Math.floor((x - FIELD.left) / GRID)));
export const gridRow = (y: number) => Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((y - FIELD.top) / GRID)));

/** Cells that hold something, so that clearing costs the crowd, not the whole grid. */
const usedCells: number[] = [];

export function buildGrid(enemies: readonly ShooterEnemy[]) {
  for (const cell of usedCells) gridCells[cell]!.length = 0;
  usedCells.length = 0;
  for (let index = 0; index < enemies.length; index += 1) {
    const enemy = enemies[index]!;
    const cell = gridRow(enemy.y) * GRID_COLS + gridCol(enemy.x);
    const list = gridCells[cell]!;
    if (list.length === 0) usedCells.push(cell);
    list.push(index);
  }
}

export function gridQuery(minX: number, minY: number, maxX: number, maxY: number, visit: (index: number) => void) {
  const c0 = gridCol(minX); const c1 = gridCol(maxX);
  const r0 = gridRow(minY); const r1 = gridRow(maxY);
  for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) for (const index of gridCells[r * GRID_COLS + c]!) visit(index);
}
