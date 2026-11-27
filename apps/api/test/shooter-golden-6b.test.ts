import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { lostByOf, replay, type GoldenCase } from './shooter-golden-record.js';

// Games with the BIGGER base of Stage 6B, recorded at the end of that stage (apps/api/scripts/make-golden-sim-6b.ts).
// NOTE: this file was recorded from the new code, so it proves only that these games do not change LATER. That a bigger base behaves as
// designed is the job of shooter-base-size.test.ts. (golden-sim.json, -4b, -4c, -4d and -6a, tested by the other golden tests, are what
// prove that the games WITHOUT a base of this size did not change.) Regenerate only when the simulation is meant to change:
// `npx tsx scripts/make-golden-sim-6b.ts`.
vi.setConfig({ testTimeout: 120_000 });

type Stored = GoldenCase & { lostBy: string };
const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim-6b.json', import.meta.url), 'utf8')) as { version: number; cases: Stored[] };

describe('Stage 6B golden master', () => {
  it('covers compiled and hand-made levels with a bigger base: games won and lost, both ways of losing, and a boss', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(12);
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(golden.cases.every((c) => c.level.base !== undefined)).toBe(true);
    expect(golden.cases.filter((c) => c.name.startsWith('compiled:')).length).toBeGreaterThanOrEqual(9);
    for (const name of ['base-siege-big', 'base-boss-big']) for (const policy of ['expert', 'idle']) expect(names).toContain(`hand:${name}:${policy}`);
    // every level has a base of its own size: the compiler's 72, or the 80 of the two hand-made ones
    expect(new Set(golden.cases.map((c) => c.level.base!.size))).toEqual(new Set([72, 80]));
    expect(golden.cases.filter((c) => c.result.status === 'won').length).toBeGreaterThanOrEqual(2);
    expect(golden.cases.filter((c) => c.result.status === 'lost').length).toBeGreaterThanOrEqual(2);
    expect(golden.cases.some((c) => c.lostBy === 'base')).toBe(true);
    expect(golden.cases.some((c) => c.lostBy === 'player')).toBe(true);
    expect(golden.cases.some((c) => c.level.win.type === 'boss')).toBe(true);
    expect(golden.cases.some((c) => c.level.win.type === 'kill')).toBe(true);
    // the compiled levels carry the five weapons too (the bots never switch)
    expect(golden.cases.filter((c) => c.name.startsWith('compiled:')).every((c) => c.level.arsenal?.length === 5)).toBe(true);
    // the stored kind of loss goes with the stored status
    for (const c of golden.cases) expect(c.lostBy !== '', c.name).toBe(c.result.status === 'lost');
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))('%s replays bit for bit', (_name, stored) => {
    const now = replay(stored);
    expect(now.result).toEqual(stored.result);
    expect(now.hashes.length).toBe(stored.hashes.length);
    const firstDifference = stored.hashes.findIndex((hash, index) => now.hashes[index] !== hash);
    expect(firstDifference === -1 ? 'identical' : `first different hash after tick ${(firstDifference + 1) * 60}`).toBe('identical');
    expect(now.finalHash).toBe(stored.finalHash);
    expect(lostByOf(stored.level, stored.policy)).toBe(stored.lostBy);
  });
});
