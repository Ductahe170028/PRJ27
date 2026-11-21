import type { GameSpec } from '@game-creator/contracts';
import {
  FLOOR, TICKS_PER_SECOND, bodySupported, bodyValid, edgesOf, horizontalFuzz, simulateFlight, sweepClear,
  type FlightBody, type FlightWorld, type Point, type Rect, type SimulationBudget,
} from './platformer-physics.js';
import { analyzeHazards, zeroDamageNavigation, type HazardAnalysis } from './enemy-hazard.js';

export type { Point, Rect } from './platformer-physics.js';
export interface ReachablePoint extends Point { seconds: number }
const STEP = 16;
const EPS = 0.00001;
export const NODE_BUDGET = 350;
export const SIMULATION_BUDGET = 350_000;
/** Human tolerance for jumps: a jump edge is kept only if starting anywhere in
 * a run of at least this many px around its node (same surface, same target
 * x) still lands the whole body on the same target surface. Physics alone
 * accepts a jump that works from one exact x; a player cannot stand there.
 * Calibrated on the played fixtures: 16px drops the 2ef2 jump from platform 3
 * to platform 4 (world-top bump, shown playable by E2E); 12px keeps every
 * played layout unchanged. 12px is also the floor 2 * speed / 60 = 8.7px
 * rounded up to the 4px sampling grid. */
export const JUMP_START_TOLERANCE_PX = 12;
/** Sampling step for {@link JUMP_START_TOLERANCE_PX}. */
export const JUMP_SAMPLE_STEP_PX = 4;
/** Separate simulation budget for the tolerance samples of one graph. */
export const TOLERANCE_BUDGET = 350_000;
const half = (game: GameSpec) => game.player.size / 2;

export function flightBody(game: GameSpec): FlightBody {
  return { half: half(game), speed: game.player.speed, jumpSpeed: game.player.jumpSpeed, gravity: game.difficulty.gravity };
}

export function overlapsRect(a: Rect, b: Rect, gap = 0): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap - EPS
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap - EPS;
}

export function patrolRect(enemy: GameSpec['enemies'][number], multiplier = 1): Rect {
  // Arcade reverses velocity on the next tick; include one tick of overshoot.
  const overshoot = enemy.range ? enemy.speed * multiplier / 60 + 1 : 0;
  return { x: enemy.x, y: enemy.y,
    width: enemy.size + (enemy.axis === 'horizontal' ? 2 * (enemy.range + overshoot) : 0),
    height: enemy.size + (enemy.axis === 'vertical' ? 2 * (enemy.range + overshoot) : 0) };
}

export function withinWorld(rect: Rect): boolean {
  const b = edgesOf(rect);
  return b.left >= 0 && b.right <= 960 && b.top >= 70 && b.bottom <= 500;
}

export interface Navigation {
  points: ReachablePoint[];
  spawnPath: Point[];
  startupSeconds: number;
}

/** One Arcade jump or fall, using the same simulation as {@link buildPhysicalGraph}.
 * Returns the landing point when the body comes to rest on a surface.
 */
export function flightLanding(game: GameSpec, start: Point, targetX: number, jump: boolean): Point | undefined {
  const surfaces: Rect[] = [...game.platforms, ...game.obstacles, FLOOR];
  return simulateFlight({ solids: surfaces, surfaces }, flightBody(game), start, targetX, jump)?.end;
}

export type PhysicalEdgeKind = 'walk' | 'jump' | 'drop';

export interface PhysicalEdge {
  from: number;
  to: number;
  kind: PhysicalEdgeKind;
  ticks: number;
  /** Body center at every tick: points[0] is the start node, points[ticks] the end node. */
  points: Point[];
}

/** Standing points and moves built only from platforms, obstacles, the floor
 * and the world bounds. Directed: a drop may have no way back. No enemies. */
export interface PhysicalGraph {
  nodes: Point[];
  edges: PhysicalEdge[];
  /** Outgoing edge indices per node, in edge order. */
  out: number[][];
  /** Where the spawn fall comes to rest. Always node 0. */
  spawnNode: number;
  spawnPath: Point[];
  startupTicks: number;
  stats: {
    nodes: number; edges: number; simulatedSteps: number;
    /** Tolerance samples: simulated steps, jump edges dropped, budget hit. */
    toleranceSteps: number; jumpsBelowTolerance: number; toleranceBudgetExceeded: boolean;
  };
}

/** Per-repair memo. Created by the caller and passed down, never module state. */
export interface AnalysisCache {
  graphs: Map<string, PhysicalGraph | null>;
  hazards: Map<string, HazardAnalysis>;
  /** Work actually done (cache misses), for budgets and diagnostics. */
  counts: { graphBuilds: number; hazardRuns: number };
}

export function createAnalysisCache(): AnalysisCache {
  return { graphs: new Map(), hazards: new Map(), counts: { graphBuilds: 0, hazardRuns: 0 } };
}

function graphKey(game: GameSpec): string {
  const { x, y, size, speed, jumpSpeed } = game.player;
  return JSON.stringify([game.platforms, game.obstacles, x, y, size, speed, jumpSpeed, game.difficulty.gravity]);
}

function walkPoints(a: Point, b: Point, speed: number): Point[] {
  const step = speed / TICKS_PER_SECOND;
  const dx = Math.abs(b.x - a.x);
  const ticks = Math.max(1, Math.ceil(dx / step - 1e-9));
  const direction = Math.sign(b.x - a.x);
  const points: Point[] = [a];
  for (let k = 1; k <= ticks; k += 1) points.push({ x: a.x + direction * Math.min(dx, k * step), y: a.y });
  points[ticks] = { ...b };
  return points;
}

/** Bounded, conservative physical planner for the trusted renderer's static
 * geometry. An edge exists only when a simulated move really ends there. */
export interface GraphOptions {
  /** Defaults to JUMP_START_TOLERANCE_PX. Tests use 0 to see physics alone. */
  jumpTolerancePx?: number;
}

export function buildPhysicalGraph(game: GameSpec, cache?: AnalysisCache, options: GraphOptions = {}): PhysicalGraph | undefined {
  if (options.jumpTolerancePx !== undefined) return computePhysicalGraph(game, options.jumpTolerancePx);
  const key = cache ? graphKey(game) : '';
  if (cache?.graphs.has(key)) return cache.graphs.get(key) ?? undefined;
  const graph = computePhysicalGraph(game, JUMP_START_TOLERANCE_PX);
  if (cache) { cache.counts.graphBuilds += 1; cache.graphs.set(key, graph ?? null); }
  return graph;
}

function computePhysicalGraph(game: GameSpec, jumpTolerancePx: number): PhysicalGraph | undefined {
  const h = half(game);
  const blocks: Rect[] = [...game.platforms, ...game.obstacles];
  const surfaces = [...blocks, FLOOR];
  const world: FlightWorld = { solids: blocks, surfaces };
  const body = flightBody(game);
  const valid = (p: Point) => bodyValid(world, p, h);
  const clear = (a: Point, b: Point) => sweepClear(world, a, b, h);
  const supported = (p: Point) => bodySupported(world, p, h);
  const budget: SimulationBudget = { used: 0, limit: SIMULATION_BUDGET };
  const toleranceBudget: SimulationBudget = { used: 0, limit: TOLERANCE_BUDGET };
  let jumpsBelowTolerance = 0;
  const spawn = { x: game.player.x, y: game.player.y };
  if (!valid(spawn)) return undefined;
  const initial = supported(spawn)
    ? { end: spawn, points: [spawn], ticks: 0 }
    : simulateFlight(world, body, spawn, spawn.x, 'fall', budget);
  if (!initial) return undefined;
  const nodes: Point[] = [];
  const nodeSurface: number[] = [];
  const keys = new Set<string>();
  const add = (p: Point, surface: number) => {
    const id = `${p.x},${p.y}`;
    if (!keys.has(id) && valid(p) && supported(p)) { keys.add(id); nodes.push(p); nodeSurface.push(surface); }
  };
  add(initial.end, -1);
  surfaces.forEach((r, surface) => {
    const y = r.y - r.height / 2 - h;
    const left = Math.max(h, r.x - r.width / 2 + h), right = Math.min(960 - h, r.x + r.width / 2 - h);
    for (let x = Math.ceil(left / STEP) * STEP; x <= right; x += STEP) add({ x, y }, surface);
    for (const x of [left, right, Math.min(right, Math.max(left, initial.end.x))]) add({ x, y }, surface);
  });
  // Reject layouts exceeding the work budget rather than making an optimistic
  // claim of reachability or blocking the API event loop on pathological input.
  if (nodes.length > NODE_BUDGET) return undefined;
  // Surface that carries the whole body of a standing point.
  const surfaceOf = (p: Point) => surfaces.findIndex((r) => Math.abs(p.y + h - (r.y - r.height / 2)) < EPS
    && p.x - h >= r.x - r.width / 2 - EPS && p.x + h <= r.x + r.width / 2 + EPS);
  const nodeSupport = nodes.map(surfaceOf);
  const landings = new Map<string, number>();
  /** Surface where a jump from (x, y) toward targetX comes to rest, or -1. */
  const landingSurface = (x: number, y: number, targetX: number): number => {
    const id = `${x},${y},${targetX}`;
    const known = landings.get(id);
    if (known !== undefined) return known;
    if (toleranceBudget.used > toleranceBudget.limit) return -1;
    const flight = simulateFlight(world, body, { x, y }, targetX, 'jump', toleranceBudget);
    const surface = flight ? surfaceOf(flight.end) : -1;
    landings.set(id, surface);
    return surface;
  };
  /** Starts every JUMP_SAMPLE_STEP_PX around the node on its own surface; the
   * successes must form one run through the node at least the tolerance wide.
   * A start is standable as in Phaser: the body rests on the surface while it
   * still overlaps it, also past the edge. The overlap must exceed one step of
   * horizontal movement, so a real player can stop there. Landings still need
   * the whole body on the target surface. */
  const fuzz = horizontalFuzz(body);
  const restsOn = (p: Point, surface: number) => {
    const r = surfaces[surface]!;
    return Math.abs(p.y + h - (r.y - r.height / 2)) < EPS
      && Math.min(p.x + h, r.x + r.width / 2) - Math.max(p.x - h, r.x - r.width / 2) > fuzz;
  };
  const jumpTolerated = (from: number, to: number): boolean => {
    const a = nodes[from]!, b = nodes[to]!;
    const own = nodeSupport[from]!, target = nodeSupport[to]!;
    if (own < 0 || target < 0) return false;
    const works = (offset: number) => {
      const start = { x: a.x + offset, y: a.y };
      return valid(start) && restsOn(start, own) && landingSurface(start.x, start.y, b.x) === target;
    };
    const needed = jumpTolerancePx;
    let right = 0, left = 0;
    while ((right + left) * JUMP_SAMPLE_STEP_PX < needed && right * JUMP_SAMPLE_STEP_PX < needed && works((right + 1) * JUMP_SAMPLE_STEP_PX)) right += 1;
    while ((right + left) * JUMP_SAMPLE_STEP_PX < needed && left * JUMP_SAMPLE_STEP_PX < needed && works(-(left + 1) * JUMP_SAMPLE_STEP_PX)) left += 1;
    return (right + left) * JUMP_SAMPLE_STEP_PX >= needed;
  };
  const edges: PhysicalEdge[] = [];
  const jumpHeight = game.player.jumpSpeed ** 2 / (2 * game.difficulty.gravity);
  for (let from = 0; from < nodes.length; from += 1) for (let to = 0; to < nodes.length; to += 1) {
    if (budget.used > budget.limit) return undefined;
    const a = nodes[from]!, b = nodes[to]!;
    const dx = Math.abs(b.x - a.x);
    if (from !== to && a.y === b.y && dx <= STEP + 1 && clear(a, b)) {
      const mid = { x: (a.x + b.x) / 2, y: a.y };
      if (supported(mid)) {
        const points = walkPoints(a, b, game.player.speed);
        edges.push({ from, to, kind: 'walk', ticks: points.length - 1, points });
        continue;
      }
    }
    // Cheap filters only. The ballistic duration is an upper bound for a
    // flight that bumps a ceiling, so no feasible flight is skipped here.
    const discriminant = game.player.jumpSpeed ** 2 + 2 * game.difficulty.gravity * (b.y - a.y);
    if (from === to || discriminant < 0 || a.y - b.y > jumpHeight - 8) continue;
    const duration = (game.player.jumpSpeed + Math.sqrt(discriminant)) / game.difficulty.gravity;
    if (dx > game.player.speed * duration) continue;
    const flight = simulateFlight(world, body, a, b.x, 'jump', budget);
    if (flight && Math.abs(flight.end.x - b.x) < EPS && Math.abs(flight.end.y - b.y) < EPS) {
      if (jumpTolerated(from, to)) edges.push({ from, to, kind: 'jump', ticks: flight.ticks, points: flight.points });
      else jumpsBelowTolerance += 1;
    }
  }
  // The way down is walking off a lip. Every surface has its own two lips; the
  // body walks until nothing supports it, falls, and may steer while falling.
  const levels = new Map<number, number[]>();
  nodes.forEach((node, index) => levels.set(node.y, [...(levels.get(node.y) ?? []), index]));
  const levelList = [...levels.entries()].sort((a, b) => a[0] - b[0]);
  const lips: Array<{ node: number; direction: -1 | 1 }> = [];
  surfaces.forEach((_, surface) => {
    const own = nodes.flatMap((_, index) => (nodeSurface[index] === surface ? [index] : []))
      .sort((a, b) => nodes[a]!.x - nodes[b]!.x || a - b);
    if (own.length === 0) return;
    lips.push({ node: own[0]!, direction: -1 }, { node: own[own.length - 1]!, direction: 1 });
  });
  for (const lip of lips) {
    const origin = nodes[lip.node]!;
    for (const [y, lower] of levelList) {
      if (y <= origin.y + 4) continue;
      if (budget.used > budget.limit) return undefined;
      const aim = origin.x + lip.direction * (game.player.size + 0.5);
      const nearest = lower.reduce((best, index) => (Math.abs(nodes[index]!.x - aim) < Math.abs(nodes[best]!.x - aim) ? index : best));
      const flight = simulateFlight(world, body, origin, nodes[nearest]!.x, 'walk-off', budget, lip.direction > 0 ? 960 : 0);
      if (!flight || Math.abs(flight.end.y - y) > EPS) continue;
      const dest = lower.reduce((best, index) => (Math.abs(nodes[index]!.x - flight.end.x) < Math.abs(nodes[best]!.x - flight.end.x) ? index : best));
      if (Math.abs(nodes[dest]!.x - flight.end.x) > STEP + 1) continue;
      const tail = walkPoints(flight.end, nodes[dest]!, game.player.speed);
      const points = Math.abs(nodes[dest]!.x - flight.end.x) < EPS ? flight.points : [...flight.points, ...tail.slice(1)];
      edges.push({ from: lip.node, to: dest, kind: 'drop', ticks: points.length - 1, points });
    }
  }
  const out = nodes.map(() => [] as number[]);
  edges.forEach((edge, index) => out[edge.from]!.push(index));
  return {
    nodes, edges, out, spawnNode: 0, spawnPath: initial.points, startupTicks: initial.ticks,
    stats: {
      nodes: nodes.length, edges: edges.length, simulatedSteps: budget.used,
      toleranceSteps: toleranceBudget.used, jumpsBelowTolerance, toleranceBudgetExceeded: toleranceBudget.used > toleranceBudget.limit,
    },
  };
}

/** Shortest outward times (ticks) from the spawn node over physical edges. */
export function outwardTicks(graph: PhysicalGraph): number[] {
  const costs = graph.nodes.map(() => Infinity);
  const done = graph.nodes.map(() => false);
  costs[graph.spawnNode] = 0;
  for (;;) {
    let next = -1;
    for (let i = 0; i < costs.length; i += 1) if (!done[i] && Number.isFinite(costs[i]) && (next < 0 || costs[i]! < costs[next]!)) next = i;
    if (next < 0) break;
    done[next] = true;
    for (const index of graph.out[next]!) {
      const edge = graph.edges[index]!;
      costs[edge.to] = Math.min(costs[edge.to]!, costs[next]! + edge.ticks);
    }
  }
  return costs;
}

/** Everything the body passes through on a one-way route from spawn. No round
 * trip is required here; objective-route.ts rejects one-way coin traps. */
export function physicalNavigation(graph: PhysicalGraph): Navigation {
  const outward = outwardTicks(graph);
  const cloud = new Map<string, ReachablePoint>();
  const save = (p: Point, ticks: number) => {
    if (!Number.isFinite(ticks)) return;
    const id = `${Math.round(p.x)},${Math.round(p.y)}`;
    const prior = cloud.get(id);
    const seconds = ticks / TICKS_PER_SECOND;
    if (!prior || seconds < prior.seconds) cloud.set(id, { ...p, seconds });
  };
  graph.nodes.forEach((p, i) => save(p, outward[i]!));
  for (const edge of graph.edges) {
    const start = outward[edge.from]!;
    if (Number.isFinite(start)) edge.points.forEach((p, k) => save(p, start + k));
  }
  return { points: [...cloud.values()], spawnPath: graph.spawnPath, startupSeconds: graph.startupTicks / TICKS_PER_SECOND };
}

export function hazardAnalysis(game: GameSpec, graph: PhysicalGraph, cache?: AnalysisCache): HazardAnalysis {
  const key = cache ? JSON.stringify([graphKey(game), game.enemies, game.difficulty.enemySpeedMultiplier, game.collectibles]) : '';
  const hit = cache?.hazards.get(key);
  if (hit) return hit;
  const analysis = analyzeHazards(game, graph);
  if (cache) { cache.counts.hazardRuns += 1; cache.hazards.set(key, analysis); }
  return analysis;
}

/** Top-down: grid BFS where enemy patrol envelopes may be walls (unchanged).
 * Platformer: avoidEnemies=false is the physical graph only; avoidEnemies=true
 * is the zero-damage navigation from enemy-hazard.ts on top of that graph.
 */
export function buildNavigation(game: GameSpec, avoidEnemies: boolean, cache?: AnalysisCache): Navigation | undefined {
  const h = half(game);
  if (game.genre === 'top-down') {
    const blocks: Rect[] = [...game.platforms, ...game.obstacles];
    const hazards = avoidEnemies ? game.enemies.map((enemy) => patrolRect(enemy, game.difficulty.enemySpeedMultiplier)) : [];
    const solidWorld: FlightWorld = { solids: [...blocks, ...hazards], surfaces: [] };
    const valid = (p: Point) => bodyValid(solidWorld, p, h);
    const clear = (a: Point, b: Point) => sweepClear(solidWorld, a, b, h);
    const start = { x: game.player.x, y: game.player.y };
    if (!valid(start)) return undefined;
    const queue: Array<Point & { steps: number }> = [{ ...start, steps: 0 }];
    const seen = new Set([`${start.x},${start.y}`]);
    for (let i = 0; i < queue.length; i += 1) {
      const point = queue[i]!;
      for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]] as const) {
        const next = { x: point.x + dx, y: point.y + dy, steps: point.steps + 1 };
        const id = `${next.x},${next.y}`;
        if (!seen.has(id) && clear(point, next)) { seen.add(id); queue.push(next); }
      }
    }
    // All moves are reversible. Round-trip durations are safe upper bounds for
    // collecting multiple items by returning to spawn between excursions.
    return { points: queue.map((p) => ({ x: p.x, y: p.y, seconds: 2 * p.steps * STEP / game.player.speed })), spawnPath: [start], startupSeconds: 0 };
  }
  const graph = buildPhysicalGraph(game, cache);
  if (!graph) return undefined;
  if (!avoidEnemies) return physicalNavigation(graph);
  return zeroDamageNavigation(graph, hazardAnalysis(game, graph, cache));
}

export function collectibleCost(game: GameSpec, coin: Point, navigation: Navigation): number {
  const reach = game.player.size / 2 + 10; // Actual staticImage body is 20x20.
  let best = Infinity;
  for (const p of navigation.points) if (Math.abs(p.x - coin.x) < reach - 2 && Math.abs(p.y - coin.y) < reach - 2) best = Math.min(best, p.seconds);
  return best;
}

/** Same pickup rule as {@link collectibleCost}: the 20x20 coin body must be
 * entered by 2px, so a grazing pass is never counted. */
export function touchesCoin(game: GameSpec, p: Point, coin: Point): boolean {
  const reach = game.player.size / 2 + 10;
  return Math.abs(p.x - coin.x) < reach - 2 && Math.abs(p.y - coin.y) < reach - 2;
}
