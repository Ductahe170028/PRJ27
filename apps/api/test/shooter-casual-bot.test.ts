import { describe, expect, it, vi } from 'vitest';
import {
  CASUAL, FIELD, PLAYER_RADIUS, SHOOTER_LEVELS, botInput, createCasualBot, createSim, playLevel, snapshotHash, step,
  type CasualParams, type ShooterInput, type ShooterLevel, type ShooterState,
} from '@game-creator/contracts';
import { ShooterBriefSchema } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';

vi.setConfig({ testTimeout: 120_000 });

// A quiet field: the player in the middle, nothing scheduled for a long time.
const quiet = (patch: Partial<ShooterLevel> = {}): ShooterLevel => ({
  ...structuredClone(SHOOTER_LEVELS['smoke-win']),
  waves: [{ atMs: 590_000, type: 'swarmer', count: 1 }], win: { type: 'survive', seconds: 300 }, ...patch,
});
const withEnemies = (level: ShooterLevel, at: Array<[number, number]>): ShooterState => {
  const state = createSim(level);
  at.forEach(([x, y], index) => state.enemies.push({ id: 900 + index, type: 'swarmer', x, y, hp: 1 }));
  return state;
};
const angleBetween = (ax: number, ay: number, bx: number, by: number) => {
  const raw = Math.atan2(by, bx) - Math.atan2(ay, ax);
  return Math.atan2(Math.sin(raw), Math.cos(raw)); // -pi..pi (tests may use any math)
};
const degrees = (radians: number) => (radians * 180) / Math.PI;
const aimOf = (state: ShooterState, input: ShooterInput) => ({ x: input.aimX - state.player.x, y: input.aimY - state.player.y });

const hardBrief = (seed: number, patch: Record<string, unknown> = {}) => ShooterBriefSchema.parse({
  version: 'brief-1', healthDrops: 'none', title: `Casual ${seed}`, theme: 'zombie-city', map: 'pillars',
  enemies: [{ type: 'runner', share: 4 }, { type: 'brute', share: 2 }, { type: 'swarmer', share: 4 }],
  intensity: 4, playerHealth: 'normal', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [], ...patch,
});

describe('the numbers of the casual bot', () => {
  it('are in one object, inside the limits the calibration may use', () => {
    expect(CASUAL.reactionTicks).toBeGreaterThanOrEqual(1);
    expect(CASUAL.reactionTicks).toBeLessThanOrEqual(24);
    expect(CASUAL.aimErrorDeg).toBeGreaterThan(0);
    expect(CASUAL.aimErrorDeg).toBeLessThanOrEqual(12);
    expect(CASUAL.fireRangeShare).toBe(0.85);
    expect(CASUAL.fleeScale).toBeLessThan(1);
    expect(CASUAL.wallScale).toBeLessThan(1);
    expect(Object.keys(CASUAL).sort()).toEqual(['aimErrorDeg', 'fireRangeShare', 'fleeScale', 'noiseSalt', 'reactionTicks', 'wallScale']);
  });
});

describe('the casual bot is deterministic', () => {
  const level = compileShooter(hardBrief(3), 3).level;
  const trace = (seed: number) => {
    const state = createSim(level);
    const bot = createCasualBot(seed);
    const hashes: string[] = [];
    const inputs: ShooterInput[] = [];
    while (state.status === 'playing' && state.tick < 60 * 40) {
      const input = bot(state);
      inputs.push(input);
      step(state, input);
      if (state.tick % 60 === 0) hashes.push(snapshotHash(state));
    }
    return { hashes, inputs, final: snapshotHash(state), status: state.status, kills: state.kills, tick: state.tick };
  };

  it('the same seed gives the same game, bit for bit, input for input', () => {
    const a = trace(77);
    const b = trace(77);
    expect(b.inputs).toEqual(a.inputs);
    expect(b.hashes).toEqual(a.hashes);
    expect(b).toEqual(a);
  });

  it('another seed gives another game (its mistakes are drawn from its own seed)', () => {
    const finals = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => trace(seed).final);
    expect(new Set(finals).size).toBeGreaterThanOrEqual(6);
    expect(trace(1).hashes).not.toEqual(trace(2).hashes);
  });

  it('is made fresh for each game: two bots from one seed agree, a bot that already played does not start over', () => {
    const fresh = (seed: number) => playLevel(level, createCasualBot(seed));
    expect(snapshotHash(fresh(9).state)).toBe(snapshotHash(fresh(9).state));
    const used = createCasualBot(9);
    playLevel(level, used);
    // `used` still remembers its last look and has advanced its generator: it is not a fresh bot
    expect(snapshotHash(playLevel(level, used).state)).not.toBe(snapshotHash(fresh(9).state));
  });

  it('never touches Math.random, and does not change the state it is shown', () => {
    const random = vi.spyOn(Math, 'random');
    const state = withEnemies(quiet(), [[700, 305], [300, 200]]);
    const before = snapshotHash(state);
    const bot = createCasualBot(5);
    for (let tick = 0; tick < 100; tick += 1) { bot(state); state.tick += 1; }
    state.tick = 0;
    expect(snapshotHash(state)).toBe(before);
    playLevel(level, createCasualBot(5));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe('reaction delay: it acts on what it saw at the last look', () => {
  it('an enemy that moves between two looks is not noticed until the next look', () => {
    const state = withEnemies(quiet(), [[700, 305]]);
    const bot = createCasualBot(12);
    const first = bot(state);
    expect(first.fire).toBe(true);
    expect(aimOf(state, first).x).toBeGreaterThan(150); // aimed to the right, where it was
    // it jumps to the top of the field; the bot has not looked again yet
    state.enemies[0]!.x = 480; state.enemies[0]!.y = 100;
    for (const tick of [1, 5, CASUAL.reactionTicks - 1]) {
      state.tick = tick;
      expect(bot(state), `tick ${tick}`).toEqual(first);
    }
    // at the next look it sees the new place
    state.tick = CASUAL.reactionTicks;
    const later = bot(state);
    expect(aimOf(state, later).y).toBeLessThan(-100);
    expect(Math.abs(aimOf(state, later).x)).toBeLessThan(Math.abs(aimOf(state, later).y));
  });

  it('keeps shooting at a spot where the enemy was until the next look (a wasted shot, like a person)', () => {
    const state = withEnemies(quiet(), [[700, 305]]);
    const bot = createCasualBot(12);
    bot(state);
    state.enemies.length = 0; // the enemy is gone
    state.tick = 3;
    expect(bot(state).fire).toBe(true);
    state.tick = CASUAL.reactionTicks;
    expect(bot(state).fire).toBe(false); // the next look sees an empty field
  });

  it('the expert bot sees at once, at every tick (the difference the gate depends on)', () => {
    const state = withEnemies(quiet(), [[700, 305]]);
    state.enemies[0]!.x = 480; state.enemies[0]!.y = 100;
    expect(aimOf(state, botInput(state)).y).toBeLessThan(-100);
  });
});

describe('aim error', () => {
  it('stays inside +- aimErrorDeg of the true direction, uses both sides and most of the range', () => {
    const errors: number[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const state = withEnemies(quiet(), [[760, 305]]);
      const input = createCasualBot(seed)(state);
      const aim = aimOf(state, input);
      errors.push(degrees(angleBetween(1, 0, aim.x, aim.y)));
    }
    expect(Math.max(...errors.map(Math.abs))).toBeLessThanOrEqual(CASUAL.aimErrorDeg + 0.01);
    expect(Math.max(...errors)).toBeGreaterThan(CASUAL.aimErrorDeg * 0.8);
    expect(Math.min(...errors)).toBeLessThan(-CASUAL.aimErrorDeg * 0.8);
    expect(errors.filter((e) => e > 0).length).toBeGreaterThan(100);
    expect(errors.filter((e) => e < 0).length).toBeGreaterThan(100);
  });

  it('is the same angle at any distance and held until the next look (the player may move meanwhile)', () => {
    const near = withEnemies(quiet(), [[560, 305]]);
    const far = withEnemies(quiet(), [[900, 305]]);
    const a = aimOf(near, createCasualBot(4)(near));
    const b = aimOf(far, createCasualBot(4)(far));
    expect(degrees(angleBetween(a.x, a.y, b.x, b.y))).toBeCloseTo(0, 3);
  });

  it('a larger error in the parameters gives a larger spread, and zero gives a perfect aim', () => {
    const spread = (params: CasualParams) => {
      const errors: number[] = [];
      for (let seed = 1; seed <= 100; seed += 1) {
        const state = withEnemies(quiet(), [[760, 305]]);
        const aim = aimOf(state, createCasualBot(seed, params)(state));
        errors.push(Math.abs(degrees(angleBetween(1, 0, aim.x, aim.y))));
      }
      return Math.max(...errors);
    };
    expect(spread({ ...CASUAL, aimErrorDeg: 0 })).toBeLessThan(1e-6);
    expect(spread({ ...CASUAL, aimErrorDeg: 12 })).toBeGreaterThan(spread({ ...CASUAL, aimErrorDeg: 3 }));
  });
});

describe('firing', () => {
  const range = quiet().weapon.range; // 500
  it('only at a target inside 85% of the weapon range', () => {
    for (const [share, expected] of [[0.5, true], [0.84, true], [0.86, false], [1, false]] as const) {
      const state = withEnemies(quiet(), [[480 + range * share, 305]]);
      expect(createCasualBot(1)(state).fire, `${share * 100}% of range`).toBe(expected);
    }
  });
  it('the expert bot fires at anything, however far', () => {
    expect(botInput(withEnemies(quiet(), [[480 + range * 1.2, 305]])).fire).toBe(true);
  });
  it('holds fire and aims ahead when it sees nothing', () => {
    const state = withEnemies(quiet(), []);
    const input = createCasualBot(1)(state);
    expect(input).toMatchObject({ fire: false, aimX: state.player.x + 1, aimY: state.player.y });
  });
});

describe('dodging', () => {
  it('keeps a smaller distance than the expert: an enemy at 140 px pushes the expert, not the casual bot', () => {
    const state = withEnemies(quiet(), [[620, 305]]); // 140 px to the right of the player
    expect(botInput(state).moveX).toBe(-1);
    expect(createCasualBot(1)(state).moveX).toBe(0);
  });
  it('still steps away from a close enemy', () => {
    const state = withEnemies(quiet(), [[560, 305]]); // 80 px
    expect(createCasualBot(1)(state).moveX).toBe(-1);
    expect(createCasualBot(1)(state).moveY).toBe(0);
  });
  it('pushes away from a wall or an edge only when closer than the expert does', () => {
    const level = quiet({ player: { x: 54, y: 305, speed: 210, hp: 10 } }); // 40 px from the left edge
    const state = withEnemies(level, []);
    expect(state.player.x - FIELD.left - PLAYER_RADIUS).toBe(40);
    expect(botInput(state).moveX).toBe(1); // inside the expert's 60 px
    expect(createCasualBot(1)(state).moveX).toBe(0); // outside the casual 30 px
    const close = withEnemies(quiet({ player: { x: 40, y: 305, speed: 210, hp: 10 } }), []); // 26 px from the edge
    expect(createCasualBot(1)(close).moveX).toBe(1);
  });
  it('has no route planning: a wall between it and the enemy changes nothing it does', () => {
    const open = withEnemies(quiet(), [[700, 305]]);
    const walled = withEnemies(quiet({ obstacles: [{ x: 600, y: 305, width: 40, height: 200 }] }), [[700, 305]]);
    expect(createCasualBot(2)(walled)).toEqual(createCasualBot(2)(open));
  });
});

describe('a casual player is worse than the expert (that is the point)', () => {
  it('wins fewer of the same games, and neither bot gets the whole battery', () => {
    let casual = 0;
    let expert = 0;
    const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
    for (const seed of seeds) {
      const level = compileShooter(hardBrief(seed, { weapon: seed % 2 === 0 ? 'pistol' : 'rapid', intensity: 3 }), seed).level;
      if (playLevel(level, createCasualBot(level.seed)).status === 'won') casual += 1;
      if (playLevel(level, botInput).status === 'won') expert += 1;
    }
    console.info(`[casual bot] wins ${casual}/16, expert ${expert}/16`);
    expect(casual).toBeLessThan(expert);
    expect(casual).toBeGreaterThan(0);
  });

  it('still wins an easy level almost every time (it is a casual player, not a broken one)', () => {
    const wins = [1, 2, 3, 4, 5, 6, 7, 8].filter((seed) => {
      const level = compileShooter(hardBrief(seed, { intensity: 1, weapon: 'rapid', enemies: [{ type: 'swarmer', share: 5 }] }), seed).level;
      return playLevel(level, createCasualBot(level.seed)).status === 'won';
    }).length;
    expect(wins).toBeGreaterThanOrEqual(7);
  });
});

/** One spitter, in hold range, ready to fire. */
function place4(state: ShooterState, x: number) {
  state.enemies.push({ id: 5, type: 'spitter', x, y: 305, hp: 3, nextShotTick: 0 });
}

describe('dodging enemy bullets (Stage 4B), and nothing changes without them', () => {
  it('with no enemy bullet both bots decide exactly as before: the bullet list is only ever added to', () => {
    // enemies and walls only: the inputs match the expert bot's own steering with the bullet list left out
    const state = withEnemies(quiet({ obstacles: [{ x: 600, y: 305, width: 40, height: 200 }] }), [[560, 330], [420, 300], [500, 210]]);
    const expert = botInput(state);
    expect(state.enemyBullets).toEqual([]);
    expect(expert.moveX === -1 || expert.moveX === 0 || expert.moveX === 1).toBe(true);
    const clone = structuredClone(state);
    clone.enemyBullets = [];
    expect(botInput(clone)).toEqual(expert);
    expect(createCasualBot(8)(clone)).toEqual(createCasualBot(8)(state));
  });

  const bulletAt = (x: number, y: number, vx: number, vy = 0) => ({ id: 5, x, y, vx, vy, travelled: 0, damage: 1, radius: 5, range: 600 });

  it('the expert bot sidesteps a bullet that is coming at it (it does not back straight away: the bullet is faster), and ignores a far one', () => {
    const near = withEnemies(quiet(), []);
    near.enemyBullets.push(bulletAt(540, 305, -230)); // 60 px to the right, flying left at the player
    expect(botInput(near)).toMatchObject({ moveX: 0, moveY: -1 });
    const far = withEnemies(quiet(), []);
    far.enemyBullets.push(bulletAt(700, 305, -230)); // 220 px
    expect(botInput(far)).toMatchObject({ moveX: 0, moveY: 0 });
  });

  it('the sidestep goes to the side of the path that the player is already on', () => {
    const below = withEnemies(quiet(), []);
    below.enemyBullets.push(bulletAt(540, 290, -230)); // the path is 15 px above the player's centre line
    expect(botInput(below).moveY).toBe(1);
    const above = withEnemies(quiet(), []);
    above.enemyBullets.push(bulletAt(540, 320, -230));
    expect(botInput(above).moveY).toBe(-1);
    const vertical = withEnemies(quiet(), []);
    vertical.enemyBullets.push(bulletAt(495, 380, 0, -230)); // coming up from below, a little to the right
    expect(botInput(vertical)).toMatchObject({ moveX: -1, moveY: 0 });
  });

  it('a bullet that has already passed, or that is not moving, does nothing', () => {
    const passed = withEnemies(quiet(), []);
    passed.enemyBullets.push(bulletAt(440, 305, -230)); // 40 px to the left, flying away
    expect(botInput(passed)).toMatchObject({ moveX: 0, moveY: 0 });
    const still = withEnemies(quiet(), []);
    still.enemyBullets.push(bulletAt(520, 305, 0, 0));
    expect(botInput(still)).toMatchObject({ moveX: 0, moveY: 0 });
  });

  it('the casual bot dodges with a smaller radius and from what it saw at its last look', () => {
    const state = withEnemies(quiet(), []);
    state.enemyBullets.push(bulletAt(570, 305, -230)); // 90 px: the expert's edge
    expect(botInput(state).moveY).toBe(0);
    state.enemyBullets[0]!.x = 540; // 60 px
    const bot = createCasualBot(3);
    expect(bot(state).moveY).toBe(-1);
    state.enemyBullets[0]!.x = 700; // gone far away, but the bot has not looked again
    state.tick = 5;
    expect(bot(state).moveY).toBe(-1);
    state.tick = CASUAL.reactionTicks;
    expect(bot(state).moveY).toBe(0);
  });

  it('with enemy bullets in the air the bot survives a lone spitter that it could not survive by standing still', () => {
    const level = { ...quiet(), weapon: { cooldownMs: 300, bulletSpeed: 600, damage: 1, range: 600 } };
    const idle = createSim(level);
    place4(idle, 700);
    for (let i = 0; i < 1500 && idle.status === 'playing'; i += 1) step(idle, { moveX: 0, moveY: 0, aimX: 960, aimY: 305, fire: false });
    expect(idle.status).toBe('lost');
    const dodging = createSim(level);
    place4(dodging, 700);
    // the same spitter, but the player only sidesteps (no shooting): it lives much longer than standing still
    const bot = botInput;
    let hp = dodging.player.hp;
    for (let i = 0; i < 1500 && dodging.status === 'playing'; i += 1) { const input = bot(dodging); step(dodging, { ...input, fire: false }); hp = dodging.player.hp; }
    expect(hp).toBeGreaterThan(idle.player.hp);
    expect(dodging.tick).toBeGreaterThan(idle.tick);
  });

  it('seeing bullets draws no extra random number: the aim error is the same with and without them', () => {
    const a = withEnemies(quiet(), [[760, 305]]);
    const b = withEnemies(quiet(), [[760, 305]]);
    b.enemyBullets.push({ id: 5, x: 900, y: 100, vx: 0, vy: 0, travelled: 0, damage: 1, radius: 5, range: 600 });
    expect(createCasualBot(21)(a)).toEqual(createCasualBot(21)(b));
  });

  it('neither bot walks toward a health pickup', () => {
    const state = withEnemies(quiet(), []);
    state.player.hp = 1;
    const without = botInput(state);
    state.pickups.push({ id: 6, x: 600, y: 305, expiresTick: 600 });
    expect(botInput(state)).toEqual(without);
    expect(createCasualBot(4)(state)).toEqual(createCasualBot(4)(withEnemies(quiet(), [])));
  });
});
