// Step 5 of a tick: due enemies appear.
import { ENEMY_TYPES, FIELD, MAX_ENEMIES_ALIVE, SPAWN_MIN_PLAYER_DISTANCE, type EnemyType } from './constants.js';
import { dist, pointRectDistance } from './geometry.js';
import { random, type ShooterState } from './state.js';

const RING_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
];
const SPIRAL_STEP = 6;
const SPIRAL_RINGS = 12;

/** 5. Due enemies spawn (waiting ones stay queued, none is dropped). */
export function spawnDue(state: ShooterState, t: number) {
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
  const origin = candidates[Math.floor(random(state) * candidates.length)]!;
  const free = (x: number, y: number) => {
    if (x < FIELD.left + radius || x > FIELD.right - radius || y < FIELD.top + radius || y > FIELD.bottom - radius) return false;
    if (dist(x - player.x, y - player.y) < minDistance) return false;
    if (level.obstacles.some((block) => pointRectDistance(x, y, block) < radius)) return false;
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
      state.enemies.push({ id: state.nextId, type, x, y, hp: ENEMY_TYPES[type].hp });
      state.nextId += 1;
      return true;
    }
  }
  return false;
}
