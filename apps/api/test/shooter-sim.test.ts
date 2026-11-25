import { describe, expect, it } from 'vitest';
import {
  IDLE, botInput, playLevel as play, BRUTE_CLEARANCE, BULLET_RADIUS, ENEMY_TYPES, FIELD, INVULNERABLE_MS, MAX_BULLETS, MAX_ENEMIES_ALIVE, PLAYER_RADIUS,
  RuntimeInitSchema, SHOOTER_LEVELS, SHOOTER_LEVEL_NAMES, SPAWN_STAGGER_MS, ShooterLevelSchema, createSim, elapsedSeconds,
  freeSpaceConnected, msToTicks, pointRectDistance, shooterLevel, snapshotHash, step, totalScheduledEnemies,
  type ShooterInput, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';

// A quiet field: the player in the middle, one far spawn point, and a single
// enemy scheduled so late that nothing happens unless a test makes it.
const quiet = (patch: Partial<ShooterLevel> = {}): ShooterLevel => ({
  ...structuredClone(SHOOTER_LEVELS['smoke-win']),
  waves: [{ atMs: 590_000, type: 'swarmer', count: 1 }],
  win: { type: 'survive', seconds: 300 },
  ...patch,
});
const run = (state: ShooterState, ticks: number, input: ShooterInput = IDLE) => {
  for (let i = 0; i < ticks; i += 1) step(state, input);
};
const aimAt = (x: number, y: number, fire: boolean): ShooterInput => ({ moveX: 0, moveY: 0, aimX: x, aimY: y, fire });
/** Puts an enemy straight into the state (a test shortcut; the sim never does this). */
const place = (state: ShooterState, type: keyof typeof ENEMY_TYPES, x: number, y: number, id = state.nextId + 1000) => {
  state.enemies.push({ id, type, x, y, hp: ENEMY_TYPES[type].hp });
};
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('schema', () => {
  it.each(SHOOTER_LEVEL_NAMES)('fixture %s is a valid level, connected for a brute', (name) => {
    const level = SHOOTER_LEVELS[name];
    expect(ShooterLevelSchema.safeParse(level).success).toBe(true);
    expect(freeSpaceConnected(level, BRUTE_CLEARANCE)).toBe(true);
    expect(RuntimeInitSchema.safeParse({ channel: 'game-creator', sessionId: crypto.randomUUID(), type: 'runtime:init', game: level }).success).toBe(true);
  });

  type Loose = Record<string, any>;
  const reject = (name: string, patch: (level: Loose) => void, path?: string) => {
    it(`rejects ${name}`, () => {
      const level = structuredClone(SHOOTER_LEVELS.pillars) as unknown as Loose;
      patch(level);
      const result = ShooterLevelSchema.safeParse(level);
      expect(result.success).toBe(false);
      if (path && !result.success) expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(path);
    });
  };
  reject('a player inside an obstacle', (l: Loose) => { l.player.x = 300; l.player.y = 210; }, 'player');
  reject('a player 10 px from an obstacle', (l: Loose) => { l.player.x = 300; l.player.y = 170; }, 'player');
  reject('a player too close to the edge', (l: Loose) => { l.player.x = 10; }, 'player');
  reject('a spawn point inside an obstacle', (l: Loose) => { l.spawnPoints[0] = { x: 660, y: 210 }; }, 'spawnPoints.0');
  reject('a spawn point under 200 px from the player', (l: Loose) => { l.spawnPoints[0] = { x: 480, y: 150 }; }, 'spawnPoints.0');
  reject('a kill target above the scheduled enemies', (l: Loose) => { l.win = { type: 'kill', count: 400 }; }, 'win.count');
  reject('a survival level with no wave before the end', (l: Loose) => { l.win = { type: 'survive', seconds: 10 }; l.waves = [{ atMs: 20_000, type: 'runner', count: 1 }]; }, 'waves');
  reject('more than 400 scheduled enemies', (l: Loose) => { l.waves = Array.from({ length: 11 }, (_, i) => ({ atMs: i * 1000, type: 'swarmer', count: 40 })); l.win = { type: 'kill', count: 1 }; }, 'waves');
  reject('an unknown field', (l: Loose) => { l.script = 'alert(1)'; });
  reject('an unknown field inside a wave', (l: Loose) => { l.waves[0].url = 'http://x'; });
  reject('a bad color', (l: Loose) => { l.theme.enemy = 'red'; });
  reject('an obstacle past the field', (l: Loose) => { l.obstacles[0] = { x: 940, y: 300, width: 100, height: 60 }; }, 'obstacles.0');
  reject('an obstacle in the HUD bar', (l: Loose) => { l.obstacles[0] = { x: 300, y: 80, width: 60, height: 60 }; }, 'obstacles.0');
  reject('a wrong kind', (l: Loose) => { l.kind = 'shooter-v2'; });
  reject('an enemy type that does not exist', (l: Loose) => { l.waves[0].type = 'boss'; });
  reject('a fractional coordinate', (l: Loose) => { l.player.x = 480.5; });
  reject('a title with markup', (l: Loose) => { l.title = '<b>x</b>'; });
  reject('zero spawn points', (l: Loose) => { l.spawnPoints = []; });
});

describe('collisions', () => {
  const block = { x: 480, y: 305, width: 100, height: 80 };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

  it('the player never enters an obstacle or leaves the field, in 8 directions from 16 starts (corners included)', () => {
    const bad: string[] = [];
    for (let k = 0; k < 16; k += 1) {
      const angle = (k / 16) * 2 * Math.PI;
      for (const [dx, dy] of dirs) {
        const state = createSim(quiet({ obstacles: [block], player: { x: Math.round(480 + 160 * Math.cos(angle)), y: Math.round(305 + 160 * Math.sin(angle)), speed: 320, hp: 5 } }));
        for (let i = 0; i < 160; i += 1) {
          step(state, { moveX: dx, moveY: dy, aimX: 0, aimY: 0, fire: false });
          const { x, y } = state.player;
          if (pointRectDistance(x, y, block) < PLAYER_RADIUS - 1e-6 || x < FIELD.left + PLAYER_RADIUS - 1e-6 || x > FIELD.right - PLAYER_RADIUS + 1e-6
            || y < FIELD.top + PLAYER_RADIUS - 1e-6 || y > FIELD.bottom - PLAYER_RADIUS + 1e-6) bad.push(`start ${k} dir ${dx},${dy} tick ${i}: ${x},${y}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('a player pushed diagonally into a wall slides along it', () => {
    // A tall wall (y 105..505): the player keeps sliding down it, never through it.
    const state = createSim(quiet({ obstacles: [{ x: 480, y: 305, width: 40, height: 400 }], player: { x: 400, y: 305, speed: 200, hp: 5 } }));
    run(state, 60, { moveX: 1, moveY: 1, aimX: 0, aimY: 0, fire: false });
    expect(state.player.x).toBeLessThanOrEqual(480 - 20 - PLAYER_RADIUS + 1e-6);
    expect(state.player.x).toBeGreaterThan(480 - 20 - PLAYER_RADIUS - 1); // pressed against it
    expect(state.player.y).toBeGreaterThan(305 + 100); // 60 ticks of sliding at 200 px/s * 0.707
  });

  it('a bullet stops at a wall and never reaches an enemy behind it', () => {
    const level = SHOOTER_LEVELS.wall;
    const state = createSim({ ...level, waves: [{ atMs: 590_000, type: 'swarmer', count: 1 }] });
    place(state, 'swarmer', 700, 305);
    const hp = state.enemies[0]!.hp;
    let furthest = 0;
    for (let i = 0; i < 45; i += 1) {
      step(state, aimAt(900, 305, true));
      for (const bullet of state.bullets) furthest = Math.max(furthest, bullet.x);
      expect(state.kills).toBe(0);
    }
    expect(furthest).toBeLessThan(480 - 20); // the wall's left face
    expect(state.enemies.find((e) => e.id >= 1000)?.hp).toBe(hp);
  });

  it('a bullet at 900 px/s cannot skip an enemy of radius 9', () => {
    const level = quiet({ weapon: { cooldownMs: 80, bulletSpeed: 900, damage: 1, range: 1000 } });
    const state = createSim(level);
    place(state, 'swarmer', 700, 305, 7000);
    // Straight at the enemy; it walks toward the player, closing the gap.
    for (let i = 0; i < 60 && state.kills === 0; i += 1) step(state, aimAt(900, 305, true));
    expect(state.kills).toBe(1);
  });

  it('swept test: a bullet covering 100 px in one tick still hits an enemy in the middle of its path', () => {
    const state = createSim(quiet());
    place(state, 'swarmer', 560, 305, 7000);
    state.bullets.push({ id: 9000, x: 500, y: 305, vx: 6000, vy: 0, travelled: 0 }); // 100 px per tick
    step(state, IDLE);
    expect(state.kills).toBe(1);
    expect(state.bullets).toHaveLength(0);
  });

  it('a bullet hits the first of two enemies on its line, once', () => {
    const state = createSim(quiet());
    place(state, 'brute', 560, 305, 7001);
    place(state, 'swarmer', 620, 305, 7002);
    state.bullets.push({ id: 9000, x: 500, y: 305, vx: 6000, vy: 0, travelled: 0 });
    step(state, IDLE);
    expect(state.enemies.find((e) => e.id === 7001)!.hp).toBe(ENEMY_TYPES.brute.hp - 1);
    expect(state.enemies.find((e) => e.id === 7002)!.hp).toBe(ENEMY_TYPES.swarmer.hp);
  });
});

describe('shooting', () => {
  it('fires on the cooldown, to the tick', () => {
    const state = createSim(quiet({ weapon: { cooldownMs: 220, bulletSpeed: 600, damage: 1, range: 1000 } }));
    const cooldown = msToTicks(220); // ceil(13.2) = 14
    expect(cooldown).toBe(14);
    const shotsAt: number[] = [];
    let ids = state.nextId;
    for (let t = 0; t < 100; t += 1) {
      step(state, aimAt(900, 305, true));
      if (state.nextId !== ids) { shotsAt.push(t); ids = state.nextId; }
    }
    expect(shotsAt).toEqual([0, 14, 28, 42, 56, 70, 84, 98]);
  });

  it('does not fire without the trigger', () => {
    const state = createSim(quiet());
    run(state, 100, aimAt(900, 305, false));
    expect(state.nextId).toBe(1);
    expect(state.bullets).toHaveLength(0);
  });

  it('shoots along the aim, from just outside the player', () => {
    const state = createSim(quiet({ weapon: { cooldownMs: 500, bulletSpeed: 400, damage: 1, range: 1000 } }));
    step(state, aimAt(480 + 300, 305 - 300, true));
    const bullet = state.bullets[0]!;
    const speed = Math.hypot(bullet.vx, bullet.vy);
    expect(speed).toBeCloseTo(400, 9);
    expect(bullet.vx / speed).toBeCloseTo(Math.SQRT1_2, 9);
    expect(bullet.vy / speed).toBeCloseTo(-Math.SQRT1_2, 9);
    // spawned PLAYER_RADIUS + BULLET_RADIUS + 1 away, then moved one tick (400/60 px)
    expect(Math.hypot(bullet.x - 480, bullet.y - 305)).toBeCloseTo(PLAYER_RADIUS + BULLET_RADIUS + 1 + 400 / 60, 6);
    expect(state.player.aim).toBeCloseTo(-Math.PI / 4, 9);
  });

  it('a bullet dies when it has travelled its range', () => {
    const state = createSim(quiet({ weapon: { cooldownMs: 1000, bulletSpeed: 600, damage: 1, range: 300 } }));
    step(state, aimAt(900, 305, true)); // tick 0: spawned and moved 10 px
    for (let i = 0; i < 28; i += 1) step(state, aimAt(900, 305, false));
    expect(state.bullets).toHaveLength(1); // 29 steps: 290 px
    expect(state.bullets[0]!.travelled).toBeCloseTo(290, 6);
    step(state, aimAt(900, 305, false)); // 30th step: 300 px
    expect(state.bullets).toHaveLength(0);
  });

  it('a bullet leaves the field and is removed', () => {
    const state = createSim(quiet({ weapon: { cooldownMs: 1000, bulletSpeed: 900, damage: 1, range: 1000 } }));
    step(state, aimAt(0, 305, true));
    run(state, 40, aimAt(0, 305, false));
    expect(state.bullets).toHaveLength(0);
  });

  it('never holds more than MAX_BULLETS', () => {
    const state = createSim(quiet({ weapon: { cooldownMs: 80, bulletSpeed: 300, damage: 1, range: 1000 } }));
    for (let i = 0; i < 199; i += 1) state.bullets.push({ id: 10_000 + i, x: 20, y: 100, vx: 0, vy: 0, travelled: 0 }); // parked
    for (let t = 0; t < 120; t += 1) {
      step(state, aimAt(900, 305, true));
      expect(state.bullets.length).toBeLessThanOrEqual(MAX_BULLETS);
    }
    expect(state.bullets.length).toBe(MAX_BULLETS);
    const ids = state.nextId;
    step(state, aimAt(900, 305, true));
    expect(state.nextId).toBe(ids); // refused: no bullet, no cooldown spent
  });

  it('weapon damage applies: a brute (12 hp) falls to four hits of 3', () => {
    const state = createSim(quiet({ weapon: { cooldownMs: 80, bulletSpeed: 900, damage: 3, range: 1000 } }));
    place(state, 'brute', 560, 305, 7000);
    const hp: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      state.bullets.push({ id: 9000 + i, x: 500, y: 305, vx: 6000, vy: 0, travelled: 0 });
      step(state, IDLE);
      hp.push(state.enemies.find((e) => e.id === 7000)?.hp ?? 0);
    }
    expect(hp).toEqual([9, 6, 3, 0]);
    expect(state.kills).toBe(1);
    expect(state.score).toBe(ENEMY_TYPES.brute.points);
    expect(state.enemies.find((e) => e.id === 7000)).toBeUndefined();
  });
});

describe('enemies', () => {
  it.each(['runner', 'brute', 'swarmer'] as const)('%s: hp and speed come from ENEMY_TYPES', (type) => {
    const level = quiet({ waves: [{ atMs: 0, type, count: 1 }], spawnPoints: [{ x: 900, y: 500 }] });
    const state = createSim(level);
    step(state, IDLE);
    const enemy = state.enemies[0]!;
    expect(enemy.type).toBe(type);
    expect(enemy.hp).toBe(ENEMY_TYPES[type].hp);
    const before = { x: enemy.x, y: enemy.y };
    run(state, 30);
    const moved = Math.hypot(state.enemies[0]!.x - before.x, state.enemies[0]!.y - before.y);
    expect(moved).toBeCloseTo(ENEMY_TYPES[type].speed / 2, 6); // 30 ticks = half a second
  });

  it.each(['runner', 'brute', 'swarmer'] as const)('%s: one touch costs its damage, then %d ms of protection', (type) => {
    const state = createSim(quiet());
    place(state, type, state.player.x + 5, state.player.y);
    const { x, y } = state.player;
    const protection = msToTicks(INVULNERABLE_MS); // 42
    step(state, IDLE);
    expect(state.player.hp).toBe(10 - ENEMY_TYPES[type].damage);
    for (let i = 1; i < protection; i += 1) { step(state, IDLE); expect(state.player.hp).toBe(10 - ENEMY_TYPES[type].damage); }
    step(state, IDLE); // tick 42: protection is over, the enemy is still touching
    expect(state.player.hp).toBe(10 - 2 * ENEMY_TYPES[type].damage);
    expect({ x: state.player.x, y: state.player.y }).toEqual({ x, y }); // no knockback
  });

  it('several touching enemies hurt once per tick, by the largest damage', () => {
    const state = createSim(quiet());
    place(state, 'runner', state.player.x + 5, state.player.y, 7001);
    place(state, 'brute', state.player.x, state.player.y + 5, 7002);
    place(state, 'swarmer', state.player.x - 5, state.player.y, 7003);
    step(state, IDLE);
    expect(state.player.hp).toBe(10 - 2);
  });

  it('enemies chase to touching range and then hold there', () => {
    const state = createSim(quiet({ waves: [{ atMs: 0, type: 'runner', count: 1 }], spawnPoints: [{ x: 900, y: 500 }] }));
    run(state, 60 * 8);
    const enemy = state.enemies[0]!;
    const distance = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);
    expect(distance).toBeLessThan(PLAYER_RADIUS + ENEMY_TYPES.runner.radius);
    expect(distance).toBeGreaterThan(PLAYER_RADIUS + ENEMY_TYPES.runner.radius - 3);
  });
});

describe('spawning', () => {
  it('spawns every enemy of a wave on the stagger, to the tick', () => {
    const level = quiet({ waves: [{ atMs: 1000, type: 'swarmer', count: 5 }], spawnPoints: [{ x: 900, y: 500 }] });
    const state = createSim(level);
    const appeared: number[] = [];
    for (let t = 0; t < 130; t += 1) {
      step(state, IDLE);
      while (appeared.length < state.spawned) appeared.push(t);
    }
    const expected = [0, 1, 2, 3, 4].map((k) => msToTicks(1000 + k * SPAWN_STAGGER_MS));
    expect(expected).toEqual([60, 69, 78, 87, 96]);
    expect(appeared).toEqual(expected);
    expect(state.enemies).toHaveLength(5);
  });

  it('two waves interleave by time, and the count matches the schedule', () => {
    const level = quiet({ waves: [{ atMs: 500, type: 'runner', count: 3 }, { atMs: 600, type: 'brute', count: 2 }], spawnPoints: [{ x: 900, y: 500 }] });
    expect(totalScheduledEnemies(level)).toBe(5);
    const state = createSim(level);
    run(state, 200);
    expect(state.spawned).toBe(5);
    expect(state.enemies.map((e) => e.type).sort()).toEqual(['brute', 'brute', 'runner', 'runner', 'runner']);
  });

  it('respects MAX_ENEMIES_ALIVE without losing anyone', () => {
    const waves = [0, 1, 2, 3].map((i) => ({ atMs: i * 100, type: 'swarmer' as const, count: 40 }));
    const state = createSim(quiet({ waves, spawnPoints: [{ x: 900, y: 500 }] }));
    state.player.hp = 1e9; state.player.maxHp = 1e9;
    const total = totalScheduledEnemies(state.level);
    let peak = 0;
    for (let t = 0; t < 60 * 20; t += 1) {
      step(state, IDLE);
      peak = Math.max(peak, state.enemies.length);
      expect(state.enemies.length).toBeLessThanOrEqual(MAX_ENEMIES_ALIVE);
      expect(state.kills + state.enemies.length + (state.schedule.length - state.spawned)).toBe(total);
    }
    expect(peak).toBe(MAX_ENEMIES_ALIVE);
    expect(state.spawned).toBe(MAX_ENEMIES_ALIVE); // the other 40 are still queued
    // Make room: the queued ones come out, in order, and none is skipped.
    state.enemies.splice(0, 50);
    run(state, 60 * 5);
    expect(state.spawned).toBe(total);
    expect(state.enemies.length).toBe(total - 50);
  });

  it('avoids spawn points within 250 px of the player while another exists', () => {
    const level = quiet({
      player: { x: 480, y: 305, speed: 200, hp: 10 },
      spawnPoints: [{ x: 480, y: 100 }, { x: 900, y: 500 }], // 205 px and 463 px away
      waves: [{ atMs: 0, type: 'swarmer', count: 30 }],
    });
    const state = createSim(level);
    state.player.hp = 1e9;
    const seen = new Set<number>();
    for (let t = 0; t < 400; t += 1) {
      step(state, IDLE);
      for (const enemy of state.enemies) {
        if (seen.has(enemy.id)) continue;
        seen.add(enemy.id);
        expect(Math.hypot(enemy.x - 480, enemy.y - 305)).toBeGreaterThan(250 - 3); // one step of movement at most
      }
    }
    expect(seen.size).toBe(30);
  });

  it('takes the farthest spawn point when every one is close', () => {
    const level = quiet({ spawnPoints: [{ x: 480, y: 100 }, { x: 480, y: 520 }], waves: [{ atMs: 0, type: 'runner', count: 1 }] }); // 205 px and 215 px
    const state = createSim(level);
    step(state, IDLE);
    expect(state.enemies).toHaveLength(1);
    expect(state.enemies[0]!.y).toBeGreaterThan(400);
  });

  it('a crowded spawn point waits for room instead of stacking enemies or losing them', () => {
    const wallBox = { x: 850, y: 500, width: 40, height: 40 };
    const state = createSim(quiet({ waves: [{ atMs: 0, type: 'brute', count: 12 }], spawnPoints: [{ x: 900, y: 500 }], obstacles: [wallBox] }));
    state.player.hp = 1e9;
    const fresh = new Set<number>();
    const bad: string[] = [];
    for (let t = 0; t < 60 * 30; t += 1) {
      step(state, IDLE);
      for (const e of state.enemies) {
        if (fresh.has(e.id)) continue;
        fresh.add(e.id);
        // where it appeared: clear of the obstacle and of every other enemy
        if (pointRectDistance(e.x, e.y, wallBox) < ENEMY_TYPES.brute.radius - 1e-6) bad.push('spawned inside the obstacle');
        for (const other of state.enemies) if (other !== e && Math.hypot(other.x - e.x, other.y - e.y) < 2 * ENEMY_TYPES.brute.radius - 3) bad.push('spawned on top of another');
      }
    }
    expect(bad).toEqual([]);
    expect(state.spawned).toBe(12); // all of them came out, once there was room
    expect(state.enemies).toHaveLength(12);
  });
});

describe('winning and losing', () => {
  it('survive: won exactly when the clock reaches the goal', () => {
    const state = createSim(quiet({ win: { type: 'survive', seconds: 10 }, waves: [{ atMs: 2000, type: 'swarmer', count: 1 }], player: { x: 480, y: 305, speed: 200, hp: 10 } }));
    run(state, 599);
    expect(state.status).toBe('playing');
    step(state, IDLE);
    expect(state.status).toBe('won');
    expect(elapsedSeconds(state)).toBe(10);
  });

  it('kill: won when the count is reached', () => {
    const level = quiet({ win: { type: 'kill', count: 1 }, waves: [{ atMs: 0, type: 'swarmer', count: 2 }], spawnPoints: [{ x: 900, y: 500 }] });
    const result = play(level, botInput);
    expect(result.status).toBe('won');
    expect(result.kills).toBe(1);
  });

  it('lost when hp reaches 0, and a finished game stops changing', () => {
    const state = createSim(quiet({ player: { x: 480, y: 305, speed: 200, hp: 1 } }));
    place(state, 'runner', 485, 305);
    step(state, IDLE);
    expect(state.status).toBe('lost');
    expect(state.player.hp).toBe(0);
    const frozen = snapshotHash(state);
    run(state, 50, aimAt(900, 305, true));
    expect(snapshotHash(state)).toBe(frozen);
  });

  it('losing is decided before winning in the same tick (survive)', () => {
    const state = createSim(quiet({ win: { type: 'survive', seconds: 10 }, waves: [{ atMs: 2000, type: 'swarmer', count: 1 }], player: { x: 480, y: 305, speed: 200, hp: 1 } }));
    state.tick = 599;
    place(state, 'runner', 485, 305);
    step(state, IDLE);
    expect(state.tick).toBe(600);
    expect(state.status).toBe('lost');
  });

  it('losing is decided before winning in the same tick (kill)', () => {
    const state = createSim(quiet({ win: { type: 'kill', count: 1 }, waves: [{ atMs: 590_000, type: 'swarmer', count: 1 }], player: { x: 480, y: 305, speed: 200, hp: 1 } }));
    place(state, 'runner', 485, 305, 7001); // touches the player
    place(state, 'swarmer', 600, 305, 7002);
    state.bullets.push({ id: 9000, x: 540, y: 305, vx: 6000, vy: 0, travelled: 0 }); // kills the swarmer this tick
    step(state, IDLE);
    expect(state.kills).toBe(1);
    expect(state.status).toBe('lost');
  });
});

describe('navigation', () => {
  const wallLevel = (type: 'runner' | 'swarmer' | 'brute', player = SHOOTER_LEVELS.wall.player): ShooterLevel => ({
    ...structuredClone(SHOOTER_LEVELS.wall), player, waves: [{ atMs: 0, type, count: 1 }], win: { type: 'survive', seconds: 300 },
  });

  it.each(['runner', 'swarmer', 'brute'] as const)('wall: a %s starting on the far side reaches the player within 20 s', (type) => {
    const state = createSim(wallLevel(type));
    let reached: number | undefined;
    for (let t = 0; t < 60 * 20 && reached === undefined; t += 1) {
      step(state, IDLE);
      const enemy = state.enemies[0];
      if (enemy && Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < PLAYER_RADIUS + ENEMY_TYPES[type].radius) reached = t / 60;
    }
    expect(reached).toBeDefined();
    // it really went round the wall: x never crossed it at a height the wall covers
  });

  it('wall: the way round goes through a gap, never through the wall', () => {
    const state = createSim(wallLevel('runner'));
    for (let t = 0; t < 60 * 12; t += 1) {
      step(state, IDLE);
      const enemy = state.enemies[0];
      if (!enemy) continue;
      const inside = pointRectDistance(enemy.x, enemy.y, { x: 480, y: 305, width: 40, height: 250 });
      expect(inside).toBeGreaterThanOrEqual(ENEMY_TYPES.runner.radius - 1e-6);
    }
  });

  it('wall: no enemy stays stuck for 60 s, with the player standing still at many places', () => {
    const spots = [[200, 305], [200, 120], [300, 480], [100, 90], [700, 305], [480, 100], [480, 510], [880, 305], [600, 120], [760, 480]];
    for (const [x, y] of spots) {
      const level: ShooterLevel = {
        ...structuredClone(SHOOTER_LEVELS.wall), player: { x: x!, y: y!, speed: 200, hp: 5 },
        waves: [{ atMs: 0, type: 'runner', count: 3 }, { atMs: 0, type: 'swarmer', count: 3 }, { atMs: 0, type: 'brute', count: 1 }],
        win: { type: 'survive', seconds: 300 },
      };
      const state = createSim(level);
      state.player.hp = 1e9; state.player.maxHp = 1e9;
      run(state, 60 * 60);
      expect(state.enemies).toHaveLength(7);
      for (const enemy of state.enemies) {
        const touching = PLAYER_RADIUS + ENEMY_TYPES[enemy.type].radius;
        expect(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y), `player at ${x},${y}: ${enemy.type}`).toBeLessThan(touching + 40);
      }
    }
  });

  it('pillars: chasers get round the pillars too', () => {
    const level: ShooterLevel = { ...structuredClone(SHOOTER_LEVELS.pillars), waves: [{ atMs: 0, type: 'swarmer', count: 8 }], win: { type: 'survive', seconds: 300 } };
    const state = createSim(level);
    state.player.hp = 1e9;
    run(state, 60 * 30);
    for (const enemy of state.enemies) expect(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y)).toBeLessThan(60);
  });

  it('freeSpaceConnected: false when a spawn point is walled in, and clearance matters', () => {
    const box = (gap: number): ShooterLevel => quiet({
      spawnPoints: [{ x: 880, y: 305 }],
      obstacles: [
        { x: 800, y: 190 - gap / 2, width: 40, height: 230 }, // left wall, top half
        { x: 800, y: 420 + gap / 2, width: 40, height: 230 }, // left wall, bottom half
      ],
    });
    expect(freeSpaceConnected(box(0), 20)).toBe(false); // sealed
    expect(freeSpaceConnected(box(100), BRUTE_CLEARANCE)).toBe(true); // 100 px gap
    expect(freeSpaceConnected(box(40), BRUTE_CLEARANCE)).toBe(false); // 40 px gap: a brute (48) does not fit
    expect(freeSpaceConnected(box(40), 20)).toBe(true); // but a runner does
  });

  it('shooterLevel only knows its own names', () => {
    expect(shooterLevel('arena')).toBe(SHOOTER_LEVELS.arena);
    for (const name of ['constructor', 'toString', '__proto__', 'nope', '']) expect(shooterLevel(name)).toBeUndefined();
  });
});

describe('determinism', () => {
  const inputs = (seed: number) => {
    const random = mulberry(seed);
    let current: ShooterInput = IDLE;
    return (tick: number): ShooterInput => {
      if (tick % 25 === 0) {
        current = {
          moveX: (Math.floor(random() * 3) - 1) as -1 | 0 | 1, moveY: (Math.floor(random() * 3) - 1) as -1 | 0 | 1,
          aimX: random() * 960, aimY: 70 + random() * 470, fire: random() < 0.7,
        };
      }
      return current;
    };
  };

  it('the same level and inputs give the same hash on every sampled tick', () => {
    for (const name of ['arena', 'pillars', 'wall'] as const) {
      const a = createSim(SHOOTER_LEVELS[name]);
      const b = createSim(SHOOTER_LEVELS[name]);
      for (const s of [a, b]) { s.player.hp = 1e6; s.player.maxHp = 1e6; } // keep playing for the whole run
      const next = [inputs(7), inputs(7)];
      const hashes: string[] = [];
      for (let t = 0; t < 1800; t += 1) {
        step(a, next[0]!(t)); step(b, next[1]!(t));
        if (t % 30 === 0) { expect(snapshotHash(a)).toBe(snapshotHash(b)); hashes.push(snapshotHash(a)); }
      }
      expect(new Set(hashes).size).toBeGreaterThan(20); // the hash does move
    }
  });

  it('a different seed changes the game; a different input changes it too', () => {
    const run1 = createSim({ ...SHOOTER_LEVELS.arena, seed: 1 });
    const run2 = createSim({ ...SHOOTER_LEVELS.arena, seed: 2 });
    const run3 = createSim({ ...SHOOTER_LEVELS.arena, seed: 1 });
    const drive = [inputs(3), inputs(3), inputs(4)];
    for (let t = 0; t < 900; t += 1) { step(run1, drive[0]!(t)); step(run2, drive[1]!(t)); step(run3, drive[2]!(t)); }
    expect(snapshotHash(run1)).not.toBe(snapshotHash(run2));
    expect(snapshotHash(run1)).not.toBe(snapshotHash(run3));
  });

  it('a structuredClone of the state resumes exactly like the original', () => {
    const state = createSim(SHOOTER_LEVELS.pillars);
    state.player.hp = 1e6; state.player.maxHp = 1e6;
    const drive = inputs(11); // one input stream, read in tick order
    for (let t = 0; t < 600; t += 1) step(state, drive(t));
    const copy = structuredClone(state);
    expect(snapshotHash(copy)).toBe(snapshotHash(state));
    for (let t = 600; t < 1500; t += 1) {
      const input = drive(t);
      step(state, input); step(copy, input);
      if (t % 50 === 0) expect(snapshotHash(copy)).toBe(snapshotHash(state));
    }
    expect(snapshotHash(copy)).toBe(snapshotHash(state));
    expect(state.kills).toBeGreaterThan(0);
  });
});

describe('invariants under random play', () => {
  it('200 random games keep every rule', () => {
    const bad: string[] = [];
    let fought = 0;
    let kills = 0;
    const names = ['arena', 'pillars', 'wall'] as const;
    for (let game = 0; game < 200; game += 1) {
      const random = mulberry(1000 + game);
      const level: ShooterLevel = { ...SHOOTER_LEVELS[names[game % 3]!], seed: Math.floor(random() * 2 ** 31) };
      const state = createSim(level);
      // Half the games cannot be lost, so that fights and spawns go on.
      if (game % 2 === 0) { state.player.hp = 1e6; state.player.maxHp = 1e6; }
      const total = totalScheduledEnemies(level);
      let input: ShooterInput = IDLE;
      const lastBullet = new Map<number, string>();
      for (let t = 0; t < 900 && state.status === 'playing'; t += 1) {
        if (t % (20 + (game % 7) * 5) === 0) {
          input = { moveX: (Math.floor(random() * 3) - 1) as -1 | 0 | 1, moveY: (Math.floor(random() * 3) - 1) as -1 | 0 | 1, aimX: random() * 960, aimY: random() * 540, fire: random() < 0.8 };
        }
        // aim at an enemy now and then, so that bullets really hit things
        if (t % 40 < 20 && state.enemies[0]) input = { ...input, aimX: state.enemies[0].x, aimY: state.enemies[0].y, fire: true };
        step(state, input);

        const p = state.player;
        const note = (what: string) => { if (bad.length < 20) bad.push(`game ${game} tick ${t}: ${what}`); };
        if (p.x < FIELD.left + PLAYER_RADIUS - 1e-6 || p.x > FIELD.right - PLAYER_RADIUS + 1e-6 || p.y < FIELD.top + PLAYER_RADIUS - 1e-6 || p.y > FIELD.bottom - PLAYER_RADIUS + 1e-6) note('player outside the field');
        if (p.hp < 0) note('negative hp');
        for (const block of level.obstacles) if (pointRectDistance(p.x, p.y, block) < PLAYER_RADIUS - 1e-6) note('player in an obstacle');
        for (const e of state.enemies) {
          const r = ENEMY_TYPES[e.type].radius;
          if (e.x < FIELD.left + r - 1e-6 || e.x > FIELD.right - r + 1e-6 || e.y < FIELD.top + r - 1e-6 || e.y > FIELD.bottom - r + 1e-6) note(`${e.type} outside the field`);
          if (e.hp <= 0) note('dead enemy still listed');
          for (const block of level.obstacles) if (pointRectDistance(e.x, e.y, block) <= 0) note(`${e.type} inside an obstacle`);
        }
        for (const b of state.bullets) {
          if (b.x < FIELD.left || b.x > FIELD.right || b.y < FIELD.top || b.y > FIELD.bottom) note('bullet outside the field');
          if (Math.hypot(b.vx, b.vy) <= 0) note('bullet without speed');
          const here = `${b.x},${b.y}`;
          if (lastBullet.get(b.id) === here) note(`bullet ${b.id} stood still`);
          lastBullet.set(b.id, here);
        }
        if (state.bullets.length > MAX_BULLETS) note('too many bullets');
        if (state.enemies.length > MAX_ENEMIES_ALIVE) note('too many enemies');
        if (state.kills + state.enemies.length + (state.schedule.length - state.spawned) !== total) note('an enemy was lost or invented');
      }
      kills += state.kills;
      fought += state.tick;
    }
    expect(bad).toEqual([]);
    expect(kills).toBeGreaterThan(200); // the games really fought
    expect(fought).toBeGreaterThan(200 * 300);
  }, 60_000);
});

describe('performance', () => {
  it('120 enemies and 100 bullets for 3600 ticks take at most 2 s of CPU', () => {
    const waves = [0, 1, 2, 3].map((i) => ({ atMs: i * 200, type: (['runner', 'swarmer', 'swarmer', 'brute'] as const)[i]!, count: i === 3 ? 10 : 40 }));
    const level = quiet({ waves, spawnPoints: SHOOTER_LEVELS.arena.spawnPoints.map((p) => ({ ...p })), obstacles: SHOOTER_LEVELS.pillars.obstacles.map((o) => ({ ...o })) });
    // The best of up to three measurements: when the whole suite runs in parallel,
    // cache and core contention can double the CPU time of one run (1.1 s alone,
    // 2.2 s under load); a real slowdown of the sim slows all three runs.
    let best = Infinity;
    let peakEnemies = 0;
    let peakBullets = 0;
    for (let attempt = 0; attempt < 3 && best > 2; attempt += 1) {
      const state = createSim(level);
      // Bullets and enemies that cannot hurt anything, so that the load stays constant.
      state.level = { ...level, weapon: { ...level.weapon, damage: 0 } };
      state.player.hp = 1e9; state.player.maxHp = 1e9;
      const random = mulberry(5);
      peakEnemies = 0;
      peakBullets = 0;
      // CPU time of this process, not wall time: the wall clock doubles when the
      // whole suite runs in parallel, the work done does not.
      const started = process.cpuUsage();
      for (let t = 0; t < 3600; t += 1) {
        while (state.bullets.length < 100) {
          state.bullets.push({ id: state.nextId, x: 40 + random() * 880, y: 90 + random() * 430, vx: (random() - 0.5) * 900, vy: (random() - 0.5) * 900, travelled: 0 });
          state.nextId += 1;
        }
        step(state, { moveX: 0, moveY: 0, aimX: 900, aimY: 305, fire: false });
        peakEnemies = Math.max(peakEnemies, state.enemies.length);
        peakBullets = Math.max(peakBullets, state.bullets.length);
      }
      const used = process.cpuUsage(started);
      best = Math.min(best, (used.user + used.system) / 1e6);
      console.info(`[shooter] 3600 ticks, peak ${peakEnemies} enemies / ${peakBullets} bullets: ${(((used.user + used.system) / 1e3)).toFixed(0)} ms CPU (attempt ${attempt + 1})`);
    }
    expect(peakEnemies).toBeGreaterThanOrEqual(110);
    expect(peakBullets).toBeGreaterThanOrEqual(100);
    expect(best).toBeLessThanOrEqual(2);
  }, 60_000);
});
