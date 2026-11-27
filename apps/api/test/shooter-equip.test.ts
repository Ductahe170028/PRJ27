import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EQUIP_MS, SHOOTER_LEVELS, ShooterLevelSchema, botInput, createCasualBot, createSim, isSlot, msToTicks, playLevel, snapshotHash, step,
  type ShooterInput, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, place, quietLevel, run } from './shooter-4b-helpers.js';

const ARSENAL = SHOOTER_LEVELS.arsenal.arsenal!;
const SLOT = { pistol: 0, shotgun: 1, piercing: 2, rapid: 3, heavy: 4 } as const;
const EQUIP_TICKS = msToTicks(EQUIP_MS);
const weaponOf = (name: keyof typeof SLOT) => ARSENAL[SLOT[name]]!.weapon;

/** A quiet field with the five weapons, starting with `start`. */
const armed = (start: keyof typeof SLOT = 'pistol', patch: Partial<ShooterLevel> = {}): ShooterLevel => quietLevel({ weapon: weaponOf(start), arsenal: structuredClone(ARSENAL), ...patch });
const input = (patch: Partial<ShooterInput> = {}): ShooterInput => ({ ...IDLE_INPUT, ...patch });
const FIRE: ShooterInput = input({ fire: true });

describe('switching weapons (step 3b)', () => {
  it('starts with the weapon of the level, in the slot that holds it, and not switching', () => {
    for (const start of Object.keys(SLOT) as Array<keyof typeof SLOT>) {
      const state = createSim(armed(start));
      expect(state.weaponSlot).toBe(SLOT[start]);
      expect(state.equipUntilTick).toBe(0);
    }
  });

  it('puts the weapon of the asked slot in hand, at once, and busies the player for 300 ms', () => {
    const state = createSim(armed());
    expect(EQUIP_TICKS).toBe(18);
    step(state, input({ slot: SLOT.shotgun }));
    expect(state.weaponSlot).toBe(SLOT.shotgun);
    expect(state.equipUntilTick).toBe(0 + EQUIP_TICKS);
  });

  it('does nothing when the slot asked for is the one in hand', () => {
    const state = createSim(armed('rapid'));
    step(state, input({ slot: SLOT.rapid }));
    expect(state.equipUntilTick).toBe(0);
    step(state, input({ slot: SLOT.rapid }));
    expect(state.weaponSlot).toBe(SLOT.rapid);
  });

  it('fires with the new weapon: the pellets, the speed and the damage of the NEXT shot are the new weapon\'s', () => {
    for (const name of ['shotgun', 'piercing', 'rapid', 'heavy'] as const) {
      const state = createSim(armed());
      step(state, input({ slot: SLOT[name] }));
      run(state, EQUIP_TICKS + 2, FIRE); // the switch is over, then one shot
      const weapon = weaponOf(name);
      expect(state.bullets.length, name).toBeGreaterThanOrEqual(weapon.pellets ?? 1);
      const bullet = state.bullets[0]!;
      expect(Math.round(Math.hypot(bullet.vx, bullet.vy)), name).toBe(weapon.bulletSpeed);
      expect(bullet.damage, name).toBe(weapon.damage);
      expect(bullet.range, name).toBe(weapon.range);
      expect(bullet.pierceLeft, name).toBe(weapon.pierce);
    }
  });

  it('cannot fire for 300 ms after a switch, to the very tick, and fires on the first tick after', () => {
    const state = createSim(armed());
    let first: number | undefined;
    for (let tick = 0; tick < 40; tick += 1) {
      step(state, input({ fire: true, ...(tick === 0 ? { slot: SLOT.rapid } : {}) }));
      if (first === undefined && state.bullets.length > 0) first = tick;
    }
    // the switch was asked on tick 0 (equipUntilTick = 18): the first bullet exists after the step of tick 18, never before
    expect(first).toBe(EQUIP_TICKS);
  });

  it('shows no bullet at all while switching, even with the trigger held', () => {
    const state = createSim(armed());
    step(state, input({ fire: true, slot: SLOT.heavy }));
    for (let i = 1; i < EQUIP_TICKS; i += 1) { step(state, FIRE); expect(state.bullets.length, `tick ${i}`).toBe(0); }
    step(state, FIRE);
    expect(state.bullets.length).toBe(1);
  });

  it('shares ONE shot clock: firing the heavy and switching to the rapid still waits for the heavy\'s cooldown', () => {
    const state = createSim(armed('heavy'));
    step(state, FIRE); // tick 0: the heavy fires
    expect(state.bullets).toHaveLength(1);
    const heavyReady = state.player.nextShotTick;
    expect(heavyReady).toBe(msToTicks(weaponOf('heavy').cooldownMs));
    step(state, input({ fire: true, slot: SLOT.rapid })); // tick 1: switch to the rapid, whose own cooldown is 150 ms
    let firstShot: number | undefined;
    const ids = new Set<number>();
    for (let tick = 2; tick < 80 && firstShot === undefined; tick += 1) {
      step(state, FIRE);
      for (const b of state.bullets) if (b.damage === weaponOf('rapid').damage && !ids.has(b.id)) { ids.add(b.id); firstShot ??= tick; }
    }
    expect(firstShot).toBe(heavyReady); // not at tick 19 (the end of the switch), nor 1 + 9 (the rapid's cooldown)
  });

  it('does not let a switch reset the shot clock: switching back and forth never gives MORE shots than the pistol alone', () => {
    const level = armed('pistol');
    const plain = createSim(level);
    const juggler = createSim(level);
    const shots = (state: ShooterState, last: { clock: number; count: number }) => {
      if (state.player.nextShotTick !== last.clock) { last.count += 1; last.clock = state.player.nextShotTick; }
    };
    const a = { clock: 0, count: 0 };
    const b = { clock: 0, count: 0 };
    for (let tick = 0; tick < 300; tick += 1) {
      step(plain, FIRE);
      step(juggler, input({ fire: true, ...(tick % 40 === 0 ? { slot: SLOT.rapid } : tick % 40 === 20 ? { slot: SLOT.pistol } : {}) }));
      shots(plain, a);
      shots(juggler, b);
    }
    // the juggler holds the rapid (150 ms) for 20 ticks of every 40, but loses 18 ticks to each switch: the shot clock is shared and
    // no switch resets it, so it never out-shoots the pistol by more than the rapid's faster cooldown allows in its 2 ticks of grace
    expect(a.count).toBeGreaterThan(10);
    expect(b.count).toBeLessThanOrEqual(a.count);
  });

  it('keeps the damage and range of the weapon that fired a bullet, even after the player has switched', () => {
    const level = armed('heavy');
    const state = createSim(level);
    place(state, 'brute', 480 + 240, 305, 900);
    step(state, FIRE); // a heavy bullet leaves (damage 3)
    step(state, input({ slot: SLOT.pistol })); // the pistol (damage 1) is in hand while it flies
    expect(state.bullets[0]!.damage).toBe(3);
    run(state, 60);
    const brute = state.enemies.find((e) => e.id === 900);
    // the heavy bullet took 3 hit points off the brute, not the pistol's 1 (the brute is far, so nothing else touched it)
    expect(brute?.hp).toBe(12 - 3);
  });

  it('a pistol bullet flies on to the pistol\'s range even if the heavy (range 700) is in hand, and vice versa', () => {
    const state = createSim(armed('pistol'));
    step(state, FIRE);
    step(state, input({ slot: SLOT.heavy }));
    run(state, 90);
    expect(state.bullets).toHaveLength(0); // gone at 600 px
    const other = createSim(armed('heavy'));
    step(other, FIRE);
    step(other, input({ slot: SLOT.pistol }));
    for (let i = 0; i < 40; i += 1) step(other, IDLE_INPUT);
    expect(other.bullets.length === 0 || other.bullets[0]!.range === 700).toBe(true);
  });
});

describe('a slot that is not a slot', () => {
  const junk: unknown[] = [-1, 5, 6, 1.5, NaN, Infinity, -Infinity, '2', '', null, true, {}, [], 2 ** 31, -0.1];

  it('is ignored: nothing changes, nothing throws', () => {
    for (const slot of junk) {
      const state = createSim(armed('rapid'));
      const hash = snapshotHash(state);
      expect(() => step(state, input({ slot: slot as number })), String(slot)).not.toThrow();
      expect(state.weaponSlot, String(slot)).toBe(SLOT.rapid);
      expect(state.equipUntilTick, String(slot)).toBe(0);
      expect(hash).not.toBe(''); // the step moved the clock, the weapon did not change
    }
  });

  it('knows a slot when it sees one', () => {
    for (const ok of [0, 1, 2, 3, 4]) expect(isSlot(ok, 5)).toBe(true);
    for (const bad of junk) expect(isSlot(bad, 5), String(bad)).toBe(false);
    expect(isSlot(2, 2)).toBe(false);
    expect(isSlot(1, 2)).toBe(true);
  });

  it('is ignored in a level without an arsenal, which keeps no weapon fields at all', () => {
    const level = quietLevel();
    const withSlots = createSim(level);
    const without = createSim(level);
    for (let tick = 0; tick < 120; tick += 1) {
      step(withSlots, input({ fire: tick % 3 === 0, slot: tick % 5 }));
      step(without, input({ fire: tick % 3 === 0 }));
    }
    expect(snapshotHash(withSlots)).toBe(snapshotHash(without));
    expect('weaponSlot' in withSlots).toBe(false);
    expect('equipUntilTick' in withSlots).toBe(false);
    expect(withSlots.bullets.every((b) => b.damage === undefined && b.range === undefined)).toBe(true);
  });
});

describe('determinism and the bots', () => {
  const script = (tick: number): ShooterInput => input({
    fire: tick % 4 !== 0, aimX: 480 + 200 * (tick % 7 < 4 ? 1 : -1), aimY: 305 + (tick % 11) * 10,
    ...(tick % 53 === 7 ? { slot: (tick / 53 | 0) % 5 } : tick % 97 === 3 ? { slot: -1 } : {}),
  });

  it('the same inputs always give the same state, hash after hash', () => {
    const trace = (): string[] => {
      const state = createSim(structuredClone(SHOOTER_LEVELS.arsenal));
      const hashes: string[] = [];
      for (let tick = 0; tick < 1500 && state.status === 'playing'; tick += 1) { step(state, script(tick)); if (tick % 30 === 0) hashes.push(snapshotHash(state)); }
      return hashes;
    };
    expect(trace()).toEqual(trace());
    expect(trace().length).toBeGreaterThan(10);
  });

  it('the hash knows which weapon is in hand', () => {
    const a = createSim(armed());
    const b = createSim(armed());
    step(a, input({ slot: SLOT.heavy }));
    step(b, IDLE_INPUT);
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });

  it('bots never send a slot, so a level with an arsenal plays exactly like the same level without it (the bots, and the numbers)', () => {
    const names = ['arsenal', 'arena', 'pillars', 'base-siege'] as const;
    for (const name of names) {
      const base = structuredClone(SHOOTER_LEVELS[name]);
      const withArsenal: ShooterLevel = { ...base, arsenal: structuredClone(ARSENAL), weapon: weaponOf('pistol') };
      const { arsenal: _drop, ...bare } = withArsenal;
      const plain: ShooterLevel = { ...bare, weapon: weaponOf('pistol') };
      expect(ShooterLevelSchema.safeParse(withArsenal).success, name).toBe(true);
      const policies: Array<[string, (level: ShooterLevel) => (state: ShooterState) => ShooterInput]> = [
        ['expert', () => botInput], ['casual', (level) => createCasualBot(level.seed)],
      ];
      for (const [label, make] of policies) {
        const a = playLevel(withArsenal, make(withArsenal));
        const b = playLevel(plain, make(plain));
        const summary = (r: typeof a) => ({ tick: r.state.tick, kills: r.kills, score: r.state.score, status: r.status, hp: r.hp, x: r.state.player.x, y: r.state.player.y, bullets: r.state.bullets.length, enemies: r.state.enemies.length });
        expect(summary(a), `${name} ${label}`).toEqual(summary(b));
      }
    }
  });
});

describe('the arsenal in a level', () => {
  const level = (patch: Record<string, unknown> = {}) => ({ ...structuredClone(SHOOTER_LEVELS.arsenal), ...patch });
  const problems = (value: unknown) => {
    const result = ShooterLevelSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  };

  it('accepts the hand-made level, and a level with none', () => {
    expect(problems(SHOOTER_LEVELS.arsenal)).toEqual([]);
    const { arsenal: _drop, ...none } = structuredClone(SHOOTER_LEVELS.arsenal);
    expect(problems(none)).toEqual([]);
  });

  it('refuses a level whose starting weapon is not in the arsenal, field by field', () => {
    expect(problems(level({ weapon: { cooldownMs: 301, bulletSpeed: 600, damage: 1, range: 600 } })).join(' ')).toContain('weapon');
    // a missing field is a missing field: the shotgun with no spread is not the shotgun
    const shotgun = { cooldownMs: 1000, bulletSpeed: 650, damage: 1, range: 320, pellets: 6 };
    expect(problems(level({ weapon: shotgun })).join(' ')).toContain('weapon');
    expect(problems(level({ weapon: { ...shotgun, spreadDeg: 36 } }))).toEqual([]);
    expect(problems(level({ weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600, pierce: 1 } })).join(' ')).toContain('weapon');
  });

  it('refuses a duplicate id, one entry, six entries, and an id that is not a slug', () => {
    const arsenal = structuredClone(ARSENAL);
    expect(problems(level({ arsenal: arsenal.map((e, i) => (i === 1 ? { ...e, id: 'pistol' } : e)) })).join(' ')).toContain('arsenal');
    expect(problems(level({ arsenal: arsenal.slice(0, 1) })).length).toBeGreaterThan(0);
    expect(problems(level({ arsenal: arsenal.slice(0, 2) }))).toEqual([]);
    expect(problems(level({ arsenal: [...arsenal, { id: 'sixth', weapon: arsenal[0]!.weapon }] })).length).toBeGreaterThan(0);
    for (const id of ['Pistol', 'a b', '', 'x'.repeat(31)]) expect(problems(level({ arsenal: arsenal.map((e, i) => (i === 0 ? { ...e, id } : e)) })).length, id).toBeGreaterThan(0);
    expect(problems(level({ arsenal: arsenal.map((e, i) => (i === 0 ? { ...e, extra: 1 } : e)) })).length).toBeGreaterThan(0);
  });

  it('checks every weapon of the arsenal as strictly as the level\'s own weapon', () => {
    const arsenal = structuredClone(ARSENAL);
    arsenal[1] = { id: 'shotgun', weapon: { ...arsenal[1]!.weapon, damage: 9 } };
    expect(problems(level({ arsenal })).length).toBeGreaterThan(0);
  });
});

describe('the new core code is as pure as the rest', () => {
  it('uses no Math.random, no state.rng, no clock, no Math.hypot and no ** in equip.ts', () => {
    const text = readFileSync(new URL('../../../packages/contracts/src/shooter/equip.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of ['Math.random', '.rng', 'Date.now', 'performance.now', 'Math.hypot', '**']) expect(text.includes(forbidden), forbidden).toBe(false);
  });
});
