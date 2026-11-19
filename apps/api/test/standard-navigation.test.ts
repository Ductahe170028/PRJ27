import { describe, expect, it } from 'vitest';
import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import {
  buildNavigation, buildPhysicalGraph, collectibleCost, patrolRect, touchesCoin, type PhysicalGraph,
} from '../src/services/game-geometry.js';
import { analyzeHazards, enemyTracks, type HazardAnalysis } from '../src/services/enemy-hazard.js';
import { checkObjectiveRoute } from '../src/services/objective-route.js';
import { FLOOR, simulateFlight } from '../src/services/platformer-physics.js';
import { repairGamePlacement } from '../src/services/repair-game-placement.js';
import { sampleSpec } from './fixtures.js';
import { fixtureSpec } from './standard-fixtures.js';
import { lowCorridor, patrolCrossing, platformer, stationaryHurdle, twoPits } from './standard-scenarios.js';

const body = { half: 14, speed: 260, jumpSpeed: 560, gravity: 1200 };
const reach = (game: GameSpec, avoidEnemies: boolean) => {
  const navigation = buildNavigation(game, avoidEnemies);
  return game.collectibles.map((coin) => (navigation ? collectibleCost(game, coin, navigation) : Infinity));
};
const routeOf = (game: GameSpec, graph: PhysicalGraph, analysis: HazardAnalysis, timeLimitSeconds = game.lose.timeLimitSeconds) =>
  checkObjectiveRoute({
    nodeCount: graph.nodes.length, spawn: graph.spawnNode, spawnSafe: analysis.spawnSafe, edges: analysis.edges,
    nodeCoins: analysis.nodeCoins.map((list, node) => (analysis.safe[node] ? list : [])),
    coinValues: game.collectibles.map((coin) => coin.value), win: game.win, timeLimitSeconds,
    startupSeconds: graph.startupTicks / 60, ticksPerSecond: 60,
  });
const physicalRouteOf = (game: GameSpec, graph: PhysicalGraph, timeLimitSeconds = game.lose.timeLimitSeconds) =>
  checkObjectiveRoute({
    nodeCount: graph.nodes.length, spawn: graph.spawnNode, spawnSafe: true,
    edges: graph.edges.map((edge) => ({
      from: edge.from, to: edge.to, ticks: edge.ticks, timed: false,
      coins: game.collectibles.flatMap((coin, index) => (edge.points.some((p) => touchesCoin(game, p, coin)) ? [index] : [])),
    })),
    nodeCoins: graph.nodes.map((node) => game.collectibles.flatMap((coin, index) => (touchesCoin(game, node, coin) ? [index] : []))),
    coinValues: game.collectibles.map((coin) => coin.value), win: game.win, timeLimitSeconds,
    startupSeconds: graph.startupTicks / 60, ticksPerSecond: 60,
  });

describe('platformer physics (matches Phaser Arcade, conservative where it differs)', () => {
  const world = (blocks: Array<{ x: number; y: number; width: number; height: number }>) => ({ solids: blocks, surfaces: [...blocks, FLOOR] });

  it('bumps the world top, keeps moving sideways and lands (E2E: world top)', () => {
    const p3 = { x: 750, y: 190, width: 140, height: 20 }, p4 = { x: 880, y: 120, width: 120, height: 20 };
    const flight = simulateFlight(world([p3, p4]), body, { x: 757, y: 166 }, 900, 'jump')!;
    expect(flight).toBeDefined();
    expect(Math.min(...flight.points.map((p) => p.y))).toBe(84); // body top clamped at y=70
    expect(flight.end.y).toBe(96); // standing on platform 4 (top 110)
  });

  it('bumps the underside of a platform, then falls back (E2E: underside)', () => {
    const flight = simulateFlight(world([{ x: 480, y: 400, width: 300, height: 20 }]), body, { x: 480, y: 486 }, 480, 'jump')!;
    expect(Math.min(...flight.points.map((p) => p.y))).toBe(424); // body top at the bottom y=410
    expect(flight.end.y).toBe(486);
  });

  it('rejects a flight that touches a block side', () => {
    const wall = { x: 560, y: 450, width: 40, height: 100 };
    expect(simulateFlight(world([wall]), body, { x: 480, y: 486 }, 640, 'jump')).toBeUndefined();
  });

  it('walks off a lip and falls from the first unsupported tick (E2E: drop)', () => {
    const high = { x: 300, y: 300, width: 200, height: 20 }, low = { x: 700, y: 400, width: 400, height: 20 };
    const flight = simulateFlight(world([high, low]), body, { x: 386, y: 276 }, 620, 'walk-off', undefined, 960)!;
    const first = flight.points.findIndex((p) => p.y > 276);
    expect(flight.points[first]!.x - 14).toBeGreaterThan(400); // left the edge x=400
    expect(flight.points[first - 1]!.x - 14).toBeLessThan(400 + 1e-6);
    expect(flight.end.y).toBe(376);
  });
});

describe('physical reachability is independent of enemies', () => {
  it('1. adding or removing enemies does not change the physical graph or navigation', () => {
    const game = fixtureSpec('c36f');
    const other = { ...structuredClone(game), enemies: [{ ...game.enemies[0]!, x: 900, range: 0 }] };
    expect(buildPhysicalGraph(other)).toEqual(buildPhysicalGraph(game));
    expect(buildNavigation(other, false)).toEqual(buildNavigation(game, false));
  });

  it('7. never passes through a platform or a wall', () => {
    const game = platformer({
      obstacles: [{ x: 480, y: 450, width: 40, height: 100 }, { x: 480, y: 350, width: 40, height: 100 }],
      collectibles: [{ x: 700, y: 475, value: 10 }],
    });
    expect(reach(game, false)).toEqual([Infinity]);
    const graph = buildPhysicalGraph(game)!;
    expect(graph.edges.some((edge) => edge.points.some((p) => p.x > 460 - 14 && p.x < 500 + 14 && p.y > 300 - 14))).toBe(false);
  });

  it('8. never accepts a jump higher than the physics allows', () => {
    const game = platformer({ platforms: [{ x: 480, y: 330, width: 200, height: 20 }] });
    const graph = buildPhysicalGraph(game)!;
    const onTop = graph.nodes.flatMap((node, index) => (Math.abs(node.y - 306) < 1e-6 ? [index] : []));
    expect(onTop.length).toBeGreaterThan(0);
    expect(graph.edges.some((edge) => !onTop.includes(edge.from) && onTop.includes(edge.to))).toBe(false);
    expect(buildNavigation(game, false)!.points.some((p) => Math.abs(p.y - 306) < 1e-6)).toBe(false);
  });
});

describe('enemies are moving hazards (zero-damage policy)', () => {
  it('2. a patrol is not a static wall: its envelope is wider than any jump, yet the coin behind it is reachable', () => {
    const game = patrolCrossing();
    const envelope = patrolRect(game.enemies[0]!);
    expect(envelope.width).toBeGreaterThan(243 + 28);
    expect(Number.isFinite(reach(game, true)[0]!)).toBe(true);
  });

  it('3. crosses the danger zone only inside a time window', () => {
    const game = patrolCrossing();
    const graph = buildPhysicalGraph(game)!;
    const analysis = analyzeHazards(game, graph);
    const timed = analysis.edges.filter((edge) => edge.timed);
    expect(timed.length).toBeGreaterThan(0);
    // Every timed edge crosses the patrol: one end is left of it, the other right of it.
    const envelope = analysis.tracks[0]!.envelope;
    expect(timed.some((edge) => graph.nodes[edge.from]!.x < envelope.x && graph.nodes[edge.to]!.x > envelope.x)).toBe(true);
  });

  it('4. waits at a safe point before moving: the bound includes the wait', () => {
    const game = patrolCrossing();
    const graph = buildPhysicalGraph(game)!;
    const analysis = analyzeHazards(game, graph);
    const crossing = analysis.edges.filter((edge) => edge.timed);
    // A timed edge costs more than the fastest physical path between its ends.
    const fastest = (from: number, to: number) => {
      const cost = graph.nodes.map(() => Infinity);
      cost[from] = 0;
      for (let pass = 0; pass < graph.nodes.length; pass += 1) for (const edge of graph.edges) cost[edge.to] = Math.min(cost[edge.to]!, cost[edge.from]! + edge.ticks);
      return cost[to]!;
    };
    expect(crossing.some((edge) => edge.ticks > fastest(edge.from, edge.to))).toBe(true);
    expect(analysis.safe[crossing[0]!.from]).toBe(true);
    expect(analysis.safe[crossing[0]!.to]).toBe(true);
  });

  it('5. jumps over an enemy when the trajectory clears its body', () => {
    const game = stationaryHurdle();
    expect(Number.isFinite(reach(game, true)[0]!)).toBe(true);
    const graph = buildPhysicalGraph(game)!;
    const analysis = analyzeHazards(game, graph);
    const enemy = analysis.tracks[0]!.envelope;
    const over = analysis.edges.filter((edge) => edge.physical !== undefined
      && graph.nodes[edge.from]!.x < enemy.x && graph.nodes[edge.to]!.x > enemy.x);
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((edge) => graph.edges[edge.physical!]!.kind === 'jump')).toBe(true);
  });

  it('6. never accepts a route that must take a hit', () => {
    const game = lowCorridor();
    expect(Number.isFinite(reach(game, false)[0]!)).toBe(true); // walking through the enemy
    expect(reach(game, true)).toEqual([Infinity]); // health is never spent
    const repaired = repairGamePlacement(game);
    // The layout is only accepted once the floor enemy is slid off the way.
    expect(repaired.enemies[0]!.x).not.toBe(game.enemies[0]!.x);
    expect(Math.abs(repaired.enemies[0]!.x - game.enemies[0]!.x)).toBeLessThanOrEqual(160);
    expect(Number.isFinite(reach(repaired, true)[0]!)).toBe(true);
  }, 20_000);

  it('models the renderer turn one step late and keeps one track per enemy', () => {
    const game = patrolCrossing();
    const [track] = enemyTracks(game);
    expect(track!.predictable).toBe(true);
    // speed 60 => 1px per step; range 120 reached after 120 steps, seen one step late.
    expect(Math.max(...track!.positions)).toBe(480 + 121);
    expect(Math.min(...track!.positions)).toBe(480 - 121);
  });
});

describe('objective routes on the directed graph', () => {
  it('9. collect_all does not need a way back after the last coin', () => {
    const game = twoPits([{ x: 200, y: 475, value: 10 }]);
    const graph = buildPhysicalGraph(game)!;
    expect(graph.edges.some((edge) => graph.nodes[edge.from]!.y > 400 && graph.nodes[edge.to]!.y < 300)).toBe(false); // no way up
    expect(routeOf(game, graph, analyzeHazards(game, graph)).ok).toBe(true);
    expect(repairGamePlacement(game).collectibles).toEqual(game.collectibles);
  });

  it('10. rejects a one-way trap: two pits, one coin in each', () => {
    const game = twoPits([{ x: 200, y: 475, value: 5 }, { x: 760, y: 475, value: 5 }]);
    expect(reach(game, true).every(Number.isFinite)).toBe(true); // each coin alone is reachable
    const graph = buildPhysicalGraph(game)!;
    const route = routeOf(game, graph, analyzeHazards(game, graph));
    expect(route.ok).toBe(false);
    expect(route.failure!.path).toBe('collectibles.1');
    const before = structuredClone(game);
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining({ code: 'invalid_game_spec', issues: ['collectibles.1'] }));
    expect(() => repairGamePlacement(game)).toThrow(/bẫy một chiều/);
    expect(game).toEqual(before);
  });

  it('11. collects every coin in one valid order', () => {
    const game = fixtureSpec('2ef2');
    const graph = buildPhysicalGraph(game)!;
    const route = routeOf(game, graph, analyzeHazards(game, graph), 600);
    expect(route.ok).toBe(true);
    expect(route.reachable).toEqual([true, true, true, true, true, true]);
    expect(route.upperBoundSeconds).toBeLessThan(600);
  }, 20_000);

  it('reach_score uses the best one-way path value', () => {
    const game = twoPits([{ x: 200, y: 475, value: 5 }, { x: 760, y: 475, value: 7 }]);
    const graph = buildPhysicalGraph(game)!;
    const analysis = analyzeHazards(game, graph);
    expect(routeOf({ ...game, win: { type: 'reach_score', scoreTarget: 7, surviveSeconds: 30 } }, graph, analysis).ok).toBe(true);
    const tooMuch = routeOf({ ...game, win: { type: 'reach_score', scoreTarget: 12, surviveSeconds: 30 } }, graph, analysis);
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.failure!.path).toBe('win.scoreTarget');
  });

  it('17. a time limit counts the hazard wait', () => {
    const game = patrolCrossing();
    const graph = buildPhysicalGraph(game)!;
    const analysis = analyzeHazards(game, graph);
    const physical = physicalRouteOf(game, graph, 600).upperBoundSeconds!;
    const safe = routeOf(game, graph, analysis, 600).upperBoundSeconds!;
    expect(safe).toBeGreaterThan(physical);
    const deadline = (physical + safe) / 2;
    expect(physicalRouteOf(game, graph, deadline).ok).toBe(true);
    const late = routeOf(game, graph, analysis, deadline);
    expect(late.ok).toBe(false);
    expect(late.failure!.path).toBe('lose.timeLimitSeconds');
  });
});

describe('repair transactions', () => {
  it('12-13. keeps coin count, values, win and lose on every fixture', () => {
    for (const name of ['c36f', 'dca2', '2ef2', 'eb2a', '8db8']) {
      const before = fixtureSpec(name);
      const after = repairGamePlacement(fixtureSpec(name));
      expect(after.collectibles.map((coin) => coin.value)).toEqual(before.collectibles.map((coin) => coin.value));
      expect(after.enemies.map(({ x: _x, y: _y, ...rest }) => rest)).toEqual(before.enemies.map(({ x: _x, y: _y, ...rest }) => rest));
      expect(after.win).toEqual(before.win);
      expect(after.lose).toEqual(before.lose);
      expect(GameSpecSchema.safeParse(after).success).toBe(true);
    }
  }, 60_000);

  it('14. rolls back a clamp that would overlap another platform, without mutating input', () => {
    const game = platformer({
      platforms: [{ x: 900, y: 300, width: 120, height: 20 }, { x: 940, y: 300, width: 120, height: 20 }],
      collectibles: [{ x: 300, y: 475, value: 10 }],
    });
    const before = structuredClone(game);
    expect(() => repairGamePlacement(game)).toThrow(expect.objectContaining({ code: 'invalid_game_spec', issues: ['platforms.1'] }));
    expect(game).toEqual(before);
  });

  it('15. is deterministic', () => {
    for (const name of ['c36f', 'eb2a']) expect(repairGamePlacement(fixtureSpec(name))).toEqual(repairGamePlacement(fixtureSpec(name)));
    const game = patrolCrossing();
    expect(analyzeHazards(game, buildPhysicalGraph(game)!)).toEqual(analyzeHazards(game, buildPhysicalGraph(game)!));
  }, 60_000);

  it('16. top-down keeps treating patrols as walls', () => {
    const game = sampleSpec('top-down');
    // A patrol that seals the only corridor to the coin.
    game.obstacles = [
      { x: 480, y: 120, width: 40, height: 100 }, { x: 480, y: 210, width: 40, height: 100 },
      { x: 480, y: 390, width: 40, height: 100 }, { x: 480, y: 450, width: 40, height: 100 },
    ];
    game.enemies = [{ x: 480, y: 300, size: 28, speed: 30, axis: 'vertical', range: 40, damage: 1 }];
    game.collectibles = [{ x: 800, y: 300, value: 10 }];
    expect(Number.isFinite(reach(game, false)[0]!)).toBe(true);
    expect(reach(game, true)).toEqual([Infinity]);
    expect(buildNavigation(game, true)!.points.every((p) => p.x < 480)).toBe(true);
  });
});
