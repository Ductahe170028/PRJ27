// What happened between two frames, worked out from the two states alone (the simulation is told nothing and keeps no animation
// state): an enemy lost hit points, an enemy is gone (it died), the player fired, the player or the base was hurt, a bullet ended
// early (it hit something). Pure: it reads plain numbers, so it is tested without a browser.
import { ENEMY_TYPES, PLAYER_RADIUS, baseRectOf, isBoss, pointRectDistance, type EnemyType, type ShooterState } from '@game-creator/contracts';

export interface EnemySnap { type: EnemyType; x: number; y: number; hp: number }
/** `range` is the bullet's own (a level with an arsenal: the weapon that fired it); without it the weapon's range is the level's. */
export interface BulletSnap { x: number; y: number; vx: number; vy: number; travelled: number; range?: number | undefined }
/** The few numbers of a state that the diff reads, copied (a state is mutated in place by the next tick). */
export interface Snapshot {
  tick: number;
  playerHp: number; nextShotTick: number;
  baseHp: number | undefined;
  enemies: Map<number, EnemySnap>;
  bullets: Map<number, BulletSnap>;
}

export function snapshotOf(state: ShooterState): Snapshot {
  const enemies = new Map<number, EnemySnap>();
  for (const enemy of state.enemies) enemies.set(enemy.id, { type: enemy.type, x: enemy.x, y: enemy.y, hp: enemy.hp });
  const bullets = new Map<number, BulletSnap>();
  for (const bullet of state.bullets) bullets.set(bullet.id, { x: bullet.x, y: bullet.y, vx: bullet.vx, vy: bullet.vy, travelled: bullet.travelled, range: bullet.range });
  return { tick: state.tick, playerHp: state.player.hp, nextShotTick: state.player.nextShotTick, baseHp: state.base?.hp, enemies, bullets };
}

export interface Death { id: number; type: EnemyType; x: number; y: number; boss: boolean }
export interface FrameEvents {
  /** Enemies that lost hit points and are still there. */
  hurt: number[];
  deaths: Death[];
  playerHit: boolean;
  /** The player fired (the next shot is later than it was). */
  shot: boolean;
  baseHit: boolean;
  /** Where a bullet of the player ended before the end of its range (it hit something). */
  impacts: Array<{ x: number; y: number }>;
}

/** The events between `before` and `after`. `range` is the weapon's range (px): a bullet that vanished with more than a little of it
 * left has hit something. */
export function diffSnapshots(before: Snapshot, after: Snapshot, range: number): FrameEvents {
  const events: FrameEvents = { hurt: [], deaths: [], playerHit: false, shot: false, baseHit: false, impacts: [] };
  for (const [id, was] of before.enemies) {
    const now = after.enemies.get(id);
    if (!now) events.deaths.push({ id, type: was.type, x: was.x, y: was.y, boss: isBoss(was.type) });
    else if (now.hp < was.hp) events.hurt.push(id);
  }
  events.playerHit = after.playerHp < before.playerHp;
  events.shot = after.nextShotTick > before.nextShotTick;
  events.baseHit = before.baseHp !== undefined && after.baseHp !== undefined && after.baseHp < before.baseHp;
  const seconds = Math.max(1, after.tick - before.tick) / 60;
  for (const [id, was] of before.bullets) {
    if (after.bullets.has(id)) continue;
    const speed = Math.sqrt(was.vx * was.vx + was.vy * was.vy);
    // it could have flown `speed * seconds` more before running out of range: only a shorter life than that is a hit
    if (was.travelled + speed * seconds * 1.5 < (was.range ?? range)) events.impacts.push({ x: was.x, y: was.y });
  }
  return events;
}

/** Whether an enemy is touching the player or the base right now (what the simulation calls "reaching"): it plays `attack`. */
export function isAttacking(enemy: { type: EnemyType; x: number; y: number }, state: Pick<ShooterState, 'player' | 'base'> & { baseRect?: ShooterState['baseRect'] }): boolean {
  const radius = ENEMY_TYPES[enemy.type].radius;
  const dx = enemy.x - state.player.x;
  const dy = enemy.y - state.player.y;
  if (Math.sqrt(dx * dx + dy * dy) <= radius + PLAYER_RADIUS + 2) return true;
  // (the base's square comes from the state, which knows the size of THIS level's base)
  if (state.base) return pointRectDistance(enemy.x, enemy.y, state.baseRect ?? baseRectOf(state.base)) <= radius + 2;
  return false;
}

