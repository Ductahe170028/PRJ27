import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { replay, type GoldenCase } from './shooter-golden-record.js';

// Games with a boss, recorded after Stage 4C (apps/api/scripts/make-golden-sim-4c.ts).
// NOTE: this file was recorded from the new code, so it proves only that these games do not change LATER. That the boss
// behaves as designed is the job of shooter-boss.test.ts. (golden-sim.json and golden-sim-4b.json, tested by
// shooter-golden.test.ts and shooter-golden-4b.test.ts, are what prove that the older games did not change.)
// Regenerate only when the simulation is meant to change: `npx tsx scripts/make-golden-sim-4c.ts`.
vi.setConfig({ testTimeout: 120_000 });

const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim-4c.json', import.meta.url), 'utf8')) as { version: number; cases: GoldenCase[] };
const bossType = (c: GoldenCase) => c.level.waves.find((w) => w.type === 'crusher' || w.type === 'gunner')?.type;

describe('Stage 4C golden master', () => {
  it('covers each boss on two maps, the expert bot and standing still, boss won and boss lost, and the new weapons', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(10);
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const boss of ['crusher', 'gunner']) {
      const cases = golden.cases.filter((c) => c.name.startsWith('compiled:') && bossType(c) === boss);
      expect(cases.length, boss).toBeGreaterThanOrEqual(5);
      expect(new Set(cases.map((c) => c.name.split(':')[2])).size, `${boss} maps`).toBeGreaterThanOrEqual(2);
      expect(cases.some((c) => c.policy === 'expert'), boss).toBe(true);
      expect(cases.some((c) => c.policy === 'idle'), boss).toBe(true);
    }
    expect(golden.cases.every((c) => c.level.win.type === 'boss' && c.level.bossHp !== undefined)).toBe(true);
    // a boss defeated (a win), and a boss that was not (a loss)
    expect(golden.cases.some((c) => c.policy === 'expert' && c.result.status === 'won')).toBe(true);
    // (Since Stage 4C.1 the boss levels are gentler and the expert bot wins every game of this file; the losses are the idle ones.)
    expect(golden.cases.some((c) => c.result.status === 'lost')).toBe(true);
    expect(golden.cases.filter((c) => c.policy === 'idle').every((c) => c.result.status === 'lost')).toBe(true);
    expect(golden.cases.some((c) => (c.level.weapon.pellets ?? 1) > 1)).toBe(true);
    expect(golden.cases.some((c) => (c.level.weapon.pierce ?? 1) > 1)).toBe(true);
    for (const name of ['boss-crusher', 'boss-gunner']) for (const policy of ['expert', 'idle']) expect(names).toContain(`hand:${name}:${policy}`);
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
