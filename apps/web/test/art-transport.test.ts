import { afterEach, describe, expect, it } from 'vitest';
import {
  ART_MAX_IMAGE_CHARS, ART_MAX_PACKS, ArtListSchema, ArtPackSchema, RuntimeInitLooseSchema, RuntimeInitSchema, SHOOTER_LEVELS,
} from '@game-creator/contracts';
import { validSuppliedPacks } from '../src/game/art/loader';
import { neededRefs } from '../src/game/art/refs';
import { fetchArtPacks, loadArtIndex, pngDataUrl, resetArtIndex, wantedPngPacks } from '../src/lib/art-fetch';
import { createPreviewDocument } from '../src/lib/preview-document';

const SESSION = '3b7f0d9e-1c2a-4e5f-8a9b-0c1d2e3f4a5b';
const manifest = {
  version: 1, kind: 'hero', id: 'grunt-test', source: 'png', license: 'procedural', author: '', origin: '', sheet: 'sheet.png',
  frame: { w: 48, h: 48 }, columns: 8, body: { radius: 14 }, animations: { idle: { frames: [0], fps: 1, loop: true } },
} as const;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const pack = (patch: Record<string, unknown> = {}) => ({ kind: 'hero', id: 'grunt-test', manifest, image: PNG, ...patch });
const init = (extra: Record<string, unknown> = {}) => ({ channel: 'game-creator', type: 'runtime:init', sessionId: SESSION, game: SHOOTER_LEVELS.arena, ...extra });

describe('runtime:init and the art list', () => {
  it('still accepts a message with no art (the old shape)', () => {
    expect(RuntimeInitSchema.safeParse(init()).success).toBe(true);
    expect(RuntimeInitLooseSchema.safeParse(init()).success).toBe(true);
  });

  it('accepts a good pack, with or without its picture', () => {
    expect(RuntimeInitSchema.safeParse(init({ art: [pack()] })).success).toBe(true);
    expect(RuntimeInitSchema.safeParse(init({ art: [{ ...pack(), image: undefined }] })).success).toBe(true);
    expect(RuntimeInitSchema.safeParse(init({ art: [pack()], artFallbacks: 2 })).success).toBe(true);
  });

  it('refuses an image that is not a PNG data URL', () => {
    for (const image of ['https://example.com/a.png', 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/png;base64,', 'data:image/png;base64,AAA<script>', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      expect(ArtPackSchema.safeParse(pack({ image })).success, image).toBe(false);
    }
  });

  it('refuses an image over 1.5 MB, more than 12 packs, and more than 6 MB in all', () => {
    const big = `data:image/png;base64,${'A'.repeat(ART_MAX_IMAGE_CHARS)}`;
    expect(ArtPackSchema.safeParse(pack({ image: big })).success).toBe(false);
    const ok = `data:image/png;base64,${'A'.repeat(1_500_000)}`;
    expect(ArtPackSchema.safeParse(pack({ image: ok })).success).toBe(true);
    const many = Array.from({ length: ART_MAX_PACKS + 1 }, (_, i) => pack({ id: `p-${i}`, manifest: { ...manifest, id: `p-${i}` }, image: PNG }));
    expect(ArtListSchema.safeParse(many).success).toBe(false);
    expect(ArtListSchema.safeParse(many.slice(0, ART_MAX_PACKS)).success).toBe(true);
    const heavy = Array.from({ length: 5 }, (_, i) => pack({ id: `h-${i}`, manifest: { ...manifest, id: `h-${i}` }, image: ok }));
    expect(ArtListSchema.safeParse(heavy).success).toBe(false); // 5 x 1.5 MB is over 6 MB
    expect(ArtListSchema.safeParse(heavy.slice(0, 4)).success).toBe(true);
  });

  it('refuses a manifest that is wrong or that is for another pack', () => {
    expect(ArtPackSchema.safeParse(pack({ manifest: { ...manifest, license: '' } })).success).toBe(false);
    expect(ArtPackSchema.safeParse(pack({ id: 'other' })).success).toBe(false);
    expect(ArtPackSchema.safeParse(pack({ kind: 'base' })).success).toBe(false);
  });

  it('lets the game iframe read a message whose art is broken (it then ignores the art), but not a message that is not an init', () => {
    expect(RuntimeInitSchema.safeParse(init({ art: 'nonsense' })).success).toBe(false);
    expect(RuntimeInitLooseSchema.safeParse(init({ art: 'nonsense' })).success).toBe(true);
    expect(RuntimeInitLooseSchema.safeParse({ ...init(), type: 'runtime:other' }).success).toBe(false);
    expect(validSuppliedPacks('nonsense')).toEqual([]);
    expect(validSuppliedPacks(undefined)).toEqual([]);
  });

  it('keeps the good packs of a list that has a bad one, in the game', () => {
    const list = [pack(), pack({ image: 'https://evil.example/a.png' }), pack({ id: 'second', manifest: { ...manifest, id: 'second' } })];
    expect(validSuppliedPacks(list).map((p) => p.id)).toEqual(['grunt-test', 'second']);
  });

  it('caps the packs the game reads at 12 and their total size at 6 MB', () => {
    const many = Array.from({ length: 20 }, (_, i) => pack({ id: `p-${i}`, manifest: { ...manifest, id: `p-${i}` } }));
    expect(validSuppliedPacks(many)).toHaveLength(12);
    const ok = `data:image/png;base64,${'A'.repeat(1_500_000)}`;
    const heavy = Array.from({ length: 6 }, (_, i) => pack({ id: `h-${i}`, manifest: { ...manifest, id: `h-${i}` }, image: ok }));
    expect(validSuppliedPacks(heavy)).toHaveLength(4);
  });
});

describe('what the page fetches', () => {
  const index = [{ kind: 'hero' as const, id: 'grunt-test' }, { kind: 'base' as const, id: 'shiny' }];
  const look = { biome: 'zombie-city', hero: 'grunt-test', family: 'bug', base: 'bunker', weapon: 'pistol' };

  it('asks only for the PNG packs a level needs, once each', () => {
    expect(neededRefs(look).map((r) => `${r.kind}/${r.id}`)).toEqual(['biome/zombie-city', 'hero/grunt-test', 'family/bug', 'base/bunker', 'weapon/pistol', 'pickup/health', 'fx/basic']);
    expect(wantedPngPacks(neededRefs(look), index)).toEqual([{ kind: 'hero', id: 'grunt-test' }]);
    expect(wantedPngPacks([...neededRefs(look), { kind: 'hero', id: 'grunt-test' }], index)).toHaveLength(1);
    expect(wantedPngPacks(neededRefs({ ...look, hero: 'scout' }), index)).toEqual([]);
  });

  it('turns bytes into a PNG data URL', () => {
    expect(pngDataUrl(new Uint8Array([137, 80, 78, 71]))).toBe('data:image/png;base64,iVBORw==');
    expect(pngDataUrl(new Uint8Array(70_000)).startsWith('data:image/png;base64,')).toBe(true);
  });

  const respond = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body), arrayBuffer: () => Promise.resolve(new Uint8Array([137, 80, 78, 71]).buffer) });

  it('fetches the manifest and the sheet of a wanted pack, in parallel', async () => {
    const calls: string[] = [];
    const { art, fallbacks } = await fetchArtPacks(neededRefs(look), index, {
      baseUrl: '/', fetch: (url) => { calls.push(url); return respond(url.endsWith('manifest.json') ? manifest : {}); },
    });
    expect(calls.sort()).toEqual(['/art/hero/grunt-test/manifest.json', '/art/hero/grunt-test/sheet.png']);
    expect(fallbacks).toBe(0);
    expect(art).toHaveLength(1);
    expect(art[0]!.image).toBe('data:image/png;base64,iVBORw==');
    expect(ArtPackSchema.safeParse(art[0]).success).toBe(true);
  });

  it('leaves out a pack that cannot be fetched, is not ok, or has a manifest that is wrong, and counts it', async () => {
    const wanted = neededRefs(look);
    const failing = await fetchArtPacks(wanted, index, { fetch: () => Promise.reject(new Error('offline')) });
    expect(failing).toEqual({ art: [], fallbacks: 1 });
    const notOk = await fetchArtPacks(wanted, index, { fetch: () => respond({}, false) });
    expect(notOk).toEqual({ art: [], fallbacks: 1 });
    const wrong = await fetchArtPacks(wanted, index, { fetch: (url) => respond(url.endsWith('manifest.json') ? { ...manifest, license: '' } : {}) });
    expect(wrong).toEqual({ art: [], fallbacks: 1 });
    const other = await fetchArtPacks(wanted, index, { fetch: (url) => respond(url.endsWith('manifest.json') ? { ...manifest, id: 'something-else' } : {}) });
    expect(other).toEqual({ art: [], fallbacks: 1 });
  });

  it('gives up on a pack that does not answer in time, without retrying', async () => {
    let calls = 0;
    const started = Date.now();
    const result = await fetchArtPacks(neededRefs(look), index, {
      timeoutMs: 40,
      fetch: (_url, init) => { calls += 1; return new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))); }); },
    });
    expect(result).toEqual({ art: [], fallbacks: 1 });
    expect(calls).toBe(2); // the manifest and the sheet, once
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reads the index once, and a bad or missing index means no PNG packs', async () => {
    resetArtIndex();
    let calls = 0;
    const doFetch = () => { calls += 1; return respond([{ kind: 'hero', id: 'grunt-test' }, { nonsense: true }, 'x']); };
    expect(await loadArtIndex({ fetch: doFetch, baseUrl: '/' })).toEqual([{ kind: 'hero', id: 'grunt-test' }]);
    expect(await loadArtIndex({ fetch: doFetch, baseUrl: '/' })).toEqual([{ kind: 'hero', id: 'grunt-test' }]);
    expect(calls).toBe(1);
    resetArtIndex();
    expect(await loadArtIndex({ fetch: () => Promise.reject(new Error('offline')), baseUrl: '/' })).toEqual([]);
    resetArtIndex();
    expect(await loadArtIndex({ fetch: () => respond({ not: 'a list' }), baseUrl: '/' })).toEqual([]);
    resetArtIndex();
    expect(await loadArtIndex({ fetch: () => respond([], false), baseUrl: '/' })).toEqual([]);
  });
});

describe('the Content-Security-Policy of the game iframe', () => {
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  it('is exactly this string: images only from data: and blob:, no network, no addresses', () => {
    (globalThis as { window?: unknown }).window = { location: { origin: 'http://127.0.0.1:5173' } };
    const html = createPreviewDocument(SESSION);
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1];
    expect(csp).toBe(`default-src 'none'; script-src 'nonce-${SESSION}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`);
  });
});
