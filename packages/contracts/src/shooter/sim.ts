// The whole shooter, as plain data and plain functions. A renderer reads the
// state and draws it; nothing here knows how. Same level and same inputs give
// the same state, tick for tick: the only randomness is a seeded generator, and
// the physics uses only + - * / and square roots, which every engine rounds the
// same way (trigonometry is used for the drawn `aim` angle only).
import {
  BULLET_RADIUS, ENEMY_TYPES, FIELD, INVULNERABLE_MS, MAX_BULLETS, MAX_ENEMIES_ALIVE, MAX_ENEMY_RADIUS, NAV_INFLATE,
  NAV_REFRESH_TICKS, PLAYER_RADIUS, SPAWN_MIN_PLAYER_DISTANCE, SPAWN_STAGGER_MS, TICK_RATE, msToTicks, type EnemyType,
} from './constants.js';
import {
  lineOfSight, pointRectDistance, resolveCircle, segmentCircleHit, segmentRectHit, type Rect,
} from './geometry.js';
import type { ShooterLevel } from './level.js';
import { blockedCells, cellOf, flowDistances, flowTarget, type FlowField } from './navigation.js';

export interface ShooterInput {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  /** Aim point in world coordinates. */
  aimX: number;
  aimY: number;
  fire: boolean;
}

export interface ShooterEnemy { id: number; type: EnemyType; x: number; y: number; hp: number }
/** vx, vy are in px per second. */
export interface ShooterBullet { id: number; x: number; y: number; vx: number; vy: number; travelled: number }

export interface ShooterState {
  tick: number;
  status: 'playing' | 'won' | 'lost';
  kills: number;
  score: number;
  player: {
    x: number; y: number; hp: number; maxHp: number;
    invulnerableUntilTick: number; nextShotTick: number;
    /** Radians, for drawing only. */
    aim: number;
  };
  enemies: ShooterEnemy[];
  bullets: ShooterBullet[];
  // --- internal, but plain data so the state can be cloned and resumed ---
  level: ShooterLevel;
  rng: number;
  nextId: number;
  /** Every enemy of the level in spawn order; `spawned` is how many are out. */
  schedule: Array<{ tick: number; type: EnemyType }>;
  spawned: number;
  /** Unit vector of the last aim; used for firing. */
  aimX: number;
  aimY: number;
  blocked: boolean[];
  flow: FlowField | undefined;
}

export const totalScheduledEnemies = (level: ShooterLevel) => level.waves.reduce((sum, wave) => sum + wave.count, 0);
export const elapsedSeconds = (state: ShooterState) => state.tick / TICK_RATE;

export function createSim(level: ShooterLevel): ShooterState {
  const entries: Array<{ tick: number; type: EnemyType; order: number }> = [];
  for (const wave of level.waves) {
    for (let k = 0; k < wave.count; k += 1) {
      entries.push({ tick: msToTicks(wave.atMs + k * SPAWN_STAGGER_MS), type: wave.type, order: entries.length });
    }
  }
  entries.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return {
    tick: 0, status: 'playing', kills: 0, score: 0,
    player: {
      x: level.player.x, y: level.player.y, hp: level.player.hp, maxHp: level.player.hp,
      invulnerableUntilTick: 0, nextShotTick: 0, aim: 0,
    },
    enemies: [], bullets: [],
    level, rng: level.seed | 0, nextId: 1,
    schedule: entries.map(({ tick, type }) => ({ tick, type })), spawned: 0,
    aimX: 1, aimY: 0,
    blocked: blockedCells(level.obstacles, NAV_INFLATE), flow: undefined,
  };
}

/** mulberry32: one number in [0,1) per call. */
function random(state: ShooterState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- spatial grid over enemies (scratch, rebuilt before each use) ---
// Cells about the size of a small enemy: a crowd of 120 spreads over many cells,
// so a neighbor query visits a few enemies instead of the whole crowd.
const GRID = 32;
const GRID_COLS = Math.ceil((FIELD.right - FIELD.left) / GRID);
const GRID_ROWS = Math.ceil((FIELD.bottom - FIELD.top) / GRID);
const gridCells: number[][] = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);
const gridCol = (x: number) => Math.min(GRID_COLS - 1, Math.max(0, Math.floor((x - FIELD.left) / GRID)));
const gridRow = (y: number) => Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((y - FIELD.top) / GRID)));

/** Cells that hold something, so that clearing costs the crowd, not the whole grid. */
const usedCells: number[] = [];

function buildGrid(enemies: readonly ShooterEnemy[]) {
  for (const cell of usedCells) gridCells[cell]!.length = 0;
  usedCells.length = 0;
  for (let index = 0; index < enemies.length; index += 1) {
    const enemy = enemies[index]!;
    const cell = gridRow(enemy.y) * GRID_COLS + gridCol(enemy.x);
    const list = gridCells[cell]!;
    if (list.length === 0) usedCells.push(cell);
    list.push(index);
  }
}

function gridQuery(minX: number, minY: number, maxX: number, maxY: number, visit: (index: number) => void) {
  const c0 = gridCol(minX); const c1 = gridCol(maxX);
  const r0 = gridRow(minY); const r1 = gridRow(maxY);
  for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) for (const index of gridCells[r * GRID_COLS + c]!) visit(index);
}

/** One tick, in place. Order of work, always the same:
 *  1. a finished game does nothing
 *  2. the player moves (diagonals normalized), slides along walls and edges
 *  3. the aim is updated from the aim point
 *  4. the weapon fires if asked and ready, and the bullet cap allows
 *  5. due enemies spawn (waiting ones stay queued, none is dropped)
 *  6. enemies move (straight at the player in plain sight, else along the flow
 *     field), push each other apart, then leave walls
 *  7. bullets fly; a swept test finds the first enemy or wall on the way
 *  8. one enemy touch hurts the player, unless the player is still protected
 *  9. the clock advances; losing is checked before winning
 */
export function step(state: ShooterState, input: ShooterInput): void {
  if (state.status !== 'playing') return;
  const t = state.tick;
  const { level, player } = state;
  const walls: readonly Rect[] = level.obstacles;

  // 2. player movement
  const mx = input.moveX > 0 ? 1 : input.moveX < 0 ? -1 : 0;
  const my = input.moveY > 0 ? 1 : input.moveY < 0 ? -1 : 0;
  if (mx !== 0 || my !== 0) {
    const length = Math.sqrt(mx * mx + my * my);
    const stride = level.player.speed / TICK_RATE;
    player.x += (mx / length) * stride;
    player.y += (my / length) * stride;
  }
  resolveCircle(player, PLAYER_RADIUS, walls);

  // 3. aim
  if (Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) {
    const ax = input.aimX - player.x;
    const ay = input.aimY - player.y;
    const length = Math.sqrt(ax * ax + ay * ay);
    if (length > 1e-9) { state.aimX = ax / length; state.aimY = ay / length; }
    player.aim = Math.atan2(state.aimY, state.aimX);
  }

  // 4. fire
  if (input.fire && t >= player.nextShotTick && state.bullets.length < MAX_BULLETS) {
    const reach = PLAYER_RADIUS + BULLET_RADIUS + 1;
    state.bullets.push({
      id: state.nextId, x: player.x + state.aimX * reach, y: player.y + state.aimY * reach,
      vx: state.aimX * level.weapon.bulletSpeed, vy: state.aimY * level.weapon.bulletSpeed, travelled: 0,
    });
    state.nextId += 1;
    player.nextShotTick = t + msToTicks(level.weapon.cooldownMs);
  }

  spawnDue(state, t);
  moveEnemies(state, t, walls);
  flyBullets(state, walls);
  hurtPlayer(state, t);

  // 9. clock, then the result
  state.tick = t + 1;
  if (player.hp <= 0) state.status = 'lost';
  else if (level.win.type === 'survive' ? state.tick >= level.win.seconds * TICK_RATE : state.kills >= level.win.count) state.status = 'won';
}

// 5. spawning
const RING_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
];
const SPIRAL_STEP = 6;
const SPIRAL_RINGS = 12;

function spawnDue(state: ShooterState, t: number) {
  while (state.spawned < state.schedule.length) {
    const entry = state.schedule[state.spawned]!;
    if (entry.tick > t || state.enemies.length >= MAX_ENEMIES_ALIVE) return;
    if (!placeEnemy(state, entry.type)) return; // no free spot now: it waits, in order
    state.spawned += 1;
  }
}

function placeEnemy(state: ShooterState, type: EnemyType): boolean {
  const { level, player } = state;
  const radius = ENEMY_TYPES[type].radius;
  const distanceToPlayer = (p: { x: number; y: number }) => Math.hypot(p.x - player.x, p.y - player.y);
  let candidates = level.spawnPoints.filter((p) => distanceToPlayer(p) >= SPAWN_MIN_PLAYER_DISTANCE);
  let minDistance = SPAWN_MIN_PLAYER_DISTANCE;
  if (candidates.length === 0) {
    // Every point is close to the player: take the farthest one.
    let far = level.spawnPoints[0]!;
    for (const p of level.spawnPoints) if (distanceToPlayer(p) > distanceToPlayer(far)) far = p;
    candidates = [far];
    minDistance = 0;
  }
  const origin = candidates[Math.floor(random(state) * candidates.length)]!;
  const free = (x: number, y: number) => {
    if (x < FIELD.left + radius || x > FIELD.right - radius || y < FIELD.top + radius || y > FIELD.bottom - radius) return false;
    if (Math.hypot(x - player.x, y - player.y) < minDistance) return false;
    if (level.obstacles.some((block) => pointRectDistance(x, y, block) < radius)) return false;
    return !state.enemies.some((other) => Math.hypot(other.x - x, other.y - y) < radius + ENEMY_TYPES[other.type].radius);
  };
  for (let ring = 0; ring <= SPIRAL_RINGS; ring += 1) {
    const reach = ring * SPIRAL_STEP;
    const directions = ring === 0 ? 1 : RING_DIRECTIONS.length;
    for (let d = 0; d < directions; d += 1) {
      const [dx, dy] = RING_DIRECTIONS[d]!;
      const x = origin.x + dx * reach;
      const y = origin.y + dy * reach;
      if (!free(x, y)) continue;
      state.enemies.push({ id: state.nextId, type, x, y, hp: ENEMY_TYPES[type].hp });
      state.nextId += 1;
      return true;
    }
  }
  return false;
}

// 6. enemies
function moveEnemies(state: ShooterState, t: number, walls: readonly Rect[]) {
  const { player, enemies } = state;
  if (enemies.length === 0) return;
  let flow = state.flow;
  const ensureFlow = (): FlowField => {
    const goal = cellOf(player.x, player.y);
    if (!flow || flow.goal !== goal || t - flow.atTick >= NAV_REFRESH_TICKS) {
      flow = { goal, atTick: t, dist: flowDistances(state.blocked, goal) };
      state.flow = flow;
    }
    return flow;
  };
  for (const enemy of enemies) {
    const kind = ENEMY_TYPES[enemy.type];
    const stride = kind.speed / TICK_RATE;
    let toPlayer = true;
    let tx = player.x;
    let ty = player.y;
    if (!lineOfSight(enemy, player, kind.radius, walls)) {
      const target = flowTarget(state.blocked, ensureFlow().dist, enemy.x, enemy.y);
      if (target) { tx = target.x; ty = target.y; toPlayer = false; }
    }
    const dx = tx - enemy.x;
    const dy = ty - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) continue;
    // Chasing the player: stop just inside touching range instead of walking into the center.
    const room = toPlayer ? distance - (PLAYER_RADIUS + kind.radius - 1) : distance;
    const move = Math.min(stride, Math.max(0, room));
    enemy.x += (dx / distance) * move;
    enemy.y += (dy / distance) * move;
  }

  // Push overlapping enemies apart: half the overlap each, at most 2 px per tick.
  buildGrid(enemies);
  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i]!;
    const ra = ENEMY_TYPES[a.type].radius;
    const around = ra + MAX_ENEMY_RADIUS; // farthest center that can still overlap `a`
    const c0 = gridCol(a.x - around); const c1 = gridCol(a.x + around);
    const r0 = gridRow(a.y - around); const r1 = gridRow(a.y + around);
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const list = gridCells[r * GRID_COLS + c]!;
        for (let k = 0; k < list.length; k += 1) {
          const j = list[k]!;
          if (j <= i) continue;
          const other = enemies[j]!;
          const reach = ra + ENEMY_TYPES[other.type].radius;
          const dx = other.x - a.x;
          const dy = other.y - a.y;
          const squared = dx * dx + dy * dy;
          if (squared >= reach * reach) continue; // most pairs: no square root needed
          const distance = Math.sqrt(squared);
          const push = Math.min((reach - distance) / 2, 2);
          // Exactly on top of each other: split along x, so the result does not depend on luck.
          const nx = distance > 0 ? dx / distance : 1;
          const ny = distance > 0 ? dy / distance : 0;
          a.x -= nx * push; a.y -= ny * push;
          other.x += nx * push; other.y += ny * push;
        }
      }
    }
  }
  for (const enemy of enemies) resolveCircle(enemy, ENEMY_TYPES[enemy.type].radius, walls);
}

// 7. bullets
function flyBullets(state: ShooterState, walls: readonly Rect[]) {
  const { level, enemies } = state;
  if (state.bullets.length === 0) return;
  buildGrid(enemies);
  const kept: ShooterBullet[] = [];
  const reach = MAX_ENEMY_RADIUS + BULLET_RADIUS;
  for (const bullet of state.bullets) {
    const speed = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
    const stride = Math.min(speed / TICK_RATE, level.weapon.range - bullet.travelled);
    const x0 = bullet.x;
    const y0 = bullet.y;
    const x1 = speed > 0 ? x0 + (bullet.vx / speed) * stride : x0;
    const y1 = speed > 0 ? y0 + (bullet.vy / speed) * stride : y0;

    let wallHit: number | undefined;
    for (const block of walls) {
      const hit = segmentRectHit(x0, y0, x1, y1, block, BULLET_RADIUS);
      if (hit !== undefined && (wallHit === undefined || hit < wallHit)) wallHit = hit;
    }
    // First enemy on the way (lowest id on a tie).
    const first: { hit: number; enemy: ShooterEnemy | undefined } = { hit: Infinity, enemy: undefined };
    gridQuery(Math.min(x0, x1) - reach, Math.min(y0, y1) - reach, Math.max(x0, x1) + reach, Math.max(y0, y1) + reach, (index) => {
      const enemy = enemies[index]!;
      if (enemy.hp <= 0) return;
      const hit = segmentCircleHit(x0, y0, x1, y1, enemy.x, enemy.y, ENEMY_TYPES[enemy.type].radius + BULLET_RADIUS);
      if (hit === undefined) return;
      if (hit < first.hit || (hit === first.hit && enemy.id < first.enemy!.id)) { first.hit = hit; first.enemy = enemy; }
    });

    // A wall at the same distance wins: the bullet never reaches the enemy.
    if (first.enemy && (wallHit === undefined || first.hit < wallHit)) {
      const target = first.enemy;
      target.hp -= level.weapon.damage;
      if (target.hp <= 0) { state.kills += 1; state.score += ENEMY_TYPES[target.type].points; }
      continue; // the bullet is spent
    }
    if (wallHit !== undefined) continue;
    bullet.x = x1; bullet.y = y1;
    bullet.travelled += stride;
    const outside = x1 < FIELD.left || x1 > FIELD.right || y1 < FIELD.top || y1 > FIELD.bottom;
    if (outside || bullet.travelled >= level.weapon.range) continue;
    kept.push(bullet);
  }
  state.bullets = kept;
  state.enemies = enemies.filter((enemy) => enemy.hp > 0);
}

// 8. contact damage
function hurtPlayer(state: ShooterState, t: number) {
  const { player } = state;
  if (t < player.invulnerableUntilTick) return;
  let damage = 0;
  for (const enemy of state.enemies) {
    const kind = ENEMY_TYPES[enemy.type];
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const touch = PLAYER_RADIUS + kind.radius;
    if (dx * dx + dy * dy < touch * touch && kind.damage > damage) damage = kind.damage;
  }
  if (damage === 0) return;
  player.hp = Math.max(0, player.hp - damage);
  player.invulnerableUntilTick = t + msToTicks(INVULNERABLE_MS);
}

// --- stable hash for determinism tests (FNV-1a over the exact bits of every number) ---
const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
function mix(hash: number, value: number): number {
  bits[0] = value;
  hash = Math.imul(hash ^ words[0]!, 16777619) >>> 0;
  return Math.imul(hash ^ words[1]!, 16777619) >>> 0;
}

const STATUS_CODE = { playing: 0, won: 1, lost: 2 } as const;
const TYPE_CODE: Record<EnemyType, number> = { runner: 1, brute: 2, swarmer: 3 };

/** 8 hex digits identifying the whole state (the drawn `aim` angle is left out). */
export function snapshotHash(state: ShooterState): string {
  let h = 2166136261;
  for (const value of [state.tick, STATUS_CODE[state.status], state.kills, state.score, state.rng, state.nextId, state.spawned,
    state.player.x, state.player.y, state.player.hp, state.player.invulnerableUntilTick, state.player.nextShotTick,
    state.enemies.length, state.bullets.length]) h = mix(h, value);
  for (const e of state.enemies) for (const value of [e.id, TYPE_CODE[e.type], e.x, e.y, e.hp]) h = mix(h, value);
  for (const b of state.bullets) for (const value of [b.id, b.x, b.y, b.vx, b.vy, b.travelled]) h = mix(h, value);
  return h.toString(16).padStart(8, '0');
}
