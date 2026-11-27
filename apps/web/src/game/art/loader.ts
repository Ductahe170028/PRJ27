// Getting the packs a level needs into the game iframe. The page sends the PNG packs it fetched (as data URLs, because this iframe may
// not load addresses: its CSP allows only `data:` and `blob:` images); the game checks each one again, decodes it, and for anything
// missing or broken uses the pack drawn by our own code, so that a game never breaks for want of an image.
import { ART_MAX_PACKS, ART_MAX_TOTAL_CHARS, ArtPackSchema, type ArtKind, type ArtPack } from '@game-creator/contracts';
import { manifestFits } from './manifest';
import type { Manifest } from './manifest';
import { PROCEDURAL_PACKS, proceduralPack } from './registry';
import type { PackOrigin, PackRef, ProceduralPack } from './types';

export { neededRefs } from './refs';

export type SheetSource = HTMLCanvasElement | HTMLImageElement;
export interface LoadedPack { kind: ArtKind; id: string; manifest: Manifest; origin: PackOrigin; source: SheetSource; width: number; height: number }
export interface LoadedArt {
  packs: Map<string, LoadedPack>;
  /** How many packs that were meant to be PNG are drawn by code instead (the page could not fetch them, or the game rejected them). */
  fallbacks: number;
}
export const packKey = (kind: ArtKind, id: string) => `${kind}/${id}`;

/** The packs of an `art` list that pass the schema, one by one (a bad one is dropped, the good ones stay), at most 12 and 6 MB in all.
 * Anything that is not a list gives nothing. */
export function validSuppliedPacks(art: unknown): ArtPack[] {
  if (!Array.isArray(art)) return [];
  const good: ArtPack[] = [];
  let total = 0;
  for (const entry of art.slice(0, ART_MAX_PACKS)) {
    const parsed = ArtPackSchema.safeParse(entry);
    if (!parsed.success) continue;
    total += parsed.data.image?.length ?? 0;
    if (total > ART_MAX_TOTAL_CHARS) break;
    good.push(parsed.data);
  }
  return good;
}

/** Paints a pack drawn by code onto a canvas. */
export function paintPack(pack: ProceduralPack): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pack.width;
  canvas.height = pack.height;
  const ctx = canvas.getContext('2d');
  if (ctx) pack.paint(ctx);
  return canvas;
}

const DECODE_TIMEOUT_MS = 3000;
/** Decodes a PNG data URL into an image; undefined when it does not decode in time. */
function decode(dataUrl: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(undefined), DECODE_TIMEOUT_MS);
    image.onload = () => { window.clearTimeout(timer); resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : undefined); };
    image.onerror = () => { window.clearTimeout(timer); resolve(undefined); };
    image.src = dataUrl;
  });
}

function procedural(kind: ArtKind, id: string): LoadedPack {
  const pack = proceduralPack(kind, id);
  const known = PROCEDURAL_PACKS[kind][id] !== undefined;
  return { kind, id: known ? id : pack.manifest.id, manifest: pack.manifest, origin: 'procedural', source: paintPack(pack), width: pack.width, height: pack.height };
}

/** Loads every pack of `refs`: the supplied PNG one when it is valid, else the one drawn by code. `parentFallbacks` is how many the
 * page already gave up on (it could not fetch them): they count too. */
export async function loadArt(refs: readonly PackRef[], supplied: unknown, parentFallbacks = 0): Promise<LoadedArt> {
  const given = validSuppliedPacks(supplied);
  const packs = new Map<string, LoadedPack>();
  let fallbacks = Math.max(0, Math.floor(parentFallbacks));
  await Promise.all(refs.map(async (ref) => {
    const offered = given.find((pack) => pack.kind === ref.kind && pack.id === ref.id && pack.image !== undefined && pack.manifest.source === 'png');
    if (offered?.image) {
      const image = await decode(offered.image);
      if (image && manifestFits(offered.manifest, image.naturalWidth, image.naturalHeight)) {
        packs.set(packKey(ref.kind, ref.id), { kind: ref.kind, id: ref.id, manifest: offered.manifest, origin: 'png', source: image, width: image.naturalWidth, height: image.naturalHeight });
        return;
      }
      fallbacks += 1; // offered, but it did not decode or its frames do not fit its sheet
    }
    const fallback = procedural(ref.kind, ref.id);
    // an id nobody has: the first pack of that kind stands in for it, under the id that was asked for
    packs.set(packKey(ref.kind, ref.id), fallback);
  }));
  return { packs, fallbacks };
}

/** `hero/grunt-test:png;family/bug:procedural;...`, for `data-art-sources`. */
export const sourcesText = (art: LoadedArt) => [...art.packs.values()].map((pack) => `${pack.kind}/${pack.id}:${pack.origin}`).join(';');
