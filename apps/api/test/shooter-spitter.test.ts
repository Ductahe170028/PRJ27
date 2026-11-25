import { describe, expect, it } from 'vitest';
import {
  ENEMY_TYPES, INVULNERABLE_MS, MAX_ENEMY_BULLETS, PLAYER_RADIUS, ShooterLevelSchema, createSim, msToTicks, rangedOf, snapshotHash, step,
  type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, fireAt, newState, place, quietLevel, run, weaponOf } from './shooter-4b-helpers.js';

const SPITTER = ENEMY_TYPES.spitter;
const RANGED = SPITTER.ranged;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

describe('the spitter is one more row of data', () => {
  it('has the numbers of the design, a code of its own, and the older kinds do not shoot', () => {
    expect(SPITTER).toMatchObject({ code: 4, radius: 12, speed: 70, hp: 3, damage: 1, points: 4 });
    expect(RANGED).toEqual({ holdRange: 260, sightRange: 460, cooldownMs: 2400, bulletSpeed: 180, bulletDamage: 1, bulletRadius: 5 });
    expect(rangedOf('spitter')).toEqual(RANGED);
    for (const type of ['runner', 'brute', 'swarmer'] as const) expect(rangedOf(type)).toBeUndefined();
    expect([1, 2, 3].map((n) => Object.values(ENEMY_TYPES).find((e) => e.code === n)?.radius)).toEqual([11, 20, 9]);
    expect(Math.max(...Object.values(ENEMY_TYPES).map((e) => e.radius))).toBe(20);
  });

  it('a level with spitters passes the schema', () => {
    expect(ShooterLevelSchema.safeParse(quietLevel({ waves: [{ atMs: 0, type: 'spitter', count: 3 }] })).success).toBe(true);
  });

  it('a level without one has no shooting data anywhere in its state', () => {
    const state = createSim(quietLevel({ waves: [{ atMs: 0, type: 'runner', count: 3 }, { atMs: 0, type: 'brute', count: 1 }] }));
    run(state, 200);
    expect(state.enemies.length).toBeGreaterThan(0);
    expect(state.enemies.every((e) => !('nextShotTick' in e))).toBe(true);
    expect(state.enemyBullets).toEqual([]);
    expect(state.pickups).toEqual([]);
  });
});

describe('moving', () => {
  const wallBetween = quietLevel({ obstacles: [{ x: 640, y: 305, width: 40, height: 300 }] });

  it('without a straight view of the player it follows the flow field and does not shoot', () => {
    const state = newState(wallBetween);
    place(state, 'spitter', 800, 305, 7, { nextShotTick: 0 });
    const start = { x: state.enemies[0]!.x, y: state.enemies[0]!.y };
    for (let i = 0; i < 150; i += 1) {
      step(state, IDLE_INPUT);
      const e = state.enemies[0]!;
      if (e.x > 660) expect(state.enemyBullets, `tick ${i}`).toHaveLength(0); // still behind the wall: no view
    }
    const e = state.enemies[0]!;
    expect(dist(e, start)).toBeGreaterThan(50); // it did walk, around the wall
    expect(e.y).not.toBe(305); // it went up or down to get round
  });

  it('with a view, farther than its hold range it comes closer, within it it stands still', () => {
    const state = newState(quietLevel());
    place(state, 'spitter', 900, 305, 7, { nextShotTick: 1_000_000 }); // 420 px away; it never fires in this test
    const gaps: number[] = [];
    for (let i = 0; i < 420; i += 1) { step(state, IDLE_INPUT); gaps.push(dist(state.enemies[0]!, state.player)); }
    expect(gaps[0]!).toBeLessThan(420);
    expect(gaps[60]!).toBeLessThan(gaps[0]!);
    const settled = gaps[419]!;
    expect(settled).toBeGreaterThan(RANGED.holdRange - 2); // stopped as soon as it was within 260 (one step is 1.2 px)
    expect(settled).toBeLessThanOrEqual(RANGED.holdRange);
    expect(gaps[300]).toBe(gaps[419]); // and has not moved since
    const here = { x: state.enemies[0]!.x, y: state.enemies[0]!.y };
    run(state, 60);
    expect({ x: state.enemies[0]!.x, y: state.enemies[0]!.y }).toEqual(here);
  });

  it('does not back away when the player comes closer', () => {
    const state = newState(quietLevel());
    place(state, 'spitter', 700, 305, 7, { nextShotTick: 1_000_000 }); // 220 px: already inside the hold range
    const x = state.enemies[0]!.x;
    run(state, 60, { moveX: 1, moveY: 0, aimX: 960, aimY: 305, fire: false });
    expect(state.enemies[0]!.x).toBe(x);
    expect(state.player.x).toBeGreaterThan(480);
  });
});

describe('shooting', () => {
  const bulletTicks = (state: ShooterState, ticks: number) => {
    const seen: number[] = [];
    const known = new Set<number>();
    for (let i = 0; i < ticks; i += 1) {
      step(state, IDLE_INPUT);
      for (const b of state.enemyBullets) if (!known.has(b.id)) { known.add(b.id); seen.push(state.tick - 1); }
    }
    return seen;
  };

  it('the first shot comes half a cooldown (+100 ms per id mod 5) after it appears, then every cooldown', () => {
    const level = quietLevel({ waves: [{ atMs: 0, type: 'spitter', count: 2 }], spawnPoints: [{ x: 700, y: 305 }, { x: 700, y: 120 }, { x: 700, y: 500 }] });
    const state = newState(level);
    step(state, IDLE_INPUT); // tick 0: both are placed... the second one 9 ticks later (150 ms apart)
    const spawned = state.enemies.map((e) => ({ id: e.id, shot: e.nextShotTick }));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toEqual({ id: 1, shot: msToTicks(RANGED.cooldownMs / 2 + (1 % 5) * 100) });
    run(state, 9);
    const second = state.enemies.find((e) => e.id === 2)!;
    expect(second.nextShotTick).toBe(9 + msToTicks(RANGED.cooldownMs / 2 + (2 % 5) * 100));
    expect(second.nextShotTick).not.toBe(state.enemies.find((e) => e.id === 1)!.nextShotTick! + 9); // out of step
  });

  it('shoots on that schedule: the same enemy every msToTicks(cooldownMs), two enemies out of step', () => {
    const state = newState(quietLevel());
    place(state, 'spitter', 700, 305, 5, { nextShotTick: 20 }); // inside the hold range: it stays put
    const ticks = bulletTicks(state, 400);
    expect(ticks.slice(0, 3)).toEqual([20, 20 + msToTicks(RANGED.cooldownMs), 20 + 2 * msToTicks(RANGED.cooldownMs)]);
    const two = newState(quietLevel({ player: { x: 480, y: 305, speed: 210, hp: 10 } }));
    place(two, 'spitter', 700, 305, 5, { nextShotTick: 20 });
    place(two, 'spitter', 700, 330, 6, { nextShotTick: 35 });
    const both = bulletTicks(two, 60);
    expect(both).toEqual([20, 35]);
  });

  it('does not shoot beyond its sight range, and does when it is within it', () => {
    const state = newState(quietLevel({ player: { x: 100, y: 305, speed: 210, hp: 10 } }));
    place(state, 'spitter', 700, 305, 5, { nextShotTick: 0 }); // 600 px away
    let firedAt = -1;
    for (let i = 0; i < 400 && firedAt < 0; i += 1) {
      const before = dist(state.enemies[0]!, state.player);
      step(state, IDLE_INPUT);
      if (state.enemyBullets.length > 0) { firedAt = i; expect(before).toBeLessThanOrEqual(RANGED.sightRange + 1.2); } // it fires after its step of 1.2 px
      else expect(before).toBeGreaterThan(0); // always a gap
    }
    expect(firedAt).toBeGreaterThan(60); // it had to walk about 140 px first (2 s at 70 px/s)
    expect(state.enemyBullets).toHaveLength(1);
  });

  it('a wall in the way: it does not shoot, and the wait does not delay the shot once it sees the player', () => {
    const state = newState(quietLevel({ obstacles: [{ x: 600, y: 305, width: 40, height: 200 }] }));
    place(state, 'spitter', 700, 305, 5, { nextShotTick: 0 }); // ready, but the wall hides the player at once
    step(state, IDLE_INPUT);
    expect(state.enemyBullets).toHaveLength(0);
  });

  it('aims at where the player is at that moment, and aims the bullet along that line at the bullet speed', () => {
    const state = newState(quietLevel());
    place(state, 'spitter', 700, 305, 5, { nextShotTick: 3 });
    run(state, 3, { moveX: 0, moveY: -1, aimX: 960, aimY: 305, fire: false }); // the player walks up for 3 ticks
    const player = { x: state.player.x, y: state.player.y };
    step(state, { moveX: 0, moveY: 0, aimX: 960, aimY: 305, fire: false });
    const bullet = state.enemyBullets[0]!;
    // fired during the tick at t = 3, after the player had moved on that tick (4 moves in all): aimed at the player of that moment
    const moved = state.player.y;
    expect(moved).toBeLessThan(player.y + 0.001);
    const angle = Math.atan2(bullet.vy, bullet.vx);
    const expected = Math.atan2(state.player.y - 305, state.player.x - 700);
    expect(Math.abs(angle - expected)).toBeLessThan(0.02);
    expect(Math.sqrt(bullet.vx ** 2 + bullet.vy ** 2)).toBeCloseTo(RANGED.bulletSpeed, 6);
    expect(bullet).toMatchObject({ damage: RANGED.bulletDamage, radius: RANGED.bulletRadius, range: RANGED.sightRange * 1.3 });
  });

  it('never has more than MAX_ENEMY_BULLETS in the air, and does not fire when the cap is reached', () => {
    const state = newState(quietLevel());
    for (let i = 0; i < MAX_ENEMY_BULLETS; i += 1) state.enemyBullets.push({ id: 9000 + i, x: 900, y: 100, vx: 0, vy: 0, travelled: 0, damage: 1, radius: 5, range: 600 });
    place(state, 'spitter', 700, 305, 5, { nextShotTick: 0 });
    run(state, 30);
    expect(state.enemyBullets).toHaveLength(MAX_ENEMY_BULLETS);
    expect(state.enemies[0]!.nextShotTick).toBe(0); // it was not allowed to fire, so it is still waiting
    state.enemyBullets.pop();
    step(state, IDLE_INPUT);
    expect(state.enemyBullets).toHaveLength(MAX_ENEMY_BULLETS);
  });
});

describe('enemy bullets', () => {
  const bullet = (patch: Partial<ShooterState['enemyBullets'][number]> = {}) => ({ id: 777, x: 380, y: 305, vx: 230, vy: 0, travelled: 0, damage: 1, radius: 5, range: 598, ...patch });

  it('hurt the player by their damage, give the touch protection time, and are spent', () => {
    const state = newState(quietLevel());
    state.enemyBullets.push(bullet());
    run(state, 60);
    expect(state.player.hp).toBe(9);
    expect(state.enemyBullets).toHaveLength(0);
    expect(state.player.invulnerableUntilTick).toBeGreaterThan(0);
    expect(state.player.invulnerableUntilTick).toBeLessThanOrEqual(60 + msToTicks(INVULNERABLE_MS));
  });

  it('a bullet that arrives while the player is protected is absorbed and does nothing', () => {
    const state = newState(quietLevel());
    state.player.invulnerableUntilTick = 1000;
    state.enemyBullets.push(bullet());
    run(state, 60);
    expect(state.player.hp).toBe(10);
    expect(state.enemyBullets).toHaveLength(0);
    expect(state.player.invulnerableUntilTick).toBe(1000);
  });

  it('are stopped by a wall, and then do not reach the player', () => {
    const state = newState(quietLevel({ obstacles: [{ x: 430, y: 305, width: 20, height: 200 }] }));
    state.enemyBullets.push(bullet());
    run(state, 60);
    expect(state.player.hp).toBe(10);
    expect(state.enemyBullets).toHaveLength(0);
  });

  it('vanish after their range, and when they leave the field', () => {
    const state = newState(quietLevel());
    state.enemyBullets.push(bullet({ x: 300, y: 100, vx: -230, range: 50 }));
    state.enemyBullets.push(bullet({ id: 778, x: 60, y: 100, vx: -230, range: 5000 }));
    run(state, 20);
    expect(state.enemyBullets).toHaveLength(0);
  });

  it('can be dodged: a player who walks sideways at running speed escapes a bullet shot from 260 px, one who stands still is hit', () => {
    const shoot = (dodge: boolean) => {
      const state = newState(quietLevel());
      place(state, 'spitter', 740, 305, 5, { nextShotTick: 0 }); // 260 px: inside the hold range, stands still
      let fired = -1;
      for (let i = 0; i < 200; i += 1) {
        const moving = dodge && fired >= 0 && i - fired < 40;
        step(state, { moveX: 0, moveY: moving ? -1 : 0, aimX: 960, aimY: 305, fire: false });
        if (fired < 0 && state.enemyBullets.length > 0) fired = i;
        if (fired >= 0 && i - fired > 100) break; // the first bullet is long gone; the second one comes after 108 ticks
      }
      return state.player.hp;
    };
    expect(shoot(false)).toBe(9);
    expect(shoot(true)).toBe(10);
  });

  it('bullets and touches share one protection: a hit leaves the player safe from a touch in the same moment', () => {
    const state = newState(quietLevel());
    state.enemyBullets.push(bullet({ x: 470, vx: 230 })); // about to hit
    place(state, 'swarmer', 490, 305, 5); // already touching
    step(state, IDLE_INPUT);
    expect(state.player.hp).toBe(9); // one hit, not two
  });
});

describe('a spitter is an enemy like the others', () => {
  it('dies at 0 hp, counts a kill and scores 4', () => {
    const state = newState(quietLevel({ weapon: weaponOf({ damage: 3 }) }));
    place(state, 'spitter', 700, 305, 5, { nextShotTick: 1_000_000 });
    run(state, 90, fireAt(960, 305));
    expect(state.enemies).toHaveLength(0);
    expect(state.kills).toBe(1);
    expect(state.score).toBe(4);
  });

  it('a lost game from enemy bullets is a lost game', () => {
    const state = newState(quietLevel({ player: { x: 480, y: 305, speed: 210, hp: 1 } }));
    state.enemyBullets.push({ id: 1, x: 380, y: 305, vx: 230, vy: 0, travelled: 0, damage: 1, radius: 5, range: 598 });
    run(state, 90);
    expect(state.status).toBe('lost');
  });

  it('is deterministic', () => {
    const level = quietLevel({ seed: 5, waves: [{ atMs: 0, type: 'spitter', count: 4 }, { atMs: 2000, type: 'runner', count: 4 }], spawnPoints: [{ x: 760, y: 120 }, { x: 760, y: 500 }, { x: 60, y: 300 }] });
    const trace = () => { const s = createSim(level); const out: string[] = []; for (let i = 0; i < 500 && s.status === 'playing'; i += 1) { step(s, IDLE_INPUT); out.push(snapshotHash(s)); } return out; };
    expect(trace()).toEqual(trace());
    expect(PLAYER_RADIUS).toBe(14);
  });
});
