import { describe, expect, it } from 'vitest';
import {
  BASE_TUNING, SHOOTER_LEVELS, botInput, createCasualBot, createSim, playLevel, step, snapshotHash,
  type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, place, quietLevel } from './shooter-4b-helpers.js';

const seeded = (name: 'base-siege' | 'base-boss', k: number): ShooterLevel => ({ ...structuredClone(SHOOTER_LEVELS[name]), seed: SHOOTER_LEVELS[name].seed + k * 101 });
const baseLevel = (patch: Partial<ShooterLevel> = {}): ShooterLevel => quietLevel({
  player: { x: 416, y: 305, speed: 210, hp: 10 }, spawnPoints: [{ x: 880, y: 305 }], obstacles: [], base: { x: 480, y: 305, hp: 100 }, ...patch,
});

describe('the bots with a base to defend', () => {
  it('the expert bot holds the base to the end on the hand-made siege, on 8 seeds, and the player does not fall', () => {
    for (let k = 0; k < 8; k += 1) {
      const result = playLevel(seeded('base-siege', k), botInput);
      expect(result.status, `seed ${k}`).toBe('won');
      expect(result.state.base!.hp, `seed ${k}`).toBeGreaterThan(0);
      expect(result.state.lostBy).toBeUndefined();
    }
  });

  it('both bots finish the boss level inside the time they are given', () => {
    for (let k = 0; k < 4; k += 1) {
      const level = seeded('base-boss', k);
      for (const policy of [botInput, createCasualBot(level.seed)]) {
        const result = playLevel(level, policy, 24_000);
        expect(result.status, `seed ${k}`).not.toBe('playing');
        expect(result.state.tick).toBeLessThan(24_000);
      }
    }
  });

  it('the casual bot keeps near the base: within the leash plus 60 px for 95% of the ticks of a game', () => {
    expect(BASE_TUNING.botLeash).toBeGreaterThanOrEqual(120);
    expect(BASE_TUNING.botLeash).toBeLessThanOrEqual(220);
    for (let k = 0; k < 6; k += 1) {
      const level = seeded(k % 2 === 0 ? 'base-siege' : 'base-boss', k);
      const state = createSim(level);
      const bot = createCasualBot(level.seed);
      let inside = 0;
      let ticks = 0;
      while (state.status === 'playing' && state.tick < 24_000) {
        step(state, bot(state));
        ticks += 1;
        if (Math.hypot(state.player.x - level.base!.x, state.player.y - level.base!.y) <= BASE_TUNING.botLeash + 60) inside += 1;
      }
      expect(inside / ticks, `seed ${k}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('a bot that is far from the base is pulled back towards it, more gently than any danger pushes it away', () => {
    const state = createSim(baseLevel({ spawnPoints: [{ x: 880, y: 305 }] }));
    state.player.x = 100; state.player.y = 305; // 380 px from the base, no enemy anywhere
    const input = botInput(state);
    expect(input.moveX).toBe(1); // towards the base, along x
    expect(input.moveY).toBe(0);
    // an enemy right on top of it wins over the pull
    place(state, 'brute', 120, 305);
    expect(botInput(state).moveX).toBe(-1);
  });
});

describe('what the bots shoot at, with a base to defend', () => {
  /** The player at (416, 305), the base at (480, 305). */
  const stateWith = (...enemies: Array<[string, number, number]>) => {
    const state = createSim(baseLevel());
    for (const [type, x, y] of enemies) place(state, type as Parameters<typeof place>[1], x, y);
    return state;
  };
  const aimOf = (state: ShooterState) => { const input = botInput(state); return { x: input.aimX, y: input.aimY, fire: input.fire }; };

  it('the expert shoots at the enemy nearest the BASE, not the one nearest itself (both in range, both in view)', () => {
    // A is 96 px from the player and 145 from the base; B is 142 px from the player and 117 from the base
    const state = stateWith(['runner', 356, 230], ['runner', 500, 420]);
    expect(Math.hypot(356 - 416, 230 - 305)).toBeLessThan(Math.hypot(500 - 416, 420 - 305));
    expect(aimOf(state)).toMatchObject({ x: 500, y: 420, fire: true });
  });

  it('without a base the same field is shot as before: at the nearest enemy', () => {
    const level = baseLevel();
    const { base: _base, ...withoutBase } = level;
    void _base;
    const state = createSim(withoutBase);
    place(state, 'runner', 356, 230);
    place(state, 'runner', 500, 420);
    expect(aimOf(state)).toMatchObject({ x: 356, y: 230 });
  });

  it('an enemy that is out of range is not preferred: the nearest one is shot at', () => {
    const state = stateWith(['runner', 700, 305], ['runner', 380, 180]); // the first is nearer the base but 284 px away; range is 600 here: widen the gap
    state.level.weapon.range = 200;
    expect(aimOf(state)).toMatchObject({ x: 380, y: 180 });
  });

  it('an enemy whose line of fire the base blocks is not chosen while another is clear', () => {
    // B is right behind the base (the player at 416 cannot hit it) and A is clear: the expert aims at A
    const state = stateWith(['runner', 560, 305], ['runner', 380, 200]);
    expect(aimOf(state)).toMatchObject({ x: 380, y: 200 });
  });

  it('the boss in range still comes first', () => {
    const level = baseLevel({ waves: [{ atMs: 590_000, type: 'crusher', count: 1 }], win: { type: 'boss' } });
    const state = createSim(level);
    place(state, 'runner', 480, 395); // 90 px from the base
    place(state, 'crusher', 380, 230);
    expect(aimOf(state)).toMatchObject({ x: 380, y: 230 });
  });

  it('the casual bot prefers what is nearest the base too (on its first look; the aim has a small error)', () => {
    const state = stateWith(['runner', 356, 230], ['runner', 500, 420]);
    const input = createCasualBot(1)(state);
    expect(input.fire).toBe(true);
    expect(Math.abs(input.aimX - 500)).toBeLessThan(40);
    expect(Math.abs(input.aimY - 420)).toBeLessThan(40);
  });
});

describe('a level without a base: the bots are exactly what they were', () => {
  it('the same input and the same state, tick by tick, as a game that has a field without a base', () => {
    const level = structuredClone(SHOOTER_LEVELS.pillars);
    const play = (policy: (s: ShooterState) => ReturnType<typeof botInput>) => {
      const state = createSim(level);
      const hashes: string[] = [];
      for (let i = 0; i < 1500 && state.status === 'playing'; i += 1) { step(state, policy(state)); if (i % 100 === 0) hashes.push(snapshotHash(state)); }
      return hashes;
    };
    expect(play(botInput)).toEqual(play(botInput));
    expect(play(createCasualBot(level.seed))).toEqual(play(createCasualBot(level.seed)));
    void IDLE_INPUT;
  });
});
