// A plain player. It is the judge of a compiled level (can a simple player win?)
// and the opponent in the tests. It is not meant to play like a person: it aims
// perfectly and never gets tired. (The gate uses the casual bot, which is closer
// to a person: casual-bot.ts.)
import { BULLET_RADIUS, ENEMY_TYPES } from './constants.js';
import { isBoss } from './boss.js';
import { dist, lineOfSight } from './geometry.js';
import type { ShooterLevel } from './level.js';
import { step } from './sim.js';
import { createSim, type ShooterInput, type ShooterState } from './state.js';
import { EXPERT_BULLET_RADIUS, EXPERT_FLEE_RADIUS, EXPERT_WALL_RADIUS, nearestToBase, steer } from './steering.js';

export const IDLE: ShooterInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };

/** Aims at the nearest enemy (at the boss instead, when the boss is within the weapon's range), holds fire, and steps
 * away from enemies within 150 px (a boss from farther: its own radius is added), from enemy bullets within 90 px, and
 * from walls. It sees every enemy and bullet exactly, at every tick. It does not go for health pickups. With a base to defend it
 * stays near it and shoots first at what is nearest to it. */
export function botInput(state: ShooterState): ShooterInput {
  const { player, enemies, level } = state;
  let nearest: (typeof enemies)[number] | undefined;
  let nearestDistance = Infinity;
  let bossInRange: (typeof enemies)[number] | undefined;
  for (const enemy of enemies) {
    const distance = dist(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = enemy; }
    if (bossInRange === undefined && state.bossIndex !== undefined && isBoss(enemy.type) && distance <= level.weapon.range) bossInRange = enemy;
  }
  // Only in a level with a boss are the enemies described to the steering one by one (the boss with its radius).
  const seen = state.bossIndex === undefined ? enemies : enemies.map((e) => (isBoss(e.type) ? { x: e.x, y: e.y, extra: ENEMY_TYPES[e.type].radius } : { x: e.x, y: e.y }));
  const { moveX, moveY } = steer(player, level, seen, EXPERT_FLEE_RADIUS, EXPERT_WALL_RADIUS, state.enemyBullets, EXPERT_BULLET_RADIUS);
  // With a base to defend it shoots at what is nearest the base (among the enemies in range), unless the boss is in range.
  const target = bossInRange ?? (level.base ? nearestToBase(level.base, player, enemies, level.weapon.range, (p) => lineOfSight(player, p, BULLET_RADIUS, state.walls)) : undefined) ?? nearest;
  return {
    moveX, moveY,
    aimX: target ? target.x : player.x + 1, aimY: target ? target.y : player.y,
    fire: target !== undefined,
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
