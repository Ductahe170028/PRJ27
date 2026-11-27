// Writes apps/api/test/fixtures/shooter/golden-sim-6b.json: games with the BIGGER base of Stage 6B (the compiler's 72 px base, and the hand-made
// 80 px levels base-siege-big and base-boss-big), won and lost, both ways of losing, with a boss, recorded with the code and the final calibration
// of Stage 6B (the compiled levels carry their arsenal too).
//
//   npx tsx scripts/make-golden-sim-6b.ts          (from apps/api)
//
// Like golden-sim-4d.json this is NOT a proof of correctness: it was recorded from the new code, so it only shows that these games do not
// change LATER. That a bigger base behaves as designed is the job of shooter-base-size.test.ts. golden-sim.json, -4b, -4c, -4d and -6a are never
// regenerated: they prove that the games WITHOUT a base of this size did not change.
import { writeFileSync } from 'node:fs';
import { SHOOTER_LEVELS } from '@game-creator/contracts';
import { ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { lostByOf, record, type GoldenCase, type GoldenPolicyName } from '../test/shooter-golden-record.js';

type Mix = ShooterBrief['enemies'];
const MIXED: Mix = [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }];
const RUNNERS: Mix = [{ type: 'runner', share: 5 }];
const BRUTES: Mix = [{ type: 'brute', share: 5 }];
const SWARMERS: Mix = [{ type: 'swarmer', share: 5 }];
const ALL4: Mix = [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }];

interface Spec {
  name: string; policy: GoldenPolicyName; map: ShooterBrief['map']; enemies: Mix; intensity: number; weapon: ShooterBrief['weapon'];
  boss?: 'crusher' | 'gunner'; goal?: ShooterBrief['goal']; seed: number;
}
const SPECS: Spec[] = [
  { name: 'open-arena:pistol:mixed:i2', policy: 'expert', map: 'open-arena', enemies: MIXED, intensity: 2, weapon: 'pistol', seed: 11 },
  { name: 'pillars:rapid:runner:i2', policy: 'expert', map: 'pillars', enemies: RUNNERS, intensity: 2, weapon: 'rapid', seed: 12 },
  { name: 'rooms:shotgun:all4:i3', policy: 'expert', map: 'rooms', enemies: ALL4, intensity: 3, weapon: 'shotgun', seed: 13 },
  { name: 'ring:piercing:mixed:i2', policy: 'expert', map: 'ring', enemies: MIXED, intensity: 2, weapon: 'piercing', seed: 14 },
  { name: 'cross-corridors:heavy:brute:i1', policy: 'expert', map: 'cross-corridors', enemies: BRUTES, intensity: 1, weapon: 'heavy', seed: 15 },
  { name: 'open-arena:pistol:all4:i5', policy: 'expert', map: 'open-arena', enemies: ALL4, intensity: 5, weapon: 'pistol', seed: 16 },
  { name: 'pillars:pistol:mixed:kill20', policy: 'expert', map: 'pillars', enemies: MIXED, intensity: 3, weapon: 'pistol', goal: { type: 'kill', count: 20 }, seed: 17 },
  { name: 'rooms:rapid:brute:crusher', policy: 'expert', map: 'rooms', enemies: BRUTES, intensity: 2, weapon: 'rapid', boss: 'crusher', seed: 18 },
  { name: 'open-arena:shotgun:mixed:gunner', policy: 'expert', map: 'open-arena', enemies: MIXED, intensity: 2, weapon: 'shotgun', boss: 'gunner', seed: 19 },
  { name: 'ring:rapid:runner:i1', policy: 'expert', map: 'ring', enemies: RUNNERS, intensity: 1, weapon: 'rapid', seed: 21 },
  { name: 'open-arena:rapid:mixed:i2', policy: 'expert', map: 'open-arena', enemies: MIXED, intensity: 2, weapon: 'rapid', seed: 22 },
  { name: 'idle:open-arena:pistol:runner:i1', policy: 'idle', map: 'open-arena', enemies: RUNNERS, intensity: 1, weapon: 'pistol', seed: 31 },
  { name: 'idle:pillars:rapid:mixed:i2', policy: 'idle', map: 'pillars', enemies: MIXED, intensity: 2, weapon: 'rapid', seed: 32 },
  { name: 'idle:ring:pistol:swarmer:i1', policy: 'idle', map: 'ring', enemies: SWARMERS, intensity: 1, weapon: 'pistol', seed: 33 },
];

{
  const cases: Array<GoldenCase & { lostBy: string }> = [];
  const add = (c: GoldenCase) => cases.push({ ...c, lostBy: lostByOf(c.level, c.policy) });
  for (const spec of SPECS) {
    const brief = ShooterBriefSchema.parse({
      version: 'brief-1', healthDrops: 'none', boss: spec.boss ?? 'none', base: 'defend', enemyFamily: 'auto', loadout: 'all', title: 'Golden big base', theme: 'military-base',
      map: spec.map, enemies: spec.enemies, intensity: spec.intensity, playerHealth: 'normal', weapon: spec.weapon,
      goal: spec.goal ?? { type: 'survive', seconds: 60 }, unsupported: [],
    });
    add(record(`compiled:${spec.name}`, spec.policy, compileShooter(brief, 9000 + spec.seed * 31).level));
  }
  for (const name of ['base-siege-big', 'base-boss-big'] as const) {
    add(record(`hand:${name}:expert`, 'expert', SHOOTER_LEVELS[name]));
    add(record(`hand:${name}:idle`, 'idle', SHOOTER_LEVELS[name]));
  }

  writeFileSync(new URL('../test/fixtures/shooter/golden-sim-6b.json', import.meta.url), `${JSON.stringify({ version: 1, cases })}\n`);
  const count = (status: string) => cases.filter((c) => c.result.status === status).length;
  console.log(`${cases.length} cases (won ${count('won')}, lost ${count('lost')} [by base ${cases.filter((c) => c.lostBy === 'base').length}, by player ${cases.filter((c) => c.lostBy === 'player').length}], unfinished ${count('playing')}); ${cases.reduce((n, c) => n + c.hashes.length, 0)} hashes`);
  for (const c of cases) console.log(`${c.name.padEnd(42)} ${c.policy.padEnd(6)} ${c.result.status.padEnd(5)} ${c.lostBy.padEnd(6)} ${c.result.tick} ticks, hpLeft ${c.result.hpLeft.toFixed(2)}`);
}
