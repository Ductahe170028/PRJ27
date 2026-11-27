// Enemy family packs `bug`, `mutant`, `robot`. One sheet per family; each of the six engine kinds is its own block of 14 frames
// (move 0-5, attack 6-8, hit 9, die 10-13). The manifest only allows a block `offset` up to 512 px, so the blocks are laid out
// two-dimensionally (all offsets <= 512; sheet 1008 x 544):
//   crusher 112px, 7 per row, 2 rows : offset (0, 0)     -> 784 x 224
//   gunner   96px, 7 per row, 2 rows : offset (0, 224)   -> 672 x 192
//   brute    64px, 7 per row, 2 rows : offset (0, 416)   -> 448 x 128
//   runner   36px, 14 in one row     : offset (448, 416) -> 504 x 36
//   swarmer  28px, 14 in one row     : offset (448, 452) -> 392 x 28
//   spitter  40px, 14 in one row     : offset (448, 480) -> 560 x 40
import { ENEMY_TYPES, type EnemyType, type FamilyKind } from '@game-creator/contracts';
import type { ProceduralPack } from '../types';
import { BUG } from './family-bug';
import { MUTANT } from './family-mutant';
import { ROBOT } from './family-robot';
import { FAM_POSES, famAnimations, type FamilySpec } from './family-shared';
import { at, clipped, flashed, frameOrigin, shadow, tinted, type Ctx } from './draw';

/** Frame size (square) of each kind, in px. The two bosses are much bigger than the rest. */
const FRAME_PX: Record<EnemyType, number> = { runner: 36, brute: 64, swarmer: 28, spitter: 40, crusher: 112, gunner: 96 };
const MOVE_FPS: Record<EnemyType, number> = { runner: 14, brute: 8, swarmer: 12, spitter: 10, crusher: 8, gunner: 8 };

interface Block { type: EnemyType; size: number; columns: number; x: number; y: number }
const BLOCKS: Block[] = [
  { type: 'crusher', size: FRAME_PX.crusher, columns: 7, x: 0, y: 0 },
  { type: 'gunner', size: FRAME_PX.gunner, columns: 7, x: 0, y: 224 },
  { type: 'brute', size: FRAME_PX.brute, columns: 7, x: 0, y: 416 },
  { type: 'runner', size: FRAME_PX.runner, columns: 14, x: 448, y: 416 },
  { type: 'swarmer', size: FRAME_PX.swarmer, columns: 14, x: 448, y: 452 },
  { type: 'spitter', size: FRAME_PX.spitter, columns: 14, x: 448, y: 480 },
];
const rowsOf = (b: Block): number => Math.ceil(FAM_POSES.length / b.columns);
const SHEET_W = Math.max(...BLOCKS.map((b) => b.x + b.columns * b.size));
const SHEET_H = Math.max(...BLOCKS.map((b) => b.y + rowsOf(b) * b.size));

function kindEntry(spec: FamilySpec, block: Block): FamilyKind {
  const half = block.size / 2;
  const entry: FamilyKind = {
    frame: { w: block.size, h: block.size }, columns: block.columns, offset: { x: block.x, y: block.y },
    body: { radius: ENEMY_TYPES[block.type].radius }, anchor: { x: 0.5, y: 0.5 },
    animations: famAnimations(MOVE_FPS[block.type]),
  };
  if (block.type === 'spitter' || block.type === 'gunner') {
    const [dx, dy] = spec.muzzle[block.type];
    entry.muzzle = { x: half + dx, y: half + dy };
  }
  return entry;
}

function paintFamily(spec: FamilySpec, ctx: Ctx): void {
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);
  for (const block of BLOCKS) {
    const r = ENEMY_TYPES[block.type].radius;
    const boss = block.type === 'crusher' || block.type === 'gunner';
    const drawKind = spec.kinds[block.type];
    FAM_POSES.forEach((pose, i) => {
      const o = frameOrigin(i, { w: block.size, h: block.size }, block.columns, { x: block.x, y: block.y });
      clipped(ctx, o.x, o.y, block.size, block.size, () => at(ctx, o.x + block.size / 2, o.y + block.size / 2, () => {
        shadow(ctx, 0, boss ? 6 : 4, r * 1.15, r * 0.65, boss ? 0.35 : 0.3);
        spec.under(ctx, pose.die, r, spec.pal);
        ctx.save();
        if (pose.die > 0) { ctx.scale(1, 1 - (1 - spec.flatten) * pose.die); ctx.globalAlpha = 1 - spec.fade * pose.die; }
        const pal = pose.flash > 0 ? flashed(spec.pal, 0.8) : pose.die > 0 ? tinted(spec.pal, '#000000', pose.die * 0.3) : spec.pal;
        drawKind(ctx, pose, pal);
        ctx.restore();
        spec.over(ctx, pose.die, r, spec.pal);
      }));
    });
  }
}

function familyPack(spec: FamilySpec): ProceduralPack {
  const kinds = Object.fromEntries(BLOCKS.map((block) => [block.type, kindEntry(spec, block)])) as Record<EnemyType, FamilyKind>;
  return {
    manifest: { version: 1, kind: 'family', id: spec.id, source: 'procedural', license: 'procedural', author: '', origin: '', kinds },
    width: SHEET_W, height: SHEET_H,
    paint: (ctx) => paintFamily(spec, ctx),
  };
}

export const FAMILY_PACKS: Record<string, ProceduralPack> = {
  bug: familyPack(BUG),
  mutant: familyPack(MUTANT),
  robot: familyPack(ROBOT),
};
