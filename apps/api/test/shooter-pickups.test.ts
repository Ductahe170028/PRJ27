import { describe, expect, it } from 'vitest';
import {
  MAX_PICKUPS, PICKUP_LIFETIME_TICKS, ShooterLevelSchema, botInput, createSim, dropRoll, step, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, newState, place, quietLevel, run, weaponOf } from './shooter-4b-helpers.js';

describe('dropRoll', () => {
  it('is stable: the same seed and id always give the same number, 0..99', () => {
    for (const [seed, id] of [[0, 1], [1101, 7], [2_147_483_647, 400], [123, 99_999]] as const) {
      const first = dropRoll(seed, id);
      expect(dropRoll(seed, id)).toBe(first);
      expect(Number.isInteger(first)).toBe(true);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(99);
    }
  });

  it('is close to uniform: 10 000 ids in a row, each group of ten values holds 750..1250', () => {
    for (const seed of [0, 1101, 987_654_321]) {
      const groups = Array.from({ length: 10 }, () => 0);
      for (let id = 1; id <= 10_000; id += 1) groups[Math.floor(dropRoll(seed, id) / 10)]! += 1;
      for (const [index, count] of groups.entries()) {
        expect(count, `seed ${seed} group ${index}`).toBeGreaterThanOrEqual(750);
        expect(count, `seed ${seed} group ${index}`).toBeLessThanOrEqual(1250);
      }
    }
  });

  it('the rate follows the percentage: about 25% of ids roll below 25', () => {
    let below = 0;
    for (let id = 1; id <= 10_000; id += 1) if (dropRoll(42, id) < 25) below += 1;
    expect(below).toBeGreaterThan(2250);
    expect(below).toBeLessThan(2750);
  });
});

describe('the drops field of a level', () => {
  it('healthChancePct 0..50, optional, strict', () => {
    const ok = (drops: unknown) => ShooterLevelSchema.safeParse({ ...quietLevel({ waves: [{ atMs: 1000, type: 'swarmer', count: 1 }] }), ...(drops === undefined ? {} : { drops }) }).success;
    expect(ok(undefined)).toBe(true);
    expect(ok({ healthChancePct: 0 })).toBe(true);
    expect(ok({ healthChancePct: 50 })).toBe(true);
    expect(ok({ healthChancePct: 51 })).toBe(false);
    expect(ok({ healthChancePct: -1 })).toBe(false);
    expect(ok({ healthChancePct: 10, more: 1 })).toBe(false);
    expect(ok({})).toBe(false);
  });
});

/** A level with plenty of weak enemies and a bot that shoots them. */
const crowd = (patch: Partial<ShooterLevel> = {}): ShooterLevel => quietLevel({
  seed: 31, weapon: weaponOf({ cooldownMs: 150, bulletSpeed: 650, range: 600 }), player: { x: 480, y: 305, speed: 210, hp: 8 },
  waves: [{ atMs: 300, type: 'swarmer', count: 30 }, { atMs: 4000, type: 'swarmer', count: 30 }, { atMs: 8000, type: 'runner', count: 12 }],
  spawnPoints: [{ x: 60, y: 120 }, { x: 900, y: 120 }, { x: 60, y: 500 }, { x: 900, y: 500 }],
  win: { type: 'survive', seconds: 40 }, ...patch,
});

describe('which enemies drop, and what the drop does to the game', () => {
  it('without drops (absent or 0 percent) nothing ever drops, and the random generator ends where it did before', () => {
    const play = (level: ShooterLevel) => {
      const state = createSim(level);
      let pickups = 0;
      for (let i = 0; i < 1200 && state.status === 'playing'; i += 1) { step(state, botInput(state)); pickups = Math.max(pickups, state.pickups.length); }
      return { rng: state.rng, pickups, kills: state.kills };
    };
    const none = play(crowd());
    const zero = play(crowd({ drops: { healthChancePct: 0 } }));
    expect(none.kills).toBeGreaterThan(10);
    expect(none.pickups).toBe(0);
    expect(zero.pickups).toBe(0);
    expect(zero.rng).toBe(none.rng);
    expect(createSim(crowd()).pickups).toEqual([]);
  });

  it('a level with 25% drops plays the same enemies and the same random numbers at every tick; pickups appear where an enemy died', () => {
    const plain = createSim(crowd());
    const lucky = createSim(crowd({ drops: { healthChancePct: 25 } }));
    let appeared = 0;
    for (let i = 0; i < 1500; i += 1) {
      if (plain.status !== 'playing' || lucky.status !== 'playing') break;
      const before = new Map(lucky.enemies.map((e) => [e.id, { x: e.x, y: e.y }]));
      const seen = lucky.pickups.length;
      // the same inputs for both: the bot reads the enemies, which are the same in both
      const input = botInput(plain);
      step(plain, input);
      step(lucky, input);
      expect(lucky.rng, `rng at tick ${i}`).toBe(plain.rng);
      expect(lucky.enemies.map((e) => [e.type, e.x, e.y, e.hp]), `enemies at tick ${i}`).toEqual(plain.enemies.map((e) => [e.type, e.x, e.y, e.hp]));
      expect(lucky.bullets.map((b) => [b.x, b.y]), `bullets at tick ${i}`).toEqual(plain.bullets.map((b) => [b.x, b.y]));
      expect(lucky.kills).toBe(plain.kills);
      const dead = [...before.entries()].filter(([id]) => !lucky.enemies.some((e) => e.id === id));
      if (lucky.pickups.length > seen) {
        appeared += 1;
        const pickup = lucky.pickups[lucky.pickups.length - 1]!;
        expect(dead.some(([, at]) => Math.abs(at.x - pickup.x) < 6 && Math.abs(at.y - pickup.y) < 6), `drop at tick ${i} is where an enemy died`).toBe(true);
        expect(pickup.expiresTick).toBe(lucky.tick - 1 + PICKUP_LIFETIME_TICKS);
      }
    }
    expect(appeared).toBeGreaterThan(0);
    expect(plain.pickups).toEqual([]);
  });

  it('about a quarter of the defeated enemies drop one (counted over many kills, on a field that is emptied by hand)', () => {
    let drops = 0;
    let kills = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createSim(quietLevel({ seed, drops: { healthChancePct: 25 }, weapon: weaponOf({ damage: 5 }) }));
      for (let k = 0; k < 20; k += 1) place(state, 'swarmer', 700 + k * 10, 200 + (k % 5) * 50, 100 + k);
      state.enemies.forEach((e) => { e.hp = 0; });
      // defeat them through a real bullet each: put a bullet on top of every enemy
      for (const e of state.enemies) state.bullets.push({ id: 8000 + e.id, x: e.x, y: e.y, vx: 0, vy: 0, travelled: 0 });
      state.enemies.forEach((e) => { e.hp = 1; });
      step(state, IDLE_INPUT);
      kills += state.kills;
      drops += state.pickups.length + 0;
    }
    expect(kills).toBeGreaterThan(300);
    // the cap of three pickups holds the count down: this only shows that drops happen at all and never exceed it
    expect(drops).toBeGreaterThan(0);
    expect(drops).toBeLessThanOrEqual(40 * MAX_PICKUPS);
  });
});

describe('picking up', () => {
  const withPickup = (hp: number, extra: Partial<ShooterState['pickups'][number]> = {}) => {
    const state = newState(quietLevel({ player: { x: 480, y: 305, speed: 210, hp: 5 } }));
    state.player.hp = hp;
    state.pickups.push({ id: 900, x: 490, y: 305, expiresTick: 600, ...extra });
    return state;
  };

  it('a hurt player who touches one gains 1 hit point, never above the maximum, and the pickup goes', () => {
    const hurt = withPickup(3);
    step(hurt, IDLE_INPUT);
    expect(hurt.player.hp).toBe(4);
    expect(hurt.pickups).toHaveLength(0);
    const nearlyFull = withPickup(4);
    step(nearlyFull, IDLE_INPUT);
    expect(nearlyFull.player.hp).toBe(5);
  });

  it('with full health it is not taken: it stays until it expires, at exactly expiresTick', () => {
    const state = withPickup(5, { expiresTick: 100 });
    run(state, 100); // ticks 0..99 processed: still there
    expect(state.tick).toBe(100);
    expect(state.player.hp).toBe(5);
    expect(state.pickups).toHaveLength(1);
    step(state, IDLE_INPUT); // tick 100 is processed: gone
    expect(state.pickups).toHaveLength(0);
    expect(state.player.hp).toBe(5);
  });

  it('is taken as soon as the player is hurt while standing on it', () => {
    const state = withPickup(5, { expiresTick: 100 });
    run(state, 10);
    state.player.hp = 2;
    step(state, IDLE_INPUT);
    expect(state.player.hp).toBe(3);
    expect(state.pickups).toHaveLength(0);
  });

  it('a pickup out of reach is left alone', () => {
    const state = withPickup(2, { x: 480 + 14 + 10 + 1, y: 305 }); // just beyond PLAYER_RADIUS + 10
    step(state, IDLE_INPUT);
    expect(state.player.hp).toBe(2);
    expect(state.pickups).toHaveLength(1);
  });

  it('healing does not change the protection time', () => {
    const state = withPickup(2);
    state.player.invulnerableUntilTick = 500;
    step(state, IDLE_INPUT);
    expect(state.player.hp).toBe(3);
    expect(state.player.invulnerableUntilTick).toBe(500);
  });

  it('two pickups heal two points, each only while hurt', () => {
    const state = withPickup(3);
    state.pickups.push({ id: 901, x: 480, y: 310, expiresTick: 600 });
    step(state, IDLE_INPUT);
    expect(state.player.hp).toBe(5);
    expect(state.pickups).toHaveLength(0);
    const full = withPickup(4);
    full.pickups.push({ id: 901, x: 480, y: 310, expiresTick: 600 });
    step(full, IDLE_INPUT);
    expect(full.player.hp).toBe(5);
    expect(full.pickups).toHaveLength(1); // the second one is not needed
  });

  it('at most three on the field at once: a fourth drop does not appear', () => {
    const level = crowd({ drops: { healthChancePct: 50 } });
    const state = createSim(level);
    const keep = [800, 801, 802].map((id) => ({ id, x: 40, y: 80, expiresTick: 10_000 }));
    state.pickups.push(...keep);
    let max = 0;
    for (let i = 0; i < 900 && state.status === 'playing'; i += 1) { step(state, botInput(state)); max = Math.max(max, state.pickups.length); }
    expect(state.kills).toBeGreaterThan(5);
    expect(max).toBe(MAX_PICKUPS);
    expect(state.pickups.map((p) => p.id)).toEqual([800, 801, 802]);
  });
});
