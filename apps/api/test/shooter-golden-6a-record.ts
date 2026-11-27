// The recipe of the Stage 6A golden master (see shooter-golden-6a.test.ts): games played by SCRIPTED inputs that switch weapons, switch
// during a cooldown, send rubbish slots and fire throughout. The inputs are a pure function of the tick, so a replay is exact. Shared by the
// test and by scripts/make-golden-sim-6a.ts so that both record the same thing.
import { SHOOTER_LEVELS, createSim, snapshotHash, step, type ShooterInput, type ShooterLevel } from '@game-creator/contracts';
import type { GoldenResult } from './shooter-golden-record.js';

const ARSENAL = SHOOTER_LEVELS.arsenal.arsenal!;
const weapon = (slot: number) => ARSENAL[slot]!.weapon;

/** Where the aim point goes: a slow circle around the middle, so that bullets fly in every direction. */
const aimAt = (tick: number) => ({ aimX: 480 + 260 * Math.cos(tick / 40), aimY: 305 + 200 * Math.sin(tick / 40) });
const base = (tick: number): ShooterInput => ({ moveX: (Math.floor(tick / 90) % 2 === 0 ? 1 : -1) as 1 | -1, moveY: (Math.floor(tick / 150) % 3 === 0 ? 0 : Math.floor(tick / 150) % 3 === 1 ? 1 : -1) as -1 | 0 | 1, ...aimAt(tick), fire: tick % 11 !== 5 });

/** The scripts: name -> the input of every tick. */
export const SCRIPTS: Record<string, (tick: number) => ShooterInput> = {
  // keys 1 to 5 in turn, every 100 ticks
  cycle: (tick) => ({ ...base(tick), ...(tick % 100 === 3 ? { slot: Math.floor(tick / 100) % 5 } : {}) }),
  // a switch asked for while the shot clock is still running, and again right after the first switch has ended
  'switch-in-cooldown': (tick) => ({ ...base(tick), ...(tick === 8 ? { slot: 3 } : tick === 27 ? { slot: 4 } : tick === 31 ? { slot: 0 } : tick % 120 === 60 ? { slot: (tick / 120 | 0) % 5 } : {}) }),
  // slots that are not slots, among good ones: the rubbish does nothing
  'junk-slots': (tick) => {
    const junk = [-1, 5, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '2' as unknown as number, 2 ** 40, -0.5];
    return { ...base(tick), ...(tick % 7 === 2 ? { slot: junk[(tick / 7 | 0) % junk.length] as number } : tick % 133 === 9 ? { slot: (tick / 133 | 0) % 5 } : {}) };
  },
  // the same switching, never firing (nothing to hit: only the slot changes)
  'switch-only': (tick) => ({ ...base(tick), fire: false, ...(tick % 40 === 1 ? { slot: Math.floor(tick / 40) % 5 } : {}) }),
};

export interface Case6A { name: string; level: string; script: string; ticks: number }
/** The games: a level (the stored fixture, by name), a script and how many ticks at most. */
export const CASES_6A: Case6A[] = [
  { name: 'arsenal:cycle', level: 'arsenal', script: 'cycle', ticks: 3600 },
  { name: 'arsenal:switch-in-cooldown', level: 'arsenal', script: 'switch-in-cooldown', ticks: 3600 },
  { name: 'arsenal:junk-slots', level: 'arsenal', script: 'junk-slots', ticks: 3600 },
  { name: 'arsenal:switch-only', level: 'arsenal', script: 'switch-only', ticks: 1800 },
  { name: 'arsenal-heavy-start:cycle', level: 'arsenal-heavy-start', script: 'cycle', ticks: 3600 },
  { name: 'arsenal-base:cycle', level: 'arsenal-base', script: 'cycle', ticks: 3600 },
  { name: 'arsenal-base:switch-in-cooldown', level: 'arsenal-base', script: 'switch-in-cooldown', ticks: 3600 },
  { name: 'arsenal-boss:cycle', level: 'arsenal-boss', script: 'cycle', ticks: 3600 },
  { name: 'arsenal-boss:junk-slots', level: 'arsenal-boss', script: 'junk-slots', ticks: 3600 },
  { name: 'no-arsenal:cycle', level: 'arena', script: 'cycle', ticks: 3600 },
  { name: 'no-arsenal:junk-slots', level: 'base-siege', script: 'junk-slots', ticks: 3600 },
];

/** The levels the cases play: the hand-made ones, and three variants that put the arsenal into other levels. */
export function levelFor(name: string): ShooterLevel {
  const fixtures = SHOOTER_LEVELS as Record<string, ShooterLevel>;
  if (name === 'arsenal-heavy-start') return { ...structuredClone(SHOOTER_LEVELS.arsenal), weapon: weapon(4) };
  if (name === 'arsenal-base') return { ...structuredClone(SHOOTER_LEVELS['base-siege']), arsenal: structuredClone(ARSENAL), weapon: weapon(3) };
  if (name === 'arsenal-boss') return { ...structuredClone(SHOOTER_LEVELS['boss-gunner']), arsenal: structuredClone(ARSENAL), weapon: weapon(2) };
  return structuredClone(fixtures[name]!);
}

export interface Golden6A { name: string; level: ShooterLevel; script: string; ticks: number; hashes: string[]; result: GoldenResult & { slot: number | null }; finalHash: string }

const MAX = 60 * 400;
/** Plays a case and records the hash every 60 ticks, the result and the last hash. */
export function recordScripted(name: string, level: ShooterLevel, script: string, ticks: number): Golden6A {
  const state = createSim(structuredClone(level));
  const input = SCRIPTS[script]!;
  const hashes: string[] = [];
  while (state.status === 'playing' && state.tick < Math.min(ticks, MAX)) {
    step(state, input(state.tick));
    if (state.tick % 60 === 0) hashes.push(snapshotHash(state));
  }
  const { hp, maxHp } = state.player;
  return {
    name, level, script, ticks, hashes,
    result: { status: state.status, tick: state.tick, hpLeft: state.status === 'lost' ? 0 : hp / maxHp, kills: state.kills, score: state.score, slot: state.weaponSlot ?? null },
    finalHash: snapshotHash(state),
  };
}
export const replayScripted = (stored: Golden6A): Golden6A => recordScripted(stored.name, stored.level, stored.script, stored.ticks);
