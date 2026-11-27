import { describe, expect, it } from 'vitest';
import { SHOOTER_LEVELS, createSim, step, type ShooterState } from '@game-creator/contracts';
import { diffSnapshots, isAttacking, snapshotOf, type Snapshot } from '../src/game/render/events';

const snap = (patch: Partial<Snapshot> = {}): Snapshot => ({
  tick: 100, playerHp: 5, nextShotTick: 90, baseHp: undefined, enemies: new Map(), bullets: new Map(), ...patch,
});
const enemy = (type: 'runner' | 'brute' | 'crusher' = 'runner', hp = 2, x = 300, y = 200) => ({ type, x, y, hp });

describe('what changed between two frames', () => {
  it('sees an enemy lose hit points and still stand (hurt)', () => {
    const before = snap({ enemies: new Map([[1, enemy('brute', 12)], [2, enemy('runner', 2)]]) });
    const after = snap({ tick: 101, enemies: new Map([[1, enemy('brute', 11)], [2, enemy('runner', 2)]]) });
    const events = diffSnapshots(before, after, 600);
    expect(events.hurt).toEqual([1]);
    expect(events.deaths).toEqual([]);
  });

  it('sees an enemy that is gone as a death, at the place it was last seen', () => {
    const before = snap({ enemies: new Map([[1, enemy('runner', 1, 123, 234)], [2, enemy('crusher', 3, 480, 300)]]) });
    const after = snap({ tick: 102, enemies: new Map() });
    const { deaths } = diffSnapshots(before, after, 600);
    expect(deaths).toEqual([
      { id: 1, type: 'runner', x: 123, y: 234, boss: false },
      { id: 2, type: 'crusher', x: 480, y: 300, boss: true },
    ]);
  });

  it('sees the player fire (the next shot is later) and get hurt, and the base get hit', () => {
    const before = snap({ baseHp: 100 });
    const after = snap({ tick: 101, nextShotTick: 108, playerHp: 4, baseHp: 98 });
    const events = diffSnapshots(before, after, 600);
    expect(events.shot).toBe(true);
    expect(events.playerHit).toBe(true);
    expect(events.baseHit).toBe(true);
    const quiet = diffSnapshots(before, snap({ tick: 101, baseHp: 100 }), 600);
    expect(quiet).toEqual({ hurt: [], deaths: [], playerHit: false, shot: false, baseHit: false, impacts: [] });
  });

  it('does not see the player fire when health goes UP (a pickup), and has no base events without a base', () => {
    const events = diffSnapshots(snap({ playerHp: 3 }), snap({ tick: 101, playerHp: 4 }), 600);
    expect(events.playerHit).toBe(false);
    expect(events.baseHit).toBe(false);
  });

  it('sees a bullet that ended early as a hit, and one that ran out of range as no hit', () => {
    const early = { x: 200, y: 200, vx: 600, vy: 0, travelled: 120 };
    const spent = { x: 700, y: 200, vx: 600, vy: 0, travelled: 599 };
    const before = snap({ bullets: new Map([[1, early], [2, spent], [3, { x: 50, y: 50, vx: 600, vy: 0, travelled: 10 }]]) });
    const after = snap({ tick: 101, bullets: new Map([[3, { x: 60, y: 50, vx: 600, vy: 0, travelled: 20 }]]) });
    expect(diffSnapshots(before, after, 600).impacts).toEqual([{ x: 200, y: 200 }]);
  });
});

describe('what the same code says about a real game', () => {
  const play = (name: keyof typeof SHOOTER_LEVELS, ticks: number, fire: boolean): { before: ShooterState; snaps: Snapshot[] } => {
    const state = createSim(structuredClone(SHOOTER_LEVELS[name]));
    state.player.hp = 1000; state.player.maxHp = 1000;
    const snaps: Snapshot[] = [snapshotOf(state)];
    for (let i = 0; i < ticks; i += 1) {
      step(state, { moveX: 0, moveY: 0, aimX: state.player.x + 100, aimY: state.player.y, fire });
      if (i % 3 === 2) snaps.push(snapshotOf(state));
    }
    return { before: state, snaps };
  };

  it('finds the shots of a player holding the trigger, and deaths of enemies shot down', () => {
    const { snaps } = play('arena', 60 * 14, true);
    const events = snaps.slice(1).map((after, i) => diffSnapshots(snaps[i]!, after, SHOOTER_LEVELS.arena.weapon.range));
    expect(events.filter((e) => e.shot).length).toBeGreaterThanOrEqual(10);
    expect(events.flatMap((e) => e.deaths).length).toBeGreaterThanOrEqual(1);
    expect(events.flatMap((e) => e.impacts).length).toBeGreaterThanOrEqual(1);
  });

  it('finds no shot when the trigger is not held', () => {
    const { snaps } = play('arena', 60 * 5, false);
    const events = snaps.slice(1).map((after, i) => diffSnapshots(snaps[i]!, after, 600));
    expect(events.some((e) => e.shot)).toBe(false);
  });

  it('sees the base get hit in a level where brutes walk at it', () => {
    const { snaps } = play('base-fall', 60 * 12, false);
    const events = snaps.slice(1).map((after, i) => diffSnapshots(snaps[i]!, after, 600));
    expect(events.some((e) => e.baseHit)).toBe(true);
  });
});

describe('an enemy that is touching', () => {
  const state = createSim(structuredClone(SHOOTER_LEVELS['base-siege']));
  const at = (x: number, y: number, type: 'runner' | 'brute' = 'runner') => isAttacking({ type, x, y }, state);

  it('attacks the player when its body meets the player', () => {
    const { x, y } = state.player; // (the player is beside the base: test above it, away from the base's square)
    expect(at(x, y - (11 + 14 + 2))).toBe(true);
    expect(at(x, y - (11 + 14 + 6))).toBe(false);
  });

  it('attacks the base when it reaches its square', () => {
    const base = state.base!;
    expect(at(base.x + 28 + 11 + 1, base.y)).toBe(true);
    expect(at(base.x + 28 + 11 + 12, base.y)).toBe(false);
  });

  it('does not attack from far away', () => {
    expect(at(40, 110)).toBe(false);
  });
});

describe('an enemy touching a bigger base (Stage 6B)', () => {
  const state = createSim(structuredClone(SHOOTER_LEVELS['base-siege-big']));
  const at = (x: number, y: number) => isAttacking({ type: 'runner', x, y }, state);

  it('uses the square of THIS base (80), not the 56 of the older ones', () => {
    const base = state.base!;
    expect(state.baseRect).toEqual({ x: base.x, y: base.y, width: 80, height: 80 });
    expect(at(base.x + 40 + 11 + 1, base.y)).toBe(true); // touching the edge of the 80 square
    expect(at(base.x + 40 + 11 + 12, base.y)).toBe(false);
    expect(at(base.x + 28 + 11 + 1, base.y)).toBe(true); // (inside what the 56 square would have been: it is at the wall of the big one)
    // and without the rect (an older caller) it falls back to the base's own size
    expect(isAttacking({ type: 'runner', x: base.x + 40 + 11 + 12, y: base.y }, { player: state.player, base: state.base! })).toBe(false);
  });
});
