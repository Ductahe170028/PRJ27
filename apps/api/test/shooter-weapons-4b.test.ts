import { describe, expect, it } from 'vitest';
import {
  MAX_BULLETS, ShooterLevelSchema, botInput, createSim, playLevel, snapshotHash, step, tanSmall, RADIANS_PER_DEGREE,
  type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { fireAt, newState, place, quietLevel, run, weaponOf } from './shooter-4b-helpers.js';

// Test code may use any math (only the shooter core is limited to + - * / and square roots).
const degrees = (radians: number) => (radians * 180) / Math.PI;
const angleOf = (b: { vx: number; vy: number }) => degrees(Math.atan2(b.vy, b.vx));
const speedOf = (b: { vx: number; vy: number }) => Math.sqrt(b.vx * b.vx + b.vy * b.vy);

const shotgun = weaponOf({ cooldownMs: 800, bulletSpeed: 650, range: 320, pellets: 6, spreadDeg: 36 });

describe('the schema takes the new weapon fields, and only inside their limits', () => {
  it('pellets 1..9, spreadDeg 0..60, pierce 1..5, all optional, strict', () => {
    const ok = (weapon: ShooterLevel['weapon']) => ShooterLevelSchema.safeParse(quietLevel({ weapon, waves: [{ atMs: 1000, type: 'swarmer', count: 1 }] })).success;
    expect(ok(weaponOf({}))).toBe(true);
    expect(ok(shotgun)).toBe(true);
    expect(ok(weaponOf({ pierce: 3 }))).toBe(true);
    expect(ok(weaponOf({ pellets: 1, spreadDeg: 0, pierce: 1 }))).toBe(true);
    expect(ok(weaponOf({ pellets: 9, spreadDeg: 60, pierce: 5 }))).toBe(true);
    for (const bad of [{ pellets: 0 }, { pellets: 10 }, { spreadDeg: 61 }, { spreadDeg: -1 }, { pierce: 0 }, { pierce: 6 }, { pellets: 2.5 }]) {
      expect(ok(weaponOf(bad)), JSON.stringify(bad)).toBe(false);
    }
    expect(ShooterLevelSchema.safeParse(quietLevel({ weapon: { ...weaponOf({}), extra: 1 } as never, waves: [{ atMs: 1000, type: 'swarmer', count: 1 }] })).success).toBe(false);
  });
});

describe('tanSmall, shared by the casual bot\'s aim and the pellet fan', () => {
  it('is within 0.0001 of Math.tan up to 30 degrees, both signs', () => {
    for (const deg of [0, 5, 10, 12, 18, 20, 25, 30]) {
      for (const sign of [1, -1]) {
        const x = sign * deg * RADIANS_PER_DEGREE;
        expect(Math.abs(tanSmall(x) - Math.tan(x)), `${sign * deg} deg`).toBeLessThanOrEqual(0.0001);
      }
    }
    expect(tanSmall(0)).toBe(0);
  });
});

describe('a shot of pellets', () => {
  it('pellets absent, 1 or with a spread: one bullet exactly along the aim, id 1, the very same game as before', () => {
    const plain = newState(quietLevel({ weapon: weaponOf({}) }));
    step(plain, fireAt(960, 305));
    expect(plain.bullets).toHaveLength(1);
    expect(plain.bullets[0]).toMatchObject({ id: 1, vx: 600, vy: 0 });
    expect('pierceLeft' in plain.bullets[0]!).toBe(false);
    expect('hitIds' in plain.bullets[0]!).toBe(false);
    for (const weapon of [weaponOf({ pellets: 1 }), weaponOf({ pellets: 1, spreadDeg: 40 }), weaponOf({ spreadDeg: 40 })]) {
      const other = newState(quietLevel({ weapon }));
      run(other, 120, fireAt(960, 305));
      const reference = newState(quietLevel({ weapon: weaponOf({}) }));
      run(reference, 120, fireAt(960, 305));
      expect(snapshotHash(other)).toBe(snapshotHash(reference));
    }
  });

  it('six pellets over 36 degrees: six bullets, outermost at +-18 degrees (0.3 allowed), mirrored around the aim, ids in order', () => {
    const state = newState(quietLevel({ weapon: shotgun }));
    step(state, fireAt(960, 305)); // aim along +x
    expect(state.bullets).toHaveLength(6);
    expect(state.bullets.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.nextId).toBe(7);
    const angles = state.bullets.map(angleOf);
    expect(Math.abs(angles[0]! + 18)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(angles[5]! - 18)).toBeLessThanOrEqual(0.3);
    for (let k = 0; k < 3; k += 1) expect(angles[k]! + angles[5 - k]!).toBeCloseTo(0, 6);
    for (let k = 1; k < 6; k += 1) expect(angles[k]!).toBeGreaterThan(angles[k - 1]!);
    for (const bullet of state.bullets) expect(speedOf(bullet)).toBeCloseTo(650, 6);
    expect(state.player.nextShotTick).toBe(48); // 800 ms
  });

  it('an odd number of pellets sends the middle one straight; the fan turns with the aim', () => {
    const five = newState(quietLevel({ weapon: weaponOf({ pellets: 5, spreadDeg: 30 }) }));
    step(five, fireAt(960, 305));
    expect(angleOf(five.bullets[2]!)).toBe(0);
    expect(five.bullets[2]!.vy).toBe(0);
    // aim straight down-right (45 degrees): the fan is centered on it
    const diagonal = newState(quietLevel({ weapon: shotgun }));
    step(diagonal, fireAt(480 + 200, 305 + 200));
    const angles = diagonal.bullets.map(angleOf);
    expect(Math.abs(angles[0]! - (45 - 18))).toBeLessThanOrEqual(0.3);
    expect(Math.abs(angles[5]! - (45 + 18))).toBeLessThanOrEqual(0.3);
  });

  it('spreadDeg 0 with several pellets: they all fly along the same line', () => {
    const state = newState(quietLevel({ weapon: weaponOf({ pellets: 4, spreadDeg: 0 }) }));
    step(state, fireAt(960, 305));
    expect(new Set(state.bullets.map((b) => `${b.vx},${b.vy}`)).size).toBe(1);
  });

  it('an enemy right in front takes several pellets, one beyond the range takes none', () => {
    const near = newState(quietLevel({ weapon: weaponOf({ pellets: 6, spreadDeg: 36, range: 320, cooldownMs: 800, bulletSpeed: 650 }) }));
    place(near, 'brute', 540, 305, 50);
    near.enemies[0]!.hp = 100; // it must survive so that the damage can be counted
    run(near, 1, fireAt(960, 305));
    run(near, 30, { moveX: 0, moveY: 0, aimX: 960, aimY: 305, fire: false });
    const lost = 100 - near.enemies[0]!.hp;
    expect(lost).toBeGreaterThanOrEqual(3); // the middle pellets all hit a 20 px body 60 px away
    expect(lost).toBeLessThanOrEqual(6);
    const far = newState(quietLevel({ weapon: weaponOf({ pellets: 6, spreadDeg: 36, range: 320, cooldownMs: 800, bulletSpeed: 650 }) }));
    place(far, 'brute', 880, 305, 50); // 400 px away, beyond the 320 px range
    run(far, 1, fireAt(960, 305));
    run(far, 90, { moveX: 0, moveY: 0, aimX: 960, aimY: 305, fire: false });
    expect(far.enemies[0]!.hp).toBe(12);
    expect(far.bullets).toHaveLength(0);
  });

  it('is refused when there is no room for all the pellets, and goes ahead when there is', () => {
    const filled = (n: number): ShooterState => {
      const state = newState(quietLevel({ weapon: shotgun }));
      for (let i = 0; i < n; i += 1) state.bullets.push({ id: 5000 + i, x: 100, y: 100, vx: 0, vy: 0, travelled: 0 });
      return state;
    };
    const refused = filled(MAX_BULLETS - 5);
    step(refused, fireAt(960, 305));
    expect(refused.bullets).toHaveLength(MAX_BULLETS - 5);
    expect(refused.player.nextShotTick).toBe(0); // nothing was fired, so the weapon is still ready
    const allowed = filled(MAX_BULLETS - 6);
    step(allowed, fireAt(960, 305));
    expect(allowed.bullets).toHaveLength(MAX_BULLETS);
  });
});

describe('a piercing bullet', () => {
  const piercing = (pierce: number | undefined) => weaponOf({ bulletSpeed: 300, damage: 2, range: 800, cooldownMs: 500, ...(pierce === undefined ? {} : { pierce }) });
  const lineUp = (pierce: number | undefined, extra: Partial<ShooterLevel> = {}) => {
    const state = newState(quietLevel({ weapon: piercing(pierce), ...extra }));
    for (const [index, x] of [580, 640, 700].entries()) place(state, 'brute', x, 305, 10 + index); // three brutes in a row, 60 px apart
    return state;
  };
  const hpOf = (state: ShooterState) => state.enemies.map((e) => e.hp);
  const shootOnce = (state: ShooterState, ticks = 200) => {
    step(state, fireAt(960, 305));
    run(state, ticks, { moveX: 0, moveY: 0, aimX: 960, aimY: 305, fire: false });
  };

  it('pierce 3 hits all three exactly once each, even slowly through their bodies', () => {
    const state = lineUp(3);
    state.enemies.forEach((e) => { e.hp = 100; });
    shootOnce(state);
    expect(hpOf(state)).toEqual([98, 98, 98]);
    expect(state.bullets).toHaveLength(0); // spent after the third
  });

  it('the bullet carries what it needs, an ordinary one does not', () => {
    const state = newState(quietLevel({ weapon: piercing(3) }));
    step(state, fireAt(960, 305));
    expect(state.bullets[0]).toMatchObject({ pierceLeft: 3, hitIds: [] });
    const plain = newState(quietLevel({ weapon: piercing(undefined) }));
    step(plain, fireAt(960, 305));
    expect('pierceLeft' in plain.bullets[0]!).toBe(false);
  });

  it('pierce 2 stops after the second enemy', () => {
    const state = lineUp(2);
    state.enemies.forEach((e) => { e.hp = 100; });
    shootOnce(state);
    expect(hpOf(state)).toEqual([98, 98, 100]);
  });

  it('pierce absent or 1 behaves as before: only the first enemy, and the bullet is spent', () => {
    for (const pierce of [undefined, 1]) {
      const state = lineUp(pierce);
      state.enemies.forEach((e) => { e.hp = 100; });
      shootOnce(state);
      expect(hpOf(state), `pierce ${pierce}`).toEqual([98, 100, 100]);
    }
  });

  it('a wall between the enemies stops it (the wall at the same distance wins too)', () => {
    const state = lineUp(3, { obstacles: [{ x: 610, y: 305, width: 20, height: 120 }] });
    state.enemies.forEach((e) => { e.hp = 100; });
    shootOnce(state);
    expect(hpOf(state)).toEqual([98, 100, 100]);
  });

  it('kills count as usual, and the enemies behind the dead one are still reached', () => {
    const state = newState(quietLevel({ weapon: weaponOf({ bulletSpeed: 500, damage: 2, range: 800, pierce: 3 }) }));
    for (const [index, x] of [580, 640, 700].entries()) place(state, 'runner', x, 305, 10 + index); // runners have 2 hp
    shootOnce(state, 120);
    expect(state.kills).toBe(3);
    expect(state.score).toBe(6);
    expect(state.enemies).toHaveLength(0);
  });

  it('an enemy that stands still is never hit twice by the same bullet', () => {
    const state = newState(quietLevel({ weapon: weaponOf({ bulletSpeed: 300, damage: 1, range: 800, pierce: 5 }) }));
    place(state, 'brute', 600, 305, 10);
    state.enemies[0]!.hp = 100;
    state.enemies[0]!.x = 600;
    shootOnce(state, 150);
    expect(state.enemies[0]!.hp).toBe(99);
  });
});

describe('the new weapons are deterministic and keep the game running', () => {
  it('two runs of the same level give the same hash at every tick', () => {
    const level = quietLevel({
      weapon: shotgun, seed: 77, waves: [{ atMs: 500, type: 'swarmer', count: 20 }, { atMs: 3000, type: 'runner', count: 10 }],
      spawnPoints: [{ x: 700, y: 120 }, { x: 760, y: 500 }, { x: 60, y: 300 }],
    });
    const trace = () => {
      const state = createSim(level);
      const hashes: string[] = [];
      for (let i = 0; i < 600 && state.status === 'playing'; i += 1) { step(state, botInput(state)); hashes.push(snapshotHash(state)); }
      return hashes;
    };
    expect(trace()).toEqual(trace());
    const pierceLevel = { ...level, weapon: weaponOf({ pierce: 3, damage: 2, range: 800, cooldownMs: 500, bulletSpeed: 800 }) };
    expect(playLevel(pierceLevel, botInput).state.tick).toBe(playLevel(pierceLevel, botInput).state.tick);
    expect(snapshotHash(playLevel(pierceLevel, botInput).state)).toBe(snapshotHash(playLevel(pierceLevel, botInput).state));
  });
});
