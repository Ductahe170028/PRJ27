// One compile job: what the worker runs. Compile, then the bot gate. A kill goal
// that is too heavy to win is lowered (and said so) instead of refused.
import type { ShooterLevel } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import type { ShooterBrief } from './brief.js';
import { compileShooter, type CompileOptions } from './compile.js';
import { gateLevel, type GateOptions, type GateReport } from './gate.js';

export interface CompileJob { brief: ShooterBrief; seed: number }

/** A kill goal that the bot cannot win is lowered x0.7 (rounded down, never below 10), at most 3 times. */
export const KILL_REDUCE_FACTOR = 0.7;
export const MIN_KILL_COUNT = 10;
export const MAX_KILL_REDUCTIONS = 3;

export const killReducedNotice = (asked: number, kept: number) => `Mục tiêu hạ ${asked} quái quá nặng; đã giảm còn ${kept}.`;

export interface CompiledShooter {
  level: ShooterLevel;
  /** Engine sentences: a simplified map, an adjusted difficulty. */
  notices: string[];
  report: GateReport & { map: string; variant: number; killReductions: number };
}

export function compileAndGate(job: CompileJob, options: CompileOptions & GateOptions = {}): CompiledShooter {
  let brief = job.brief;
  for (let reductions = 0; ; reductions += 1) {
    const compiled = compileShooter(brief, job.seed, options);
    try {
      const gated = gateLevel(compiled.level, options);
      const reduced = job.brief.goal.type === 'kill' && brief.goal.type === 'kill' && reductions > 0
        ? [killReducedNotice(job.brief.goal.count, brief.goal.count)] : [];
      return {
        level: gated.level,
        notices: [...compiled.notices, ...reduced, ...gated.notices],
        report: { ...gated.report, map: compiled.map, variant: compiled.variant, killReductions: reductions },
      };
    } catch (error) {
      if (!(error instanceof AIError) || error.code !== 'unwinnable_level' || brief.goal.type !== 'kill' || reductions >= MAX_KILL_REDUCTIONS) throw error;
      const lower = Math.max(MIN_KILL_COUNT, Math.floor(brief.goal.count * KILL_REDUCE_FACTOR));
      if (lower >= brief.goal.count) throw error; // already at the floor: nothing left to lower
      brief = { ...brief, goal: { type: 'kill', count: lower } };
    }
  }
}
