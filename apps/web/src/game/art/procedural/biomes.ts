// Biome packs, one per theme. Sheet (384 x 176):
//   row 0   : six 64x64 ground tiles, tile i at x = i * 64, y = 0 (they tile in any order);
//   y 64..127: the wall texture at (0, 64), 64x64, tiles in both directions;
//   y 128..175: the props, each centered in its own 48x48 cell (cell i at x = i * 48); the manifest lists the exact rectangles.
import type { Manifest } from '@game-creator/contracts';
import type { ProceduralPack } from '../types';
import { BIOME_PAINT, TILE, groundBase } from './biome-tiles';
import { BIOME_PROPS } from './biome-props';
import { at, clipped, hash32, type Ctx } from './draw';

const TILES = 6;
const WIDTH = TILES * TILE;
const PROP_Y = 128;
const CELL = 48;
const HEIGHT = PROP_Y + CELL;

const AMBIENT: Record<string, NonNullable<Manifest['ambient']>> = {
  'zombie-city': 'none', 'alien-lab': 'sparks', 'dark-forest': 'fireflies', 'desert-ruins': 'dust',
  'ice-base': 'snow', 'neon-arena': 'sparks', hospital: 'none', 'military-base': 'none',
};

function biomePack(id: string): ProceduralPack {
  const paint = BIOME_PAINT[id];
  const props = BIOME_PROPS[id];
  if (!paint || !props) throw new Error(`biome ${id}: missing art`);
  const seed = hash32(id.length, id.charCodeAt(0), id.charCodeAt(id.length - 1)) % 1000;
  const rects = props.map((p, i) => ({ x: i * CELL + Math.floor((CELL - p.w) / 2), y: PROP_Y + Math.floor((CELL - p.h) / 2), w: p.w, h: p.h }));
  const manifest: Manifest = {
    version: 1, kind: 'biome', id, source: 'procedural', license: 'procedural', author: '', origin: '',
    tiles: { count: TILES, offset: { x: 0, y: 0 } },
    wall: { x: 0, y: TILE, w: TILE, h: TILE },
    props: rects,
    ambient: AMBIENT[id] ?? 'none',
  };
  return {
    manifest, width: WIDTH, height: HEIGHT,
    paint(ctx: Ctx) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      for (let v = 0; v < TILES; v += 1) {
        clipped(ctx, v * TILE, 0, TILE, TILE, () => at(ctx, v * TILE, 0, () => { groundBase(ctx, paint, v, seed); paint.detail(ctx, v); }));
      }
      clipped(ctx, 0, TILE, TILE, TILE, () => at(ctx, 0, TILE, () => paint.wall(ctx)));
      props.forEach((p, i) => {
        const r = rects[i];
        if (r) clipped(ctx, r.x, r.y, r.w, r.h, () => at(ctx, r.x, r.y, () => p.draw(ctx, p.w, p.h)));
      });
    },
  };
}

const IDS = ['zombie-city', 'alien-lab', 'dark-forest', 'desert-ruins', 'ice-base', 'neon-arena', 'hospital', 'military-base'] as const;
export const BIOME_PACKS: Record<string, ProceduralPack> = Object.fromEntries(IDS.map((id) => [id, biomePack(id)]));
