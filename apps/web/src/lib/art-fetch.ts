// The page's part of the art system. The game runs in a sandboxed iframe that cannot load addresses (its CSP is
// `default-src 'none'; img-src data: blob:; connect-src 'none'`, and it stays that way), so THIS side reads public/art/index.json,
// fetches just the PNG packs a level needs, in parallel and with a time limit, turns each sheet into a `data:image/png;base64,`
// URL and hands them over in the `runtime:init` message. A pack that cannot be fetched is left out (the game draws it with its own
// code) and counted.
import { ART_MAX_IMAGE_CHARS, ART_MAX_PACKS, ART_MAX_TOTAL_CHARS, ManifestSchema, PNG_DATA_URL_PREFIX, type ArtKind, type ArtPack } from '@game-creator/contracts';
import type { PackRef } from '../game/art/types';

export interface ArtIndexEntry { kind: ArtKind; id: string }
export const ART_FETCH_TIMEOUT_MS = 4000;

type Fetch = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
export interface FetchOptions { fetch?: Fetch; baseUrl?: string; timeoutMs?: number }

/** Which of the packs a level needs have a PNG pack in the index (the others are drawn by code, and are not "fallbacks"). */
export function wantedPngPacks(refs: readonly PackRef[], index: readonly ArtIndexEntry[]): PackRef[] {
  const seen = new Set<string>();
  const wanted: PackRef[] = [];
  for (const ref of refs) {
    const id = `${ref.kind}/${ref.id}`;
    if (seen.has(id) || !index.some((entry) => entry.kind === ref.kind && entry.id === ref.id)) continue;
    seen.add(id);
    wanted.push(ref);
  }
  return wanted.slice(0, ART_MAX_PACKS);
}

/** Bytes as a PNG data URL. btoa works on the same in a browser and in Node, so a test needs no browser. */
export function pngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `${PNG_DATA_URL_PREFIX}${btoa(binary)}`;
}

const defaultBase = () => import.meta.env.BASE_URL;

let cachedIndex: Promise<ArtIndexEntry[]> | undefined;
/** The list of PNG packs, read once per page (a failure is also remembered: no PNG packs, everything drawn by code). */
export function loadArtIndex(options: FetchOptions = {}): Promise<ArtIndexEntry[]> {
  cachedIndex ??= (async () => {
    try {
      const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
      const response = await doFetch(`${options.baseUrl ?? defaultBase()}art/index.json`);
      if (!response.ok) return [];
      const body = await response.json();
      if (!Array.isArray(body)) return [];
      return body.filter((entry): entry is ArtIndexEntry => typeof entry === 'object' && entry !== null
        && typeof (entry as ArtIndexEntry).kind === 'string' && typeof (entry as ArtIndexEntry).id === 'string');
    } catch {
      return [];
    }
  })();
  return cachedIndex;
}
/** For tests: forget the remembered index. */
export const resetArtIndex = () => { cachedIndex = undefined; };

/** Fetches the PNG packs among `refs`: all in parallel, each given `timeoutMs` in all, no retry. Returns the packs that arrived whole
 * and how many that were wanted did not. */
export async function fetchArtPacks(refs: readonly PackRef[], index: readonly ArtIndexEntry[], options: FetchOptions = {}): Promise<{ art: ArtPack[]; fallbacks: number }> {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const base = `${options.baseUrl ?? defaultBase()}art`;
  const timeoutMs = options.timeoutMs ?? ART_FETCH_TIMEOUT_MS;
  const wanted = wantedPngPacks(refs, index);
  const results = await Promise.all(wanted.map(async (ref): Promise<ArtPack | undefined> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const folder = `${base}/${ref.kind}/${ref.id}`;
      const [manifestResponse, sheetResponse] = await Promise.all([
        doFetch(`${folder}/manifest.json`, { signal: controller.signal }), doFetch(`${folder}/sheet.png`, { signal: controller.signal }),
      ]);
      if (!manifestResponse.ok || !sheetResponse.ok) return undefined;
      const manifest = ManifestSchema.safeParse(await manifestResponse.json());
      if (!manifest.success || manifest.data.kind !== ref.kind || manifest.data.id !== ref.id || manifest.data.source !== 'png') return undefined;
      const image = pngDataUrl(new Uint8Array(await sheetResponse.arrayBuffer()));
      if (image.length > ART_MAX_IMAGE_CHARS) return undefined;
      return { kind: ref.kind, id: ref.id, manifest: manifest.data, image };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }));
  const art: ArtPack[] = [];
  let total = 0;
  for (const pack of results) {
    if (!pack) continue;
    total += pack.image?.length ?? 0;
    if (total > ART_MAX_TOTAL_CHARS) break;
    art.push(pack);
  }
  return { art, fallbacks: wanted.length - art.length };
}
