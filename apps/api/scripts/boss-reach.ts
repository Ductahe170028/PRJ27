// "Does the boss reach a player who stands still?" The measurement of Stage 4C.1, shared by the CLI
// (measure-boss-reach.ts) and by the unit test. The player stands at the start and cannot die; the game runs for
// `seconds` of simulated time (or until the boss is near).
import { TICK_RATE, bossOf, createSim, isBoss, step, type ShooterLevel } from '@game-creator/contracts';
import { ShooterBriefSchema, type ShooterBrief } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';

export type BossKind = 'crusher' | 'gunner';

/** How near the boss must come (px): 140, or its hold range plus 40 when it keeps its distance. */
export const arrivalDistance = (boss: BossKind) => Math.max(140, (bossOf(boss)?.holdRange ?? 0) + 40);

/** The brief of the measurement: survive 60, runners, pistol, sturdy player, no drops, intensity 1 (more with `intensity`). */
export function reachBrief(boss: BossKind, map: ShooterBrief['map'], intensity = 1): ShooterBrief {
  return ShooterBriefSchema.parse({
    version: 'brief-1', healthDrops: 'none', boss, base: 'none', enemyFamily: 'auto', title: 'Reach', theme: 'zombie-city', map, enemies: [{ type: 'runner', share: 5 }],
    intensity, playerHealth: 'sturdy', weapon: 'pistol', goal: { type: 'survive', seconds: 60 }, unsupported: [],
  });
}

export interface ReachResult {
  /** The boss came within the arrival distance. */
  arrived: boolean;
  /** Smallest distance between the boss and the player (px), `Infinity` when the boss never appeared. */
  closest: number;
  /** The empty arena was used instead of the map of the brief. */
  simplified: boolean;
  level: ShooterLevel;
}

export function bossReach(brief: ShooterBrief, seed: number, seconds = 120): ReachResult {
  const compiled = compileShooter(brief, seed);
  return { ...levelReach(compiled.level, brief.boss as BossKind, seconds), simplified: compiled.notices.some((notice) => notice.includes('đơn giản hóa')) };
}

/** The same measurement on a level that already exists (a hand-made one, for instance). */
export function levelReach(level: ShooterLevel, kind: BossKind, seconds = 120): ReachResult {
  const limit = arrivalDistance(kind);
  const state = createSim(level);
  state.player.hp = 1_000_000; state.player.maxHp = 1_000_000;
  let closest = Infinity;
  const ticks = seconds * TICK_RATE;
  while (state.tick < ticks && state.status === 'playing') {
    step(state, { moveX: 0, moveY: 0, aimX: state.player.x + 1, aimY: state.player.y, fire: false });
    const boss = state.enemies.find((enemy) => isBoss(enemy.type));
    if (!boss) continue;
    closest = Math.min(closest, Math.hypot(boss.x - state.player.x, boss.y - state.player.y));
    if (closest <= limit) break;
  }
  return { arrived: closest <= limit, closest, simplified: false, level };
}
