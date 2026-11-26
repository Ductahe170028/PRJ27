// How long compile + gate take through the real worker (the API's path), on the BUILT code:
//
//   npm run build            (once; this script imports apps/api/dist)
//   node scripts/measure-compile-time.mjs [n=40]
//
// Six cases, n runs each with different seeds, maps and intensities, one at a time like requests:
// a 60 s survive level, a 180 s survive level, and two worst cases (kill 200, intensity 5, fragile player: every thinning
// step and every goal reduction is used before the level is refused): only brutes, and (Stage 4B) all four kinds with the
// shotgun, which has the most enemy bullets and pellets to simulate.
// (Stage 4D adds the worst case with a base to defend: intensity 5, all four kinds, shotgun, fragile player, gunner boss.)
// Prints median, p95 and max wall time in seconds, and how many runs ended in a timeout or a refusal.
import { performance } from 'node:perf_hooks';
import { compileInWorker, COMPILE_TIMEOUT_MS } from '../dist/shooter/isolated-compile.js';

const n = Number(process.argv[2] ?? 40);
const MAPS = ['open-arena', 'pillars', 'cross-corridors', 'rooms', 'ring'];
const MIXES = [
  [{ type: 'runner', share: 5 }],
  [{ type: 'brute', share: 5 }],
  [{ type: 'swarmer', share: 5 }],
  [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }],
];
const base = (extra) => ({ version: 'brief-1', healthDrops: 'none', boss: 'none', base: 'none', title: 'Timing', theme: 'zombie-city', playerHealth: 'normal', weapon: 'pistol', unsupported: [], ...extra });
const cases = {
  'survive 60 s': (i) => base({ map: MAPS[i % 5], enemies: MIXES[i % 4], intensity: (i % 5) + 1, goal: { type: 'survive', seconds: 60 }, weapon: ['pistol', 'rapid', 'heavy'][i % 3] }),
  'survive 180 s': (i) => base({ map: MAPS[i % 5], enemies: MIXES[i % 4], intensity: (i % 5) + 1, goal: { type: 'survive', seconds: 180 }, weapon: ['pistol', 'rapid', 'heavy'][i % 3] }),
  'worst boss: kill 200, all4, shotgun, I5, gunner': (i) => base({ boss: 'gunner', map: MAPS[i % 5], enemies: [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }], intensity: 5, playerHealth: 'fragile', weapon: 'shotgun', goal: { type: 'kill', count: 200 } }),
  'worst base: I5, all4, shotgun, fragile, gunner': (i) => base({ boss: 'gunner', base: 'defend', map: MAPS[i % 5], enemies: [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }], intensity: 5, playerHealth: 'fragile', weapon: 'shotgun', goal: { type: 'kill', count: 200 } }),
  'worst 4B: kill 200, all4, shotgun, I5': (i) => base({ map: MAPS[i % 5], enemies: [{ type: 'runner', share: 3 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 3 }, { type: 'spitter', share: 2 }], intensity: 5, playerHealth: 'fragile', weapon: 'shotgun', goal: { type: 'kill', count: 200 } }),
  'worst: kill 200, brutes, intensity 5': (i) => base({ map: MAPS[i % 5], enemies: [{ type: 'brute', share: 5 }], intensity: 5, playerHealth: 'fragile', goal: { type: 'kill', count: 200 } }),
};
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];

for (const [name, make] of Object.entries(cases)) {
  const times = [];
  const ended = { ok: 0, refused: 0, timeout: 0, other: 0 };
  for (let i = 0; i < n; i += 1) {
    const started = performance.now();
    try {
      await compileInWorker({ brief: make(i), seed: 1000 + i * 7 }, new AbortController().signal);
      ended.ok += 1;
    } catch (error) {
      const code = error?.code;
      if (code === 'compile_timeout') ended.timeout += 1;
      else if (code === 'unwinnable_level') ended.refused += 1;
      else { ended.other += 1; console.error(error); }
    }
    times.push((performance.now() - started) / 1000);
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(38)} n=${n}  median ${quantile(times, 0.5).toFixed(2)} s  p95 ${quantile(times, 0.95).toFixed(2)} s  max ${times.at(-1).toFixed(2)} s  (ok ${ended.ok}, refused ${ended.refused}, timeout ${ended.timeout}, other ${ended.other}; limit ${COMPILE_TIMEOUT_MS / 1000} s)`);
}
