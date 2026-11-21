// Platformer enemies as moving hazards over the physical graph. Pure functions;
// input and output are plain serializable data.
//
// Zero-damage policy: a route is accepted only if it never overlaps an enemy.
// The player may wait at a safe standing point (no enemy can ever reach it),
// time a move from there, and jump over an enemy. Health and invulnerability
// are never used to accept a route.
//
// Renderer facts this model follows (GameSpecScene + Phaser 3.90 Arcade):
// - a physics step moves the enemy, then update() compares the position the
//   scene still sees (the game object syncs in postUpdate), so at 60 frames per
//   second a turn is decided one step late;
// - at other frame rates, or when a frame runs 0 or 2 physics steps, and when
//   range/(speed/60) lands on the range limit within float error, a turn can be
//   decided one step earlier or later. Each turn therefore adds +/-2 ticks of
//   phase uncertainty, which the hazard check carries forward (conservative);
// - for the same reasons the relative phase of two enemies is not reproducible.
//   A move is timed against one lead enemy at a time; a move that enters any
//   other enemy's envelope is not used in that search (conservative).
import type { GameSpec } from '@game-creator/contracts';
import type { Navigation, PhysicalGraph, ReachablePoint } from './game-geometry.js';
import { PLAYFIELD_TOP, TICKS_PER_SECOND, WORLD_WIDTH, type Point, type Rect } from './platformer-physics.js';

/** Enemy phases examined per source and lead enemy (10 s). */
export const HAZARD_HORIZON = 600;
/** Total (node, tick, coins) states for one analysis. */
export const HAZARD_STATE_BUDGET = 200_000;
/** Longest stay away from safe points for one macro edge (5 s). */
export const HAZARD_TRAVEL_CAP = 300;
/** Phase uncertainty added by every turn, in ticks. */
export const TURN_UNCERTAINTY = 2;
/** Human tolerance for timed moves: a move past an enemy is kept only if it
 * can start on at least this many consecutive ticks (0.2 s). A window of one
 * or two frames is correct physics but not something a player can hit. */
export const HAZARD_MIN_WINDOW_TICKS = 12;
/** Coins tracked per danger region; others are not credited there (conservative). */
const REGION_COIN_BITS = 5;
const WORLD_BOTTOM = 540; // platformer world bounds: (0,70)-(960,540)
const EPS = 0.00001;

export interface EnemyTrack {
  enemy: number;
  /** False when the body can touch a block or a world bound (which also turns
   * it in the renderer) or the motion is not periodic. Such an enemy blocks its
   * whole envelope at all times. */
  predictable: boolean;
  period: number;
  axis: 'horizontal' | 'vertical';
  /** Center on the other axis. */
  fixed: number;
  /** Center on the patrol axis for hazard tick 0..period-1. */
  positions: number[];
  /** Phases on which a turn is decided. */
  turnPhases: number[];
  /** Body half extents, inflated by one tick of motion + 1px. */
  halfWidth: number;
  halfHeight: number;
  /** Every point the inflated body can cover, turn uncertainty included. */
  envelope: Rect;
}

export interface MacroEdge {
  from: number;
  to: number;
  /** Upper bound in ticks: travel plus the longest wait for a usable phase. */
  ticks: number;
  coins: number[];
  /** Clean edges keep the index of their physical edge. */
  physical?: number;
  timed: boolean;
}

export interface HazardAnalysis {
  tracks: EnemyTrack[];
  /** Per physical node: no enemy can ever overlap a body standing there. */
  safe: boolean[];
  /** Spawn node and the spawn fall are clear of every envelope. */
  spawnSafe: boolean;
  /** Coins touched while standing at a node. */
  nodeCoins: number[][];
  coinPositions: Point[];
  edges: MacroEdge[];
  blocked: Array<{ node: number; reason: 'hazard_budget_exceeded' }>;
  stats: { states: number; edgeChecks: number; timedSearches: number; maxHorizon: number; macroEdges: number; safeNodes: number };
}

/** Same pickup rule as collectibleCost: the coin's 20x20 body entered by 2px. */
function touches(half: number, p: Point, coin: Point): boolean {
  const reach = half + 10;
  return Math.abs(p.x - coin.x) < reach - 2 && Math.abs(p.y - coin.y) < reach - 2;
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 - EPS && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - EPS;
}

/** One enemy exactly as GameSpecScene moves it at 60 frames per second. */
function simulateEnemy(game: GameSpec, index: number, ticks: number) {
  const spec = game.enemies[index]!;
  const center = spec.axis === 'horizontal' ? spec.x : spec.y;
  const step = spec.speed * game.difficulty.enemySpeedMultiplier / TICKS_PER_SECOND;
  let position = center, velocity = 0, direction = 1, seen = center;
  const positions: number[] = [];
  const turns: number[] = [];
  const bottoms: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    position += velocity;
    positions.push(position);
    if (seen >= center + spec.range) direction = -1;
    if (seen <= center - spec.range) direction = 1;
    const next = spec.range ? direction * step : 0;
    if (velocity !== 0 && Math.sign(next) !== Math.sign(velocity)) {
      turns.push(tick);
      if (next > 0) bottoms.push(tick);
    }
    velocity = next;
    seen = position;
  }
  return { positions, turns, bottoms };
}

/** Phase tables on one hazard clock: hazard tick t is game step start + t. */
export function enemyTracks(game: GameSpec): EnemyTrack[] {
  const probes = game.enemies.map((spec, index) => {
    if (spec.range === 0) return { period: 1, transient: 0, periodic: true, low: spec.axis === 'horizontal' ? spec.x : spec.y, high: spec.axis === 'horizontal' ? spec.x : spec.y };
    const step = spec.speed * game.difficulty.enemySpeedMultiplier / TICKS_PER_SECOND;
    const estimate = 4 * Math.ceil(spec.range / step) + 8;
    const run = simulateEnemy(game, index, 5 * estimate + 8);
    const low = Math.min(...run.positions), high = Math.max(...run.positions);
    const b = run.bottoms;
    const period = b.length >= 3 ? b[b.length - 1]! - b[b.length - 2]! : 0;
    const last = run.positions.length - 1;
    const periodic = period > 0 && b[b.length - 2]! - b[b.length - 3]! === period
      && run.positions.slice(last - period + 1).every((x, k) => Math.abs(x - run.positions[last - 2 * period + 1 + k]!) < 1e-6);
    return { period: periodic ? period : 1, transient: periodic ? b[0]! : 0, periodic, low, high };
  });
  const start = Math.max(0, ...probes.map((probe) => probe.transient));
  const blocks = [...game.platforms, ...game.obstacles, { x: 480, y: 520, width: 960, height: 40 }];
  return game.enemies.map((spec, index) => {
    const probe = probes[index]!;
    const horizontal = spec.axis === 'horizontal';
    const run = simulateEnemy(game, index, start + probe.period);
    const positions = run.positions.slice(start, start + probe.period);
    const turnPhases = run.turns.filter((tick) => tick >= start).map((tick) => tick - start);
    const step = spec.speed * game.difficulty.enemySpeedMultiplier / TICKS_PER_SECOND;
    const halfWidth = spec.size / 2 + (horizontal ? step + 1 : 1);
    const halfHeight = spec.size / 2 + (horizontal ? 1 : step + 1);
    // A turn decided one step later reaches one more step out.
    const reach = spec.range ? TURN_UNCERTAINTY * step : 0;
    const low = Math.min(probe.low, ...positions) - reach, high = Math.max(probe.high, ...positions) + reach;
    const envelope = horizontal
      ? { x: (low + high) / 2, y: spec.y, width: high - low + 2 * halfWidth, height: 2 * halfHeight }
      : { x: spec.x, y: (low + high) / 2, width: 2 * halfWidth, height: high - low + 2 * halfHeight };
    const extreme = horizontal
      ? { x: (low + high) / 2, y: spec.y, width: high - low + spec.size, height: spec.size }
      : { x: spec.x, y: (low + high) / 2, width: spec.size, height: high - low + spec.size };
    const inWorld = extreme.x - extreme.width / 2 >= 0 && extreme.x + extreme.width / 2 <= WORLD_WIDTH
      && extreme.y - extreme.height / 2 >= PLAYFIELD_TOP && extreme.y + extreme.height / 2 <= WORLD_BOTTOM;
    return {
      enemy: index, predictable: probe.periodic && inWorld && !blocks.some((block) => overlaps(extreme, block)),
      period: probe.period, axis: spec.axis, fixed: horizontal ? spec.y : spec.x,
      positions, turnPhases, halfWidth, halfHeight, envelope,
    };
  });
}

/** Envelope of one enemy as the hazard analysis sees it (turn overshoot of up
 * to two steps plus uncertainty). Used for platformer enemy placement checks. */
export function enemyEnvelope(game: GameSpec, enemy: GameSpec['enemies'][number]): Rect {
  return enemyTracks({ ...game, enemies: [enemy] })[0]!.envelope;
}

function inEnvelope(track: EnemyTrack, half: number, p: Point): boolean {
  return Math.abs(p.x - track.envelope.x) < half + track.envelope.width / 2 - EPS
    && Math.abs(p.y - track.envelope.y) < half + track.envelope.height / 2 - EPS;
}

/** Lead enemy for one timed search: banded positions on the hazard clock. */
interface Lead {
  track: EnemyTrack;
  /** Ticks of phase uncertainty applied to every check of this search. */
  band: number;
  low: Float64Array;
  high: Float64Array;
}

/** Most turns decided inside any window of `length` ticks. */
function turnsWithin(track: EnemyTrack, length: number): number {
  if (track.turnPhases.length === 0) return 0;
  const phases = track.turnPhases.map((phase) => phase % track.period).sort((a, b) => a - b);
  let most = 0;
  for (let start = 0; start < track.period; start += 1) {
    let count = 0;
    for (let lap = 0; lap * track.period < length + track.period; lap += 1) {
      for (const phase of phases) {
        const tick = phase + lap * track.period;
        if (tick > start && tick <= start + length) count += 1;
      }
    }
    most = Math.max(most, count);
  }
  return most;
}

function leadOf(track: EnemyTrack, travelCap: number): Lead {
  // Every turn inside one move can shift the phase by TURN_UNCERTAINTY ticks.
  const band = TURN_UNCERTAINTY * turnsWithin(track, travelCap);
  const period = track.period;
  const low = new Float64Array(period), high = new Float64Array(period);
  const whole = 2 * band + 1 >= period;
  const overallLow = Math.min(...track.positions), overallHigh = Math.max(...track.positions);
  for (let phase = 0; phase < period; phase += 1) {
    if (whole) { low[phase] = overallLow; high[phase] = overallHigh; continue; }
    let lo = Infinity, hi = -Infinity;
    for (let shift = -band; shift <= band; shift += 1) {
      const value = track.positions[(((phase + shift) % period) + period) % period]!;
      lo = Math.min(lo, value); hi = Math.max(hi, value);
    }
    low[phase] = lo; high[phase] = hi;
  }
  return { track, band, low, high };
}

function leadHits(lead: Lead, half: number, p: Point, tick: number): boolean {
  const { track } = lead;
  const phase = tick % track.period;
  const horizontal = track.axis === 'horizontal';
  const along = horizontal ? p.x : p.y;
  const across = horizontal ? p.y : p.x;
  const halfAlong = horizontal ? track.halfWidth : track.halfHeight;
  const halfAcross = horizontal ? track.halfHeight : track.halfWidth;
  return Math.abs(across - track.fixed) < half + halfAcross - EPS
    && along + half > lead.low[phase]! - halfAlong + EPS && along - half < lead.high[phase]! + halfAlong - EPS;
}

/** Largest wait until the next usable start phase, on a cycle of `period`
 * ticks. Phases never tried (beyond the horizon) count as unusable. */
function maxCyclicGap(origins: number[], period: number): number {
  const sorted = [...origins].sort((a, b) => a - b);
  let gap = sorted[0]! + period - sorted[sorted.length - 1]!;
  for (let i = 1; i < sorted.length; i += 1) gap = Math.max(gap, sorted[i]! - sorted[i - 1]!);
  return gap;
}

/** Start phases inside runs of at least `minimum` consecutive ticks. Runs wrap
 * around the cycle only when every phase of it was tried. */
export function windowedOrigins(origins: Iterable<number>, horizon: number, period: number, minimum: number): number[] {
  const sorted = [...new Set(origins)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const origin of sorted) {
    const run = runs[runs.length - 1];
    if (run && origin === run[run.length - 1]! + 1) run.push(origin);
    else runs.push([origin]);
  }
  if (runs.length > 1 && horizon >= period && runs[0]![0] === 0 && runs[runs.length - 1]![runs[runs.length - 1]!.length - 1] === period - 1) {
    runs[0] = [...runs.pop()!, ...runs[0]!];
  }
  return runs.filter((run) => run.length >= minimum).flat().sort((a, b) => a - b);
}

/** Longest stay away from safe points for one move against this enemy: enough
 * to cross its envelope 1.5 times at walking speed, plus one second. */
function travelCapFor(track: EnemyTrack, speed: number): number {
  const span = Math.max(track.envelope.width, track.envelope.height);
  return Math.min(HAZARD_TRAVEL_CAP, Math.max(TICKS_PER_SECOND, Math.ceil(1.5 * span / (speed / TICKS_PER_SECOND)) + TICKS_PER_SECOND));
}

export interface HazardOptions {
  /** Defaults to HAZARD_MIN_WINDOW_TICKS. Tests use 1 to see physics alone. */
  minWindowTicks?: number;
}

export function analyzeHazards(game: GameSpec, graph: PhysicalGraph, options: HazardOptions = {}): HazardAnalysis {
  const minWindowTicks = options.minWindowTicks ?? HAZARD_MIN_WINDOW_TICKS;
  const half = game.player.size / 2;
  const tracks = enemyTracks(game);
  const { nodes, edges, out } = graph;
  const exposed = (p: Point) => tracks.some((track) => inEnvelope(track, half, p));
  const safe = nodes.map((node) => !exposed(node));
  const spawnSafe = safe[graph.spawnNode]! && !graph.spawnPath.some(exposed);
  const coins = game.collectibles;
  const nodeCoins = nodes.map((node) => coins.flatMap((coin, index) => (touches(half, node, coin) ? [index] : [])));
  const edgeCoins = edges.map((edge) => coins.flatMap((coin, index) => (edge.points.some((p) => touches(half, p, coin)) ? [index] : [])));
  // Enemies whose envelope an edge enters at some tick.
  const touched = edges.map((edge) => tracks.flatMap((track) => (edge.points.some((p) => inEnvelope(track, half, p)) ? [track.enemy] : [])));
  const clean = edges.map((edge, index) => safe[edge.from]! && safe[edge.to]! && touched[index]!.length === 0);
  const macro: MacroEdge[] = [];
  edges.forEach((edge, index) => {
    if (clean[index]) macro.push({ from: edge.from, to: edge.to, ticks: edge.ticks, coins: edgeCoins[index]!, physical: index, timed: false });
  });
  // Coins with a pickup at a safe point or on a clean move need no tracking in danger.
  const cleanCoin = new Set<number>([
    ...nodeCoins.flatMap((list, node) => (safe[node] ? list : [])),
    ...edgeCoins.flatMap((list, index) => (clean[index] ? list : [])),
  ]);

  let states = 0;
  let edgeChecks = 0;
  let timedSearches = 0;
  let maxHorizon = 0;
  const blockedNodes = new Set<number>();
  const best = new Map<string, MacroEdge>();
  // One multi-source search per lead enemy. A move that enters another
  // enemy's envelope is not used in that search.
  for (const track of tracks) {
    if (!track.predictable) continue;
    const allowed = (index: number) => touched[index]!.every((enemy) => enemy === track.enemy);
    const exitsOf = (node: number) => out[node]!.filter((index) => !clean[index] && allowed(index));
    const sources = nodes.flatMap((_, node) => (safe[node] && exitsOf(node).length > 0 ? [node] : []));
    if (sources.length === 0) continue;
    timedSearches += 1;
    const cap = travelCapFor(track, game.player.speed);
    const lead = leadOf(track, cap);
    const horizon = Math.min(HAZARD_HORIZON, track.period);
    maxHorizon = Math.max(maxHorizon, horizon);
    const end = horizon + cap;
    const verdict = new Int8Array(edges.length * track.period);
    // Only ticks inside the lead's envelope can overlap it.
    const span = edges.map((edge) => {
      let first = -1, last = -1;
      for (let k = 1; k <= edge.ticks; k += 1) if (inEnvelope(track, half, edge.points[k]!)) { if (first < 0) first = k; last = k; }
      return [first, last] as const;
    });
    const edgeSafe = (index: number, tick: number): boolean => {
      if (touched[index]!.length === 0) return true;
      const slot = index * track.period + (tick % track.period);
      const known = verdict[slot]!;
      if (known !== 0) return known === 1;
      edgeChecks += 1;
      const edge = edges[index]!;
      let ok = true;
      const [first, last] = span[index]!;
      if (first > 0) for (let k = first; k <= last; k += 1) if (leadHits(lead, half, edge.points[k]!, tick + k)) { ok = false; break; }
      verdict[slot] = ok ? 1 : 2;
      return ok;
    };
    // Coins only collectible in this danger region get a mask bit.
    const regionCoins = [...new Set(edges.flatMap((_, index) => (allowed(index) && !clean[index] ? edgeCoins[index]! : [])))]
      .filter((coin) => !cleanCoin.has(coin)).sort((a, b) => a - b).slice(0, REGION_COIN_BITS);
    const bitOf = new Map(regionCoins.map((coin, bit) => [coin, 1 << bit]));
    const maskOf = edges.map((_, index) => edgeCoins[index]!.reduce((mask, coin) => mask | (bitOf.get(coin) ?? 0), 0));
    const masks = 1 << regionCoins.length;
    // A state carries, per source, the latest origin that reaches it, as a
    // flat [source, origin, source, origin, ...] list.
    const stateIndex = new Map<number, number>();
    const stateNode: number[] = [], stateMask: number[] = [];
    const stateOrigins: number[][] = [];
    const buckets: number[][] = Array.from({ length: end + 1 }, () => []);
    // Per start phase, the longest travel recorded from it.
    const records = new Map<number, { source: number; to: number; mask: number; origins: Map<number, number> }>();
    let overBudget = false;
    const record = (source: number, to: number, mask: number, origin: number, arrival: number) => {
      const id = (source * nodes.length + to) * masks + mask;
      let entry = records.get(id);
      if (!entry) { entry = { source, to, mask, origins: new Map<number, number>() }; records.set(id, entry); }
      entry.origins.set(origin, Math.max(entry.origins.get(origin) ?? 0, arrival - origin));
    };
    const exitLists = nodes.map((_, node) => (safe[node] ? exitsOf(node) : []));
    const allowedEdge = edges.map((_, index) => allowed(index));
    const advance = (index: number, tick: number, mask: number, origins: number[]) => {
      if (!edgeSafe(index, tick)) return;
      const edge = edges[index]!;
      const arrival = tick + edge.ticks;
      const next = mask | maskOf[index]!;
      if (safe[edge.to]) {
        for (let i = 0; i < origins.length; i += 2) if (arrival - origins[i + 1]! <= cap) record(origins[i]!, edge.to, next, origins[i + 1]!, arrival);
        return;
      }
      if (arrival > end) return;
      const id = (edge.to * (end + 1) + arrival) * masks + next;
      let state = stateIndex.get(id);
      if (state === undefined) {
        if (++states > HAZARD_STATE_BUDGET) { overBudget = true; return; }
        state = stateNode.length;
        stateIndex.set(id, state);
        buckets[arrival]!.push(state);
        stateNode.push(edge.to); stateMask.push(next); stateOrigins.push([]);
      }
      const target = stateOrigins[state]!;
      for (let i = 0; i < origins.length; i += 2) {
        const source = origins[i]!, origin = origins[i + 1]!;
        if (arrival - origin > cap) continue;
        // The latest origin has the shortest travel behind it.
        let j = 0;
        while (j < target.length && target[j] !== source) j += 2;
        if (j === target.length) target.push(source, origin);
        else if (target[j + 1]! < origin) target[j + 1] = origin;
      }
    };
    const start = [0, 0];
    for (let t0 = 0; t0 < horizon && !overBudget; t0 += 1) {
      for (const source of sources) {
        start[0] = source; start[1] = t0;
        for (const index of exitLists[source]!) { advance(index, t0, 0, start); if (overBudget) break; }
        if (overBudget) break;
      }
    }
    for (let tick = 0; tick <= end && !overBudget; tick += 1) {
      for (const state of buckets[tick]!) {
        const origins = stateOrigins[state]!;
        if (origins.length === 0) continue;
        for (const index of out[stateNode[state]!]!) {
          if (!allowedEdge[index]) continue;
          advance(index, tick, stateMask[state]!, origins);
          if (overBudget) break;
        }
        if (overBudget) break;
      }
    }
    if (overBudget) {
      // Fail closed for every source of this lead: no timed edge is trusted.
      for (const source of sources) blockedNodes.add(source);
      continue;
    }
    for (const entry of [...records.values()].sort((a, b) => a.source - b.source || a.to - b.to || a.mask - b.mask)) {
      // Only start windows a player can hit count. Waiting at the source is
      // safe forever; the next usable phase comes within the largest gap
      // between those phases, measured on the whole period.
      const usable = windowedOrigins(entry.origins.keys(), horizon, track.period, minWindowTicks);
      if (usable.length === 0) continue;
      const wait = maxCyclicGap(usable, track.period);
      const travel = Math.max(...usable.map((origin) => entry.origins.get(origin)!));
      const edge: MacroEdge = {
        from: entry.source, to: entry.to, ticks: wait + travel, timed: true,
        coins: regionCoins.filter((_, bit) => (entry.mask & (1 << bit)) !== 0),
      };
      const id = `${edge.from}:${edge.to}:${edge.coins.join(',')}`;
      const prior = best.get(id);
      if (!prior || edge.ticks < prior.ticks) best.set(id, edge);
    }
  }
  macro.push(...[...best.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.coins.join(',').localeCompare(b.coins.join(','))));
  return {
    tracks, safe, spawnSafe, nodeCoins, coinPositions: coins.map(({ x, y }) => ({ x, y })), edges: macro,
    blocked: [...blockedNodes].sort((a, b) => a - b).map((node) => ({ node, reason: 'hazard_budget_exceeded' as const })),
    stats: { states, edgeChecks, timedSearches, maxHorizon, macroEdges: macro.length, safeNodes: safe.filter(Boolean).length },
  };
}

/** Shortest zero-damage times (ticks) from spawn over macro edges. */
export function safeTicks(graph: PhysicalGraph, analysis: HazardAnalysis): number[] {
  const costs = graph.nodes.map(() => Infinity);
  if (!analysis.spawnSafe) return costs;
  const links = graph.nodes.map(() => [] as MacroEdge[]);
  for (const edge of analysis.edges) links[edge.from]!.push(edge);
  const done = graph.nodes.map(() => false);
  costs[graph.spawnNode] = 0;
  for (;;) {
    let next = -1;
    for (let i = 0; i < costs.length; i += 1) if (!done[i] && Number.isFinite(costs[i]) && (next < 0 || costs[i]! < costs[next]!)) next = i;
    if (next < 0) break;
    done[next] = true;
    for (const edge of links[next]!) costs[edge.to] = Math.min(costs[edge.to]!, costs[next]! + edge.ticks);
  }
  return costs;
}

/** Points the body reaches without damage: safe standing points, every tick of
 * a clean move between them, and the coins a timed move collects. Seconds are
 * one-way upper bounds from spawn. */
export function zeroDamageNavigation(graph: PhysicalGraph, analysis: HazardAnalysis): Navigation | undefined {
  if (!analysis.spawnSafe) return undefined;
  const reached = safeTicks(graph, analysis);
  const cloud = new Map<string, ReachablePoint>();
  const save = (p: Point, ticks: number) => {
    if (!Number.isFinite(ticks)) return;
    const id = `${Math.round(p.x)},${Math.round(p.y)}`;
    const prior = cloud.get(id);
    const seconds = ticks / TICKS_PER_SECOND;
    if (!prior || seconds < prior.seconds) cloud.set(id, { ...p, seconds });
  };
  graph.nodes.forEach((node, index) => { if (analysis.safe[index]) save(node, reached[index]!); });
  for (const edge of analysis.edges) {
    const start = reached[edge.from]!;
    if (!Number.isFinite(start)) continue;
    if (edge.physical !== undefined) graph.edges[edge.physical]!.points.forEach((p, k) => save(p, start + k));
    else for (const coin of edge.coins) save(analysis.coinPositions[coin]!, start + edge.ticks);
  }
  return { points: [...cloud.values()], spawnPath: graph.spawnPath, startupSeconds: graph.startupTicks / TICKS_PER_SECOND };
}
