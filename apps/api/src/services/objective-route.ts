// FROZEN (legacy-standard-v1): Standard platformer/top-down; no new development. See docs/DIRECTION.md.
// Objective routes over the zero-damage macro graph of a platformer. Pure
// functions on plain data: the caller passes the macro edges, never a game scene.
//
// collect_all needs one order that picks every coin from spawn, without
// returning afterwards. Coins are assigned to the strongly connected component
// (SCC) where they are picked; the SCCs holding coins must lie on one path of
// the condensation DAG. A coin on an edge between components gets its own
// pseudo-vertex, so a one-way drop that picks a coin is a step of that path.
import type { GameSpec } from '@game-creator/contracts';
import type { MacroEdge } from './enemy-hazard.js';

/** Masks kept per SCC; dropping masks only loses routes (conservative). */
const MASKS_PER_COMPONENT = 64;
/** Seconds added per coin, as before. */
const PICKUP_SECONDS = 0.5;

export interface RouteInput {
  /** Physical node count; macro edges index into it. */
  nodeCount: number;
  spawn: number;
  /** False when the spawn itself is exposed: no zero-damage route exists. */
  spawnSafe: boolean;
  edges: MacroEdge[];
  /** Coins picked while standing at a node (safe nodes only). */
  nodeCoins: number[][];
  coinValues: number[];
  win: GameSpec['win'];
  timeLimitSeconds: number;
  startupSeconds: number;
  ticksPerSecond: number;
}

export interface RouteFailure { path: string; message: string }

export interface RouteResult {
  ok: boolean;
  failure?: RouteFailure;
  /** Coin can be picked on some zero-damage route from spawn. */
  reachable: boolean[];
  /** Upper bound of the checked route, when a deadline applies. */
  upperBoundSeconds?: number;
  stats: { vertices: number; components: number; masks: number };
}

interface Arc { to: number; ticks: number }

interface Built { vertices: number; arcs: Arc[][]; coins: number[][] }

function build(input: RouteInput): Built {
  const arcs: Arc[][] = Array.from({ length: input.nodeCount }, () => []);
  const coins: number[][] = input.nodeCoins.map((list) => [...list]);
  for (const edge of input.edges) {
    if (edge.coins.length === 0) { arcs[edge.from]!.push({ to: edge.to, ticks: edge.ticks }); continue; }
    // Pseudo-vertex for the pickup: the coin is taken on the way, between from and to.
    const pickup = arcs.length;
    arcs.push([{ to: edge.to, ticks: 0 }]);
    coins.push([...edge.coins]);
    arcs[edge.from]!.push({ to: pickup, ticks: edge.ticks });
  }
  return { vertices: arcs.length, arcs, coins };
}

function reachableFrom(built: Built, start: number): boolean[] {
  const seen = new Array<boolean>(built.vertices).fill(false);
  const stack = [start];
  seen[start] = true;
  while (stack.length > 0) {
    const v = stack.pop()!;
    for (const arc of built.arcs[v]!) if (!seen[arc.to]) { seen[arc.to] = true; stack.push(arc.to); }
  }
  return seen;
}

/** Iterative Tarjan. Components come out in reverse topological order. */
function components(built: Built, include: boolean[]): { of: number[]; count: number } {
  const n = built.vertices;
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const of = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let counter = 0, count = 0;
  for (let root = 0; root < n; root += 1) {
    if (!include[root] || index[root] !== -1) continue;
    const work: Array<{ v: number; next: number }> = [{ v: root, next: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root); onStack[root] = true;
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const arcs = built.arcs[frame.v]!;
      if (frame.next < arcs.length) {
        const w = arcs[frame.next++]!.to;
        if (!include[w]) continue;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w); onStack[w] = true;
          work.push({ v: w, next: 0 });
        } else if (onStack[w]) low[frame.v] = Math.min(low[frame.v]!, index[w]!);
        continue;
      }
      work.pop();
      if (work.length > 0) { const parent = work[work.length - 1]!.v; low[parent] = Math.min(low[parent]!, low[frame.v]!); }
      if (low[frame.v] === index[frame.v]) {
        for (;;) {
          const w = stack.pop()!;
          onStack[w] = false;
          of[w] = count;
          if (w === frame.v) break;
        }
        count += 1;
      }
    }
  }
  return { of, count };
}

const popcount = (mask: number) => { let c = 0; for (let m = mask; m; m &= m - 1) c += 1; return c; };

interface Entry { mask: number; value: number; prevComponent: number; prevEntry: number }

/** Shortest ticks from `from` to every vertex, moving only inside `allowed`. */
function shortest(built: Built, from: number, allowed: (v: number) => boolean): number[] {
  const dist = new Array<number>(built.vertices).fill(Infinity);
  const done = new Array<boolean>(built.vertices).fill(false);
  dist[from] = 0;
  // Small graphs (hundreds of vertices): a linear scan keeps this deterministic and simple.
  for (;;) {
    let v = -1;
    for (let i = 0; i < built.vertices; i += 1) if (!done[i] && Number.isFinite(dist[i]) && (v < 0 || dist[i]! < dist[v]!)) v = i;
    if (v < 0) break;
    done[v] = true;
    for (const arc of built.arcs[v]!) if (allowed(arc.to) && dist[v]! + arc.ticks < dist[arc.to]!) dist[arc.to] = dist[v]! + arc.ticks;
  }
  return dist;
}

export function checkObjectiveRoute(input: RouteInput): RouteResult {
  const coinCount = input.coinValues.length;
  const none = new Array<boolean>(coinCount).fill(false);
  const empty = { vertices: 0, components: 0, masks: 0 };
  if (!input.spawnSafe) {
    return { ok: false, reachable: none, failure: { path: 'enemies', message: 'Kẻ địch chặn đường an toàn từ điểm xuất phát.' }, stats: empty };
  }
  const built = build(input);
  const seen = reachableFrom(built, input.spawn);
  const reachable = [...none];
  built.coins.forEach((list, v) => { if (seen[v]) for (const coin of list) reachable[coin] = true; });
  const { of, count } = components(built, seen);
  const stats = { vertices: built.vertices, components: count, masks: 0 };
  // Every coin must be reachable on its own, for every objective (invariant kept).
  const missing = reachable.findIndex((ok) => !ok);
  if (missing >= 0) {
    return {
      ok: false, reachable, stats,
      failure: { path: `collectibles.${missing}`, message: `Xu ${missing + 1} không thể tiếp cận an toàn: không có đường đi nào từ điểm xuất phát tới xu này mà không chạm kẻ địch.` },
    };
  }
  if (input.win.type === 'survive') return { ok: true, reachable, stats };

  // Coin masks per component, then the condensation DAG in topological order.
  const componentCoins = new Array<number>(count).fill(0);
  built.coins.forEach((list, v) => {
    const component = of[v]!;
    if (component >= 0) for (const coin of list) componentCoins[component] = (componentCoins[component]! | (1 << coin)) >>> 0;
  });
  const successors: Array<Set<number>> = Array.from({ length: count }, () => new Set());
  built.arcs.forEach((arcs, v) => {
    if (of[v]! < 0) return;
    for (const arc of arcs) if (of[arc.to]! >= 0 && of[arc.to] !== of[v]) successors[of[v]!]!.add(of[arc.to]!);
  });
  const valueOf = (mask: number) => input.coinValues.reduce((sum, value, coin) => sum + ((mask >>> coin) & 1 ? value : 0), 0);
  const entries: Entry[][] = Array.from({ length: count }, () => []);
  const start = of[input.spawn]!;
  entries[start] = [{ mask: componentCoins[start]!, value: valueOf(componentCoins[start]!), prevComponent: -1, prevEntry: -1 }];
  // Tarjan numbers components in reverse topological order: process high to low.
  for (let component = count - 1; component >= 0; component -= 1) {
    const list = entries[component]!;
    if (list.length === 0) continue;
    for (const next of [...successors[component]!].sort((a, b) => b - a)) {
      const target = entries[next]!;
      list.forEach((entry, position) => {
        const mask = (entry.mask | componentCoins[next]!) >>> 0;
        if (target.some((other) => (other.mask | mask) === other.mask)) return; // dominated
        for (let i = target.length - 1; i >= 0; i -= 1) if ((target[i]!.mask | mask) === mask) target.splice(i, 1);
        target.push({ mask, value: valueOf(mask), prevComponent: component, prevEntry: position });
      });
      if (target.length > MASKS_PER_COMPONENT) {
        target.sort((a, b) => popcount(b.mask) - popcount(a.mask) || b.value - a.value || a.mask - b.mask);
        target.length = MASKS_PER_COMPONENT;
      }
    }
  }
  stats.masks = entries.reduce((sum, list) => sum + list.length, 0);
  const all = coinCount >= 32 ? 0xffffffff : ((1 << coinCount) - 1) >>> 0;
  let chosen: { component: number; entry: number } | undefined;
  let bestPartial: Entry | undefined;
  entries.forEach((list, component) => list.forEach((entry, position) => {
    const enough = input.win.type === 'collect_all' ? entry.mask === all : entry.value >= input.win.scoreTarget;
    if (enough && !chosen) chosen = { component, entry: position };
    if (!bestPartial || popcount(entry.mask) > popcount(bestPartial.mask)
      || (popcount(entry.mask) === popcount(bestPartial.mask) && entry.value > bestPartial.value)) bestPartial = entry;
  }));
  if (!chosen) {
    if (input.win.type === 'reach_score') {
      return { ok: false, reachable, stats, failure: { path: 'win.scoreTarget', message: 'Không có tuyến nào gom đủ điểm mục tiêu mà không bị kẹt hoặc chạm kẻ địch.' } };
    }
    const lost = Array.from({ length: coinCount }, (_, coin) => coin).find((coin) => !(((bestPartial?.mask ?? 0) >>> coin) & 1)) ?? 0;
    return {
      ok: false, reachable, stats,
      failure: { path: `collectibles.${lost}`, message: `Xu ${lost + 1} không thể nằm trong một thứ tự nhặt hết xu: sau khi đi lấy các xu khác thì không còn đường tới xu này (bẫy một chiều).` },
    };
  }
  if (input.timeLimitSeconds <= 0) return { ok: true, reachable, stats };

  // Upper bound of one concrete route. Path of components from spawn.
  const path: number[] = [];
  const masks: number[] = [];
  for (let at: { component: number; entry: number } | undefined = chosen; at && at.component >= 0;) {
    const entry: Entry = entries[at.component]![at.entry]!;
    path.unshift(at.component); masks.unshift(entry.mask);
    at = entry.prevComponent >= 0 ? { component: entry.prevComponent, entry: entry.prevEntry } : undefined;
  }
  const target = masks[masks.length - 1]!;
  const assigned = path.map(() => 0);
  let taken = 0;
  path.forEach((component, step) => { assigned[step] = (componentCoins[component]! & target & ~taken) >>> 0; taken |= assigned[step]!; });
  let current = input.spawn;
  let ticks = 0;
  let pickups = 0;
  let score = 0;
  const goalMet = () => (input.win.type === 'collect_all' ? pickups === coinCount : score >= input.win.scoreTarget);
  for (let step = 0; step < path.length && !goalMet(); step += 1) {
    const component = path[step]!;
    let remaining = assigned[step]!;
    // Greedy: nearest (by time) vertex inside the component that holds an uncollected coin.
    while (remaining !== 0 && !goalMet()) {
      const dist = shortest(built, current, (v) => of[v] === component);
      let bestVertex = -1;
      for (let v = 0; v < built.vertices; v += 1) {
        if (of[v] !== component || !Number.isFinite(dist[v])) continue;
        if (built.coins[v]!.some((coin) => (remaining >>> coin) & 1) && (bestVertex < 0 || dist[v]! < dist[bestVertex]!)) bestVertex = v;
      }
      if (bestVertex < 0) return { ok: false, reachable, stats, failure: { path: 'lose.timeLimitSeconds', message: 'Không xác nhận được đường đi hoàn thành mục tiêu trong thời hạn đã yêu cầu.' } };
      ticks += dist[bestVertex]!;
      current = bestVertex;
      for (const coin of built.coins[bestVertex]!) {
        if (!((remaining >>> coin) & 1)) continue;
        remaining = (remaining & ~(1 << coin)) >>> 0;
        pickups += 1;
        score += input.coinValues[coin]!;
        ticks += PICKUP_SECONDS * input.ticksPerSecond;
        if (goalMet()) break;
      }
    }
    if (goalMet() || step + 1 >= path.length) break;
    const nextComponent = path[step + 1]!;
    const dist = shortest(built, current, (v) => of[v] === component || of[v] === nextComponent);
    let entryVertex = -1;
    for (let v = 0; v < built.vertices; v += 1) if (of[v] === nextComponent && Number.isFinite(dist[v]) && (entryVertex < 0 || dist[v]! < dist[entryVertex]!)) entryVertex = v;
    if (entryVertex < 0) return { ok: false, reachable, stats, failure: { path: 'lose.timeLimitSeconds', message: 'Không xác nhận được đường đi hoàn thành mục tiêu trong thời hạn đã yêu cầu.' } };
    ticks += dist[entryVertex]!;
    current = entryVertex;
  }
  const seconds = input.startupSeconds + ticks / input.ticksPerSecond;
  if (!goalMet() || seconds > input.timeLimitSeconds) {
    return { ok: false, reachable, stats, upperBoundSeconds: seconds, failure: { path: 'lose.timeLimitSeconds', message: 'Không xác nhận được đường đi hoàn thành mục tiêu trong thời hạn đã yêu cầu.' } };
  }
  return { ok: true, reachable, stats, upperBoundSeconds: seconds };
}
