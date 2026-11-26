import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { lostByOf, replay, type GoldenCase } from './shooter-golden-record.js';

// Games with a base to defend, recorded at the end of Stage 4D (apps/api/scripts/make-golden-sim-4d.ts).
// NOTE: this file was recorded from the new code, so it proves only that these games do not change LATER. That the base behaves
// as designed is the job of shooter-base.test.ts and shooter-base-bots.test.ts. (golden-sim.json, golden-sim-4b.json and
// golden-sim-4c.json, tested by the other three golden tests, are what prove that the games WITHOUT a base did not change.)
// Regenerate only when the simulation is meant to change: `npx tsx scripts/make-golden-sim-4d.ts`.
vi.setConfig({ testTimeout: 120_000 });

type Stored = GoldenCase & { lostBy: string };
const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim-4d.json', import.meta.url), 'utf8')) as { version: number; cases: Stored[] };

describe('Stage 4D golden master', () => {
  it('covers compiled and hand-made base levels, the expert bot and standing still, and both ways of losing', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(12);
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(golden.cases.every((c) => c.level.base !== undefined)).toBe(true);
    expect(golden.cases.filter((c) => c.name.startsWith('compiled:')).length).toBeGreaterThanOrEqual(9);
    for (const name of ['base-siege', 'base-boss', 'base-fall']) for (const policy of ['expert', 'idle']) expect(names).toContain(`hand:${name}:${policy}`);
    expect(golden.cases.some((c) => c.policy === 'expert' && c.result.status === 'won')).toBe(true);
    expect(golden.cases.some((c) => c.lostBy === 'base')).toBe(true);
    expect(golden.cases.some((c) => c.lostBy === 'player')).toBe(true);
    expect(golden.cases.some((c) => c.level.win.type === 'boss')).toBe(true);
    expect(golden.cases.some((c) => c.level.win.type === 'kill')).toBe(true);
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
