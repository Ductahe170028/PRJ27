import { describe, expect, it } from 'vitest';
import {
  ENEMY_TYPES, MAX_ENEMIES_ALIVE, MAX_ENEMY_BULLETS, RING_12, SHOOTER_LEVELS, ShooterLevelSchema, bossOf, botInput, createCasualBot, createSim, isBoss, msToTicks, playLevel, snapshotHash, step,
  type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, fireAt, place, quietLevel, run, weaponOf } from './shooter-4b-helpers.js';

/** A game that starts at full health 1000 (the schema allows 10 at most, so a test makes its player sturdy afterwards). */
const newState = (level: ShooterLevel): ShooterState => { const state = createSim(level); state.player.hp = 1000; state.player.maxHp = 1000; return state; };

const degrees = (radians: number) => (radians * 180) / Math.PI;
const CRUSHER = ENEMY_TYPES.crusher;
const GUNNER = ENEMY_TYPES.gunner;

/** A quiet field with one boss due at `atMs`, coming out at the only spawn point (880, 305). */
const bossLevel = (type: 'crusher' | 'gunner', patch: Partial<ShooterLevel> = {}, atMs = 0): ShooterLevel => quietLevel({
  player: { x: 480, y: 305, speed: 210, hp: 10 }, spawnPoints: [{ x: 880, y: 305 }],
  waves: [{ atMs, type, count: 1 }], win: { type: 'boss' }, ...patch,
});
const boss = (state: ShooterState) => state.enemies.find((e) => isBoss(e.type))!;
const advance = (state: ShooterState, to: number, input = IDLE_INPUT) => { while (state.tick < to && state.status === 'playing') step(state, input); };

describe('the boss is data: two rows, found by function, never by name', () => {
  it('crusher and gunner have codes 5 and 6, the designed sizes and behavior, and the older kinds are not bosses', () => {
    // hit points and cycle times are TUNED (docs/shooter-calibration.md, Stage 4C): they are read from the table, not pinned here
    expect(CRUSHER).toMatchObject({ code: 5, radius: 34, speed: 60, damage: 2, points: 50 });
    expect(GUNNER).toMatchObject({ code: 6, radius: 30, speed: 55, damage: 1, points: 50 });
    expect(CRUSHER.boss.enrage).toEqual({ belowHpShare: 0.5, speedScale: 1.25, cooldownScale: 0.75 });
    expect(CRUSHER.boss.charge).toMatchObject({ telegraphMs: 800, durationMs: 600, speedScale: 3.2 });
    expect(CRUSHER.boss.charge.cycleMs).toBeGreaterThanOrEqual(3500);
    expect(CRUSHER.boss.charge.cycleMs).toBeLessThanOrEqual(6000);
    expect(GUNNER.boss.enrage).toEqual({ belowHpShare: 0.5, speedScale: 1, cooldownScale: 0.7 });
    expect(GUNNER.boss.holdRange).toBe(300);
    expect(GUNNER.boss.volleys.map((v) => [v.shape, v.count, v.spreadDeg])).toEqual([['fan', 3, 24], ['ring', 12, 360]]);
    expect(CRUSHER.hp).toBeGreaterThanOrEqual(40);
    expect(CRUSHER.hp).toBeLessThanOrEqual(110);
    expect(GUNNER.hp).toBeGreaterThanOrEqual(30);
    expect(GUNNER.hp).toBeLessThanOrEqual(90);
    for (const v of GUNNER.boss.volleys) { expect(v.bulletSpeed).toBeGreaterThanOrEqual(120); expect(v.bulletSpeed).toBeLessThanOrEqual(220); }
    expect(GUNNER.boss.volleys[0]!.cooldownMs).toBeGreaterThanOrEqual(1500);
    expect(GUNNER.boss.volleys[0]!.cooldownMs).toBeLessThanOrEqual(2600);
    expect(GUNNER.boss.volleys[1]!.cooldownMs).toBeGreaterThanOrEqual(4000);
    expect(GUNNER.boss.volleys[1]!.cooldownMs).toBeLessThanOrEqual(7000);
    for (const type of ['runner', 'brute', 'swarmer', 'spitter'] as const) expect(bossOf(type)).toBeUndefined();
    expect(isBoss('crusher') && isBoss('gunner')).toBe(true);
    expect(Object.values(ENEMY_TYPES).map((e) => e.code)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('the level schema and the boss', () => {
  const valid = (patch: Partial<ShooterLevel>) => ShooterLevelSchema.safeParse(bossLevel('crusher', patch)).success;
  it('a boss win needs exactly one boss wave of one boss', () => {
    expect(valid({})).toBe(true);
    expect(valid({ bossHp: 80 })).toBe(true);
    expect(valid({ waves: [{ atMs: 0, type: 'swarmer', count: 5 }] })).toBe(false); // no boss wave
    expect(valid({ waves: [{ atMs: 0, type: 'crusher', count: 1 }, { atMs: 5000, type: 'gunner', count: 1 }] })).toBe(false); // two boss waves
    expect(valid({ waves: [{ atMs: 0, type: 'crusher', count: 1 }, { atMs: 5000, type: 'crusher', count: 1 }] })).toBe(false);
    expect(valid({ waves: [{ atMs: 0, type: 'crusher', count: 2 }] })).toBe(false); // one boss, not two
    expect(valid({ waves: [{ atMs: 0, type: 'swarmer', count: 5 }, { atMs: 8000, type: 'gunner', count: 1 }] })).toBe(true);
  });
  it('bossHp is 10..400 and needs a boss', () => {
    for (const bossHp of [10, 70, 400]) expect(valid({ bossHp }), String(bossHp)).toBe(true);
    for (const bossHp of [9, 0, 401, 70.5]) expect(valid({ bossHp }), String(bossHp)).toBe(false);
    expect(ShooterLevelSchema.safeParse({ ...quietLevel({ waves: [{ atMs: 1000, type: 'swarmer', count: 1 }] }), bossHp: 50 }).success).toBe(false);
  });
  it('a boss may also be only a threat in a survive or kill level; at most one boss wave in any level', () => {
    expect(ShooterLevelSchema.safeParse(quietLevel({ waves: [{ atMs: 1000, type: 'gunner', count: 1 }, { atMs: 2000, type: 'swarmer', count: 3 }], win: { type: 'survive', seconds: 30 } })).success).toBe(true);
    expect(ShooterLevelSchema.safeParse(quietLevel({ waves: [{ atMs: 1000, type: 'gunner', count: 1 }, { atMs: 2000, type: 'swarmer', count: 3 }], win: { type: 'kill', count: 3 } })).success).toBe(true);
    expect(ShooterLevelSchema.safeParse(quietLevel({ waves: [{ atMs: 1000, type: 'gunner', count: 1 }, { atMs: 2000, type: 'crusher', count: 1 }], win: { type: 'survive', seconds: 30 } })).success).toBe(false);
  });
  it('a level of the old kind is still valid', () => {
    expect(ShooterLevelSchema.safeParse(quietLevel({ waves: [{ atMs: 1000, type: 'swarmer', count: 1 }] })).success).toBe(true);
  });
});

describe('the boss appears', () => {
  it('exactly when its wave says, with the level\'s bossHp, at the free point farthest from the player', () => {
    const state = newState(bossLevel('crusher', { bossHp: 55, spawnPoints: [{ x: 700, y: 305 }, { x: 880, y: 305 }, { x: 880, y: 500 }] }, 2000));
    advance(state, 120); // ticks 0..119
    expect(state.enemies).toHaveLength(0);
    step(state, IDLE_INPUT);
    const b = boss(state);
    expect(state.tick).toBe(121);
    expect(b).toMatchObject({ hp: 55, maxHp: 55, bossPhase: 'move' });
    expect(Math.round(b.x)).toBeGreaterThan(870); // (880, 500) is the farthest candidate: it came out there and walked one step
    expect(Math.round(b.y)).toBeGreaterThan(480);
  });
  it('without bossHp it has the hit points of its kind', () => {
    const state = newState(bossLevel('gunner'));
    step(state, IDLE_INPUT);
    expect(boss(state)).toMatchObject({ hp: GUNNER.hp, maxHp: GUNNER.hp });
  });
  it('a level with no boss has no boss state at all', () => {
    const state = newState(quietLevel());
    expect(state.bossIndex).toBeUndefined();
    expect(state.bossDown).toBeUndefined();
    expect('bossSpawned' in state).toBe(false);
    expect(state.maxEnemyRadius).toBe(20);
  });
  it('when the field is full it waits for a free place, and goes before the ordinary enemies that are waiting', () => {
    const level = bossLevel('crusher', { waves: [{ atMs: 0, type: 'swarmer', count: 5 }, { atMs: 1000, type: 'crusher', count: 1 }] });
    const state = newState(level);
    for (let i = 0; i < MAX_ENEMIES_ALIVE; i += 1) place(state, 'swarmer', 100 + (i % 20) * 20, 100 + Math.floor(i / 20) * 30, 500 + i);
    advance(state, 90);
    expect(state.enemies.some((e) => e.type === 'crusher')).toBe(false); // due since tick 60, but there is no room
    expect(state.spawned).toBe(0); // and nobody went ahead of it... the five swarmers are waiting too
    state.enemies.splice(0, 2); // two places free up
    step(state, IDLE_INPUT);
    expect(state.enemies.filter((e) => e.type === 'crusher')).toHaveLength(1);
    expect(state.enemies.filter((e) => e.type === 'swarmer' && e.id < 500)).toHaveLength(1); // the second place went to the swarmers' turn
  });
  it('the level\'s largest enemy radius is the boss\'s when there is one, 20 when there is not', () => {
    expect(newState(bossLevel('crusher')).maxEnemyRadius).toBe(34);
    expect(newState(bossLevel('gunner')).maxEnemyRadius).toBe(30);
    expect(newState(quietLevel()).maxEnemyRadius).toBe(20);
    // a bullet at the rim of the big body hits it (34 + 4 px from its center), one just outside does not
    const hit = (offset: number) => {
      const state = newState(bossLevel('crusher', { weapon: weaponOf({ bulletSpeed: 600, damage: 1, range: 800, cooldownMs: 300 }) }, 590_000));
      state.enemies.push({ id: 900, type: 'crusher', x: 700, y: 305, hp: 70, maxHp: 70, bossPhase: 'telegraph', phaseUntilTick: 1e9, nextChargeTick: 1e9 });
      state.bullets.push({ id: 901, x: 600, y: 305 + offset, vx: 600, vy: 0, travelled: 0 });
      advance(state, 20);
      return state.enemies[0]!.hp;
    };
    expect(hit(36)).toBe(69);
    expect(hit(41)).toBe(70);
  });
  it('an ordinary enemy pushed against the boss is pushed out; the boss stays where it is', () => {
    const state = newState(bossLevel('crusher', {}, 590_000));
    state.enemies.push({ id: 900, type: 'crusher', x: 700, y: 305, hp: 70, maxHp: 70, bossPhase: 'telegraph', phaseUntilTick: 1e9, nextChargeTick: 1e9 });
    state.player.x = 900; // the swarmer chases the player, so it keeps pressing into the boss from the left
    place(state, 'swarmer', 688, 305, 901); // inside the boss's body
    run(state, 150);
    const b = state.enemies.find((e) => e.id === 900)!;
    const s = state.enemies.find((e) => e.id === 901)!;
    expect([b.x, b.y]).toEqual([700, 305]);
    // it presses on at 1.6 px a tick and is pushed back by what overlaps: it settles just against the body
    expect(Math.sqrt((s.x - b.x) ** 2 + (s.y - b.y) ** 2)).toBeGreaterThanOrEqual(CRUSHER.radius + ENEMY_TYPES.swarmer.radius - 2);
  });
});

describe('winning and losing with a boss', () => {
  const duel = (weapon: ShooterLevel['weapon'], patch: Partial<ShooterLevel> = {}) => {
    const state = newState(bossLevel('crusher', { weapon, bossHp: 10, ...patch }, 590_000));
    state.enemies.push({ id: 900, type: 'crusher', x: 700, y: 305, hp: 10, maxHp: 10, bossPhase: 'telegraph', phaseUntilTick: 1e9, nextChargeTick: 1e9 });
    state.bossSpawned = true;
    return state;
  };
  it('defeating the boss wins, with any gun (single bullet, pellets, piercing), and the other enemies do not matter', () => {
    for (const [name, weapon] of [
      ['pistol', weaponOf({ damage: 3 })], ['shotgun', weaponOf({ damage: 1, pellets: 6, spreadDeg: 36, range: 320, cooldownMs: 1000 })],
      ['piercing', weaponOf({ damage: 2, pierce: 3, bulletSpeed: 800, range: 800 })],
    ] as const) {
      const state = duel(weapon);
      place(state, 'swarmer', 100, 100, 901); // far away and alive
      run(state, 400, fireAt(960, 305));
      expect(state.status, name).toBe('won');
      expect(state.bossDown).toBe(true);
      expect(state.kills).toBeGreaterThanOrEqual(1);
      expect(state.enemies.some((e) => e.id === 901)).toBe(true);
    }
  });
  it('the boss stays up while it lives, and killing everything else is not a win', () => {
    const state = duel(weaponOf({ damage: 1 }));
    place(state, 'swarmer', 600, 305, 901);
    run(state, 90, fireAt(600, 305));
    expect(state.enemies.some((e) => e.id === 901)).toBe(false);
    expect(state.status).toBe('playing');
    expect(state.bossDown).toBe(false);
  });
  it('losing is checked before winning: the boss falls in the same tick that the last hit point goes', () => {
    const state = duel(weaponOf({ damage: 5 }));
    state.enemies[0]!.hp = 1;
    state.enemies[0]!.x = 600;
    state.player.hp = 1;
    place(state, 'swarmer', 490, 305, 901); // touching the player
    state.bullets.push({ id: 902, x: 590, y: 305, vx: 600, vy: 0, travelled: 0 }); // about to hit the boss
    step(state, IDLE_INPUT);
    expect(state.bossDown).toBe(true);
    expect(state.player.hp).toBe(0);
    expect(state.status).toBe('lost');
  });
  it('the boss scores 50 and counts as a kill', () => {
    const state = duel(weaponOf({ damage: 5 }));
    run(state, 200, fireAt(960, 305));
    expect(state.score).toBe(50);
    expect(state.kills).toBe(1);
  });
});

describe('the crusher', () => {
  const CHARGE = CRUSHER.boss.charge;
  const FIRST = msToTicks(CHARGE.cycleMs); // the tick of its first warning
  const TELEGRAPH = msToTicks(CHARGE.telegraphMs); // 48
  const RUSH = msToTicks(CHARGE.durationMs); // 36
  const walk = CRUSHER.speed / 60;
  const rushStride = walk * CHARGE.speedScale;
  const timeline = (ticks: number) => {
    // the player stands at x = 300, so the rush ends well short of it and the walk can go on
    const state = newState(bossLevel('crusher', { player: { x: 300, y: 305, speed: 210, hp: 10 } }));
    const seen: Array<{ tick: number; phase: string | undefined; x: number; y: number }> = [];
    for (let i = 0; i < ticks; i += 1) {
      step(state, IDLE_INPUT);
      const b = boss(state);
      seen.push({ tick: state.tick, phase: b.bossPhase, x: b.x, y: b.y });
    }
    return { state, seen };
  };

  it('walks at its speed, stands still for the warning, then rushes at 3.2 times its speed for exactly 0.6 s', () => {
    const { seen } = timeline(FIRST + TELEGRAPH + RUSH + 20);
    const at = (tick: number) => seen.find((x) => x.tick === tick)!; // (a seen tick is the tick AFTER the step: step t is recorded as t + 1)
    expect(at(2).x - at(1).x).toBeCloseTo(-walk, 6);
    expect(at(FIRST).phase).toBe('move');
    expect(at(FIRST + 1).phase).toBe('telegraph'); // the step of tick FIRST stops it
    const standingX = at(FIRST + 1).x;
    for (let tick = FIRST + 1; tick <= FIRST + TELEGRAPH; tick += 1) expect(at(tick).x, `tick ${tick}`).toBe(standingX); // 48 ticks = 0.8 s without moving
    const rushFrom = FIRST + TELEGRAPH; // the rush's first step is the step of this tick
    for (let tick = rushFrom + 1; tick <= rushFrom + RUSH; tick += 1) {
      expect(at(tick).phase, `tick ${tick}`).toBe(tick === rushFrom + RUSH ? 'move' : 'charge');
      expect(Math.sqrt((at(tick).x - at(tick - 1).x) ** 2 + (at(tick).y - at(tick - 1).y) ** 2), `tick ${tick}`).toBeCloseTo(rushStride, 6);
    }
    expect(at(rushFrom + RUSH).x - standingX).toBeCloseTo(-rushStride * RUSH, 6); // straight at the player's place, along the line it stood on
    expect(at(rushFrom + RUSH + 3).x - at(rushFrom + RUSH + 2).x).toBeCloseTo(-walk, 6); // and the walk goes on at the normal speed
  });

  it('rushes at the place the player stood when the rush BEGAN: a player who moves away during the rush is missed', () => {
    const touched = (dodge: boolean) => {
      const state = newState(bossLevel('crusher'));
      let before = state.player.hp;
      let lost = 0;
      for (let i = 0; i < FIRST + TELEGRAPH + RUSH + 40; i += 1) {
        const rushing = state.tick >= FIRST + TELEGRAPH;
        step(state, { moveX: 0, moveY: dodge && rushing ? -1 : 0, aimX: 960, aimY: 305, fire: false });
        if (state.tick > FIRST + TELEGRAPH && state.player.hp < before) lost += before - state.player.hp;
        before = state.player.hp;
      }
      return lost;
    };
    expect(touched(false)).toBeGreaterThanOrEqual(CRUSHER.damage);
    expect(touched(true)).toBe(0);
  });

  it('a touch costs its damage (2) and gives the usual protection time', () => {
    const state = newState(bossLevel('crusher'));
    state.player.hp = 10;
    while (state.player.hp === 10 && state.tick < FIRST + 400) step(state, IDLE_INPUT);
    expect(state.player.hp).toBe(10 - CRUSHER.damage);
    expect(state.player.invulnerableUntilTick).toBeGreaterThan(state.tick);
    run(state, 5);
    expect(state.player.hp).toBe(10 - CRUSHER.damage);
  });

  it('hitting a wall ends the rush at once', () => {
    const state = newState(bossLevel('crusher', { obstacles: [{ x: 560, y: 305, width: 20, height: 140 }] }));
    state.enemies.push({ id: 900, type: 'crusher', x: 640, y: 305, hp: 70, maxHp: 70, bossPhase: 'telegraph', phaseUntilTick: 10, nextChargeTick: 1e9 });
    state.bossSpawned = true;
    state.spawned = 1;
    advance(state, 10);
    let ticks = 0;
    while (state.enemies.find((e) => e.id === 900)!.bossPhase !== 'move' && ticks < 60) { step(state, IDLE_INPUT); ticks += 1; }
    const b = state.enemies.find((e) => e.id === 900)!;
    expect(b.bossPhase).toBe('move');
    expect(ticks).toBeLessThan(RUSH); // not the whole 0.6 s
    expect(b.x).toBeGreaterThanOrEqual(570 + CRUSHER.radius - 0.001); // stopped against the wall (its right edge is at 570)
    expect(b.nextChargeTick).toBeGreaterThan(state.tick);
  });

  it('is enraged at half its hit points or fewer: 1.25 times as fast, and its next rush comes 0.75 times as soon', () => {
    const calm = newState(bossLevel('crusher', { bossHp: 70 }));
    const angry = newState(bossLevel('crusher', { bossHp: 70 }));
    step(calm, IDLE_INPUT); step(angry, IDLE_INPUT);
    boss(angry).hp = 35; // exactly half
    step(calm, IDLE_INPUT); step(angry, IDLE_INPUT);
    const speed = (st: ShooterState) => { const b = boss(st); const x = b.x; step(st, IDLE_INPUT); return Math.abs(boss(st).x - x); };
    expect(speed(calm)).toBeCloseTo(walk, 6);
    expect(speed(angry)).toBeCloseTo(walk * 1.25, 6);
    boss(calm).hp = 36; // one above half is not enraged
    expect(speed(calm)).toBeCloseTo(walk, 6);
    const rushed = (hp: number) => {
      const st = newState(bossLevel('crusher', { bossHp: 70 }));
      st.enemies.push({ id: 900, type: 'crusher', x: 700, y: 305, hp, maxHp: 70, bossPhase: 'charge', phaseUntilTick: 100, chargeDx: -1, chargeDy: 0, nextChargeTick: 1e9 });
      st.bossSpawned = true; st.spawned = 1; st.enemies.splice(0, st.enemies.length - 1);
      advance(st, 100);
      return st.enemies.find((e) => e.id === 900)!;
    };
    expect(rushed(70).nextChargeTick).toBe(100 + msToTicks(CHARGE.cycleMs));
    expect(rushed(35).nextChargeTick).toBe(100 + msToTicks(CHARGE.cycleMs * 0.75));
  });
});

describe('the gunner', () => {
  const [FAN, RING] = GUNNER.boss.volleys;
  const FAN_AT = msToTicks(FAN.cooldownMs);
  const RING_AT = msToTicks(RING.cooldownMs);
  /** What the boss fired and when. A tick's new bullets are a fan (3), a ring (12), or both (15). */
  const run1 = (ticks: number, patch: Partial<ShooterLevel> = {}) => {
    const state = newState(bossLevel('gunner', patch));
    const log: Array<{ tick: number; shape: 'fan' | 'ring'; bullets: ShooterState['enemyBullets'] }> = [];
    const known = new Set<number>();
    for (let i = 0; i < ticks; i += 1) {
      step(state, IDLE_INPUT);
      const fresh = state.enemyBullets.filter((b) => !known.has(b.id));
      for (const b of fresh) known.add(b.id);
      if (fresh.length === 0) continue;
      const rings = fresh.length >= 12;
      if (rings) log.push({ tick: state.tick - 1, shape: 'ring', bullets: fresh.slice(fresh.length - 12) });
      const fan = rings ? fresh.slice(0, fresh.length - 12) : fresh;
      if (fan.length > 0) log.push({ tick: state.tick - 1, shape: 'fan', bullets: fan });
    }
    return { state, log };
  };

  it('closes in and stops once it is within 300 px with a straight view; with a wall in between it walks the flow field', () => {
    const state = newState(bossLevel('gunner'));
    advance(state, 400);
    const b = boss(state);
    const gap = Math.sqrt((b.x - state.player.x) ** 2 + (b.y - state.player.y) ** 2);
    expect(gap).toBeGreaterThan(300 - 1);
    expect(gap).toBeLessThanOrEqual(300);
    const where = [b.x, b.y];
    advance(state, 460);
    expect([boss(state).x, boss(state).y]).toEqual(where);
    // a wall hides the player: no hold, and no fan (it needs a straight view)
    const hidden = newState(bossLevel('gunner', { obstacles: [{ x: 640, y: 305, width: 40, height: 300 }] }));
    advance(hidden, 200);
    expect(boss(hidden).y).not.toBe(305); // it is going round the wall, not straight on
  });

  it('fires a fan of 3 from its appearance on its cycle: symmetric around the aim, outer bullets at +-12 degrees', () => {
    const { state, log } = run1(FAN_AT + 10);
    expect(log[0]!.tick).toBe(FAN_AT);
    expect(log[0]!.shape).toBe('fan');
    const bullets = log[0]!.bullets;
    expect(bullets).toHaveLength(3);
    expect(bullets.map((b) => b.id)).toEqual([bullets[0]!.id, bullets[0]!.id + 1, bullets[0]!.id + 2]); // in order
    const b = boss(state);
    const aim = Math.atan2(state.player.y - b.y, state.player.x - b.x);
    const wrap = (d: number) => ((d + 540) % 360) - 180;
    // (measured from where it was when it fired: the boss does not move once it holds, and the player stands still)
    const rel = bullets.map((bl) => wrap(degrees(Math.atan2(bl.vy, bl.vx) - aim)));
    expect(Math.abs(rel[0]! + 12)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(rel[1]!)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(rel[2]! - 12)).toBeLessThanOrEqual(0.3);
    for (const bl of bullets) expect(Math.sqrt(bl.vx ** 2 + bl.vy ** 2)).toBeCloseTo(FAN.bulletSpeed, 6);
  });

  it('fires the fan again every msToTicks(fan cooldown) and the ring of 12 every msToTicks(ring cooldown)', () => {
    const { log } = run1(RING_AT * 2 + 20);
    const fans = log.filter((l) => l.shape === 'fan').map((l) => l.tick);
    const rings = log.filter((l) => l.shape === 'ring').map((l) => l.tick);
    expect(fans.slice(0, 3)).toEqual([FAN_AT, FAN_AT * 2, FAN_AT * 3]);
    expect(rings.slice(0, 2)).toEqual([RING_AT, RING_AT * 2]);
  });

  it('the ring has 12 different bullets, 30 degrees apart, at the ring speed', () => {
    const { log } = run1(RING_AT + 5);
    const ring = log.find((l) => l.shape === 'ring')!.bullets;
    expect(ring).toHaveLength(12);
    for (const bl of ring) expect(Math.abs(Math.sqrt(bl.vx ** 2 + bl.vy ** 2) - RING.bulletSpeed)).toBeLessThan(RING.bulletSpeed * 0.001 + 1e-9); // (the table has 4 decimals)
    expect(new Set(ring.map((bl) => `${bl.vx.toFixed(3)},${bl.vy.toFixed(3)}`)).size).toBe(12);
    const angles = ring.map((bl) => degrees(Math.atan2(bl.vy, bl.vx))).sort((a, b) => a - b);
    for (let i = 1; i < 12; i += 1) expect(Math.abs(angles[i]! - angles[i - 1]! - 30)).toBeLessThanOrEqual(0.3);
  });

  it('does not fire the ring when there is no room for all 12 bullets (it waits, still due), but fires a fan that fits', () => {
    const state = newState(bossLevel('gunner'));
    for (let i = 0; i < MAX_ENEMY_BULLETS - 5; i += 1) state.enemyBullets.push({ id: 5000 + i, x: 900, y: 100, vx: 0, vy: 0, travelled: 0, damage: 1, radius: 5, range: 600 });
    advance(state, RING_AT + 10);
    const fired = state.enemyBullets.filter((b) => b.id < 5000).length;
    expect(fired).toBeGreaterThanOrEqual(3); // the first fan fitted (55 + 3)
    expect(fired).toBeLessThan(12); // and no ring of 12 ever did: only 5 places were free
    expect(boss(state).volleyTicks![1]).toBe(RING_AT); // the ring was due and is still waiting
    expect(state.enemyBullets.length).toBeLessThanOrEqual(MAX_ENEMY_BULLETS);
  });

  it('enraged, its cycles are 0.7 times as long', () => {
    const base = (hp: number) => {
      const st = newState(bossLevel('gunner', { bossHp: 50 }));
      step(st, IDLE_INPUT);
      boss(st).hp = hp;
      advance(st, FAN_AT + 1);
      return boss(st).volleyTicks![0]!;
    };
    expect(base(50)).toBe(FAN_AT + msToTicks(FAN.cooldownMs));
    expect(base(25)).toBe(FAN_AT + msToTicks(FAN.cooldownMs * 0.7));
  });
});

describe('the ring table', () => {
  it('is twelve unit vectors, 30 degrees apart', () => {
    expect(RING_12).toHaveLength(12);
    for (const [x, y] of RING_12) expect(Math.abs(Math.sqrt(x * x + y * y) - 1)).toBeLessThanOrEqual(0.001);
    for (let k = 0; k < 12; k += 1) {
      const [x, y] = RING_12[k]!;
      const angle = (degrees(Math.atan2(y, x)) + 360) % 360;
      expect(Math.abs(angle - k * 30), `vector ${k}`).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('a boss never touches the game\'s random numbers', () => {
  it('the generator ends in the same place with a boss and without, when the other enemies are the same', () => {
    const crowd = [{ atMs: 500, type: 'swarmer' as const, count: 12 }, { atMs: 3000, type: 'runner' as const, count: 6 }];
    const spawns = [{ x: 880, y: 305 }, { x: 60, y: 120 }, { x: 60, y: 500 }];
    const withBoss = newState(quietLevel({ player: { x: 480, y: 305, speed: 210, hp: 1000 }, spawnPoints: spawns, waves: [...crowd, { atMs: 1500, type: 'gunner', count: 1 }], win: { type: 'boss' } }));
    const without = newState(quietLevel({ player: { x: 480, y: 305, speed: 210, hp: 1000 }, spawnPoints: spawns, waves: crowd, win: { type: 'survive', seconds: 300 } }));
    for (let i = 0; i < 700; i += 1) { step(withBoss, IDLE_INPUT); step(without, IDLE_INPUT); }
    expect(withBoss.rng).toBe(without.rng);
    expect(boss(withBoss)).toBeDefined();
  });
  it('is deterministic: the same level gives the same hash at every tick, and the state can be cloned and resumed', () => {
    const level = bossLevel('crusher', { seed: 9 });
    const trace = () => { const s = createSim(level); const out: string[] = []; for (let i = 0; i < 700 && s.status === 'playing'; i += 1) { step(s, botInput(s)); out.push(snapshotHash(s)); } return out; };
    expect(trace()).toEqual(trace());
    const a = createSim(bossLevel('gunner'));
    advance(a, 200);
    const b = structuredClone(a);
    for (let i = 0; i < 300; i += 1) { step(a, IDLE_INPUT); step(b, IDLE_INPUT); }
    expect(snapshotHash(b)).toBe(snapshotHash(a));
  });
  it('a level without a boss hashes exactly as before: the boss fields add nothing', () => {
    const state = newState(quietLevel({ waves: [{ atMs: 0, type: 'swarmer', count: 3 }] }));
    run(state, 120);
    const hash = snapshotHash(state);
    const copy = structuredClone(state);
    expect(snapshotHash(copy)).toBe(hash);
    expect(state.enemies.every((e) => e.maxHp === undefined && e.bossPhase === undefined)).toBe(true);
  });
});

describe('the bots and the boss', () => {
  const withBoss = (bossAt: [number, number], other?: [number, number]) => {
    const state = newState(bossLevel('crusher', { weapon: weaponOf({ range: 600 }) }, 590_000));
    state.enemies.push({ id: 900, type: 'crusher', x: bossAt[0], y: bossAt[1], hp: 70, maxHp: 70, bossPhase: 'telegraph', phaseUntilTick: 1e9, nextChargeTick: 1e9 });
    if (other) place(state, 'swarmer', other[0], other[1], 901);
    return state;
  };
  it('the expert aims at the boss when it is within the weapon\'s range, even with an enemy nearer; otherwise at the nearest', () => {
    const inRange = withBoss([480 + 500, 305], [680, 305]); // boss 500 px away (range 600), a swarmer 200 px away
    expect(inRange.player.x).toBe(480);
    const aimed = botInput(inRange);
    expect(aimed.aimX).toBe(inRange.enemies.find((e) => e.id === 900)!.x);
    const far = withBoss([480 + 700, 305], [680, 305]); // boss 700 px away: out of range
    expect(botInput(far).aimX).toBe(680);
  });
  it('the casual bot does the same at its look, with 85% of the range', () => {
    const near = withBoss([480 + 500, 305], [680, 305]); // 500 <= 0.85 x 600 = 510
    const aimNear = createCasualBot(1)(near);
    const bossX = near.enemies.find((e) => e.id === 900)!.x;
    expect(Math.abs(aimNear.aimX - bossX)).toBeLessThan(120); // aimed at the boss, within the aim error
    const beyond = withBoss([480 + 520, 305], [680, 305]); // 520 > 510: not dared
    const aimBeyond = createCasualBot(1)(beyond);
    expect(Math.abs(aimBeyond.aimX - 680)).toBeLessThan(60); // aimed at the swarmer instead
  });
  it('a boss pushes a bot away from farther off than an ordinary enemy of the same distance does', () => {
    const gap = 150 + 10; // outside the ordinary 150 px, inside 150 + 34
    const ordinary = newState(quietLevel());
    place(ordinary, 'swarmer', 480 + gap, 305, 901);
    expect(botInput(ordinary).moveX).toBe(0);
    const big = withBoss([480 + gap, 305]);
    expect(botInput(big).moveX).toBe(-1);
    // the casual bot's own radius is 120 (+ 34 for a boss): at 140 px it ignores an ordinary enemy and keeps off a boss
    const ordinaryNear = newState(quietLevel());
    place(ordinaryNear, 'swarmer', 480 + 140, 305, 901);
    expect(createCasualBot(2)(ordinaryNear).moveX).toBe(0);
    expect(createCasualBot(2)(withBoss([480 + 140, 305])).moveX).toBe(-1);
  });
  it('neither bot is stuck on a boss level: games end well inside the 400 s limit', () => {
    for (const name of ['boss-crusher', 'boss-gunner'] as const) {
      const level = SHOOTER_LEVELS[name];
      for (const seed of [1, 2, 3, 4]) {
        const expert = playLevel({ ...level, seed }, botInput);
        const casual = playLevel({ ...level, seed }, createCasualBot(seed));
        expect(expert.status, `${name} expert ${seed}`).not.toBe('playing');
        expect(casual.status, `${name} casual ${seed}`).not.toBe('playing');
        expect(casual.seconds).toBeLessThan(400);
      }
    }
  });
});
