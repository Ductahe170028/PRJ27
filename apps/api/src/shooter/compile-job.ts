// One compile job: what the worker runs. Compile, then the bot gate.
import type { ShooterLevel } from '@game-creator/contracts';
import type { ShooterBrief } from './brief.js';
import { compileShooter, type CompileOptions } from './compile.js';
import { gateLevel, type GateOptions, type GateReport } from './gate.js';

export interface CompileJob { brief: ShooterBrief; seed: number }

export interface CompiledShooter {
  level: ShooterLevel;
  /** Engine sentences: a simplified map, an adjusted difficulty. */
  notices: string[];
  report: GateReport & { map: string; variant: number };
}

export function compileAndGate(job: CompileJob, options: CompileOptions & GateOptions = {}): CompiledShooter {
  const compiled = compileShooter(job.brief, job.seed, options);
  const gated = gateLevel(compiled.level, job.brief, options);
  return {
    level: gated.level,
    notices: [...compiled.notices, ...gated.notices],
    report: { ...gated.report, map: compiled.map, variant: compiled.variant },
  };
}
