// FROZEN (legacy-standard-v1): Standard platformer/top-down; no new development. See docs/DIRECTION.md.
import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { withReason } from './failure-reason.js';
import {
  buildNavigation, buildPhysicalGraph, collectibleCost, createAnalysisCache, flightLanding, hazardAnalysis, overlapsRect,
  patrolRect, touchesCoin, withinWorld, type AnalysisCache, type Navigation, type PhysicalGraph, type Point, type Rect,
} from './game-geometry.js';
import { checkObjectiveRoute, type RouteResult } from './objective-route.js';
import { TICKS_PER_SECOND } from './platformer-physics.js';
import { enemyEnvelope } from './enemy-hazard.js';

const MAX_MOVE = 160;
/** Hazard analyses spent on sliding floor enemies in one repair. */
const SLIDE_CHECKS = 16;
const COIN_SIZE = 20;
// Documented rest in the system prompt: coin center is 25px above a surface top.
const COIN_REST = 25;
const FLOOR_TOP = 500;
const FLOOR: Rect = { x: 480, y: 520, width: 960, height: 40 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const itemPosition = (p: Point) => p.x >= 16 && p.x <= 944 && p.y >= 80 && p.y <= 484;
const coinBody = (p: Point) => ({ ...p, width: COIN_SIZE, height: COIN_SIZE });
const surfaceTop = (block: Rect) => block.y - block.height / 2;
const coinRestY = (block: Rect) => Math.round(surfaceTop(block) - COIN_REST);

function fail(path: string, reason: string): never {
  throw new AIError('invalid_game_spec', withReason(`${reason} Không thể sửa an toàn mà giữ nguyên số lượng vật thể và mục tiêu; game chưa được tạo.`, path), 422, undefined, [path]);
}

function candidates(origin: Point, navigation: Navigation): Point[] {
  const seen = new Set<string>();
  return navigation.points.map((p) => ({ x: Math.max(16, Math.min(944, Math.round(p.x))), y: Math.max(80, Math.min(484, Math.round(p.y))) }))
    .filter((p) => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key) || distance(p, origin) > MAX_MOVE) return false;
      seen.add(key); return true;
    }).sort((a, b) => distance(a, origin) - distance(b, origin) || a.x - b.x || a.y - b.y);
}

interface JumpLimits { height: number; schemaRise: number; range: number }

function jumpLimits(game: GameSpec): JumpLimits {
  // Same rise and range the schema uses, so a stair that navigation accepts still parses.
  const height = game.player.jumpSpeed ** 2 / (2 * game.difficulty.gravity);
  return {
    height,
    schemaRise: height - 12,
    range: game.player.speed * game.player.jumpSpeed / game.difficulty.gravity * 1.5,
  };
}

function yBounds(height: number): { min: number; max: number } {
  return {
    min: Math.max(80, Math.ceil(70 + height / 2)),
    max: Math.min(490, Math.floor(500 - height / 2)),
  };
}

function insidePlayfield(block: Rect): boolean {
  const bounds = yBounds(block.height);
  const minX = Math.max(10, Math.ceil(block.width / 2));
  const maxX = Math.min(950, Math.floor(960 - block.width / 2));
  return block.x >= minX && block.x <= maxX && block.y >= bounds.min && block.y <= bounds.max
    && surfaceTop(block) >= 70 && surfaceTop(block) + block.height <= FLOOR_TOP;
}

function xOverlap(a: Rect, b: Rect): number {
  return Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
}

function sameColumn(a: Rect, b: Rect): boolean {
  const overlap = xOverlap(a, b);
  const narrower = Math.min(a.width, b.width);
  // Shared vertical axis: each center sits over the other step, and the overlap
  // covers most of the narrower one. A side nick is a zigzag, not a column.
  return Math.abs(a.x - b.x) <= narrower / 2
    && overlap >= narrower / 2
    && Math.abs(surfaceTop(a) - surfaceTop(b)) > 4;
}

function stackedColumns(game: GameSpec): number[][] {
  // Chain only onto the next platform above. Overlap with a third step must not
  // pull an unrelated zigzag into the same column.
  const order = game.platforms.map((_, index) => index)
    .sort((a, b) => surfaceTop(game.platforms[b]!) - surfaceTop(game.platforms[a]!) || a - b);
  const used = new Set<number>();
  const groups: number[][] = [];
  for (const start of order) {
    if (used.has(start)) continue;
    const chain = [start];
    used.add(start);
    let head = start;
    for (;;) {
      const headTop = surfaceTop(game.platforms[head]!);
      const above = order.filter((index) => !used.has(index) && headTop - surfaceTop(game.platforms[index]!) > 4);
      const nearest = above[0];
      if (nearest === undefined || !sameColumn(game.platforms[head]!, game.platforms[nearest]!)) break;
      chain.push(nearest);
      used.add(nearest);
      head = nearest;
    }
    if (chain.length >= 2) groups.push(chain);
  }
  return groups.sort((a, b) => a[0]! - b[0]!);
}

function surfaceReached(game: GameSpec, platform: Rect, navigation: Navigation): boolean {
  const y = surfaceTop(platform) - COIN_REST;
  const inset = Math.min(platform.width / 2 - 1, game.player.size / 2);
  const samples = [platform.x, platform.x - platform.width / 2 + inset, platform.x + platform.width / 2 - inset];
  return samples.some((x) => Number.isFinite(collectibleCost(game, { x, y }, navigation)));
}

function ownerPlatform(game: GameSpec, coinIndex: number): number | undefined {
  const coin = game.collectibles[coinIndex]!;
  let best: { index: number; dy: number } | undefined;
  game.platforms.forEach((platform, index) => {
    if (Math.abs(coin.x - platform.x) > platform.width / 2) return;
    const dy = Math.abs(coin.y - coinRestY(platform));
    if (!best || dy < best.dy || (dy === best.dy && index < best.index)) best = { index, dy };
  });
  if (!best || Math.abs(coin.y - (FLOOR_TOP - COIN_REST)) <= best.dy) return undefined;
  return best.index;
}

function coinsOnPlatforms(game: GameSpec, indices: number[]): number[] {
  const wanted = new Set(indices);
  return game.collectibles.flatMap((_, index) => {
    const owner = ownerPlatform(game, index);
    return owner !== undefined && wanted.has(owner) ? [index] : [];
  });
}

interface ColumnPlan { ordered: number[]; yByIndex: Map<number, number>; maxRise: number }

function planColumn(game: GameSpec, indices: number[]): ColumnPlan | undefined {
  const limits = jumpLimits(game);
  const ordered = [...indices].sort((a, b) => surfaceTop(game.platforms[b]!) - surfaceTop(game.platforms[a]!) || a - b);
  const yByIndex = new Map<number, number>();
  let prevTop = FLOOR_TOP;
  let maxRise = 0;
  for (const index of ordered) {
    const platform = game.platforms[index]!;
    const rise = prevTop - surfaceTop(platform);
    if (rise > limits.height + 1e-6) return undefined;
    let y = platform.y;
    if (rise > limits.schemaRise) {
      y = Math.ceil(prevTop - limits.schemaRise + platform.height / 2 - 1e-9);
      while (prevTop - (y - platform.height / 2) > limits.schemaRise + 1e-6) y += 1;
    }
    const bounds = yBounds(platform.height);
    if (!Number.isInteger(y) || y < bounds.min || y > bounds.max) return undefined;
    const actualTop = y - platform.height / 2;
    const actualRise = prevTop - actualTop;
    if (actualTop < 70 || actualRise > limits.schemaRise + 1e-6) return undefined;
    yByIndex.set(index, y);
    maxRise = Math.max(maxRise, actualRise);
    prevTop = actualTop;
  }
  return { ordered, yByIndex, maxRise };
}

function columnGaps(game: GameSpec, maxRise: number): number[] {
  const v = game.player.jumpSpeed;
  const g = game.difficulty.gravity;
  const disc = v * v - 2 * g * Math.max(0, maxRise);
  const traveled = disc > 0 ? game.player.speed * (v - Math.sqrt(disc)) / g : 0;
  // Lip clearance is whatever jump travel has not already covered. 0 is a legal touching stair.
  const lip = Math.max(0, Math.ceil(game.player.size - traveled));
  return [...new Set([lip, 0, Math.ceil(game.player.size / 2)])].sort((a, b) => a - b);
}

function layoutColumn(game: GameSpec, plan: ColumnPlan, gap: number, shift: number): Map<number, number> | undefined {
  const span = plan.ordered.reduce((sum, index) => sum + game.platforms[index]!.width, 0) + gap * (plan.ordered.length - 1);
  if (span > 960 || gap < 0) return undefined;
  const anchor = plan.ordered.reduce((sum, index) => sum + game.platforms[index]!.x, 0) / plan.ordered.length;
  let left = Math.round(anchor - span / 2) + shift;
  left = Math.max(0, Math.min(960 - span, left));
  const xs = new Map<number, number>();
  let cursor = left;
  let prevRight = -Infinity;
  for (const index of plan.ordered) {
    const platform = game.platforms[index]!;
    const x = Math.round(cursor + platform.width / 2);
    const block = { ...platform, x, y: plan.yByIndex.get(index)! };
    if (!insidePlayfield(block) || block.x - block.width / 2 < prevRight - 1e-6) return undefined;
    xs.set(index, x);
    prevRight = block.x + block.width / 2;
    cursor += platform.width + gap;
  }
  return xs;
}

function columnClashes(game: GameSpec, indices: number[], xs: Map<number, number>, ys: Map<number, number>): boolean {
  const group = new Set(indices);
  const moving = indices.map((index) => ({ ...game.platforms[index]!, x: xs.get(index)!, y: ys.get(index)! }));
  const fixed: Rect[] = [
    ...game.platforms.filter((_, index) => !group.has(index)),
    ...game.obstacles,
    { x: game.player.x, y: game.player.y, width: game.player.size, height: game.player.size },
  ];
  return moving.some((block) => fixed.some((other) => overlapsRect(block, other)));
}

function schemaChain(game: GameSpec, indices: number[]): boolean {
  const limits = jumpLimits(game);
  const ordered = [...indices].sort((a, b) => surfaceTop(game.platforms[b]!) - surfaceTop(game.platforms[a]!) || a - b);
  let prev: Rect = FLOOR;
  for (const index of ordered) {
    const next = game.platforms[index]!;
    const rise = surfaceTop(prev) - surfaceTop(next);
    const gap = Math.max(0, Math.abs(prev.x - next.x) - (prev.width + next.width) / 2);
    if (rise < -1e-6 || rise > limits.schemaRise + 1e-6 || gap > limits.range + 1e-6) return false;
    prev = next;
  }
  return true;
}

function snapColumnCoins(game: GameSpec, indices: number[], coinIndexes: number[], originals: Rect[]): void {
  const byPlatform = new Map<number, number[]>();
  for (const coinIndex of coinIndexes) {
    const owner = ownerPlatform({ ...game, platforms: originals, collectibles: game.collectibles }, coinIndex);
    if (owner === undefined || !indices.includes(owner)) continue;
    byPlatform.set(owner, [...(byPlatform.get(owner) ?? []), coinIndex]);
  }
  for (const [platformIndex, owned] of byPlatform) {
    const next = game.platforms[platformIndex]!;
    const prev = originals[platformIndex]!;
    const ordered = [...owned].sort((a, b) => game.collectibles[a]!.x - game.collectibles[b]!.x || a - b);
    const rest = coinRestY(next);
    if (rest < 80 || rest > 484) continue;
    ordered.forEach((coinIndex, rank) => {
      const coin = game.collectibles[coinIndex]!;
      const span = next.width - COIN_SIZE;
      const x = ordered.length === 1
        ? Math.round(coin.x + next.x - prev.x)
        : Math.round(next.x - span / 2 + (span * rank) / (ordered.length - 1));
      coin.x = Math.max(16, Math.min(944, x));
      coin.y = rest;
    });
  }
}

function columnProven(game: GameSpec, indices: number[], coinIndexes: number[], cache: AnalysisCache): boolean {
  const nav = buildNavigation(game, false, cache);
  if (!nav || !schemaChain(game, indices)) return false;
  const onStep = (coin: Point) => indices.some((index) => {
    const platform = game.platforms[index]!;
    const top = surfaceTop(platform);
    return Math.abs(coin.x - platform.x) <= platform.width / 2 && coin.y <= top && top - coin.y <= COIN_REST + 1;
  });
  return indices.every((index) => surfaceReached(game, game.platforms[index]!, nav))
    && coinIndexes.every((index) => {
      const coin = game.collectibles[index]!;
      return itemPosition(coin) && onStep(coin)
        && ![...game.platforms, ...game.obstacles].some((block) => overlapsRect(coinBody(coin), block))
        && Number.isFinite(collectibleCost(game, coin, nav));
    });
}

function coverage(game: GameSpec, navigation: Navigation | undefined): number {
  if (!navigation) return -1;
  return game.collectibles.filter((coin) => Number.isFinite(collectibleCost(game, coin, navigation))
    || candidates(coin, navigation).length > 0).length;
}

function placeColumn(game: GameSpec, indices: number[], coinIndexes: number[], cache: AnalysisCache): boolean {
  const plan = planColumn(game, indices);
  if (!plan) return false;
  const originals = game.platforms.map((platform) => ({ ...platform }));
  const savedCoins = game.collectibles.map((coin) => ({ ...coin }));
  const shifts = [0, game.player.size, -game.player.size, game.player.size * 2, -game.player.size * 2].map((shift) => Math.round(shift));
  const restore = () => {
    indices.forEach((index) => { game.platforms[index] = originals[index]!; });
    game.collectibles.forEach((coin, index) => Object.assign(coin, savedCoins[index]));
  };
  for (const gap of columnGaps(game, plan.maxRise)) {
    for (const shift of shifts) {
      const xs = layoutColumn(game, plan, gap, shift);
      if (!xs || columnClashes(game, indices, xs, plan.yByIndex)) continue;
      for (const index of indices) game.platforms[index] = { ...originals[index]!, x: xs.get(index)!, y: plan.yByIndex.get(index)! };
      snapColumnCoins(game, indices, coinIndexes, originals);
      // A top step can stay unreachable when every coin is already on a proved
      // step or within 160px of one. The coin pass finishes that shorter move.
      if (columnProven(game, indices, coinIndexes, cache) || coverage(game, buildNavigation(game, false, cache)) === game.collectibles.length) return true;
      restore();
    }
  }
  restore();
  return false;
}

function placementClashes(game: GameSpec, index: number, block: Rect): boolean {
  const fixed: Rect[] = [
    ...game.platforms.filter((_, other) => other !== index),
    ...game.obstacles,
    { x: game.player.x, y: game.player.y, width: game.player.size, height: game.player.size },
  ];
  return fixed.some((other) => overlapsRect(block, other));
}

function jumpReaches(game: GameSpec, anchor: Rect, index: number): boolean {
  const platform = game.platforms[index]!;
  const half = game.player.size / 2;
  const standY = surfaceTop(anchor) - half;
  const left = Math.max(half, anchor.x - anchor.width / 2 + half);
  const right = Math.min(960 - half, anchor.x + anchor.width / 2 - half);
  if (left > right || standY < 70 + half) return false;
  const targetY = surfaceTop(platform) - half;
  const seen = new Set<number>();
  const lands = (x: number): boolean => {
    const clamped = Math.max(left, Math.min(right, x));
    const key = Math.round(clamped * 10);
    if (seen.has(key)) return false;
    seen.add(key);
    const landing = flightLanding(game, { x: clamped, y: standY }, platform.x, true);
    return landing !== undefined && Math.abs(landing.y - targetY) <= 0.001
      && landing.x >= platform.x - platform.width / 2 + half - 0.5
      && landing.x <= platform.x + platform.width / 2 - half + 0.5;
  };
  if ([left, (left + right) / 2, right, platform.x - 64, platform.x, platform.x + 64].some(lands)) return true;
  // A rise close to the jump height has a narrow approach, often from the far
  // side of the step (the near side bumps its underside or clips its corner).
  // None of the six starts above need hit it, so scan the whole anchor top.
  for (let x = left; x <= right; x += 8) if (lands(x)) return true;
  return false;
}

function rideCoins(game: GameSpec, index: number, original: Rect, coinIndexes: number[]): boolean {
  const next = game.platforms[index]!;
  const rest = coinRestY(next);
  if (rest < 80 || rest > 484) return false;
  const span = next.width - COIN_SIZE;
  for (const coinIndex of coinIndexes) {
    const coin = game.collectibles[coinIndex]!;
    const x = Math.round(coin.x + next.x - original.x);
    coin.x = Math.max(16, Math.min(944, Math.max(next.x - span / 2, Math.min(next.x + span / 2, x))));
    coin.y = rest;
    if (!itemPosition(coin) || [...game.platforms, ...game.obstacles].some((block) => overlapsRect(coinBody(coin), block))) return false;
  }
  return true;
}

/** A seat must not break the schema. A coin that is not on the seated platform
 * may still be broken: the coin pass runs later and moves it, exactly as the
 * structural check at the top of repair also leaves coin issues alone. */
function schemaAllowsSeat(game: GameSpec, owned: number[]): boolean {
  const parsed = GameSpecSchema.safeParse(game);
  return parsed.success || parsed.error.issues.every((issue) => issue.path[0] === 'collectibles'
    && typeof issue.path[1] === 'number' && !owned.includes(issue.path[1]));
}

/** Move one unreachable platform beside a reached step. Width and height stay.
 * A candidate is kept only when a simulated jump lands on it and navigation
 * then gives every coin on it a finite cost. Anything else is rolled back.
 * The platform travels at most maxMove px from where the author put it.
 */
function seatBesideReached(game: GameSpec, index: number, cache: AnalysisCache, maxMove = Infinity): boolean {
  const nav = buildNavigation(game, false, cache);
  const owned = coinsOnPlatforms(game, [index]);
  if (!nav || owned.length === 0) return false;
  if (surfaceReached(game, game.platforms[index]!, nav)
    && owned.every((coin) => Number.isFinite(collectibleCost(game, game.collectibles[coin]!, nav)))) return true;
  const original = { ...game.platforms[index]! };
  const savedCoins = game.collectibles.map((coin) => ({ ...coin }));
  const restore = () => {
    game.platforms[index] = { ...original };
    game.collectibles.forEach((coin, coinIndex) => Object.assign(coin, savedCoins[coinIndex]));
  };
  const limits = jumpLimits(game);
  const anchors: Rect[] = [FLOOR, ...game.platforms.filter((platform, other) => other !== index
    && surfaceReached(game, platform, nav))];
  const candidates: Array<{ x: number; y: number; anchor: Rect }> = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const anchorTop = surfaceTop(anchor);
    let y = original.y;
    const rise = anchorTop - surfaceTop(original);
    if (rise > limits.schemaRise) {
      y = Math.ceil(anchorTop - limits.schemaRise + original.height / 2 - 1e-9);
      while (anchorTop - (y - original.height / 2) > limits.schemaRise + 1e-6) y += 1;
    }
    const actualRise = anchorTop - (y - original.height / 2);
    if (actualRise <= 4 || actualRise > limits.height + 1e-6) continue;
    const spots = [original.x];
    for (let gap = 0; gap <= 176; gap += 8) {
      const left = anchor.x - anchor.width / 2 - gap - original.width / 2;
      const right = anchor.x + anchor.width / 2 + gap + original.width / 2;
      spots.push(Math.round(left), Math.round(right));
    }
    for (const x of spots) {
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ x, y, anchor });
    }
  }
  // Keep the authored height when a sideways seat proves. Dropping toward a
  // lower anchor is only tried after every same-height candidate.
  candidates.sort((a, b) => Math.abs(a.y - original.y) - Math.abs(b.y - original.y)
    || Math.abs(a.x - original.x) - Math.abs(b.x - original.x) || a.x - b.x || a.y - b.y);
  let checks = 0;
  for (const candidate of candidates) {
    restore();
    const block = { ...original, x: candidate.x, y: candidate.y };
    if (Math.hypot(block.x - original.x, block.y - original.y) > maxMove) continue;
    if (!insidePlayfield(block) || placementClashes(game, index, block)) continue;
    game.platforms[index] = block;
    if (!rideCoins(game, index, original, owned)) continue;
    const rise = surfaceTop(candidate.anchor) - surfaceTop(block);
    if (rise <= 4 || rise > limits.height + 1e-6 || !jumpReaches(game, candidate.anchor, index)) continue;
    if (++checks > 24) break;
    const proved = buildNavigation(game, false, cache);
    const coinsReachable = proved !== undefined && surfaceReached(game, block, proved)
      && owned.every((coin) => Number.isFinite(collectibleCost(game, game.collectibles[coin]!, proved)));
    if (!coinsReachable || !schemaAllowsSeat(game, owned)) continue;
    return true;
  }
  restore();
  return false;
}

function reflowBlockedPlatforms(game: GameSpec, cache: AnalysisCache): void {
  if (game.genre !== 'platformer' || game.platforms.length === 0) return;
  const nav = buildNavigation(game, false, cache);
  if (!nav) return;
  const reached: number[] = [];
  const blocked: number[] = [];
  game.platforms.forEach((_, index) => {
    (surfaceReached(game, game.platforms[index]!, nav) ? reached : blocked).push(index);
  });
  if (blocked.length === 0) return;
  if (reached.length === 0) {
    // Nothing is mounted yet, so the whole stair may be respaced from the floor.
    // A layout that already has a reached step keeps those platforms put.
    // Coins that a short move can still save count only on zero-damage ground:
    // a floor spot inside an enemy's patrol is not a place a coin can be taken.
    if (coverage(game, buildNavigation(game, true, cache)) === game.collectibles.length) return;
    const every = game.platforms.map((_, index) => index);
    const coins = coinsOnPlatforms(game, every);
    if (coins.length === 0) return;
    if (placeColumn(game, every, coins, cache)) return;
    // The stair does not fit as one column (its steps are too wide to sit in a
    // row). Seat the steps one by one from the floor up, like below: the floor
    // is always an anchor, and every seated step anchors the next. With nothing
    // mounted to begin with, no step may travel more than MAX_MOVE: a stair
    // hanging far above the floor stays rejected.
  }
  const pending = blocked
    .filter((index) => coinsOnPlatforms(game, [index]).some((coin) => !Number.isFinite(collectibleCost(game, game.collectibles[coin]!, nav))))
    .sort((a, b) => surfaceTop(game.platforms[b]!) - surfaceTop(game.platforms[a]!) || a - b);
  const maxMove = reached.length === 0 ? MAX_MOVE : Infinity;
  for (const index of pending) seatBesideReached(game, index, cache, maxMove);
}

function reflowStackedPlatforms(game: GameSpec, cache: AnalysisCache): void {
  if (game.genre !== 'platformer' || game.platforms.length < 2) return;
  const columns = stackedColumns(game);
  if (columns.length === 0) return;
  const nav = buildNavigation(game, false, cache);
  if (!nav) return;
  const jobs = columns.flatMap((group) => {
    const coins = coinsOnPlatforms(game, group);
    const blocked = group.some((index) => !surfaceReached(game, game.platforms[index]!, nav));
    return blocked && coins.length > 0 ? [{ group, coins }] : [];
  });
  if (jobs.length === 0) return;
  const saved = {
    platforms: game.platforms.map((platform) => ({ ...platform })),
    collectibles: game.collectibles.map((coin) => ({ ...coin })),
  };
  const restore = () => {
    game.platforms = saved.platforms.map((platform) => ({ ...platform }));
    game.collectibles = saved.collectibles.map((coin) => ({ ...coin }));
  };
  const reject = (coinIndex: number): never => {
    restore();
    fail(`collectibles.${coinIndex}`, `Xu ${coinIndex + 1} không thể tiếp cận an toàn, không có vị trí thay thế trong ${MAX_MOVE}px.`);
  };
  for (const job of jobs) {
    if (placeColumn(game, job.group, job.coins, cache)) continue;
    const navNow = buildNavigation(game, false, cache);
    const bad = job.coins.find((coinIndex) => !navNow
      || !Number.isFinite(collectibleCost(game, game.collectibles[coinIndex]!, navNow)));
    // A coin that already has a finite cost is not the failure, even if it is
    // the first coin parked on this column.
    if (bad !== undefined) reject(bad);
  }
  // One column is already proved inside placeColumn. A second column can block the first.
  if (jobs.length < 2) return;
  const proved = buildNavigation(game, false, cache);
  const solved = proved !== undefined && jobs.every((job) => job.group.every((index) => surfaceReached(game, game.platforms[index]!, proved))
    && job.coins.every((index) => Number.isFinite(collectibleCost(game, game.collectibles[index]!, proved))));
  if (!solved) reject(jobs[0]?.coins[0] ?? 0);
}

const OFFSCREEN = 'Vật thể vượt khỏi màn chơi.';

/** Coins that ride a moved platform move by the same offset, kept on the
 * platform's span and inside the item area. Shared by every platform move. */
function shiftRiders(game: GameSpec, riders: number[], original: Rect, block: Rect): void {
  const span = block.width / 2 - COIN_SIZE / 2;
  for (const coinIndex of riders) {
    const coin = game.collectibles[coinIndex]!;
    coin.x = Math.max(16, Math.min(944, Math.max(block.x - span, Math.min(block.x + span, coin.x + block.x - original.x))));
    coin.y = Math.max(80, Math.min(484, coin.y + block.y - original.y));
  }
}

/** Highest platform center a player can still stand under. The player is about
 * 28px tall and Phaser clamps its body at the world top (y=70), so a surface
 * is only standable when its top edge is at y >= 70 + 28 = 98. The schema's own
 * limit (center y >= 80) also admits tops at 70..97 that nobody can stand on. */
const STANDABLE_TOP_MIN_Y = 98;
const standableMinY = (height: number) => Math.max(yBounds(height).min, Math.ceil(STANDABLE_TOP_MIN_Y + height / 2));

/** First repair step, before the strict schema runs: a platform or obstacle whose
 * center lies outside the schema's x 10..950 / y 80..490 is moved just inside.
 * A block already inside is never touched. Width, height and order stay. A
 * platformer block keeps a standable top edge. Coins resting on a moved
 * platform move with it. There is no rollback: the original is not valid. */
export function bringBlocksIntoRange(game: GameSpec): void {
  const outside = (block: Rect) => block.x < 10 || block.x > 950 || block.y < 80 || block.y > 490;
  const moves: Array<{ list: 'platforms' | 'obstacles'; index: number }> = [];
  game.platforms.forEach((block, index) => { if (outside(block)) moves.push({ list: 'platforms', index }); });
  game.obstacles.forEach((block, index) => { if (outside(block)) moves.push({ list: 'obstacles', index }); });
  // Riders are decided on the original layout, before anything moves.
  const riders = new Map<number, number[]>();
  for (const move of moves) if (move.list === 'platforms') riders.set(move.index, coinsOnPlatforms(game, [move.index]));
  for (const { list, index } of moves) {
    const original = { ...game[list][index]! };
    const bounds = yBounds(original.height);
    const minY = game.genre === 'platformer' ? standableMinY(original.height) : bounds.min;
    if (minY > bounds.max) fail(`${list}.${index}`, 'Bệ đỡ hoặc vật cản không có vị trí đứng được trong vùng chơi.');
    const x = Math.max(10, Math.min(950, Math.max(Math.ceil(original.width / 2), Math.min(Math.floor(960 - original.width / 2), original.x))));
    const y = Math.max(minY, Math.min(bounds.max, original.y));
    game[list][index] = { ...original, x, y };
    if (list === 'platforms') shiftRiders(game, riders.get(index) ?? [], original, game.platforms[index]!);
  }
}

function physicalCoins(game: GameSpec, cache: AnalysisCache): Set<number> {
  const nav = buildNavigation(game, false, cache);
  return new Set(nav ? game.collectibles.flatMap((coin, index) => (Number.isFinite(collectibleCost(game, coin, nav)) ? [index] : [])) : []);
}

function reachedPlatforms(game: GameSpec, cache: AnalysisCache): Set<number> {
  const nav = buildNavigation(game, false, cache);
  return new Set(nav ? game.platforms.flatMap((platform, index) => (surfaceReached(game, platform, nav) ? [index] : [])) : []);
}

/** Candidate: move a platform that sticks out of the screen just inside it,
 * keeping width and height. Coins on it move by the same offset. The move is
 * kept only if no other platform or coin loses physical reachability, so a
 * clamp that builds a ceiling or blocks a jump is rolled back. */
function clampOffscreen(game: GameSpec, indices: number[], cache: AnalysisCache): void {
  for (const index of indices) {
    const original = { ...game.platforms[index]! };
    const bounds = yBounds(original.height);
    const block = {
      ...original,
      x: Math.max(Math.max(10, Math.ceil(original.width / 2)), Math.min(Math.min(950, Math.floor(960 - original.width / 2)), original.x)),
      y: Math.max(bounds.min, Math.min(bounds.max, original.y)),
    };
    const owned = coinsOnPlatforms(game, [index]);
    const coinsBefore = physicalCoins(game, cache);
    const platformsBefore = reachedPlatforms(game, cache);
    const savedCoins = game.collectibles.map((coin) => ({ ...coin }));
    const restore = () => {
      game.platforms[index] = { ...original };
      game.collectibles.forEach((coin, coinIndex) => Object.assign(coin, savedCoins[coinIndex]));
    };
    if (insidePlayfield(block) && !placementClashes(game, index, block)) {
      game.platforms[index] = block;
      shiftRiders(game, owned, original, block);
      const coinsAfter = physicalCoins(game, cache);
      const platformsAfter = reachedPlatforms(game, cache);
      const harmed = [...coinsBefore].some((coin) => !owned.includes(coin) && !coinsAfter.has(coin))
        || [...platformsBefore].some((other) => other !== index && !platformsAfter.has(other));
      if (!harmed) continue;
      restore();
    }
    // Otherwise seat it beside a reached step (also proved by a simulated jump).
    if (!seatBesideReached(game, index, cache) || !insidePlayfield(game.platforms[index]!)) restore();
  }
}

/** Physical moves only, no enemies: used to tell a hazard block from a layout
 * block. With the same deadline it is a lower bound of the zero-damage route. */
function physicalRoute(game: GameSpec, graph: PhysicalGraph, timeLimitSeconds: number): RouteResult {
  return checkObjectiveRoute({
    nodeCount: graph.nodes.length, spawn: graph.spawnNode, spawnSafe: true,
    edges: graph.edges.map((edge) => ({
      from: edge.from, to: edge.to, ticks: edge.ticks, timed: false,
      coins: game.collectibles.flatMap((coin, index) => (edge.points.some((p) => touchesCoin(game, p, coin)) ? [index] : [])),
    })),
    nodeCoins: graph.nodes.map((node) => game.collectibles.flatMap((coin, index) => (touchesCoin(game, node, coin) ? [index] : []))),
    coinValues: game.collectibles.map((coin) => coin.value), win: game.win, timeLimitSeconds,
    startupSeconds: graph.startupTicks / TICKS_PER_SECOND, ticksPerSecond: TICKS_PER_SECOND,
  });
}

const routeDeadline = (game: GameSpec) => (game.win.type === 'survive' ? 0 : game.lose.timeLimitSeconds);

/** Zero-damage route for the objective; the deadline defaults to the game's. */
export function zeroDamageRoute(game: GameSpec, cache: AnalysisCache, timeLimitSeconds = routeDeadline(game)): RouteResult | undefined {
  const graph = buildPhysicalGraph(game, cache);
  if (!graph) return undefined;
  const analysis = hazardAnalysis(game, graph, cache);
  return checkObjectiveRoute({
    nodeCount: graph.nodes.length, spawn: graph.spawnNode, spawnSafe: analysis.spawnSafe,
    edges: analysis.edges,
    nodeCoins: analysis.nodeCoins.map((list, node) => (analysis.safe[node] ? list : [])),
    coinValues: game.collectibles.map((coin) => coin.value), win: game.win,
    timeLimitSeconds,
    startupSeconds: graph.startupTicks / TICKS_PER_SECOND, ticksPerSecond: TICKS_PER_SECOND,
  });
}

/** Transactional repair. Coin and enemy centers still move at most 160px,
 * except coins that ride along when their own platform is moved.
 * Only a true vertical column is spread as a staircase. A zigzag keeps every
 * platform navigation can already stand on, and seats the unreachable steps
 * beside those anchors. A platform outside the screen is clamped inside it.
 * Counts, sizes, values, physics and goals never change. The input is never
 * mutated. Unproven layouts fail closed with 422.
 *
 * Platformer acceptance: the physical graph (no enemies) plus the enemy hazard
 * analysis give zero-damage moves; objective-route.ts then needs one route for
 * the objective (and its deadline) over those moves.
 */
export function repairGamePlacement(input: GameSpec, cache: AnalysisCache = createAnalysisCache()): GameSpec {
  const game = structuredClone(input);
  bringBlocksIntoRange(game);
  const structural = GameSpecSchema.safeParse(game);
  const offscreen: number[] = [];
  if (!structural.success) {
    for (const issue of structural.error.issues) {
      const [head, index] = issue.path;
      if (head === 'collectibles' || head === 'enemies') continue;
      // A platform outside the screen is a placement problem the clamp candidate may fix.
      if (head === 'platforms' && typeof index === 'number' && issue.message === OFFSCREEN) { offscreen.push(index); continue; }
      fail(issue.path.map(String).join('.'), issue.message);
    }
  }
  if (offscreen.length > 0) {
    clampOffscreen(game, [...new Set(offscreen)].sort((a, b) => a - b), cache);
    const still = game.platforms.findIndex((platform) => !insidePlayfield(platform));
    if (still >= 0) fail(`platforms.${still}`, OFFSCREEN);
  }
  reflowStackedPlatforms(game, cache);
  reflowBlockedPlatforms(game, cache);
  const blocks = [...game.platforms, ...game.obstacles];
  const base = buildNavigation(game, false, cache);
  if (!base) fail('player', 'Không tìm được đường đi an toàn từ điểm xuất phát.');

  const onFloor = (enemy: GameSpec['enemies'][number]) => game.genre === 'platformer'
    && FLOOR_TOP - (enemy.y + enemy.size / 2) <= 6;
  // Platformer: the envelope the hazard analysis uses (turns overshoot by up to
  // two steps, plus uncertainty), minus its 1px rounding margin across the
  // patrol so an enemy resting on a block top stays valid. Top-down keeps
  // patrolRect unchanged.
  const envelopes = new Map<string, Rect>();
  const patrolOf = (enemy: GameSpec['enemies'][number]): Rect => {
    if (game.genre !== 'platformer') return patrolRect(enemy, game.difficulty.enemySpeedMultiplier);
    const id = JSON.stringify(enemy);
    let rect = envelopes.get(id);
    if (!rect) {
      const envelope = enemyEnvelope(game, enemy);
      rect = enemy.axis === 'horizontal' ? { ...envelope, height: enemy.size } : { ...envelope, width: enemy.size };
      envelopes.set(id, rect);
    }
    return rect;
  };
  const enemyValid = (enemy: GameSpec['enemies'][number]) => {
    const patrol = patrolOf(enemy);
    return itemPosition(enemy) && withinWorld(patrol)
      && !blocks.some((block) => overlapsRect(patrol, block))
      && !base.spawnPath.some((p) => overlapsRect(patrol, { ...p, width: game.player.size, height: game.player.size }, 24))
      && Number.isFinite(collectibleCost(game, enemy, base));
  };
  for (let i = 0; i < game.enemies.length; i += 1) {
    const enemy = game.enemies[i]!;
    if (enemyValid(enemy)) continue;
    const position = candidates(enemy, base).find((p) => {
      if (onFloor(enemy) && p.y !== enemy.y) return false;
      const moved = { ...enemy, ...p };
      return enemyValid(moved) && !game.enemies.some((other, j) => i !== j && overlapsRect(patrolOf(moved), patrolOf(other)));
    });
    if (!position) fail(`enemies.${i}`, `Kẻ địch ${i + 1} có vị trí hoặc đường tuần tra không hợp lệ, không có vị trí thay thế trong ${MAX_MOVE}px.`);
    game.enemies[i] = { ...enemy, ...position };
  }

  // Platformer: enemies are moving hazards, never walls. A floor enemy is slid
  // (at most 160px; range, speed and axis kept) only when the hazard analysis
  // shows the objective route is blocked by enemies while the layout itself
  // allows it.
  if (game.genre === 'platformer') {
    const graph = buildPhysicalGraph(game, cache);
    const routeScore = () => {
      const route = zeroDamageRoute(game, cache);
      if (!route) return -1;
      return (route.ok ? game.collectibles.length + 1 : 0) + route.reachable.filter(Boolean).length;
    };
    // Slide only when enemies really block the route: the layout itself,
    // ignoring enemies, meets the objective and the same deadline (a lower
    // bound of any zero-damage route), while the zero-damage route fails even
    // without a deadline. A route that exists but is too slow is reported as
    // such by the final check, without spending hazard analyses on slides.
    const physical = graph ? physicalRoute(game, graph, routeDeadline(game)) : undefined;
    const physicalScore = physical?.ok ? 2 * game.collectibles.length + 1 : -1;
    const blocked = physical?.ok === true && zeroDamageRoute(game, cache, 0)?.ok !== true;
    let best = blocked ? routeScore() : physicalScore;
    if (blocked && best < physicalScore) {
      // Nearest positions first, so the first one that restores the route is
      // also the smallest move. Every check is a full hazard analysis; past the
      // budget no more slides are tried and the final route check decides.
      let checks = 0;
      for (let index = 0; index < game.enemies.length && best < physicalScore; index += 1) {
        const enemy = game.enemies[index]!;
        if (!onFloor(enemy)) continue;
        const origin = enemy.x;
        let bestX = origin;
        const xs = Array.from({ length: 2 * MAX_MOVE / 16 }, (_, k) => origin + (k % 2 === 0 ? 1 : -1) * 16 * (Math.floor(k / 2) + 1));
        for (const x of xs) {
          if (checks >= SLIDE_CHECKS) break;
          const moved = { ...enemy, x };
          const overlaps = game.enemies.some((other, otherIndex) => otherIndex !== index && overlapsRect(patrolOf(moved), patrolOf(other)));
          if (!enemyValid(moved) || overlaps) continue;
          game.enemies[index] = moved;
          checks += 1;
          const score = routeScore();
          if (score > best) { best = score; bestX = x; }
          if (best >= physicalScore) break;
        }
        game.enemies[index] = { ...enemy, x: bestX };
      }
    }
  }
  const safe = buildNavigation(game, true, cache);
  if (!safe) fail('enemies', 'Kẻ địch chặn đường an toàn từ điểm xuất phát.');
  // The schema's own coarse rule (a platformer coin sits above a support it can
  // reach) is evaluated by the schema itself, for this coin only.
  const schemaAccepts = (coin: GameSpec['collectibles'][number], index: number) => {
    const parsed = GameSpecSchema.safeParse({ ...game, collectibles: game.collectibles.map((other, j) => (j === index ? coin : other)) });
    return parsed.success || !parsed.error.issues.some((issue) => issue.path[0] === 'collectibles' && issue.path[1] === index);
  };
  const coinValid = (coin: GameSpec['collectibles'][number], index: number) => itemPosition(coin)
    && !blocks.some((block) => overlapsRect(coinBody(coin), block))
    && !game.collectibles.some((other, j) => j < index && overlapsRect(coinBody(coin), coinBody(other), 2))
    && Number.isFinite(collectibleCost(game, coin, safe))
    && schemaAccepts(coin, index);
  for (let i = 0; i < game.collectibles.length; i += 1) {
    const coin = game.collectibles[i]!;
    if (coinValid(coin, i)) continue;
    const position = candidates(coin, safe).find((p) => coinValid({ ...coin, ...p }, i)
      && !game.collectibles.some((other, j) => j !== i && overlapsRect(coinBody(p), coinBody(other), 2)));
    if (!position) fail(`collectibles.${i}`, `Xu ${i + 1} không thể tiếp cận an toàn, không có vị trí thay thế trong ${MAX_MOVE}px.`);
    game.collectibles[i] = { ...coin, ...position };
  }

  if (game.genre === 'platformer') {
    // One route for the objective over zero-damage moves, deadline included.
    const route = zeroDamageRoute(game, cache);
    if (!route) fail('player', 'Không tìm được đường đi an toàn từ điểm xuất phát.');
    if (!route.ok) fail(route.failure!.path, route.failure!.message);
  } else {
    const deadline = game.lose.timeLimitSeconds;
    if (deadline > 0 && game.win.type !== 'survive') {
      const routes = game.collectibles.map((coin) => ({ value: coin.value, seconds: collectibleCost(game, coin, safe) + 0.5 }));
      if (game.win.type === 'reach_score') routes.sort((a, b) => a.seconds / a.value - b.seconds / b.value);
      let seconds = safe.startupSeconds, score = 0;
      for (const route of routes) {
        seconds += route.seconds; score += route.value;
        if (game.win.type === 'reach_score' && score >= game.win.scoreTarget) break;
      }
      if (seconds > deadline) fail('lose.timeLimitSeconds', 'Không xác nhận được đường đi hoàn thành mục tiêu trong thời hạn đã yêu cầu.');
    }
  }
  const checked = GameSpecSchema.safeParse(game);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    fail(issue.path.map(String).join('.'), issue.message);
  }
  return checked.data;
}
