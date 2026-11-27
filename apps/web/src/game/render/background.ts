// The ground of a level, painted ONCE onto a canvas (never again per frame): tiles of the scenery, the walls of the obstacles with their
// shadow, the small props, and a light darkening of the corners. It only reads the level, a scenery pack's sheet and the props'
// placements, all of which are decided before it runs, so it can be tested with a fake canvas.
import { FIELD, type Manifest, type ShooterLevel } from '@game-creator/contracts';
import type { PlacedProp } from './props';
import { TILE, tileVariant } from './props';

export const SHADOW_OFFSET = 4;

/** The minimum a 2D context must do for the ground: the real CanvasRenderingContext2D, or a recording fake in a test. */
export type GroundContext = Pick<CanvasRenderingContext2D,
  'drawImage' | 'fillRect' | 'strokeRect' | 'save' | 'restore' | 'translate' | 'scale' | 'createPattern' | 'createRadialGradient'
  | 'fillStyle' | 'strokeStyle' | 'globalAlpha' | 'lineWidth' | 'imageSmoothingEnabled'>;
export type Sheet = CanvasImageSource;

/** Paints the whole ground (960 x 540) of `level` with the scenery pack `biome` whose sheet is `sheet`. `makeTile` cuts a piece of the
 * sheet out into a small canvas (used to make a repeating pattern for the walls); it is a parameter so that tests need no document. */
export function paintGround(
  ctx: GroundContext, level: Pick<ShooterLevel, 'seed' | 'obstacles' | 'theme'>, biome: Manifest, sheet: Sheet, props: readonly PlacedProp[],
  makeTile: (sheet: Sheet, x: number, y: number, w: number, h: number) => CanvasImageSource,
): void {
  ctx.imageSmoothingEnabled = false;
  const tiles = biome.tiles;
  const origin = tiles?.offset ?? { x: 0, y: 0 };
  const count = tiles?.count ?? 1;
  // the ground: every 64 x 64 cell gets one of the variants, by the level's seed
  ctx.fillStyle = level.theme.background;
  ctx.fillRect(0, 0, 960, 540);
  for (let row = 0; row * TILE < 540; row += 1) {
    for (let col = 0; col * TILE < 960; col += 1) {
      const variant = tileVariant(level.seed, col, row, count);
      ctx.drawImage(sheet, origin.x + variant * TILE, origin.y, TILE, TILE, col * TILE, row * TILE, TILE, TILE);
    }
  }
  // the props lie on the ground, under the walls
  const kinds = biome.props ?? [];
  for (const prop of props) {
    const kind = kinds[prop.index];
    if (!kind) continue;
    ctx.save();
    ctx.translate(prop.x, prop.y);
    if (prop.flip) ctx.scale(-1, 1);
    ctx.drawImage(sheet, kind.x, kind.y, kind.w, kind.h, -kind.w / 2, -kind.h / 2, kind.w, kind.h);
    ctx.restore();
  }
  // the walls: a shadow shifted by SHADOW_OFFSET, then the tiling wall texture, then a dark edge
  const wall = biome.wall;
  const pattern = wall ? ctx.createPattern(makeTile(sheet, wall.x, wall.y, wall.w, wall.h), 'repeat') : null;
  for (const block of level.obstacles) {
    const left = block.x - block.width / 2;
    const top = block.y - block.height / 2;
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#000000';
    ctx.fillRect(left + SHADOW_OFFSET, top + SHADOW_OFFSET, block.width, block.height);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(left, top);
    ctx.fillStyle = pattern ?? level.theme.wall;
    ctx.fillRect(0, 0, block.width, block.height);
    ctx.restore();
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, block.width - 2, block.height - 2);
  }
  // a light darkening of the corners
  const vignette = ctx.createRadialGradient(480, (FIELD.top + FIELD.bottom) / 2, 260, 480, (FIELD.top + FIELD.bottom) / 2, 640);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 960, 540);
}
