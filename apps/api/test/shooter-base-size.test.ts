import { describe, expect, it } from 'vitest';
import {
  BASE_CLEARANCE, BASE_MAX_SIZE, BASE_SIZE, ENEMY_TYPES, PLAYER_RADIUS, SHOOTER_LEVELS, ShooterLevelSchema, baseRectOf, baseSizeOf, botInput, createCasualBot, createSim,
  playLevel, pointRectDistance, snapshotHash, step, msToTicks, BASE_TUNING, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, fireAt, place, quietLevel, run } from './shooter-4b-helpers.js';

const problems = (level: unknown) => {
  const result = ShooterLevelSchema.safeParse(level);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};
/** A quiet field with a base of the given side in the middle (480, 305), the player on its left a little way from its edge. */
const withSize = (size: number | undefined, patch: Partial<ShooterLevel> = {}, hp = 100): ShooterLevel => quietLevel({
  player: { x: Math.round(480 - (size ?? BASE_SIZE) / 2 - 44), y: 305, speed: 210, hp: 10 }, spawnPoints: [{ x: 880, y: 305 }], obstacles: [], waves: [{ atMs: 200_000, type: 'swarmer', count: 1 }],
  base: { x: 480, y: 305, hp, ...(size === undefined ? {} : { size }) }, ...patch,
});
const brute = (state: ShooterState, x: number, y: number, id: number) => { place(state, 'brute', x, y, id); state.enemies.find((e) => e.id === id)!.aimAtBase = true; };

describe('the size of a base', () => {
  it('is 56 when the base has none, and the square follows it', () => {
    expect(BASE_SIZE).toBe(56);
    expect(baseSizeOf({})).toBe(56);
    expect(baseSizeOf({ size: 80 })).toBe(80);
    expect(baseRectOf({ x: 480, y: 305 })).toEqual({ x: 480, y: 305, width: 56, height: 56 });
    expect(baseRectOf({ x: 480, y: 305, size: 80 })).toEqual({ x: 480, y: 305, width: 80, height: 80 });
    expect(baseRectOf({ x: 100, y: 200, size: 120 })).toEqual({ x: 100, y: 200, width: 120, height: 120 });
    expect(BASE_MAX_SIZE).toBe(120);
  });

  it('is a whole number from 56 to 120 in the level, and the base takes nothing else', () => {
    for (const size of [56, 57, 80, 100, 120]) expect(problems(withSize(size)), String(size)).toEqual([]);
    for (const size of [55, 0, 121, 200, 80.5, -80]) expect(problems(withSize(size)).join('|'), String(size)).toContain('base.size');
    expect(problems(withSize(undefined))).toEqual([]);
    expect(problems({ ...withSize(80), base: { x: 480, y: 305, hp: 50, size: 80, color: 'red' } }).length).toBeGreaterThan(0);
  });

  for (const size of [56, 80, 120]) {
    describe(`a base of ${size}`, () => {
      const half = size / 2;
      it('keeps away from the edge of the field, by the edge of its square', () => {
        expect(problems(withSize(size, { base: { x: 480, y: 305, hp: 50, size } }))).toEqual([]);
        // the square must stay EDGE_MARGIN inside the field: a base whose edge is on the left border is refused
        expect(problems(withSize(size, { base: { x: half, y: 305, hp: 50, size }, player: { x: 480, y: 305, speed: 210, hp: 10 } })).join('|')).toContain('base:');
        expect(problems(withSize(size, { base: { x: 960 - half, y: 305, hp: 50, size }, player: { x: 480, y: 305, speed: 210, hp: 10 } })).join('|')).toContain('base:');
        expect(problems(withSize(size, { base: { x: 480, y: 540 - half, hp: 50, size } })).join('|')).toContain('base:');
        expect(problems(withSize(size, { base: { x: 480, y: 70 + half, hp: 50, size }, player: { x: 480, y: 400, speed: 210, hp: 10 } })).join('|')).toContain('base:');
      });

      it('keeps obstacles at least BASE_CLEARANCE from its square, whatever its size', () => {
        const block = (gap: number) => ({ x: 480 + half + gap + 30, y: 305, width: 60, height: 60 });
        expect(problems(withSize(size, { obstacles: [block(BASE_CLEARANCE)] })), 'at the clearance').toEqual([]);
        expect(problems(withSize(size, { obstacles: [block(BASE_CLEARANCE - 2)] })).join('|'), 'just inside it').toContain('Vật cản nằm quá gần căn cứ');
        // (a corner gap is measured corner to corner)
        const corner = { x: 480 + half + 20 + 30, y: 305 + half + 20 + 30, width: 60, height: 60 };
        expect(problems(withSize(size, { obstacles: [corner] }))).toContain('obstacles.0: Vật cản nằm quá gần căn cứ.');
      });

      it('keeps the player and the spawn points away from its square, and far from its center', () => {
        expect(problems(withSize(size, { player: { x: 480 - half - 10, y: 305, speed: 210, hp: 10 } })).join('|')).toContain('player');
        expect(problems(withSize(size, { player: { x: 480, y: 305, speed: 210, hp: 10 } })).join('|')).toContain('player');
        expect(problems(withSize(size, { spawnPoints: [{ x: 480 + half + 12, y: 305 }] })).join('|')).toContain('spawnPoints.0');
        expect(problems(withSize(size, { spawnPoints: [{ x: 480 + 150, y: 305 }] })).join('|')).toContain('spawnPoints.0'); // nearer to its center than SPAWN_SAFE_DISTANCE
        expect(problems(withSize(size, { spawnPoints: [{ x: 880, y: 305 }] }))).toEqual([]);
      });
    });
  }
});

describe('a base of 80 in the simulation', () => {
  const level = () => withSize(80, { player: { x: 300, y: 305, speed: 210, hp: 10 } });

  it('is a wall of its own size: the state, the walls and the hit shape all say 80', () => {
    const state = createSim(level());
    expect(state.baseRect).toEqual({ x: 480, y: 305, width: 80, height: 80 });
    expect(state.walls[state.walls.length - 1]).toEqual({ x: 480, y: 305, width: 80, height: 80 });
    expect(state.base).toMatchObject({ x: 480, y: 305, hp: 100, maxHp: 100 });
  });

  it('stops the player at its edge, and the player slides along it', () => {
    const state = createSim(level());
    state.player.invulnerableUntilTick = 1e9;
    run(state, 200, { moveX: 1, moveY: 0, aimX: 960, aimY: 305, fire: false });
    expect(state.player.x).toBeLessThanOrEqual(480 - 40 - PLAYER_RADIUS + 0.001);
    expect(state.player.x).toBeGreaterThan(480 - 40 - PLAYER_RADIUS - 4);
  });

  it('stops a bullet at its edge: the enemy behind it is not hit', () => {
    const state = createSim(withSize(80, { player: { x: 360, y: 305, speed: 210, hp: 10 } }));
    place(state, 'brute', 640, 305, 700);
    run(state, 90, fireAt(640, 305));
    expect(state.enemies.find((e) => e.id === 700)!.hp).toBe(ENEMY_TYPES.brute.hp);
  });

  it('brings an enemy that goes for it to the edge of its square, touching and never inside', () => {
    const state = createSim(level());
    state.player.x = 40; state.player.y = 500; state.player.invulnerableUntilTick = 1e9;
    brute(state, 800, 305, 701);
    run(state, 600);
    const enemy = state.enemies.find((e) => e.id === 701)!;
    const gap = pointRectDistance(enemy.x, enemy.y, state.baseRect!);
    expect(gap).toBeGreaterThanOrEqual(ENEMY_TYPES.brute.radius - 0.001); // not into the wall
    expect(gap).toBeLessThanOrEqual(ENEMY_TYPES.brute.radius + 1 + 0.001); // touching it
    expect(enemy.x).toBeGreaterThan(480 + 40); // on the right side, outside the square (its half side is 40)
    expect(state.base!.hp).toBeLessThan(100); // and hurting it
  });

  it('is hurt by every enemy that touches it, added up, once each interval', () => {
    const state = createSim(level());
    state.player.x = 40; state.player.y = 500; state.player.invulnerableUntilTick = 1e9;
    const reach = 40 + ENEMY_TYPES.brute.radius + 1;
    brute(state, 480 + reach, 305, 801); brute(state, 480 - reach, 305, 802); brute(state, 480, 305 - reach, 803);
    const seen: number[] = [];
    let hp = 100;
    for (let i = 0; i < 4 * msToTicks(BASE_TUNING.hitIntervalMs); i += 1) {
      step(state, IDLE_INPUT);
      if (state.base!.hp !== hp) { seen.push(hp - state.base!.hp); hp = state.base!.hp; }
    }
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const damage of seen) expect(damage).toBe(3 * ENEMY_TYPES.brute.damage);
  });

  it('has the same hit shape as a base of 56 when its square is the same: nothing in the rules depends on the size but the square', () => {
    const a = createSim(withSize(56));
    const b = createSim(withSize(undefined)); // no size at all: 56
    for (let i = 0; i < 400; i += 1) { step(a, { ...IDLE_INPUT, fire: i % 3 === 0 }); step(b, { ...IDLE_INPUT, fire: i % 3 === 0 }); }
    expect(snapshotHash(a)).toBe(snapshotHash(b));
  });
});

describe('a base without a size plays as before', () => {
  it('a level with size 56 written out plays exactly like the same level without it (bots, 3 levels)', () => {
    for (const name of ['base-siege', 'base-boss', 'base-fall'] as const) {
      const without = structuredClone(SHOOTER_LEVELS[name]);
      const explicit: ShooterLevel = { ...structuredClone(without), base: { ...without.base!, size: 56 } };
      for (const make of [() => botInput, (level: ShooterLevel) => createCasualBot(level.seed)] as const) {
        const a = playLevel(without, make(without));
        const b = playLevel(explicit, make(explicit));
        expect({ tick: a.state.tick, status: a.status, kills: a.kills, hp: a.hp, base: a.state.base?.hp, hash: snapshotHash(a.state) }, name).toEqual({ tick: b.state.tick, status: b.status, kills: b.kills, hp: b.hp, base: b.state.base?.hp, hash: snapshotHash(b.state) });
      }
    }
  });

  it('the older hand-made base levels are untouched: no size in them; the two new ones have 80', () => {
    for (const name of ['base-siege', 'base-boss', 'base-fall'] as const) expect('size' in SHOOTER_LEVELS[name].base!, name).toBe(false);
    for (const name of ['base-siege-big', 'base-boss-big'] as const) expect(SHOOTER_LEVELS[name].base!.size, name).toBe(80);
    for (const name of ['base-siege-big', 'base-boss-big'] as const) expect(problems(SHOOTER_LEVELS[name]), name).toEqual([]);
  });

  it('the two big levels can be won (by the expert bot on most seeds) and can be lost both ways', () => {
    let wins = 0;
    for (const name of ['base-siege-big', 'base-boss-big'] as const) {
      for (let k = 0; k < 6; k += 1) {
        const level = { ...structuredClone(SHOOTER_LEVELS[name]), seed: SHOOTER_LEVELS[name].seed + k * 101 };
        if (playLevel(level, botInput).status === 'won') wins += 1;
      }
    }
    expect(wins).toBeGreaterThanOrEqual(8); // of 12
    const idle = createSim(structuredClone(SHOOTER_LEVELS['base-siege-big']));
    run(idle, 60 * 120);
    expect(idle.status).toBe('lost');
  });
});
