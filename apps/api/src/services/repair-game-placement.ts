import { GameSpecSchema, type GameSpec } from '@game-creator/contracts';
import { AIError } from '../providers/errors.js';
import { buildNavigation, collectibleCost, overlapsRect, patrolRect, withinWorld, type Point, type Navigation } from './game-geometry.js';

const MAX_MOVE = 160;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const itemPosition = (p: Point) => p.x >= 16 && p.x <= 944 && p.y >= 80 && p.y <= 484;
const coinBody = (p: Point) => ({ ...p, width: 20, height: 20 });

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

/** Transactional repair: only item x/y may change; never remove, merge or add an
 * item, reduce its value, or relax a win/lose condition to make validation pass.
 * The navigation proof is conservative; unproven layouts fail closed with 422.
 */
export function repairGamePlacement(input: GameSpec): GameSpec {
  const game = structuredClone(input);
  const structural = GameSpecSchema.safeParse(game);
  if (!structural.success) {
    const other = structural.error.issues.find((issue) => !['collectibles', 'enemies'].includes(String(issue.path[0])));
    if (other) fail(other.path.map(String).join('.'), other.message);
  }
  const blocks = [...game.platforms, ...game.obstacles];
  const base = buildNavigation(game, false);
  if (!base) fail('player', 'Không tìm được đường đi an toàn từ điểm xuất phát.');

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
      const moved = { ...enemy, ...p };
      return enemyValid(moved) && !game.enemies.some((other, j) => i !== j
        && overlapsRect(patrolRect(moved, game.difficulty.enemySpeedMultiplier), patrolRect(other, game.difficulty.enemySpeedMultiplier)));
    });
    if (!position) fail(`enemies.${i}`, `Kẻ địch ${i + 1} có vị trí hoặc đường tuần tra không hợp lệ, không có vị trí thay thế trong ${MAX_MOVE}px.`);
    game.enemies[i] = { ...enemy, ...position };
  }

  // Avoid complete patrol envelopes, so a route never depends on taking damage
  // or on a lucky enemy phase. Reversible routes also prevent one-way coin traps.
  const safe = buildNavigation(game, true);
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
