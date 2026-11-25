import { describe, expect, it, vi } from 'vitest';
import {
  BOSS_NAV_SLACK, ENEMY_TYPES, FIELD, NAV_INFLATE, SHOOTER_LEVELS, blockedCells, bossBlockedCells, cellOf, cellX, cellY, createSim, flowDistances, freeSpaceConnected, pointRectDistance,
  type ShooterLevel,
} from '@game-creator/contracts';
import { SHOOTER_MAPS } from '../src/shooter/brief.js';
import { compileShooter } from '../src/shooter/compile.js';
import { arrivalDistance, bossReach, levelReach, reachBrief, type BossKind } from '../scripts/boss-reach.js';

vi.setConfig({ testTimeout: 180_000 });

const BOSSES: BossKind[] = ['crusher', 'gunner'];
const radius = (boss: BossKind) => ENEMY_TYPES[boss].radius;
/** Seed numbers (seed = n * 7919). 2, 22 and 28 are the three games where the crusher used to stand still for good (Stage 4C). */
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 22, 28];

describe('Stage 4C.1: the boss always reaches a player who stands still (intensity 1, 120 s)', () => {
  for (const boss of BOSSES) {
    for (const map of SHOOTER_MAPS) {
      it(`${boss} on ${map}: near the player in ${NUMBERS.length} of ${NUMBERS.length} games`, () => {
        const misses: string[] = [];
        for (const n of NUMBERS) {
          const result = bossReach(reachBrief(boss, map), n * 7919, 120);
          if (!result.arrived) misses.push(`seed ${n * 7919} (closest ${Math.round(result.closest)} px, needs ${arrivalDistance(boss)})`);
        }
        expect(misses).toEqual([]);
      });
    }
  }

  it('the two hand-made boss levels pass the same rule and the same measurement', () => {
    for (const [name, boss] of [['boss-crusher', 'crusher'], ['boss-gunner', 'gunner']] as const) {
      const level = SHOOTER_LEVELS[name]!;
      expect(freeSpaceConnected(level, 0, bossBlockedCells(level.obstacles, radius(boss))), name).toBe(true);
      expect(levelReach(level, boss, 120).arrived, name).toBe(true);
    }
  });

  it('the arrival distance is 140 px, or the hold range plus 40 for the boss that keeps its distance', () => {
    expect(arrivalDistance('crusher')).toBe(140);
    expect(arrivalDistance('gunner')).toBe(340); // hold range 300
  });
});

describe('a level with a boss only uses a layout the boss can walk', () => {
  it('every compiled boss level: each spawn point reaches the player on the grid grown by the boss\'s body', () => {
    for (const boss of BOSSES) for (const map of SHOOTER_MAPS) for (const n of [1, 2, 3, 4, 5, 6]) {
      const level = compileShooter(reachBrief(boss, map), n * 7919).level;
      expect(freeSpaceConnected(level, 0, bossBlockedCells(level.obstacles, radius(boss))), `${boss} ${map} ${n}`).toBe(true);
    }
  });

  it('the check does refuse a layout whose only way through is a gap narrower than the boss', () => {
    // A wall across the field with one opening: 60 px wide (an ordinary brute passes, a 68 px crusher does not).
    const wall = (gap: number): ShooterLevel => {
      const top = 305 - gap / 2;
      const bottom = 305 + gap / 2;
      return {
        ...SHOOTER_LEVELS.arena,
        obstacles: [{ x: 700, y: (70 + top) / 2, width: 30, height: top - 70 }, { x: 700, y: (bottom + 540) / 2, width: 30, height: 540 - bottom }],
        spawnPoints: [{ x: 900, y: 305 }, { x: 900, y: 150 }, { x: 900, y: 450 }],
      };
    };
    expect(freeSpaceConnected(wall(60), 0, bossBlockedCells(wall(60).obstacles, radius('crusher')))).toBe(false);
    expect(freeSpaceConnected(wall(60), 48)).toBe(true); // the ordinary check lets it through: that is the bug
    expect(freeSpaceConnected(wall(120), 0, bossBlockedCells(wall(120).obstacles, radius('crusher')))).toBe(true);
  });
});

describe('the grid a boss walks on', () => {
  it('is the ordinary grid grown by the boss\'s radius plus the slack, and blocks the cells too near the field edge', () => {
    const level = SHOOTER_LEVELS.pillars;
    const ordinary = blockedCells(level.obstacles, NAV_INFLATE);
    for (const boss of BOSSES) {
      const grown = bossBlockedCells(level.obstacles, radius(boss));
      expect(grown.filter(Boolean).length).toBeGreaterThan(ordinary.filter(Boolean).length);
      ordinary.forEach((blocked, cell) => { if (blocked) expect(grown[cell], `cell ${cell}`).toBe(true); }); // never frees a cell
      // exactly: near an obstacle (radius + slack), or a center the boss's body cannot occupy (inside the field edge by its radius)
      grown.forEach((blocked, cell) => {
        const x = cellX(cell);
        const y = cellY(cell);
        const expected = y >= FIELD.bottom || level.obstacles.some((o) => pointRectDistance(x, y, o) < radius(boss) + BOSS_NAV_SLACK)
          || x < FIELD.left + radius(boss) || x > FIELD.right - radius(boss) || y < FIELD.top + radius(boss) || y > FIELD.bottom - radius(boss);
        expect(blocked, `${boss} cell ${cell}`).toBe(expected);
      });
      // the cell of the top-left corner (center 10, 80) is nearer the edge than the radius
      expect(grown[cellOf(10, 80)]).toBe(true);
    }
  });

  it('a level with a boss carries it in its state, a level without one does not (nothing changes for old levels)', () => {
    const withBoss = createSim(compileShooter(reachBrief('crusher', 'pillars'), 7919).level);
    expect(withBoss.bossBlocked).toBeDefined();
    expect(withBoss.bossBlocked).toEqual(bossBlockedCells(withBoss.level.obstacles, ENEMY_TYPES.crusher.radius));
    for (const [name, level] of Object.entries(SHOOTER_LEVELS)) {
      const state = createSim(level);
      if (state.level.waves.some((w) => w.type === 'crusher' || w.type === 'gunner')) continue;
      expect('bossBlocked' in state, name).toBe(false);
      expect('bossFlow' in state, name).toBe(false);
    }
  });

  it("the boss's grid leaves out a gap its body does not fit, while the ordinary grid keeps it", () => {
    // A wall at x = 600: a gap of 60 px between y 200 and 260, then a wall to y 380, then an opening of 160 px down to the bottom.
    const base = compileShooter(reachBrief('crusher', 'open-arena'), 7919).level;
    const level: ShooterLevel = { ...base, obstacles: [{ x: 600, y: 135, width: 30, height: 130 }, { x: 600, y: 320, width: 30, height: 120 }] };
    const goal = cellOf(level.player.x, level.player.y);
    const ordinary = flowDistances(blockedCells(level.obstacles, NAV_INFLATE), goal);
    const grown = flowDistances(bossBlockedCells(level.obstacles, radius('crusher')), goal);
    const gap = cellOf(600, 230);
    expect(ordinary[gap]).toBeGreaterThanOrEqual(0); // an ordinary enemy (and the old boss path) goes through the gap
    expect(grown[gap]).toBe(-1); // the boss's path does not
    expect(grown[cellOf(850, 300)]).toBeGreaterThan(0); // the right side is still reachable, by the opening
    expect(grown[cellOf(850, 300)]).toBeGreaterThan(ordinary[cellOf(850, 300)]!); // ...which is the longer way
  });
});
