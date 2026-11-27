import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CASES_6A, levelFor, replayScripted, type Golden6A } from './shooter-golden-6a-record.js';

// Games with weapon switching, recorded at the end of Stage 6A (apps/api/scripts/make-golden-sim-6a.ts).
// NOTE: this file was recorded from the new code, so it proves only that these games do not change LATER. That switching works as designed
// is the job of shooter-equip.test.ts. (golden-sim.json, -4b, -4c and -4d, tested by the other golden tests, are what prove that the games
// WITHOUT an arsenal did not change.) Regenerate only when the simulation is meant to change: `npx tsx scripts/make-golden-sim-6a.ts`.
vi.setConfig({ testTimeout: 120_000 });

const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim-6a.json', import.meta.url), 'utf8')) as { version: number; cases: Golden6A[] };

describe('Stage 6A golden master', () => {
  it('covers switching, switching in a cooldown, rubbish slots, and levels with and without an arsenal', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(8);
    expect(golden.cases.map((c) => c.name)).toEqual(CASES_6A.map((c) => c.name));
    const scripts = new Set(golden.cases.map((c) => c.script));
    for (const script of ['cycle', 'switch-in-cooldown', 'junk-slots', 'switch-only']) expect(scripts.has(script), script).toBe(true);
    expect(golden.cases.filter((c) => c.level.arsenal !== undefined).length).toBeGreaterThanOrEqual(6);
    expect(golden.cases.filter((c) => c.level.arsenal === undefined).length).toBeGreaterThanOrEqual(2);
    // a level with an arsenal ends with a slot, one without ends with none
    for (const c of golden.cases) expect(c.result.slot === null, c.name).toBe(c.level.arsenal === undefined);
    expect(golden.cases.some((c) => c.result.kills > 0)).toBe(true);
  });

  it('stores the same levels the recipe builds (so the file checks the simulation, not an edit of a fixture)', () => {
    for (const c of CASES_6A) {
      const stored = golden.cases.find((g) => g.name === c.name)!;
      expect(JSON.stringify(stored.level), c.name).toBe(JSON.stringify(levelFor(c.level)));
    }
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))('%s replays bit for bit', (_name, stored) => {
    const now = replayScripted(stored);
    expect(now.result).toEqual(stored.result);
    expect(now.hashes.length).toBe(stored.hashes.length);
    const firstDifference = stored.hashes.findIndex((hash, index) => now.hashes[index] !== hash);
    expect(firstDifference === -1 ? 'identical' : `first different hash after tick ${(firstDifference + 1) * 60}`).toBe('identical');
    expect(now.finalHash).toBe(stored.finalHash);
  });
});
