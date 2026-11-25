import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { replay, type GoldenCase } from './shooter-golden-record.js';

// The golden master: games recorded from the simulation as it was before the Stage 4A refactor.
// A refactor that must not change behavior leaves this file untouched and keeps this test green;
// the numbers (hashes every 60 ticks, final result) are compared one by one.
// Regenerate ONLY when the simulation is meant to change: `npx tsx scripts/make-golden-sim.ts`.
vi.setConfig({ testTimeout: 120_000 });

const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim.json', import.meta.url), 'utf8')) as { version: number; cases: GoldenCase[] };

describe('shooter simulation golden master', () => {
  it('covers the hand-made levels, every enemy type and both goals, and both policies', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(25);
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const level of ['arena', 'pillars', 'wall', 'smoke-win', 'smoke-lose']) expect(names).toContain(`hand:${level}:expert`);
    expect(golden.cases.filter((c) => c.policy === 'idle').length).toBeGreaterThanOrEqual(4);
    const types = new Set(golden.cases.flatMap((c) => c.level.waves.map((w) => w.type)));
    // the three kinds that existed when it was recorded (Stage 4B added more; the fixture is never regenerated)
    for (const type of ['runner', 'brute', 'swarmer']) expect(types.has(type as never), type).toBe(true);
    expect(new Set(golden.cases.map((c) => c.level.win.type))).toEqual(new Set(['survive', 'kill']));
    expect(new Set(golden.cases.map((c) => c.level.weapon.cooldownMs)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(golden.cases.map((c) => c.level.player.hp)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(golden.cases.map((c) => c.level.obstacles.length > 0)).size).toBe(2);
    // the games are not all one outcome
    expect(new Set(golden.cases.map((c) => c.result.status))).toEqual(new Set(['won', 'lost']));
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))('%s replays bit for bit', (_name, stored) => {
    const now = replay(stored);
    expect(now.result).toEqual(stored.result);
    expect(now.hashes.length).toBe(stored.hashes.length);
    const firstDifference = stored.hashes.findIndex((hash, index) => now.hashes[index] !== hash);
    expect(firstDifference === -1 ? 'identical' : `first different hash after tick ${(firstDifference + 1) * 60}`).toBe('identical');
    expect(now.finalHash).toBe(stored.finalHash);
  });
});
