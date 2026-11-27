// The format of an art pack (docs/art-packs.md) and of the `art` list the page sends to the game iframe. Pure data and zod:
// the game's rules never read any of it (a level's `look` and its art are only the "clothes" of a game).
import { z } from 'zod';
import { ENEMY_TYPE_NAMES } from './shooter/constants.js';
import { ArtIdSchema } from './shooter/look.js';
import { intBetween as integer } from './shooter/schema-helpers.js';

/** What a pack is for. `pickup` and `fx` are fixed packs (`health`, `basic`); the others are chosen by a level's `look`. */
export const ART_KINDS = ['biome', 'hero', 'family', 'base', 'weapon', 'pickup', 'fx'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** The names an animation can have, by kind of pack. A name that is missing falls back (see docs/art-packs.md). */
export const ANIMATION_NAMES = {
  hero: ['idle', 'move', 'shoot', 'hit', 'die'],
  family: ['idle', 'move', 'attack', 'hit', 'die'],
  base: ['idle', 'hit', 'low', 'destroyed'],
  weapon: ['idle', 'fire'],
  pickup: ['idle'],
  fx: ['muzzle', 'spark', 'smoke', 'puff', 'burst'],
} as const;

const FrameSizeSchema = z.object({ w: integer(8, 512), h: integer(8, 512) }).strict();
const AnimationSchema = z.object({
  /** Indexes of frames, counted row by row in the pack's grid (or in the kind's block, for a family). */
  frames: z.array(integer(0, 255)).min(1).max(32),
  fps: integer(1, 30),
  loop: z.boolean(),
}).strict();
const AnimationsSchema = z.record(z.string().regex(/^[a-z]{2,12}$/), AnimationSchema);
const PointSchema = z.object({ x: integer(0, 512), y: integer(0, 512) }).strict();
const BodySchema = z.union([
  z.object({ radius: z.number().positive().max(256) }).strict(),
  z.object({ w: z.number().positive().max(512), h: z.number().positive().max(512) }).strict(),
]);
const AnchorSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();

/** One kind of enemy inside a family: its own block of frames in the sheet. */
export const FamilyKindSchema = z.object({
  frame: FrameSizeSchema, columns: integer(1, 32),
  /** Where the block starts in the sheet (px from the top-left). */
  offset: PointSchema.optional(),
  body: z.object({ radius: z.number().positive().max(256) }).strict(),
  anchor: AnchorSchema.optional(),
  animations: AnimationsSchema,
  /** Where the bullet leaves the sprite, in px of the frame (a shooting kind). */
  muzzle: PointSchema.optional(),
}).strict();

export const ManifestSchema = z.object({
  version: z.literal(1),
  kind: z.enum(ART_KINDS),
  id: ArtIdSchema,
  source: z.enum(['png', 'procedural']),
  license: z.string().min(1).max(40),
  author: z.string().max(80),
  origin: z.string().max(200),
  sheet: z.literal('sheet.png').optional(),
  frame: FrameSizeSchema.optional(), columns: integer(1, 32).optional(),
  animations: AnimationsSchema.optional(),
  body: BodySchema.optional(),
  anchor: AnchorSchema.optional(),
  /** A base may stand out above its square by this many game px (a roof, an aerial). It is only to look at. */
  overhang: integer(0, 24).optional(),
  /** family: the six kinds of enemy of the engine, each with its block of frames. */
  kinds: z.partialRecord(z.enum(ENEMY_TYPE_NAMES), FamilyKindSchema).optional(),
  /** weapon: where the barrel ends (px of the frame, the gun points to +x) and what its bullet looks like. */
  muzzle: PointSchema.optional(),
  bullet: z.object({ style: z.enum(['dot', 'streak']), color: hexColor }).strict().optional(),
  /** weapon: the frame (by index) shown as the weapon's icon on the weapon bar; absent = the first frame of `idle`. */
  icon: integer(0, 255).optional(),
  /** biome: ground tiles of 64x64 (`count` variants in a row, starting at `offset`), a wall texture that tiles, small props, the air. */
  tiles: z.object({ count: integer(1, 16), offset: PointSchema.optional() }).strict().optional(),
  wall: z.object({ x: integer(0, 4096), y: integer(0, 4096), w: integer(8, 256), h: integer(8, 256) }).strict().optional(),
  props: z.array(z.object({ x: integer(0, 4096), y: integer(0, 4096), w: integer(4, 128), h: integer(4, 128) }).strict()).max(16).optional(),
  ambient: z.enum(['none', 'snow', 'dust', 'fireflies', 'sparks']).optional(),
}).strict().superRefine((manifest, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (manifest.source === 'png' && manifest.sheet === undefined) issue('sheet', 'Gói PNG cần "sheet".');
  const animated = manifest.kind === 'hero' || manifest.kind === 'base' || manifest.kind === 'weapon' || manifest.kind === 'pickup' || manifest.kind === 'fx';
  if (animated && (manifest.frame === undefined || manifest.columns === undefined || manifest.animations === undefined)) {
    issue('frame', 'Thiếu "frame", "columns" hoặc "animations".');
  }
  if (manifest.kind === 'hero' && !(manifest.body && 'radius' in manifest.body)) issue('body', 'Nhân vật cần body.radius.');
  if (manifest.kind === 'base' && !(manifest.body && 'w' in manifest.body)) issue('body', 'Căn cứ cần body.w và body.h.');
  if (manifest.kind === 'family' && (manifest.kinds === undefined || Object.keys(manifest.kinds).length === 0)) issue('kinds', 'Họ quái cần "kinds".');
  if (manifest.kind === 'weapon' && (manifest.muzzle === undefined || manifest.bullet === undefined)) issue('muzzle', 'Súng cần "muzzle" và "bullet".');
  if (manifest.kind === 'biome' && (manifest.tiles === undefined || manifest.wall === undefined)) issue('tiles', 'Phong cảnh cần "tiles" và "wall".');
  // Every animation must use frames that exist in its grid, and only the names the kind knows.
  const names: readonly string[] = ANIMATION_NAMES[manifest.kind as keyof typeof ANIMATION_NAMES] ?? [];
  const check = (animations: Record<string, z.infer<typeof AnimationSchema>> | undefined, columns: number | undefined, label: string) => {
    for (const [name, animation] of Object.entries(animations ?? {})) {
      if (names.length > 0 && !names.includes(name)) issue(label, `Tên hoạt ảnh lạ: ${name}.`);
      if (columns !== undefined && animation.frames.some((index) => index < 0)) issue(label, 'Khung âm.');
    }
  };
  check(manifest.animations, manifest.columns, 'animations');
  for (const [type, entry] of Object.entries(manifest.kinds ?? {})) check(entry.animations, entry.columns, `kinds.${type}`);
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type FamilyKind = z.infer<typeof FamilyKindSchema>;
export type AnimationSpec = z.infer<typeof AnimationSchema>;

// --- The art list in `runtime:init` -----------------------------------------------------------------------------------------
export const ART_MAX_PACKS = 12;
export const ART_MAX_IMAGE_CHARS = 1_572_864; // 1.5 MB of data URL
export const ART_MAX_TOTAL_CHARS = 6_291_456; // 6 MB of data URLs in one message
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

export const ArtPackSchema = z.object({
  kind: z.enum(ART_KINDS), id: ArtIdSchema, manifest: ManifestSchema,
  /** The sheet as a PNG data URL (a PNG pack only; a pack without it is drawn by the game's own code). */
  image: z.string().max(ART_MAX_IMAGE_CHARS).startsWith(PNG_DATA_URL_PREFIX).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
}).strict().superRefine((pack, ctx) => {
  if (pack.manifest.kind !== pack.kind || pack.manifest.id !== pack.id) ctx.addIssue({ code: 'custom', path: ['manifest'], message: 'Manifest không khớp với kind/id.' });
});
export const ArtListSchema = z.array(ArtPackSchema).max(ART_MAX_PACKS).superRefine((list, ctx) => {
  const total = list.reduce((sum, pack) => sum + (pack.image?.length ?? 0), 0);
  if (total > ART_MAX_TOTAL_CHARS) ctx.addIssue({ code: 'custom', message: 'Tổng dung lượng ảnh vượt giới hạn.' });
});
export type ArtPack = z.infer<typeof ArtPackSchema>;
