import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { buildNavigation, collectibleCost, flightLanding, overlapsRect, patrolRect, withinWorld, type Point, type Rect, type Navigation } from './game-geometry.js';

const MAX_MOVE = 160;
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
  throw new AIError('invalid_game_spec', `${reason} Không thể sửa an toàn mà giữ nguyên số lượng vật thể và mục tiêu; game chưa được tạo.`, 422, undefined, [path]);
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

function columnProven(game: GameSpec, indices: number[], coinIndexes: number[]): boolean {
  const nav = buildNavigation(game, false);
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

function placeColumn(game: GameSpec, indices: number[], coinIndexes: number[]): boolean {
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
      if (columnProven(game, indices, coinIndexes) || coverage(game, buildNavigation(game, false)) === game.collectibles.length) return true;
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
  const starts = [left, (left + right) / 2, right, platform.x - 64, platform.x, platform.x + 64];
  for (const x of starts) {
    const clamped = Math.max(left, Math.min(right, x));
    const key = Math.round(clamped * 10);
    if (seen.has(key)) continue;
    seen.add(key);
    const landing = flightLanding(game, { x: clamped, y: standY }, platform.x, true);
    if (!landing || Math.abs(landing.y - targetY) > 0.001) continue;
    if (landing.x >= platform.x - platform.width / 2 + half - 0.5
      && landing.x <= platform.x + platform.width / 2 - half + 0.5) return true;
  }
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

/** Move one unreachable platform beside a reached step. Width and height stay.
 * A candidate is kept only when a simulated jump lands on it and navigation
 * then gives every coin on it a finite cost. Anything else is rolled back.
 */
function seatBesideReached(game: GameSpec, index: number): boolean {
  const nav = buildNavigation(game, false);
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
    if (!insidePlayfield(block) || placementClashes(game, index, block)) continue;
    game.platforms[index] = block;
    if (!rideCoins(game, index, original, owned)) continue;
    const rise = surfaceTop(candidate.anchor) - surfaceTop(block);
    if (rise <= 4 || rise > limits.height + 1e-6 || !jumpReaches(game, candidate.anchor, index)) continue;
    if (++checks > 24) break;
    const proved = buildNavigation(game, false);
    const coinsReachable = proved !== undefined && surfaceReached(game, block, proved)
      && owned.every((coin) => Number.isFinite(collectibleCost(game, game.collectibles[coin]!, proved)));
    if (!coinsReachable || !GameSpecSchema.safeParse(game).success) continue;
    return true;
  }
  restore();
  return false;
}

function reflowBlockedPlatforms(game: GameSpec): void {
  if (game.genre !== 'platformer' || game.platforms.length === 0) return;
  const nav = buildNavigation(game, false);
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
    if (coverage(game, nav) === game.collectibles.length) return;
    const every = game.platforms.map((_, index) => index);
    const coins = coinsOnPlatforms(game, every);
    if (coins.length === 0) return;
    placeColumn(game, every, coins);
    return;
  }
  const pending = blocked
    .filter((index) => coinsOnPlatforms(game, [index]).some((coin) => !Number.isFinite(collectibleCost(game, game.collectibles[coin]!, nav))))
    .sort((a, b) => surfaceTop(game.platforms[b]!) - surfaceTop(game.platforms[a]!) || a - b);
  for (const index of pending) seatBesideReached(game, index);
}

function reflowStackedPlatforms(game: GameSpec): void {
  if (game.genre !== 'platformer' || game.platforms.length < 2) return;
  const columns = stackedColumns(game);
  if (columns.length === 0) return;
  const nav = buildNavigation(game, false);
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
    if (placeColumn(game, job.group, job.coins)) continue;
    const navNow = buildNavigation(game, false);
    const bad = job.coins.find((coinIndex) => !navNow
      || !Number.isFinite(collectibleCost(game, game.collectibles[coinIndex]!, navNow)));
    // A coin that already has a finite cost is not the failure, even if it is
    // the first coin parked on this column.
    if (bad !== undefined) reject(bad);
  }
  // One column is already proved inside placeColumn. A second column can block the first.
  if (jobs.length < 2) return;
  const proved = buildNavigation(game, false);
  const solved = proved !== undefined && jobs.every((job) => job.group.every((index) => surfaceReached(game, game.platforms[index]!, proved))
    && job.coins.every((index) => Number.isFinite(collectibleCost(game, game.collectibles[index]!, proved))));
  if (!solved) reject(jobs[0]?.coins[0] ?? 0);
}

/** Transactional repair. Coin and enemy centers still move at most 160px,
 * except coins that ride along when their own platform is respaced.
 * Only a true vertical column is spread as a staircase. A zigzag keeps every
 * platform navigation can already stand on, and seats the unreachable steps
 * beside those anchors. Counts, sizes, values, physics and goals never change.
 * Unproven layouts fail closed with 422.
 */
export function repairGamePlacement(input: GameSpec): GameSpec {
  const game = structuredClone(input);
  const structural = GameSpecSchema.safeParse(game);
  if (!structural.success) {
    const other = structural.error.issues.find((issue) => !['collectibles', 'enemies'].includes(String(issue.path[0])));
    if (other) fail(other.path.map(String).join('.'), other.message);
  }
  reflowStackedPlatforms(game);
  reflowBlockedPlatforms(game);
  const blocks = [...game.platforms, ...game.obstacles];
  const base = buildNavigation(game, false);
  if (!base) fail('player', 'Không tìm được đường đi an toàn từ điểm xuất phát.');

  const onFloor = (enemy: GameSpec['enemies'][number]) => game.genre === 'platformer'
    && FLOOR_TOP - (enemy.y + enemy.size / 2) <= 6;
  const enemyValid = (enemy: GameSpec['enemies'][number]) => {
    const patrol = patrolRect(enemy, game.difficulty.enemySpeedMultiplier);
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
      return enemyValid(moved) && !game.enemies.some((other, j) => i !== j
        && overlapsRect(patrolRect(moved, game.difficulty.enemySpeedMultiplier), patrolRect(other, game.difficulty.enemySpeedMultiplier)));
    });
    if (!position) fail(`enemies.${i}`, `Kẻ địch ${i + 1} có vị trí hoặc đường tuần tra không hợp lệ, không có vị trí thay thế trong ${MAX_MOVE}px.`);
    game.enemies[i] = { ...enemy, ...position };
  }

  // Avoid complete patrol envelopes, so a route never depends on taking damage
  // or on a lucky enemy phase. Reversible routes also prevent one-way coin traps.
  // A floor patrol can still seal the only jump. Slide those enemies in x, at
  // most 160px, until the safe route reaches as many coins as possible.
  let safe = buildNavigation(game, true);
  const safeScore = (navigation: Navigation | undefined) => navigation
    ? game.collectibles.filter((coin) => Number.isFinite(collectibleCost(game, coin, navigation))).length
    : -1;
  if (game.genre === 'platformer' && safeScore(safe) < game.collectibles.length) {
    for (let index = 0; index < game.enemies.length; index += 1) {
      const enemy = game.enemies[index]!;
      if (!onFloor(enemy)) continue;
      const origin = enemy.x;
      let bestX = origin;
      let best = safeScore(safe);
      for (let x = origin - MAX_MOVE; x <= origin + MAX_MOVE; x += 16) {
        if (x === origin) continue;
        const moved = { ...enemy, x };
        const overlaps = game.enemies.some((other, otherIndex) => otherIndex !== index
          && overlapsRect(patrolRect(moved, game.difficulty.enemySpeedMultiplier), patrolRect(other, game.difficulty.enemySpeedMultiplier)));
        if (!enemyValid(moved) || overlaps) continue;
        game.enemies[index] = moved;
        const score = safeScore(buildNavigation(game, true));
        if (score > best) {
          best = score;
          bestX = x;
          if (best === game.collectibles.length) break;
        }
      }
      game.enemies[index] = { ...enemy, x: bestX };
      if (best === game.collectibles.length) break;
    }
    safe = buildNavigation(game, true);
  }
  if (!safe) fail('enemies', 'Kẻ địch chặn đường an toàn từ điểm xuất phát.');
  const coinValid = (coin: GameSpec['collectibles'][number], index: number) => itemPosition(coin)
    && !blocks.some((block) => overlapsRect(coinBody(coin), block))
    && !game.collectibles.some((other, j) => j < index && overlapsRect(coinBody(coin), coinBody(other), 2))
    && Number.isFinite(collectibleCost(game, coin, safe));
  for (let i = 0; i < game.collectibles.length; i += 1) {
    const coin = game.collectibles[i]!;
    if (coinValid(coin, i)) continue;
    const position = candidates(coin, safe).find((p) => coinValid({ ...coin, ...p }, i)
      && !game.collectibles.some((other, j) => j !== i && overlapsRect(coinBody(p), coinBody(other), 2)));
    if (!position) fail(`collectibles.${i}`, `Xu ${i + 1} không thể tiếp cận an toàn, không có vị trí thay thế trong ${MAX_MOVE}px.`);
    game.collectibles[i] = { ...coin, ...position };
  }

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
  const checked = GameSpecSchema.safeParse(game);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    fail(issue.path.map(String).join('.'), issue.message);
  }
  return checked.data;
}
