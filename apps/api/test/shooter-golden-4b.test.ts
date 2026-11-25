import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { replay, type GoldenCase } from './shooter-golden-record.js';

// Games that use the Stage 4B mechanics, recorded after Stage 4B (apps/api/scripts/make-golden-sim-4b.ts).
// NOTE: this file was recorded from the new code, so it proves only that these games do not change LATER.
// Whether the mechanics are right is the job of shooter-weapons-4b, shooter-spitter and shooter-pickups.
// (golden-sim.json, tested by shooter-golden.test.ts, is what proves the older games did not change.)
// Regenerate only when the simulation is meant to change: `npx tsx scripts/make-golden-sim-4b.ts`.
vi.setConfig({ testTimeout: 120_000 });

const golden = JSON.parse(readFileSync(new URL('./fixtures/shooter/golden-sim-4b.json', import.meta.url), 'utf8')) as { version: number; cases: GoldenCase[] };
const types = (c: GoldenCase) => new Set(c.level.waves.map((w) => w.type));

describe('Stage 4B golden master', () => {
  it('covers each new weapon on two maps, spitters alone and mixed, both drop rates, the expert bot and standing still', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(12);
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    // each new weapon, on at least two of the compiled maps (the map is named in the case name)
    for (const [label, wanted] of [['shotgun', (c: GoldenCase) => (c.level.weapon.pellets ?? 1) > 1], ['piercing', (c: GoldenCase) => (c.level.weapon.pierce ?? 1) > 1]] as const) {
      const compiled = golden.cases.filter((c) => c.name.startsWith('compiled:') && wanted(c));
      const maps = new Set(compiled.map((c) => c.name.split(':')[1] === label ? c.name.split(':')[2] : c.name.split(':')[1]));
      expect(compiled.length, label).toBeGreaterThanOrEqual(4);
      expect(maps.size, label).toBeGreaterThanOrEqual(2);
    }
    expect(golden.cases.some((c) => types(c).size === 1 && types(c).has('spitter'))).toBe(true);
    expect(golden.cases.some((c) => types(c).has('spitter') && types(c).size > 1)).toBe(true);
    expect(new Set(golden.cases.map((c) => c.level.drops?.healthChancePct).filter((v) => v !== undefined))).toEqual(new Set([12, 25]));
    expect(golden.cases.filter((c) => c.policy === 'idle').length).toBeGreaterThanOrEqual(3);
    expect(golden.cases.filter((c) => c.policy === 'expert').length).toBeGreaterThanOrEqual(10);
    // standing still in front of spitters is what lets their bullets land
    const idleSpitter = golden.cases.find((c) => c.name === 'compiled:idle:spitter-only:open-arena')!;
    expect(idleSpitter.result.status).toBe('lost');
    expect(idleSpitter.result.hpLeft).toBe(0);
    // the three hand-made levels are in, with the expert bot and without any input
    for (const name of ['shotgun-pit', 'spitters', 'medic']) for (const policy of ['expert', 'idle']) expect(names).toContain(`hand:${name}:${policy}`);
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
