import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from '../src/lib/uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.unstubAllGlobals(); });

describe('randomUuid', () => {
  it('uses crypto.randomUUID when the browser provides it', () => {
    const randomUUID = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });
    expect(randomUuid()).toBe('11111111-1111-4111-8111-111111111111');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('builds a version-4 UUID from getRandomValues when randomUUID is missing', () => {
    const fill = (value: number) => vi.fn((bytes: Uint8Array) => { bytes.fill(value); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues: fill(0xff) });
    expect(randomUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', { getRandomValues: fill(0x00) });
    expect(randomUuid()).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('falls back when randomUUID is not a function and still sets the version and variant bits', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: (bytes: Uint8Array) => { bytes.set([1, 2, 3, 4, 5, 6, 0x0f, 8, 0x3f, 10, 11, 12, 13, 14, 15, 16]); return bytes; },
    });
    const id = randomUuid();
    expect(id).toMatch(UUID_V4);
    expect(id.slice(14, 15)).toBe('4');
    expect('89ab').toContain(id.slice(19, 20));
  });
});
