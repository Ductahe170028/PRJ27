// The wave schedule: how many enemies of which kind arrive when. Intensity sets
// the pace, `share` sets the mix, the goal sets how long it lasts.
import { MAX_SCHEDULED_ENEMIES, type ShooterLevel } from '@game-creator/contracts';
import type { ShooterBrief } from './brief.js';
import type { Rng } from './rng.js';

export type Wave = ShooterLevel['waves'][number];
type EnemyKind = Wave['type'];

/** Threat per second at intensity 1..5, before the ramp (calibrated offline,
 * see docs/shooter-calibration.md; `npm run shooter:calibrate`). */
export const INTENSITY_RATE = [0.6, 1.2, 1.7, 2.15, 2.7] as const;

/** How much one enemy of a kind counts toward the pace. INTENSITY_RATE is threat
 * per second; the number of enemies is the threat divided by the mix's average
 * weight, so five brutes are not as many as five swarmers. Calibrated together
 * with INTENSITY_RATE. */
export const ENEMY_WEIGHT: Record<EnemyKind, number> = { swarmer: 0.6, runner: 1, brute: 4 };

/** Average weight of an enemy in the mix, by share. */
export function meanWeight(enemies: ReadonlyArray<{ type: EnemyKind; share: number }>): number {
  const shares = enemies.reduce((sum, enemy) => sum + enemy.share, 0);
  return enemies.reduce((sum, enemy) => sum + enemy.share * ENEMY_WEIGHT[enemy.type], 0) / shares;
}

/** INTENSITY_RATE is calibrated on games of this length (s). */
export const REFERENCE_SECONDS = 60;

/** Hit points do not come back, so a longer game carries more risk per second.
 * Past the reference length the pace eases by (reference / length)^0.5: a 180 s
 * game runs at about 58% of the pace of a 60 s one. */
export function paceFactor(horizonSeconds: number): number {
  return horizonSeconds <= REFERENCE_SECONDS ? 1 : Math.sqrt(REFERENCE_SECONDS / horizonSeconds);
}

/** Waves are cut into slices of this length (ms). */
export const SLICE_MS = 5_000;
/** The first slice starts after this much quiet (ms). */
export const FIRST_SLICE_MS = 2_000;
/** The ramp starts at this share of the full rate and rises linearly to 1. */
export const RAMP_START = 0.5;
/** A brute does not show up before this share of the horizon, unless it is the only kind. */
export const BRUTE_NOT_BEFORE = 0.25;
/** A kill level schedules this many times the goal, so that missed enemies do not block the win. */
export const KILL_SURPLUS = 1.3;
export const MAX_WAVES = 30;
export const MAX_WAVE_COUNT = 40;
/** Longest horizon for a kill level (s). */
export const MAX_KILL_HORIZON_SECONDS = 300;

export const killTarget = (count: number) => Math.ceil(count * KILL_SURPLUS);

/** Counts for each kind that add up to `total` and follow the shares (largest remainder). */
export function allocateByShare(total: number, shares: ReadonlyArray<{ type: EnemyKind; share: number }>): Map<EnemyKind, number> {
  const sum = shares.reduce((acc, item) => acc + item.share, 0);
  const exact = shares.map((item) => ({ type: item.type, value: (total * item.share) / sum }));
  const counts = new Map<EnemyKind, number>(exact.map((item) => [item.type, Math.floor(item.value)]));
  let left = total - [...counts.values()].reduce((acc, count) => acc + count, 0);
  const byRemainder = [...exact].sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)));
  for (let i = 0; left > 0; i = (i + 1) % byRemainder.length, left -= 1) {
    const type = byRemainder[i]!.type;
    counts.set(type, counts.get(type)! + 1);
  }
  return counts;
}

interface Slice { startMs: number; count: number }

/** Slices over the horizon: n(t) = round(rate * 5 s * ramp(t)). A kill level
 * is stretched, or thickened, until it holds the target number of enemies. */
function sliceSchedule(brief: ShooterBrief, horizonSeconds: number, pace: number): Slice[] {
  const rate = (INTENSITY_RATE[brief.intensity - 1]! * pace) / meanWeight(brief.enemies);
  const horizonMs = horizonSeconds * 1000;
  const slices: Slice[] = [];
  for (let start = FIRST_SLICE_MS; start < horizonMs; start += SLICE_MS) {
    const ramp = RAMP_START + (1 - RAMP_START) * ((start - FIRST_SLICE_MS) / Math.max(1, horizonMs - FIRST_SLICE_MS));
    slices.push({ startMs: start, count: Math.max(1, Math.round((rate * (SLICE_MS / 1000)) * ramp)) });
  }
  return slices;
}

/** Keeps the total at or below the cap by scaling every slice down (never to zero). */
function capTotal(slices: Slice[], cap: number): Slice[] {
  const total = slices.reduce((acc, slice) => acc + slice.count, 0);
  if (total <= cap) return slices;
  const factor = cap / total;
  const scaled = slices.map((slice) => ({ ...slice, count: Math.max(1, Math.floor(slice.count * factor)) }));
  return scaled;
}

/** Spreads the kinds over the slices. A brute waits for 25% of the horizon when
 * another kind exists. Swarmers arrive as clusters: every slice gives them
 * several at once (their weight is low, so there are many). */
function placeKinds(slices: Slice[], counts: Map<EnemyKind, number>, horizonMs: number): Wave[] {
  const waves: Wave[] = [];
  const kinds = [...counts.keys()];
  const only = kinds.length === 1;
  for (const type of kinds) {
    const total = counts.get(type)!;
    if (total === 0) continue;
    let eligible = slices; // swarmers come in clusters because a slice holds many; brute has a time rule below
    if (type === 'brute' && !only) {
      const late = eligible.filter((slice) => slice.startMs >= horizonMs * BRUTE_NOT_BEFORE);
      eligible = late.length > 0 ? late : [slices[slices.length - 1]!];
    }
    // Weight each eligible slice by its size, then share `total` out by largest remainder.
    const weight = eligible.reduce((acc, slice) => acc + slice.count, 0);
    const exact = eligible.map((slice) => (total * slice.count) / weight);
    const given = exact.map(Math.floor);
    let left = total - given.reduce((acc, count) => acc + count, 0);
    const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
    for (let i = 0; left > 0; i = (i + 1) % order.length, left -= 1) given[order[i]!.index] = given[order[i]!.index]! + 1;
    eligible.forEach((slice, index) => { if (given[index]! > 0) waves.push({ atMs: slice.startMs, type, count: given[index]! }); });
  }
  return waves.sort((a, b) => a.atMs - b.atMs || kindOrder(a.type) - kindOrder(b.type));
}
const kindOrder = (type: EnemyKind) => ({ runner: 0, swarmer: 1, brute: 2 })[type];

/** Packs slices into at most 30 waves of at most 40 each: neighbouring slices
 * are merged (same kind, the first one's time) until it fits. */
function fit(waves: Wave[], slices: Slice[]): Wave[] {
  const times = slices.map((slice) => slice.startMs);
  for (let bucket = 1; bucket <= times.length; bucket += 1) {
    // One wave per bucket and kind, at the time of the earliest wave really in it
    // (a brute merged into an early bucket must not come before its own time).
    const merged = new Map<string, Wave>();
    for (const wave of waves) {
      const key = `${Math.floor(times.indexOf(wave.atMs) / bucket)}:${wave.type}`;
      const known = merged.get(key);
      if (known) { known.count += wave.count; known.atMs = Math.min(known.atMs, wave.atMs); } else merged.set(key, { ...wave });
    }
    const out = [...merged.values()].sort((a, b) => a.atMs - b.atMs || kindOrder(a.type) - kindOrder(b.type));
    if (out.length <= MAX_WAVES && out.every((wave) => wave.count <= MAX_WAVE_COUNT)) return out;
  }
  // Nothing fit (only possible with huge totals): split big waves into the same moment.
  return waves.flatMap((wave) => Array.from({ length: Math.ceil(wave.count / MAX_WAVE_COUNT) }, (_, i) => ({
    ...wave, count: Math.min(MAX_WAVE_COUNT, wave.count - i * MAX_WAVE_COUNT),
  }))).slice(0, MAX_WAVES);
}

export interface WaveSchedule { waves: Wave[]; horizonSeconds: number }

/** The whole schedule for a brief. The shape follows the brief; `rng` only breaks ties. */
export function scheduleWaves(brief: ShooterBrief, rng: Rng): WaveSchedule {
  const rate = INTENSITY_RATE[brief.intensity - 1]! / meanWeight(brief.enemies);
  const kill = brief.goal.type === 'kill' ? brief.goal.count : undefined;
  const target = kill === undefined ? 0 : killTarget(kill);
  // A kill level is as long as it takes the schedule to hold the target; the
  // pace eases for a long one, which makes it longer still (one correction is enough).
  const killHorizon = (pace: number) => Math.min(MAX_KILL_HORIZON_SECONDS, Math.max(20, Math.ceil(target / (rate * pace * 0.75) / 5) * 5));
  const horizonSeconds = kill === undefined ? (brief.goal as { seconds: number }).seconds : killHorizon(paceFactor(killHorizon(1)));
  const pace = paceFactor(horizonSeconds);

  let slices = capTotal(sliceSchedule(brief, horizonSeconds, pace), MAX_SCHEDULED_ENEMIES);
  if (kill !== undefined) {
    // Enough enemies to win even when some are missed: add the missing ones to the last slices.
    let total = slices.reduce((acc, slice) => acc + slice.count, 0);
    for (let i = slices.length - 1; total < target; i = i === 0 ? slices.length - 1 : i - 1, total += 1) slices[i] = { ...slices[i]!, count: slices[i]!.count + 1 };
    slices = capTotal(slices, MAX_SCHEDULED_ENEMIES);
  }
  const total = slices.reduce((acc, slice) => acc + slice.count, 0);
  // The seed only breaks ties: which kind gets the extra enemy when shares do not divide evenly.
  const turn = Math.floor(rng() * brief.enemies.length);
  const shares = [...brief.enemies.slice(turn), ...brief.enemies.slice(0, turn)].map((enemy) => ({ type: enemy.type as EnemyKind, share: enemy.share }));
  const counts = allocateByShare(total, shares);
  return { waves: fit(placeKinds(slices, counts, horizonSeconds * 1000), slices), horizonSeconds };
}
