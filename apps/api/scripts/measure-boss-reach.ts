// Stage 4C.1: does the boss always reach a player who stands still? One line per boss and map.
//   npx tsx scripts/measure-boss-reach.ts [--seeds=30] [--seconds=120] [--intensity=1]
// Seeds are number * 7919 (number = 1..seeds), as in the report that found the bug.
import { SHOOTER_MAPS } from '../src/shooter/brief.js';
import { arrivalDistance, bossReach, reachBrief, type BossKind } from './boss-reach.js';

const arg = (name: string, fallback: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const SEEDS = arg('seeds', 30);
const SECONDS = arg('seconds', 120);
const INTENSITY = arg('intensity', 1);

let failed = 0;
let total = 0;
for (const boss of ['crusher', 'gunner'] as BossKind[]) {
  for (const map of SHOOTER_MAPS) {
    let arrived = 0;
    let simplified = 0;
    const stuck: string[] = [];
    for (let n = 1; n <= SEEDS; n += 1) {
      const result = bossReach(reachBrief(boss, map, INTENSITY), n * 7919, SECONDS);
      total += 1;
      if (result.simplified) simplified += 1;
      if (result.arrived) arrived += 1; else { failed += 1; stuck.push(`seed ${n * 7919} (closest ${Math.round(result.closest)} px)`); }
    }
    console.log(`${boss.padEnd(8)} ${map.padEnd(14)} arrived ${arrived}/${SEEDS}  simplified to the empty arena ${simplified}/${SEEDS} (${((100 * simplified) / SEEDS).toFixed(0)}%)${stuck.length ? `  STUCK: ${stuck.join(', ')}` : ''}`);
  }
}
console.log(`arrival distance: crusher ${arrivalDistance('crusher')} px, gunner ${arrivalDistance('gunner')} px; ${total - failed}/${total} games arrived`);
process.exitCode = failed === 0 ? 0 : 1;
