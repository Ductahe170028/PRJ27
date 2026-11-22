// The gate: a plain bot plays the compiled level on a few seeds. A level the bot
// cannot win at all is thinned out; one it wins without a scratch at a high
// intensity is thickened. The bot is a judge of "can a simple player win this",
// not a model of a person.
import {
  MAX_SCHEDULED_ENEMIES, ShooterLevelSchema, botInput, playLevel, type PlayResult, type ShooterLevel,
} from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import type { ShooterBrief } from './brief.js';
import { MAX_WAVE_COUNT, killTarget } from './waves.js';

/** Seeds the bot plays on (level.seed + 1 .. +K). */
export const GATE_SEEDS = 3;
/** Most thinning steps, each x0.8 (0.8^4 = 41% of the original density; never below 30%). */
export const MAX_THIN_STEPS = 4;
export const THIN_FACTOR = 0.8;
/** Most thickening steps, each x1.2. */
export const MAX_THICKEN_STEPS = 2;
export const THICKEN_FACTOR = 1.2;
/** Thickening needs a bot that won every game with at least this share of hp left... */
export const EASY_HP_LEFT = 0.9;
/** ...and an intensity of at least this. */
export const EASY_MIN_INTENSITY = 3;
const MAX_ATMS = 600_000;

export const THINNED_NOTICE = 'Độ khó được điều chỉnh để màn chơi thắng được.';
export const THICKENED_NOTICE = 'Độ khó được điều chỉnh để màn chơi khó hơn.';
export const UNWINNABLE_MESSAGE = 'Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.';

export interface GateReport {
  runs: number;
  wins: number;
  hpLeftAvg: number;
  thinSteps: number;
  thickenSteps: number;
  /** Total enemies scheduled in the level that was kept. */
  scheduled: number;
}

export interface GateOptions {
  /** Test seam: replaces the bot (for example to make a level unwinnable on purpose). */
  play?: (level: ShooterLevel) => PlayResult;
}

const total = (level: ShooterLevel) => level.waves.reduce((sum, wave) => sum + wave.count, 0);
const withSeed = (level: ShooterLevel, seed: number): ShooterLevel => ({ ...level, seed: seed % 2_147_483_648 });
const defaultPlay = (level: ShooterLevel) => playLevel(level, botInput);

function evaluate(level: ShooterLevel, play: (level: ShooterLevel) => PlayResult) {
  let wins = 0;
  let hpLeft = 0;
  for (let i = 1; i <= GATE_SEEDS; i += 1) {
    const result = play(withSeed(level, level.seed + i));
    if (result.status === 'won') wins += 1;
    hpLeft += result.hpLeft;
  }
  return { wins, hpLeftAvg: hpLeft / GATE_SEEDS };
}

/** Scales the number of enemies by `factor` with cumulative rounding, so that
 * waves of one or two still thin out: a wave that comes to nothing is dropped,
 * and the first wave always stays. */
function scaleCounts(waves: ShooterLevel['waves'], factor: number, floorTotal = 1): ShooterLevel['waves'] {
  const all = waves.reduce((sum, wave) => sum + wave.count, 0);
  const wanted = Math.max(floorTotal, Math.round(all * factor));
  let before = 0;
  let given = 0;
  const out: ShooterLevel['waves'] = [];
  waves.forEach((wave, index) => {
    before += wave.count;
    const target = index === waves.length - 1 ? wanted : Math.round((before * wanted) / all);
    const count = Math.max(index === 0 ? 1 : 0, target - given);
    given += count;
    if (count > 0) out.push({ ...wave, count });
  });
  return out;
}

/** Fewer enemies (survive) or the same enemies later (kill: the goal needs them,
 * so only the surplus above 1.3 x the goal is removed, and the schedule is stretched). */
function thin(level: ShooterLevel): ShooterLevel {
  if (level.win.type === 'survive') {
    return { ...level, waves: scaleCounts(level.waves, THIN_FACTOR) };
  }
  // Kill: only the surplus above 1.3 x the goal may go; the rest arrives later instead.
  const waves = scaleCounts(level.waves, THIN_FACTOR, killTarget(level.win.count));
  return { ...level, waves: waves.map((wave) => ({ ...wave, atMs: Math.min(MAX_ATMS, Math.round(wave.atMs / THIN_FACTOR)) })) };
}

/** More enemies (survive, within the caps) or the same enemies sooner (kill). */
function thicken(level: ShooterLevel): ShooterLevel {
  if (level.win.type === 'survive') {
    const factor = Math.min(THICKEN_FACTOR, MAX_SCHEDULED_ENEMIES / total(level));
    return { ...level, waves: level.waves.map((wave) => ({ ...wave, count: Math.min(MAX_WAVE_COUNT, Math.max(1, Math.round(wave.count * factor))) })) };
  }
  return { ...level, waves: level.waves.map((wave) => ({ ...wave, atMs: Math.round(wave.atMs / THICKEN_FACTOR) })) };
}

const sameWaves = (a: ShooterLevel, b: ShooterLevel) => JSON.stringify(a.waves) === JSON.stringify(b.waves);

export function gateLevel(level: ShooterLevel, brief: ShooterBrief, options: GateOptions = {}): { level: ShooterLevel; notices: string[]; report: GateReport } {
  const play = options.play ?? defaultPlay;
  let current = level;
  let result = evaluate(current, play);
  let thinSteps = 0;
  let thickenSteps = 0;

  while (result.wins === 0 && thinSteps < MAX_THIN_STEPS) {
    current = ShooterLevelSchema.parse(thin(current));
    thinSteps += 1;
    result = evaluate(current, play);
  }
  if (result.wins === 0) throw new AIError('unwinnable_level', UNWINNABLE_MESSAGE, 422, undefined, ['goal']);

  if (thinSteps === 0) {
    while (thickenSteps < MAX_THICKEN_STEPS && result.wins === GATE_SEEDS && result.hpLeftAvg >= EASY_HP_LEFT && brief.intensity >= EASY_MIN_INTENSITY) {
      const next = ShooterLevelSchema.parse(thicken(current));
      if (sameWaves(next, current)) break; // at the caps: nothing more to add
      const nextResult = evaluate(next, play);
      if (nextResult.wins === 0) break; // too far: keep the last level the bot could win
      current = next; result = nextResult; thickenSteps += 1;
    }
  }
  const notices = [...(thinSteps > 0 ? [THINNED_NOTICE] : []), ...(thickenSteps > 0 ? [THICKENED_NOTICE] : [])];
  return { level: current, notices, report: { runs: GATE_SEEDS, wins: result.wins, hpLeftAvg: Math.round(result.hpLeftAvg * 1000) / 1000, thinSteps, thickenSteps, scheduled: total(current) } };
}
