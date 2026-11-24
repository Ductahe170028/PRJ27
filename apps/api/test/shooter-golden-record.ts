// The recipe of the golden master (see shooter-golden.test.ts). Shared by the test and by
// scripts/make-golden-sim.ts so that both always record the same thing.
//
// A "record" is what one scripted game did: the state hash every 60 ticks, the result and the
// last hash. The levels themselves are stored in the fixture, so the file keeps checking the
// SIMULATION even when the compiler or the maps change in a later stage.
import { IDLE, botInput, createSim, snapshotHash, step, type ShooterInput, type ShooterLevel, type ShooterState } from '@game-creator/contracts';

export type GoldenPolicyName = 'expert' | 'idle';

export interface GoldenResult { status: string; tick: number; hpLeft: number; kills: number; score: number }
export interface GoldenCase {
  name: string;
  policy: GoldenPolicyName;
  level: ShooterLevel;
  /** snapshotHash after tick 60, 120, ... (every 60th tick until the game ends). */
  hashes: string[];
  result: GoldenResult;
  finalHash: string;
}

const MAX_TICKS = 60 * 400;
const POLICIES: Record<GoldenPolicyName, (state: ShooterState) => ShooterInput> = { expert: botInput, idle: () => IDLE };

/** Plays `level` with the named policy and records it. */
export function record(name: string, policy: GoldenPolicyName, level: ShooterLevel): GoldenCase {
  const state = createSim(level);
  const decide = POLICIES[policy];
  const hashes: string[] = [];
  while (state.status === 'playing' && state.tick < MAX_TICKS) {
    step(state, decide(state));
    if (state.tick % 60 === 0) hashes.push(snapshotHash(state));
  }
  const { hp, maxHp } = state.player;
  return {
    name, policy, level, hashes,
    result: { status: state.status, tick: state.tick, hpLeft: state.status === 'lost' ? 0 : hp / maxHp, kills: state.kills, score: state.score },
    finalHash: snapshotHash(state),
  };
}

/** Replays a stored case with the current code. */
export const replay = (stored: GoldenCase): GoldenCase => record(stored.name, stored.policy, stored.level);
