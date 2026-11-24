// A stable hash of the whole state, for determinism tests (FNV-1a over the exact bits of every number).
import { ENEMY_TYPES } from './constants.js';
import type { ShooterState } from './state.js';

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
function mix(hash: number, value: number): number {
  bits[0] = value;
  hash = Math.imul(hash ^ words[0]!, 16777619) >>> 0;
  return Math.imul(hash ^ words[1]!, 16777619) >>> 0;
}

const STATUS_CODE = { playing: 0, won: 1, lost: 2 } as const;

/** 8 hex digits identifying the whole state (the drawn `aim` angle is left out). */
export function snapshotHash(state: ShooterState): string {
  let h = 2166136261;
  for (const value of [state.tick, STATUS_CODE[state.status], state.kills, state.score, state.rng, state.nextId, state.spawned,
    state.player.x, state.player.y, state.player.hp, state.player.invulnerableUntilTick, state.player.nextShotTick,
    state.enemies.length, state.bullets.length]) h = mix(h, value);
  for (const e of state.enemies) for (const value of [e.id, ENEMY_TYPES[e.type].code, e.x, e.y, e.hp]) h = mix(h, value);
  for (const b of state.bullets) for (const value of [b.id, b.x, b.y, b.vx, b.vy, b.travelled]) h = mix(h, value);
  return h.toString(16).padStart(8, '0');
}
