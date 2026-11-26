// The gate: a casual bot plays the compiled level on a few seeds. A level the bot
// wins on fewer than MIN_WINS of them is thinned out. The casual bot reacts late and
// aims badly (createCasualBot), which is closer to a person than the expert bot of
// the tests; it still plays better than some people, so the gate only ever makes a
// level EASIER, never harder: a level that is easy for the bot is not necessarily
// easy for a person.
import {
  ENEMY_TYPES, ShooterLevelSchema, bossOf, bossWaveOf, createCasualBot, playLevel, totalScheduledEnemies, type PlayResult, type ShooterLevel,
} from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { killTarget } from './waves.js';

/** Seeds the bot plays on (level.seed + 1 .. +K). */
export const GATE_SEEDS = 3;
/** The bot must win on at least this many of the GATE_SEEDS games (2 of 3). */
export const MIN_WINS = 2;
/** Most thinning steps, each x0.8 (0.8^6 = 26% of the original density; never below 25%). It was 4 steps
 * (41%) while the gate's bot was the expert. The casual bot is weaker, and measured over the whole grid
 * (docs/shooter-calibration.md) every combination is winnable within 6 steps but not within 4 (at
 * intensity 5, 13% of the combinations needed a 5th or 6th step). */
export const MAX_THIN_STEPS = 6;
export const THIN_FACTOR = 0.8;
/** Each thinning step also lowers a boss's hit points by this factor (rounded down), never below this share of the
 * original and never below 10: the boss itself is never removed or reduced in number. */
export const BOSS_THIN_FACTOR = 0.9;
export const BOSS_MIN_SHARE = 0.4;
/** Each easing step also gives a base this many times its hit points (rounded up, at most 200): fewer enemies and a sturdier base. */
export const BASE_HP_FACTOR = 1.15;
export const MAX_BASE_HP = 200;
const MAX_ATMS = 600_000;

export const THINNED_NOTICE = 'Độ khó được điều chỉnh để màn chơi thắng được.';
export const UNWINNABLE_MESSAGE = 'Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.';

export interface GateReport {
  /** Who played: the casual bot of the gate, or a replacement given by a test (`options.play`). */
  bot: 'casual' | 'custom';
  runs: number;
  wins: number;
  hpLeftAvg: number;
  thinSteps: number;
  /** Total enemies scheduled in the level that was kept. */
  scheduled: number;
  /** Only for a level with a boss: its hit points in the level that was kept. */
  bossHp?: number;
}

export interface GateOptions {
  /** Test seam: replaces the bot (for example to make a level unwinnable on purpose). */
  play?: (level: ShooterLevel) => PlayResult;
}

const withSeed = (level: ShooterLevel, seed: number): ShooterLevel => ({ ...level, seed: seed % 2_147_483_648 });
/** A new casual bot for every game, made from that game's own seed. */
const defaultPlay = (level: ShooterLevel) => playLevel(level, createCasualBot(level.seed));

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
function thin(level: ShooterLevel, original: ShooterLevel): ShooterLevel {
  const thinned = thinEnemies(level, original);
  return level.base ? { ...thinned, base: { ...level.base, hp: Math.min(MAX_BASE_HP, Math.ceil(level.base.hp * BASE_HP_FACTOR)) } } : thinned;
}

function thinEnemies(level: ShooterLevel, original: ShooterLevel): ShooterLevel {
  const bossWave = bossWaveOf(level);
  if (bossWave) {
    // The ordinary enemies thin out as in a survive level; the boss wave stays whole and its hit points go down a little.
    const rest = level.waves.filter((wave) => bossOf(wave.type) === undefined);
    const baseHp = original.bossHp ?? ENEMY_TYPES[bossWave.type].hp;
    const floorHp = Math.max(10, Math.ceil(baseHp * BOSS_MIN_SHARE));
    const bossHp = Math.max(floorHp, Math.floor((level.bossHp ?? baseHp) * BOSS_THIN_FACTOR));
    const waves = [...(rest.length > 0 ? scaleCounts(rest, THIN_FACTOR) : []), bossWave].sort((a, b) => a.atMs - b.atMs);
    return { ...level, waves, bossHp };
  }
  if (level.win.type === 'survive') {
    return { ...level, waves: scaleCounts(level.waves, THIN_FACTOR) };
  }
  if (level.win.type === 'boss') return level; // (a boss win always has a boss wave: handled above)
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
    current = ShooterLevelSchema.parse(thin(current, level));
    thinSteps += 1;
    result = evaluate(current, play);
  }
  if (result.wins < MIN_WINS) throw new AIError('unwinnable_level', UNWINNABLE_MESSAGE, 422, undefined, ['goal']);

  const notices = thinSteps > 0 ? [THINNED_NOTICE] : [];
  return { level: current, notices, report: { bot: options.play ? 'custom' : 'casual', runs: GATE_SEEDS, wins: result.wins, hpLeftAvg: Math.round(result.hpLeftAvg * 1000) / 1000, thinSteps, scheduled: totalScheduledEnemies(current), ...(bossWaveOf(current) ? { bossHp: current.bossHp ?? ENEMY_TYPES[bossWaveOf(current)!.type].hp } : {}) } };
}
