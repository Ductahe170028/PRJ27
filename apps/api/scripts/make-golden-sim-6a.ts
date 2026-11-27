// Writes apps/api/test/fixtures/shooter/golden-sim-6a.json: games with weapon switching, played by scripted inputs (keys, switches during a
// cooldown, rubbish slots) on levels with an arsenal, and the same inputs on levels without one, recorded with the code of Stage 6A.
//
//   npx tsx scripts/make-golden-sim-6a.ts          (from apps/api)
//
// Like the other new golden files this is NOT a proof of correctness: it was recorded from the new code, so it only shows that these games
// do not change LATER. That switching works is the job of shooter-equip.test.ts. golden-sim.json, -4b, -4c and -4d are never regenerated:
// they prove that the games WITHOUT an arsenal did not change.
import { writeFileSync } from 'node:fs';
import { CASES_6A, levelFor, recordScripted } from '../test/shooter-golden-6a-record.js';

const cases = CASES_6A.map((c) => recordScripted(c.name, levelFor(c.level), c.script, c.ticks));
writeFileSync(new URL('../test/fixtures/shooter/golden-sim-6a.json', import.meta.url), `${JSON.stringify({ version: 1, cases })}\n`);
const count = (status: string) => cases.filter((c) => c.result.status === status).length;
console.log(`${cases.length} cases (won ${count('won')}, lost ${count('lost')}, unfinished ${count('playing')}); ${cases.reduce((n, c) => n + c.hashes.length, 0)} hashes`);
for (const c of cases) console.log(`${c.name.padEnd(36)} ${c.script.padEnd(20)} ${c.result.status.padEnd(7)} ${c.result.tick} ticks, kills ${c.result.kills}, slot ${c.result.slot}`);
