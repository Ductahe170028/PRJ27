import type { GameSpec } from '@game-creator/contracts';

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface ReachablePoint extends Point { seconds: number }
const STEP = 16;
const EPS = 0.00001;
const half = (game: GameSpec) => game.player.size / 2;
const edgesOf = (r: Rect, padding = 0) => ({
  left: r.x - r.width / 2 - padding, right: r.x + r.width / 2 + padding,
  top: r.y - r.height / 2 - padding, bottom: r.y + r.height / 2 + padding,
});

export function overlapsRect(a: Rect, b: Rect, gap = 0): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap - EPS
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap - EPS;
}

// Swept AABB, not just endpoint checks: narrow walls cannot be tunneled through.
function crosses(a: Point, b: Point, rect: Rect, padding: number): boolean {
  const bounds = edgesOf(rect, padding);
  let enter = 0, leave = 1;
  for (const [from, delta, low, high] of [
    [a.x, b.x - a.x, bounds.left + EPS, bounds.right - EPS],
    [a.y, b.y - a.y, bounds.top + EPS, bounds.bottom - EPS],
  ] as const) {
    if (Math.abs(delta) < EPS) { if (from < low || from > high) return false; }
    else {
      const t1 = (low - from) / delta, t2 = (high - from) / delta;
      enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2));
      if (enter > leave) return false;
    }
  }
  return enter <= leave;
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

/** Bounded, conservative planner for the trusted renderer's static geometry.
 * Enemy patrol envelopes can be treated as forbidden areas: accepted repair
 * routes need neither damage-taking nor guessing enemy timing.
 */
/** One Arcade jump or fall, using the same step as {@link buildNavigation}.
 * Returns the landing point when the body comes to rest on a surface.
 */
export function flightLanding(game: GameSpec, start: Point, targetX: number, jump: boolean): Point | undefined {
  const h = half(game);
  const surfaces: Rect[] = [...game.platforms, ...game.obstacles, { x: 480, y: 520, width: 960, height: 40 }];
  const valid = (p: Point) => p.x >= h && p.x <= 960 - h && p.y >= 70 + h && p.y <= 500 - h
    && !surfaces.some((block) => crosses(p, p, block, h));
  const clear = (a: Point, b: Point) => valid(b) && !surfaces.some((block) => crosses(a, b, block, h));
  const supported = (p: Point) => surfaces.some((r) => Math.abs(p.y + h - (r.y - r.height / 2)) < EPS
    && p.x - h >= r.x - r.width / 2 - EPS && p.x + h <= r.x + r.width / 2 + EPS);
  let p = start;
  let vy = jump ? -game.player.jumpSpeed : 0;
  for (let tick = 1; tick <= 150; tick += 1) {
    vy = Math.min(1000, vy + game.difficulty.gravity / 60);
    const next = {
      x: p.x + Math.sign(targetX - p.x) * Math.min(Math.abs(targetX - p.x), game.player.speed / 60),
      y: p.y + vy / 60,
    };
    let landing: number | undefined;
    if (vy >= 0) for (const r of surfaces) {
      const top = r.y - r.height / 2;
      const landY = top - h;
      if (Math.abs(p.y - landY) <= EPS) continue;
      if (p.y + h <= top + EPS && next.y + h >= top && next.x + h > r.x - r.width / 2 && next.x - h < r.x + r.width / 2) {
        landing = Math.min(landing ?? Infinity, landY);
      }
    }
    if (landing !== undefined) next.y = landing;
    if (!clear(p, next)) return undefined;
    if (landing !== undefined) return supported(next) ? next : undefined;
    p = next;
  }
  return undefined;
}

export function buildNavigation(game: GameSpec, avoidEnemies: boolean): Navigation | undefined {
  const h = half(game);
  const blocks: Rect[] = [...game.platforms, ...game.obstacles];
  const hazards = avoidEnemies ? game.enemies.map((enemy) => patrolRect(enemy, game.difficulty.enemySpeedMultiplier)) : [];
  const solid = [...blocks, ...hazards];
  const valid = (p: Point) => p.x >= h && p.x <= 960 - h && p.y >= 70 + h && p.y <= 500 - h
    && !solid.some((block) => crosses(p, p, block, h));
  const clear = (a: Point, b: Point) => valid(b) && !solid.some((block) => crosses(a, b, block, h));

  if (game.genre === 'top-down') {
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

  const floor: Rect = { x: 480, y: 520, width: 960, height: 40 };
  const surfaces = [...blocks, floor];
  const supported = (p: Point) => surfaces.some((r) => Math.abs(p.y + h - (r.y - r.height / 2)) < EPS
    && p.x - h >= r.x - r.width / 2 - EPS && p.x + h <= r.x + r.width / 2 + EPS);
  interface Flight { end: Point; points: Point[]; seconds: number }
  let simulatedSteps = 0;
  function fly(start: Point, targetX: number, jump: boolean): Flight | undefined {
    let p = start, vy = jump ? -game.player.jumpSpeed : 0;
    const points: Point[] = [p];
    // Match the default Arcade step, acceleration and the player's velocity cap.
    for (let tick = 1; tick <= 150; tick += 1) {
      if (++simulatedSteps > 350_000) return undefined;
      vy = Math.min(1000, vy + game.difficulty.gravity / 60);
      const next = { x: p.x + Math.sign(targetX - p.x) * Math.min(Math.abs(targetX - p.x), game.player.speed / 60), y: p.y + vy / 60 };
      let landing: number | undefined;
      if (vy >= 0) for (const r of surfaces) {
        const top = r.y - r.height / 2;
        const landY = top - h;
        // Stepping off the surface under the body is a fall, not a failed landing.
        if (Math.abs(p.y - landY) <= EPS) continue;
        if (p.y + h <= top + EPS && next.y + h >= top && next.x + h > r.x - r.width / 2 && next.x - h < r.x + r.width / 2) {
          landing = Math.min(landing ?? Infinity, landY);
        }
      }
      if (landing !== undefined) next.y = landing;
      if (!clear(p, next)) return undefined;
      points.push(next);
      if (landing !== undefined) return supported(next) ? { end: next, points, seconds: tick / 60 } : undefined;
      p = next;
    }
    return undefined;
  }
  const spawn = { x: game.player.x, y: game.player.y };
  if (!valid(spawn)) return undefined;
  const initial = supported(spawn) ? { end: spawn, points: [spawn], seconds: 0 } : fly(spawn, spawn.x, false);
  if (!initial) return undefined;
  const nodes: Point[] = [];
  const keys = new Set<string>();
  const add = (p: Point) => {
    const key = `${p.x},${p.y}`;
    if (!keys.has(key) && valid(p) && supported(p)) { keys.add(key); nodes.push(p); }
  };
  add(initial.end);
  for (const r of surfaces) {
    const y = r.y - r.height / 2 - h;
    const left = Math.max(h, r.x - r.width / 2 + h), right = Math.min(960 - h, r.x + r.width / 2 - h);
    for (let x = Math.ceil(left / STEP) * STEP; x <= right; x += STEP) add({ x, y });
    for (const x of [left, right, Math.min(right, Math.max(left, initial.end.x))]) add({ x, y });
  }
  // Reject layouts exceeding the work budget rather than making an optimistic
  // claim of reachability or blocking the API event loop on pathological input.
  if (nodes.length > 350) return undefined;
  interface Edge { from: number; to: number; seconds: number; points: Point[] }
  const edges: Edge[] = [];
  for (let from = 0; from < nodes.length; from += 1) for (let to = 0; to < nodes.length; to += 1) {
    if (simulatedSteps > 350_000) return undefined;
    const a = nodes[from]!, b = nodes[to]!;
    const dx = Math.abs(b.x - a.x);
    if (from !== to && a.y === b.y && dx <= STEP + 1 && clear(a, b)) {
      const mid = { x: (a.x + b.x) / 2, y: a.y };
      if (supported(mid)) { edges.push({ from, to, seconds: dx / game.player.speed, points: [a, mid, b] }); continue; }
    }
    const discriminant = game.player.jumpSpeed ** 2 + 2 * game.difficulty.gravity * (b.y - a.y);
    if (discriminant < 0 || a.y - b.y > game.player.jumpSpeed ** 2 / (2 * game.difficulty.gravity) - 8) continue;
    const duration = (game.player.jumpSpeed + Math.sqrt(discriminant)) / game.difficulty.gravity;
    if (dx > game.player.speed * duration) continue;
    const flight = fly(a, b.x, true);
    if (flight && Math.abs(flight.end.x - b.x) < EPS && Math.abs(flight.end.y - b.y) < EPS) edges.push({ from, to, seconds: flight.seconds, points: flight.points });
  }
  // Jumping up is not enough: the way down is a step off the lip, then a fall.
  // Starting the fall on the lip intersects that step's side, so the body first
  // slides to just outside the solid and only then drops.
  const byHeight = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const key = node.y.toFixed(3);
    byHeight.set(key, [...(byHeight.get(key) ?? []), index]);
  });
  const levels = [...byHeight.values()].sort((a, b) => nodes[a[0]!]!.y - nodes[b[0]!]!.y);
  for (const upper of levels) {
    const ordered = [...upper].sort((a, b) => nodes[a]!.x - nodes[b]!.x);
    const lips = [ordered[0]!, ordered[ordered.length - 1]!];
    for (const lower of levels) {
      if (nodes[lower[0]!]!.y <= nodes[upper[0]!]!.y + 4) continue;
      for (const lip of new Set(lips)) {
        if (simulatedSteps > 350_000) return undefined;
        const origin = nodes[lip]!;
        const direction = lip === ordered[0] ? -1 : 1;
        const outside = { x: origin.x + direction * (game.player.size + 0.5), y: origin.y };
        if (!valid(outside) || !clear(origin, outside)) continue;
        const nearest = lower.reduce((best, index) => Math.abs(nodes[index]!.x - outside.x) < Math.abs(nodes[best]!.x - outside.x) ? index : best);
        const flight = fly(outside, nodes[nearest]!.x, false);
        if (!flight || Math.abs(flight.end.y - nodes[nearest]!.y) > EPS) continue;
        const dest = lower.reduce((best, index) => Math.abs(nodes[index]!.x - flight.end.x) < Math.abs(nodes[best]!.x - flight.end.x) ? index : best);
        if (Math.abs(nodes[dest]!.x - flight.end.x) > STEP + 1) continue;
        const slide = Math.abs(outside.x - origin.x) / game.player.speed;
        const walk = Math.abs(nodes[dest]!.x - flight.end.x) / game.player.speed;
        edges.push({ from: lip, to: dest, seconds: slide + flight.seconds + walk, points: [origin, outside, ...flight.points, nodes[dest]!] });
      }
    }
  }
  const distances = (reverse: boolean) => {
    const costs = nodes.map(() => Infinity), visited = new Set<number>();
    const links = nodes.map(() => [] as Array<{ to: number; cost: number }>);
    for (const edge of edges) links[reverse ? edge.to : edge.from]!.push({ to: reverse ? edge.from : edge.to, cost: edge.seconds });
    costs[0] = 0;
    for (let step = 0; step < nodes.length; step += 1) {
      let next = -1;
      for (let i = 0; i < nodes.length; i += 1) if (!visited.has(i) && Number.isFinite(costs[i]) && (next < 0 || costs[i]! < costs[next]!)) next = i;
      if (next < 0) break;
      visited.add(next);
      for (const link of links[next]!) costs[link.to] = Math.min(costs[link.to]!, costs[next]! + link.cost);
    }
    return costs;
  };
  const outward = distances(false), inward = distances(true);
  const cloud = new Map<string, ReachablePoint>();
  const save = (p: Point, seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    const prior = cloud.get(key);
    if (!prior || seconds < prior.seconds) cloud.set(key, { ...p, seconds });
  };
  nodes.forEach((p, i) => save(p, outward[i]! + inward[i]!));
  for (const edge of edges) {
    const seconds = outward[edge.from]! + edge.seconds + inward[edge.to]!;
    if (Number.isFinite(seconds)) for (const p of edge.points) save(p, seconds);
  }
  return { points: [...cloud.values()], spawnPath: initial.points, startupSeconds: initial.seconds };
}

export function collectibleCost(game: GameSpec, coin: Point, navigation: Navigation): number {
  const reach = game.player.size / 2 + 10; // Actual staticImage body is 20x20.
  let best = Infinity;
  for (const p of navigation.points) if (Math.abs(p.x - coin.x) < reach - 2 && Math.abs(p.y - coin.y) < reach - 2) best = Math.min(best, p.seconds);
  return best;
}
