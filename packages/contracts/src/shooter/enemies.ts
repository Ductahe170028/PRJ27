// Step 6 of a tick: enemies move. Every number about a kind comes from ENEMY_TYPES.
import { ENEMY_TYPES, NAV_REFRESH_TICKS, PLAYER_RADIUS, TICK_RATE, rangedOf } from './constants.js';
import { moveAtBase, retarget } from './base.js';
import { isBoss, moveBoss } from './boss.js';
import { lineOfSight, resolveCircle, type Rect } from './geometry.js';
import { GRID_COLS, buildGrid, gridCells, gridCol, gridRow } from './grid.js';
import { cellOf, flowDistances, flowTarget, type FlowField } from './navigation.js';
import type { ShooterState } from './state.js';

/** 6. Enemies move (straight at the player in plain sight, else along the flow
 * field), push each other apart, then leave walls. An enemy that shoots (a `ranged` kind) stands still
 * once it is within its `holdRange` of the player in plain sight; it never backs away. */
export function moveEnemies(state: ShooterState, t: number, walls: readonly Rect[]) {
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
  // A boss follows a flow field of its own, built on a grid that is grown by its body (state.bossBlocked).
  const ensureBossFlow = (): FlowField => {
    const goal = cellOf(player.x, player.y);
    let bossFlow = state.bossFlow;
    if (!bossFlow || bossFlow.goal !== goal || t - bossFlow.atTick >= NAV_REFRESH_TICKS) {
      bossFlow = { goal, atTick: t, dist: flowDistances(state.bossBlocked ?? state.blocked, goal) };
      state.bossFlow = bossFlow;
    }
    return bossFlow;
  };
  for (const enemy of enemies) {
    if (isBoss(enemy.type)) { moveBoss(state, enemy, t, walls, () => ensureBossFlow().dist); continue; }
    const kind = ENEMY_TYPES[enemy.type];
    const stride = kind.speed / TICK_RATE;
    // In a level with a base an enemy may be going for it: it keeps its own target (see base.ts).
    if (enemy.aimAtBase !== undefined) {
      retarget(state, enemy);
      if (enemy.aimAtBase) { moveAtBase(state, enemy, stride); continue; }
    }
    let toPlayer = true;
    let tx = player.x;
    let ty = player.y;
    const sight = lineOfSight(enemy, player, kind.radius, walls);
    if (!sight) {
      const target = flowTarget(state.blocked, ensureFlow().dist, enemy.x, enemy.y);
      if (target) { tx = target.x; ty = target.y; toPlayer = false; }
    }
    const dx = tx - enemy.x;
    const dy = ty - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) continue;
    const ranged = rangedOf(enemy.type);
    if (ranged && sight && distance <= ranged.holdRange) continue;
    // Chasing the player: stop just inside touching range instead of walking into the center.
    const room = toPlayer ? distance - (PLAYER_RADIUS + kind.radius - 1) : distance;
    const move = Math.min(stride, Math.max(0, room));
    enemy.x += (dx / distance) * move;
    enemy.y += (dy / distance) * move;
  }

  pushApart(state);
  for (const enemy of enemies) resolveCircle(enemy, ENEMY_TYPES[enemy.type].radius, walls);
}

/** Push overlapping enemies apart: half the overlap each, at most 2 px per tick. */
function pushApart(state: ShooterState) {
  const { enemies } = state;
  buildGrid(enemies);
  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i]!;
    const ra = ENEMY_TYPES[a.type].radius;
    const around = ra + state.maxEnemyRadius; // farthest center that can still overlap `a`
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
          // A boss is not pushed: the ordinary enemy next to it is pushed out, by the whole overlap (still at most 2 px).
          const aBoss = state.bossIndex !== undefined && isBoss(a.type);
          const otherBoss = state.bossIndex !== undefined && isBoss(other.type);
          if (aBoss && otherBoss) continue;
          if (aBoss) { const full = Math.min(reach - distance, 2); other.x += nx * full; other.y += ny * full; continue; }
          if (otherBoss) { const full = Math.min(reach - distance, 2); a.x -= nx * full; a.y -= ny * full; continue; }
          a.x -= nx * push; a.y -= ny * push;
          other.x += nx * push; other.y += ny * push;
        }
      }
    }
  }
}
