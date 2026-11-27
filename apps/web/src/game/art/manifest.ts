// The manifest of an art pack (docs/art-packs.md). The zod schema lives in the contracts package, because the `runtime:init`
// message that carries packs to the game iframe has to check it too; this file is where the web code reaches it, plus the few
// pure helpers that read a manifest (where a frame is in the sheet, how big to draw a body).
import type { AnimationSpec, FamilyKind, Manifest } from '@game-creator/contracts';

export { ANIMATION_NAMES, ART_KINDS, ManifestSchema } from '@game-creator/contracts';
export type { AnimationSpec, ArtKind, FamilyKind, Manifest } from '@game-creator/contracts';

export interface Rect { x: number; y: number; w: number; h: number }

/** The piece of the sheet where frame `index` is: the frames of a grid are counted row by row. */
export function frameRect(frame: { w: number; h: number }, columns: number, index: number, offset: { x: number; y: number } = { x: 0, y: 0 }): Rect {
  return { x: offset.x + (index % columns) * frame.w, y: offset.y + Math.floor(index / columns) * frame.h, w: frame.w, h: frame.h };
}

/** Every frame an animation names lies inside a sheet of this size. */
export function framesFit(
  grid: { frame: { w: number; h: number }; columns: number; offset?: { x: number; y: number } | undefined; animations: Record<string, AnimationSpec> },
  sheetWidth: number, sheetHeight: number,
): boolean {
  for (const animation of Object.values(grid.animations)) {
    for (const index of animation.frames) {
      const rect = frameRect(grid.frame, grid.columns, index, grid.offset);
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > sheetWidth || rect.y + rect.h > sheetHeight) return false;
    }
  }
  return true;
}

/** Whether every grid of a manifest (its own, and each kind's block of a family) fits a sheet of this size. */
export function manifestFits(manifest: Manifest, sheetWidth: number, sheetHeight: number): boolean {
  if (manifest.frame && manifest.columns && manifest.animations && !framesFit({ frame: manifest.frame, columns: manifest.columns, animations: manifest.animations }, sheetWidth, sheetHeight)) return false;
  for (const entry of Object.values(manifest.kinds ?? {})) {
    if (!framesFit({ frame: entry.frame, columns: entry.columns, offset: entry.offset, animations: entry.animations }, sheetWidth, sheetHeight)) return false;
  }
  if (manifest.icon !== undefined && manifest.frame && manifest.columns) {
    const rect = frameRect(manifest.frame, manifest.columns, manifest.icon);
    if (rect.x + rect.w > sheetWidth || rect.y + rect.h > sheetHeight) return false;
  }
  if (manifest.tiles) {
    const offset = manifest.tiles.offset ?? { x: 0, y: 0 };
    if (offset.x + manifest.tiles.count * 64 > sheetWidth || offset.y + 64 > sheetHeight) return false;
  }
  if (manifest.wall && (manifest.wall.x + manifest.wall.w > sheetWidth || manifest.wall.y + manifest.wall.h > sheetHeight)) return false;
  for (const prop of manifest.props ?? []) if (prop.x + prop.w > sheetWidth || prop.y + prop.h > sheetHeight) return false;
  return true;
}

/** How much to scale a sprite so that its body matches the game's hit shape: radius for a disk, width for a square. */
export function bodyScale(body: Manifest['body'] | FamilyKind['body'], gameSize: number): number {
  if (!body) return 1;
  if ('radius' in body) return gameSize / body.radius;
  return gameSize / body.w; // a square: `gameSize` is then the game's side (the base's own size, `baseSizeOf`)
}
