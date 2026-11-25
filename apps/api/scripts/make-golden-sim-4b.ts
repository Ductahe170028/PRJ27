// Writes apps/api/test/fixtures/shooter/golden-sim-4b.json: games that use the Stage 4B mechanics (the shotgun,
// the piercing gun, spitters and their bullets, health drops), recorded with the code as it is after Stage 4B.
//
//   npx tsx scripts/make-golden-sim-4b.ts          (from apps/api)
//
// This file is NOT a proof of correctness: it was recorded from the new code, so it only shows that these
// games do not change LATER. That the mechanics are right is the job of the unit tests (shooter-weapons-4b,
// shooter-spitter, shooter-pickups). golden-sim.json (Stage 4A) is the proof that the OLD games did not
// change, and is never regenerated. Run this script only when the simulation is meant to change.
import { writeFileSync } from 'node:fs';
import { SHOOTER_LEVELS, type ShooterLevel } from '@game-creator/contracts';
import { PLAYER_HEALTHS, ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { record, type GoldenCase } from '../test/shooter-golden-record.js';

type Mix = ShooterBrief['enemies'];
const SWARMERS: Mix = [{ type: 'swarmer', share: 5 }];
const MIXED: Mix = [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }];
const SPITTER: Mix = [{ type: 'spitter', share: 5 }];
const ALL4: Mix = [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }];

interface Spec {
  name: string; policy: 'expert' | 'idle'; map: ShooterBrief['map']; enemies: Mix; intensity: number; weapon: ShooterBrief['weapon'];
  healthDrops?: ShooterBrief['healthDrops']; goal?: ShooterBrief['goal']; health?: (typeof PLAYER_HEALTHS)[number]; seed: number;
}
const SPECS: Spec[] = [
  { name: 'shotgun:pillars:mixed', policy: 'expert', map: 'pillars', enemies: MIXED, intensity: 3, weapon: 'shotgun', seed: 11 },
  { name: 'shotgun:rooms:swarmers', policy: 'expert', map: 'rooms', enemies: SWARMERS, intensity: 3, weapon: 'shotgun', seed: 12 },
  { name: 'shotgun:open-arena:kill40', policy: 'expert', map: 'open-arena', enemies: SWARMERS, intensity: 3, weapon: 'shotgun', goal: { type: 'kill', count: 40 }, seed: 13 },
  { name: 'piercing:pillars:mixed', policy: 'expert', map: 'pillars', enemies: MIXED, intensity: 3, weapon: 'piercing', seed: 14 },
  { name: 'piercing:ring:swarmers', policy: 'expert', map: 'ring', enemies: SWARMERS, intensity: 4, weapon: 'piercing', seed: 15 },
  { name: 'piercing:open-arena:kill40', policy: 'expert', map: 'open-arena', enemies: MIXED, intensity: 2, weapon: 'piercing', goal: { type: 'kill', count: 40 }, seed: 16 },
  { name: 'spitter-only:open-arena:pistol', policy: 'expert', map: 'open-arena', enemies: SPITTER, intensity: 2, weapon: 'pistol', seed: 21 },
  { name: 'spitter-only:rooms:rapid', policy: 'expert', map: 'rooms', enemies: SPITTER, intensity: 3, weapon: 'rapid', seed: 22 },
  { name: 'all4:pillars:pistol', policy: 'expert', map: 'pillars', enemies: ALL4, intensity: 2, weapon: 'pistol', seed: 23 },
  { name: 'all4:ring:shotgun', policy: 'expert', map: 'ring', enemies: ALL4, intensity: 3, weapon: 'shotgun', seed: 24 },
  { name: 'all4:cross-corridors:piercing', policy: 'expert', map: 'cross-corridors', enemies: ALL4, intensity: 3, weapon: 'piercing', goal: { type: 'survive', seconds: 90 }, seed: 25 },
  { name: 'drops12:pillars:mixed', policy: 'expert', map: 'pillars', enemies: MIXED, intensity: 3, weapon: 'rapid', healthDrops: 'some', health: 'fragile', seed: 31 },
  { name: 'drops25:open-arena:swarmers', policy: 'expert', map: 'open-arena', enemies: SWARMERS, intensity: 3, weapon: 'pistol', healthDrops: 'many', health: 'fragile', seed: 32 },
  { name: 'idle:spitter-only:open-arena', policy: 'idle', map: 'open-arena', enemies: SPITTER, intensity: 3, weapon: 'pistol', seed: 41 },
  { name: 'idle:all4:rooms', policy: 'idle', map: 'rooms', enemies: ALL4, intensity: 2, weapon: 'shotgun', seed: 42 },
  { name: 'idle:drops25:open-arena', policy: 'idle', map: 'open-arena', enemies: SWARMERS, intensity: 2, weapon: 'pistol', healthDrops: 'many', seed: 43 },
];

const cases: GoldenCase[] = [];
for (const spec of SPECS) {
  const brief = ShooterBriefSchema.parse({
    version: 'brief-1', healthDrops: spec.healthDrops ?? 'none', title: spec.name.slice(0, 30).replace(/[^A-Za-z0-9 ]/g, ' ').trim() || 'Golden', theme: 'zombie-city',
    map: spec.map, enemies: spec.enemies, intensity: spec.intensity, playerHealth: spec.health ?? 'normal', weapon: spec.weapon,
    goal: spec.goal ?? { type: 'survive', seconds: 60 }, unsupported: [],
  });
  const level: ShooterLevel = compileShooter(brief, 5000 + spec.seed * 31).level;
  cases.push(record(`compiled:${spec.name}`, spec.policy, level));
}
for (const name of ['shotgun-pit', 'spitters', 'medic'] as const) {
  cases.push(record(`hand:${name}:expert`, 'expert', SHOOTER_LEVELS[name]));
  cases.push(record(`hand:${name}:idle`, 'idle', SHOOTER_LEVELS[name]));
}

writeFileSync(new URL('../test/fixtures/shooter/golden-sim-4b.json', import.meta.url), `${JSON.stringify({ version: 1, cases })}\n`);
const count = (status: string) => cases.filter((c) => c.result.status === status).length;
console.log(`${cases.length} cases (won ${count('won')}, lost ${count('lost')}, unfinished ${count('playing')}); ${cases.reduce((n, c) => n + c.hashes.length, 0)} hashes`);
