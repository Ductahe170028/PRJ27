// A plain player. It is the judge of a compiled level (can a simple player win?)
// and the opponent in the tests. It is not meant to play like a person: it aims
// perfectly and never gets tired. (The gate uses the casual bot, which is closer
// to a person: casual-bot.ts.)
import { dist } from './geometry.js';
import type { ShooterLevel } from './level.js';
import { step } from './sim.js';
import { createSim, type ShooterInput, type ShooterState } from './state.js';
import { EXPERT_BULLET_RADIUS, EXPERT_FLEE_RADIUS, EXPERT_WALL_RADIUS, steer } from './steering.js';

export const IDLE: ShooterInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };

/** Aims at the nearest enemy, holds fire, and steps away from enemies within
 * 150 px, from enemy bullets within 90 px, and from walls. It sees every enemy and bullet exactly, at every tick.
 * It does not go for health pickups. */
export function botInput(state: ShooterState): ShooterInput {
  const { player, enemies, level } = state;
  let nearest: (typeof enemies)[number] | undefined;
  let nearestDistance = Infinity;
  for (const enemy of enemies) {
    const distance = dist(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = enemy; }
  }
  const { moveX, moveY } = steer(player, level, enemies, EXPERT_FLEE_RADIUS, EXPERT_WALL_RADIUS, state.enemyBullets, EXPERT_BULLET_RADIUS);
  return {
    moveX, moveY,
    aimX: nearest ? nearest.x : player.x + 1, aimY: nearest ? nearest.y : player.y,
    fire: nearest !== undefined,
  };
}

export interface PlayResult {
  status: ShooterState['status'];
  seconds: number;
  kills: number;
  hp: number;
  maxHp: number;
  /** hp / maxHp when the game ended; 0 when it was lost. */
  hpLeft: number;
  state: ShooterState;
}

/** Plays a level to its end (or `maxTicks`) with `policy`. A policy that remembers things (the casual
 * bot) is made fresh for each game: `playLevel(level, createCasualBot(level.seed))`. */
export function playLevel(level: ShooterLevel, policy: (state: ShooterState) => ShooterInput, maxTicks = 60 * 400): PlayResult {
  const state = createSim(level);
  while (state.status === 'playing' && state.tick < maxTicks) step(state, policy(state));
  const { hp, maxHp } = state.player;
  return {
    status: state.status, seconds: state.tick / 60, kills: state.kills, hp, maxHp,
    hpLeft: state.status === 'lost' ? 0 : hp / maxHp, state,
  };
}
