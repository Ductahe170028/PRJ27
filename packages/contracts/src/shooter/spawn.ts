// Step 5 of a tick: due enemies appear.
import { ENEMY_TYPES, FIELD, MAX_ENEMIES_ALIVE, SPAWN_MIN_PLAYER_DISTANCE, bossOf, msToTicks, rangedOf, type EnemyType } from './constants.js';
import { aimsAtBaseOnSpawn } from './base.js';
import { startBoss } from './boss.js';
import { dist, pointRectDistance } from './geometry.js';
import { random, type ShooterEnemy, type ShooterState } from './state.js';

const RING_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
];
const SPIRAL_STEP = 6;
const SPIRAL_RINGS = 12;

/** 5. Due enemies spawn (waiting ones stay queued, none is dropped). The boss, when it is due, goes before the ordinary
 * enemies that are waiting: it takes the first free place, and nobody else is placed ahead of it. */
export function spawnDue(state: ShooterState, t: number) {
  const bossEntry = state.bossIndex === undefined || state.bossSpawned ? undefined : state.schedule[state.bossIndex];
  if (bossEntry && bossEntry.tick <= t && state.enemies.length < MAX_ENEMIES_ALIVE && placeEnemy(state, bossEntry.type, t)) state.bossSpawned = true;
  while (state.spawned < state.schedule.length) {
    if (state.bossIndex !== undefined && state.spawned === state.bossIndex) {
      if (!state.bossSpawned) return; // the boss is next in line and not out yet: nobody goes ahead of it
      state.spawned += 1; // it came out ahead of its turn
      continue;
    }
    const entry = state.schedule[state.spawned]!;
    if (entry.tick > t || state.enemies.length >= MAX_ENEMIES_ALIVE) return;
    if (!placeEnemy(state, entry.type, t)) return; // no free spot now: it waits, in order
    state.spawned += 1;
  }
}

function placeEnemy(state: ShooterState, type: EnemyType, t: number): boolean {
  const { level, player } = state;
  const radius = ENEMY_TYPES[type].radius;
  const distanceToPlayer = (p: { x: number; y: number }) => dist(p.x - player.x, p.y - player.y);
  let candidates = level.spawnPoints.filter((p) => distanceToPlayer(p) >= SPAWN_MIN_PLAYER_DISTANCE);
  let minDistance = SPAWN_MIN_PLAYER_DISTANCE;
  if (candidates.length === 0) {
    // Every point is close to the player: take the farthest one.
    let far = level.spawnPoints[0]!;
    for (const p of level.spawnPoints) if (distanceToPlayer(p) > distanceToPlayer(far)) far = p;
    candidates = [far];
    minDistance = 0;
  }
  // The boss does not use the game's random numbers: it comes out at the candidate farthest from the player (first on a tie).
  const origin = bossOf(type) ? candidates.reduce((far, p) => (distanceToPlayer(p) > distanceToPlayer(far) ? p : far)) : candidates[Math.floor(random(state) * candidates.length)]!;
  const free = (x: number, y: number) => {
    if (x < FIELD.left + radius || x > FIELD.right - radius || y < FIELD.top + radius || y > FIELD.bottom - radius) return false;
    if (dist(x - player.x, y - player.y) < minDistance) return false;
    if (state.walls.some((block) => pointRectDistance(x, y, block) < radius)) return false;
    return !state.enemies.some((other) => dist(other.x - x, other.y - y) < radius + ENEMY_TYPES[other.type].radius);
  };
  for (let ring = 0; ring <= SPIRAL_RINGS; ring += 1) {
    const reach = ring * SPIRAL_STEP;
    const directions = ring === 0 ? 1 : RING_DIRECTIONS.length;
    for (let d = 0; d < directions; d += 1) {
      const [dx, dy] = RING_DIRECTIONS[d]!;
      const x = origin.x + dx * reach;
      const y = origin.y + dy * reach;
      if (!free(x, y)) continue;
      const enemy: ShooterEnemy = { id: state.nextId, type, x, y, hp: ENEMY_TYPES[type].hp };
      // A shooting enemy's first shot comes half a cooldown after it appears, shifted by its id so that
      // enemies that appear together do not all fire at once.
      const ranged = rangedOf(type);
      if (ranged) enemy.nextShotTick = t + msToTicks(ranged.cooldownMs / 2 + (enemy.id % 5) * 100);
      const boss = bossOf(type);
      if (boss) startBoss(enemy, boss, t, level.bossHp);
      else if (state.base) enemy.aimAtBase = aimsAtBaseOnSpawn(state, enemy);
      state.enemies.push(enemy);
      state.nextId += 1;
      return true;
    }
  }
  return false;
}
