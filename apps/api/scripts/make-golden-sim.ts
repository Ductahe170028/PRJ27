// Writes apps/api/test/fixtures/shooter/golden-sim.json: the "golden master" of the shooter
// simulation. Run it ONLY when the simulation is meant to change (a new weapon, a new enemy):
//
//   npx tsx scripts/make-golden-sim.ts          (from apps/api; never through `npm run -- flags`)
//
// A refactor that must not change behavior never regenerates this file: the test has to stay
// green against the file as it is.
import { writeFileSync } from 'node:fs';
import { SHOOTER_LEVELS, SHOOTER_LEVEL_NAMES, type ShooterLevel } from '@game-creator/contracts';
import { PLAYER_HEALTHS, SHOOTER_MAPS, WEAPONS, ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { record, type GoldenCase } from '../test/shooter-golden-record.js';

const MIXES: ReadonlyArray<ShooterBrief['enemies']> = [
  [{ type: 'runner', share: 5 }],
  [{ type: 'brute', share: 5 }],
  [{ type: 'swarmer', share: 5 }],
  [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }],
];
const SURVIVE_SECONDS = [30, 60, 90, 45, 120];
const KILL_COUNTS = [15, 40, 70, 25, 100];
const COMPILED = 30;

const cases: GoldenCase[] = [];

// The five hand-made levels, with the expert bot; four of them also with no input at all.
for (const name of SHOOTER_LEVEL_NAMES) cases.push(record(`hand:${name}:expert`, 'expert', SHOOTER_LEVELS[name]));
for (const name of ['arena', 'wall', 'smoke-win', 'smoke-lose'] as const) cases.push(record(`hand:${name}:idle`, 'idle', SHOOTER_LEVELS[name]));

// Compiled levels: every map, enemy mix, weapon and health, both goals, intensity 1-5.
for (let i = 0; i < COMPILED; i += 1) {
  const survive = i % 2 === 0;
  const brief = ShooterBriefSchema.parse({
    version: 'brief-1', title: `Golden ${i}`, theme: 'zombie-city',
    map: SHOOTER_MAPS[i % SHOOTER_MAPS.length], enemies: MIXES[i % MIXES.length],
    intensity: ((Math.floor(i / 5) + i) % 5) + 1,
    playerHealth: PLAYER_HEALTHS[(i + Math.floor(i / 3)) % PLAYER_HEALTHS.length],
    weapon: WEAPONS[i % WEAPONS.length],
    goal: survive ? { type: 'survive', seconds: SURVIVE_SECONDS[(i >> 1) % SURVIVE_SECONDS.length] } : { type: 'kill', count: KILL_COUNTS[(i >> 1) % KILL_COUNTS.length] },
    unsupported: [],
  });
  const level: ShooterLevel = compileShooter(brief, 9000 + i * 37).level;
  cases.push(record(`compiled:${i}`, 'expert', level));
  if (i % 10 === 3) cases.push(record(`compiled:${i}:idle`, 'idle', level));
}

writeFileSync(new URL('../test/fixtures/shooter/golden-sim.json', import.meta.url), `${JSON.stringify({ version: 1, cases })}\n`);
const status = (s: string) => cases.filter((c) => c.result.status === s).length;
console.log(`${cases.length} cases (won ${status('won')}, lost ${status('lost')}, unfinished ${status('playing')}); ${cases.reduce((n, c) => n + c.hashes.length, 0)} hashes`);
