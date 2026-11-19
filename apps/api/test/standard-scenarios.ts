import type { GameSpec } from '@game-creator/contracts';

/** Platformer with the system-prompt physics (size 28, speed 260, jump 560,
 * gravity 1200): jump height about 126px, airborne reach about 243px. */
export function platformer(patch: Partial<GameSpec> = {}): GameSpec {
  return {
    version: '1.0', title: 'Scenario', genre: 'platformer', width: 960, height: 540,
    theme: { background: '#101b30', platform: '#32475f', player: '#c5f277', enemy: '#f27b91', collectible: '#ffd46b', accent: '#75c9cc' },
    player: { x: 80, y: 460, size: 28, speed: 260, jumpSpeed: 560, health: 3 },
    platforms: [], obstacles: [],
    enemies: [{ x: 40, y: 484, size: 28, speed: 60, axis: 'horizontal', range: 0, damage: 1 }],
    collectibles: [{ x: 300, y: 475, value: 10 }],
    controls: { movement: 'both', jump: 'both', restart: 'r' },
    win: { type: 'collect_all', scoreTarget: 10, surviveSeconds: 30 },
    lose: { healthDepleted: true, timeLimitSeconds: 0 },
    difficulty: { gravity: 1200, invulnerabilityMs: 1000, enemySpeedMultiplier: 1 },
    ...patch,
  };
}

/** A slow floor patrol between spawn and the coin. Its envelope (about 280px)
 * is wider than any jump, so a patrol-as-wall model can never cross it. */
export function patrolCrossing(patch: Partial<GameSpec> = {}): GameSpec {
  return platformer({
    enemies: [{ x: 480, y: 484, size: 28, speed: 60, axis: 'horizontal', range: 120, damage: 1 }],
    collectibles: [{ x: 860, y: 475, value: 10 }],
    ...patch,
  });
}

/** A stationary floor enemy between spawn and the coin: only a jump passes it. */
export function stationaryHurdle(): GameSpec {
  return platformer({
    enemies: [{ x: 480, y: 484, size: 28, speed: 60, axis: 'horizontal', range: 0, damage: 1 }],
    collectibles: [{ x: 700, y: 475, value: 10 }],
  });
}

/** A low corridor (50px headroom) closed on the right: the enemy inside can
 * not be jumped, so the coin behind it needs a hit. */
export function lowCorridor(): GameSpec {
  return platformer({
    platforms: [{ x: 560, y: 440, width: 320, height: 20 }],
    obstacles: [{ x: 740, y: 475, width: 40, height: 50 }],
    enemies: [{ x: 560, y: 484, size: 28, speed: 60, axis: 'horizontal', range: 0, damage: 1 }],
    collectibles: [{ x: 660, y: 475, value: 10 }],
  });
}

/** Spawn on a high ledge over a wall: each side of the floor is a one-way pit. */
export function twoPits(coins: GameSpec['collectibles']): GameSpec {
  return platformer({
    player: { x: 480, y: 226, size: 28, speed: 260, jumpSpeed: 560, health: 3 },
    platforms: [{ x: 480, y: 250, width: 200, height: 20 }],
    obstacles: [{ x: 480, y: 350, width: 40, height: 100 }, { x: 480, y: 450, width: 40, height: 100 }],
    enemies: [{ x: 40, y: 484, size: 28, speed: 60, axis: 'horizontal', range: 0, damage: 1 }],
    collectibles: coins,
    win: { type: 'collect_all', scoreTarget: 10, surviveSeconds: 30 },
  });
}
