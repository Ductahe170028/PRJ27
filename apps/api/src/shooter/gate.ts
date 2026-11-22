// The gate: a plain bot plays the compiled level on a few seeds. A level the bot
// wins on fewer than MIN_WINS of them is thinned out. The bot plays better than a
// person does, so the gate only ever makes a level EASIER, never harder: a level
// that is easy for the bot is not necessarily easy for a person.
import {
  ShooterLevelSchema, botInput, playLevel, type PlayResult, type ShooterLevel,
} from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { killTarget } from './waves.js';

/** Seeds the bot plays on (level.seed + 1 .. +K). */
export const GATE_SEEDS = 3;
/** The bot must win on at least this many of the GATE_SEEDS games (2 of 3). */
export const MIN_WINS = 2;
/** Most thinning steps, each x0.8 (0.8^4 = 41% of the original density; never below 30%). */
export const MAX_THIN_STEPS = 4;
export const THIN_FACTOR = 0.8;
const MAX_ATMS = 600_000;

export const THINNED_NOTICE = 'Độ khó được điều chỉnh để màn chơi thắng được.';
export const UNWINNABLE_MESSAGE = 'Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.';

export interface GateReport {
  runs: number;
  wins: number;
  hpLeftAvg: number;
  thinSteps: number;
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

export function gateLevel(level: ShooterLevel, options: GateOptions = {}): { level: ShooterLevel; notices: string[]; report: GateReport } {
  const play = options.play ?? defaultPlay;
  let current = level;
  let result = evaluate(current, play);
  let thinSteps = 0;

  while (result.wins < MIN_WINS && thinSteps < MAX_THIN_STEPS) {
    current = ShooterLevelSchema.parse(thin(current));
    thinSteps += 1;
    result = evaluate(current, play);
  }
  if (result.wins < MIN_WINS) throw new AIError('unwinnable_level', UNWINNABLE_MESSAGE, 422, undefined, ['goal']);

  const notices = thinSteps > 0 ? [THINNED_NOTICE] : [];
  return { level: current, notices, report: { runs: GATE_SEEDS, wins: result.wins, hpLeftAvg: Math.round(result.hpLeftAvg * 1000) / 1000, thinSteps, scheduled: total(current) } };
}
