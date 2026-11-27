import { describe, expect, it } from 'vitest';
import {
  BASE_CLEARANCE, BASE_SIZE, botInput as botInputFor, BASE_TUNING, ENEMY_TYPES, PLAYER_RADIUS, SHOOTER_LEVELS, ShooterLevelSchema, baseRectOf, cellOf, createSim, msToTicks, pointRectDistance, snapshotHash, step,
  type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { IDLE_INPUT, fireAt, place, quietLevel, run, weaponOf } from './shooter-4b-helpers.js';

const siege = (patch: Partial<ShooterLevel> = {}): ShooterLevel => ({ ...structuredClone(SHOOTER_LEVELS['base-siege']), ...patch });
const problems = (level: unknown) => {
  const result = ShooterLevelSchema.safeParse(level);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

/** A quiet field with a base in the middle (480, 305), the player on its left, one far spawn point, and nothing scheduled soon. */
const baseLevel = (patch: Partial<ShooterLevel> = {}, hp = 100): ShooterLevel => quietLevel({
  player: { x: 416, y: 305, speed: 210, hp: 10 }, spawnPoints: [{ x: 880, y: 305 }], obstacles: [], base: { x: 480, y: 305, hp }, ...patch,
});
const rectOf = (state: ShooterState) => baseRectOf(state.level.base!);
/** Puts an enemy in by hand; `aim` is who it goes for (true: the base, false: the player), or null for an enemy with no target of its own. */
const withBase = (state: ShooterState, x: number, y: number, type: Parameters<typeof place>[1], aim: boolean | null = true) => {
  place(state, type, x, y);
  const enemy = state.enemies[state.enemies.length - 1]!;
  if (aim !== null) enemy.aimAtBase = aim;
  return enemy;
};
/** The player far from the enemies of the test (so that they go for the base): by default in the bottom right corner. */
const farPlayer = (state: ShooterState, x = 900, y = 500) => { state.player.x = x; state.player.y = y; state.player.invulnerableUntilTick = 1e9; };

describe('the base in the level schema', () => {
  it('a base with hit points 5..200 is valid; 4 and 201 are not; nothing else may be in it', () => {
    expect(problems(siege())).toEqual([]);
    for (const hp of [5, 200]) expect(problems(siege({ base: { x: 480, y: 305, hp } })), String(hp)).toEqual([]);
    for (const hp of [4, 201, 20.5]) expect(problems(siege({ base: { x: 480, y: 305, hp } })).join('|'), String(hp)).toContain('base.hp');
    expect(problems({ ...siege(), base: { x: 480, y: 305, hp: 20, color: 'red' } }).length).toBeGreaterThan(0);
    expect(BASE_SIZE).toBe(56);
    expect(BASE_CLEARANCE).toBe(48);
  });

  it('a level without a base is as valid as ever, and the 10 hand levels of before are still valid', () => {
    const { base: _base, ...old } = siege();
    void _base;
    expect(problems({ ...old, player: { x: 480, y: 305, speed: 210, hp: 5 } })).toEqual([]);
    for (const [name, level] of Object.entries(SHOOTER_LEVELS)) expect(problems(level), name).toEqual([]);
  });

  it('refuses a base too near the edge of the field', () => {
    for (const base of [{ x: 40, y: 305 }, { x: 920, y: 305 }, { x: 480, y: 100 }, { x: 480, y: 520 }]) {
      expect(problems(siege({ base: { ...base, hp: 20 }, obstacles: [] })).join('|'), JSON.stringify(base)).toContain('Căn cứ nằm quá sát mép vùng chơi.');
    }
  });

  it('refuses an obstacle nearer than 48 px to the base, or on it', () => {
    const near = (x: number) => siege({ obstacles: [{ x, y: 305, width: 60, height: 60 }] });
    expect(problems(near(600))).toEqual([]); // gap 62
    expect(problems(near(580)).join('|')).toContain('obstacles.0: Vật cản nằm quá gần căn cứ.'); // gap 42
    expect(problems(near(520)).join('|')).toContain('Vật cản nằm quá gần căn cứ.'); // overlapping
    // a diagonal neighbour is measured corner to corner
    expect(problems(siege({ obstacles: [{ x: 585, y: 410, width: 60, height: 60 }] }))).toEqual([]);
    expect(problems(siege({ obstacles: [{ x: 545, y: 370, width: 60, height: 60 }] })).join('|')).toContain('Vật cản nằm quá gần căn cứ.');
  });

  it('refuses a player on the base or next to it', () => {
    expect(problems(siege({ player: { x: 480, y: 305, speed: 210, hp: 5 } })).join('|')).toContain('player: Người chơi nằm trong hoặc sát căn cứ.');
    expect(problems(siege({ player: { x: 470, y: 340, speed: 210, hp: 5 } })).join('|')).toContain('Người chơi nằm trong hoặc sát căn cứ.');
    expect(problems(siege({ player: { x: 420, y: 305, speed: 210, hp: 5 } }))).toEqual([]); // 32 px from the square
  });

  it('refuses a spawn point nearer than 200 px to the base, or in it', () => {
    expect(problems(siege({ spawnPoints: [{ x: 40, y: 110 }, { x: 480, y: 160 }] })).join('|')).toContain('spawnPoints.1: Điểm xuất hiện của quái quá gần căn cứ.');
    expect(problems(siege({ spawnPoints: [{ x: 480, y: 305 }, { x: 40, y: 110 }] })).join('|')).toContain('spawnPoints.0: Điểm xuất hiện của quái nằm trong hoặc sát căn cứ.');
    expect(problems(siege({ spawnPoints: [{ x: 880, y: 305 }] }))).toEqual([]);
  });
});

describe('a level without a base is untouched', () => {
  it('its walls ARE its obstacles (the same array), and nothing of the base exists', () => {
    for (const name of ['arena', 'pillars', 'boss-crusher', 'medic'] as const) {
      const level = SHOOTER_LEVELS[name];
      const state = createSim(level);
      expect(state.walls, name).toBe(level.obstacles);
      run(state, 900, (s) => ({ moveX: 0, moveY: 0, aimX: s.player.x + 1, aimY: s.player.y, fire: false }));
      expect('base' in state || 'baseRect' in state || 'baseFlow' in state || 'lostBy' in state, name).toBe(false);
      expect(state.enemies.some((e) => 'aimAtBase' in e), name).toBe(false);
    }
  });

  it('with a base the walls are the obstacles and, last, the base square (and the obstacles are not changed)', () => {
    const level = siege();
    const before = JSON.stringify(level.obstacles);
    const state = createSim(level);
    expect(state.walls).toHaveLength(level.obstacles.length + 1);
    expect(state.walls.slice(0, -1)).toEqual(level.obstacles);
    expect(state.walls[state.walls.length - 1]).toEqual({ x: 480, y: 305, width: BASE_SIZE, height: BASE_SIZE });
    expect(state.baseRect).toBe(state.walls[state.walls.length - 1]);
    expect(JSON.stringify(level.obstacles)).toBe(before);
    expect(state.base).toEqual({ x: 480, y: 305, hp: 100, maxHp: 100, nextHitTick: 0, lastHitTick: -1000 });
  });
});

describe('the base is a wall', () => {
  it('the player cannot walk into it and slides along its side', () => {
    const state = createSim(baseLevel());
    run(state, 200, { moveX: 1, moveY: 0, aimX: 960, aimY: 305, fire: false });
    expect(state.player.x).toBeCloseTo(452 - PLAYER_RADIUS, 3);
    // walking up and to the right: it slides up the side and then over the top, and is never inside
    let highest = 305;
    for (let i = 0; i < 60; i += 1) {
      step(state, { moveX: 1, moveY: -1, aimX: 960, aimY: 305, fire: false });
      expect(pointRectDistance(state.player.x, state.player.y, rectOf(state))).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-6);
      highest = Math.min(highest, state.player.y);
    }
    expect(highest).toBeLessThan(305 - 28);
  });

  it('an enemy that goes for the player does not pass through it, and finds its way round', () => {
    const state = createSim(baseLevel());
    state.player.x = 580; state.player.y = 305;
    const enemy = withBase(state, 380, 305, 'runner', null); // no target of its own: an enemy of the old kind
    const rect = rectOf(state);
    let nearest = Infinity;
    for (let i = 0; i < 700; i += 1) {
      step(state, IDLE_INPUT);
      expect(pointRectDistance(enemy.x, enemy.y, rect)).toBeGreaterThanOrEqual(ENEMY_TYPES.runner.radius - 1e-6);
      nearest = Math.min(nearest, Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y));
      if (state.status !== 'playing') break;
    }
    expect(nearest).toBeLessThan(40);
  });

  it('the player\'s bullets stop at it: an enemy behind it is safe, and the base does not lose a point', () => {
    const state = createSim(baseLevel({ weapon: weaponOf({ cooldownMs: 100 }) }));
    const target = withBase(state, 640, 305, 'brute', null);
    target.hp = 50;
    state.player.invulnerableUntilTick = 1e9;
    for (let i = 0; i < 90; i += 1) {
      step(state, fireAt(640, 305));
      target.x = 640; target.y = 305; // hold it still
    }
    expect(target.hp).toBe(50);
    expect(state.base!.hp).toBe(100);
  });

  it('it blocks the view: a shooter behind it cannot see the player, so it does not fire', () => {
    const state = createSim(baseLevel());
    state.player.x = 416; state.player.y = 305;
    const spitter = withBase(state, 560, 305, 'spitter', null);
    spitter.nextShotTick = 0;
    run(state, 12); // (it walks round the base after that, and then it does see the player)
    expect(state.enemyBullets).toHaveLength(0);
    expect(spitter.nextShotTick).toBe(0); // it is ready to fire and waits for a clear view
  });
});

describe('who an enemy goes for', () => {
  const spawnOne = (playerAt: { x: number; y: number }, spawnAt: { x: number; y: number }) => {
    const level = baseLevel({ player: { ...playerAt, speed: 210, hp: 10 }, spawnPoints: [spawnAt], waves: [{ atMs: 0, type: 'runner', count: 1 }] });
    const state = createSim(level);
    step(state, IDLE_INPUT);
    return state.enemies[0]!;
  };

  it('on the way in: the nearer of the base center and the player; on a tie, the player', () => {
    expect(spawnOne({ x: 416, y: 305 }, { x: 880, y: 305 }).aimAtBase).toBe(true); // 400 to the base, 464 to the player
    expect(spawnOne({ x: 700, y: 150 }, { x: 880, y: 305 }).aimAtBase).toBe(false); // 237 to the player
    expect(spawnOne({ x: 275, y: 100 }, { x: 480, y: 100 }).aimAtBase).toBe(false); // 205 and 205
  });

  it('a boss goes for the player only: it has no target of its own, before or after a long time', () => {
    const level = baseLevel({ spawnPoints: [{ x: 880, y: 305 }], waves: [{ atMs: 0, type: 'crusher', count: 1 }], win: { type: 'boss' } });
    const state = createSim(level);
    step(state, IDLE_INPUT);
    const crusher = state.enemies[0]!;
    expect(crusher.aimAtBase).toBeUndefined();
    const before = Math.hypot(crusher.x - state.player.x, crusher.y - state.player.y);
    state.player.hp = 1000;
    run(state, 240);
    expect(crusher.aimAtBase).toBeUndefined();
    expect(Math.hypot(crusher.x - state.player.x, crusher.y - state.player.y)).toBeLessThan(before);
  });

  it('it changes its mind only when the other target is at least TARGET_SWITCH_MARGIN px nearer than the current one', () => {
    const margin = BASE_TUNING.targetSwitchMargin;
    expect(margin).toBeGreaterThanOrEqual(30);
    expect(margin).toBeLessThanOrEqual(100);
    // the enemy at (300, 305) is 180 px from the base center; the player stands to its left, `away` px from it
    const aim = (current: boolean, away: number) => {
      const state = createSim(baseLevel());
      state.player.x = 300 - away; state.player.y = 305; state.player.invulnerableUntilTick = 1e9;
      const enemy = withBase(state, 300, 305, 'brute', current);
      step(state, IDLE_INPUT);
      return enemy.aimAtBase;
    };
    expect(aim(false, 180 + margin - 1)).toBe(false); // only margin - 1 nearer
    expect(aim(false, 180 + margin)).toBe(true); // exactly margin nearer
  });

  it('the margin works both ways: from the base back to the player', () => {
    const margin = BASE_TUNING.targetSwitchMargin;
    const aim = (away: number) => {
      const state = createSim(baseLevel());
      state.player.x = 300 - away; state.player.y = 305; state.player.invulnerableUntilTick = 1e9;
      const enemy = withBase(state, 300, 305, 'brute', true); // 180 from the base center
      step(state, IDLE_INPUT);
      return enemy.aimAtBase;
    };
    expect(aim(180 - margin + 1)).toBe(true); // only margin - 1 nearer than the base
    expect(aim(180 - margin)).toBe(false); // exactly margin nearer: it turns to the player
    expect(aim(40)).toBe(false);
  });

  it('an enemy that goes for the base follows the player when the player draws it away', () => {
    const state = createSim(baseLevel());
    const enemy = withBase(state, 300, 305, 'brute', true);
    state.player.invulnerableUntilTick = 1e9;
    state.player.x = 150; state.player.y = 305; // 150 from the enemy, 180 from the base: only 30 nearer
    step(state, IDLE_INPUT);
    expect(enemy.aimAtBase).toBe(true);
    state.player.x = 280; // 20 from the enemy
    step(state, IDLE_INPUT);
    expect(enemy.aimAtBase).toBe(false);
  });
});

describe('going to the base and touching it', () => {
  it('goes round an obstacle by the base\'s own field, stops where it touches, and never goes in', () => {
    const level = baseLevel({ obstacles: [{ x: 350, y: 305, width: 40, height: 300 }] });
    const state = createSim(level);
    farPlayer(state);
    const enemy = withBase(state, 200, 305, 'runner', true);
    const rect = rectOf(state);
    const radius = ENEMY_TYPES.runner.radius;
    let touchedAt = -1;
    let wentAround = false;
    for (let i = 0; i < 1200 && touchedAt < 0; i += 1) {
      step(state, IDLE_INPUT);
      expect(state.walls.slice(0, -1).every((block) => pointRectDistance(enemy.x, enemy.y, block) >= radius - 1e-6)).toBe(true);
      expect(pointRectDistance(enemy.x, enemy.y, rect)).toBeGreaterThanOrEqual(radius - 1e-6);
      if (enemy.y < 150 || enemy.y > 460) wentAround = true;
      if (pointRectDistance(enemy.x, enemy.y, rect) <= radius + 1) touchedAt = i;
    }
    expect(wentAround).toBe(true);
    expect(touchedAt).toBeGreaterThan(0);
    const at = { x: enemy.x, y: enemy.y };
    run(state, 60);
    expect(Math.hypot(enemy.x - at.x, enemy.y - at.y)).toBeLessThan(1.5); // it stays put, touching
    expect(pointRectDistance(enemy.x, enemy.y, rect)).toBeGreaterThanOrEqual(radius - 1e-6);
  });

  it('the base\'s field is made once, with no block for the base, while the main grid has it', () => {
    const state = createSim(siege());
    const field = state.baseFlow!;
    const insideBase = cellOf(480 + 20, 305);
    expect(state.blocked[insideBase]).toBe(true);
    expect(field.blocked[insideBase]).toBe(false);
    expect(field.dist[cellOf(480, 305)]).toBe(0);
    expect(field.dist[cellOf(40, 110)]).toBeGreaterThan(0);
    farPlayer(state);
    run(state, 600);
    expect(state.baseFlow).toBe(field);
    expect(state.baseFlow!.dist).toBe(field.dist);
  });

  it('a shooting enemy that goes for the base stops at its hold range, fires at the center on its cooldown, and the shots hurt the base', () => {
    const ranged = ENEMY_TYPES.spitter.ranged;
    const state = createSim(baseLevel({}, 100));
    farPlayer(state);
    farPlayer(state, 60, 500);
    const spitter = withBase(state, 780, 305, 'spitter', true);
    spitter.nextShotTick = 0;
    run(state, 400);
    expect(Math.hypot(spitter.x - 480, spitter.y - 305)).toBeLessThanOrEqual(ranged.holdRange + 1);
    expect(Math.hypot(spitter.x - 480, spitter.y - 305)).toBeGreaterThan(ranged.holdRange - ENEMY_TYPES.spitter.speed / 60 - 1);
    const rest = { x: spitter.x, y: spitter.y };
    state.player.invulnerableUntilTick = 1e9;
    const shots: number[] = [];
    let last = spitter.nextShotTick!;
    for (let i = 0; i < 700; i += 1) {
      step(state, IDLE_INPUT);
      if (spitter.nextShotTick !== last) { shots.push(state.tick - 1); last = spitter.nextShotTick!; }
    }
    expect(spitter.x).toBe(rest.x);
    expect(spitter.y).toBe(rest.y);
    expect(shots.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < shots.length; i += 1) expect(shots[i]! - shots[i - 1]!).toBe(msToTicks(ranged.cooldownMs));
    expect(state.base!.hp).toBeLessThan(100);
    expect(100 - state.base!.hp).toBeGreaterThanOrEqual((shots.length - 1) * ranged.bulletDamage); // every shot that arrived took its damage (the last may still be flying)
    expect(Number.isInteger(state.base!.hp)).toBe(true);
  });

  it('the first bullet is aimed straight at the center of the base', () => {
    const state = createSim(baseLevel({ obstacles: [] }));
    farPlayer(state);
    farPlayer(state, 60, 500);
    const spitter = withBase(state, 700, 450, 'spitter', true);
    spitter.nextShotTick = 0;
    let bullet: ShooterState['enemyBullets'][number] | undefined;
    for (let i = 0; i < 600 && !bullet; i += 1) { step(state, IDLE_INPUT); bullet = state.enemyBullets[0]; }
    expect(bullet).toBeDefined();
    const speed = Math.hypot(bullet!.vx, bullet!.vy);
    const toCenterX = 480 - spitter.x;
    const toCenterY = 305 - spitter.y;
    const length = Math.hypot(toCenterX, toCenterY);
    expect(bullet!.vx / speed).toBeCloseTo(toCenterX / length, 3);
    expect(bullet!.vy / speed).toBeCloseTo(toCenterY / length, 3);
  });
});

describe('what hurts the base', () => {
  it('a touching brute hurts it by exactly 2 every BASE_HIT_INTERVAL_MS', () => {
    const every = msToTicks(BASE_TUNING.hitIntervalMs);
    expect(BASE_TUNING.hitIntervalMs).toBeGreaterThanOrEqual(300);
    expect(BASE_TUNING.hitIntervalMs).toBeLessThanOrEqual(800);
    const state = createSim(baseLevel({}, 100));
    farPlayer(state);
    withBase(state, 480 + 28 + 20, 305, 'brute', true);
    const seen: number[] = [];
    let hp = 100;
    for (let i = 0; i < 4 * every + 5; i += 1) {
      step(state, IDLE_INPUT);
      if (state.base!.hp !== hp) { seen.push(state.tick - 1); expect(hp - state.base!.hp).toBe(ENEMY_TYPES.brute.damage); hp = state.base!.hp; }
    }
    expect(seen).toEqual([0, every, 2 * every, 3 * every, 4 * every]);
    expect(state.base!.lastHitTick).toBe(4 * every);
  });

  it('the damage of every enemy that touches it is added up, whoever it is going for', () => {
    const state = createSim(baseLevel({}, 100));
    farPlayer(state);
    withBase(state, 480 + 28 + 20, 305, 'brute', true); // 2
    withBase(state, 480 - 28 - 20, 305, 'brute', false); // 2: going for the player, touching the base all the same
    withBase(state, 480, 305 - 28 - 11, 'runner', true); // 1
    step(state, IDLE_INPUT);
    expect(state.base!.hp).toBe(100 - 5);
  });

  it('with nothing touching it nothing happens, and the interval does not start', () => {
    const state = createSim(baseLevel({}, 100));
    farPlayer(state);
    withBase(state, 700, 450, 'brute', false);
    run(state, 100);
    expect(state.base!.hp).toBe(100);
    expect(state.base!.nextHitTick).toBe(0);
    expect(state.base!.lastHitTick).toBe(-1000);
  });

  it('a boss that touches it hurts it like any enemy', () => {
    const state = createSim(baseLevel({ waves: [{ atMs: 0, type: 'crusher', count: 1 }], win: { type: 'boss' } }, 100));
    state.player.x = 900; state.player.y = 305; state.player.hp = 1000; state.player.invulnerableUntilTick = 1e9;
    place(state, 'crusher', 480 + 28 + 33, 305);
    step(state, IDLE_INPUT);
    expect(state.base!.hp).toBe(100 - ENEMY_TYPES.crusher.damage);
  });

  const shot = (x: number, y: number, vx: number, vy: number, damage: number) => ({ id: 9001, x, y, vx, vy, travelled: 0, damage, radius: 5, range: 600 });

  it('an enemy bullet that reaches it hurts it at once by its own damage, and is gone', () => {
    const state = createSim(baseLevel({}, 100));
    farPlayer(state);
    state.enemyBullets.push(shot(700, 305, -300, 0, 3));
    let tick = 0;
    while (state.enemyBullets.length > 0 && tick < 200) { step(state, IDLE_INPUT); tick += 1; }
    expect(state.base!.hp).toBe(97);
    expect(state.enemyBullets).toHaveLength(0);
    expect(state.base!.lastHitTick).toBe(state.tick - 1);
    expect(state.base!.nextHitTick).toBe(0); // not the 500 ms window of touching
    state.enemyBullets.push(shot(700, 305, -300, 0, 2), shot(700, 305, -300, 0, 1));
    run(state, 60);
    expect(state.base!.hp).toBe(97 - 3);
  });

  it('a bullet that meets another wall first is stopped by it and the base takes nothing', () => {
    const state = createSim(baseLevel({ obstacles: [{ x: 600, y: 305, width: 30, height: 200 }] }, 100));
    farPlayer(state);
    state.enemyBullets.push(shot(760, 305, -300, 0, 3));
    run(state, 100);
    expect(state.enemyBullets).toHaveLength(0);
    expect(state.base!.hp).toBe(100);
  });

  it('a bullet that is spent on the base does not need the player to be unprotected, and does not touch the player', () => {
    const state = createSim(baseLevel({}, 100));
    state.player.x = 900; state.player.y = 305; state.player.invulnerableUntilTick = 1e9;
    const before = state.player.hp;
    state.enemyBullets.push(shot(700, 305, -300, 0, 2));
    run(state, 100);
    expect(state.base!.hp).toBe(98);
    expect(state.player.hp).toBe(before);
  });
});

describe('losing', () => {
  const brief = (state: ShooterState) => ({ status: state.status, lostBy: state.lostBy });

  it('the base at zero loses the game, by the base', () => {
    const state = createSim(baseLevel());
    state.base!.hp = 0;
    step(state, IDLE_INPUT);
    expect(brief(state)).toEqual({ status: 'lost', lostBy: 'base' });
  });

  it('the player falling loses the game, by the player; on the same tick as the base, by the player', () => {
    const a = createSim(baseLevel());
    a.player.hp = 0;
    step(a, IDLE_INPUT);
    expect(brief(a)).toEqual({ status: 'lost', lostBy: 'player' });
    const b = createSim(baseLevel());
    b.player.hp = 0; b.base!.hp = 0;
    step(b, IDLE_INPUT);
    expect(brief(b)).toEqual({ status: 'lost', lostBy: 'player' });
  });

  it('losing comes before winning: on the last tick of a survive level the base falling still loses', () => {
    const level = baseLevel({ win: { type: 'survive', seconds: 10 } });
    const state = createSim(level);
    state.tick = 599;
    state.base!.hp = 0;
    step(state, IDLE_INPUT);
    expect(state.tick).toBe(600);
    expect(brief(state)).toEqual({ status: 'lost', lostBy: 'base' });
    const winning = createSim(level);
    winning.tick = 599;
    step(winning, IDLE_INPUT);
    expect(brief(winning)).toEqual({ status: 'won', lostBy: undefined });
  });

  it('a win needs the base still standing: a kill goal reached on the tick the base falls is a loss', () => {
    const state = createSim(baseLevel({ win: { type: 'kill', count: 1 } }));
    state.kills = 1;
    state.base!.hp = 0;
    step(state, IDLE_INPUT);
    expect(brief(state)).toEqual({ status: 'lost', lostBy: 'base' });
  });

  it('nothing heals the base', () => {
    const state = createSim(baseLevel({}, 50));
    state.base!.hp = 7;
    state.pickups.push({ id: 5000, x: 416, y: 305, expiresTick: 1e9 });
    state.player.hp = 3;
    run(state, 200);
    expect(state.base!.hp).toBe(7);
  });
});

describe('the base is deterministic and uses no random numbers', () => {
  it('the same level gives the same hash, tick by tick', () => {
    const play = () => {
      const state = createSim(siege());
      const hashes: string[] = [];
      for (let i = 0; i < 1200; i += 1) {
        step(state, { moveX: i % 200 < 100 ? 1 : -1, moveY: 0, aimX: 480, aimY: 305, fire: i % 3 === 0 });
        if (i % 100 === 0) hashes.push(snapshotHash(state));
      }
      return hashes;
    };
    expect(play()).toEqual(play());
  });

  it('with or without a base the random numbers drawn are the same: only the spawns draw', () => {
    const waves: ShooterLevel['waves'] = [{ atMs: 0, type: 'runner', count: 3 }, { atMs: 1000, type: 'swarmer', count: 4 }];
    const run200 = (level: ShooterLevel) => {
      const state = createSim(level);
      state.player.x = 900; state.player.y = 505; state.player.hp = 1000; state.player.invulnerableUntilTick = 1e9;
      run(state, 300);
      return state;
    };
    const withIt = run200(baseLevel({ waves }));
    const without = run200(quietLevel({ player: { x: 416, y: 305, speed: 210, hp: 10 }, spawnPoints: [{ x: 880, y: 305 }], obstacles: [], waves }));
    expect(withIt.spawned).toBe(7);
    expect(without.spawned).toBe(7);
    expect(withIt.rng).toBe(without.rng);
    expect(withIt.nextId).toBe(without.nextId);
  });
});

describe('the three hand-made base levels', () => {
  const names = ['base-siege', 'base-boss', 'base-fall'] as const;

  it('are valid levels with a base, and the schema accepts them as they are', () => {
    for (const name of names) {
      const level = SHOOTER_LEVELS[name];
      expect(problems(level), name).toEqual([]);
      expect(level.base, name).toBeDefined();
    }
    expect(SHOOTER_LEVELS['base-fall'].base!.hp).toBe(5);
    expect(SHOOTER_LEVELS['base-boss'].win.type).toBe('boss');
  });

  it('base-fall: the base is the weak point, so it falls first while the player is still alive (whoever plays)', () => {
    for (const lostBy of ['idle', 'expert'] as const) {
      const state = createSim(structuredClone(SHOOTER_LEVELS['base-fall']));
      const decide = lostBy === 'idle' ? () => IDLE_INPUT : botInputFor;
      while (state.status === 'playing' && state.tick < 60 * 120) step(state, decide(state));
      expect(state.status, lostBy).toBe('lost');
      expect(state.lostBy, lostBy).toBe('base');
      expect(state.base!.hp, lostBy).toBe(0);
      expect(state.player.hp, lostBy).toBeGreaterThan(0);
    }
  });

  it('base-siege and base-boss: standing still loses by the player falling, not by the base', () => {
    for (const name of ['base-siege', 'base-boss'] as const) {
      const state = createSim(structuredClone(SHOOTER_LEVELS[name]));
      while (state.status === 'playing' && state.tick < 60 * 120) step(state, IDLE_INPUT);
      expect(state.status, name).toBe('lost');
      expect(state.lostBy, name).toBe('player');
      expect(state.base!.hp, name).toBeGreaterThan(0);
    }
  });
});
