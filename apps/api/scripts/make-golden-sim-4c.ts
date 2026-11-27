// Writes apps/api/test/fixtures/shooter/golden-sim-4c.json: games with a boss (the crusher and the gunner), recorded with the
// code as it is after Stage 4C.1 (regenerated once there: the boss walks on its own grid and the boss levels have a new wave schedule).
//
//   npx tsx scripts/make-golden-sim-4c.ts          (from apps/api)
//
// Like golden-sim-4b.json this is NOT a proof of correctness: it was recorded from the new code, so it only shows that these
// games do not change LATER. That the boss behaves as designed is the job of shooter-boss.test.ts. golden-sim.json (Stage 4A)
// and golden-sim-4b.json are never regenerated: they prove that the older games did not change.
import { writeFileSync } from 'node:fs';
import { SHOOTER_LEVELS, type ShooterLevel } from '@game-creator/contracts';
import { ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { record, type GoldenCase } from '../test/shooter-golden-record.js';

type Mix = ShooterBrief['enemies'];
const MIXED: Mix = [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }];
const RUNNERS: Mix = [{ type: 'runner', share: 5 }];
const ALL4: Mix = [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }];

interface Spec {
  name: string; policy: 'expert' | 'idle'; boss: 'crusher' | 'gunner'; map: ShooterBrief['map']; enemies: Mix; intensity: number;
  weapon: ShooterBrief['weapon']; goal?: ShooterBrief['goal']; seed: number;
}
const SPECS: Spec[] = [
  { name: 'crusher:pillars:pistol', policy: 'expert', boss: 'crusher', map: 'pillars', enemies: MIXED, intensity: 2, weapon: 'pistol', seed: 11 },
  { name: 'crusher:rooms:rapid', policy: 'expert', boss: 'crusher', map: 'rooms', enemies: RUNNERS, intensity: 2, weapon: 'rapid', seed: 12 },
  { name: 'crusher:open-arena:shotgun', policy: 'expert', boss: 'crusher', map: 'open-arena', enemies: MIXED, intensity: 1, weapon: 'shotgun', seed: 13 },
  { name: 'crusher:ring:piercing', policy: 'expert', boss: 'crusher', map: 'ring', enemies: ALL4, intensity: 2, weapon: 'piercing', seed: 14 },
  { name: 'crusher:open-arena:pistol:hard', policy: 'expert', boss: 'crusher', map: 'open-arena', enemies: MIXED, intensity: 5, weapon: 'pistol', seed: 15 },
  { name: 'gunner:pillars:rapid', policy: 'expert', boss: 'gunner', map: 'pillars', enemies: MIXED, intensity: 2, weapon: 'rapid', seed: 21 },
  { name: 'gunner:cross-corridors:pistol', policy: 'expert', boss: 'gunner', map: 'cross-corridors', enemies: RUNNERS, intensity: 1, weapon: 'pistol', goal: { type: 'kill', count: 20 }, seed: 22 },
  { name: 'gunner:open-arena:shotgun', policy: 'expert', boss: 'gunner', map: 'open-arena', enemies: ALL4, intensity: 2, weapon: 'shotgun', seed: 23 },
  { name: 'gunner:rooms:piercing', policy: 'expert', boss: 'gunner', map: 'rooms', enemies: MIXED, intensity: 1, weapon: 'piercing', seed: 24 },
  { name: 'gunner:open-arena:pistol:hard', policy: 'expert', boss: 'gunner', map: 'open-arena', enemies: MIXED, intensity: 5, weapon: 'pistol', seed: 25 },
  { name: 'idle:crusher:open-arena', policy: 'idle', boss: 'crusher', map: 'open-arena', enemies: RUNNERS, intensity: 1, weapon: 'pistol', seed: 31 },
  { name: 'idle:crusher:pillars', policy: 'idle', boss: 'crusher', map: 'pillars', enemies: RUNNERS, intensity: 1, weapon: 'rapid', seed: 32 },
  { name: 'idle:gunner:open-arena', policy: 'idle', boss: 'gunner', map: 'open-arena', enemies: RUNNERS, intensity: 1, weapon: 'pistol', seed: 33 },
  { name: 'idle:gunner:rooms', policy: 'idle', boss: 'gunner', map: 'rooms', enemies: RUNNERS, intensity: 1, weapon: 'shotgun', seed: 34 },
];

const cases: GoldenCase[] = [];
for (const spec of SPECS) {
  const brief = ShooterBriefSchema.parse({
    version: 'brief-1', healthDrops: 'none', boss: spec.boss, base: 'none', enemyFamily: 'auto', title: spec.name.slice(0, 30).replace(/[^A-Za-z0-9 ]/g, ' ').trim() || 'Golden', theme: 'military-base',
    map: spec.map, enemies: spec.enemies, intensity: spec.intensity, playerHealth: 'normal', weapon: spec.weapon,
    goal: spec.goal ?? { type: 'survive', seconds: 60 }, unsupported: [],
  });
  const level: ShooterLevel = compileShooter(brief, 6000 + spec.seed * 31).level;
  cases.push(record(`compiled:${spec.name}`, spec.policy, level));
}
for (const name of ['boss-crusher', 'boss-gunner'] as const) {
  cases.push(record(`hand:${name}:expert`, 'expert', SHOOTER_LEVELS[name]));
  cases.push(record(`hand:${name}:idle`, 'idle', SHOOTER_LEVELS[name]));
}

writeFileSync(new URL('../test/fixtures/shooter/golden-sim-4c.json', import.meta.url), `${JSON.stringify({ version: 1, cases })}\n`);
const count = (status: string) => cases.filter((c) => c.result.status === status).length;
console.log(`${cases.length} cases (won ${count('won')}, lost ${count('lost')}, unfinished ${count('playing')}); ${cases.reduce((n, c) => n + c.hashes.length, 0)} hashes`);
for (const c of cases) console.log(`${c.name.padEnd(36)} ${c.policy.padEnd(6)} ${c.result.status.padEnd(5)} ${c.result.tick} ticks, hpLeft ${c.result.hpLeft.toFixed(2)}`);
