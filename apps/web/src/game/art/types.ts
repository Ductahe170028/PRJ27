// Shared types of the art system. A "pack" is a manifest plus a sheet (a PNG from public/art/, or drawn by our own code).
import type { ArtKind, Manifest } from '@game-creator/contracts';

/** A pack drawn by code ("procedural"): everything a PNG pack has (the same manifest fields: frame, columns, animations, body,
 * anchor...) except the file. `paint` draws the WHOLE sheet, frame after frame, onto a transparent canvas of `width` x `height`;
 * the game then slices it exactly like it slices a PNG. `manifest` and the sizes must not need a canvas, so that tests can read them. */
export interface ProceduralPack {
  manifest: Manifest;
  /** Size of the sheet in px. */
  width: number;
  height: number;
  paint(ctx: CanvasRenderingContext2D): void;
}

/** Where a pack came from once it is loaded. */
export type PackOrigin = 'png' | 'procedural';

export interface PackRef { kind: ArtKind; id: string }
